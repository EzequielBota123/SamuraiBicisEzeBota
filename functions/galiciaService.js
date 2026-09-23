// functions/galiciaService.js
// Integración con las APIs de Open Galicia (Banco Galicia) — Consulta de
// Saldos y Movimientos de Cuenta, ambiente QA (Homologación). Basado en la
// documentación oficial (GeneracionJWT.pdf, APIConsultadeSaldos.pdf,
// APIMovimientosdeCuenta.pdf) provista por el banco en septiembre/2026.
//
// Requiere Mutual TLS: cada request va firmado con el certificado cliente
// (.cer, emitido por Galicia a partir de nuestro CSR) + su clave privada.
// Por eso NO se puede usar el fetch global — hace falta pasar cert/key en
// el handshake TLS, así que las llamadas van con el módulo https nativo.
const https = require("https");

const AUTH_HOST_QA = "poca-cap-b2b-homo.hgal.bancogalicia.com.ar";
const API_HOST_QA = "ofcc-ofbcuentas-b2b-homo.hgal.bancogalicia.com.ar";
const GALICIA_PORT = 8443;

// CUIT de FEPA TOP SAS (dato público de la empresa, no es secreto) — se usa
// como client_id en el body de autenticación y como parte del header
// Authorization Basic (CUIT:AuthorizationPassword).
const CUIT_EMPRESA = "30718957903";

function httpsRequestGalicia({ hostname, path, method, headers, body, cert, key, passphrase }) {
  if (!cert || !key) {
    throw new Error(
      "Falta el certificado mTLS de Galicia (GALICIA_QA_CERT_PEM). Sin el .cer firmado por el banco, ninguna llamada a la API va a funcionar — el servidor corta la conexión en el handshake TLS."
    );
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, port: GALICIA_PORT, path, method, headers, cert, key, passphrase },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            // respuesta no-JSON (no debería pasar en estos endpoints)
          }
          resolve({ statusCode: res.statusCode, body: json, raw: data });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Crea (QA) un Access Token JWT — válido pocos minutos, hay que pedir uno
// nuevo por cada tanda de llamadas (no vale la pena cachearlo dado lo corto
// del vencimiento típico, 300s).
async function getGaliciaTokenQA({ appId, appKey, enterpriseId, authorizationPassword, certPem, keyPem, keyPassphrase }) {
  const basicValue = Buffer.from(`${CUIT_EMPRESA}:${authorizationPassword}`).toString("base64");
  const bodyStr = JSON.stringify({ client_id: CUIT_EMPRESA, grant_type: "password" });
  const { statusCode, body } = await httpsRequestGalicia({
    hostname: AUTH_HOST_QA,
    path: "/v2/pom/realms/enterprise-auth/openid-connect/create-token",
    method: "POST",
    headers: {
      app_id: appId,
      app_key: appKey,
      authorization: `Basic ${basicValue}`,
      "content-type": "application/json",
      enterprise_id: enterpriseId,
      id_channel: "baas",
      "content-length": Buffer.byteLength(bodyStr),
    },
    body: bodyStr,
    cert: certPem,
    key: keyPem,
    passphrase: keyPassphrase,
  });
  if (statusCode < 200 || statusCode >= 300) throw new Error(`Galicia auth error ${statusCode}: ${JSON.stringify(body)}`);
  const token = body?.data?.[0]?.access_token;
  if (!token) throw new Error(`Galicia auth: respuesta sin access_token: ${JSON.stringify(body)}`);
  return { accessToken: token, expiresIn: body.data[0].expires_in };
}

// API Consulta de Saldos — devuelve todas las cuentas habilitadas para la
// empresa autenticada (no hace falta pasar número de cuenta).
async function getSaldosGaliciaQA({ appId, appKey, accessToken, certPem, keyPem, keyPassphrase }) {
  const { statusCode, body } = await httpsRequestGalicia({
    hostname: API_HOST_QA,
    path: "/v1/pom/ecyp/accounts/get-accounts",
    method: "GET",
    headers: { id_channel: "baas", app_id: appId, app_key: appKey, authorization: `Bearer ${accessToken}` },
    cert: certPem,
    key: keyPem,
    passphrase: keyPassphrase,
  });
  if (statusCode < 200 || statusCode >= 300) throw new Error(`Galicia saldos error ${statusCode}: ${JSON.stringify(body)}`);
  return body;
}

