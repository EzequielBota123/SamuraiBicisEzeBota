// functions/index.js
const { onRequest }  = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { getAllConceptos, getClientById, searchClientByDoc, getComprobantesByClientId, getAllComprobantes, getComprobanteById, getStockByDeposito, getDepositosViaStockBySKU, searchClientesByFiltro, getAllClientes, getCobranzasList, getCobranzaById, getStockDisponibleBySKU, buscarCobranzasPorClientePaginado, testPageIndexRaw, probeBancosEndpoints, debugComprobantesPaging, debugSaldoByCuit, debugClienteSearchRaw, debugProbeCcEndpoints, debugProbeRemitosEndpoints, debugProbeCrearComprobanteEndpoints, debugProbeCrearComprobantePayload, debugProbeStockDescuento, cobrarComprobante, crearComprobante, crearCliente, getDatosAfip, updateCliente } = require("./contabiliumService");


admin.initializeApp();

// región global (coincide con tu URL us-central1)
setGlobalOptions({ region: "us-central1" });

const SITE_URL = "https://samurai.ar";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "https://bikeshop-ab2f0.web.app",
  "https://bikeshop-ab2f0.firebaseapp.com",
  `${SITE_URL.replace("https://", "http://")}`,
  SITE_URL,
  "http://www.samurai.ar",
  "https://www.samurai.ar",
]);

