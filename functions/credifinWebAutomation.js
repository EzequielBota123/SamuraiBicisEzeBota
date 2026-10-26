// functions/credifinWebAutomation.js
// Credifin (la logística que nos factura los envíos) no tiene API pública
// para partners — reversado a partir de una captura real del portal de
// autogestión (credifin.com.ar/autogestion), 26/10/2026. Usa Auth0 (OAuth2
// + PKCE) para el login, así que — a diferencia de Contabilium, que es solo
// cookies — necesitamos un navegador real para completar el login una vez
// y sacar el token (JWT) resultante; de ahí en más los pedidos a la API son
// fetch directos con ese token, sin más Puppeteer, hasta que expire.
//
// Dato importante encontrado en el propio bundle de la SPA: el cliente
// "activo" (FEPA TOP acá) no vive en el servidor, vive en el sessionStorage
// del navegador (clave "cliente") — el login por sí solo no alcanza para
// pedir el resumen de cuenta, hay que simular también esa selección.
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium").default;

const BASE = "https://credifin.com.ar/autogestion";
const API_BASE = "https://thegroup.credifin.com.ar/autogestion/api";
const SESSION_DOC = "internalData/credifinSession";

// FEPA TOP (nuestra propia razón social) como cliente de Credifin — id fijo,
// confirmado contra /clientes/vinculados de la cuenta samuraibikes.oficial@
// gmail.com. No hay otro cliente vinculado a esta cuenta.
const CREDIFIN_IDCLIENTE_FEPA_TOP = 738460;

function decodeJwtExpMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Login completo vía navegador real: Auth0 (botón "Iniciar Sesión" →
// formulario usuario/contraseña → vuelve a credifin.com.ar con el código,
// la propia SPA lo cambia por un token) + selección del cliente FEPA TOP
// (sessionStorage, ver arriba). Devuelve el token (Bearer) y el objeto
// cliente tal cual lo espera la API.
async function loginCredifinWeb({ email, password }) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    );

    const apiCalls = [];
    page.on("response", async (res) => {
      const url = res.url();
      const ct = res.headers()["content-type"] || "";
      if (!/thegroup\.credifin/i.test(url) || !/json/i.test(ct)) return;
      try {
        apiCalls.push({ url, body: await res.text() });
      } catch {
        // respuesta no legible (binaria, cortada) — se ignora
      }
    });

    async function clickByText(selector, text) {
      const els = await page.$$(selector);
      for (const el of els) {
        const t = await el.evaluate((e) => e.innerText);
        if (t && t.includes(text)) {
          await el.click();
          return true;
        }
      }
      return false;
    }

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 60000 });
    const clickedIniciar = await clickByText("button", "Iniciar");
    if (!clickedIniciar) {
      throw new Error('No se encontró el botón "Iniciar Sesión" en /autogestion/login');
    }
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});

    const userSel = 'input[name="username"]';
    await page.waitForSelector(userSel, { timeout: 30000 }).catch(() => {});
    if (!(await page.$(userSel))) {
      throw new Error(`No apareció el formulario de Auth0 (url=${page.url()})`);
    }
    await page.type(userSel, email, { delay: 20 });
    await page.type('input[name="password"]', password, { delay: 20 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await new Promise((r) => setTimeout(r, 1500));

    if (/\/login/i.test(page.url())) {
      throw new Error(`El login de Credifin no avanzó, seguimos en ${page.url()}`);
    }

    const token = await page.evaluate(() => localStorage.getItem("token"));
    if (!token) {
      throw new Error("Login OK pero no apareció el token en localStorage — puede haber cambiado el mecanismo.");
    }

    const vinc = apiCalls.find((c) => c.url.includes("/clientes/vinculados"));
    if (!vinc) {
      throw new Error("No se capturó la respuesta de /clientes/vinculados — no se pudo resolver el cliente FEPA TOP.");
    }
    const vincData = JSON.parse(vinc.body).data.clientes_usuario.find(
      (c) => c.clientes_id === CREDIFIN_IDCLIENTE_FEPA_TOP
    );
    if (!vincData) {
      throw new Error(`FEPA TOP (id ${CREDIFIN_IDCLIENTE_FEPA_TOP}) no aparece entre los clientes vinculados a esta cuenta.`);
    }

    return { token, cliente: { ...vincData.cliente, clientes_remitos: vincData.clientes_remitos } };
  } finally {
    await browser.close();
  }
}