// Paso 1/3 — Solicitud de extracto de movimientos (queda "PENDING" hasta que
// el banco lo procesa, cada ~30 min).
async function solicitarExtractoGaliciaQA({ appId, appKey, accessToken, accountNumber, startDate, endDate, certPem, keyPem, keyPassphrase }) {
  const bodyStr = JSON.stringify({ account_number: accountNumber, start_date: startDate, end_date: endDate });
  const { statusCode, body } = await httpsRequestGalicia({
    hostname: API_HOST_QA,
    path: "/extract-file",
    method: "POST",
    headers: {
      "content-type": "application/json",
      id_channel: "baas",
      app_id: appId,
      app_key: appKey,
      authorization: `Bearer ${accessToken}`,
      "content-length": Buffer.byteLength(bodyStr),
    },
    body: bodyStr,
    cert: certPem,
    key: keyPem,
    passphrase: keyPassphrase,
  });
  if (statusCode < 200 || statusCode >= 300) throw new Error(`Galicia solicitar extracto error ${statusCode}: ${JSON.stringify(body)}`);
  return body?.data; // { id, name, status, created_date, account_number }
}

// Paso 2/3 — Consulta el estado de todos los extractos solicitados (sin
// parámetros devuelve todos; el estado pasa de PENDING a PROCESSED).
async function validarExtractosGaliciaQA({ appId, appKey, accessToken, certPem, keyPem, keyPassphrase }) {
  const { statusCode, body } = await httpsRequestGalicia({
    hostname: API_HOST_QA,
    path: "/extract-file",
    method: "GET",
    headers: { id_channel: "baas", app_id: appId, app_key: appKey, authorization: `Bearer ${accessToken}` },
    cert: certPem,
    key: keyPem,
    passphrase: keyPassphrase,
  });
  if (statusCode < 200 || statusCode >= 300) throw new Error(`Galicia validar extracto error ${statusCode}: ${JSON.stringify(body)}`);
  return body?.data || []; // [{ id, name, status, ... }]
}

// Paso 3/3 — Descarga el extracto en CSV (paginado: si total_pages>1 el
// banco devuelve HTTP 206 y hay que seguir pidiendo página por página).
async function descargarExtractoGaliciaQA({ appId, appKey, accessToken, extractoId, certPem, keyPem, keyPassphrase }) {
  const { statusCode, body } = await httpsRequestGalicia({
    hostname: API_HOST_QA,
    path: `/extract-file/${extractoId}`,
    method: "GET",
    headers: { id_channel: "baas", app_id: appId, app_key: appKey, authorization: `Bearer ${accessToken}` },
    cert: certPem,
    key: keyPem,
    passphrase: keyPassphrase,
  });
  if (statusCode !== 200 && statusCode !== 206) {
    throw new Error(`Galicia descargar extracto error ${statusCode}: ${JSON.stringify(body)}`);
  }
  return { totalPages: Number(body?.data?.total_pages || 1), csv: body?.data?.file || "", partial: statusCode === 206 };
}

// Parsea el CSV que devuelve Galicia (separador ";", decimal con coma) a un
// array de movimientos con montos ya convertidos a número.
function parseCsvMovimientosGalicia(csv) {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(";").map((h) => h.trim());
  const toNumber = (s) => {
    const clean = String(s || "").trim();
    if (!clean) return null;
    const n = Number(clean.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  return lines.slice(1).map((line) => {
    const cells = line.split(";");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] !== undefined ? cells[i].trim() : "";
    });
    return {
      ...row,
      DebitosNum: toNumber(row["Débitos"]),
      CreditosNum: toNumber(row["Créditos"]),
      SaldoNum: toNumber(row["Saldo"]),
    };
  });
}

module.exports = {
  getGaliciaTokenQA,
  getSaldosGaliciaQA,
  solicitarExtractoGaliciaQA,
  validarExtractosGaliciaQA,
  descargarExtractoGaliciaQA,
  parseCsvMovimientosGalicia,
};