function setCorsHeaders(req, res) {
  const origin = req.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Secretos del Secret Manager de Firebase
// Configurarlos con:
//   firebase functions:secrets:set CONTABILIUM_EMAIL
//   firebase functions:secrets:set CONTABILIUM_API_KEY
const CONTABILIUM_EMAIL   = defineSecret("CONTABILIUM_EMAIL");
const CONTABILIUM_API_KEY = defineSecret("CONTABILIUM_API_KEY");
const RESEND_API_KEY      = defineSecret("RESEND_API_KEY");
const MERCADOPAGO_ACCESS_TOKEN = defineSecret("MERCADOPAGO_ACCESS_TOKEN");

// Envía un mail vía la API de Resend (https://resend.com). "from" usa el
// dominio samurai.ar, ya verificado en la cuenta de Resend.
async function sendEmail(apiKey, { to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Samurai Bicis <notificaciones@samurai.ar>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
  return res.json();
}

// Devuelve un email real donde contactar al usuario, o null si no hay
// ninguno confiable. `email` en el doc del usuario suele ser un placeholder
// interno (`usuario@samurai.internal`, usado solo para el login de Auth),
// así que priorizamos `contabiliumEmail` (el email real cargado en su
// ficha de cliente de Contabilium).
function realEmailOf(u) {
  const contabiliumEmail = String(u.contabiliumEmail || "").trim();
  if (contabiliumEmail && contabiliumEmail.includes("@")) return contabiliumEmail;
  const email = String(u.email || "").trim();
  if (email && email.includes("@") && !email.endsWith("@samurai.internal")) return email;
  return null;
}

// ─────────────────────────────────────────────────────────────
// Lógica compartida de sincronización Contabilium → Firestore
// ─────────────────────────────────────────────────────────────
async function doContabiliumSync(email, apiKey) {
  const db = admin.firestore();

  const conceptos = await getAllConceptos(email, apiKey);

  // Stock realmente disponible para pedir (depósitos propios: Lavalle,
  // Depósito Cañuelas, CREDIFIN) — no el total de la empresa, que incluye
  // lo ya repartido en depósitos consignados de clientes puntuales.
  // Contabilium rate-limita fuerte este endpoint (429 con concurrencia baja
  // incluso), así que vamos secuencial con pausa entre cada llamada.
  const disponibleMap = new Map();
  const disponibleErrors = [];
  for (const c of conceptos) {
    const code = (c.Codigo || "").trim();
    if (!code) continue;
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      try {
        const disponible = await getStockDisponibleBySKU(email, apiKey, code);
        disponibleMap.set(code, disponible);
        ok = true;
      } catch (err) {
        const is429 = /error 429/.test(String(err));
        if (attempt === 4) {
          console.error(`[contabilium] stock disponible ${code}:`, err);
          disponibleErrors.push({ code, error: String(err) });
        } else {
          await sleep(is429 ? 2000 * attempt : 400);
        }
      }
    }
    await sleep(350);
  }

  const conceptoMap = {};
  for (const c of conceptos) {
    const code = (c.Codigo || "").trim();
    if (!code) continue;
    const disponible = disponibleMap.get(code);
    conceptoMap[code] = {
      stock:    disponible != null ? disponible : Math.round(c.Stock || 0),
      priceArs: c.PrecioFinal || null,
    };
  }

  const snapshot = await db.collection("products").get();

  const updates = [];
  for (const docSnap of snapshot.docs) {
    const { sku, stock, priceArs } = docSnap.data();
    const skuStr = (sku || "").toString().trim();
    if (!skuStr || !(skuStr in conceptoMap)) continue;
    const { stock: newStock, priceArs: newPriceArs } = conceptoMap[skuStr];
    const stockChanged    = newStock !== stock;
    const priceArsChanged = newPriceArs !== null && newPriceArs !== priceArs;
    if (stockChanged || priceArsChanged) {
      updates.push({ ref: docSnap.ref, stock: newStock, priceArs: newPriceArs });
    }
  }

  for (let i = 0; i < updates.length; i += 499) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 499)) {
      batch.update(u.ref, {
        stock:     u.stock,
        priceArs:  u.priceArs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  await db.doc("meta/contabiliumSync").set({
    lastSync: admin.firestore.FieldValue.serverTimestamp(),
    updated:  updates.length,
    total:    conceptos.length,
    errors:   disponibleErrors,
  });

  return { updated: updates.length, total: conceptos.length, disponibleErrors };
}

// ─────────────────────────────────────────────────────────────
// Sync automático cada 5 minutos
// ─────────────────────────────────────────────────────────────
exports.syncContabiliumStock = onSchedule(
  {
    schedule: "every 15 minutes",
    secrets:  [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 300,
  },
  async () => {
    try {
      const result = await doContabiliumSync(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value()
      );
      console.log("[contabilium] sync ok:", result);
    } catch (err) {
      console.error("[contabilium] sync error:", err);
      await admin.firestore().doc("meta/contabiliumSync").set(
        { errors: [String(err)], lastSync: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Sync de Cobranzas (conciliación bancaria) — trae listado + detalle
// (FormasDePago/NroReferencia) y hace upsert en Firestore `cobranzas`.
// ─────────────────────────────────────────────────────────────
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// "Saldo a favor" reimputa plata "a cuenta" ya recibida en otra cobranza
// contra una factura puntual — no es ingreso nuevo. Sumarla de nuevo duplica
// el total cobrado. Verificado línea por línea contra el export oficial
// "Cuenta corriente" de Contabilium: las cobranzas 100% "Saldo a favor"
// tienen Importe real $0 en ese reporte, y para el resto el importe que
// closea exacto es el de `Detalle` (aplicado a comprobantes), no el de
// `FormasDePago` (puede diferir por retenciones bancarias). importeReal
// reproduce esa lógica.
function buildCobranzaDoc(id, detail) {
  const formasDePago = detail.FormasDePago || [];
  const detalleArr = detail.Detalle || [];
  const importeTotal = formasDePago.length
    ? formasDePago.reduce((acc, f) => acc + Number(f.Importe || 0), 0)
    : Number(detail.ImporteTotal || 0);
  const esSoloSaldoAFavor = formasDePago.length > 0 &&
    formasDePago.every((f) => f.FormaDePago === "Saldo a favor");
  const importeReal = esSoloSaldoAFavor
    ? 0
    : detalleArr.length
    ? detalleArr.reduce((acc, d) => acc + Number(d.Importe || 0), 0)
    : importeTotal;
  return {
    contabiliumId:  id,
    idPersona:      detail.IDPersona ?? null,
    razonSocial:    detail.RazonSocial || null,
    tipoDocumento:  detail.TipoDocumento || null,
    nroDocumento:   detail.NroDocumento || null,
    numero:         detail.Numero != null ? String(detail.Numero) : null,
    fecha:          detail.Fecha || null,
    moneda:         detail.Moneda || null,
    importeTotal,
    importeReal,
    detalle:        detail.Detalle || [],
    formasDePago,
    syncedAt:       admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function doContabiliumCobranzasSync(email, apiKey, { fechaDesde, fechaHasta } = {}) {
  const db = admin.firestore();

  const desde = fechaDesde || (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  })();
  const hasta = fechaHasta || new Date().toISOString().slice(0, 10);

  const list = await getCobranzasList(email, apiKey, { fechaDesde: desde, fechaHasta: hasta });

  const errors = [];
  const details = await mapWithConcurrency(list, 5, async (item) => {
    const id = item.ID ?? item.Id;
    try {
      const detail = await getCobranzaById(email, apiKey, id);
      return { id, detail };
    } catch (err) {
      errors.push({ id, error: String(err) });
      return { id, detail: null };
    }
  });

  const toWrite = details.filter((d) => d.detail);
  for (let i = 0; i < toWrite.length; i += 499) {
    const batch = db.batch();
    for (const { id, detail } of toWrite.slice(i, i + 499)) {
      const ref = db.collection("cobranzas").doc(String(id));
      batch.set(ref, buildCobranzaDoc(id, detail), { merge: true });
    }
    await batch.commit();
  }

  // Detecta cobranzas que borraron directamente en Contabilium (ej. un
  // recibo cargado por error): si ya las teníamos sincronizadas para este
  // mismo rango de fechas y ya no aparecen en la lista fresca, puede ser
  // que se hayan borrado de verdad — o puede ser el bug conocido de
  // /cobranzas/search (pierde registros silenciosamente cuando hay muchas
  // con la misma fecha). Por eso NUNCA se borra solo por faltar en la
  // lista: se confirma primero con /cobranzas/{id} 1 por 1 antes de tocar
  // Firestore, para no perder datos reales por ese bug de paginación.
  const idsVivos = new Set(list.map((item) => String(item.ID ?? item.Id)));
  const existentesSnap = await db.collection("cobranzas")
    .where("fecha", ">=", desde)
    .where("fecha", "<=", `${hasta}T23:59:59`)
    .get();
  const candidatasABorrar = existentesSnap.docs.filter((d) => !idsVivos.has(d.id));
  const eliminadas = [];
  for (const d of candidatasABorrar) {
    try {
      const sigueExistiendo = await getCobranzaById(email, apiKey, d.id);
      if (!sigueExistiendo) {
        await d.ref.delete();
        eliminadas.push(d.id);
      }
    } catch (err) {
      console.error(`[cobranzas] no se pudo confirmar borrado de ${d.id}:`, err);
    }
  }

  await db.doc("meta/cobranzasSync").set({
    lastSync: admin.firestore.FieldValue.serverTimestamp(),
    total:    list.length,
    synced:   toWrite.length,
    eliminadas: eliminadas.length,
    errors,
  });

  return { total: list.length, synced: toWrite.length, eliminadas, errors };
}

exports.syncCobranzasDaily = onSchedule(
  {
    // Antes corría una vez al día — eso dejaba el saldo de cuenta corriente
    // desactualizado por horas/días (ej. cobranzas de hoy no reflejadas).
    // Ahora corre cada 15 min, incremental (solo último mes), para que el
    // saldo mostrado en Mi Cuenta/Clientes 360 esté al día casi en tiempo real.
    schedule: "every 15 minutes",
    secrets:  [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 300,
  },
  async () => {
    try {
      const d = new Date();
      d.setDate(d.getDate() - 31);
      const result = await doContabiliumCobranzasSync(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        { fechaDesde: d.toISOString().slice(0, 10) }
      );
      console.log("[cobranzas] sync incremental ok:", result);
    } catch (err) {
      console.error("[cobranzas] sync incremental error:", err);
    }
  }
);

// Movimientos reales de la cuenta de Mercado Pago (Fepa Top SAS) — trae los
// últimos pagos/cobros recibidos vía la API de pagos de MP, para la sección
// de Movimientos Bancarios. No requiere subir ningún extracto a mano.
exports.getMercadoPagoMovimientos = onRequest(
  { cors: false, invoker: "public", secrets: [MERCADOPAGO_ACCESS_TOKEN], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const token = MERCADOPAGO_ACCESS_TOKEN.value();
      const hoy = new Date();
      const hace30dias = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
      const begin = req.query.desde || hace30dias.toISOString().slice(0, 10);
      const end = req.query.hasta || hoy.toISOString().slice(0, 10);
      // Pagina hasta traer todo lo del rango (con un tope de seguridad) — un
      // solo pedido a MP trae máximo 50, y para rangos largos (90 días) un
      // dashboard con el total truncado en los primeros 50 sería engañoso.
      const results = [];
      let offset = 0;
      const MAX_PAGINAS = 10;
      for (let page = 0; page < MAX_PAGINAS; page++) {
        const params = new URLSearchParams({
          sort: "date_created",
          criteria: "desc",
          range: "date_created",
          begin_date: `${begin}T00:00:00.000-00:00`,
          end_date: `${end}T23:59:59.999-00:00`,
          limit: "50",
          offset: String(offset),
        });
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/search?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!mpRes.ok) {
          const detail = await mpRes.text().catch(() => "");
          throw new Error(`Mercado Pago respondió ${mpRes.status}: ${detail}`);
        }
        const data = await mpRes.json();
        const batch = data.results || [];
        results.push(...batch);
        offset += batch.length;
        if (batch.length < 50 || offset >= (data.paging?.total ?? offset)) break;
      }

      // Busca un nombre de persona en todos los lugares donde Mercado Pago
      // puede llegar a mandarlo — no todos los pagos traen el mismo campo
      // completo (transferencias entre cuentas MP, DEBIN, ventas de
      // Mercado Libre, etc. cada uno llena una parte distinta del payload).
      function nombrePagador(p) {
        const nombreCompleto = [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(" ");
        const bankPayer = p.point_of_interaction?.transaction_data?.bank_info?.payer;
        const bankNombre = bankPayer?.long_name || bankPayer?.account_holder_name || null;
        return (
          nombreCompleto ||
          bankNombre ||
          p.payer?.email ||
          p.payer?.identification?.number ||
          null
        );
      }

      const movimientos = results
        .filter((p) => p.status === "approved")
        .map((p) => ({
          id: p.id,
          fecha: p.date_approved || p.date_created,
          monto: p.transaction_amount,
          pagador: nombrePagador(p),
          descripcion: p.description || p.statement_descriptor || null,
          tipoOperacion: p.operation_type || null,
          metodo: p.payment_method_id || p.payment_type_id || null,
        }));
      return res.json({ movimientos, total: movimientos.length });
    } catch (err) {
      console.error("[mercadopago] getMercadoPagoMovimientos error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.triggerCobranzasSync = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const fechaDesde = req.query.desde ? String(req.query.desde) : undefined;
      const fechaHasta = req.query.hasta ? String(req.query.hasta) : undefined;
      const result = await doContabiliumCobranzasSync(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        { fechaDesde, fechaHasta }
      );
      return res.json(result);
    } catch (err) {
      console.error("[cobranzas] trigger error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Recalcula `importeReal` en las cobranzas ya guardadas en Firestore, sin
// volver a consultar Contabilium (usa `detalle`/`formasDePago` ya
// sincronizados). Uso puntual: correr una vez después de agregar el campo
// `importeReal` a doContabiliumCobranzasSync, para que las cobranzas
// sincronizadas antes de ese cambio también lo tengan.
exports.backfillImporteReal = onRequest(
  { cors: false, timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const db = admin.firestore();
      const snap = await db.collection("cobranzas").get();
      let updated = 0;
      let skipped = 0;
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 450) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + 450)) {
          const c = d.data();
          const formasDePago = c.formasDePago || [];
          const detalleArr = c.detalle || [];
          const esSoloSaldoAFavor = formasDePago.length > 0 &&
            formasDePago.every((f) => f.FormaDePago === "Saldo a favor");
          const importeReal = esSoloSaldoAFavor
            ? 0
            : detalleArr.length
            ? detalleArr.reduce((acc, x) => acc + Number(x.Importe || 0), 0)
            : Number(c.importeTotal || 0);
          if (c.importeReal !== undefined && Math.abs(c.importeReal - importeReal) < 0.01) {
            skipped++;
            continue;
          }
          batch.update(d.ref, { importeReal });
          updated++;
        }
        await batch.commit();
      }
      return res.json({ total: docs.length, updated, skipped });
    } catch (err) {
      console.error("[cobranzas] backfillImporteReal error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Sync manual desde el panel de admin
// ─────────────────────────────────────────────────────────────
exports.triggerContabiliumSync = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")    return res.status(405).json({ error: "Method Not Allowed" });

    try {
      const result = await doContabiliumSync(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value()
      );
      return res.json(result);
    } catch (err) {
      console.error("[contabilium] trigger error:", err);
      setCorsHeaders(req, res);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Vincula un usuario con su ficha de Contabilium y sincroniza IdListaPrecio
// ─────────────────────────────────────────────────────────────
exports.syncClientProfile = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")    return res.status(405).json({ error: "Method Not Allowed" });

    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: "uid requerido" });

    try {
      const db      = admin.firestore();
      const userRef = db.doc(`users/${uid}`);
      const snap    = await userRef.get();
      if (!snap.exists) return res.status(404).json({ error: "Usuario no encontrado" });

      const userData       = snap.data();
      const contabiliumId  = userData.contabiliumId;
      const cuit           = userData.cuit;

      if (!contabiliumId && !cuit) {
        return res.status(400).json({ error: "El usuario no tiene contabiliumId ni CUIT asignado" });
      }

      const email  = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      let client = null;
      if (contabiliumId) {
        client = await getClientById(email, apiKey, contabiliumId);
      }
      if (!client && cuit) {
        client = await searchClientByDoc(email, apiKey, cuit);
      }

      if (!client) {
        return res.status(404).json({ error: "Cliente no encontrado en Contabilium" });
      }

      const patch = {
        contabiliumId:    client.Id,
        idListaPrecio:    client.IdListaPrecio ?? null,
        condicionIva:     client.CondicionIva  ?? null,
        contabiliumEmail: client.Email || null,
        contabiliumSync:  admin.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.update(patch);

      return res.json({ ok: true, contabiliumId: client.Id, idListaPrecio: client.IdListaPrecio });
    } catch (err) {
      console.error("[contabilium] syncClientProfile error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Reconstruye el saldo real de cuenta corriente de un cliente: suma el
// Total firmado de TODOS sus comprobantes (FCA/NDA/COT suman, NCA ya viene
// negativo) y resta sus cobranzas reales (sincronizadas en Firestore desde
// Contabilium). Verificado contra el export oficial de "Cuenta corriente"
// de Contabilium — cierra exacto siempre que Firestore tenga las cobranzas
// al día (por eso syncCobranzasDaily corre cada 15 min).
// A diferencia de sumar el campo Saldo de cada comprobante, no depende de
// que Contabilium haya actualizado ese campo cuando el pago se aplicó como
// "saldo a favor" en vez de cobro directo.
async function computeSaldoTotal(db, contabiliumId, rawComprobantes) {
  const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));
  const sumaComprobantes = rawComprobantes.reduce((acc, c) => acc + parseAr(c.ImporteTotalNeto), 0);

  const cobranzasSnap = await db.collection("cobranzas").where("idPersona", "==", contabiliumId).get();
  const sumaCobranzas = cobranzasSnap.docs.reduce((acc, d) => {
    const data = d.data();
    // Cobranzas cargadas desde el export general "Cobranzas realizadas" (no
    // desde /cobranzas/{id} en vivo) pueden estar reversadas/reimputadas del
    // lado de Contabilium y ya no aplicar al saldo real — se muestran en
    // Clientes 360 como historial informativo, pero no descuentan acá.
    if (data.excluirDeSaldo) return acc;
    return acc + Number(data.importeReal ?? data.importeTotal ?? 0);
  }, 0);

  return sumaComprobantes - sumaCobranzas;
}

// ─────────────────────────────────────────────────────────────
// Devuelve los comprobantes (FCA, NCA, NDA) del cliente autenticado
// Requiere: Authorization: Bearer <Firebase ID token>
// ─────────────────────────────────────────────────────────────
exports.getClientComprobantes = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const db = admin.firestore();
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });

      const { contabiliumId } = userSnap.data();
      if (!contabiliumId) return res.status(400).json({ error: "Usuario sin vinculación Contabilium" });

      const { tipos, desde, hasta } = req.body || {};

      // Traemos siempre el set completo (incluye COT) para que el saldo
      // total salga bien, y filtramos para mostrar según lo pedido.
      const rawItemsFull = await getComprobantesByClientId(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        contabiliumId,
        { tipos: ["FCA", "NCA", "NDA", "COT"], desde, hasta }
      );
      const tiposMostrar = tipos && tipos.length ? tipos : ["FCA", "NCA", "NDA"];
      const rawItems = rawItemsFull.filter((c) => tiposMostrar.includes(c.TipoFc));

      // Contabilium devuelve TipoFc/FechaEmision/ImporteTotalNeto/Saldo (los
      // dos últimos como texto en formato argentino, ej. "1.460.000,00").
      // El front espera Tipo/Fecha/Total/Saldo ya como valores usables.
      // Ojo: Contabilium siempre devuelve Saldo en positivo aunque sea una
      // Nota de Crédito (NCA) — hay que restarla, no sumarla, para que la
      // cuenta corriente cierre igual que en Contabilium.
      const items = rawItems.map((c) => {
        const saldoAbs = parseArNumber(c.Saldo);
        return {
          ...c,
          Tipo:  c.TipoFc,
          Fecha: c.FechaEmision,
          Total: parseArNumber(c.ImporteTotalNeto),
          Saldo: c.TipoFc === "NCA" ? -saldoAbs : saldoAbs,
        };
      });

      const saldoTotal = await computeSaldoTotal(db, contabiliumId, rawItemsFull);

      return res.json({ items, total: items.length, saldoTotal });
    } catch (err) {
      console.error("[contabilium] getClientComprobantes error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Devuelve el detalle completo de un comprobante (para generar PDF)
// Requiere: Authorization: Bearer <Firebase ID token>
// El comprobante debe pertenecer al cliente autenticado
// ─────────────────────────────────────────────────────────────
exports.getComprobanteDetail = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id de comprobante requerido" });

    try {
      const db = admin.firestore();
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });

      const { contabiliumId } = userSnap.data();
      if (!contabiliumId) return res.status(400).json({ error: "Usuario sin vinculación Contabilium" });

      const comprobante = await getComprobanteById(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        id
      );

      if (!comprobante) return res.status(404).json({ error: "Comprobante no encontrado" });

      // Verificamos que el comprobante pertenece al cliente que hace el pedido
      if (comprobante.IdCliente !== contabiliumId) {
        return res.status(403).json({ error: "Acceso denegado" });
      }

      return res.json(comprobante);
    } catch (err) {
      console.error("[contabilium] getComprobanteDetail error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ═════════════════════════════════════════════════════════════
// M5 — Notificación de pedidos
// Al crear una orden se genera una notificación para el admin con
// los datos del cliente ya listos para la carga manual en Contabilium
// (POST /comprobantes no está disponible en la API v1).
// ═════════════════════════════════════════════════════════════
exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const order   = snap.data() || {};
  const orderId = event.params.orderId;
  const db      = admin.firestore();

  try {
    const customer = order.customer || {};

    // Si el cliente está vinculado a Contabilium, adjuntamos los datos
    // necesarios para que el admin cargue el comprobante sin buscarlos.
    let contabilium = null;
    if (customer.uid) {
      const userSnap = await db.doc(`users/${customer.uid}`).get();
      if (userSnap.exists) {
        const u = userSnap.data() || {};
        contabilium = {
          contabiliumId: u.contabiliumId ?? null,
          idListaPrecio: u.idListaPrecio ?? null,
          condicionIva:  u.condicionIva  ?? null,
          cuit:          u.cuit ?? customer.cuit ?? null,
        };
      }
    }

    const rawItems = Array.isArray(order.items) ? order.items.slice(0, 50) : [];
    const skuById = {};
    await Promise.all(
      rawItems
        .filter((it) => it.id)
        .map(async (it) => {
          if (skuById[it.id] !== undefined) return;
          const productSnap = await db.doc(`products/${it.id}`).get();
          skuById[it.id] = productSnap.exists ? (productSnap.data().sku ?? null) : null;
        })
    );

    const items = rawItems.map((it) => ({
      id:    it.id ?? null,
      name:  it.name ?? "",
      sku:   skuById[it.id] ?? null,
      qty:   Number(it.qty ?? 0),
      price: Number(it.price ?? 0),
    }));

    await db.collection("notifications").add({
      type:          "order",
      orderId,
      orderStatus:   order.status || "pendiente",
      customerName:  customer.name  || "Cliente sin nombre",
      customerEmail: customer.email || null,
      customerPhone: customer.phone || null,
      customerCuit:  customer.cuit  || (contabilium && contabilium.cuit) || null,
      customerNotes: customer.notes || null,
      total:         Number(order.total ?? 0),
      itemsCount:    items.length,
      items,
      contabilium,
      read:          false,
      attended:      false,
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[notify] notificación creada para orden #${orderId}`);
  } catch (err) {
    console.error("[notify] onOrderCreated error:", err);
  }
});

// ═════════════════════════════════════════════════════════════
// M6 — Sincronización de estados (Pendiente → Facturado → Pagado)
// Cada 5 minutos cotejamos las órdenes abiertas contra los
// comprobantes (FCA) del cliente en Contabilium.
// ═════════════════════════════════════════════════════════════
const SYNC_STATUSES = ["pendiente", "facturado"];

function tsToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normNumero(value) {
  return String(value ?? "").replace(/\D/g, "");
}

// Contabilium devuelve los importes como texto en formato AR ("1.580.000,00").
function parseArNumber(value) {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

// Estado de la orden a partir del saldo del comprobante vinculado
function statusFromComprobante(comprobante) {
  if (!comprobante) return null;
  return parseArNumber(comprobante.Saldo) <= 0 ? "pagada" : "facturado";
}

async function doOrderStatusSync(email, apiKey) {
  const db = admin.firestore();

  const ordersSnap = await db
    .collection("orders")
    .where("status", "in", SYNC_STATUSES)
    .limit(500)
    .get();

  // Agrupamos por cliente de Contabilium para pedir sus comprobantes una sola vez.
  // groups: contabiliumId -> { earliest: Date, orders: [{ ref, id, data }] }
  const groups = new Map();
  const userCache = new Map();

  for (const docSnap of ordersSnap.docs) {
    const data = docSnap.data() || {};
    const uid = data.customer && data.customer.uid;
    if (!uid) continue;

    let contabiliumId = null;
    if (userCache.has(uid)) {
      contabiliumId = userCache.get(uid);
    } else {
      const userSnap = await db.doc(`users/${uid}`).get();
      contabiliumId = userSnap.exists ? (userSnap.data().contabiliumId ?? null) : null;
      userCache.set(uid, contabiliumId);
    }
    if (!contabiliumId) continue;

    const createdAt = tsToDate(data.createdAt) || new Date();
    if (!groups.has(contabiliumId)) {
      groups.set(contabiliumId, { earliest: createdAt, orders: [] });
    }
    const group = groups.get(contabiliumId);
    if (createdAt < group.earliest) group.earliest = createdAt;
    group.orders.push({ ref: docSnap.ref, id: docSnap.id, data });
  }

  const updates = [];
  const errors = [];

  for (const [contabiliumId, group] of groups) {
    let comprobantes = [];
    try {
      // Pequeño margen hacia atrás por diferencias de huso/fecha de carga
      const desde = new Date(group.earliest);
      desde.setDate(desde.getDate() - 1);
      comprobantes = await getComprobantesByClientId(email, apiKey, contabiliumId, {
        tipos: ["FCA"],
        desde: desde.toISOString().slice(0, 10),
      });
    } catch (err) {
      errors.push(`cliente ${contabiliumId}: ${String(err)}`);
      continue;
    }

    const usados = new Set(); // evita vincular un mismo comprobante a dos órdenes

    for (const order of group.orders) {
      const data = order.data;
      let matched = null;

      // 1) Comprobante vinculado manualmente por número
      const linkedNumero = normNumero(data.contabiliumComprobanteNumero);
      if (linkedNumero) {
        matched = comprobantes.find((c) => normNumero(c.Numero) === linkedNumero) || null;
      }
      // 2) Comprobante vinculado por Id interno
      if (!matched && data.contabiliumComprobanteId) {
        matched = comprobantes.find((c) => c.Id === data.contabiliumComprobanteId) || null;
      }
      // 3) Auto-match por total + fecha (mejor esfuerzo)
      if (!matched) {
        const orderTotal = Number(data.total ?? 0);
        const orderDate  = tsToDate(data.createdAt);
        if (orderTotal > 0) {
          const tol = Math.max(1, orderTotal * 0.01);
          matched = comprobantes.find((c) => {
            if (usados.has(c.Id)) return false;
            if (Math.abs(parseArNumber(c.ImporteTotalNeto) - orderTotal) > tol) return false;
            if (orderDate && c.FechaEmision) {
              const cFecha = new Date(c.FechaEmision.includes("T") ? c.FechaEmision : c.FechaEmision + "T00:00:00");
              const grace  = new Date(orderDate);
              grace.setDate(grace.getDate() - 1);
              if (cFecha < grace) return false;
            }
            return true;
          }) || null;
        }
      }

      if (!matched) continue;
      usados.add(matched.Id);

      const newStatus = statusFromComprobante(matched);
      const patch = {};

      // Vinculación (si todavía no estaba registrada)
      if (data.contabiliumComprobanteId !== matched.Id) {
        patch.contabiliumComprobanteId = matched.Id;
        patch.contabiliumComprobanteNumero = matched.Numero || String(matched.Id);
      }

      if (newStatus && newStatus !== data.status) {
        patch.status = newStatus;
        if (newStatus === "facturado" && !data.facturadoAt) {
          patch.facturadoAt = admin.firestore.FieldValue.serverTimestamp();
        }
        if (newStatus === "pagada") {
          if (!data.facturadoAt) patch.facturadoAt = admin.firestore.FieldValue.serverTimestamp();
          patch.paidAt = admin.firestore.FieldValue.serverTimestamp();
        }
      }

      if (Object.keys(patch).length === 0) continue;
      patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      updates.push({ ref: order.ref, patch });
    }
  }

  for (let i = 0; i < updates.length; i += 499) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 499)) batch.update(u.ref, u.patch);
    await batch.commit();
  }

  await db.doc("meta/orderStatusSync").set({
    lastSync: admin.firestore.FieldValue.serverTimestamp(),
    checked:  ordersSnap.size,
    updated:  updates.length,
    errors,
  });

  return { checked: ordersSnap.size, updated: updates.length, errors };
}

exports.syncOrderStatuses = onSchedule(
  {
    schedule: "every 5 minutes",
    secrets:  [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
  },
  async () => {
    try {
      const result = await doOrderStatusSync(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value()
      );
      console.log("[orders] sync ok:", result);
    } catch (err) {
      console.error("[orders] sync error:", err);
      await admin.firestore().doc("meta/orderStatusSync").set(
        { errors: [String(err)], lastSync: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
  }
);

exports.triggerOrderStatusSync = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")    return res.status(405).json({ error: "Method Not Allowed" });

    try {
      const result = await doOrderStatusSync(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value()
      );
      return res.json(result);
    } catch (err) {
      console.error("[orders] trigger error:", err);
      setCorsHeaders(req, res);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
exports.approveAndInviteUser = onRequest(
  { cors: false },
  async (req, res) => {
    try {
      setCorsHeaders(req, res);

      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
      }

      const { userDocId } = req.body || {};
      if (!userDocId) {
        return res.status(400).json({ error: "userDocId requerido" });
      }

      const tempRef = admin.firestore().doc(`users/${userDocId}`);
      const snap = await tempRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const u = snap.data();
      const email = String(u.email || u.emailLower || "").toLowerCase();
      const name = u.name || "";

      let authUser;
      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch {
        authUser = await admin.auth().createUser({ email, displayName: name });
      }
      const uid = authUser.uid;

      const finalRef = admin.firestore().doc(`users/${uid}`);
      await finalRef.set(
        {
          ...u,
          uid,
          approved: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (userDocId !== uid) await tempRef.delete();

      const link = await admin.auth().generatePasswordResetLink(email, {
        url: `${SITE_URL}/login`,
        handleCodeInApp: false,
      });

      return res.json({ uid, link });
    } catch (err) {
      console.error(err);
      setCorsHeaders(req, res);
      return res.status(500).json({ error: String(err) });
    }
  }
);

function slugifyUsername(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "usuario";
}

async function requireStaff(req, res) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: "No autorizado" });
    return null;
  }
  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(idToken)).uid;
  } catch {
    res.status(401).json({ error: "Token inválido" });
    return null;
  }
  const db = admin.firestore();
  const callerSnap = await db.doc(`users/${uid}`).get();
  const staffRoles = ["admin"];
  if (!callerSnap.exists || !staffRoles.includes(callerSnap.data().role)) {
    res.status(403).json({ error: "Acceso denegado" });
    return null;
  }
  return uid;
}

// Crea un usuario interno con nombre + contraseña, sin pedir email real.
// Genera un email interno (invisible para el usuario) para satisfacer a Firebase Auth.
// Crea la cuenta de Samurai (Auth + Firestore) para un cliente que ya existe
// en Contabilium con ficha + depósito. Devuelve {uid, username}. Lanza si ya
// hay una cuenta vinculada a ese contabiliumId (evita duplicados).
async function crearCuentaClienteVinculada(db, { name, password, contabiliumId, cuit, condicionIva, depositoId, depositoNombre, contactEmail }) {
  const yaVinculado = await db.collection("users").where("contabiliumId", "==", contabiliumId).limit(1).get();
  if (!yaVinculado.empty) {
    throw new Error("Ese cliente de Contabilium ya está vinculado a otra cuenta.");
  }

  const base = slugifyUsername(name);
  let username = base;
  let n = 1;
  while (true) {
    const existing = await db.collection("users").where("usernameLower", "==", username).limit(1).get();
    if (existing.empty) break;
    n += 1;
    username = `${base}-${n}`;
  }

  const email = `${username}@samurai.internal`;
  const authUser = await admin.auth().createUser({ email, password, displayName: name.trim() });

  await db.doc(`users/${authUser.uid}`).set({
    uid: authUser.uid,
    name: name.trim(),
    username,
    usernameLower: username,
    email,
    emailLower: email,
    contactEmail: contactEmail || null,
    role: "viewer",
    status: "activo",
    approved: true,
    kind: "client",
    contabiliumId,
    cuit: cuit || null,
    condicionIva: condicionIva || null,
    contabiliumDepositoId: depositoId || null,
    contabiliumDepositoNombre: depositoNombre || null,
    autoVinculado: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: authUser.uid, username };
}

// Crea la ficha de Cliente en Contabilium a partir del padrón real de AFIP
// (mismo campo CategoriaImpositiva/Personeria/Domicilio que devuelve
// getDatosAfip) — para depósitos consignados que nunca tuvieron cliente
// cargado. El teléfono no viene de AFIP, se pasa aparte.
exports.adminCrearClienteContabilium = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { documento, telefono, email } = req.body || {};
      if (!documento) return res.status(400).json({ error: "documento (CUIT) requerido" });

      const contabiliumEmail = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const afip = await getDatosAfip(contabiliumEmail, apiKey, documento);
      if (!afip || !afip.RazonSocial) {
        return res.status(404).json({ error: "AFIP no devolvió datos para ese CUIT" });
      }

      const payload = {
        RazonSocial: afip.RazonSocial,
        NombreFantasia: afip.RazonSocial,
        CondicionIva: afip.CategoriaImpositiva || "CF",
        TipoDoc: afip.TipoDoc || "CUIT",
        NroDoc: afip.NroDoc || String(documento).replace(/\D/g, ""),
        Pais: "Argentina",
        Provincia: afip.ProvinciaNombre || "",
        Ciudad: afip.CiudadNombre || "",
        Domicilio: afip.Domicilio || "",
        PisoDepto: afip.PisoDto || "",
        Cp: afip.CodigoPostal || "",
        Telefono: telefono || "",
        Email: email || "",
        Personeria: afip.Personeria || "F",
      };

      const result = await crearCliente(contabiliumEmail, apiKey, payload);
      return res.json({ ok: true, payload, result });
    } catch (err) {
      console.error("[adminCrearClienteContabilium] error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Busca clientes en Contabilium por nombre (razón social) — para cuando hay
// que dar de alta en Samurai a alguien que ya existe en Contabilium con
// depósito, pero todavía no tiene cuenta acá (el alta no es automática).
exports.adminSearchContabiliumClientes = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "Falta ?q=" });
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const candidatos = await searchClientesByFiltro(email, apiKey, q);

      const rollupSnap = await admin.firestore().doc("meta/consignedRollupDetail").get();
      const porDeposito = rollupSnap.exists ? (rollupSnap.data().porDeposito || []) : [];
      const depositoPorNombre = new Map(porDeposito.map((d) => [(d.nombre || "").trim().toUpperCase(), d]));

      const usersSnap = await admin.firestore().collection("users").where("kind", "==", "client").get();
      const vinculadoPorContabiliumId = new Set(usersSnap.docs.map((d) => d.data().contabiliumId).filter(Boolean));

      const resultados = candidatos.map((c) => {
        const dep = depositoPorNombre.get((c.RazonSocial || "").trim().toUpperCase());
        return {
          contabiliumId: c.Id,
          razonSocial: c.RazonSocial,
          cuit: c.NroDoc || null,
          condicionIva: c.CondicionIva || null,
          email: c.Email || null,
          telefono: c.Telefono || c.Celular || null,
          depositoId: dep ? dep.id : null,
          depositoNombre: dep ? dep.nombre : null,
          bicicletasConsignadas: dep ? dep.bicicletas : null,
          yaVinculado: vinculadoPorContabiliumId.has(c.Id),
        };
      });
      return res.json({ total: resultados.length, resultados });
    } catch (err) {
      console.error("[adminSearchContabiliumClientes] error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Da de alta un cliente en Samurai (Auth + Firestore) ya vinculado a un
// cliente/depósito existente en Contabilium — para distribuidores que
// compraron/tienen consignación pero nunca se registraron solos en la web.
exports.adminCrearClienteVinculado = onRequest(
  { cors: false, invoker: "public" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { name, password, contabiliumId, cuit, condicionIva, depositoId, depositoNombre, contactEmail } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Nombre requerido" });
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }
      if (!contabiliumId) return res.status(400).json({ error: "contabiliumId requerido" });

      const db = admin.firestore();
      const result = await crearCuentaClienteVinculada(db, {
        name, password, contabiliumId, cuit, condicionIva, depositoId, depositoNombre, contactEmail,
      });
      return res.json(result);
    } catch (err) {
      console.error("[adminCrearClienteVinculado] error:", err);
      const code = err?.errorInfo?.code || err?.code || "";
      if (code.includes("email-already-exists") || String(err).includes("ya está vinculado")) {
        return res.status(409).json({ error: err.message || "Ya existe un usuario con ese nombre, probá con otro." });
      }
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Vinculación automática: cada 1 hora, trae TODOS los clientes de
// Contabilium + la lista de depósitos, cruza por nombre exacto (mismo
// criterio que adminLinkDepositoClientes), y para cada match que tenga
// ficha de cliente + depósito y todavía no tenga cuenta en Samurai, la crea
// sola (contraseña por defecto — el staff se la puede cambiar/compartir
// después). Se pidió así explícitamente: 100% automático, sin aprobación
// manual, porque un depósito nuevo sin cuenta vinculada quedaba invisible
// para el resto del sistema (reportes, dashboard, etc.) hasta que alguien
// se acordaba de vincularlo a mano.
const AUTO_LINK_PASSWORD_DEFAULT = "Samurai2026";

async function computeAutoLinkClientes(db, email, apiKey) {
  const depositosResult = await computeDepositosSync(email, apiKey);
  const depositosSnap = await db.doc("internalData/contabiliumDepositos").get();
  const depositos = depositosSnap.data().depositos || [];

  const clientes = await getAllClientes(email, apiKey);
  const clientePorNombre = new Map(clientes.map((c) => [(c.RazonSocial || "").trim().toUpperCase(), c]));

  const usersSnap = await db.collection("users").where("kind", "==", "client").get();
  const vinculadoPorContabiliumId = new Set(usersSnap.docs.map((d) => d.data().contabiliumId).filter(Boolean));

  const creados = [];
  const errores = [];
  let sinFichaCliente = 0;
  let yaVinculados = 0;

  for (const dep of depositos) {
    const nombreDep = (dep.nombre || "").trim().toUpperCase();
    if (!nombreDep) continue;
    const cliente = clientePorNombre.get(nombreDep);
    if (!cliente) {
      sinFichaCliente++;
      continue;
    }
    if (vinculadoPorContabiliumId.has(cliente.Id)) {
      yaVinculados++;
      continue;
    }
    try {
      const { uid, username } = await crearCuentaClienteVinculada(db, {
        name: cliente.RazonSocial || dep.nombre,
        password: AUTO_LINK_PASSWORD_DEFAULT,
        contabiliumId: cliente.Id,
        cuit: cliente.NroDoc || null,
        condicionIva: cliente.CondicionIva || null,
        depositoId: dep.id,
        depositoNombre: dep.nombre,
        contactEmail: cliente.Email || null,
      });
      await db.doc(`users/${uid}`).update({ autoVinculado: true });
      creados.push({ uid, username, nombre: cliente.RazonSocial, contabiliumId: cliente.Id, depositoId: dep.id });
      vinculadoPorContabiliumId.add(cliente.Id);
    } catch (err) {
      errores.push({ nombre: cliente.RazonSocial, contabiliumId: cliente.Id, error: String(err) });
    }
  }

  const result = {
    totalDepositos: depositosResult.count,
    totalClientesContabilium: clientes.length,
    creados,
    creadosCount: creados.length,
    yaVinculados,
    sinFichaCliente,
    errores,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.doc("meta/autoLinkClientesLog").set(result);
  return result;
}

exports.syncAutoLinkClientes = onSchedule(
  {
    schedule: "every 1 hours",
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await computeAutoLinkClientes(admin.firestore(), CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      console.log("[autoLinkClientes] ok — creados:", result.creadosCount, "ya vinculados:", result.yaVinculados, "sin ficha:", result.sinFichaCliente);
    } catch (err) {
      console.error("[autoLinkClientes] error:", err);
    }
  }
);

// Refresco manual desde el panel (staff-only) — para probar el auto-link sin
// esperar la corrida horaria.
exports.triggerAutoLinkClientes = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await computeAutoLinkClientes(admin.firestore(), CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      console.error("[triggerAutoLinkClientes] error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.createUserWithPassword = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { name, password } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Nombre requerido" });
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }

      const db = admin.firestore();
      const base = slugifyUsername(name);
      let username = base;
      let n = 1;
      while (true) {
        const existing = await db.collection("users").where("usernameLower", "==", username).limit(1).get();
        if (existing.empty) break;
        n += 1;
        username = `${base}-${n}`;
      }

      const email = `${username}@samurai.internal`;
      const authUser = await admin.auth().createUser({
        email,
        password,
        displayName: name.trim(),
      });

      await db.doc(`users/${authUser.uid}`).set({
        uid: authUser.uid,
        name: name.trim(),
        username,
        usernameLower: username,
        email,
        emailLower: email,
        role: "viewer",
        status: "activo",
        approved: true,
        kind: "client",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ uid: authUser.uid, username });
    } catch (err) {
      console.error("[users] createUserWithPassword error:", err);
      const code = err?.errorInfo?.code || err?.code || "";
      if (code.includes("email-already-exists")) {
        return res.status(409).json({ error: "Ya existe un usuario con ese nombre, probá con otro." });
      }
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Dado un nombre de usuario, devuelve el email interno asociado para poder
// iniciar sesión con signInWithEmailAndPassword en el cliente.
exports.resolveLoginEmail = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
      const { username } = req.body || {};
      const normalized = String(username || "").trim().toLowerCase();
      if (!normalized) return res.status(400).json({ error: "Usuario requerido" });

      const db = admin.firestore();
      const snap = await db.collection("users").where("usernameLower", "==", normalized).limit(1).get();
      if (snap.empty) return res.status(404).json({ error: "No encontramos ese usuario" });

      return res.json({ email: snap.docs[0].data().email });
    } catch (err) {
      console.error("[users] resolveLoginEmail error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Cambia la contraseña de un usuario existente (solo staff).
exports.adminSetUserPassword = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { uid, password } = req.body || {};
      if (!uid) return res.status(400).json({ error: "uid requerido" });
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }
      await admin.auth().updateUser(uid, { password });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[users] adminSetUserPassword error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Arma la lista final de stock de un depósito: el nombre y precio salen
// catálogo de productos de Samurai (por sku). Solo se muestran productos
// que ya existen en el catálogo, con su nombre e imagen tal cual están ahí.
async function buildDepositoStockItems(db, email, apiKey, stockItems, opts = {}) {
  const { includeZeroStock = false, pendingSoldBySku = {} } = opts;
  const stockMap = {};
  for (const item of stockItems) {
    const code = (item.Codigo || "").trim();
    if (code) stockMap[code] = {
      stockActual: Number(item.StockActual || 0),
      stockDisponible: Number(item.StockConReservas ?? item.StockActual ?? 0),
    };
  }

  // El stock sale en vivo de Contabilium, pero mientras una venta reportada
  // todavía no se facturó ahí (status "pendiente" en saleRequests), la
  // restamos acá para que no siga apareciendo disponible — evita que el
  // distribuidor la reporte de nuevo pensando que no se guardó. Cuando se
  // factura en Contabilium, el stock real baja solo y esta resta deja de
  // aplicarse (el saleRequest ya no está "pendiente").
  const productsSnap = await db.collection("products").where("active", "==", true).get();
  const items = [];
  for (const docSnap of productsSnap.docs) {
    const p = docSnap.data();
    const skuStr = (p.sku || "").toString().trim();
    if (!skuStr) continue;
    const { stockActual, stockDisponible: stockDisponibleReal } = stockMap[skuStr] || { stockActual: 0, stockDisponible: 0 };
    const pendiente = pendingSoldBySku[skuStr] || 0;
    const stockDisponible = Math.max(0, stockDisponibleReal - pendiente);
    if (!includeZeroStock && stockActual <= 0 && stockDisponibleReal <= 0) continue;
    items.push({
      id: docSnap.id,
      name: p.name || "",
      sku: skuStr,
      category: p.category || null,
      description: p.description || "",
      imageUrl: p.imageUrl || (p.images && p.images[0]) || "",
      images: p.images || [],
      priceArs: typeof p.priceArs === "number" ? p.priceArs : null,
      stockActual,
      stockDisponible,
      // Unidades de este modelo ya reportadas como vendidas por el
      // distribuidor pero todavía sin facturar en Contabilium (se muestran
      // en gris al lado del disponible, no se suman a "stockDisponible").
      pendienteVenta: pendiente,
    });
  }
  return items;
}

// Suma, por SKU, la cantidad reportada como vendida y todavía no facturada
// para un distribuidor (por uid) o depósito puntual (para descontarla del
// stock disponible que se muestra).
async function getPendingSoldBySku(db, { distributorUid, depositoId } = {}) {
  let q = db.collection("saleRequests").where("status", "==", "pendiente");
  q = distributorUid ? q.where("distributorUid", "==", distributorUid) : q.where("depositoId", "==", depositoId);
  const snap = await q.get();
  const bySku = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    const sku = (data.sku || "").toString().trim();
    if (!sku) return;
    bySku[sku] = (bySku[sku] || 0) + Number(data.quantity || 0);
  });
  return bySku;
}

// ─────────────────────────────────────────────────────────────
// M7 — Stock consignado por depósito
// Devuelve el stock real (Contabilium) del depósito asignado al
// cliente autenticado, cruzado con el catálogo de productos por SKU.
// Requiere: Authorization: Bearer <Firebase ID token>
// ─────────────────────────────────────────────────────────────
exports.getMyDepositoStock = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const db = admin.firestore();
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });

      const { contabiliumDepositoId, contabiliumDepositoNombre } = userSnap.data();
      if (!contabiliumDepositoId) {
        return res.status(400).json({ error: "Usuario sin depósito consignado asignado" });
      }

      const email  = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const stockItems = await getStockByDepositoWithRetry(email, apiKey, contabiliumDepositoId);
      const pendingSoldBySku = await getPendingSoldBySku(db, { distributorUid: uid });
      const items = await buildDepositoStockItems(db, email, apiKey, stockItems, { pendingSoldBySku });

      return res.json({
        depositoId: contabiliumDepositoId,
        depositoNombre: contabiliumDepositoNombre || null,
        items,
      });
    } catch (err) {
      console.error("[contabilium] getMyDepositoStock error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// M7b — Stock consignado por depósito, consultado por un admin
// (para ver el stock de cualquier cliente sin que él tenga que loguearse).
// Requiere: Authorization: Bearer <Firebase ID token> de un usuario staff.
// Body: { depositoId: number }
// Datos de contacto (teléfono) de un cliente puntual, para Clientes 360.
// Se pide uno por uno (al abrir la ficha), nunca para toda la lista de
// golpe — Contabilium rate-limita fuerte con muchos pedidos seguidos.
// Detalle (ítems/modelo de bicicleta) de una factura puntual — para
// Clientes 360, donde el admin puede necesitar ver qué se facturó en
// cualquier comprobante de cualquier cliente. Se pide uno por uno (al
// expandir una factura), nunca para todo el historial de golpe.
exports.adminGetComprobanteDetail = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id de comprobante requerido" });
      const comprobante = await getComprobanteById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), id);
      if (!comprobante) return res.status(404).json({ error: "Comprobante no encontrado" });
      return res.json(comprobante);
    } catch (err) {
      console.error("[contabilium] adminGetComprobanteDetail error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Verifica contra el padrón real de AFIP (vía la propia integración de
// Contabilium, sin certificado propio) la condición IVA de un cliente antes
// de facturar — para no depender de que el dato cargado en Contabilium esté
// al día y evitar el error "Condicion IVA receptor no valido" al emitir.
exports.verificarCondicionAfip = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { documento } = req.body || {};
      if (!documento) return res.status(400).json({ error: "documento requerido" });
      const { getDatosAfip } = require("./contabiliumService");
      const datos = await getDatosAfip(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), documento);
      return res.json({
        categoriaImpositiva: datos?.CategoriaImpositiva ?? null,
        categoriaMonotributo: datos?.CategoriaMonotributo ?? null,
        razonSocial: datos?.RazonSocial ?? null,
      });
    } catch (err) {
      console.error("[contabilium] verificarCondicionAfip error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Asigna un vendedor a un cliente: guarda el campo en Firestore, y si el
// cliente tiene ficha en Contabilium, también lo deja visible ahí en
// "Observaciones" (Contabilium no tiene un campo nativo de vendedor por
// cliente, solo IDVendedor por factura — que apunta al usuario que factura,
// no al vendedor real). Reemplaza solo la línea "Vendedor: ..." si ya
// existía, para no pisar otras notas que haya cargadas en ese campo.
exports.adminAsignarVendedor = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { uid, vendedor } = req.body || {};
      if (!uid) return res.status(400).json({ error: "uid requerido" });

      const db = admin.firestore();
      const userRef = db.doc(`users/${uid}`);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ error: "Cliente no encontrado" });
      const u = userSnap.data();

      await userRef.update({ vendedor: vendedor || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

      let contabiliumSync = false;
      if (u.contabiliumId) {
        try {
          const email = CONTABILIUM_EMAIL.value();
          const apiKey = CONTABILIUM_API_KEY.value();
          const cliente = await getClientById(email, apiKey, u.contabiliumId);
          if (cliente) {
            const obsSinVendedor = (cliente.Observaciones || "").replace(/(^|\n)Vendedor:.*(?=\n|$)/g, "").trim();
            const nuevaObs = vendedor ? [obsSinVendedor, `Vendedor: ${vendedor}`].filter(Boolean).join("\n") : obsSinVendedor;
            await updateCliente(email, apiKey, u.contabiliumId, { ...cliente, Observaciones: nuevaObs });
            contabiliumSync = true;
          }
        } catch (err) {
          console.error("[adminAsignarVendedor] no se pudo sincronizar a Contabilium:", err);
        }
      }

      return res.json({ ok: true, contabiliumSync });
    } catch (err) {
      console.error("[adminAsignarVendedor] error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.adminGetClientPhone = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { contabiliumId } = req.body || {};
      if (!contabiliumId) return res.status(400).json({ error: "contabiliumId requerido" });
      const cliente = await getClientById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), contabiliumId);
      return res.json({ telefono: cliente?.Telefono || null });
    } catch (err) {
      console.error("[contabilium] adminGetClientPhone error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Facturas/saldo de CUALQUIER cliente (staff-only) — para el reporte
// "Clientes 360" del admin. Mismo mapeo de campos que getClientComprobantes.
exports.adminGetClientComprobantes = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { contabiliumId } = req.body || {};
      if (!contabiliumId) return res.status(400).json({ error: "contabiliumId requerido" });

      const rawItemsFull = await getComprobantesByClientId(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        contabiliumId,
        { tipos: ["FCA", "NCA", "NDA", "COT"] }
      );
      // Las Cotizaciones (COT) también se muestran — no son factura real
      // (sin CAE), pero durante años se usaron como registro de venta antes
      // de tener facturación electrónica, así que siguen contando como
      // deuda real de cuenta corriente y hay que poder verlas acá, no solo
      // en el cálculo agregado del saldo.
      const items = rawItemsFull.filter((c) => ["FCA", "NCA", "NDA", "COT"].includes(c.TipoFc)).map((c) => {
        const saldoAbs = parseArNumber(c.Saldo);
        return {
          ...c,
          Tipo:  c.TipoFc,
          Fecha: c.FechaEmision,
          Total: parseArNumber(c.ImporteTotalNeto),
          Saldo: c.TipoFc === "NCA" ? -saldoAbs : saldoAbs,
        };
      });

      const db = admin.firestore();
      const saldoTotal = await computeSaldoTotal(db, contabiliumId, rawItemsFull);

      return res.json({ items, total: items.length, saldoTotal });
    } catch (err) {
      console.error("[contabilium] adminGetClientComprobantes error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagComprobantesPaging = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await debugComprobantesPaging(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Diagnóstico: agrupa TODOS los comprobantes de la empresa por TipoFc, para
// confirmar qué código usa Contabilium para remitos (y cuántos hay).
exports.diagTiposComprobante = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const desde = req.query.desde ? String(req.query.desde) : undefined;
      const hasta = req.query.hasta ? String(req.query.hasta) : undefined;
      const all = await getAllComprobantes(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), { desde, hasta });
      const grupos = {};
      for (const c of all) {
        const tipo = c.TipoFc || "(sin tipo)";
        grupos[tipo] = (grupos[tipo] || 0) + 1;
      }
      return res.json({ total: all.length, porTipo: grupos });
    } catch (err) {
      console.error("[contabilium] diagTiposComprobante error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Suma la cantidad de bicicletas despachadas por remito (comprobantes de
// tipo REM), trayendo el detalle (Items) de cada uno.
exports.remitosBicicletasDespachadas = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const tipo = req.query.tipo ? String(req.query.tipo) : "REM";
      const desde = req.query.desde ? String(req.query.desde) : undefined;
      const hasta = req.query.hasta ? String(req.query.hasta) : undefined;

      const all = await getAllComprobantes(email, apiKey, { desde, hasta });
      const remitos = all.filter((c) => c.TipoFc === tipo);

      const detalles = await mapWithConcurrency(remitos, 5, async (r) => {
        try {
          const full = await getComprobanteById(email, apiKey, r.Id);
          const items = full?.Items || [];
          const cantidad = items.reduce((acc, it) => acc + Number(it.Cantidad || 0), 0);
          return { id: r.Id, numero: r.Numero, fecha: r.FechaEmision, cliente: r.RazonSocial, cantidad, items };
        } catch (err) {
          return { id: r.Id, numero: r.Numero, error: String(err) };
        }
      });

      const totalBicicletas = detalles.reduce((acc, d) => acc + (d.cantidad || 0), 0);
      return res.json({ totalRemitos: remitos.length, totalBicicletas, detalles });
    } catch (err) {
      console.error("[contabilium] remitosBicicletasDespachadas error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagProbeRemitosEndpoints = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await debugProbeRemitosEndpoints(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagProbeCrearComprobanteEndpoints = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await debugProbeCrearComprobanteEndpoints(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagProbeCrearComprobantePayload = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await debugProbeCrearComprobantePayload(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagProbeStockDescuento = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 90 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const depositoId = Number(req.query.depositoId || 133591); // WALTER ALBERTO MARCOS, ya lo vimos antes
      const result = await debugProbeStockDescuento(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), depositoId);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagClienteSearchRaw = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const cuit = String(req.query.cuit || "").trim();
      if (!cuit) return res.status(400).json({ error: "Falta ?cuit=" });
      const result = await debugClienteSearchRaw(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), cuit);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Diagnóstico puntual: por qué 3 CUITs distintos (Adán Pablo Benítez,
// Faustino Ochoa, Juan Manuel Blanco — todos "solicitud de alta" pendiente,
// nunca aprobados) quedaron los tres vinculados al mismo contabiliumId
// 114067200 vía adminLinkClientesByCuit. Prueba searchClientByDoc (la
// función real que usa ese linkeo) para cada uno, más quién es realmente
// el cliente 114067200.
// Lista de clientes vinculados, pero con el nombre TAL CUAL figura en
// Contabilium (RazonSocial real), no el que tenemos guardado en Samurai —
// para bajar los reportes de cuenta corriente buscando por el nombre
// correcto en Contabilium.
exports.diagListClientesConRazonSocial = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const db = admin.firestore();
      const snap = await db.collection("users").where("kind", "==", "client").get();

      const seen = new Set();
      const rows = [];
      for (const doc of snap.docs) {
        const d = doc.data();
        if (!d.contabiliumId || seen.has(d.contabiliumId)) continue;
        seen.add(d.contabiliumId);
        try {
          const cliente = await getClientById(email, apiKey, d.contabiliumId);
          rows.push({
            nombreEnSamurai: d.name || "(sin nombre)",
            razonSocialEnContabilium: cliente?.RazonSocial || "(no encontrado)",
            cuit: cliente?.NroDoc || d.cuit || "",
            contabiliumId: d.contabiliumId,
          });
        } catch (err) {
          rows.push({ nombreEnSamurai: d.name, razonSocialEnContabilium: "ERROR: " + String(err), cuit: d.cuit, contabiliumId: d.contabiliumId });
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      rows.sort((a, b) => a.razonSocialEnContabilium.localeCompare(b.razonSocialEnContabilium));
      return res.json({ total: rows.length, rows });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagInvestigarLinkeoMalo = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const cuits = ["20-34030743-8", "20-30947205-6", "23-39932686-9"];
      const results = [];
      for (const cuit of cuits) {
        const digits = cuit.replace(/\D/g, "");
        const candidatos = await searchClientesByFiltro(email, apiKey, digits);
        const match = await searchClientByDoc(email, apiKey, digits);
        results.push({
          cuitBuscado: cuit,
          candidatosDevueltos: candidatos.map((c) => ({ Id: c.Id, RazonSocial: c.RazonSocial, NroDoc: c.NroDoc })),
          matchEncontrado: match ? { Id: match.Id, RazonSocial: match.RazonSocial, NroDoc: match.NroDoc } : null,
        });
        await new Promise((r) => setTimeout(r, 300));
      }
      const cliente114067200 = await getClientById(email, apiKey, 114067200);
      return res.json({ cliente114067200, results });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagSaldoByCuit = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const cuit = String(req.query.cuit || "").trim();
      if (!cuit) return res.status(400).json({ error: "Falta ?cuit=" });
      const result = await debugSaldoByCuit(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), cuit);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Reconstrucción del saldo desde cero: suma el Total firmado de cada
// comprobante (FCA/NDA/COT positivo, NCA ya viene negativo en Total) y resta
// las cobranzas reales del cliente (ya sincronizadas en Firestore desde
// Contabilium). A diferencia de sumar el campo Saldo de cada comprobante,
// esto no depende de que Contabilium haya actualizado ese campo cuando el
// pago se aplicó como "saldo a favor" (caso que rompía el cálculo anterior).
exports.diagSaldoByCuitV2 = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const cuit = String(req.query.cuit || "").trim();
      if (!cuit) return res.status(400).json({ error: "Falta ?cuit=" });

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const candidatos = await searchClientesByFiltro(email, apiKey, cuit);
      const cuitLimpio = cuit.replace(/\D/g, "");
      const cliente = candidatos.find((c) => (c.NroDoc || "").replace(/\D/g, "") === cuitLimpio) || candidatos[0];
      if (!cliente) return res.status(404).json({ error: "No se encontró cliente con ese CUIT", candidatos });

      const comprobantes = await getComprobantesByClientId(email, apiKey, cliente.Id, {
        tipos: ["FCA", "NCA", "NDA", "COT"],
      });
      const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));
      const totalComprobantes = comprobantes.reduce((acc, c) => acc + parseAr(c.ImporteTotalNeto), 0);

      const db = admin.firestore();
      const cobranzasSnap = await db.collection("cobranzas").where("idPersona", "==", cliente.Id).get();
      const cobranzas = cobranzasSnap.docs.map((d) => d.data());
      const totalCobranzas = cobranzas.reduce((acc, c) => {
        if (c.excluirDeSaldo) return acc;
        return acc + Number(c.importeReal ?? c.importeTotal ?? 0);
      }, 0);

      const saldoTotal = totalComprobantes - totalCobranzas;

      return res.json({
        contabiliumId: cliente.Id,
        razonSocial: cliente.RazonSocial,
        totalComprobantes: comprobantes.length,
        sumaTotalComprobantes: totalComprobantes,
        totalCobranzasEncontradas: cobranzas.length,
        sumaCobranzas: totalCobranzas,
        saldoTotal,
        detalleComprobantes: comprobantes.map((c) => ({
          Tipo: c.TipoFc, Numero: c.Numero, Fecha: c.FechaEmision, Total: c.ImporteTotalNeto,
        })),
        detalleCobranzas: cobranzas.map((c) => ({
          numero: c.numero, fecha: c.fecha, importeTotal: c.importeTotal,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Diagnóstico puntual: recorre TODOS los usuarios ya vinculados a Contabilium
// y devuelve el saldo de cuenta corriente calculado por Samurai para cada
// uno, para poder cotejarlo en bloque contra los exports oficiales de
// Contabilium (uno por uno sería muy lento vía diagSaldoByCuitV2).
exports.diagSaldoTodosVinculados = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 540 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const db = admin.firestore();

      const usersSnap = await db.collection("users")
        .where("kind", "==", "client")
        .get();

      const resultados = [];
      for (const docSnap of usersSnap.docs) {
        const u = docSnap.data();
        if (!u.contabiliumId) continue;
        try {
          const comprobantes = await getComprobantesByClientId(email, apiKey, u.contabiliumId, {
            tipos: ["FCA", "NCA", "NDA", "COT"],
          });
          const saldoSamurai = await computeSaldoTotal(db, u.contabiliumId, comprobantes);
          resultados.push({
            uid: docSnap.id,
            nombre: u.contabiliumDepositoNombre || u.name,
            cuit: u.cuit,
            contabiliumId: u.contabiliumId,
            saldoSamurai,
          });
        } catch (err) {
          resultados.push({
            uid: docSnap.id,
            nombre: u.contabiliumDepositoNombre || u.name,
            cuit: u.cuit,
            contabiliumId: u.contabiliumId,
            error: String(err),
          });
        }
        await sleep(300);
      }

      return res.json({ total: resultados.length, resultados });
    } catch (err) {
      console.error("[diag] diagSaldoTodosVinculados error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagListClientesVinculados = onRequest(
  { cors: false, timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const db = admin.firestore();
      const snap = await db.collection("users").get();
      const rows = [];
      snap.forEach((doc) => {
        const d = doc.data();
        if (d.contabiliumId) {
          rows.push({
            nombre: d.name || d.nombre || d.razonSocial || "(sin nombre)",
            cuit: d.cuit || d.nroDocumento || "",
            contabiliumId: d.contabiliumId,
          });
        }
      });
      rows.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      return res.json({ total: rows.length, rows });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Base completa de clientes de Contabilium (169+ registros, no solo los que
// se registraron en la app) — usada por el CRM interno para asignar a
// vendedores/telemarketers la cartera real de Contabilium.
exports.listContabiliumClientes = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const clientes = await getAllClientes(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      const items = clientes.map((c) => ({
        id: `cb-${c.Id}`,
        contabiliumId: c.Id,
        nombre: c.RazonSocial || c.NombreFantasia || "(sin nombre)",
        cuit: c.NroDoc || "",
        telefono: c.Telefono || "",
        telefono2: "",
        provincia: c.Provincia || "",
        ciudad: c.Ciudad || "",
        rubro: "",
      }));
      return res.json({ items });
    } catch (err) {
      console.error("[contabilium] listContabiliumClientes error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagRawCobranza = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const id = String(req.query.id || "").trim();
      if (!id) return res.status(400).json({ error: "Falta ?id=" });
      const detail = await getCobranzaById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), id);
      return res.json(detail);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Borra un doc de cobranzas/{id} de Firestore. Uso puntual: cuando una
// cobranza fue borrada/revertida en Contabilium después de sincronizarse,
// queda un registro obsoleto en Firestore restando de más del saldo real.
// Sincroniza cobranzas puntuales por su ID interno de Contabilium. Uso:
// cuando getCobranzasList (paginación por ventana de fechas) se saltea
// alguna cobranza — caso confirmado con 3 cobranzas de un cliente que no
// aparecían ni ampliando la ventana de fechas.
exports.adminSyncCobranzasPorId = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (!ids.length) return res.status(400).json({ error: "Falta ids[]" });

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const db = admin.firestore();

      const synced = [];
      const errors = [];
      for (const id of ids) {
        try {
          const detail = await getCobranzaById(email, apiKey, id);
          if (!detail) {
            errors.push({ id, error: "no encontrada en Contabilium" });
            continue;
          }
          await db.collection("cobranzas").doc(String(id)).set(buildCobranzaDoc(id, detail), { merge: true });
          synced.push({ id, numero: detail.Numero, idPersona: detail.IDPersona });
        } catch (err) {
          errors.push({ id, error: String(err) });
        }
      }
      return res.json({ synced, errors });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.adminDeleteCobranzaDoc = onRequest(
  { cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) return res.status(400).json({ error: "Falta id" });
      await admin.firestore().doc(`cobranzas/${id}`).delete();
      return res.json({ ok: true, deleted: id });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagProbeBancos = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await probeBancosEndpoints(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagTestPageIndex = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const fechaDesde = String(req.query.desde || "");
      const fechaHasta = String(req.query.hasta || "");
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const resultados = await testPageIndexRaw(email, apiKey, fechaDesde, fechaHasta);
      return res.json(resultados);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagRawCobranzasList = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const fechaDesde = String(req.query.desde || "");
      const fechaHasta = String(req.query.hasta || "");
      const list = await getCobranzasList(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), { fechaDesde, fechaHasta });
      return res.json({
        total: list.length,
        items: list.map((it) => ({ id: it.ID ?? it.Id, numero: it.Numero, fecha: it.Fecha })),
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// getCobranzasList pagina "recortando" la ventana de fechas (asumiendo que
// el filtro de fechas de /cobranzas/search funciona), pero comprobantes/search
// usa paginación real por `page` ignorando fechas y filtrando del lado
// nuestro. Este diagnóstico prueba si /cobranzas/search también soporta
// paginación real por `page`, para encontrar cobranzas que el método actual
// se está salteando (caso confirmado: 3 cobranzas de un cliente que no
// aparecen ni siquiera en la lista cruda por fechas).
exports.diagCobranzasPorClientePaginado = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const idPersona = Number(req.query.idPersona);
      if (!idPersona) return res.status(400).json({ error: "Falta ?idPersona=" });

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const result = await buscarCobranzasPorClientePaginado(email, apiKey, idPersona);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagRawClient = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const documento = String(req.query.documento || "").trim();
      if (documento) {
        const { getDatosAfip } = require("./contabiliumService");
        const datos = await getDatosAfip(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), documento);
        return res.json(datos);
      }
      if (req.query.deleteComprobanteId) {
        const { deleteComprobante } = require("./contabiliumService");
        const result = await deleteComprobante(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), req.query.deleteComprobanteId);
        return res.json({ deleted: true, result });
      }
      if (req.query.fixTipoDocCuit) {
        const { getClientById, updateCliente } = require("./contabiliumService");
        const id = req.query.fixTipoDocCuit;
        const cliente = await getClientById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), id);
        const patched = { ...cliente, TipoDoc: "CUIT" };
        const result = await updateCliente(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), id, patched);
        return res.json({ updated: true, result });
      }
      if (req.query.patchClientId && req.query.patchJson) {
        const { getClientById, updateCliente } = require("./contabiliumService");
        const id = req.query.patchClientId;
        const patch = JSON.parse(req.query.patchJson);
        const cliente = await getClientById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), id);
        const patched = { ...cliente, ...patch };
        const result = await updateCliente(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), id, patched);
        return res.json({ updated: true, patched, result });
      }
      const contabiliumId = String(req.query.contabiliumId || "").trim();
      if (!contabiliumId) return res.status(400).json({ error: "Falta ?contabiliumId= o ?documento=" });
      if (req.query.allTipos) {
        const { getComprobantesByClientId } = require("./contabiliumService");
        const items = await getComprobantesByClientId(
          CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), Number(contabiliumId),
          { tipos: ["FCA", "FCB", "FCC", "NCA", "NCB", "NCC", "NDA", "NDB", "NDC", "COT"] }
        );
        return res.json({ items });
      }
      const cliente = await getClientById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), contabiliumId);
      return res.json(cliente);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagProbeCcEndpoints = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const contabiliumId = String(req.query.contabiliumId || "").trim();
      if (!contabiliumId) return res.status(400).json({ error: "Falta ?contabiliumId=" });
      const result = await debugProbeCcEndpoints(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), contabiliumId);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.getDepositoStockAdmin = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const db = admin.firestore();
      const callerSnap = await db.doc(`users/${uid}`).get();
      const staffRoles = ["admin"];
      if (!callerSnap.exists || !staffRoles.includes(callerSnap.data().role)) {
        return res.status(403).json({ error: "Acceso denegado" });
      }

      const { depositoId } = req.body || {};
      if (!depositoId) return res.status(400).json({ error: "depositoId requerido" });

      const email  = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const stockItems = await getStockByDepositoWithRetry(email, apiKey, depositoId);
      const pendingSoldBySku = await getPendingSoldBySku(db, { depositoId });
      const items = await buildDepositoStockItems(db, email, apiKey, stockItems, { pendingSoldBySku });

      return res.json({ depositoId, items });
    } catch (err) {
      console.error("[contabilium] getDepositoStockAdmin error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Ventas reportadas por distribuidores (no toca Contabilium):
// el distribuidor marca "vendí esto", queda pendiente hasta que
// Samurai lo factura manualmente en Contabilium y lo marca resuelto.
// ─────────────────────────────────────────────────────────────
exports.reportSale = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });

    let uid;
    try {
      uid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const db = admin.firestore();
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const user = userSnap.data();
      if (!user.contabiliumDepositoId) {
        return res.status(400).json({ error: "Usuario sin depósito consignado asignado" });
      }

      const { sku, name, category, imageUrl, quantity, unitPrice, tipoDocumento } = req.body || {};
      const qty = Number(quantity);
      if (!sku || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: "sku y quantity (mayor a 0) son requeridos" });
      }
      const tipoFcElegido = tipoDocumento === "COT" ? "COT" : "FCA";

      // Evita reportar la misma venta dos veces por error (p.ej. tocando el
      // botón de nuevo sin darse cuenta de que ya se registró): si hay un
      // reporte pendiente del mismo producto en los últimos 30 minutos, se
      // bloquea en vez de crear otro duplicado.
      const reciente = new Date(Date.now() - 30 * 60 * 1000);
      const dupSnap = await db.collection("saleRequests")
        .where("distributorUid", "==", uid)
        .where("sku", "==", String(sku).trim())
        .where("status", "==", "pendiente")
        .get();
      const yaReportado = dupSnap.docs.some((d) => {
        const createdAt = d.data().createdAt?.toDate?.();
        return createdAt && createdAt > reciente;
      });
      if (yaReportado) {
        return res.status(409).json({
          error: "Ya reportaste la venta de este producto hace poco. Si vendiste más de una unidad, avisale a Samurai directamente para que lo corrijan.",
        });
      }

      const ref = await db.collection("saleRequests").add({
        distributorUid: uid,
        distributorName: user.name || user.email || "",
        depositoId: Number(user.contabiliumDepositoId),
        depositoNombre: user.contabiliumDepositoNombre || null,
        sku: String(sku).trim(),
        name: name || "",
        category: category || null,
        imageUrl: imageUrl || "",
        quantity: qty,
        unitPrice: typeof unitPrice === "number" ? unitPrice : null,
        tipoDocumentoElegido: tipoFcElegido,
        status: "pendiente",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Facturación automática: apenas se reporta la venta tratamos de
      // emitir el comprobante en Contabilium al toque, con el tipo que el
      // propio distribuidor eligió al reportar (Factura o COT) — no espera
      // a que alguien de Samurai lo revise. Si algo falla (cliente sin
      // vincular a Contabilium, error de la API, etc.) el saleRequest queda
      // "pendiente" como antes, para resolverlo a mano desde Ventas
      // Reportadas — nunca bloquea el reporte del distribuidor.
      let tipoDocumentoEmitido = null;
      if (user.contabiliumId) {
        try {
          const comprobante = await crearComprobante(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), {
            idCliente: user.contabiliumId,
            idDeposito: Number(user.contabiliumDepositoId),
            tipoFc: tipoFcElegido,
            items: [
              {
                descripcion: name || `SKU ${sku}`,
                cantidad: qty,
                precioUnitario: typeof unitPrice === "number" ? unitPrice : 0,
                sku: String(sku).trim(),
              },
            ],
          });
          await ref.update({
            status: "facturado",
            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
            resolvedBy: "auto",
            tipoDocumentoEmitido: tipoFcElegido,
            facturaContabilium: comprobante || null,
          });
          tipoDocumentoEmitido = tipoFcElegido;
        } catch (err) {
          console.error("[saleRequests] auto-facturación falló, queda pendiente para resolver a mano:", err);
        }
      }

      // Agrupa en una sola notificación los reportes del mismo distribuidor
      // en las últimas horas, en vez de mandar una notificación nueva por
      // cada bici que reportan. Se agrupa aunque la notificación ya se haya
      // leído (y se vuelve a marcar como no leída) — así no se fragmenta en
      // varias tarjetas solo porque el admin abrió la campana entre medio.
      const notifItem = {
        saleRequestId: ref.id,
        sku: String(sku).trim(),
        name: name || "",
        quantity: qty,
        unitPrice: typeof unitPrice === "number" ? unitPrice : null,
        tipoDocumentoEmitido,
      };
      const groupWindow = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const existingSnap = await db.collection("notifications")
        .where("type", "==", "sale_reported")
        .where("distributorUid", "==", uid)
        .get();
      const existing = existingSnap.docs.find((d) => {
        const createdAt = d.data().createdAt?.toDate?.();
        return createdAt && createdAt > groupWindow;
      });

      if (existing) {
        await existing.ref.update({
          items: admin.firestore.FieldValue.arrayUnion(notifItem),
          read: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await db.collection("notifications").add({
          type: "sale_reported",
          distributorUid: uid,
          distributorName: user.name || user.email || "",
          depositoNombre: user.contabiliumDepositoNombre || null,
          items: [notifItem],
          read: false,
          attended: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return res.json({ ok: true, id: ref.id, tipoDocumentoEmitido });
    } catch (err) {
      console.error("[saleRequests] reportSale error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Lista solicitudes de venta para el panel admin (staff-only).
exports.listSaleRequests = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const db = admin.firestore();
      const snap = await db.collection("saleRequests").orderBy("createdAt", "desc").limit(300).get();
      const items = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
          resolvedAt: data.resolvedAt ? data.resolvedAt.toDate().toISOString() : null,
          comprobantePagoUploadedAt: data.comprobantePagoUploadedAt ? data.comprobantePagoUploadedAt.toDate().toISOString() : null,
          comprobantePagoRevisadoAt: data.comprobantePagoRevisadoAt ? data.comprobantePagoRevisadoAt.toDate().toISOString() : null,
        };
      });
      return res.json({ items });
    } catch (err) {
      console.error("[saleRequests] listSaleRequests error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Marca una solicitud de venta como facturada (staff-only).
exports.resolveSaleRequest = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id requerido" });

      const db = admin.firestore();
      await db.doc(`saleRequests/${id}`).update({
        status: "facturado",
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: staffUid,
      });

      // Limpia el ítem resuelto de cualquier notificación "sale_reported" que
      // lo tenga, sea cual sea la pantalla desde la que se facturó.
      const notifSnap = await db
        .collection("notifications")
        .where("type", "==", "sale_reported")
        .get();
      const batch = db.batch();
      notifSnap.forEach((docSnap) => {
        const items = Array.isArray(docSnap.data().items) ? docSnap.data().items : [];
        if (!items.some((it) => it.saleRequestId === id)) return;
        const remaining = items.filter((it) => it.saleRequestId !== id);
        if (remaining.length === 0) {
          batch.delete(docSnap.ref);
        } else {
          batch.update(docSnap.ref, { items: remaining });
        }
      });
      await batch.commit();

      return res.json({ ok: true });
    } catch (err) {
      console.error("[saleRequests] resolveSaleRequest error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);


// Emite una factura REAL en Contabilium (con CAE) para una o más ventas
// reportadas del mismo distribuidor, y las marca como facturadas. A
// diferencia de resolveSaleRequest (que solo cambia el estado a mano
// después de facturar manualmente en Contabilium), esto factura de verdad.
exports.emitirFacturaVenta = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { saleRequestIds } = req.body || {};
      if (!Array.isArray(saleRequestIds) || saleRequestIds.length === 0) {
        return res.status(400).json({ error: "saleRequestIds requerido" });
      }

      const db = admin.firestore();
      const refs = saleRequestIds.map((id) => db.doc(`saleRequests/${id}`));
      const snaps = await db.getAll(...refs);

      const rows = [];
      for (const snap of snaps) {
        if (!snap.exists) return res.status(404).json({ error: `No existe la venta ${snap.id}` });
        const data = snap.data();
        if (data.status !== "pendiente") {
          return res.status(400).json({ error: `La venta ${snap.id} (${data.name || data.sku}) ya no está pendiente` });
        }
        rows.push({ ref: snap.ref, data });
      }

      const distributorUid = rows[0].data.distributorUid;
      if (!rows.every((r) => r.data.distributorUid === distributorUid)) {
        return res.status(400).json({ error: "Todas las ventas tienen que ser del mismo distribuidor" });
      }

      const userSnap = await db.doc(`users/${distributorUid}`).get();
      const userData = userSnap.exists ? userSnap.data() : null;
      const idCliente = userData?.contabiliumId;
      if (!idCliente) {
        return res.status(400).json({ error: "Este distribuidor no está vinculado a un cliente de Contabilium (contabiliumId)" });
      }

      const items = rows.map((r) => ({
        descripcion: r.data.name || `SKU ${r.data.sku}`,
        cantidad: Number(r.data.quantity || 1),
        precioUnitario: Number(r.data.unitPrice || 0),
        sku: r.data.sku || null,
      }));

      const comprobante = await crearComprobante(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), {
        idCliente,
        idDeposito: userData?.contabiliumDepositoId || null,
        tipoFc: "FCA",
        items,
      });

      const batch = db.batch();
      for (const r of rows) {
        batch.update(r.ref, {
          status: "facturado",
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          resolvedBy: staffUid,
          facturaContabilium: comprobante || null,
        });
      }
      await batch.commit();

      // Limpia los ítems facturados de cualquier notificación "sale_reported".
      const notifSnap = await db.collection("notifications").where("type", "==", "sale_reported").get();
      const notifBatch = db.batch();
      const idsSet = new Set(saleRequestIds);
      notifSnap.forEach((docSnap) => {
        const items2 = Array.isArray(docSnap.data().items) ? docSnap.data().items : [];
        if (!items2.some((it) => idsSet.has(it.saleRequestId))) return;
        const remaining = items2.filter((it) => !idsSet.has(it.saleRequestId));
        if (remaining.length === 0) notifBatch.delete(docSnap.ref);
        else notifBatch.update(docSnap.ref, { items: remaining });
      });
      await notifBatch.commit();

      return res.json({ ok: true, comprobante });
    } catch (err) {
      console.error("[saleRequests] emitirFacturaVenta error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Emite una factura REAL en Contabilium para CUALQUIER cliente vinculado,
// con ítems elegidos a mano por staff (ej. venta cerrada en persona, sin
// que el distribuidor la haya reportado desde su celular). A diferencia de
// emitirFacturaVenta, no depende de registros previos en `saleRequests`.
exports.emitirFacturaManual = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { contabiliumId, items, tipoFc } = req.body || {};
      const idCliente = Number(contabiliumId);
      if (!idCliente) return res.status(400).json({ error: "contabiliumId requerido" });
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Agregá al menos un ítem" });
      }
      const tipoFcValido = ["FCA", "FCB", "FCC"].includes(tipoFc) ? tipoFc : "FCA";

      const cleanItems = items.map((it, i) => {
        const descripcion = String(it.descripcion || "").trim();
        const cantidad = Number(it.cantidad);
        const precioUnitario = Number(it.precioUnitario);
        if (!descripcion) throw new Error(`Ítem ${i + 1}: falta la descripción`);
        if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error(`Ítem ${i + 1}: cantidad inválida`);
        if (!Number.isFinite(precioUnitario) || precioUnitario < 0) throw new Error(`Ítem ${i + 1}: precio inválido`);
        return { descripcion, cantidad, precioUnitario, sku: it.sku ? String(it.sku).trim() : null };
      });

      // Buscamos el depósito consignado del cliente (si tiene uno) para que
      // la factura descuente stock real, igual que emitirFacturaVenta.
      const db = admin.firestore();
      const userQuery = await db.collection("users").where("contabiliumId", "==", idCliente).limit(1).get();
      const idDeposito = userQuery.empty ? null : userQuery.docs[0].data().contabiliumDepositoId || null;

      const comprobante = await crearComprobante(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), {
        idCliente,
        idDeposito,
        tipoFc: tipoFcValido,
        items: cleanItems,
      });

      await db.collection("facturasManuales").add({
        contabiliumId: idCliente,
        items: cleanItems,
        tipoFc: tipoFcValido,
        emitidoPor: staffUid,
        emitidoAt: admin.firestore.FieldValue.serverTimestamp(),
        comprobante: comprobante || null,
      });

      return res.json({ ok: true, comprobante });
    } catch (err) {
      console.error("[facturas] emitirFacturaManual error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Registra un recibo de cobranza contra una factura puntual, para descontar
// el "Debe" de la cuenta corriente sin pasar por facturación — lo que
// pidió el staff para clientes de compra directa (sin depósito consignado)
// como Montejano.
const FORMAS_DE_PAGO_VALIDAS = ["Débito", "Depósito", "Efectivo", "Transferencia", "Cheque", "Nota de crédito"];
// Cheque, igual que Efectivo, no lleva banco/caja — solo el número de
// cheque como NroReferencia (confirmado contra cobranzas reales ya
// sincronizadas: siempre traen IdBanco/IdCaja en null).
const FORMAS_SIN_BANCO = ["Efectivo", "Cheque"];
exports.cobrarComprobante = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { idComprobante, importeTotalNeto } = req.body || {};
      const id = Number(idComprobante);
      const total = Number(importeTotalNeto);
      if (!id) return res.status(400).json({ error: "idComprobante requerido" });
      if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: "importeTotalNeto inválido" });

      // Acepta una o varias líneas de pago en el mismo recibo. Es clave que
      // vayan TODAS juntas en un solo llamado: la API de Contabilium
      // reemplaza el recibo entero de un comprobante en cada llamada a
      // /comprobantes/cobrar (no lo acumula) — si mandáramos cada línea por
      // separado, cada llamada pisaría a la anterior y solo quedaría
      // registrada la última.
      const pagosBody = Array.isArray(req.body?.pagos) ? req.body.pagos : (req.body?.formaDePago ? [req.body] : []);
      if (pagosBody.length === 0) return res.status(400).json({ error: "pagos requerido (al menos una línea)" });

      let sumaImportes = 0;
      const pagos = [];
      for (const p of pagosBody) {
        const importe = Number(p.monto);
        if (!Number.isFinite(importe) || importe <= 0) {
          return res.status(400).json({ error: "Cada línea necesita un monto mayor a 0" });
        }
        if (!FORMAS_DE_PAGO_VALIDAS.includes(p.formaDePago)) {
          return res.status(400).json({ error: `formaDePago inválida. Valores permitidos: ${FORMAS_DE_PAGO_VALIDAS.join(", ")}` });
        }
        if (!FORMAS_SIN_BANCO.includes(p.formaDePago) && !p.idBanco) {
          return res.status(400).json({ error: "idBanco requerido para esa forma de pago" });
        }
        if (p.formaDePago === "Cheque" && !p.nroReferencia) {
          return res.status(400).json({ error: "El número de cheque es obligatorio" });
        }
        sumaImportes += importe;
        pagos.push({
          FormaDePago: p.formaDePago,
          IDBanco: FORMAS_SIN_BANCO.includes(p.formaDePago) ? null : Number(p.idBanco),
          IDCaja: null,
          IDNotaCredito: null,
          Importe: importe,
          NroReferencia: p.nroReferencia || "",
          IDComprobanteAsociado: "",
        });
      }
      if (sumaImportes > total) {
        return res.status(400).json({ error: "La suma de las líneas no puede superar el total de la factura" });
      }

      const saldoRestante = Math.max(0, total - sumaImportes);
      const resultado = await cobrarComprobante(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), {
        id,
        importeTotalNeto: total,
        saldo: saldoRestante,
        pagos,
      });

      // Sincroniza de una el día de hoy, así el recibo recién creado ya
      // aparece en la pantalla de Cobranzas sin esperar al sync diario.
      try {
        const hoy = new Date().toISOString().slice(0, 10);
        await doContabiliumCobranzasSync(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), {
          fechaDesde: hoy,
          fechaHasta: hoy,
        });
      } catch (syncErr) {
        console.error("[facturas] cobrarComprobante: no se pudo re-sincronizar cobranzas del día:", syncErr);
      }

      return res.json({ ok: true, saldoRestante, resultado });
    } catch (err) {
      console.error("[facturas] cobrarComprobante error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// El distribuidor adjunta la foto del comprobante de pago (ya subida a
// Storage por el cliente) a su venta reportada. Solo el dueño de la venta
// puede adjuntar; queda "pendiente" de revisión por staff.
exports.attachComprobantePago = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });
    let uid;
    try {
      uid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const { saleRequestId, url } = req.body || {};
      if (!saleRequestId || !url) return res.status(400).json({ error: "Faltan datos" });

      const db = admin.firestore();
      const ref = db.doc(`saleRequests/${saleRequestId}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "No encontrado" });
      const data = snap.data();
      if (data.distributorUid !== uid) return res.status(403).json({ error: "No autorizado" });

      // Antes de dejarlo en revisión manual, tratamos de detectarlo solos
      // contra las cobranzas reales ya sincronizadas de Contabilium — mismo
      // criterio (monto ±1%/$500, fecha ±4 días) que usa el reporte de pago
      // de cuenta corriente. Si coincide, se aprueba automático.
      let match = null;
      const monto = Number(data.unitPrice || 0) * Number(data.quantity || 0);
      const userSnap = await db.doc(`users/${uid}`).get();
      const contabiliumId = userSnap.exists ? userSnap.data().contabiliumId : null;
      if (contabiliumId && monto > 0) {
        const cobranzasSnap = await db.collection("cobranzas").where("idPersona", "==", contabiliumId).get();
        const cobranzas = cobranzasSnap.docs.map((d) => d.data());
        match = buscarCobranzaCoincidente(cobranzas, monto, new Date().toISOString());
      }

      await ref.update({
        comprobantePagoUrl: url,
        comprobantePagoEstado: match ? "aprobado" : "pendiente",
        comprobantePagoUploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        comprobantePagoRevisadoPor: match ? "Sistema (detección automática)" : admin.firestore.FieldValue.delete(),
        comprobantePagoRevisadoAt: match ? admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.delete(),
        comprobantePagoNota: match ? `Coincide con cobranza Nº ${match.numero || "s/n"} de Contabilium` : admin.firestore.FieldValue.delete(),
      });

      await db.collection("notifications").add({
        type: "comprobante_pago",
        distributorUid: uid,
        distributorName: data.distributorName || "",
        saleRequestId,
        saleItemName: data.name || null,
        confirmadoAutomaticamente: !!match,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, confirmadoAutomaticamente: !!match });
    } catch (err) {
      console.error("[saleRequests] attachComprobantePago error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Staff aprueba o rechaza el comprobante de pago adjuntado por el cliente.
exports.reviewComprobantePago = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { saleRequestId, aprobado, nota } = req.body || {};
      if (!saleRequestId || typeof aprobado !== "boolean") return res.status(400).json({ error: "Faltan datos" });

      const db = admin.firestore();
      await db.doc(`saleRequests/${saleRequestId}`).update({
        comprobantePagoEstado: aprobado ? "aprobado" : "rechazado",
        comprobantePagoRevisadoPor: staffUid,
        comprobantePagoRevisadoAt: admin.firestore.FieldValue.serverTimestamp(),
        comprobantePagoNota: nota || null,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("[saleRequests] reviewComprobantePago error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Comprobantes de pago de cuenta corriente (independiente de ventas
// reportadas): el cliente sube el comprobante de una transferencia/depósito
// que hizo, y el sistema intenta confirmar automáticamente que esa plata ya
// entró como cobranza real en Contabilium (cruzando por monto ± tolerancia
// y fecha ± unos días). Si no encuentra match, queda "pendiente" para que
// el staff lo revise a mano.
// ─────────────────────────────────────────────────────────────
function buscarCobranzaCoincidente(cobranzas, monto, fechaDeclarada) {
  const tolerancia = Math.max(500, Math.abs(monto) * 0.01);
  const fechaMs = new Date(fechaDeclarada).getTime();
  const ventanaMs = 4 * 24 * 60 * 60 * 1000; // ±4 días
  for (const c of cobranzas) {
    const importe = Number(c.importeReal ?? c.importeTotal ?? 0);
    if (Math.abs(importe - monto) > tolerancia) continue;
    const fechaC = new Date(c.fecha).getTime();
    if (Number.isNaN(fechaC) || Number.isNaN(fechaMs)) continue;
    if (Math.abs(fechaC - fechaMs) > ventanaMs) continue;
    return c;
  }
  return null;
}

exports.reportarPagoCuentaCorriente = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });
    let uid;
    try {
      uid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const { url, monto, fecha, nota } = req.body || {};
      if (!url || !monto || !fecha) return res.status(400).json({ error: "Faltan datos (url, monto, fecha)" });

      const db = admin.firestore();
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const u = userSnap.data();
      if (!u.contabiliumId) return res.status(400).json({ error: "Tu cuenta todavía no está vinculada a Contabilium" });

      const cobranzasSnap = await db.collection("cobranzas").where("idPersona", "==", u.contabiliumId).get();
      const cobranzas = cobranzasSnap.docs.map((d) => d.data());
      const match = buscarCobranzaCoincidente(cobranzas, Number(monto), fecha);

      const docData = {
        distributorUid: uid,
        distributorName: u.contabiliumDepositoNombre || u.name || "",
        contabiliumId: u.contabiliumId,
        monto: Number(monto),
        fecha,
        nota: nota || null,
        comprobanteUrl: url,
        estado: match ? "confirmado_auto" : "pendiente",
        matchedCobranzaNumero: match?.numero || null,
        matchedCobranzaImporte: match ? Number(match.importeReal ?? match.importeTotal ?? 0) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const ref = await db.collection("pagosReportados").add(docData);

      if (!match) {
        await db.collection("notifications").add({
          type: "pago_cc_pendiente",
          distributorUid: uid,
          distributorName: docData.distributorName,
          pagoReportadoId: ref.id,
          monto: docData.monto,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return res.json({ ok: true, id: ref.id, confirmadoAutomaticamente: !!match });
    } catch (err) {
      console.error("[pagosCC] reportarPagoCuentaCorriente error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Revisión manual (staff-only) de un pago que no se pudo confirmar solo.
exports.reviewPagoReportado = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { id, aprobado, nota } = req.body || {};
      if (!id || typeof aprobado !== "boolean") return res.status(400).json({ error: "Faltan datos" });
      await admin.firestore().doc(`pagosReportados/${id}`).update({
        estado: aprobado ? "confirmado_manual" : "rechazado",
        revisadoPor: staffUid,
        revisadoAt: admin.firestore.FieldValue.serverTimestamp(),
        notaRevision: nota || null,
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[pagosCC] reviewPagoReportado error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Elimina una venta reportada (staff-only). Uso: corregir reportes
// duplicados o cargados por error.
exports.deleteSaleRequest = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id requerido" });
      await admin.firestore().doc(`saleRequests/${id}`).delete();
      return res.json({ ok: true });
    } catch (err) {
      console.error("[saleRequests] deleteSaleRequest error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Rollup de stock consignado total (todas las bicicletas en
// todos los depósitos de distribuidores) para el Dashboard.
// Recorre los ~61 depósitos, cruza por SKU con el catálogo
// (solo BICICLETAS activas) y suma unidades + valor real.
// ─────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Contabilium devuelve 429 (rate limit) si le pegamos a los depósitos
// demasiado rápido uno atrás de otro. Reintenta con backoff antes de rendirse.
async function getStockByDepositoWithRetry(email, apiKey, depositoId, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getStockByDeposito(email, apiKey, depositoId);
    } catch (err) {
      const is429 = String(err).includes("429");
      if (!is429 || attempt === retries) throw err;
      // Contabilium manda el tiempo exacto de espera en el header Retry-After
      // (límite real: 30 peticiones cada 10s por IP). Si no vino, usamos un
      // backoff conservador de respaldo.
      const waitMs = err.retryAfterSeconds ? err.retryAfterSeconds * 1000 + 200 : 1500 * (attempt + 1);
      await sleep(waitMs);
    }
  }
}

// Suma stock por código, quedándose con un valor por código (Contabilium
// puede repetir el mismo código por paginación con solape en depósitos
// grandes) — igual criterio que buildDepositoStockItems.
function sumStockItems(stockItems, validSkus, priceBySku) {
  const stockByCode = {};
  for (const item of stockItems) {
    const code = (item.Codigo || "").trim();
    if (!code) continue;
    stockByCode[code] = Number(item.StockConReservas ?? item.StockActual ?? 0);
  }
  let bicicletas = 0;
  let valor = 0;
  for (const code of Object.keys(stockByCode)) {
    if (!validSkus.has(code)) continue;
    const stockDisponible = stockByCode[code];
    if (stockDisponible <= 0) continue;
    bicicletas += stockDisponible;
    if (priceBySku[code] != null) valor += stockDisponible * priceBySku[code];
  }
  return { bicicletas, valor };
}

async function computeConsignedRollup(db, email, apiKey) {
  const depoSnap = await db.doc("internalData/contabiliumDepositos").get();
  const depositos = depoSnap.exists ? (depoSnap.data().depositos || []) : [];

  // Diagnóstico temporal: detectar depósitos duplicados en la lista guardada
  // (mismo id apareciendo más de una vez sumaría su stock dos veces).
  const idCounts = {};
  depositos.forEach((d) => { idCounts[d.id] = (idCounts[d.id] || 0) + 1; });
  const dupes = Object.entries(idCounts).filter(([, c]) => c > 1);
  console.log(`[rollup-debug] total depositos guardados: ${depositos.length}, ids duplicados: ${JSON.stringify(dupes)}`);

  // Sin filtro de categoría en la query: la categoría no está guardada con
  // mayúsculas consistentes en todos los productos, así que se compara en JS
  // igual que en el resto del sitio (isBici con toUpperCase()).
  const productsSnap = await db.collection("products").where("active", "==", true).get();
  const priceBySku = {};
  const validSkus = new Set();
  productsSnap.docs.forEach((d) => {
    const p = d.data();
    if ((p.category || "").toString().toUpperCase() !== "BICICLETAS") return;
    const sku = (p.sku || "").toString().trim();
    if (!sku) return;
    validSkus.add(sku);
    if (typeof p.priceArs === "number") priceBySku[sku] = p.priceArs;
  });

  let totalBicicletas = 0;
  let totalValor = 0;
  const errors = {}; // depositoId -> {depositoId, nombre, error}
  const resultados = {}; // depositoId -> {id, nombre, bicicletas}

  await db.doc("meta/consignedRollupProgress").set({
    processed: 0,
    total: depositos.length,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Primera pasada: recorre los 61 con reintento liviano (no insistir de más
  // acá, así no se acumulan pedidos justo cuando Contabilium ya está saturado).
  let processed = 0;
  for (const dep of depositos) {
    try {
      const stockItems = await getStockByDepositoWithRetry(email, apiKey, dep.id, 2);
      const { bicicletas, valor } = sumStockItems(stockItems, validSkus, priceBySku);
      resultados[dep.id] = { id: dep.id, nombre: dep.nombre, bicicletas, valor };
      totalBicicletas += bicicletas;
      totalValor += valor;
    } catch (err) {
      errors[dep.id] = { depositoId: dep.id, nombre: dep.nombre, error: String(err) };
      resultados[dep.id] = { id: dep.id, nombre: dep.nombre, bicicletas: 0, valor: 0 };
    }
    processed += 1;
    db.doc("meta/consignedRollupProgress").set({
      processed, total: depositos.length, lastDeposito: dep.nombre,
    }, { merge: true }).catch(() => {});
    await sleep(900);
  }

  // Segunda pasada: reintenta SOLO los que fallaron, con más pausa y más
  // reintentos — para entonces Contabilium ya tuvo tiempo de destrabarse.
  const fallidos = Object.keys(errors);
  if (fallidos.length > 0) {
    await sleep(5000);
    for (const depId of fallidos) {
      const dep = depositos.find((d) => String(d.id) === depId);
      if (!dep) continue;
      try {
        const stockItems = await getStockByDepositoWithRetry(email, apiKey, dep.id, 4);
        const { bicicletas, valor } = sumStockItems(stockItems, validSkus, priceBySku);
        totalBicicletas += bicicletas;
        totalValor += valor;
        resultados[dep.id] = { id: dep.id, nombre: dep.nombre, bicicletas, valor };
        delete errors[dep.id];
      } catch (err) {
        errors[dep.id] = { depositoId: dep.id, nombre: dep.nombre, error: String(err) };
      }
      processed += 1;
      db.doc("meta/consignedRollupProgress").set({
        processed, total: depositos.length + fallidos.length, lastDeposito: `${dep.nombre} (reintento)`,
      }, { merge: true }).catch(() => {});
      await sleep(2000);
    }
  }

  const todos = Object.values(resultados).sort((a, b) => b.bicicletas - a.bicicletas);
  const errorsList = Object.values(errors);

  const result = {
    totalBicicletas,
    totalValor,
    depositosCount: depositos.length,
    errors: errorsList,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.doc("meta/consignedRollup").set(result);
  // Detalle por depósito guardado aparte (documento propio, no tan liviano
  // como el resumen) para poder auditar/listar sin depender de logs.
  await db.doc("meta/consignedRollupDetail").set({
    porDeposito: todos,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return result;
}

exports.syncConsignedRollup = onSchedule(
  {
    schedule: "every 24 hours",
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await computeConsignedRollup(
        admin.firestore(),
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value()
      );
      console.log("[consignedRollup] sync ok:", result.totalBicicletas, result.totalValor);
    } catch (err) {
      console.error("[consignedRollup] sync error:", err);
    }
  }
);

// Refresco manual desde el botón del Dashboard (staff-only).
exports.triggerConsignedRollupSync = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const result = await computeConsignedRollup(
        admin.firestore(),
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value()
      );
      return res.json(result);
    } catch (err) {
      console.error("[consignedRollup] manual trigger error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Reporte financiero por cliente: stock consignado, facturado, cobrado,
// deuda/a favor, fechas clave. Ojo con getComprobantesByClientId: trae TODO
// el historial de comprobantes de la empresa y filtra por IdCliente del
// lado nuestro (no hay endpoint de Contabilium que filtre por cliente en el
// pedido) — llamarla una vez por cliente (138 veces) escanearía el
// historial completo 138 veces. Acá se trae una sola vez con
// getAllComprobantes y se agrupa en memoria por IdCliente. Las cobranzas
// salen del caché en Firestore (ya sincronizado a diario por
// syncCobranzasDaily), no hace falta pegarle a Contabilium para eso.
async function computeClientesReport(db, email, apiKey) {
  const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));
  const TIPOS_SALDO = ["FCA", "NCA", "NDA", "COT"];

  const allComprobantesRaw = await getAllComprobantes(email, apiKey, {});
  const porCliente = new Map(); // IdCliente -> comprobantes[]
  for (const c of allComprobantesRaw) {
    if (!TIPOS_SALDO.includes(c.TipoFc)) continue;
    if (!porCliente.has(c.IdCliente)) porCliente.set(c.IdCliente, []);
    porCliente.get(c.IdCliente).push(c);
  }

  const cobranzasSnap = await db.collection("cobranzas").get();
  const cobradoPorPersona = new Map(); // idPersona -> {total, ultimaFecha}
  cobranzasSnap.docs.forEach((d) => {
    const c = d.data();
    if (c.excluirDeSaldo) return;
    const idp = c.idPersona;
    if (idp == null) return;
    const monto = Number(c.importeReal ?? c.importeTotal ?? 0);
    const prev = cobradoPorPersona.get(idp) || { total: 0, ultimaFecha: null };
    prev.total += monto;
    if (c.fecha && (!prev.ultimaFecha || String(c.fecha) > String(prev.ultimaFecha))) prev.ultimaFecha = c.fecha;
    cobradoPorPersona.set(idp, prev);
  });

  const rollupDetailSnap = await db.doc("meta/consignedRollupDetail").get();
  const porDeposito = rollupDetailSnap.exists ? (rollupDetailSnap.data().porDeposito || []) : [];
  const depositoById = new Map(porDeposito.map((d) => [String(d.id), d]));

  const usersSnap = await db.collection("users").where("kind", "==", "client").get();

  const rows = usersSnap.docs.map((uDoc) => {
    const u = uDoc.data();
    const contabiliumId = u.contabiliumId || null;
    const comprobantes = contabiliumId ? (porCliente.get(contabiliumId) || []) : [];
    const facturas = comprobantes.filter((c) => c.TipoFc === "FCA");

    const facturadoTotal = facturas.reduce((acc, c) => acc + parseAr(c.ImporteTotalNeto), 0);
    const fechasFactura = facturas.map((c) => c.FechaEmision).filter(Boolean).sort();

    // Mismo criterio que computeSaldoTotal (usado en toda la app): suma
    // directa de ImporteTotalNeto de FCA+NCA+NDA+COT, sin re-firmar signo
    // (Contabilium ya lo maneja consistente en ese campo) menos lo cobrado.
    const sumaComprobantes = comprobantes.reduce((acc, c) => acc + parseAr(c.ImporteTotalNeto), 0);
    const cobrado = contabiliumId ? (cobradoPorPersona.get(contabiliumId) || { total: 0, ultimaFecha: null }) : { total: 0, ultimaFecha: null };
    const saldo = sumaComprobantes - cobrado.total;

    const dep = u.contabiliumDepositoId ? depositoById.get(String(u.contabiliumDepositoId)) : null;

    return {
      uid: uDoc.id,
      nombre: u.name || "",
      localidad: u.city || "",
      contabiliumId,
      depositoId: u.contabiliumDepositoId || null,
      stockConsignado: dep ? dep.bicicletas : 0,
      valorConsignado: dep ? (dep.valor || 0) : 0,
      facturadoTotal,
      cantidadFacturas: facturas.length,
      fechaPrimeraFactura: fechasFactura[0] || null,
      fechaUltimaFactura: fechasFactura[fechasFactura.length - 1] || null,
      cobradoTotal: cobrado.total,
      fechaUltimaCobranza: cobrado.ultimaFecha,
      saldoDeudor: saldo > 0 ? saldo : 0,
      saldoAFavor: saldo < 0 ? -saldo : 0,
    };
  });

  rows.sort((a, b) => b.saldoDeudor - a.saldoDeudor);

  const result = {
    totalClientes: rows.length,
    totalStockConsignado: rows.reduce((a, r) => a + r.stockConsignado, 0),
    totalValorConsignado: rows.reduce((a, r) => a + r.valorConsignado, 0),
    totalFacturado: rows.reduce((a, r) => a + r.facturadoTotal, 0),
    totalCobrado: rows.reduce((a, r) => a + r.cobradoTotal, 0),
    totalDeuda: rows.reduce((a, r) => a + r.saldoDeudor, 0),
    totalAFavor: rows.reduce((a, r) => a + r.saldoAFavor, 0),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.doc("meta/clientesReport").set(result);
  await db.doc("meta/clientesReportDetail").set({ rows, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return result;
}

// Reintenta ante 429 (rate limit de Contabilium: 30 pedidos cada 10s) con
// backoff — igual criterio que getStockByDepositoWithRetry, generalizado
// para usarlo también con getComprobanteById.
async function withRetry429(fn, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = String(err).includes("429");
      if (!is429 || attempt === retries) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Dashboard de gestión: ventas por mes (cantidad de bicis + facturación +
// margen si hay costo cargado por SKU), para saber "cuánto se va vendiendo,
// facturando, y si la empresa está bien". Ojo: en este Contabilium NO se
// usan remitos (tipo REM) — se confirmó con diagTiposComprobante que solo
// existen FCA/FCB/COT/NCA — así que "bicis despachadas a distribuidores" se
// mide con los ítems de cada factura (FCA), no con remitos.
async function computeBusinessDashboard(db, email, apiKey) {
  const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));

  const allComprobantesRaw = await getAllComprobantes(email, apiKey, {});
  const facturas = allComprobantesRaw.filter((c) => c.TipoFc === "FCA");

  // Traemos todos los productos (no solo activos) para poder distinguir,
  // ante un mes con pocas/0 bicis, si es real o si hay bicis que se
  // desactivaron del catálogo después de venderse (quedan afuera de
  // validSkus pero sí correspondían a una bici al momento de facturar).
  const productsSnap = await db.collection("products").get();
  const costBySku = {};
  const validSkus = new Set();
  const skusBiciInactivos = new Set();
  const nombreBySku = {};
  productsSnap.docs.forEach((d) => {
    const p = d.data();
    const sku = (p.sku || "").toString().trim();
    if (!sku) return;
    const esBici = (p.category || "").toString().toUpperCase() === "BICICLETAS";
    if (esBici && p.active === true) validSkus.add(sku);
    if (esBici && p.active !== true) skusBiciInactivos.add(sku);
    if (typeof p.costArs === "number" && p.active === true) costBySku[sku] = p.costArs;
    nombreBySku[sku] = p.name || p.nombre || sku;
  });

  await db.doc("meta/businessDashboardProgress").set({
    processed: 0,
    total: facturas.length,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let processed = 0;
  const detalles = await mapWithConcurrency(facturas, 4, async (f) => {
    let result = { id: f.Id, fecha: f.FechaEmision, items: [] };
    try {
      const full = await withRetry429(() => getComprobanteById(email, apiKey, f.Id));
      result.items = full?.Items || [];
    } catch (err) {
      result.error = String(err);
    }
    processed += 1;
    if (processed % 10 === 0 || processed === facturas.length) {
      db.doc("meta/businessDashboardProgress").set({ processed, total: facturas.length }, { merge: true }).catch(() => {});
    }
    return result;
  });
  const itemsPorFactura = new Map(detalles.map((d) => [d.id, d]));

  const porMes = {};
  const porFactura = []; // detalle crudo, una fila por factura — para poder filtrar/agrupar por cualquier rango de fechas (semana, etc) en el frontend sin recalcular en el backend
  const bicisInactivasExcluidas = []; // diagnóstico: ítems de bici vendidos con un SKU que hoy está inactivo, así no cuentan en "bicis" pero se puede ver que existieron
  function mesDe(fecha) {
    return (fecha || "").slice(0, 7);
  }
  for (const f of facturas) {
    const mes = mesDe(f.FechaEmision);
    if (!mes) continue;
    if (!porMes[mes]) {
      porMes[mes] = { mes, facturas: 0, facturado: 0, bicis: 0, facturadoBicis: 0, costoBicis: 0, bicisConCosto: 0 };
    }
    porMes[mes].facturas += 1;
    porMes[mes].facturado += parseAr(f.ImporteTotalNeto);

    let bicisFactura = 0;
    let facturadoBicisFactura = 0;
    const detalle = itemsPorFactura.get(f.Id);
    for (const it of detalle?.items || []) {
      const sku = (it.Codigo || it.Sku || "").toString().trim();
      if (!validSkus.has(sku)) {
        if (skusBiciInactivos.has(sku)) {
          bicisInactivasExcluidas.push({
            mes,
            facturaId: f.Id,
            sku,
            nombre: nombreBySku[sku] || sku,
            cantidad: Number(it.Cantidad || 0),
          });
        }
        continue;
      }
      const cantidad = Number(it.Cantidad || 0);
      const total = Number(it.Total ?? (Number(it.PrecioUnitario || 0) * cantidad));
      porMes[mes].bicis += cantidad;
      porMes[mes].facturadoBicis += total;
      bicisFactura += cantidad;
      facturadoBicisFactura += total;
      if (costBySku[sku] != null) {
        porMes[mes].costoBicis += cantidad * costBySku[sku];
        porMes[mes].bicisConCosto += cantidad;
      }
    }
    porFactura.push({
      id: f.Id,
      fecha: (f.FechaEmision || "").slice(0, 10),
      cliente: f.RazonSocial || "",
      facturado: parseAr(f.ImporteTotalNeto),
      bicis: bicisFactura,
      facturadoBicis: facturadoBicisFactura,
    });
  }

  const porMesArr = Object.values(porMes)
    .map((m) => ({
      ...m,
      margenBicis: m.bicisConCosto > 0 ? m.facturadoBicis * (m.bicisConCosto / Math.max(m.bicis, 1)) - m.costoBicis : null,
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  // Promedio de los últimos 3 meses con datos, para la proyección simple del
  // dashboard ("si vendo X bicis más, cuánto facturo/gano" = X * estos promedios).
  const ultimosConVentas = porMesArr.filter((m) => m.bicis > 0).slice(-3);
  const promedio = ultimosConVentas.length
    ? {
        mesesConsiderados: ultimosConVentas.map((m) => m.mes),
        bicisPromedioPorMes: ultimosConVentas.reduce((a, m) => a + m.bicis, 0) / ultimosConVentas.length,
        precioPromedioPorBici:
          ultimosConVentas.reduce((a, m) => a + m.facturadoBicis, 0) / Math.max(ultimosConVentas.reduce((a, m) => a + m.bicis, 0), 1),
        costoPromedioPorBici: (() => {
          const bicisConCosto = ultimosConVentas.reduce((a, m) => a + m.bicisConCosto, 0);
          const costo = ultimosConVentas.reduce((a, m) => a + m.costoBicis, 0);
          return bicisConCosto > 0 ? costo / bicisConCosto : null;
        })(),
      }
    : null;
  if (promedio && promedio.costoPromedioPorBici != null) {
    promedio.margenPromedioPorBici = promedio.precioPromedioPorBici - promedio.costoPromedioPorBici;
  }

  const result = {
    totalFacturas: facturas.length,
    totalFacturado: porMesArr.reduce((a, m) => a + m.facturado, 0),
    totalBicisVendidas: porMesArr.reduce((a, m) => a + m.bicis, 0),
    tieneCostosCargados: Object.keys(costBySku).length > 0,
    promedio,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.doc("meta/businessDashboard").set(result);
  await db.doc("meta/businessDashboardDetail").set({
    porMes: porMesArr,
    porFactura,
    bicisInactivasExcluidas,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return result;
}

exports.syncBusinessDashboard = onSchedule(
  {
    schedule: "every 24 hours",
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await computeBusinessDashboard(admin.firestore(), CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      console.log("[businessDashboard] sync ok:", result.totalBicisVendidas, "bicis,", result.totalFacturado, "facturado");
    } catch (err) {
      console.error("[businessDashboard] sync error:", err);
    }
  }
);

exports.triggerBusinessDashboardSync = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await computeBusinessDashboard(admin.firestore(), CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      console.error("[businessDashboard] manual trigger error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Importar remitos exportados a mano desde el panel de Contabilium.
// Contabilium no tiene API pública para remitos (viven en un módulo interno
// de su web, atado a la sesión del navegador) — así que el staff los baja
// con un script de consola (ver conversación) y los sube acá. Hace upsert
// por idRemito, para poder re-subir un rango que se superpone sin duplicar,
// y recalcula los agregados (por mes / por cliente) sobre el set completo.
async function importarRemitosDetalle(db, remitosNuevos) {
  const productsSnap = await db.collection("products").where("active", "==", true).get();
  const validSkus = new Set();
  productsSnap.docs.forEach((d) => {
    const p = d.data();
    if ((p.category || "").toString().toUpperCase() === "BICICLETAS") {
      const sku = (p.sku || "").toString().trim();
      if (sku) validSkus.add(sku);
    }
  });

  const usersSnap = await db.collection("users").where("kind", "==", "client").get();
  const clientePorContabiliumId = new Map();
  usersSnap.docs.forEach((d) => {
    const u = d.data();
    if (u.contabiliumId) clientePorContabiliumId.set(u.contabiliumId, u.name);
  });

  const idPersonaFepaTop = new Set(remitosNuevos.filter((r) => r.razonSocialLista === "FEPA TOP").map((r) => r.idPersona));

  function parseFechaDDMMYYYY(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ""));
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  const detailRef = db.doc("meta/remitosDespachosDetail");
  const detailSnap = await detailRef.get();
  const existentes = detailSnap.exists ? (detailSnap.data().porRemito || []) : [];
  const porIdExistente = new Map(existentes.map((r) => [r.id, r]));

  let nuevos = 0;
  let actualizados = 0;
  for (const r of remitosNuevos) {
    const esInterno = idPersonaFepaTop.has(r.idPersona);
    let bicis = 0;
    for (const it of r.items || []) {
      const sku = (it.codigoConcepto || "").toString().trim();
      const cantidad = Number(it.cantidad || 0);
      if (validSkus.has(sku)) bicis += cantidad;
    }
    const nombre = clientePorContabiliumId.get(r.idPersona) || r.razonSocialLista || `idPersona:${r.idPersona}`;
    const fila = {
      id: r.idRemito,
      fecha: parseFechaDDMMYYYY(r.fecha),
      cliente: esInterno ? "FEPA TOP (interno)" : nombre,
      bicis,
      esInterno,
      numero: r.numero,
    };
    if (porIdExistente.has(fila.id)) actualizados++;
    else nuevos++;
    porIdExistente.set(fila.id, fila);
  }

  const porRemito = [...porIdExistente.values()].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  const porMes = {};
  const porCliente = {};
  let totalDistribuidores = 0;
  let totalInternos = 0;
  for (const fila of porRemito) {
    const mes = fila.fecha ? fila.fecha.slice(0, 7) : "sin-fecha";
    if (!porMes[mes]) porMes[mes] = { mes, bicisDistribuidores: 0, bicisInternos: 0, remitos: 0 };
    porMes[mes].remitos += 1;
    if (fila.esInterno) {
      totalInternos += fila.bicis;
      porMes[mes].bicisInternos += fila.bicis;
    } else {
      totalDistribuidores += fila.bicis;
      porMes[mes].bicisDistribuidores += fila.bicis;
      porCliente[fila.cliente] = (porCliente[fila.cliente] || 0) + fila.bicis;
    }
  }
  const porMesArr = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes));
  const porClienteArr = Object.entries(porCliente)
    .map(([nombre, bicis]) => ({ nombre, bicis }))
    .sort((a, b) => b.bicis - a.bicis);

  const fechas = porRemito.map((r) => r.fecha).filter(Boolean).sort();

  await db.doc("meta/remitosDespachos").set({
    totalRemitos: porRemito.length,
    totalBicisDistribuidores: totalDistribuidores,
    totalBicisInternos: totalInternos,
    rangoDatos: { desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null },
    fuente: "Exportado manualmente desde el panel de Contabilium (sin API pública para remitos)",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await detailRef.set({
    porMes: porMesArr,
    porCliente: porClienteArr,
    porRemito,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { nuevos, actualizados, total: porRemito.length };
}

exports.importarRemitos = onRequest(
  { cors: false, invoker: "public", timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { remitos } = req.body || {};
      if (!Array.isArray(remitos) || remitos.length === 0) {
        return res.status(400).json({ error: "Falta el array 'remitos' (el JSON exportado desde Contabilium)" });
      }
      const result = await importarRemitosDetalle(admin.firestore(), remitos);
      return res.json(result);
    } catch (err) {
      console.error("[importarRemitos] error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.syncClientesReport = onSchedule(
  {
    schedule: "every 24 hours",
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await computeClientesReport(admin.firestore(), CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      console.log("[clientesReport] sync ok:", result.totalClientes, "clientes");
    } catch (err) {
      console.error("[clientesReport] sync error:", err);
    }
  }
);

// Refresco manual desde el botón del panel (staff-only).
exports.triggerClientesReportSync = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await computeClientesReport(admin.firestore(), CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      console.error("[clientesReport] manual trigger error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Auditoría de usuarios "legacy" (del viejo formulario público, con id de
// Firestore autogenerado en vez de un uid real de Firebase Auth). Para cada
// uno, chequea si YA existe una cuenta de Auth con su email:
//   - sin cuenta -> nunca se completó el alta, hay que borrar y recrear.
//   - con cuenta -> tiene login real pero con un uid distinto al doc id;
//     no se puede tratar igual (borrar rompería su acceso).
// Solo lectura, no modifica nada. Staff-only.
// ─────────────────────────────────────────────────────────────
exports.auditLegacyUsers = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const db = admin.firestore();
      const snap = await db.collection("users").get();
      const sinCuenta = [];
      const conCuentaDistinta = [];

      for (const doc of snap.docs) {
        const id = doc.id;
        if (id.length >= 28) continue; // ya es un uid real de Auth
        const data = doc.data();
        const email = data.email;
        if (!email) {
          sinCuenta.push({ id, email: null, name: data.name || "" });
          continue;
        }
        try {
          const authUser = await admin.auth().getUserByEmail(email);
          conCuentaDistinta.push({ id, email, name: data.name || "", realUid: authUser.uid });
        } catch (err) {
          if (err.code === "auth/user-not-found") {
            sinCuenta.push({ id, email, name: data.name || "" });
          } else {
            sinCuenta.push({ id, email, name: data.name || "", error: String(err) });
          }
        }
      }

      const result = {
        totalRevisados: snap.docs.length,
        sinCuenta,
        conCuentaDistinta,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.doc("meta/legacyUsersAudit").set(result);
      return res.json(result);
    } catch (err) {
      console.error("[users] auditLegacyUsers error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);


// ─────────────────────────────────────────────────────────────
// Cambia el usuario (username interno) de una cuenta ya creada: actualiza
// el email de Auth y el doc de Firestore. Staff-only, temporal para
// renombrar un par de cuentas con usuario feo generado automáticamente.
// ─────────────────────────────────────────────────────────────
exports.adminRenameUsername = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { uid, newUsername } = req.body || {};
      if (!uid || !newUsername) return res.status(400).json({ error: "uid y newUsername requeridos" });

      const db = admin.firestore();
      const username = slugifyUsername(newUsername);
      const existing = await db.collection("users").where("usernameLower", "==", username).limit(1).get();
      if (!existing.empty && existing.docs[0].id !== uid) {
        return res.status(409).json({ error: "Ese usuario ya está en uso." });
      }

      const newEmail = `${username}@samurai.internal`;
      const currentAuthUser = await admin.auth().getUser(uid);
      if (currentAuthUser.email !== newEmail) {
        await admin.auth().updateUser(uid, { email: newEmail });
      }
      await db.doc(`users/${uid}`).update({
        username,
        usernameLower: username,
        email: newEmail,
        emailLower: newEmail,
      });

      return res.json({ ok: true, username, email: newEmail });
    } catch (err) {
      console.error("[users] adminRenameUsername error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Alta pública desde "Quiero ser cliente": crea la cuenta real (uid +
// login) directamente, en vez de guardar solo un registro suelto que
// nadie termina de completar. Queda status:"pending" — el login la
// bloquea hasta que un admin la pase a "activo" y le asigne depósito.
// Público (sin auth), pensado para el formulario del sitio.
// ─────────────────────────────────────────────────────────────
exports.submitClientSignup = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
      const {
        nombre, password, email, celular, empresa, cuit,
        provincia, localidad, rubro, mensaje,
      } = req.body || {};

      if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: "Nombre requerido" });
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }
      if (!cuit || !String(cuit).replace(/\D/g, "").match(/^\d{11}$/)) {
        return res.status(400).json({ error: "CUIT inválido" });
      }

      const db = admin.firestore();
      const nameForSlug = String(empresa || nombre).trim();
      const base = slugifyUsername(nameForSlug);
      let username = base;
      let n = 1;
      while (true) {
        const existing = await db.collection("users").where("usernameLower", "==", username).limit(1).get();
        if (existing.empty) break;
        n += 1;
        username = `${base}-${n}`;
      }

      const internalEmail = `${username}@samurai.internal`;
      const authUser = await admin.auth().createUser({
        email: internalEmail,
        password,
        displayName: nombre.trim(),
      });

      await db.doc(`users/${authUser.uid}`).set({
        uid: authUser.uid,
        name: nombre.trim(),
        username,
        usernameLower: username,
        email: internalEmail,
        emailLower: internalEmail,
        contactEmail: email || null,
        phone: celular || null,
        company: empresa || null,
        cuit: cuit || null,
        province: provincia || null,
        city: localidad || null,
        vertical: rubro || null,
        note: mensaje || null,
        role: "viewer",
        status: "pending",
        approved: false,
        kind: "client",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, username });
    } catch (err) {
      console.error("[users] submitClientSignup error:", err);
      const code = err?.errorInfo?.code || err?.code || "";
      if (code.includes("email-already-exists")) {
        return res.status(409).json({ error: "Ya existe una cuenta con ese nombre, probá con otro." });
      }
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Borra un usuario completo: la cuenta real de Auth + su doc en Firestore.
// Reemplaza el borrado viejo que solo tocaba Firestore y dejaba la cuenta
// de acceso huérfana (viva, sin perfil, sin que nadie la viera más).
exports.adminDeleteUser = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { uid } = req.body || {};
      if (!uid) return res.status(400).json({ error: "uid requerido" });

      await admin.firestore().doc(`users/${uid}`).delete();
      try {
        await admin.auth().deleteUser(uid);
      } catch (err) {
        if (err.code !== "auth/user-not-found") throw err;
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[users] adminDeleteUser error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Sincroniza la lista de depósitos reales de Contabilium hacia
// internalData/contabiliumDepositos. GET /inventarios/getDepositos solo
// devuelve el depósito propio (TEMPERLEY) — la lista completa de
// consignación por distribuidor sale del campo "stock" de
// getStockBySKU para cualquier producto (confirmado: trae los 61+
// depósitos con id y nombre).
//
// Seguro anti-desastre: si por algún motivo Contabilium devuelve una
// lista sospechosamente chica (menos de MIN_DEPOSITOS_ESPERADOS), NO
// se pisa lo que ya está guardado — se registra el error y listo. Esto
// es lo que faltó la primera vez y borró la lista de 61 a 1.
// ─────────────────────────────────────────────────────────────
const MIN_DEPOSITOS_ESPERADOS = 55;
const SKU_REFERENCIA_DEPOSITOS = "200012";

async function computeDepositosSync(email, apiKey) {
  const depositos = await getDepositosViaStockBySKU(email, apiKey, SKU_REFERENCIA_DEPOSITOS);

  if (depositos.length < MIN_DEPOSITOS_ESPERADOS) {
    throw new Error(
      `Solo se recibieron ${depositos.length} depósitos (se esperaban al menos ${MIN_DEPOSITOS_ESPERADOS}). No se actualizó la lista guardada, por seguridad.`
    );
  }

  await admin.firestore().doc("internalData/contabiliumDepositos").set({
    depositos,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { count: depositos.length };
}

exports.syncContabiliumDepositos = onSchedule(
  {
    schedule: "every 24 hours",
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
  },
  async () => {
    try {
      const result = await computeDepositosSync(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      console.log("[contabilium] depositos sync ok:", result);
    } catch (err) {
      console.error("[contabilium] depositos sync error:", err);
    }
  }
);

// Refresco manual desde el botón del Dashboard (staff-only).
exports.triggerDepositosSync = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const result = await computeDepositosSync(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      console.error("[contabilium] depositos manual trigger error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Restaura de emergencia la lista de 61 depositos (rota por el sync que
// escribió solo 1). Uso único.
exports.adminRestoreDepositos = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const depositos = [{"id": 106678, "nombre": "TEMPERLEY"}, {"id": 131151, "nombre": "CREDIFIN"}, {"id": 133531, "nombre": "DEPÓSITO CAÑUELAS"}, {"id": 133551, "nombre": "FEDERICO JOSE MESA STORTINI"}, {"id": 133530, "nombre": "ADRIANA LOURDES MIRAS"}, {"id": 133549, "nombre": "FACUNDO MARTIN CONTRERAS"}, {"id": 133583, "nombre": "PLANET BIKE S. CAP I SECC IV"}, {"id": 133572, "nombre": "LIGHTNING SHOP S.A.S."}, {"id": 133582, "nombre": "PABLO MARTIN CASTILLO"}, {"id": 133585, "nombre": "RUMBO GM STORE SOCIEDAD DE RESPONSABILIDAD LIMITAD"}, {"id": 133570, "nombre": "KEVIN URIEL STRALLA"}, {"id": 133587, "nombre": "SERGIO ARIEL CALDERARO"}, {"id": 133544, "nombre": "BENJAMIN  JESUS PIACENZA"}, {"id": 133577, "nombre": "MARCO ANDREA GALLUZZI"}, {"id": 133566, "nombre": "JUAN SANTIAGO JURI"}, {"id": 133556, "nombre": "GINO JESUS HUMBERTO TORNESSE"}, {"id": 134547, "nombre": "7030 SRL"}, {"id": 133545, "nombre": "DESABIKE S.R.L."}, {"id": 133573, "nombre": "LIONEL GERARDO VACCARINI"}, {"id": 133568, "nombre": "JULIANA PERALTA LOPEZ"}, {"id": 133558, "nombre": "GOLDEN OESTE S.A."}, {"id": 133578, "nombre": "MARIA LUZ FERRANDO"}, {"id": 133553, "nombre": "GARAGE BIKER S. A. S."}, {"id": 133563, "nombre": "JUAN GABRIEL RODRIGUEZ"}, {"id": 133552, "nombre": "FREDY GASTON VERA CONSOLANI"}, {"id": 133591, "nombre": "WALTER ALBERTO MARCOS"}, {"id": 133940, "nombre": "MARTIN SUETA"}, {"id": 133569, "nombre": "JULIO ALEXIS CABALLERO"}, {"id": 133588, "nombre": "SERGIO MARCOS LAUCK"}, {"id": 133931, "nombre": "ALEXIS OMAR MORENO"}, {"id": 133952, "nombre": "NICOLAS RAMON SARMIENTO"}, {"id": 133576, "nombre": "MAC BIKE STORE S. R. L."}, {"id": 133567, "nombre": "JULIAN BRAUER LARRABURU"}, {"id": 133589, "nombre": "SILVIO JOSE GARCIA"}, {"id": 133559, "nombre": "HECTOR GUSTAVO BRUZZONI"}, {"id": 133584, "nombre": "RODOLFO PEDRO CENTANINO"}, {"id": 134434, "nombre": "SANTIAGO BONAUDI PEZ"}, {"id": 134552, "nombre": "CÓNDOR FLYING S.A.S"}, {"id": 133543, "nombre": "APOLO RICARDO HUGO Y APOLO OMAR ALBERTO S  DE H"}, {"id": 133579, "nombre": "MARTINO DANTI VISCIARELLI"}, {"id": 133586, "nombre": "SABRINA YAMILE SALATI RODRIGUEZ"}, {"id": 133546, "nombre": "DEUX MACHINA S.R.L."}, {"id": 133536, "nombre": "ADRIAN ALBERTO RAFAEL PANDOLFO"}, {"id": 134028, "nombre": "YOELMYS CUEVAS TRIMIÑO"}, {"id": 134795, "nombre": "RODADOS ARGENTINOS S.A"}, {"id": 134545, "nombre": "CRISTIAN DAVID PERALTA"}, {"id": 134551, "nombre": "TECNICA TUBAL S.A.I.C."}, {"id": 133541, "nombre": "ANDREA YANINA CACERES"}, {"id": 133542, "nombre": "ANGEL OMAR GODANO"}, {"id": 133547, "nombre": "DIEGO RODOLFO GOMEZ"}, {"id": 133548, "nombre": "EDGARDO DAVID PETEAN"}, {"id": 133550, "nombre": "FACUNDO TIZI"}, {"id": 133560, "nombre": "HUGO OCTAVIO SALAZAR"}, {"id": 133561, "nombre": "ISABEL CARMEN GRECO"}, {"id": 133562, "nombre": "JUAN EZEQUIEL ORIHUELA"}, {"id": 133571, "nombre": "LEONARDO RAUL MORALES"}, {"id": 133574, "nombre": "LUCAS BERON AVACA"}, {"id": 133581, "nombre": "PABLO EZEQUIEL DOLHARTZ"}, {"id": 133590, "nombre": "VICTOR ORLANDO RUEDAS"}, {"id": 133592, "nombre": "WAYRA CYCLING S.A."}, {"id": 134105, "nombre": "PANTOJA HERRERO MARCOS"}];
      await admin.firestore().doc("internalData/contabiliumDepositos").set({
        depositos,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.json({ ok: true, count: depositos.length });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);


// Devuelve las ventas reportadas por el propio distribuidor autenticado
// (para que vea el historial y estado de lo que reportó en "Mi stock").
exports.listMySaleRequests = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });

    let uid;
    try {
      uid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const db = admin.firestore();
      const snap = await db.collection("saleRequests")
        .where("distributorUid", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();
      const items = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          sku: data.sku,
          name: data.name,
          imageUrl: data.imageUrl || "",
          quantity: data.quantity,
          unitPrice: data.unitPrice ?? null,
          status: data.status,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
          resolvedAt: data.resolvedAt ? data.resolvedAt.toDate().toISOString() : null,
          comprobantePagoUrl: data.comprobantePagoUrl || null,
          comprobantePagoEstado: data.comprobantePagoEstado || null,
          comprobantePagoNota: data.comprobantePagoNota || null,
          comprobantePagoUploadedAt: data.comprobantePagoUploadedAt ? data.comprobantePagoUploadedAt.toDate().toISOString() : null,
        };
      });
      return res.json({ items });
    } catch (err) {
      console.error("[saleRequests] listMySaleRequests error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Vincula el contabiliumId a los usuarios que tienen CUIT cargado pero
// todavía no están vinculados a su ficha de cliente en Contabilium. Busca
// por CUIT exacto (/clientes/search?nroDoc=), mucho más confiable que por
// nombre — solo queda "sin resolver" si Contabilium no tiene ese CUIT.
// { apply: false } => solo devuelve la propuesta, no escribe nada.
// { apply: true }  => además de devolver la propuesta, la aplica.
exports.adminLinkClientesByCuit = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const apply = Boolean(req.body?.apply);
      const db = admin.firestore();
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const usersSnap = await db.collection("users").where("kind", "==", "client").get();

      const matched = [];
      const unresolved = [];
      const sinCuit = [];
      let alreadyLinkedCount = 0;

      for (const docSnap of usersSnap.docs) {
        const u = docSnap.data();
        if (u.contabiliumId) { alreadyLinkedCount++; continue; }

        const cuit = onlyDigitsStr(u.cuit);
        if (!cuit) {
          sinCuit.push({ uid: docSnap.id, nombre: u.name || null });
          continue;
        }

        let c = null;
        try {
          c = await searchClientByDoc(email, apiKey, cuit);
          await sleep(400);
        } catch (err) {
          unresolved.push({ uid: docSnap.id, nombre: u.name || null, cuit, reason: String(err) });
          await sleep(500);
          continue;
        }

        if (!c) {
          unresolved.push({ uid: docSnap.id, nombre: u.name || null, cuit, reason: "No existe ese CUIT en Contabilium" });
          continue;
        }

        matched.push({
          uid: docSnap.id,
          nombre: u.name || null,
          cuit,
          contabiliumId: c.Id,
          razonSocial: c.RazonSocial,
        });
        if (apply) {
          await docSnap.ref.update({
            contabiliumId: c.Id,
            idListaPrecio: c.IdListaPrecio ?? null,
            condicionIva: c.CondicionIva ?? null,
            contabiliumEmail: c.Email || null,
            contabiliumSync: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      return res.json({
        applied: apply,
        matchedCount: matched.length,
        unresolvedCount: unresolved.length,
        alreadyLinkedCount,
        sinCuitCount: sinCuit.length,
        matched,
        unresolved,
        sinCuit,
      });
    } catch (err) {
      console.error("[users] adminLinkClientesByCuit error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

function onlyDigitsStr(s) {
  return String(s || "").replace(/\D/g, "");
}

// Vincula el contabiliumId (cliente en Contabilium) a los usuarios que
// tienen un depósito consignado asignado pero nunca fueron vinculados a su
// ficha de cliente — esto es lo que necesita el sync automático de órdenes
// (doOrderStatusSync) para poder emparejar comprobantes facturados.
// Busca por el nombre del depósito con el endpoint /clientes/search?filtro=,
// y solo vincula automáticamente cuando hay un único resultado sin ambigüedad.
// { apply: false } => solo devuelve la propuesta de matches, no escribe nada.
// { apply: true }  => además de devolver la propuesta, la aplica.
exports.adminLinkDepositoClientes = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 180 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const apply = Boolean(req.body?.apply);
      const db = admin.firestore();
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const depoSnap = await db.doc("internalData/contabiliumDepositos").get();
      const depositos = depoSnap.exists ? (depoSnap.data().depositos || []) : [];

      const usersSnap = await db.collection("users").where("kind", "==", "client").get();
      const userByDepositoId = new Map();
      usersSnap.docs.forEach((docSnap) => {
        const u = docSnap.data();
        if (u.contabiliumDepositoId != null) {
          userByDepositoId.set(Number(u.contabiliumDepositoId), { docSnap, u });
        }
      });

      const matched = [];
      const unresolved = [];
      const alreadyLinked = [];
      const sinCuenta = [];

      for (const dep of depositos) {
        const entry = userByDepositoId.get(Number(dep.id));

        if (!entry) {
          sinCuenta.push({ depositoId: dep.id, nombre: dep.nombre });
          continue;
        }

        const { docSnap, u } = entry;

        if (u.contabiliumId) {
          alreadyLinked.push({
            uid: docSnap.id,
            nombre: u.contabiliumDepositoNombre || u.name || dep.nombre,
            contabiliumId: u.contabiliumId,
          });
          continue;
        }

        const nombre = (u.contabiliumDepositoNombre || u.name || dep.nombre || "").trim();
        if (!nombre) {
          unresolved.push({ uid: docSnap.id, nombre, reason: "sin nombre" });
          continue;
        }

        let items = [];
        try {
          items = await searchClientesByFiltro(email, apiKey, nombre);
          await sleep(400);
          // Si la búsqueda exacta no encontró nada (p.ej. por puntuación
          // distinta a la cargada en Contabilium: "S.A" vs "S. A."), probamos
          // sacando la última palabra progresivamente ("RODADOS ARGENTINOS
          // S.A" -> "RODADOS ARGENTINOS" -> "RODADOS") hasta dar con un
          // único resultado o quedarnos sin palabras.
          let words = nombre.split(/\s+/);
          while (items.length !== 1 && words.length > 1) {
            words = words.slice(0, -1);
            const attempt = words.join(" ").replace(/[.,]+$/, "").trim();
            if (!attempt) break;
            items = await searchClientesByFiltro(email, apiKey, attempt);
            await sleep(400);
          }
        } catch (err) {
          unresolved.push({ uid: docSnap.id, nombre, reason: String(err) });
          await sleep(500);
          continue;
        }

        if (items.length === 1) {
          const c = items[0];
          matched.push({
            uid: docSnap.id,
            nombre,
            contabiliumId: c.Id,
            razonSocial: c.RazonSocial,
            idListaPrecio: c.IdListaPrecio ?? null,
            condicionIva: c.CondicionIva ?? null,
            cuit: c.NroDoc ?? null,
          });
          if (apply) {
            await docSnap.ref.update({
              contabiliumId: c.Id,
              idListaPrecio: c.IdListaPrecio ?? null,
              condicionIva: c.CondicionIva ?? null,
              cuit: c.NroDoc ?? null,
              contabiliumEmail: c.Email || null,
              contabiliumSync: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        } else {
          unresolved.push({
            uid: docSnap.id,
            nombre,
            candidatesCount: items.length,
            candidates: items.slice(0, 5).map((c) => ({ Id: c.Id, RazonSocial: c.RazonSocial })),
          });
        }
        await sleep(500);
      }

      return res.json({
        applied: apply,
        totalDepositos: depositos.length,
        matchedCount: matched.length,
        unresolvedCount: unresolved.length,
        alreadyLinkedCount: alreadyLinked.length,
        sinCuentaCount: sinCuenta.length,
        matched,
        unresolved,
        alreadyLinked,
        sinCuenta,
      });
    } catch (err) {
      console.error("[users] adminLinkDepositoClientes error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Apenas un distribuidor sube el video de auditoría de stock (colección
// stockAudits, escrita directo desde el cliente), le avisamos a los admins
// por la campanita — así se enteran en el momento, sin esperar a revisar
// el panel de Stock Consignado.
exports.onStockAuditCreated = onDocumentCreated("stockAudits/{auditId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const distributorName = data.distributorName || "Distribuidor";
  const depositoNombre = data.depositoNombre || "";
  await admin.firestore().collection("notifications").add({
    type: "audit_alert",
    severity: "info",
    customerName: distributorName,
    customerNotes: `Subió el video de auditoría de stock${depositoNombre ? ` (${depositoNombre})` : ""}.`,
    depositoId: data.depositoId || null,
    depositoNombre,
    distributorUid: data.distributorUid || null,
    read: false,
    attended: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});

// ─────────────────────────────────────────────────────────────
// Auditorías de stock consignado: cada distribuidor tiene que grabar
// un video cada 10 días (ver src/services/stockAudits.ts). Esta
// corrida diaria avisa a los admins (campanita) cuando a alguien le
// quedan 2 días o ya se le venció el plazo — una sola vez por ciclo
// (se controla con auditAlertsSent para no repetir el aviso a diario).
// ─────────────────────────────────────────────────────────────
const AUDIT_INTERVAL_DAYS = 10;
const AUDIT_WARNING_DAYS = 2;

function auditAnnouncementEmailContent() {
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background:#0f172a; padding: 24px 28px; border-radius: 12px 12px 0 0;">
        <h1 style="color:#fff; font-size: 22px; margin:0;">Samurai Bicis</h1>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; padding: 28px; border-radius: 0 0 12px 12px;">
        <h2 style="color:#0f172a; font-size:18px;">🎥 Implementamos la auditoría de stock consignado</h2>
        <p style="color:#334155; font-size:14px; line-height:1.6;">
          A partir de ahora, cada 10 días vas a tener que grabar un video corto mostrando el stock que tenés
          consignado — lo hacés directo desde tu cuenta, en <strong>"Mi Stock"</strong>, con el botón
          <strong>"🎥 Grabar video"</strong>.
        </p>
        <p style="color:#334155; font-size:14px; line-height:1.6;">
          Te vamos a avisar ahí mismo cuando se acerque la fecha. El conteo de tus primeros 10 días arranca hoy.
        </p>
        <a href="https://samurai.ar/mi-stock" style="display:inline-block; margin-top:12px; background:#dc2626; color:#fff; text-decoration:none; padding:10px 18px; border-radius:10px; font-size:14px; font-weight:600;">
          Ir a Mi Stock
        </a>
      </div>
    </div>`;
  return { subject: "Samurai Bicis — Implementamos la auditoría de stock", html };
}

function auditEmailContent(kind, distributorName) {
  const isOverdue = kind === "overdue";
  const subject = isOverdue
    ? "Samurai Bicis — Tu auditoría de stock está vencida"
    : "Samurai Bicis — Tu auditoría de stock vence en 2 días";
  const mensaje = isOverdue
    ? "Tu auditoría de stock consignado ya está vencida. Ocupate de grabar el video cuanto antes desde \"Mi Stock\"."
    : "Te recordamos que dentro de 2 días se vence tu auditoría de stock consignado. Grabá el video desde \"Mi Stock\" antes de esa fecha para mantenerte al día.";
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background:#0f172a; padding: 24px 28px; border-radius: 12px 12px 0 0;">
        <h1 style="color:#fff; font-size: 22px; margin:0;">Samurai Bicis</h1>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; padding: 28px; border-radius: 0 0 12px 12px;">
        <h2 style="color:${isOverdue ? "#dc2626" : "#b45309"}; font-size:18px;">
          ${isOverdue ? "🚨 Auditoría vencida" : "⚠️ Se vence tu auditoría en 2 días"}
        </h2>
        <p style="color:#334155; font-size:14px; line-height:1.6;">Hola ${distributorName},</p>
        <p style="color:#334155; font-size:14px; line-height:1.6;">${mensaje}</p>
        <a href="https://samurai.ar/mi-stock" style="display:inline-block; margin-top:12px; background:#dc2626; color:#fff; text-decoration:none; padding:10px 18px; border-radius:10px; font-size:14px; font-weight:600;">
          Ir a Mi Stock
        </a>
      </div>
    </div>`;
  return { subject, html };
}

async function checkStockAuditsOnce(apiKey) {
  const db = admin.firestore();
  const usersSnap = await db.collection("users").where("kind", "==", "client").get();

  const programSnap = await db.doc("meta/stockAuditProgram").get();
  const programStart = programSnap.exists ? programSnap.data().startedAt?.toDate() || null : null;

  const now = Date.now();
  let remindersCreated = 0;
  let overdueCreated = 0;

  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    const depositoId = u.contabiliumDepositoId;
    if (depositoId == null) continue;
    const depId = String(depositoId);

    const auditSnap = await db
      .collection("stockAudits")
      .where("depositoId", "==", depId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    const lastAudit = auditSnap.docs[0];
    const lastAuditAt = lastAudit ? lastAudit.data().createdAt?.toDate() : null;
    // Cuando nunca grabó, el ciclo se identifica por la fecha de arranque
    // del programa (no por "never" fijo) — así un reset de programa no
    // queda bloqueado por un marcador de aviso viejo.
    const cycleKey = lastAudit ? lastAudit.id : `start-${programStart ? programStart.getTime() : "unset"}`;
    const baseDate = lastAuditAt || programStart || null;

    let nextDue = null;
    if (baseDate) {
      nextDue = new Date(baseDate);
      nextDue.setDate(nextDue.getDate() + (u.auditIntervalDays || AUDIT_INTERVAL_DAYS));
    }

    const overdue = !nextDue || nextDue.getTime() <= now;
    const msLeft = nextDue ? nextDue.getTime() - now : 0;
    const dueSoon = !overdue && msLeft > 0 && msLeft <= AUDIT_WARNING_DAYS * 24 * 60 * 60 * 1000;
    if (!overdue && !dueSoon) continue;

    const alertType = overdue ? "overdue" : "reminder";
    const markerRef = db.collection("auditAlertsSent").doc(`${depId}_${alertType}_${cycleKey}`);
    if ((await markerRef.get()).exists) continue; // ya avisado en este ciclo

    const distributorName = u.contabiliumDepositoNombre || u.name || "Distribuidor";
    const message = overdue
      ? "Tu auditoría de stock está vencida. Ocupate de hacerla cuanto antes, por favor."
      : "Dentro de 2 días se vence tu nueva auditoría de stock. Por favor, tenelo en cuenta.";

    await db.collection("notifications").add({
      type: "audit_alert",
      severity: overdue ? "danger" : "warning",
      customerName: distributorName,
      customerNotes: message,
      depositoId: depId,
      depositoNombre: u.contabiliumDepositoNombre || "",
      distributorUid: userDoc.id,
      read: false,
      attended: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await markerRef.set({
      depositoId: depId,
      type: alertType,
      cycleKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const email = realEmailOf(u);
    if (email) {
      try {
        const { subject, html } = auditEmailContent(alertType, distributorName);
        await sendEmail(apiKey, { to: email, subject, html });
      } catch (err) {
        console.error("[audits] error mandando mail a", email, err);
      }
    }

    if (overdue) overdueCreated++;
    else remindersCreated++;
  }

  return { checked: usersSnap.size, remindersCreated, overdueCreated };
}

exports.checkStockAudits = onSchedule(
  { schedule: "every day 09:00", timeZone: "America/Argentina/Buenos_Aires", secrets: [RESEND_API_KEY] },
  async () => {
    try {
      const result = await checkStockAuditsOnce(RESEND_API_KEY.value());
      console.log("[audits] check ok:", result);
    } catch (err) {
      console.error("[audits] check error:", err);
    }
  }
);

// Uso puntual (staff-only): completa `contabiliumEmail` (email real de la
// ficha de cliente) en los usuarios que ya estaban vinculados a Contabilium
// antes de que empezáramos a guardar ese campo.
exports.backfillContabiliumEmails = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 180 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const db = admin.firestore();
      const usersSnap = await db.collection("users").where("kind", "==", "client").get();
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      let updated = 0;
      let skipped = 0;
      const skippedList = [];
      const errors = [];
      for (const d of usersSnap.docs) {
        const u = d.data();
        if (u.contabiliumId == null) continue;
        if (u.contabiliumEmail) { skipped++; continue; }
        try {
          const client = await getClientById(email, apiKey, u.contabiliumId);
          if (client && client.Email) {
            await d.ref.update({ contabiliumEmail: client.Email });
            updated++;
          } else {
            skipped++;
            skippedList.push({ uid: d.id, name: u.name || null, contabiliumId: u.contabiliumId, depositoNombre: u.contabiliumDepositoNombre || null });
          }
        } catch (err) {
          errors.push({ uid: d.id, error: String(err) });
        }
        await sleep(300);
      }
      return res.json({ ok: true, updated, skipped, skippedList, errors });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Diagnóstico de un solo uso: consulta el estado real de verificación del
// dominio samurai.ar en Resend (DNS records, estado, etc).
exports.diagResendDomainStatus = onRequest(
  { cors: false, secrets: [RESEND_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}` },
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Diagnóstico de un solo uso: por qué un distribuidor con contabiliumEmail
// cargado no recibió el mail de aviso (le falta contabiliumDepositoId, o el
// email ya estaba marcado como enviado, etc).
exports.diagMissingAnnouncementRecipients = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const db = admin.firestore();
      const usersSnap = await db.collection("users").where("kind", "==", "client").get();
      const out = [];
      usersSnap.docs.forEach((d) => {
        const u = d.data();
        if (!u.contabiliumEmail) return;
        const email = realEmailOf(u);
        const eligible = u.contabiliumDepositoId != null && !!email;
        out.push({
          uid: d.id,
          name: u.name || null,
          contabiliumEmail: u.contabiliumEmail,
          contabiliumDepositoId: u.contabiliumDepositoId ?? null,
          auditAnnouncementEmailSent: !!u.auditAnnouncementEmailSent,
          eligible,
        });
      });
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Uso puntual (staff-only): manda por mail el aviso de que se implementó
// la auditoría de stock a todos los distribuidores con email cargado.
exports.sendAuditAnnouncementEmail = onRequest(
  { cors: false, secrets: [RESEND_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const db = admin.firestore();
      const usersSnap = await db.collection("users").where("kind", "==", "client").get();
      const apiKey = RESEND_API_KEY.value();

      let sent = 0;
      let skipped = 0;
      const errors = [];
      for (const userDoc of usersSnap.docs) {
        const u = userDoc.data();
        // Solo distribuidores con depósito consignado real — el resto de
        // las cuentas cliente no tienen stock consignado, no les aplica.
        if (u.contabiliumDepositoId == null) {
          skipped++;
          continue;
        }
        const email = realEmailOf(u);
        if (!email) {
          skipped++;
          continue;
        }
        try {
          const { subject, html } = auditAnnouncementEmailContent();
          await sendEmail(apiKey, { to: email, subject, html });
          await userDoc.ref.update({ auditAnnouncementEmailSent: true });
          sent++;
        } catch (err) {
          errors.push({ email, error: String(err) });
        }
      }

      return res.json({ ok: true, totalUsers: usersSnap.size, sent, skipped, errors });
    } catch (err) {
      console.error("[audits] sendAuditAnnouncementEmail error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// En tiempo real: apenas se vincula un depósito consignado a una cuenta
// (nueva o existente), le manda el mismo mail de "implementamos la
// auditoría de stock" — así no hace falta acordarse de mandarlo a mano
// cada vez que se suma o vincula un distribuidor nuevo.
exports.onUserDepositoLinked = onDocumentWritten(
  { document: "users/{uid}", secrets: [RESEND_API_KEY, CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!after || after.kind !== "client") return;

    const hadDeposito = before?.contabiliumDepositoId != null;
    const hasDeposito = after.contabiliumDepositoId != null;
    if (!hasDeposito || hadDeposito) return; // solo la transición sin depósito → con depósito

    // Vincula automáticamente el cliente de Contabilium (contabiliumId) apenas
    // se le carga el depósito consignado, si todavía no lo tiene — mismo
    // criterio que adminLinkDepositoClientes (búsqueda por nombre, recortando
    // la última palabra hasta dar con un único resultado).
    if (!after.contabiliumId) {
      const nombre = (after.contabiliumDepositoNombre || after.name || "").trim();
      if (nombre) {
        try {
          const email0 = CONTABILIUM_EMAIL.value();
          const apiKey0 = CONTABILIUM_API_KEY.value();
          let items = await searchClientesByFiltro(email0, apiKey0, nombre);
          let words = nombre.split(/\s+/);
          while (items.length !== 1 && words.length > 1) {
            words = words.slice(0, -1);
            const attempt = words.join(" ").replace(/[.,]+$/, "").trim();
            if (!attempt) break;
            items = await searchClientesByFiltro(email0, apiKey0, attempt);
          }
          if (items.length === 1) {
            const c = items[0];
            await event.data.after.ref.update({
              contabiliumId: c.Id,
              idListaPrecio: c.IdListaPrecio ?? null,
              condicionIva: c.CondicionIva ?? null,
              cuit: c.NroDoc ?? null,
              contabiliumEmail: c.Email || null,
              contabiliumSync: admin.firestore.FieldValue.serverTimestamp(),
            });
            after.contabiliumId = c.Id;
            after.contabiliumEmail = c.Email || null;
            console.log(`[audits] auto-vinculado contabiliumId ${c.Id} para "${nombre}"`);
            await admin.firestore().collection("notifications").add({
              type: "auto_link_cliente",
              distributorName: nombre,
              distributorUid: event.params.uid,
              contabiliumId: c.Id,
              razonSocial: c.RazonSocial,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            console.log(`[audits] auto-vinculación de cliente no resuelta para "${nombre}" (${items.length} candidatos)`);
          }
        } catch (err) {
          console.error("[audits] onUserDepositoLinked: error auto-vinculando cliente", err);
        }
      }
    }

    if (after.auditAnnouncementEmailSent) return; // ya se le mandó antes

    let email = realEmailOf(after);
    let contabiliumEmailPatch = null;

    // Si todavía no tenemos el email real guardado pero sí el contabiliumId
    // (puede pasar si el admin carga el depósito antes de vincular el
    // cliente), lo buscamos directo en Contabilium en este momento.
    if (!email && after.contabiliumId) {
      try {
        const client = await getClientById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), after.contabiliumId);
        if (client && client.Email) {
          email = client.Email;
          contabiliumEmailPatch = client.Email;
        }
      } catch (err) {
        console.error("[audits] onUserDepositoLinked: error buscando email en Contabilium", err);
      }
    }

    if (!email) return;

    try {
      const { subject, html } = auditAnnouncementEmailContent();
      await sendEmail(RESEND_API_KEY.value(), { to: email, subject, html });
      const patch = { auditAnnouncementEmailSent: true };
      if (contabiliumEmailPatch) patch.contabiliumEmail = contabiliumEmailPatch;
      await event.data.after.ref.update(patch);
      console.log("[audits] mail de bienvenida a auditoría enviado a", email);
    } catch (err) {
      console.error("[audits] onUserDepositoLinked error:", err);
    }
  }
);