// Mismo patrón de cacheo que getCookieValida en contabiliumWebAutomation.js
// — el JWT trae su propia fecha de expiración (`exp`), la usamos en vez de
// un TTL fijo nuestro.
async function getCredifinToken(db, email, password) {
  const ref = db.doc(SESSION_DOC);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;
  const BUFFER_MS = 2 * 60 * 1000; // margen de 2 min antes de que expire de verdad
  if (data?.token && data?.expiresAtMs && data.expiresAtMs > Date.now() + BUFFER_MS) {
    return data.token;
  }

  const { token } = await loginCredifinWeb({ email, password });
  const expiresAtMs = decodeJwtExpMs(token) || Date.now() + 60 * 60 * 1000;
  await ref.set({
    token,
    expiresAtMs,
    updatedAt: require("firebase-admin").firestore.FieldValue.serverTimestamp(),
  });
  return token;
}

async function invalidarCredifinToken(db) {
  await db.doc(SESSION_DOC).delete().catch(() => {});
}

// Cuenta corriente de FEPA TOP en Credifin para un rango de fechas — lista
// de movimientos (Fecha, Comprobante, Concepto, Debitos, Creditos, Saldo,
// NroAuxiliar — este último es el `comprobantes_id` que después pide
// getComprobantePdfCredifin).
async function getCtaCteCredifin(db, email, password, { desde, hasta }) {
  async function pedir(token) {
    const url = `${API_BASE}/cliente/ctacte?desde=${desde}&hasta=${hasta}&idcliente=${CREDIFIN_IDCLIENTE_FEPA_TOP}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      const err = new Error("401");
      err.unauthorized = true;
      throw err;
    }
    if (!res.ok) throw new Error(`Credifin ctacte respondió ${res.status}`);
    const json = await res.json();
    return json?.data?.reporte || [];
  }

  const token = await getCredifinToken(db, email, password);
  try {
    return await pedir(token);
  } catch (err) {
    if (!err.unauthorized) throw err;
    // El token cacheado dejó de servir antes de lo esperado — se invalida y
    // se reintenta una sola vez con un login nuevo.
    await invalidarCredifinToken(db);
    const tokenNuevo = await getCredifinToken(db, email, password);
    return await pedir(tokenNuevo);
  }
}

// PDF real de un comprobante puntual — `comprobantesId` es el campo
// `NroAuxiliar` que trae cada fila de getCtaCteCredifin. Confirmado por
// captura real: este endpoint funciona aunque la sección "Comprobantes" de
// la cuenta esté bloqueada (son permisos separados).
async function getComprobantePdfCredifin(db, email, password, comprobantesId) {
  async function pedir(token) {
    const res = await fetch(`${API_BASE}/print/comprobante`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comprobantes_id: comprobantesId, guias_id: 0, mostrar_comprobante: true, recibos_id: 0 }),
    });
    if (res.status === 401) {
      const err = new Error("401");
      err.unauthorized = true;
      throw err;
    }
    if (!res.ok) throw new Error(`Credifin print/comprobante respondió ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }

  const token = await getCredifinToken(db, email, password);
  try {
    return await pedir(token);
  } catch (err) {
    if (!err.unauthorized) throw err;
    await invalidarCredifinToken(db);
    const tokenNuevo = await getCredifinToken(db, email, password);
    return await pedir(tokenNuevo);
  }
}

module.exports = {
  CREDIFIN_IDCLIENTE_FEPA_TOP,
  getCredifinToken,
  invalidarCredifinToken,
  getCtaCteCredifin,
  getComprobantePdfCredifin,
};
