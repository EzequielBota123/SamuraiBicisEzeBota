// functions/index.js
const { onRequest }  = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { getAllConceptos, getClientById, searchClientByDoc, getComprobantesByClientId, getAllComprobantes, getComprobanteById, getStockByDeposito, getDepositosViaStockBySKU, searchClientesByFiltro, getAllClientes, getCobranzasList, getCobranzaById, getStockDesglosadoBySKU, buscarCobranzasPorClientePaginado, testPageIndexRaw, probeBancosEndpoints, probeMovimientosDepositoEndpoints, probeChequesEndpoints, debugComprobantesPaging, debugSaldoByCuit, debugClienteSearchRaw, debugProbeCcEndpoints, debugProbeRemitosEndpoints, debugProbeCrearComprobanteEndpoints, debugProbeCrearComprobantePayload, debugProbeStockDescuento, cobrarComprobante, crearComprobante, emitirFacturaElectronica, crearCliente, getDatosAfip, updateCliente, updateConcepto } = require("./contabiliumService");
const { getGaliciaTokenQA, getSaldosGaliciaQA, solicitarExtractoGaliciaQA, validarExtractosGaliciaQA, descargarExtractoGaliciaQA, parseCsvMovimientosGalicia } = require("./galiciaService");


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

// Notificaciones push (FCM) — mismos eventos que ya generan la campanita
// interna, pero también con sonido en el celular. `fcmTokens` vive en el
// propio doc de cada usuario (users/{uid}), como array porque una cuenta
// puede tener la app abierta en varios dispositivos a la vez.
async function enviarPushAUsuario(uid, { title, body, link, data } = {}) {
  if (!uid) return;
  try {
    const ref = admin.firestore().doc(`users/${uid}`);
    const snap = await ref.get();
    const tokens = snap.exists ? snap.data().fcmTokens || [] : [];
    if (!tokens.length) return;
    const resp = await admin.messaging().sendEachForMulticast({
      notification: { title, body },
      data: { link: link || "/", ...(data || {}) },
      tokens,
    });
    // Un token puede quedar obsoleto (usuario desinstaló, borró el sitio de
    // su navegador, etc.) — si Firebase lo confirma como no-registrado, lo
    // sacamos para no seguir intentando mandarle en vano.
    const invalidos = [];
    resp.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (!r.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")) {
        invalidos.push(tokens[i]);
      }
    });
    if (invalidos.length) {
      await ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidos) });
    }
  } catch (err) {
    console.error(`[push] enviarPushAUsuario(${uid}) error:`, err);
  }
}

async function enviarPushAAdmins({ title, body, link, data } = {}) {
  try {
    const snap = await admin.firestore().collection("users").where("role", "==", "admin").get();
    await Promise.all(snap.docs.map((d) => enviarPushAUsuario(d.id, { title, body, link, data })));
  } catch (err) {
    console.error("[push] enviarPushAAdmins error:", err);
  }
}

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
// Login real (usuario/contraseña) de la consola web de Contabilium — se usa
// solo para el ajuste manual de stock, que no tiene API oficial (ver
// contabiliumWebAutomation.js). Es un secreto distinto de CONTABILIUM_EMAIL
// / CONTABILIUM_API_KEY (esos son para la API oficial con OAuth).
const CONTABILIUM_WEB_EMAIL = defineSecret("CONTABILIUM_WEB_EMAIL");
const CONTABILIUM_WEB_PASSWORD = defineSecret("CONTABILIUM_WEB_PASSWORD");
const CREDIFIN_EMAIL = defineSecret("CREDIFIN_EMAIL");
const CREDIFIN_PASSWORD = defineSecret("CREDIFIN_PASSWORD");
const RESEND_API_KEY      = defineSecret("RESEND_API_KEY");
const MERCADOPAGO_ACCESS_TOKEN = defineSecret("MERCADOPAGO_ACCESS_TOKEN");
const GALICIA_APP_ID = defineSecret("GALICIA_APP_ID");
const GALICIA_APP_KEY = defineSecret("GALICIA_APP_KEY");
const GALICIA_ENTERPRISE_ID = defineSecret("GALICIA_ENTERPRISE_ID");
// Clave de Google Maps de uso exclusivo desde el backend (Geocoding API) —
// distinta de la clave pública que usa el navegador para dibujar el mapa.
// Esta no tiene restricción de "sitio web" (Cloud Functions no manda un
// Referer que la pase), así que nunca debe exponerse al cliente: solo vive
// como secreto de Firebase.
const GOOGLE_MAPS_SERVER_KEY = defineSecret("GOOGLE_MAPS_SERVER_KEY");
// Clave de Anthropic para leer comprobantes de pago (foto) con IA y
// extraer banco/monto/fecha — usada para aplicar recibos de cuenta
// corriente automáticamente sin intervención humana.
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
// "Basic Empresa" en el portal de Open Galicia = Authorization Password
// documentado (se concatena CUIT:AuthorizationPassword y se codifica en
// Base64 para el header Authorization Basic del pedido de token).
const GALICIA_AUTH_PASSWORD = defineSecret("GALICIA_BASIC_EMPRESA");
// Certificado cliente para Mutual TLS (ambiente QA). El .cer todavía no lo
// tenemos (bloqueado por un problema de DNS del lado de Galicia al
// descargarlo) — hasta que se cargue este secret, cualquier llamada real
// va a fallar con un error claro en vez de un fetch failed silencioso.
const GALICIA_QA_CERT_PEM = defineSecret("GALICIA_QA_CERT_PEM");
const GALICIA_QA_KEY_PEM = defineSecret("GALICIA_QA_KEY_PEM");
const GALICIA_QA_KEY_PASSPHRASE = defineSecret("GALICIA_QA_KEY_PASSPHRASE");

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

// Le avisa por mail al vendedor "dueño" de un cliente (el que lo tiene en
// su `vendedoresAsignados`) cada vez que pasa algo con ese cliente puntual
// — pedido nuevo, venta reportada, o un comprobante/cobranza que se le
// aplicó. Opt-in: solo manda algo si ese vendedor tiene cargado el campo
// `notificarMovimientosClientesA` (un email) en su propia ficha — por
// pedido explícito 26/10/2026 (caso Cuchi → alfredobavcevich@gmail.com),
// pero genérico para cualquier vendedor con equipo, no hardcodeado a uno.
function movimientoClienteEmailContent(tipo, clienteNombre, detalle) {
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background:#0f172a; padding: 24px 28px; border-radius: 12px 12px 0 0;">
        <h1 style="color:#fff; font-size: 22px; margin:0;">Samurai Bicis</h1>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; padding: 28px; border-radius: 0 0 12px 12px;">
        <h2 style="color:#0f172a; font-size:18px;">${tipo}</h2>
        <p style="color:#334155; font-size:14px; line-height:1.6;">
          Cliente: <strong>${clienteNombre}</strong>
        </p>
        <p style="color:#334155; font-size:14px; line-height:1.6; white-space:pre-line;">${detalle}</p>
      </div>
    </div>`;
  return { subject: `Samurai Bicis — ${tipo}: ${clienteNombre}`, html };
}

async function notificarVendedorDeMovimientoCliente(db, resendApiKey, { clienteUid, clienteContabiliumId, clienteNombre, tipo, detalle }) {
  try {
    let uid = clienteUid || null;
    if (!uid && clienteContabiliumId != null) {
      const snap = await db.collection("users").where("contabiliumId", "==", clienteContabiliumId).limit(1).get();
      if (snap.empty) return;
      uid = snap.docs[0].id;
    }
    if (!uid) return;

    const vendedoresSnap = await db.collection("users").where("vendedoresAsignados", "array-contains", uid).get();
    for (const vDoc of vendedoresSnap.docs) {
      const email = String(vDoc.data().notificarMovimientosClientesA || "").trim();
      if (!email) continue;
      const { subject, html } = movimientoClienteEmailContent(tipo, clienteNombre || "Cliente sin nombre", detalle || "");
      await sendEmail(resendApiKey, { to: email, subject, html });
    }
  } catch (err) {
    console.error("[notificarVendedorDeMovimientoCliente] error:", err);
  }
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
  // lo ya repartido en depósitos consignados de clientes puntuales. De paso
  // (mismo pedido a Contabilium, sin pegarle más veces) se guarda también el
  // desglose de esos 3 depósitos por separado y el total consignado — lo usa
  // la vista "Stock por depósito" del panel de Productos. Contabilium
  // rate-limita fuerte este endpoint (429 con concurrencia baja incluso),
  // así que vamos secuencial con pausa entre cada llamada.
  const desgloseMap = new Map();
  const disponibleErrors = [];
  for (const c of conceptos) {
    // Si otro sync (o este mismo, en una vuelta anterior) ya detectó el
    // bloqueo y pausó todo, cortamos acá en vez de seguir insistiendo SKU
    // por SKU — lo que queda sin traer simplemente mantiene el último valor
    // bueno que ya tenía Firestore.
    if (await syncsContabiliumPausados(db)) {
      console.warn("[contabilium] stock sync: cortado a mitad de camino, syncs pausados");
      break;
    }
    const code = (c.Codigo || "").trim();
    if (!code) continue;
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      try {
        const desglose = await getStockDesglosadoBySKU(email, apiKey, code);
        desgloseMap.set(code, desglose);
        ok = true;
      } catch (err) {
        const is429 = /error 429/.test(String(err));
        if (attempt === 4) {
          console.error(`[contabilium] stock disponible ${code}:`, err);
          disponibleErrors.push({ code, error: String(err) });
          if (is429) await pausarSyncsAutomaticamente(db, `doContabiliumSync/${code}`);
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
    const desglose = desgloseMap.get(code);
    conceptoMap[code] = {
      stock: desglose ? desglose.propiosTotal : Math.round(c.Stock || 0),
    };
  }

  const snapshot = await db.collection("products").get();

  // OJO: acá solo se sincroniza STOCK, nunca precio. El precio ("priceArs")
  // tiene una sola dirección válida: Samurai → Contabilium, vía
  // adminSincronizarPreciosCatalogo — ese endpoint lo dice explícito ("la
  // única fuente de verdad del precio con IVA es Samurai"). Este sync acá
  // ANTES también traía Contabilium.PrecioFinal → Firestore.priceArs, lo
  // cual iba justo al revés: si alguien actualizaba precios en Firestore
  // pero la sincronización hacia Contabilium fallaba o tardaba, este sync
  // (corre cada 5 min) pisaba el precio nuevo con el viejo de Contabilium
  // antes de que se pudiera corregir — pasó de verdad el 16/10/2026 con el
  // aumento de precios. Se saca por completo esa pata.
  const updates = [];
  for (const docSnap of snapshot.docs) {
    const { sku, stock } = docSnap.data();
    const skuStr = (sku || "").toString().trim();
    if (!skuStr || !(skuStr in conceptoMap)) continue;
    const { stock: newStock } = conceptoMap[skuStr];
    if (newStock !== stock) {
      updates.push({ ref: docSnap.ref, stock: newStock });
    }
  }

  for (let i = 0; i < updates.length; i += 499) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 499)) {
      batch.update(u.ref, {
        stock:     u.stock,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  // Desglose por depósito (Lavalle/Cañuelas/Credifin/consignado), SKU por
  // SKU — aparte de los documentos públicos de "products" (que lee el
  // catálogo de cualquier visitante) para no exponer ahí cuánto stock
  // interno/consignado tiene la empresa. Mismo patrón que
  // businessDashboardDetail/remitosDespachosDetail: un doc de meta, solo
  // para el panel admin. Trae también nombre/categoría desde "products"
  // para no tener que cruzarlo de nuevo del lado del cliente.
  const productBySku = new Map();
  snapshot.docs.forEach((d) => {
    const p = d.data();
    const skuStr = (p.sku || "").toString().trim();
    if (skuStr) productBySku.set(skuStr, p);
  });
  const porSku = [];
  for (const [code, desglose] of desgloseMap) {
    const p = productBySku.get(code);
    if (!p || (p.category || "").toString().toUpperCase() !== "BICICLETAS") continue;
    porSku.push({
      sku: code,
      nombre: p.name || "",
      lavalle: desglose.lavalle,
      canuelas: desglose.canuelas,
      credifin: desglose.credifin,
      propiosTotal: desglose.propiosTotal,
      consignadoTotal: desglose.consignadoTotal,
    });
  }
  // Si Contabilium estuvo caído y no se pudo traer NINGÚN desglose, no pisa
  // el documento con una lista vacía — mejor dejar el último dato bueno
  // (desactualizado) que borrar la vista de un momento a otro.
  if (porSku.length > 0) {
    await db.doc("meta/stockPorDepositoDetail").set({
      porSku,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await db.doc("meta/contabiliumSync").set({
    lastSync: admin.firestore.FieldValue.serverTimestamp(),
    updated:  updates.length,
    total:    conceptos.length,
    errors:   disponibleErrors,
  });

  return { updated: updates.length, total: conceptos.length, disponibleErrors };
}

// Pausa de emergencia para TODOS los syncs automáticos que le pegan a
// Contabilium — para usar cuando Contabilium empieza a devolver 429 en
// cadena (nos corta la cuenta entera por un rato, no solo el endpoint que
// lo disparó) y hace falta dejar de insistir mientras se libera el límite.
// Se activa/desactiva escribiendo `meta/syncControl.pausarSyncsHasta` (un
// timestamp futuro) — cada sync lo chequea al arrancar y si todavía no
// pasó esa fecha, no llama a Contabilium y sale. Se "des-pausa" solo, sin
// necesidad de otro deploy, en cuanto pasa la fecha.
async function syncsContabiliumPausados(db) {
  try {
    const snap = await db.doc("meta/syncControl").get();
    const hasta = snap.data()?.pausarSyncsHasta;
    const hastaDate = hasta?.toDate ? hasta.toDate() : hasta ? new Date(hasta) : null;
    return !!(hastaDate && hastaDate.getTime() > Date.now());
  } catch {
    return false;
  }
}

// Freno automático: lo llama cualquier sync que se encuentre con un 429 de
// Contabilium después de agotar sus reintentos — así, en vez de que cada
// robot siga insistiendo por su cuenta y empeore el bloqueo, el primero que
// se choca contra el límite frena a TODOS los demás un rato (10 min) solo.
// No hace falta que nadie entre a mano a pausar nada la próxima vez.
async function pausarSyncsAutomaticamente(db, motivo) {
  try {
    const hasta = new Date(Date.now() + 10 * 60 * 1000);
    await db.doc("meta/syncControl").set(
      { pausarSyncsHasta: admin.firestore.Timestamp.fromDate(hasta), pausadoAutomaticamentePor: motivo },
      { merge: true }
    );
    console.warn(`[contabilium] 429 detectado (${motivo}) — syncs pausados automáticamente hasta ${hasta.toISOString()}`);
  } catch (e) {
    console.error("[contabilium] no se pudo pausar syncs automáticamente:", e);
  }
}

// ─────────────────────────────────────────────────────────────
// Sync automático cada 5 minutos
// ─────────────────────────────────────────────────────────────
exports.syncContabiliumStock = onSchedule(
  {
    // Era cada 15 min — es, por lejos, el sync que más le pega a
    // Contabilium (un pedido por SKU, secuencial) y el responsable de casi
    // todos los 429 detectados el 22/10/2026. A 30 min se reduce el volumen
    // diario a la mitad sin resentir demasiado la frescura del stock.
    schedule: "every 30 minutes",
    secrets:  [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 300,
  },
  async () => {
    try {
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncContabiliumStock: pausado, salteando");
        return;
      }
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
// Todos los días, chequea si hay clientes de Contabilium (dados de alta ahí
// directamente, sin pasar por el alta de Samurai) que todavía no tienen
// ninguna cuenta acá — y les crea una completa (Auth + Firestore + link de
// invitación por reset de contraseña), mismo criterio que se usó a mano el
// 31/8/2026 para los 61 que se habían acumulado sin vincular. Antes de esto
// no había NADA que detectara este caso — por eso se fueron acumulando.
async function syncClientesContabiliumSinCuenta(email, apiKey) {
  const db = admin.firestore();
  const clientes = await getAllClientes(email, apiKey);
  const clientesPorId = new Map(clientes.map((c) => [c.Id, c]));

  const usersSnap = await db.collection("users").where("kind", "==", "client").get();
  const linkedIds = new Set(usersSnap.docs.map((d) => d.data().contabiliumId).filter((id) => id != null));

  // Además de dar de alta a los que faltan, refresca nombre/CUIT/condición
  // IVA/email de TODOS los ya vinculados contra el dato real de Contabilium
  // — así Clientes 360, el CRM y el mapa nunca quedan con un nombre viejo
  // (ej. el username crudo del alta) aunque nadie toque "Sincronizar" a mano.
  let actualizados = 0;
  {
    let batch = db.batch();
    let opsEnBatch = 0;
    for (const docSnap of usersSnap.docs) {
      const u = docSnap.data();
      if (!u.contabiliumId) continue;
      const c = clientesPorId.get(u.contabiliumId);
      if (!c) continue;
      const nombreReal = (c.RazonSocial || c.NombreFantasia || "").trim() || null;
      const cuitReal = c.NroDoc || null;
      const condicionIvaReal = c.CondicionIva || null;
      const emailReal = c.Email || null;
      const cambia =
        (nombreReal && nombreReal !== u.name) ||
        (cuitReal && cuitReal !== u.cuit) ||
        (condicionIvaReal && condicionIvaReal !== u.condicionIva) ||
        (emailReal !== (u.contabiliumEmail || null));
      if (!cambia) continue;
      batch.update(docSnap.ref, {
        ...(nombreReal ? { name: nombreReal } : {}),
        ...(cuitReal ? { cuit: cuitReal } : {}),
        ...(condicionIvaReal ? { condicionIva: condicionIvaReal } : {}),
        contabiliumEmail: emailReal,
        contabiliumSync: admin.firestore.FieldValue.serverTimestamp(),
      });
      actualizados++;
      opsEnBatch++;
      if (opsEnBatch >= 450) {
        await batch.commit();
        batch = db.batch();
        opsEnBatch = 0;
      }
    }
    if (opsEnBatch > 0) await batch.commit();
  }

  const sinCuenta = clientes.filter((c) => !linkedIds.has(c.Id));
  const creados = [];

  for (const c of sinCuenta) {
    const nombre = (c.RazonSocial || c.NombreFantasia || "").trim();
    if (!nombre) continue;

    const baseSlug = slugifyUsername(nombre);
    let usernameLower = baseSlug;
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await db.collection("users").where("usernameLower", "==", usernameLower).limit(1).get();
      if (existing.empty) break;
      suffix++;
      usernameLower = `${baseSlug}-${suffix}`;
    }

    const hasRealEmail = !!c.Email;
    const email2 = hasRealEmail ? c.Email.toLowerCase() : `${usernameLower}@samurai.internal`;

    let authUser;
    try {
      authUser = await admin.auth().getUserByEmail(email2);
    } catch {
      authUser = await admin.auth().createUser({ email: email2, displayName: nombre });
    }
    const uid = authUser.uid;

    await db.doc(`users/${uid}`).set(
      {
        uid,
        name: nombre,
        username: usernameLower,
        usernameLower,
        email: email2,
        emailLower: email2,
        contactEmail: hasRealEmail ? c.Email : null,
        role: "viewer",
        status: "activo",
        approved: true,
        kind: "client",
        customerTypeId: null,
        creditLimit: null,
        contabiliumId: c.Id,
        cuit: c.NroDoc || null,
        condicionIva: c.CondicionIva || null,
        idListaPrecio: c.IdListaPrecio ?? null,
        contabiliumEmail: c.Email || null,
        contabiliumSync: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        autoCreatedFromContabilium: true,
      },
      { merge: true }
    );

    let link = null;
    try {
      link = await admin.auth().generatePasswordResetLink(email2, { url: `${SITE_URL}/login`, handleCodeInApp: false });
    } catch {
      link = null;
    }

    creados.push({ contabiliumId: c.Id, nombre, uid, hasRealEmail, link });
  }

  if (creados.length > 0) {
    await db.collection("notifications").add({
      type: "clientes_contabilium_auto_creados",
      cantidad: creados.length,
      clientes: creados.map((c) => ({ nombre: c.nombre, uid: c.uid, hasRealEmail: c.hasRealEmail })),
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { totalContabilium: clientes.length, sinCuentaEncontrados: sinCuenta.length, creados: creados.length, actualizados };
}

exports.syncClientesContabiliumSinCuentaDaily = onSchedule(
  {
    schedule: "every day 08:00",
    timeZone: "America/Argentina/Buenos_Aires",
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 300,
  },
  async () => {
    try {
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncClientesContabiliumSinCuentaDaily: pausado, salteando");
        return;
      }
      const result = await syncClientesContabiliumSinCuenta(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      console.log("[contabilium] clientes sin cuenta sync ok:", result);
    } catch (err) {
      console.error("[contabilium] clientes sin cuenta sync error:", err);
    }
  }
);

// Refresco manual desde el panel (staff-only) — mismo chequeo que corre
// solo todos los días a las 8, para poder probarlo/forzarlo sin esperar.
exports.triggerClientesContabiliumSinCuenta = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await syncClientesContabiliumSinCuenta(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      console.error("[contabilium] trigger clientes sin cuenta error:", err);
      return res.status(500).json({ error: String(err) });
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
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncCobranzasDaily: pausado, salteando");
        return;
      }
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

      // En una transferencia saliente (money_transfer), Mercado Pago no manda
      // el nombre del destinatario — solo su ID interno de MP. Lo mandamos
      // igual para que el frontend pueda mostrar un nombre conocido si ya se
      // identificó antes a mano (no hay forma de resolverlo automáticamente).
      const nombreDestinatario = (p) => {
        const c = p.collector;
        if (!c) return null;
        return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || null;
      };

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
          destinatarioId: p.collector?.id || null,
          destinatarioNombre: nombreDestinatario(p),
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
        // El nombre y CUIT quedan alineados con Contabilium en cada sync —
        // así Clientes 360 (que busca por estos dos campos en Firestore) los
        // encuentra siempre, en vez de quedarse con el username crudo del
        // alta ("ilianagarcia" en vez de "ILEANA FERNANDA GARCIA").
        name: client.RazonSocial || client.NombreFantasia || userData.name || null,
        cuit: client.NroDoc || userData.cuit || null,
      };

      await userRef.update(patch);

      return res.json({ ok: true, contabiliumId: client.Id, idListaPrecio: client.IdListaPrecio, name: patch.name });
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

// Tipos de comprobante que representan una venta/nota real y cuentan para el
// saldo de cuenta corriente de un cliente. Ojo: hay que incluir las
// variantes B y C, no solo A — este Contabilium a veces emite Factura B
// (confirmado con diagTiposComprobante: 11 FCB entre 703 comprobantes), y
// durante un tiempo esas facturas quedaron afuera de todos estos cálculos
// (bug detectado en Clientes 360 con Nicolás Román Paradiso, sept/2026).
// NCT = nota de crédito sobre una Cotización (COT), no sobre una factura real
// (NCA/B/C) — mismo concepto, tipo de documento distinto. Faltaba en todos
// lados: una NC hecha sobre un COT quedaba afuera de los cálculos de "vendido"
// y no restaba nada (bug detectado 20/10/2026, Juliana Peralta López).
const TIPOS_FACTURA_NOTA = ["FCA", "FCB", "FCC", "NCA", "NCB", "NCC", "NCT", "NDA", "NDB", "NDC"];
const TIPOS_SALDO_CON_COT = [...TIPOS_FACTURA_NOTA, "COT"];
// Toda nota de crédito (sobre factura real o sobre cotización) resta —
// antes solo se negaba "NCA", dejando NCB/NCC/NCT contando en positivo.
const TIPOS_NC_NEGATIVOS = ["NCA", "NCB", "NCC", "NCT"];

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
        { tipos: TIPOS_SALDO_CON_COT, desde, hasta }
      );
      const tiposMostrar = tipos && tipos.length ? tipos : TIPOS_FACTURA_NOTA;
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
          Saldo: TIPOS_NC_NEGATIVOS.includes(c.TipoFc) ? -saldoAbs : saldoAbs,
        };
      });

      const saldoTotal = await computeSaldoTotal(db, contabiliumId, rawItemsFull);

      // Cobranzas (pagos) del cliente, con a qué factura quedó aplicada
      // cada una — mismo criterio que la lista de "Cobranzas" de Clientes
      // 360 en el admin, para que el cliente vea de su lado lo mismo que ve
      // Samurai: no solo las facturas, también los pagos y a qué se
      // aplicaron.
      const comprobanteNumeroPorId = new Map(rawItemsFull.map((c) => [c.Id, c.Numero]));
      const cobranzasSnap = await db.collection("cobranzas").where("idPersona", "==", contabiliumId).get();
      const cobranzas = cobranzasSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            numero: data.numero || null,
            fecha: data.fecha || null,
            importeTotal: Number(data.importeReal ?? data.importeTotal ?? 0),
            formasDePago: data.formasDePago || [],
            esReimputacion: !!data.esReimputacion,
            excluirDeSaldo: !!data.excluirDeSaldo,
            detalle: (data.detalle || [])
              .filter((it) => it && it.IDComprobante != null)
              .map((it) => ({ IDComprobante: it.IDComprobante, Importe: it.Importe, numeroFactura: comprobanteNumeroPorId.get(it.IDComprobante) || null })),
          };
        })
        .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));

      return res.json({ items, total: items.length, saldoTotal, cobranzas });
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
exports.onOrderCreated = onDocumentCreated(
  { document: "orders/{orderId}", secrets: [RESEND_API_KEY] },
  async (event) => {
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

    if (customer.uid) {
      const detalleItems = items.map((it) => `• ${it.qty}x ${it.name}`).join("\n");
      await notificarVendedorDeMovimientoCliente(db, RESEND_API_KEY.value(), {
        clienteUid: customer.uid,
        clienteNombre: customer.name || "Cliente sin nombre",
        tipo: "📦 Pedido nuevo",
        detalle: `${detalleItems}\n\nTotal: ${Number(order.total ?? 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}`,
      });
    }
  } catch (err) {
    console.error("[notify] onOrderCreated error:", err);
  }
  }
);

// Mismo aviso por mail que onOrderCreated (ver `notificarVendedorDeMovimientoCliente`),
// disparado cuando un cliente reporta una venta desde "Mi Stock".
exports.onSaleRequestCreated = onDocumentCreated(
  { document: "saleRequests/{id}", secrets: [RESEND_API_KEY] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const s = snap.data() || {};
    try {
      const db = admin.firestore();
      await notificarVendedorDeMovimientoCliente(db, RESEND_API_KEY.value(), {
        clienteUid: s.distributorUid || null,
        clienteNombre: s.distributorName || "Cliente sin nombre",
        tipo: "🚲 Venta reportada",
        detalle: `${s.quantity || 1}x ${s.name || `SKU ${s.sku}`}\nPrecio unitario: ${Number(s.unitPrice || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}`,
      });
    } catch (err) {
      console.error("[notify] onSaleRequestCreated error:", err);
    }
  }
);

// Mismo aviso, disparado cuando se sincroniza una cobranza nueva desde
// Contabilium (un comprobante/pago que se le aplicó a un cliente) — la
// sync (cada 15 min) crea el doc en `cobranzas`, este trigger reacciona a
// esa creación en vez de tener que meterse dentro del loop de sync.
exports.onCobranzaCreated = onDocumentCreated(
  { document: "cobranzas/{id}", secrets: [RESEND_API_KEY] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const c = snap.data() || {};
    if (c.idPersona == null) return;
    try {
      const db = admin.firestore();
      const detalleFacturas = (c.detalle || [])
        .filter((d) => d && d.IDComprobante != null)
        .map((d) => `• factura #${d.IDComprobante} — ${Number(d.Importe || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}`)
        .join("\n");
      await notificarVendedorDeMovimientoCliente(db, RESEND_API_KEY.value(), {
        clienteContabiliumId: c.idPersona,
        clienteNombre: c.razonSocial || "Cliente sin nombre",
        tipo: "💳 Comprobante aplicado",
        detalle: `Cobranza Nº ${c.numero || snap.id} — ${Number(c.importeReal ?? c.importeTotal ?? 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}${detalleFacturas ? `\n\n${detalleFacturas}` : ""}`,
      });
    } catch (err) {
      console.error("[notify] onCobranzaCreated error:", err);
    }
  }
);

// Chequeo diario de vehículo: cuando el chofer lo envía (nuevo o
// reenviado tras un rechazo) le avisa a los admins para que lo revisen;
// cuando un admin lo aprueba/rechaza le avisa al chofer — en los dos casos
// con push (con sonido en el celular), no solo la campanita interna.
exports.onChequeoVehiculoWritten = onDocumentWritten("chequeosVehiculo/{id}", async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!after) return;

  try {
    if (after.estado === "pendiente" && before?.estado !== "pendiente") {
      await enviarPushAAdmins({
        title: "🚐 Chequeo de vehículo",
        body: `${after.choferNombre || "Un chofer"} envió su chequeo del ${after.fecha} — necesita tu OK.`,
        link: "/admin/chequeos-vehiculo",
      });
    } else if (after.estado !== "pendiente" && before?.estado !== after.estado) {
      const aprobado = after.estado === "aprobado";
      await enviarPushAUsuario(after.choferUid, {
        title: aprobado ? "✅ Chequeo aprobado" : "⚠️ Chequeo rechazado",
        body: aprobado
          ? "Ya tenés el OK para arrancar."
          : after.comentarioAdmin || "Corregí lo que haga falta y volvé a enviarlo.",
        link: "/chofer/chequeo-vehiculo",
      });
    }
  } catch (err) {
    console.error("[onChequeoVehiculoWritten] error:", err);
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
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncOrderStatuses: pausado, salteando");
        return;
      }
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
  // "chofer" entra acá también: necesita pegarle a los mismos endpoints
  // staff-only que usan el mapa y stock consignado (getClientesConUbicacion,
  // listContabiliumClientes, getDepositoStockAdmin, etc.) — el panel de
  // chofer solo expone esas 3 secciones en el frontend, pero el permiso de
  // backend queda al mismo nivel que admin.
  const staffRoles = ["admin", "chofer"];
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
      const { documento, telefono, email, nombre } = req.body || {};
      const contabiliumEmail = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      // Sin CUIT: alta manual mínima (consumidor final), sin pasar por AFIP —
      // para depósitos/clientes sin documento fiscal (ej. puntos de venta
      // propios de la marca, como "Samurai Adrogue"). `crearCliente` no
      // devuelve un Id consistente, así que se lo busca después por nombre.
      if (!documento) {
        if (!nombre || !String(nombre).trim()) {
          return res.status(400).json({ error: "Sin documento, falta nombre (RazonSocial) para el alta manual" });
        }
        const razonSocial = String(nombre).trim();
        const payload = {
          RazonSocial: razonSocial,
          NombreFantasia: razonSocial,
          CondicionIva: "CF",
          TipoDoc: "DNI",
          NroDoc: "",
          Pais: "Argentina",
          Telefono: telefono || "",
          Email: email || "",
          Personeria: "F",
        };
        await crearCliente(contabiliumEmail, apiKey, payload);
        await new Promise((r) => setTimeout(r, 1500));
        const candidatos = await searchClientesByFiltro(contabiliumEmail, apiKey, razonSocial);
        const creado = candidatos.find((c) => (c.RazonSocial || "").trim().toUpperCase() === razonSocial.toUpperCase());
        if (!creado) {
          return res.status(500).json({ error: "El cliente se creó pero no se pudo confirmar su Id — revisalo a mano en Contabilium", payload });
        }
        return res.json({ ok: true, payload, contabiliumId: creado.Id });
      }

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

// Busca a qué cliente corresponde un número de teléfono — la búsqueda normal
// (adminSearchContabiliumClientes) solo filtra por nombre/CUIT contra el
// "filtro" de Contabilium, que no matchea teléfono. Acá se trae la base
// completa de clientes y se compara en memoria, normalizando a solo dígitos
// y comparando por sufijo (así "+54 9 11 3060-0478", "01130600478" y
// "1130600478" matchean entre sí sin importar el formato exacto cargado).
function soloDigitos(s) {
  return String(s || "").replace(/\D/g, "");
}

// Contabilium tiene clientes con el campo Ciudad cargado literalmente como
// "SIN IDENTIFICAR" (u otros placeholders parecidos) en vez de vacío — un
// dato mal cargado del lado de Contabilium, no algo que dependa de nuestro
// código. Se filtra acá, centralizado, para que no se muestre como si fuera
// una ciudad real en ningún lado (mapa, Clientes 360, exports, etc).
const CIUDADES_INVALIDAS = new Set(["SIN IDENTIFICAR", "SIN ESPECIFICAR", "SIN DATOS", "N/A", "NA", "-"]);
function limpiarCiudad(ciudad) {
  const c = String(ciudad || "").trim();
  if (!c || CIUDADES_INVALIDAS.has(c.toUpperCase())) return "";
  return c;
}

exports.adminBuscarClientePorTelefono = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const telefono = String(req.query.telefono || "").trim();
      const digitos = soloDigitos(telefono);
      if (digitos.length < 6) return res.status(400).json({ error: "Falta ?telefono= (mínimo 6 dígitos)" });

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const clientes = await getAllClientes(email, apiKey);

      // Compara los últimos 8 dígitos (el número de línea, sin código de
      // país/área) — es lo único que suele coincidir entre formatos.
      const cola = digitos.slice(-8);
      const resultados = clientes
        .filter((c) => {
          const tel1 = soloDigitos(c.Telefono);
          const tel2 = soloDigitos(c.Celular);
          return (tel1 && tel1.slice(-8) === cola) || (tel2 && tel2.slice(-8) === cola);
        })
        .map((c) => ({
          contabiliumId: c.Id,
          razonSocial: c.RazonSocial,
          cuit: c.NroDoc || null,
          telefono: c.Telefono || null,
          celular: c.Celular || null,
          email: c.Email || null,
        }));

      return res.json({ total: resultados.length, resultados });
    } catch (err) {
      console.error("[adminBuscarClientePorTelefono] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncAutoLinkClientes: pausado, salteando");
        return;
      }
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

// Crea la ficha de Cliente en Contabilium a partir del CUIT (padrón AFIP,
// mismo criterio que adminCrearClienteContabilium) y devuelve los datos ya
// resueltos para guardar en el user doc de Samurai. Separado en su propia
// función para poder llamarlo tanto desde ese endpoint como desde el alta
// de usuario nueva (createUserWithPassword) sin duplicar la lógica.
async function crearClienteContabiliumDesdeCuit(email, apiKey, { cuit, telefono, contactEmail }) {
  const afip = await getDatosAfip(email, apiKey, cuit);
  if (!afip || !afip.RazonSocial) {
    throw new Error("AFIP no devolvió datos para ese CUIT — revisalo o cargá el cliente a mano en Contabilium.");
  }
  const payload = {
    RazonSocial: afip.RazonSocial,
    NombreFantasia: afip.RazonSocial,
    CondicionIva: afip.CategoriaImpositiva || "CF",
    TipoDoc: afip.TipoDoc || "CUIT",
    NroDoc: afip.NroDoc || String(cuit).replace(/\D/g, ""),
    Pais: "Argentina",
    Provincia: afip.ProvinciaNombre || "",
    Ciudad: afip.CiudadNombre || "",
    Domicilio: afip.Domicilio || "",
    PisoDepto: afip.PisoDto || "",
    Cp: afip.CodigoPostal || "",
    Telefono: telefono || "",
    Email: contactEmail || "",
    Personeria: afip.Personeria || "F",
  };
  await crearCliente(email, apiKey, payload);
  // crearCliente no devuelve un Id consistente entre respuestas — se busca
  // el cliente recién creado por CUIT para tener su Id real de Contabilium.
  const creado = await searchClientByDoc(email, apiKey, payload.NroDoc);
  if (!creado) {
    throw new Error("El cliente se creó en Contabilium pero no se pudo confirmar su Id — revisalo a mano.");
  }
  return {
    contabiliumId: creado.Id,
    razonSocial: creado.RazonSocial || afip.RazonSocial,
    condicionIva: payload.CondicionIva,
    cuit: payload.NroDoc,
  };
}

exports.createUserWithPassword = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { name, password, cuit, telefono, depositoId, depositoNombre } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Nombre requerido" });
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }
      const cuitLimpio = cuit ? String(cuit).replace(/\D/g, "") : "";
      if (cuit && cuitLimpio.length !== 11) {
        return res.status(400).json({ error: "El CUIT debe tener 11 dígitos" });
      }

      const db = admin.firestore();

      // Si se pasó CUIT, primero se crea (o falla) el cliente en Contabilium
      // — así no queda una cuenta Samurai creada sin su contraparte real
      // cuando algo sale mal (CUIT inválido, AFIP caído, etc.).
      let contabiliumDatos = null;
      if (cuitLimpio) {
        contabiliumDatos = await crearClienteContabiliumDesdeCuit(
          CONTABILIUM_EMAIL.value(),
          CONTABILIUM_API_KEY.value(),
          { cuit: cuitLimpio, telefono, contactEmail: null }
        );
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
        ...(contabiliumDatos
          ? {
              contabiliumId: contabiliumDatos.contabiliumId,
              cuit: contabiliumDatos.cuit,
              condicionIva: contabiliumDatos.condicionIva,
            }
          : {}),
        ...(depositoId != null
          ? {
              contabiliumDepositoId: Number(depositoId),
              contabiliumDepositoNombre: depositoNombre || null,
            }
          : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({
        uid: authUser.uid,
        username,
        contabiliumId: contabiliumDatos?.contabiliumId || null,
      });
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
// --- Alta de cliente propio, hecha por el distribuidor mismo (ej. Cuchi
// desde "Mis clientes") — pensado para que sea SIEMPRE un flujo de 2 pasos
// bien separados, nunca uno solo que mezcle todo:
//   Paso 1: distribuidorCrearCliente → crea el cliente en Contabilium (con
//   los datos del padrón AFIP, mismo criterio que createUserWithPassword) Y
//   el usuario Samurai, y recién si Contabilium confirmó que quedó creado
//   (se busca por CUIT, igual que crearClienteContabiliumDesdeCuit) lo deja
//   ya asignado como cliente de ESTE distribuidor (vendedoresAsignados) —
//   así no hace falta que un admin lo vincule después a mano.
//   Paso 2: distribuidorCrearDepositoCliente → se habilita una vez que el
//   Paso 1 confirmó. Crea el depósito en Contabilium y lo vincula al mismo
//   cliente (contabiliumDepositoId).
//
// Quién puede usarlo: cualquier usuario que tenga su propio
// `contabiliumDepositoId` cargado (es decir, que es un distribuidor con
// depósito propio, como Cuchi) o el staff.
async function cargarCallerDistribuidor(req, res) {
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
  if (!callerSnap.exists) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return null;
  }
  const caller = callerSnap.data();
  const esStaff = ["admin", "chofer"].includes(caller.role);
  if (!esStaff && !caller.contabiliumDepositoId) {
    res.status(403).json({ error: "No tenés permiso para crear clientes propios." });
    return null;
  }
  return { uid, caller, db };
}

exports.distribuidorCrearCliente = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const ctx = await cargarCallerDistribuidor(req, res);
    if (!ctx) return;
    const { uid: distribuidorUid, db } = ctx;

    try {
      const { name, password, cuit, telefono } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Nombre requerido" });
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }
      const cuitLimpio = cuit ? String(cuit).replace(/\D/g, "") : "";
      if (!cuitLimpio || cuitLimpio.length !== 11) {
        return res.status(400).json({ error: "El CUIT debe tener 11 dígitos" });
      }

      // Paso 1 (Contabilium): crea el cliente desde el padrón AFIP y
      // VERIFICA que quedó creado buscándolo de nuevo por CUIT — si no
      // aparece, tira error y no sigue (no crea el usuario Samurai huérfano).
      const contabiliumDatos = await crearClienteContabiliumDesdeCuit(
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        { cuit: cuitLimpio, telefono, contactEmail: null }
      );

      // Paso 1 (Samurai): usuario propio para ese cliente.
      const base = slugifyUsername(name);
      let username = base;
      let n = 1;
      while (true) {
        const existing = await db.collection("users").where("usernameLower", "==", username).limit(1).get();
        if (existing.empty) break;
        n += 1;
        username = `${base}-${n}`;
      }
      const emailInterno = `${username}@samurai.internal`;
      const authUser = await admin.auth().createUser({
        email: emailInterno,
        password,
        displayName: name.trim(),
      });

      await db.doc(`users/${authUser.uid}`).set({
        uid: authUser.uid,
        name: name.trim(),
        username,
        usernameLower: username,
        email: emailInterno,
        emailLower: emailInterno,
        role: "viewer",
        status: "activo",
        approved: true,
        kind: "client",
        contabiliumId: contabiliumDatos.contabiliumId,
        cuit: contabiliumDatos.cuit,
        condicionIva: contabiliumDatos.condicionIva,
        creadoPorDistribuidorUid: distribuidorUid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Queda asignado como cliente de este distribuidor automáticamente —
      // sin paso de admin aparte.
      await db.doc(`users/${distribuidorUid}`).update({
        vendedoresAsignados: admin.firestore.FieldValue.arrayUnion(authUser.uid),
      });

      return res.json({
        ok: true,
        uid: authUser.uid,
        username,
        contabiliumId: contabiliumDatos.contabiliumId,
        razonSocial: contabiliumDatos.razonSocial,
      });
    } catch (err) {
      console.error("[distribuidorCrearCliente] error:", err);
      const code = err?.errorInfo?.code || err?.code || "";
      if (code.includes("email-already-exists")) {
        return res.status(409).json({ error: "Ya existe un usuario con ese nombre, probá con otro." });
      }
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.distribuidorCrearDepositoCliente = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const ctx = await cargarCallerDistribuidor(req, res);
    if (!ctx) return;
    const { uid: distribuidorUid, caller, db } = ctx;

    try {
      const { clienteUid, nombreDeposito, direccion, telefono } = req.body || {};
      if (!clienteUid || !nombreDeposito || !String(nombreDeposito).trim()) {
        return res.status(400).json({ error: "Faltan datos: clienteUid, nombreDeposito" });
      }

      const esStaff = ["admin", "chofer"].includes(caller.role);
      if (!esStaff) {
        const asignados = Array.isArray(caller.vendedoresAsignados) ? caller.vendedoresAsignados : [];
        if (!asignados.includes(clienteUid)) {
          return res.status(403).json({ error: "Ese cliente no es tuyo." });
        }
      }

      const nombre = String(nombreDeposito).trim();
      const { crearDepositoWeb } = require("./contabiliumWebAutomation");
      await crearDepositoWeb({
        db,
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        nombre,
        direccion: direccion || "",
        telefono: telefono || "",
      });

      // crearDepositoWeb no devuelve el Id nuevo — se confirma y se resuelve
      // buscándolo por nombre exacto en el listado completo de depósitos
      // (getDepositosViaStockBySKU trae TODOS, propios y de consignación,
      // tomando como excusa cualquier SKU real). Se reintenta un par de
      // veces por si el índice de Contabilium tarda un toque en reflejarlo.
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const conceptos = await getAllConceptos(email, apiKey);
      const skuDeReferencia = conceptos[0]?.Codigo;
      if (!skuDeReferencia) throw new Error("No se pudo verificar el depósito creado (sin productos de referencia).");

      let depositoCreado = null;
      for (let intento = 0; intento < 4 && !depositoCreado; intento++) {
        if (intento > 0) await new Promise((r) => setTimeout(r, 2000));
        const depositos = await getDepositosViaStockBySKU(email, apiKey, skuDeReferencia);
        depositoCreado = depositos.find((d) => (d.nombre || "").trim().toLowerCase() === nombre.toLowerCase()) || null;
      }

      if (!depositoCreado) {
        return res.status(500).json({
          error: "El depósito se creó en Contabilium pero no se pudo confirmar su Id todavía — probá de nuevo en un minuto con el mismo nombre, o pedile a un admin que lo vincule a mano.",
        });
      }

      await db.doc(`users/${clienteUid}`).set(
        {
          contabiliumDepositoId: depositoCreado.id,
          contabiliumDepositoNombre: depositoCreado.nombre,
        },
        { merge: true }
      );

      return res.json({ ok: true, depositoId: depositoCreado.id, depositoNombre: depositoCreado.nombre });
    } catch (err) {
      console.error("[distribuidorCrearDepositoCliente] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

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

// Suma, por SKU, la cantidad reportada como vendida que todavía no bajó del
// stock real de Contabilium — para descontarla del stock disponible que se
// muestra. Dos casos cuentan como "todavía no bajó":
//   1. status "pendiente" — ni siquiera se facturó.
//   2. status "facturado" a mano (resolvedBy no es "auto", o sea no pasó por
//      emitirFacturaVenta) y sin que alguien haya confirmado el ajuste de
//      stock real en Contabilium (stockAjustadoManualmente) — la factura
//      puede existir, pero muchas veces se cargó sin vincular el depósito y
//      Contabilium nunca se enteró de descontarla (bug real detectado
//      28/9/2026). Una vez que se ajusta el stock real a mano, hay que
//      marcar stockAjustadoManualmente:true en el saleRequest para que deje
//      de restarse acá (si no, se restaría dos veces).
async function getPendingSoldBySku(db, { distributorUid, depositoId } = {}) {
  let q = distributorUid
    ? db.collection("saleRequests").where("distributorUid", "==", distributorUid)
    : db.collection("saleRequests").where("depositoId", "==", depositoId);
  const snap = await q.get();
  const bySku = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    const esPendiente = data.status === "pendiente";
    const facturadoSinConfirmarStock =
      data.status === "facturado" && data.resolvedBy !== "auto" && !data.stockAjustadoManualmente;
    if (!esPendiente && !facturadoSinConfirmarStock) return;
    const sku = (data.sku || "").toString().trim();
    if (!sku) return;
    bySku[sku] = (bySku[sku] || 0) + Number(data.quantity || 0);
  });
  return bySku;
}

// ─────────────────────────────────────────────────────────────
// Rodados Argentinos opera con 2 depósitos físicos (Adrogué y
// Temperley) pero en Contabilium es un solo cliente/depósito (id
// 134795) — no se le crea un depósito nuevo. Para separarlo
// "virtualmente" por sector se lee el historial completo de
// movimientos de ESE depósito (trae la observación de cada remito o
// transferencia) y se clasifica cada movimiento según si su
// observación menciona "adrogué" o "temperley". Lo que no menciona
// ninguno de los dos cae en "sin clasificar" — para que un movimiento
// nuevo caiga bien hay que escribir esa palabra en la observación al
// hacer la transferencia.
// ─────────────────────────────────────────────────────────────
const RODADOS_ARGENTINOS_DEPOSITO_ID = 134795;
const RODADOS_ARGENTINOS_DEPOSITO_NOMBRE = "RODADOS ARGENTINOS S.A";
const RODADOS_SECTOR_ADROGUE_RE = /adrogu[eé]/i;
const RODADOS_SECTOR_TEMPERLEY_RE = /temperley/i;

function claveSectorRodados(observaciones) {
  const t = observaciones || "";
  if (RODADOS_SECTOR_ADROGUE_RE.test(t)) return "adrogue";
  if (RODADOS_SECTOR_TEMPERLEY_RE.test(t)) return "temperley";
  return "sinClasificar";
}

// La columna "cantidad modificada" de la tabla de movimientos no
// siempre trae el signo explícito — si no lo trae, se infiere de la
// acción (alta/entrada suma, baja/salida/venta/retiro resta).
function parseCantidadModificadaConSigno(cantidadTexto, accionTexto) {
  const str = String(cantidadTexto || "").trim();
  const tieneSignoNegativo = /^-/.test(str);
  const tieneSignoPositivo = /^\+/.test(str);
  const magnitud = Math.abs(Number(str.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "")) || 0);
  if (tieneSignoNegativo) return -magnitud;
  if (tieneSignoPositivo) return magnitud;
  const accion = (accionTexto || "").toLowerCase();
  const esSalida = /baja|salida|venta|retiro|egreso/.test(accion);
  return esSalida ? -magnitud : magnitud;
}

async function buildStockRodadosPorSector(db, email, apiKey, webEmail, webPassword) {
  const { obtenerHistoricoStockReal } = require("./contabiliumWebAutomation");
  const hoy = new Date();
  const fechaHastaStr = `${String(hoy.getDate()).padStart(2, "0")}/${String(hoy.getMonth() + 1).padStart(2, "0")}/${hoy.getFullYear()}`;
  const resultado = await obtenerHistoricoStockReal({
    email: webEmail,
    password: webPassword,
    depositoNombre: RODADOS_ARGENTINOS_DEPOSITO_NOMBRE,
    fechaDesde: "01/01/2020",
    fechaHasta: fechaHastaStr,
    leerTodo: true,
  });
  if (!resultado.ok) {
    throw new Error(resultado.error || "No se pudo leer el historial de movimientos de Rodados Argentinos");
  }

  const filas = resultado.todasLasFilas || [];
  const cantidadPorSectorYCodigo = { adrogue: {}, temperley: {}, sinClasificar: {} };
  for (const fila of filas) {
    const sector = claveSectorRodados(fila.observaciones);
    const delta = parseCantidadModificadaConSigno(fila.cantidadModificada, fila.accion);
    const codigo = (fila.codigo || "").trim();
    if (!codigo) continue;
    cantidadPorSectorYCodigo[sector][codigo] = (cantidadPorSectorYCodigo[sector][codigo] || 0) + delta;
  }

  const productsSnap = await db.collection("products").where("active", "==", true).get();
  const productoPorSku = {};
  productsSnap.docs.forEach((d) => {
    const p = d.data();
    const sku = (p.sku || "").toString().trim();
    if (sku) productoPorSku[sku] = p;
  });

  function armarItems(cantidadPorCodigo) {
    const items = [];
    let total = 0;
    for (const [codigo, cantidad] of Object.entries(cantidadPorCodigo)) {
      if (!cantidad) continue;
      const p = productoPorSku[codigo];
      items.push({
        sku: codigo,
        name: p?.name || codigo,
        category: p?.category || null,
        imageUrl: p?.imageUrl || (p?.images && p.images[0]) || "",
        stockActual: cantidad,
        stockDisponible: cantidad,
      });
      total += cantidad;
    }
    items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return { items, total };
  }

  const sectores = {
    adrogue: armarItems(cantidadPorSectorYCodigo.adrogue),
    temperley: armarItems(cantidadPorSectorYCodigo.temperley),
    sinClasificar: armarItems(cantidadPorSectorYCodigo.sinClasificar),
  };

  let stockTotalReal = null;
  try {
    const stockRaw = await getStockByDepositoWithRetry(email, apiKey, RODADOS_ARGENTINOS_DEPOSITO_ID);
    stockTotalReal = stockRaw.reduce((a, it) => a + Number(it.StockActual || 0), 0);
  } catch (e) {
    console.error("[buildStockRodadosPorSector] no se pudo cruzar contra el stock real:", e);
  }

  return { sectores, stockTotalReal, totalFilasLeidas: filas.length };
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

// Vista de "supervisor regional" — algunos clientes (ej. Alfredo Bavcevich,
// que coordina un grupo de distribuidores propios) necesitan ver un resumen
// de los distribuidores que tienen a cargo (stock consignado, deuda,
// facturas recientes) sin ser staff. El campo `vendedoresAsignados` en su
// propio doc de usuario (array de UIDs) es lo único que habilita esto — sin
// esa lista, ningún endpoint de acá abajo devuelve nada de nadie.
const LAVALLE_DEPOSITO_ID = 135151;

async function bicisDeDepositoResumen(db, email, apiKey, depositoId) {
  if (!depositoId) return [];
  const stockRaw = await getStockByDepositoWithRetry(email, apiKey, depositoId);
  const items = await buildDepositoStockItems(db, email, apiKey, stockRaw);
  return items
    .filter((s) => (s.category || "").toUpperCase() === "BICICLETAS" && Number(s.stockActual || 0) > 0)
    .map((s) => ({ name: s.name, sku: s.sku, stockActual: s.stockActual, priceArs: s.priceArs }));
}

// Trae el resumen (stock, deuda, últimas facturas) de UN solo vendedor. Vive
// separado de la lista liviana (getMisVendedores) para que el frontend pida
// cada vendedor en su propio pedido chico en vez de uno gigante que tarda
// mucho y es mucho más fácil que una conexión inestable lo corte a mitad de
// camino.
async function buildVendedorResumen(db, email, apiKey, vendedorUid) {
  const vSnap = await db.doc(`users/${vendedorUid}`).get();
  if (!vSnap.exists) return { uid: vendedorUid, name: null, error: "Usuario no encontrado" };
  const v = vSnap.data();

  const desdeFecha = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 3);
    return d.toISOString().slice(0, 10);
  })();

  const [bicis, comprobantesInfo] = await Promise.all([
    bicisDeDepositoResumen(db, email, apiKey, v.contabiliumDepositoId),
    v.contabiliumId
      ? getComprobantesByClientId(email, apiKey, v.contabiliumId, { tipos: TIPOS_SALDO_CON_COT, desde: desdeFecha })
      : Promise.resolve([]),
  ]);

  let saldoTotal = null;
  let facturasRecientes = [];
  let modelosVendidos = [];
  if (v.contabiliumId) {
    saldoTotal = comprobantesInfo.reduce((acc, c) => {
      const saldoAbs = parseArNumber(c.Saldo);
      return acc + (TIPOS_NC_NEGATIVOS.includes(c.TipoFc) ? -saldoAbs : saldoAbs);
    }, 0);
    facturasRecientes = comprobantesInfo
      .slice()
      .sort((a, b) => (b.FechaEmision || "").localeCompare(a.FechaEmision || ""))
      .slice(0, 5)
      .map((c) => ({
        numero: c.Numero,
        tipo: c.TipoFc,
        fecha: c.FechaEmision,
        total: parseArNumber(c.ImporteTotalNeto),
        saldo: parseArNumber(c.Saldo),
        pagada: parseArNumber(c.Saldo) === 0,
      }));

    // Qué modelo puntual vendió cada cliente (no solo el total facturado) —
    // pedido explícito 27/10/2026, para que se vea sin tener que abrir cada
    // factura una por una.
    const modelosMap = new Map();
    const detallesItems = await mapWithConcurrency(comprobantesInfo, 3, async (c) => {
      try {
        const full = await getComprobanteById(email, apiKey, c.Id);
        return { c, items: full?.Items || [] };
      } catch {
        return { c, items: [] };
      }
    });
    for (const { c, items } of detallesItems) {
      const signo = TIPOS_NC_NEGATIVOS.includes(c.TipoFc) ? -1 : 1;
      for (const it of items) {
        const modelo = it.Concepto || it.Descripcion || "—";
        modelosMap.set(modelo, (modelosMap.get(modelo) || 0) + signo * (Number(it.Cantidad) || 0));
      }
    }
    modelosVendidos = Array.from(modelosMap.entries())
      .filter(([, cantidad]) => cantidad !== 0)
      .map(([modelo, cantidad]) => ({ modelo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }

  return {
    uid: vendedorUid,
    name: v.name || v.username || "",
    depositoNombre: v.contabiliumDepositoNombre || null,
    stockBicis: bicis.reduce((acc, b) => acc + Number(b.stockActual || 0), 0),
    bicis,
    saldoTotal,
    facturasRecientes,
    modelosVendidos,
  };
}

// Lista liviana (solo Firestore, sin tocar Contabilium) de a quiénes tiene
// asignados el caller — el frontend la usa para pintar las tarjetas al
// toque, y después pide el detalle pesado de cada una por separado con
// getVendedorResumen.
exports.getMisVendedores = onRequest(
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
      const { distribuidorUid } = req.body || {};
      const db = admin.firestore();
      const callerSnap = await db.doc(`users/${uid}`).get();
      if (!callerSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const caller = callerSnap.data();

      // Un admin/chofer puede pedir la cartera de CUALQUIER distribuidor
      // (ej. desde el panel de Vendedores, para ver la misma vista "Mis
      // clientes" que tiene Alfredo en su propia cuenta) pasando
      // distribuidorUid — un distribuidor normal solo puede pedir la suya.
      let targetUid = uid;
      if (distribuidorUid && distribuidorUid !== uid) {
        if (!["admin", "chofer"].includes(caller.role)) {
          return res.status(403).json({ error: "No tenés permiso para ver la cartera de otro distribuidor" });
        }
        targetUid = distribuidorUid;
      }
      const targetSnap = targetUid === uid ? callerSnap : await db.doc(`users/${targetUid}`).get();
      if (!targetSnap.exists) return res.status(404).json({ error: "Distribuidor no encontrado" });
      const target = targetSnap.data();
      const asignados = Array.isArray(target.vendedoresAsignados) ? target.vendedoresAsignados : [];
      if (asignados.length === 0) {
        return res.status(403).json({ error: "No tenés vendedores asignados" });
      }

      const vendedores = await mapWithConcurrency(asignados, 10, async (vendedorUid) => {
        const vSnap = await db.doc(`users/${vendedorUid}`).get();
        if (!vSnap.exists) return { uid: vendedorUid, name: null, error: "Usuario no encontrado" };
        const v = vSnap.data();
        return {
          uid: vendedorUid,
          name: v.name || v.username || "",
          depositoNombre: v.contabiliumDepositoNombre || null,
          depositoId: v.contabiliumDepositoId || null,
          contabiliumId: v.contabiliumId || null,
        };
      });

      return res.json({ vendedores });
    } catch (err) {
      console.error("[getMisVendedores] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Detalle pesado (stock, deuda, facturas) de un solo vendedor puntual — se
// pide uno por uno desde el frontend en vez de todos juntos, así cada
// tarjeta es un pedido chico e independiente.
exports.getVendedorResumen = onRequest(
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
      const { vendedorUid } = req.body || {};
      if (!vendedorUid) return res.status(400).json({ error: "Falta vendedorUid" });

      const db = admin.firestore();
      const callerSnap = await db.doc(`users/${uid}`).get();
      if (!callerSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const caller = callerSnap.data();
      const asignados = Array.isArray(caller.vendedoresAsignados) ? caller.vendedoresAsignados : [];
      // Un admin/chofer puede ver el detalle de cualquier cliente (ej. desde
      // Clientes 360, mirando la cartera de un supervisor como Alfredo) —
      // el chequeo de "está en tu lista" es solo para el propio supervisor.
      if (!["admin", "chofer"].includes(caller.role) && !asignados.includes(vendedorUid)) {
        return res.status(403).json({ error: "Ese vendedor no está en tu lista" });
      }

      const resumen = await buildVendedorResumen(db, CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), vendedorUid);
      return res.json(resumen);
    } catch (err) {
      console.error("[getVendedorResumen] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Detalle completo de SOLO LECTURA de uno de los clientes propios de un
// distribuidor con equipo (ej. Cuchi) — mismo nivel de información que ve un
// admin en Clientes 360 (facturas completas, stock, cobranzas, auditorías,
// ventas/pagos reportados, notas de entrega, teléfono/ubicación), para que
// no tenga que salir de su cuenta y loguearse como admin para verlo. El
// distribuidor solo puede pedir el detalle de un cliente que esté en su
// propio `vendedoresAsignados` — un admin/chofer puede pedir cualquiera.
exports.getVendedorClienteDetalle = onRequest(
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
      const { clienteUid } = req.body || {};
      if (!clienteUid) return res.status(400).json({ error: "Falta clienteUid" });

      const db = admin.firestore();
      const callerSnap = await db.doc(`users/${uid}`).get();
      if (!callerSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const caller = callerSnap.data();
      const asignados = Array.isArray(caller.vendedoresAsignados) ? caller.vendedoresAsignados : [];
      if (!["admin", "chofer"].includes(caller.role) && !asignados.includes(clienteUid)) {
        return res.status(403).json({ error: "Ese cliente no está en tu lista" });
      }

      const clienteSnap = await db.doc(`users/${clienteUid}`).get();
      if (!clienteSnap.exists) return res.status(404).json({ error: "Cliente no encontrado" });
      const cliente = clienteSnap.data();

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const cuitDigitos = soloDigitos(cliente.cuit);

      const [
        comprobantesResult,
        stockResult,
        auditsSnap,
        pagosReportadosSnap,
        chequesSnap,
        ventasReportadasSnap,
        cobranzasSnap,
        notasEntregaSnap,
        contactoInfo,
      ] = await Promise.all([
        cliente.contabiliumId
          ? getComprobantesByClientId(email, apiKey, cliente.contabiliumId, { tipos: TIPOS_SALDO_CON_COT }).then(
              async (rawItemsFull) => {
                const items = rawItemsFull
                  .filter((c) => TIPOS_SALDO_CON_COT.includes(c.TipoFc))
                  .map((c) => {
                    const saldoAbs = parseArNumber(c.Saldo);
                    return {
                      ...c,
                      Tipo: c.TipoFc,
                      Fecha: c.FechaEmision,
                      Total: parseArNumber(c.ImporteTotalNeto),
                      Saldo: TIPOS_NC_NEGATIVOS.includes(c.TipoFc) ? -saldoAbs : saldoAbs,
                    };
                  });
                const saldoTotal = await computeSaldoTotal(db, cliente.contabiliumId, rawItemsFull);
                return { items, saldoTotal };
              }
            )
          : Promise.resolve({ items: [], saldoTotal: 0 }),
        cliente.contabiliumDepositoId != null
          ? getStockByDepositoWithRetry(email, apiKey, cliente.contabiliumDepositoId).then(async (stockItems) => {
              const pendingSoldBySku = await getPendingSoldBySku(db, { depositoId: cliente.contabiliumDepositoId });
              return buildDepositoStockItems(db, email, apiKey, stockItems, { pendingSoldBySku, includeZeroStock: false });
            })
          : Promise.resolve([]),
        cliente.contabiliumDepositoId != null
          ? db
              .collection("stockAudits")
              .where("depositoId", "==", String(cliente.contabiliumDepositoId))
              .orderBy("createdAt", "desc")
              .limit(20)
              .get()
          : Promise.resolve(null),
        cliente.contabiliumId
          ? db.collection("pagosReportados").where("contabiliumId", "==", cliente.contabiliumId).get()
          : Promise.resolve(null),
        cliente.contabiliumId
          ? db.collection("chequesRegistrados").where("contabiliumId", "==", cliente.contabiliumId).get()
          : Promise.resolve(null),
        db.collection("saleRequests").where("distributorUid", "==", clienteUid).get(),
        db.collection("cobranzas").orderBy("fecha", "desc").get(),
        db.collection("notasEntrega").where("clienteUid", "==", clienteUid).orderBy("createdAt", "desc").get(),
        cliente.contabiliumId ? getClientById(email, apiKey, cliente.contabiliumId) : Promise.resolve(null),
      ]);

      const pagosReportados = pagosReportadosSnap
        ? pagosReportadosSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        : [];
      const cheques = chequesSnap
        ? chequesSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        : [];
      const ventasReportadas = ventasReportadasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const cobranzasList = cuitDigitos
        ? cobranzasSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((c) => soloDigitos(c.nroDocumento) === cuitDigitos)
        : [];
      const notasEntrega = notasEntregaSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const audits = auditsSnap ? auditsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];

      return res.json({
        cliente: {
          uid: clienteUid,
          name: cliente.name || cliente.username || "",
          cuit: cliente.cuit || null,
          contabiliumId: cliente.contabiliumId || null,
          contabiliumDepositoId: cliente.contabiliumDepositoId || null,
          contabiliumDepositoNombre: cliente.contabiliumDepositoNombre || null,
        },
        comprobantes: comprobantesResult.items,
        saldoTotal: comprobantesResult.saldoTotal,
        stock: stockResult,
        audits,
        pagosReportados,
        cheques,
        ventasReportadas,
        cobranzas: cobranzasList,
        notasEntrega,
        telefono: contactoInfo?.Telefono || null,
        celular: contactoInfo?.Celular || null,
        ciudad: contactoInfo ? limpiarCiudad(contactoInfo.Ciudad) || null : null,
        provincia: contactoInfo?.Provincia || null,
      });
    } catch (err) {
      console.error("[getVendedorClienteDetalle] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Devuelve el último día de "YYYY-MM" como "YYYY-MM-DD".
function ultimoDiaDelMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return `${mes}-${String(ultimo).padStart(2, "0")}`;
}

// Cuenta corriente mensual de un supervisor con `vendedoresAsignados` (ej.
// Alfredo Bavcevich): cobra flete (monto fijo por cada viaje de la grilla de
// logística que sale de su depósito propio hacia un cliente, contado solo
// — ver más abajo) + comisión (% sobre lo que facturan sus clientes
// asignados ese mes, calculado automático desde Contabilium). Lo puede ver
// el propio vendedor (su uid) o un admin/chofer pasando `vendedorUid`.
function escapeRegExpBackend(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildResumenComision(db, email, apiKey, webEmail, webPassword, targetUid, mes) {
  const targetSnap = await db.doc(`users/${targetUid}`).get();
  if (!targetSnap.exists) throw new Error("Usuario no encontrado");
  const target = targetSnap.data();
  const asignados = Array.isArray(target.vendedoresAsignados) ? target.vendedoresAsignados : [];

  const comisionPorcentaje = Number(target.comisionPorcentaje ?? 5);
  const tarifaFletePorViaje = Number(target.tarifaFletePorViaje ?? 10000);

  // "todo" = sin recorte de fecha, para pedir el historial completo en vez
  // de un mes puntual (ej. "todas las bicis que Cuchi le entregó a sus
  // clientes en general").
  const esTodoElHistorial = mes === "todo";
  const desde = esTodoElHistorial ? "2000-01-01" : `${mes}-01`;
  const hasta = esTodoElHistorial ? new Date().toISOString().slice(0, 10) : ultimoDiaDelMes(mes);

  // Viajes del mes: ya no se cargan a mano — se cuentan solos los
  // movimientos de stock reales de Contabilium (la misma fuente que usa el
  // panel de Remitos y Cobranza / Contador Diario, vía obtenerMovimientosStock
  // → movinventarios/GetPageWithFilters) cuyo "origen" es el depósito del
  // vendedor y cuyo "destino" NO es un depósito propio de Samurai (o sea,
  // una entrega real a un cliente). La grilla de logística propia
  // (logisticaViajes) no sirve acá: no registra viajes con un vendedor
  // como origen. Cada movimiento es por producto, no por viaje — varios
  // productos de un mismo viaje comparten fecha + observaciones, así que
  // se cuentan pares (fecha, observaciones) distintos, no filas.
  // `origenesViajes` (array de palabras, ej. ["CAÑUELAS","CREDIFIN"]) deja
  // elegir a mano de qué depósito(s) salen los viajes de este vendedor,
  // para los casos donde no coincide con su propio nombre (ej. "Jíbaro"
  // maneja viajes que salen de Cañuelas Y Credifin; "Vito" maneja la
  // camioneta de Rodados Argentinos, no la suya propia). Si no está
  // cargado, se sigue derivando del nombre del vendedor como antes (caso
  // Cuchi, que sí sale de su propio depósito).
  const nombreVendedor = (target.contabiliumDepositoNombre || target.name || "").trim();
  // Palabra MÁS LARGA del nombre (en general el apellido), no la primera —
  // un nombre de pila corto y común puede coincidir con el nombre de un
  // cliente/depósito de otra persona y generar falsos positivos.
  const palabraClave = nombreVendedor.split(/\s+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0] || nombreVendedor;
  const origenesExplicitos = Array.isArray(target.origenesViajes) ? target.origenesViajes.filter(Boolean) : [];
  const palabrasOrigen = origenesExplicitos.length ? origenesExplicitos : [palabraClave];
  // Si el vendedor tiene `origenesViajes` cargado a mano (Jíbaro, Credifin,
  // Vito — el grupo "solo flete" de la grilla de logística), es porque su
  // trabajo es mover stock ENTRE depósitos propios de Samurai (ej. Cañuelas
  // → Lavalle) — ahí no hay que excluir el destino aunque sea otro depósito
  // propio, o se pierden viajes reales (confirmado el 19/10/2026: un viaje
  // Cañuelas → Lavalle no se contaba). Para el resto (ej. Cuchi, que deriva
  // su palabra clave del propio nombre) sí corresponde excluir destino
  // propio, porque ahí sí distingue una entrega real a un cliente de un
  // reacomodo interno.
  const esLogisticaSoloFlete = origenesExplicitos.length > 0;
  let viajes = 0;
  let unidadesEntregadas = 0;
  let viajesDetalle = [];
  if (palabrasOrigen.length && webEmail && webPassword) {
    try {
      const { obtenerMovimientosStock } = require("./contabiliumWebAutomation");
      const origenVendedorRe = new RegExp(palabrasOrigen.map(escapeRegExpBackend).join("|"), "i");
      const depositoPropioRe = /lavalle|temperley|ca[ñn]uelas|credifin/i;
      const movimientos = await obtenerMovimientosStock({
        db, email: webEmail, password: webPassword, fechaDesde: desde, fechaHasta: hasta,
      });
      // Se agrupa por el "id" real del movimiento en Contabilium (varios
      // productos de un mismo viaje comparten id) — "observaciones" no es un
      // campo real de la respuesta (el que sí viene es "descripcion"), así
      // que agrupar por fecha+observaciones como antes subcontaba/sobrecontaba
      // viajes.
      // Movimientos con origen Credifin/Jíbaro/etc. que en realidad son un
      // retiro interno hecho por Julián con la camioneta de Rodados (ej.
      // "Retira Julián de Credifin hacia Lavalle") — no es un viaje que el
      // proveedor logístico facture, así que no debe contarse como suyo
      // (confirmado 26/10/2026, caso Credifin).
      //
      // Para la cuenta del propio Julián/Vito el criterio cambia del todo
      // (pedido explícito 26/10/2026, tras auditar a mano): él maneja para
      // CUALQUIER depósito/cliente, no solo el suyo propio ("Rodados") —
      // le lleva mercadería a Cuchi, a Credifin, a Cañuelas, a clientes
      // puntuales, y trae cosas de esos lados hacia Lavalle. Filtrar por
      // origen/destino "RODADOS" se quedaba afuera de casi todo eso. Ahora
      // para su cuenta NO se filtra por origen/destino en absoluto — cuenta
      // CUALQUIER movimiento cuya observación diga que lo llevó/retiró él,
      // venga de donde venga y vaya adonde vaya. "JULIAN BRAUER LARRABURU"
      // es un cliente real (no el chofer) — se excluye a propósito.
      const esCuentaDeJulian = origenesExplicitos.some((o) => /rodados/i.test(o));
      const llevaJulianRe = /juli[aá]n(?!\s*brauer)/i;
      const viajesUnicos = new Set();
      const viajesDetalleMap = new Map(); // id del movimiento -> { fecha, destino, bicis }
      for (const m of movimientos) {
        const origen = (m.origen || "").trim();
        const destino = (m.destino || "").trim();
        const mencionaJulian = llevaJulianRe.test(m.descripcion || "");
        if (esCuentaDeJulian) {
          // Solo "entregas" (destino NO es un depósito propio de Samurai) —
          // lo que vuelve a un depósito propio ya lo cuenta `totalRetirado`
          // en buildInformeCompletoVendedor; sumar acá también lo duplicaba
          // (bug detectado 26/10/2026 al desplegar el criterio ampliado).
          if (!mencionaJulian || depositoPropioRe.test(destino)) continue;
        } else {
          if (!origenVendedorRe.test(origen)) continue;
          if (!esLogisticaSoloFlete && depositoPropioRe.test(destino)) continue;
          if (esLogisticaSoloFlete && mencionaJulian) continue;
        }
        viajesUnicos.add(m.id);
        if (!viajesDetalleMap.has(m.id)) viajesDetalleMap.set(m.id, { id: m.id, fecha: m.fecha || "", destino, bicis: 0 });
        if (/BIC\b/i.test(m.codigoNombre || "")) {
          const cant = Number(m.cantidad || 0);
          unidadesEntregadas += cant;
          viajesDetalleMap.get(m.id).bicis += cant;
        }
      }
      viajes = viajesUnicos.size;
      viajesDetalle = Array.from(viajesDetalleMap.values())
        .filter((v) => v.bicis > 0)
        .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
    } catch (err) {
      console.error("[buildResumenComision] no se pudo traer movimientos de stock para contar viajes:", err.message);
    }
  }
  // Flete por UNIDAD entregada (bicicleta), no por viaje — $10.000 por
  // bici, confirmado 21/10/2026 (antes se cobraba por viaje, que era
  // incorrecto: un viaje puede llevar varias bicis y cobraba lo mismo que
  // uno con una sola).
  // Jíbaro es un caso aparte (confirmado 22/10/2026, mail de Mariana Alvarez):
  // cobra 3.5% de la carga pero el monto puntual hay que consultárselo viaje
  // por viaje, no se puede calcular solo — así que en vez de unidades × tarifa
  // fija, se suma lo que se cargó a mano para cada viaje puntual (0 si
  // todavía no se cargó ese viaje).
  let montosManualesPorViaje = {};
  let fleteTotal;
  if (target.modoFleteManual && viajesDetalle.length > 0) {
    const montosSnap = await db.collection(`users/${targetUid}/montosViajesManuales`).get();
    for (const d of montosSnap.docs) montosManualesPorViaje[d.id] = Number(d.data().monto || 0);
    fleteTotal = viajesDetalle.reduce((acc, v) => acc + (montosManualesPorViaje[String(v.id)] || 0), 0);
  } else {
    fleteTotal = unidadesEntregadas * tarifaFletePorViaje;
  }

  let ventasTotal = 0;
  // Detalle bici por bici (modelo + cliente + comisión de esa venta puntual)
  // — no solo el total agregado, para que el vendedor vea de dónde sale
  // cada peso de lo que tiene que cobrar, no solo el número final.
  const detalle = [];
  if (asignados.length > 0) {
    const clientesSnaps = await Promise.all(asignados.map((cUid) => db.doc(`users/${cUid}`).get()));
    const contabiliumIds = new Set(
      clientesSnaps.filter((s) => s.exists && s.data().contabiliumId).map((s) => s.data().contabiliumId)
    );
    const nombrePorContabiliumId = new Map();
    for (const s of clientesSnaps) {
      if (!s.exists || !s.data().contabiliumId) continue;
      const u = s.data();
      nombrePorContabiliumId.set(u.contabiliumId, u.contabiliumDepositoNombre || u.name || "(sin nombre)");
    }
    if (contabiliumIds.size > 0) {
      const comprobantes = await getAllComprobantes(email, apiKey, { desde, hasta });
      const relevantes = comprobantes.filter(
        (c) => contabiliumIds.has(c.IdCliente) && ["FCA", "FCB", "FCC", "COT", "NCA", "NCB", "NCC", "NCT"].includes(c.TipoFc)
      );
      // Antes pedía el detalle de cada comprobante UNO POR UNO con 150ms de
      // pausa fija entre cada uno — con muchos comprobantes (ej. "Informe
      // completo" de varios meses) eso solo ya tardaba más de un minuto.
      // Contabilium rate-limita fuerte este endpoint (confirmado en otros
      // lugares del código), así que en vez de sacar la pausa del todo se
      // baja a una concurrencia chica (3 a la vez) con una pausa corta —
      // sigue siendo mucho más rápido pero sin arriesgarse a tirar 429.
      const resultadosComprobantes = await mapWithConcurrency(relevantes, 3, async (c) => {
        const signo = TIPOS_NC_NEGATIVOS.includes(c.TipoFc) ? -1 : 1;
        const montoComprobante = parseArNumber(c.ImporteTotalNeto) * signo;
        const nombreCliente = nombrePorContabiliumId.get(c.IdCliente) || c.RazonSocial || "(sin nombre)";
        // La comisión de Cuchi se gana cuando SE COBRA, no cuando se
        // factura/reporta la venta (pedido explícito 27/10/2026) — pero el
        // detalle sigue trayendo TODOS los movimientos igual, para poder ver
        // quién reportó una venta y todavía no pagó.
        const pagada = parseArNumber(c.Saldo) === 0;
        const entries = [];
        try {
          const full = await getComprobanteById(email, apiKey, c.Id);
          const items = full?.Items || [];
          for (const it of items) {
            const montoItem = (Number(it.Total ?? (Number(it.PrecioUnitario) || 0) * (Number(it.Cantidad) || 0)) || 0) * signo;
            entries.push({
              cliente: nombreCliente,
              modelo: it.Concepto || it.Descripcion || "—",
              cantidad: Number(it.Cantidad || 0),
              monto: montoItem,
              comision: montoItem * (comisionPorcentaje / 100),
              pagada,
              tipo: c.TipoFc,
              numero: c.Numero,
              fecha: c.FechaEmision,
            });
          }
        } catch (err) {
          console.warn("[buildResumenComision] no se pudo traer el detalle del comprobante", c.Id, err.message);
          // Sin el detalle de items no queda registro bici por bici, pero el
          // comprobante entero ya se suma a ventasTotal — al menos el total
          // agregado no queda mal, solo el desglose de esa factura puntual.
          entries.push({
            cliente: nombreCliente,
            modelo: `(no se pudo traer el detalle de ${c.Numero})`,
            cantidad: null,
            monto: montoComprobante,
            comision: montoComprobante * (comisionPorcentaje / 100),
            pagada,
            tipo: c.TipoFc,
            numero: c.Numero,
            fecha: c.FechaEmision,
          });
        }
        await new Promise((r) => setTimeout(r, 50));
        return { montoComprobante, entries };
      });
      for (const r of resultadosComprobantes) {
        ventasTotal += r.montoComprobante;
        detalle.push(...r.entries);
      }
    }
  }

  detalle.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));

  // La comisión se paga sobre TODO lo reportado/facturado, se haya cobrado
  // o no (revertido 27/10/2026 — el filtro "solo lo cobrado" duplicaba lo
  // que ya hace `totalCobradoPorVendedor` en el informe completo, que resta
  // lo que el vendedor ya cobró él mismo del total). `detalle` sigue
  // trayendo el flag `pagada` por ítem para poder ver quién no pagó.
  const ventasCobradas = detalle.reduce((acc, d) => acc + (d.pagada ? d.monto : 0), 0);
  const comisionTotal = ventasTotal * (comisionPorcentaje / 100);
  const totalACobrar = fleteTotal + comisionTotal;

  return {
    mes,
    viajes,
    unidadesEntregadas,
    tarifaFletePorViaje,
    fleteTotal,
    comisionPorcentaje,
    ventasTotal,
    ventasCobradas,
    comisionTotal,
    totalACobrar,
    cantidadClientesAsignados: asignados.length,
    detalle,
    modoFleteManual: !!target.modoFleteManual,
    viajesDetalle: target.modoFleteManual
      ? viajesDetalle.map((v) => ({ ...v, monto: montosManualesPorViaje[String(v.id)] ?? null }))
      : [],
  };
}

exports.getResumenComisionVendedor = onRequest(
  // El desglose bici por bici pide el detalle de cada comprobante por
  // separado (getComprobanteById) — con varias facturas en el mes puede
  // tardar más que el timeout corto original.
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 180, memory: "1GiB", concurrency: 1 },
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
      const { mes, vendedorUid } = req.body || {};
      if (!mes || (mes !== "todo" && !/^\d{4}-\d{2}$/.test(mes))) return res.status(400).json({ error: "Falta mes (formato YYYY-MM, o todo para el historial completo)" });

      const db = admin.firestore();
      let targetUid = uid;
      if (vendedorUid && vendedorUid !== uid) {
        const callerSnap = await db.doc(`users/${uid}`).get();
        const caller = callerSnap.exists ? callerSnap.data() : null;
        if (!caller || !["admin", "chofer"].includes(caller.role)) {
          return res.status(403).json({ error: "No tenés permiso para ver la cuenta de otro vendedor" });
        }
        targetUid = vendedorUid;
      }

      const resumen = await buildResumenComision(
        db,
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        CONTABILIUM_WEB_EMAIL.value(),
        CONTABILIUM_WEB_PASSWORD.value(),
        targetUid,
        mes
      );
      return res.json(resumen);
    } catch (err) {
      console.error("[getResumenComisionVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Excel descargable de UN mes puntual para un vendedor con
// `vendedoresAsignados` (ej. Alfredo "Cuchi" Bavcevich) — tres solapas:
// Resumen (flete/ventas/comisión del mes), Viajes (cada viaje real desde su
// depósito a un cliente, con los productos que llevó) y Ventas (factura por
// factura, línea por línea, de sus clientes asignados). Reusa
// buildResumenComision para las ventas (misma lógica ya probada); para los
// viajes arma la lista detallada acá mismo, agrupando los movimientos de
// stock por su "id" real de Contabilium (que si viaja en cada línea y es la
// forma confiable de saber qué productos salieron juntos en un mismo viaje
// — el campo "observaciones" que usaba buildResumenComision para contar
// viajes no existe en la respuesta real, el que sí viene es "descripcion").
exports.descargarResumenVendedorExcel = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 180, memory: "1GiB", concurrency: 1 },
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
      const { mes, vendedorUid } = req.body || {};
      if (!mes || (mes !== "todo" && !/^\d{4}-\d{2}$/.test(mes))) return res.status(400).json({ error: "Falta mes (formato YYYY-MM, o todo para el historial completo)" });

      const db = admin.firestore();
      let targetUid = uid;
      if (vendedorUid && vendedorUid !== uid) {
        const callerSnap = await db.doc(`users/${uid}`).get();
        const caller = callerSnap.exists ? callerSnap.data() : null;
        if (!caller || !["admin", "chofer"].includes(caller.role)) {
          return res.status(403).json({ error: "No tenés permiso para ver la cuenta de otro vendedor" });
        }
        targetUid = vendedorUid;
      }

      const targetSnap = await db.doc(`users/${targetUid}`).get();
      if (!targetSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const target = targetSnap.data();
      const nombreVendedor = target.contabiliumDepositoNombre || target.name || "Vendedor";

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const webEmail = CONTABILIUM_WEB_EMAIL.value();
      const webPassword = CONTABILIUM_WEB_PASSWORD.value();

      const resumen = await buildResumenComision(db, email, apiKey, webEmail, webPassword, targetUid, mes);

      const desde = `${mes}-01`;
      const hasta = ultimoDiaDelMes(mes);
      const { obtenerMovimientosStock } = require("./contabiliumWebAutomation");
      const movimientos = await obtenerMovimientosStock({ db, email: webEmail, password: webPassword, fechaDesde: desde, fechaHasta: hasta });

      // Palabra MÁS LARGA del nombre (en general el apellido), no la primera —
  // un nombre de pila corto y común puede coincidir con el nombre de un
  // cliente/depósito de otra persona y generar falsos positivos.
  const palabraClave = nombreVendedor.split(/\s+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0] || nombreVendedor;
      const origenesExplicitos = Array.isArray(target.origenesViajes) ? target.origenesViajes.filter(Boolean) : [];
      const palabrasOrigen = origenesExplicitos.length ? origenesExplicitos : [palabraClave];
      // Ver comentario en buildResumenComision: con origenesViajes cargado
      // (grupo "solo flete" de la grilla de logística) no se excluye destino
      // propio, porque ahí el trabajo es mover entre depósitos de Samurai.
      const esLogisticaSoloFlete = origenesExplicitos.length > 0;
      const origenRe = new RegExp(palabrasOrigen.map(escapeRegExpBackend).join("|"), "i");
      const depositoPropioRe = /lavalle|temperley|ca[ñn]uelas|credifin/i;
      // Ver comentario largo más arriba (caso Credifin + cuenta de Julián, 26/10/2026).
      const esCuentaDeJulian = origenesExplicitos.some((o) => /rodados/i.test(o));
      const llevaJulianRe = /juli[aá]n(?!\s*brauer)/i;

      const viajesMap = new Map();
      for (const m of movimientos) {
        const origen = (m.origen || "").trim();
        const destino = (m.destino || "").trim();
        const mencionaJulian = llevaJulianRe.test(m.descripcion || "");
        if (esCuentaDeJulian) {
          if (!mencionaJulian || depositoPropioRe.test(destino)) continue;
        } else {
          if (!origenRe.test(origen)) continue;
          if (!esLogisticaSoloFlete && depositoPropioRe.test(destino)) continue;
          if (esLogisticaSoloFlete && mencionaJulian) continue;
        }
        const key = m.id;
        if (!viajesMap.has(key)) {
          viajesMap.set(key, { fecha: m.fecha || "", destino, descripcion: m.descripcion || "", items: [] });
        }
        viajesMap.get(key).items.push({ producto: m.codigoNombre || "", cantidad: m.cantidad != null ? Number(m.cantidad) : null });
      }
      const viajes = Array.from(viajesMap.values()).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
      // Flete por UNIDAD entregada (bicicleta), no por viaje — ver comentario
      // en buildResumenComision.
      const unidadesEntregadas = viajes.reduce(
        (acc, v) => acc + v.items.reduce((a, it) => a + (/BIC\b/i.test(it.producto || "") ? Number(it.cantidad || 0) : 0), 0),
        0
      );

      const XLSX = require("xlsx");
      const wb = XLSX.utils.book_new();

      const fleteTotal = unidadesEntregadas * resumen.tarifaFletePorViaje;
      const resumenRows = [
        { Campo: "Vendedor", Valor: nombreVendedor },
        { Campo: "Mes", Valor: mes },
        { Campo: "Viajes", Valor: viajes.length },
        { Campo: "Unidades entregadas (bicis)", Valor: unidadesEntregadas },
        { Campo: "Tarifa flete por unidad", Valor: resumen.tarifaFletePorViaje },
        { Campo: "Flete total", Valor: fleteTotal },
        { Campo: "Ventas (neto)", Valor: Math.round(resumen.ventasTotal) },
        { Campo: "% comisión", Valor: resumen.comisionPorcentaje },
        { Campo: "Comisión", Valor: Math.round(resumen.comisionTotal) },
        { Campo: "Total a cobrar", Valor: Math.round(fleteTotal + resumen.comisionTotal) },
      ];
      const wsResumen = XLSX.utils.json_to_sheet(resumenRows, { header: ["Campo", "Valor"] });
      wsResumen["!cols"] = [{ wch: 24 }, { wch: 32 }];
      XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

      const viajesRows = [];
      viajes.forEach((v, idx) => {
        v.items.forEach((it, j) => {
          viajesRows.push({
            "N° Viaje": j === 0 ? idx + 1 : "",
            "Fecha y hora": v.fecha,
            "Cliente destino": v.destino,
            Producto: it.producto,
            Cantidad: it.cantidad,
            Descripción: v.descripcion,
          });
        });
      });
      const wsViajes = XLSX.utils.json_to_sheet(viajesRows, {
        header: ["N° Viaje", "Fecha y hora", "Cliente destino", "Producto", "Cantidad", "Descripción"],
      });
      wsViajes["!cols"] = [{ wch: 9 }, { wch: 20 }, { wch: 28 }, { wch: 42 }, { wch: 10 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, wsViajes, "Viajes");

      const ventasRows = (resumen.detalle || []).map((d) => ({
        Fecha: d.fecha,
        Cliente: d.cliente,
        "N° Factura": d.numero,
        Tipo: d.tipo,
        Producto: d.modelo,
        Cantidad: d.cantidad,
        Monto: Math.round(d.monto || 0),
        Comisión: Math.round(d.comision || 0),
      }));
      const wsVentas = XLSX.utils.json_to_sheet(ventasRows, {
        header: ["Fecha", "Cliente", "N° Factura", "Tipo", "Producto", "Cantidad", "Monto", "Comisión"],
      });
      wsVentas["!cols"] = [{ wch: 20 }, { wch: 26 }, { wch: 15 }, { wch: 7 }, { wch: 42 }, { wch: 9 }, { wch: 14 }, { wch: 13 }];
      XLSX.utils.book_append_sheet(wb, wsVentas, "Ventas");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = buf.toString("base64");

      return res.json({ ok: true, base64, filename: `${nombreVendedor} - ${mes}.xlsx` });
    } catch (err) {
      console.error("[descargarResumenVendedorExcel] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Panel "en vivo" de clientes de un vendedor con `vendedoresAsignados` (ej.
// Cuchi) — a diferencia de buildResumenComision (que cuenta "viajes" rastreando
// el origen del movimiento, con todos los problemas de atribución que eso
// trae: devoluciones, entregas directas desde Lavalle sin pasar por su
// depósito, origen mal cargado), acá la regla es mucho más simple y a
// prueba de esos casos (decidido 19/10/2026 después de confirmarlo con
// varios clientes reales): no importa por dónde entró la mercadería,
//   ENTREGADO (por cliente) = stock actual consignado + vendido
// "Vendido" incluye COT (Contabilium los usa como venta informal sin CAE,
// antes se excluían y el total daba mal) y se cuenta desde `desde` (default:
// la fecha de alta del propio vendedor, o se puede pasar explícito). Un
// comprobante cuenta "pagado" solo si su Saldo es exactamente 0 — si hay un
// pago parcial no se da por pagado solo, queda pendiente.
async function buildPanelClientesVendedor(db, email, apiKey, targetUid, desdeOverride) {
  const targetSnap = await db.doc(`users/${targetUid}`).get();
  if (!targetSnap.exists) throw new Error("Usuario no encontrado");
  const target = targetSnap.data();
  const asignados = Array.isArray(target.vendedoresAsignados) ? target.vendedoresAsignados : [];

  const desde = desdeOverride || (target.createdAt?.toDate ? target.createdAt.toDate().toISOString().slice(0, 10) : "2000-01-01");

  const clientesSnaps = await Promise.all(asignados.map((u) => db.doc(`users/${u}`).get()));
  const clientes = clientesSnaps
    .filter((s) => s.exists)
    .map((s) => s.data())
    .filter((d) => d.contabiliumId && d.contabiliumDepositoId);

  // Confirmación manual de cobros que Contabilium no vincula explícito a la
  // factura (ej. un cobro que cubre el total pero quedó cargado como pago a
  // cuenta corriente general, no aplicado factura por factura) — cargado a
  // mano por el dueño del negocio, nunca se adivina ni se asume solo. Si un
  // comprobante está en esta lista cuenta como pagado aunque su Saldo en
  // Contabilium no sea $0. `montosParciales` cubre el caso de un pago
  // PARCIAL confirmado a mano (ej. una cotización de $342.000 de la que
  // solo se cobraron $305.000) — ahí se usa ese monto exacto en vez de
  // "todo o nada" (pedido explícito 21/10/2026).
  const pagosManualesSnap = await db.doc(`pagosManualesConfirmados/${targetUid}`).get();
  const pagosManualesData = pagosManualesSnap.exists ? pagosManualesSnap.data() : {};
  const numerosConfirmados = new Set(pagosManualesData.numeros || []);
  const montosParciales = pagosManualesData.montosParciales || {};
  const pagosPorNumero = pagosManualesData.pagosPorNumero || {}; // formato nuevo, con cliente/producto ya guardados

  const resultados = [];
  let totalEntregado = 0, totalVendido = 0, totalPagado = 0, totalCobradoDinero = 0;

  for (const cliente of clientes) {
    let stockTotal = 0;
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const stockRaw = await getStockByDepositoWithRetry(email, apiKey, cliente.contabiliumDepositoId);
        const items = await buildDepositoStockItems(db, email, apiKey, stockRaw);
        stockTotal = items
          .filter((it) => (it.category || "").toUpperCase() === "BICICLETAS")
          .reduce((a, b) => a + (Number(b.stockActual) || 0), 0);
        break;
      } catch (err) {
        if (intento === 3) console.error("[buildPanelClientesVendedor] stock falló", cliente.name, err.message);
        else await sleep(1500 * intento);
      }
    }

    const comprobantes = await getComprobantesByClientId(email, apiKey, cliente.contabiliumId, {
      tipos: ["FCA", "FCB", "FCC", "COT", "NCA", "NCB", "NCC", "NCT"],
      desde,
    });

    // Concurrencia chica (3) en vez de uno por uno con pausa — mismo
    // criterio que en buildResumenComision, para no tardar tanto en
    // clientes con muchos comprobantes sin arriesgarse a un 429.
    let vendidoCliente = 0, pagadoCliente = 0, cobradoDineroCliente = 0;
    // Qué modelo puntual es cada bici vendida — no alcanza con el número
    // total, hay que poder ver de dónde sale (pedido explícito 26/10/2026).
    const modelosMap = new Map(); // modelo -> cantidad (con NC restando)
    const resultadosComprobantesCliente = await mapWithConcurrency(comprobantes, 3, async (c) => {
      let cant = 0;
      let items = [];
      try {
        const full = await getComprobanteById(email, apiKey, c.Id);
        items = full?.Items || [];
        cant = items.reduce((a, it) => a + (Number(it.Cantidad) || 0), 0);
      } catch (err) {
        console.error("[buildPanelClientesVendedor] detalle comprobante falló", c.Id, err.message);
      }
      await new Promise((r) => setTimeout(r, 40));
      return { c, cant, items };
    });
    for (const { c, cant, items } of resultadosComprobantesCliente) {
      const signo = (c.TipoFc || "").startsWith("NC") ? -1 : 1;
      vendidoCliente += signo * cant;
      for (const it of items) {
        const modelo = it.Concepto || it.Descripcion || "—";
        modelosMap.set(modelo, (modelosMap.get(modelo) || 0) + signo * (Number(it.Cantidad) || 0));
      }
      const pagoManual = pagosPorNumero[c.Numero];
      if (parseArNumber(c.Saldo) === 0 || numerosConfirmados.has(c.Numero) || pagoManual?.tipo === "completo") {
        pagadoCliente += signo * cant;
        cobradoDineroCliente += signo * (pagoManual ? pagoManual.monto : parseArNumber(c.ImporteTotalNeto));
      } else if (montosParciales[c.Numero] != null) {
        // Pago parcial confirmado a mano (formato viejo) — no suma a
        // "pagado" (bicis, es todo o nada por unidad) pero sí al monto real
        // cobrado en dinero.
        cobradoDineroCliente += signo * Number(montosParciales[c.Numero]);
      } else if (pagoManual?.tipo === "parcial") {
        cobradoDineroCliente += signo * Number(pagoManual.monto || 0);
      }
    }

    const entregadoCliente = stockTotal + vendidoCliente;
    totalEntregado += entregadoCliente;
    totalVendido += vendidoCliente;
    totalPagado += pagadoCliente;
    totalCobradoDinero += cobradoDineroCliente;

    const modelos = Array.from(modelosMap.entries())
      .filter(([, cantidad]) => cantidad !== 0)
      .map(([modelo, cantidad]) => ({ modelo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    resultados.push({
      cliente: cliente.contabiliumDepositoNombre || cliente.name || "(sin nombre)",
      stock: stockTotal,
      vendido: vendidoCliente,
      modelos,
      pagado: pagadoCliente,
      cobradoDinero: cobradoDineroCliente,
      pendiente: vendidoCliente - pagadoCliente,
      entregado: entregadoCliente,
    });
  }

  resultados.sort((a, b) => b.entregado - a.entregado);

  return {
    vendedor: target.contabiliumDepositoNombre || target.name || "Vendedor",
    desde,
    totalEntregado,
    totalVendido,
    totalPagado,
    totalCobradoDinero,
    totalPendiente: totalVendido - totalPagado,
    clientes: resultados,
  };
}

exports.getPanelClientesVendedor = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
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
      const { vendedorUid, desde } = req.body || {};
      const db = admin.firestore();
      let targetUid = uid;
      if (vendedorUid && vendedorUid !== uid) {
        const callerSnap = await db.doc(`users/${uid}`).get();
        const caller = callerSnap.exists ? callerSnap.data() : null;
        if (!caller || !["admin", "chofer"].includes(caller.role)) {
          return res.status(403).json({ error: "No tenés permiso para ver la cuenta de otro vendedor" });
        }
        targetUid = vendedorUid;
      }

      const panel = await buildPanelClientesVendedor(
        db,
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        targetUid,
        desde
      );
      return res.json(panel);
    } catch (err) {
      console.error("[getPanelClientesVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

function mesesEntre(desdeISO, hastaISO) {
  const meses = [];
  let [y, m] = desdeISO.slice(0, 7).split("-").map(Number);
  const [yHasta, mHasta] = hastaISO.slice(0, 7).split("-").map(Number);
  while (y < yHasta || (y === yHasta && m <= mHasta)) {
    meses.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return meses;
}

// Informe completo descargable: todo lo que ya existe por separado
// (buildResumenComision por mes, los viajes agrupados por id, y el panel
// de "entregado = stock + vendido" por cliente) junto en un solo Excel, con
// un total general y el desglose mes a mes — a pedido explícito del
// 19/10/2026 ("hace un total y el por mes").
// Junta todo lo que antes vivía repartido en varios endpoints (panel por
// cliente, resumen de comisión por mes, viajes agrupados) en un solo lugar
// — lo usan tanto la pantalla (JSON liviano) como el Excel descargable
// (mismo cálculo, solo cambia el formato de salida).
async function buildInformeCompletoVendedor(db, email, apiKey, webEmail, webPassword, targetUid) {
  const targetSnap = await db.doc(`users/${targetUid}`).get();
  if (!targetSnap.exists) throw new Error("Usuario no encontrado");
  const target = targetSnap.data();
  const nombreVendedor = target.contabiliumDepositoNombre || target.name || "Vendedor";

  // `fechaUltimaLiquidacion` (se carga sola al tocar "Cerrar y marcar como
  // pagado") pisa todo lo anterior — una vez que se le pagó un período, el
  // próximo arranca de cero desde esa fecha, no desde el principio de los
  // tiempos (pedido explícito 21/10/2026). Si todavía no se cerró nunca
  // ningún período, se sigue usando `fechaInicioActividad` (cargado a mano,
  // cubre el caso de Cuchi que empezó a trabajar antes de que se le creara
  // la cuenta) o la fecha de alta del usuario.
  const desdeISO = target.fechaUltimaLiquidacion
    || target.fechaInicioActividad
    || (target.createdAt?.toDate ? target.createdAt.toDate().toISOString().slice(0, 10) : "2026-08-01");
  const hoyISOVal = new Date().toISOString().slice(0, 10);
  const meses = mesesEntre(desdeISO, hoyISOVal);
  // Una vez que hubo al menos una liquidación, el flete deja de contarse
  // por el stock total que tiene (esas bicis ya se pagaron una vez) y pasa
  // a contarse por MOVIMIENTO NUEVO desde ese cierre: cada retiro de un
  // depósito propio hacia el suyo Y cada entrega a un cliente, cada uno ×
  // tarifa — "cada vez que retira más de Lavalle son 10 mil cada una [y
  // la entrega también]". Antes de la primera liquidación se sigue usando
  // el total de stock (ya validado a mano con Cuchi, da 200).
  //
  // Esto último asume que el vendedor tiene clientes propios con depósito
  // consignado (de ahí sale "stock total" y "entregado") — una cuenta
  // "solo logística" (chofer puro, ej. Vito/Jíbaro/Credifin, sin
  // `vendedoresAsignados`) no tiene nada de eso: el panel le da siempre 0
  // clientes/0 stock/0 entregado, así que ese cálculo le daba flete $0 por
  // más viajes reales que hiciera (bug detectado 26/10/2026 con Vito, 5
  // viajes reales pero $0 de flete). Para esas cuentas usamos SIEMPRE el
  // cálculo por movimiento, nunca el de stock total — no hay "stock ya
  // pagado" que proteger porque nunca hubo panel de clientes en primer
  // lugar.
  const esSoloLogistica = !Array.isArray(target.vendedoresAsignados) || target.vendedoresAsignados.length === 0;
  const usaFleteDeMovimiento = !!target.fechaUltimaLiquidacion || esSoloLogistica;

  const panel = await buildPanelClientesVendedor(db, email, apiKey, targetUid, desdeISO);

  // Ventas reportadas por sus clientes desde "Mi stock" (botón "¿Vendiste
  // esta unidad?") — detalle bici por bici, con su estado (pendiente de
  // facturar / facturado) y tipo (Factura real / COT) — a pedido explícito
  // del 21/10/2026, para que el Excel de Cuchi muestre esto además de lo
  // que ya traía.
  const asignadosVentas = Array.isArray(target.vendedoresAsignados) ? target.vendedoresAsignados : [];
  const ventasReportadas = [];
  if (asignadosVentas.length > 0) {
    const lotes = [];
    for (let i = 0; i < asignadosVentas.length; i += 30) lotes.push(asignadosVentas.slice(i, i + 30));
    const [snaps, clientesSnaps] = await Promise.all([
      Promise.all(lotes.map((lote) => db.collection("saleRequests").where("distributorUid", "in", lote).get())),
      Promise.all(asignadosVentas.map((u) => db.doc(`users/${u}`).get())),
    ]);
    const nombrePorUid = {};
    clientesSnaps.forEach((s) => {
      if (s.exists) nombrePorUid[s.id] = s.data().contabiliumDepositoNombre || s.data().name || "(sin nombre)";
    });
    for (const snap of snaps) {
      snap.forEach((d) => {
        const v = d.data();
        const fecha = v.createdAt?.toDate ? v.createdAt.toDate().toISOString().slice(0, 10) : null;
        if (fecha && fecha < desdeISO) return;
        ventasReportadas.push({
          fecha,
          cliente: nombrePorUid[v.distributorUid] || v.distributorName || "(sin nombre)",
          producto: v.name || v.sku || "",
          cantidad: Number(v.quantity || 0),
          tipo: v.tipoDocumentoEmitido || v.tipoDocumentoElegido || "—",
          estado: v.status || "pendiente",
          numeroFactura: v.facturaContabilium?.Numero || null,
        });
      });
    }
    ventasReportadas.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  }
  const totalVentasReportadas = ventasReportadas.length;
  const totalVentasPendientes = ventasReportadas.filter((v) => v.estado === "pendiente").length;
  const totalVentasCOT = ventasReportadas.filter((v) => v.tipo === "COT").length;

  // Stock que el vendedor tiene hoy en SU PROPIO depósito, todavía sin pasar
  // a ningún cliente (panel.totalEntregado ya cuenta lo que está en stock
  // de sus clientes + lo vendido, pero no esto) — a pedido explícito del
  // 19/10/2026, para reemplazar el tile de "retirado de Lavalle" por
  // "entregado + stock propio", que es el número que de verdad cierra con
  // lo que Cuchi tiene anotado a mano.
  let stockPropio = 0;
  if (target.contabiliumDepositoId) {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const stockRaw = await getStockByDepositoWithRetry(email, apiKey, target.contabiliumDepositoId);
        const items = await buildDepositoStockItems(db, email, apiKey, stockRaw);
        stockPropio = items
          .filter((it) => (it.category || "").toUpperCase() === "BICICLETAS")
          .reduce((a, b) => a + (Number(b.stockActual) || 0), 0);
        break;
      } catch (err) {
        if (intento === 3) console.error("[buildInformeCompletoVendedor] stock propio falló", nombreVendedor, err.message);
        else await sleep(1500 * intento);
      }
    }
  }

  const resumenesPorMes = [];
  for (const mes of meses) {
    try {
      const r = await buildResumenComision(db, email, apiKey, webEmail, webPassword, targetUid, mes);
      resumenesPorMes.push({ mes, ...r });
    } catch (err) {
      console.error("[buildInformeCompletoVendedor] falló mes", mes, err.message);
      resumenesPorMes.push({ mes, viajes: 0, fleteTotal: 0, ventasTotal: 0, comisionTotal: 0, totalACobrar: 0, detalle: [] });
    }
  }

  // Lista de pagos confirmados a mano, con cliente/producto/monto, para
  // mostrarle al admin un aviso claro al abrir el informe ("ya se le pagó
  // tal cosa") en vez de que quede escondido en un documento aparte —
  // pedido explícito 21/10/2026. El formato nuevo (`pagosPorNumero`) ya
  // trae el cliente/producto guardados desde el momento en que se
  // confirmó el cobro — no hace falta re-buscarlos. El formato viejo
  // (`numeros`/`montosParciales`, de antes de este cambio) sí necesita
  // ese cruce contra el detalle de ventas; se deja como respaldo nada más
  // para no perder confirmaciones ya cargadas, aunque ese cruce puede
  // fallar si el número de comprobante se repite entre clientes (bug real
  // detectado 21/10/2026 con una cotización de Leobono atribuida a
  // "compakjet").
  const pagosManualesSnap2 = await db.doc(`pagosManualesConfirmados/${targetUid}`).get();
  const pagosManualesData2 = pagosManualesSnap2.exists ? pagosManualesSnap2.data() : {};
  const numerosConfirmados2 = new Set(pagosManualesData2.numeros || []);
  const montosParciales2 = pagosManualesData2.montosParciales || {};
  const pagosPorNumero2 = pagosManualesData2.pagosPorNumero || {};
  const todoElDetalle = resumenesPorMes.flatMap((r) => r.detalle || []);
  const pagosManuales = [];
  const numerosYaListados = new Set();
  for (const [numero, p] of Object.entries(pagosPorNumero2)) {
    pagosManuales.push({
      numero,
      cliente: p.cliente || "(sin identificar)",
      producto: p.producto || "",
      monto: Number(p.monto || 0),
      montoTotal: p.montoTotal != null ? Number(p.montoTotal) : null,
      tipo: p.tipo || "completo",
      seDescuenta: true, // cobrado por el vendedor mismo — resta del total a pagarle
    });
    numerosYaListados.add(numero);
  }
  for (const numero of numerosConfirmados2) {
    if (numerosYaListados.has(numero)) continue;
    const d = todoElDetalle.find((x) => x.numero === numero);
    pagosManuales.push({
      numero,
      cliente: d?.cliente || "(sin identificar)",
      producto: d?.modelo || "",
      monto: d?.monto ?? null,
      tipo: "completo",
      seDescuenta: false, // confirmación vieja: solo reconciliación, el cliente le pagó a Fepa normal
    });
  }
  for (const [numero, monto] of Object.entries(montosParciales2)) {
    if (numerosYaListados.has(numero)) continue;
    const d = todoElDetalle.find((x) => x.numero === numero);
    pagosManuales.push({
      numero,
      cliente: d?.cliente || "(sin identificar)",
      producto: d?.modelo || "",
      monto: Number(monto),
      montoTotal: d?.monto ?? null,
      tipo: "parcial",
      seDescuenta: false,
    });
  }

  const { obtenerMovimientosStock } = require("./contabiliumWebAutomation");
  const movimientos = await obtenerMovimientosStock({ db, email: webEmail, password: webPassword, fechaDesde: desdeISO, fechaHasta: hoyISOVal });
  // Palabra MÁS LARGA del nombre (en general el apellido), no la primera —
  // un nombre de pila corto y común puede coincidir con el nombre de un
  // cliente/depósito de otra persona y generar falsos positivos.
  const palabraClave = nombreVendedor.split(/\s+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0] || nombreVendedor;
  const origenesExplicitos = Array.isArray(target.origenesViajes) ? target.origenesViajes.filter(Boolean) : [];
  const palabrasOrigen = origenesExplicitos.length ? origenesExplicitos : [palabraClave];
  const esLogisticaSoloFlete = origenesExplicitos.length > 0;
  const origenRe = new RegExp(palabrasOrigen.map(escapeRegExpBackend).join("|"), "i");
  const depositoPropioRe = /lavalle|temperley|ca[ñn]uelas|credifin/i;
  // Ver comentario largo más arriba (buildResumenComision, caso Credifin +
  // cuenta de Julián, 26/10/2026). Para la cuenta de Julián no se filtra
  // por origen/destino — cuenta CUALQUIER movimiento que la observación
  // diga que llevó/retiró él, sin importar hacia/desde dónde. Para que no
  // quede duplicado entre "viajes" (entregas) y "retiros" (vuelve a un
  // depósito propio de Samurai), se parte por el destino: si vuelve a un
  // depósito propio va a "retiros", si no (entrega a un cliente/depósito
  // externo) va a "viajes" — la separación es aproximada (prioriza no
  // duplicar guita sobre la etiqueta exacta), pero el total sí es exacto.
  const esCuentaDeJulian = origenesExplicitos.some((o) => /rodados/i.test(o));
  const llevaJulianRe = /juli[aá]n(?!\s*brauer)/i;
  const viajesMap = new Map();
  for (const m of movimientos) {
    const origen = (m.origen || "").trim();
    const destino = (m.destino || "").trim();
    const mencionaJulian = llevaJulianRe.test(m.descripcion || "");
    if (esCuentaDeJulian) {
      if (!mencionaJulian || depositoPropioRe.test(destino)) continue;
    } else {
      if (!origenRe.test(origen)) continue;
      if (!esLogisticaSoloFlete && depositoPropioRe.test(destino)) continue;
      if (esLogisticaSoloFlete && mencionaJulian) continue;
    }
    const key = m.id;
    if (!viajesMap.has(key)) viajesMap.set(key, { fecha: m.fecha || "", destino, descripcion: m.descripcion || "", items: [] });
    viajesMap.get(key).items.push({ producto: m.codigoNombre || "", cantidad: m.cantidad != null ? Number(m.cantidad) : null });
  }
  const viajes = Array.from(viajesMap.values()).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));

  // Retiros: el otro sentido — movimientos que ENTRAN al depósito propio del
  // vendedor, sin importar de dónde salgan (Lavalle la mayoría, pero también
  // puede ser otro depósito o cliente devolviendo mercadería). Separado de
  // "viajes" (que son las entregas DESDE su depósito hacia un cliente) a
  // pedido explícito del 19/10/2026 — Cuchi quiere ver también cuánto retira
  // en total, no solo cuánto entrega.
  const destinoVendedorRe = new RegExp(palabrasOrigen.map(escapeRegExpBackend).join("|"), "i");
  const retirosMap = new Map();
  for (const m of movimientos) {
    const origen = (m.origen || "").trim();
    const destino = (m.destino || "").trim();
    const mencionaJulian = llevaJulianRe.test(m.descripcion || "");
    if (esCuentaDeJulian) {
      if (!mencionaJulian || !depositoPropioRe.test(destino)) continue;
    } else {
      if (!destinoVendedorRe.test(destino)) continue;
      if (esLogisticaSoloFlete && mencionaJulian) continue;
    }
    const key = m.id;
    if (!retirosMap.has(key)) retirosMap.set(key, { fecha: m.fecha || "", origen, descripcion: m.descripcion || "", items: [] });
    retirosMap.get(key).items.push({ producto: m.codigoNombre || "", cantidad: m.cantidad != null ? Number(m.cantidad) : null });
  }
  const retiros = Array.from(retirosMap.values()).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  // Para flete solo cuentan bicicletas — mismo filtro /BIC\b/i que
  // unidadesEntregadas/totalUnidadesComision. `retiros` (arriba) sigue
  // guardando TODOS los ítems (accesorios incluidos) para que el detalle
  // sea fiel a lo que realmente se transfirió, pero cobrar flete a $10.000
  // por un inflador o una luz trasera no tiene sentido — eso inflaba
  // totalRetirado con decenas de accesorios de golpe (bug detectado
  // 26/10/2026 con Vito: una sola transferencia de accesorios sumaba 125
  // unidades al conteo de flete).
  const totalRetirado = retiros.reduce(
    (a, v) => a + v.items.reduce((x, it) => x + (/BIC\b/i.test(it.producto || "") ? Number(it.cantidad || 0) : 0), 0),
    0
  );
  // Devoluciones: el caso particular donde el vendedor manda mercadería DE
  // VUELTA a un depósito propio de Samurai (resta del total retirado neto).
  const devolucionesMap = new Map();
  for (const m of movimientos) {
    const origen = (m.origen || "").trim();
    const destino = (m.destino || "").trim();
    if (!origenRe.test(origen) || !depositoPropioRe.test(destino)) continue;
    const key = m.id;
    if (!devolucionesMap.has(key)) devolucionesMap.set(key, { fecha: m.fecha || "", destino, items: [] });
    devolucionesMap.get(key).items.push({ producto: m.codigoNombre || "", cantidad: m.cantidad != null ? Number(m.cantidad) : null });
  }
  const devoluciones = Array.from(devolucionesMap.values());
  const totalDevuelto = devoluciones.reduce((a, v) => a + v.items.reduce((x, it) => x + (it.cantidad || 0), 0), 0);

  const tarifaFletePorViajeGlobal = Number(target.tarifaFletePorViaje ?? 10000);
  const totalComision = resumenesPorMes.reduce((a, r) => a + (r.comisionTotal || 0), 0);
  const totalViajesComision = resumenesPorMes.reduce((a, r) => a + (r.viajes || 0), 0);
  const totalUnidadesComision = resumenesPorMes.reduce((a, r) => a + (r.unidadesEntregadas || 0), 0);

  // Flete — dos modos, según si ya hubo alguna liquidación cerrada:
  //  · ANTES de la primera liquidación: (entregado a todos sus clientes +
  //    lo que todavía tiene en su depósito) × tarifa — pedido explícito
  //    21/10/2026 ("183 entregadas + 16 en stock Cuchi = 200, eso × 10mil"),
  //    ya validado a mano contra los números reales de Cuchi.
  //  · DESPUÉS de cerrar un período: por MOVIMIENTO NUEVO desde ese cierre
  //    — cada retiro de un depósito propio hacia el suyo Y cada entrega a
  //    un cliente, cada uno × tarifa (pedido explícito 21/10/2026: "por
  //    retiros nuevos de Lavalle u otros y entregas a clientes") — así no
  //    se le vuelve a cobrar por el mismo stock que ya se le pagó una vez.
  const totalEntregadoMasStockFlete = panel.totalEntregado + stockPropio;
  const totalFlete = usaFleteDeMovimiento
    ? (totalUnidadesComision + totalRetirado) * tarifaFletePorViajeGlobal
    : totalEntregadoMasStockFlete * tarifaFletePorViajeGlobal;

  // Lo que el vendedor ya cobró él mismo, directo de sus clientes, se
  // descuenta de lo que Fepa le tiene que pagar (flete + comisión) — ese
  // dinero ya está en su poder, no hace falta pagárselo de nuevo. Pedido
  // explícito 21/10/2026 ("que ya se le descuente lo que se le cobró").
  //
  // OJO 1: esto NO usa `panel.totalCobradoDinero` — ese total suma TODO
  // comprobante con saldo $0 en Contabilium, que en su mayoría es plata
  // que pagaron directo a Fepa por los canales normales (no que el
  // vendedor tenga en el bolsillo). Confundir los dos daba un total
  // negativo absurdo (bug real: descontaba $7.852.250 de $2.528.063).
  //
  // OJO 2: tampoco usa las confirmaciones VIEJAS (`numeros`/`montosParciales`,
  // cargadas antes del 21/10/2026) — esas representan "Contabilium no
  // vinculó el pago a la factura" (el cliente igual le pagó a Fepa por el
  // canal normal), un caso distinto de "el vendedor lo cobró él mismo y se
  // lo tiene que descontar". Solo las confirmaciones NUEVAS
  // (`pagosPorNumero`, elegidas a mano desde este informe) representan
  // específicamente plata que el vendedor cobró él mismo.
  const totalCobradoPorVendedor = Object.values(pagosPorNumero2).reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const totalNetoAPagar = totalFlete + totalComision - totalCobradoPorVendedor;

  return {
    nombreVendedor, desdeISO, hoyISOVal, panel, resumenesPorMes, viajes,
    totalFlete, totalComision, totalViajesComision, totalUnidadesComision,
    retiros, totalRetirado, devoluciones, totalDevuelto,
    stockPropio, totalEntregadoMasStock: panel.totalEntregado + stockPropio,
    ventasReportadas, totalVentasReportadas, totalVentasPendientes, totalVentasCOT,
    pagosManuales, todoElDetalle,
    totalCobradoPorVendedor, totalNetoAPagar,
    tarifaFletePorViajeGlobal, comisionPorcentaje: Number(target.comisionPorcentaje ?? 5),
    usaFleteDeMovimiento, fechaUltimaLiquidacion: target.fechaUltimaLiquidacion || null,
  };
}

exports.getInformeCompletoVendedor = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 540, memory: "1GiB" },
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
      const { vendedorUid } = req.body || {};
      const db = admin.firestore();
      let targetUid = uid;
      if (vendedorUid && vendedorUid !== uid) {
        const callerSnap = await db.doc(`users/${uid}`).get();
        const caller = callerSnap.exists ? callerSnap.data() : null;
        if (!caller || !["admin", "chofer"].includes(caller.role)) {
          return res.status(403).json({ error: "No tenés permiso para ver la cuenta de otro vendedor" });
        }
        targetUid = vendedorUid;
      }

      const informe = await buildInformeCompletoVendedor(
        db,
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        CONTABILIUM_WEB_EMAIL.value(),
        CONTABILIUM_WEB_PASSWORD.value(),
        targetUid
      );
      return res.json({ ok: true, ...informe });
    } catch (err) {
      console.error("[getInformeCompletoVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.descargarInformeCompletoVendedor = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 540, memory: "1GiB" },
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
      const { vendedorUid } = req.body || {};
      const db = admin.firestore();
      let targetUid = uid;
      if (vendedorUid && vendedorUid !== uid) {
        const callerSnap = await db.doc(`users/${uid}`).get();
        const caller = callerSnap.exists ? callerSnap.data() : null;
        if (!caller || !["admin", "chofer"].includes(caller.role)) {
          return res.status(403).json({ error: "No tenés permiso para ver la cuenta de otro vendedor" });
        }
        targetUid = vendedorUid;
      }

      const { nombreVendedor, desdeISO, hoyISOVal, panel, resumenesPorMes, viajes, totalFlete, totalComision, totalViajesComision, totalUnidadesComision, retiros, totalRetirado, devoluciones, totalDevuelto, stockPropio, totalEntregadoMasStock, ventasReportadas, totalVentasReportadas, totalVentasPendientes, totalVentasCOT, pagosManuales, totalCobradoPorVendedor, totalNetoAPagar, tarifaFletePorViajeGlobal, comisionPorcentaje, usaFleteDeMovimiento, fechaUltimaLiquidacion } =
        await buildInformeCompletoVendedor(
          db,
          CONTABILIUM_EMAIL.value(),
          CONTABILIUM_API_KEY.value(),
          CONTABILIUM_WEB_EMAIL.value(),
          CONTABILIUM_WEB_PASSWORD.value(),
          targetUid
        );

      // ─── Armado del Excel ───
      const XLSX = require("xlsx");
      const wb = XLSX.utils.book_new();

      // Hoja "Resumen General" en lenguaje llano, paso a paso, para que se
      // entienda sin tener que saber cómo funciona el sistema — pedido
      // explícito 21/10/2026 ("que se entienda para bobos"). En vez de una
      // lista plana de campos técnicos, va contando la cuenta como se la
      // explicarías en voz alta: cuánto es el flete, cuánto la comisión,
      // cuánto ya cobró él mismo, y el resultado final bien grande al
      // final. $ = moneda formateada; "—" = separador en blanco.
      const MONEY_FMT = '"$"#,##0';
      const filasPagosQueDescuentan = (pagosManuales || []).filter((p) => p.seDescuenta !== false);
      const filasPagosSoloInfo = (pagosManuales || []).filter((p) => p.seDescuenta === false);

      const filas = [];
      const money$ = (campo, valor, indent = 0) => filas.push({ campo: "  ".repeat(indent) + campo, valor: Math.round(valor || 0), esMoneda: true });
      const num = (campo, valor, indent = 0) => filas.push({ campo: "  ".repeat(indent) + campo, valor, esMoneda: false });
      const texto = (campo, valor, indent = 0) => filas.push({ campo: "  ".repeat(indent) + campo, valor, esMoneda: false });
      const titulo = (campo) => filas.push({ campo, valor: "", esTitulo: true });
      const vacia = () => filas.push({ campo: "", valor: "" });

      titulo(`RESUMEN DE ${nombreVendedor.toUpperCase()}`);
      texto("Período", `${desdeISO} al ${hoyISOVal}`);
      if (fechaUltimaLiquidacion) texto("Última liquidación cerrada", fechaUltimaLiquidacion);
      vacia();

      if (usaFleteDeMovimiento) {
        titulo("1) FLETE — por cada retiro nuevo de un depósito propio y cada entrega nueva a un cliente, desde la última liquidación");
        num("Unidades entregadas a clientes (viajes nuevos)", totalUnidadesComision, 1);
        num("+ Unidades retiradas de Lavalle/otros (retiros nuevos)", totalRetirado, 1);
        num("= Total de movimientos para el flete", totalUnidadesComision + totalRetirado, 1);
        money$("× Precio de flete por unidad", tarifaFletePorViajeGlobal, 1);
        money$("= FLETE TOTAL", totalFlete, 1);
      } else {
        titulo("1) FLETE — por cada bici entregada a un cliente o que todavía tiene en su depósito");
        num("Bicis entregadas a clientes", panel.totalEntregado, 1);
        num("+ Bicis que tiene en su propio depósito", stockPropio, 1);
        num("= Total de bicis para el flete", totalEntregadoMasStock, 1);
        money$("× Precio de flete por bici", tarifaFletePorViajeGlobal, 1);
        money$("= FLETE TOTAL", totalFlete, 1);
      }
      vacia();

      titulo("2) COMISIÓN — % sobre lo que facturaron sus clientes");
      money$("Total vendido por sus clientes", resumenesPorMes.reduce((a, r) => a + (r.ventasTotal || 0), 0), 1);
      texto("× % de comisión", `${comisionPorcentaje}%`, 1);
      money$("= COMISIÓN TOTAL", totalComision, 1);
      vacia();

      money$("SUBTOTAL (flete + comisión)", totalFlete + totalComision);
      vacia();

      titulo("3) YA COBRADO POR ÉL — se resta, porque esa plata ya la tiene en la mano");
      if (filasPagosQueDescuentan.length === 0) {
        texto("(nada confirmado todavía)", "", 1);
      } else {
        for (const p of filasPagosQueDescuentan) {
          const montoTxt = Number(p.monto || 0).toLocaleString("es-AR");
          const montoTotalTxt = Number(p.montoTotal || 0).toLocaleString("es-AR");
          texto(
            `${p.cliente} — ${p.producto || "(sin identificar)"} (${p.numero})`,
            p.tipo === "parcial" ? `$${montoTxt} de $${montoTotalTxt} (parcial)` : `$${montoTxt}`,
            1
          );
        }
      }
      money$("= YA COBRADO POR ÉL (se resta)", totalCobradoPorVendedor, 1);
      vacia();

      titulo("═══════════════════════");
      money$("TOTAL NETO A PAGARLE", totalNetoAPagar);
      titulo("═══════════════════════");
      vacia();

      if (filasPagosSoloInfo.length > 0) {
        titulo("Reconciliaciones (NO se descuentan — el cliente le pagó a Fepa por el canal normal)");
        for (const p of filasPagosSoloInfo) {
          texto(`${p.cliente} — ${p.producto || "(sin identificar)"} (${p.numero})`, `$${Number(p.monto || 0).toLocaleString("es-AR")}`, 1);
        }
        vacia();
      }

      titulo("Otros datos (informativos)");
      num("Entregado total (stock + vendido, todos los clientes)", panel.totalEntregado, 1);
      num("Vendido total", panel.totalVendido, 1);
      num("Cobrado (bicis)", panel.totalPagado, 1);
      money$("Cobrado total ($, todos los canales, no solo lo de arriba)", panel.totalCobradoDinero, 1);
      num("Vendido sin cobrar", panel.totalPendiente, 1);
      num("Viajes totales", totalViajesComision, 1);
      num("Retirado neto de Lavalle/otros", totalRetirado - totalDevuelto, 1);
      num("Ventas reportadas desde la app", totalVentasReportadas, 1);
      num("  de esas, sin facturar todavía", totalVentasPendientes, 1);
      num("  de esas, como COT (cotización)", totalVentasCOT, 1);

      const aoa = filas.map((f) => [f.campo, f.valor]);
      const wsGeneral = XLSX.utils.aoa_to_sheet(aoa);
      filas.forEach((f, i) => {
        if (!f.esMoneda) return;
        const addr = XLSX.utils.encode_cell({ r: i, c: 1 });
        if (wsGeneral[addr]) wsGeneral[addr].z = MONEY_FMT;
      });
      wsGeneral["!cols"] = [{ wch: 60 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsGeneral, "Resumen General");

      const wsVentasReportadas = XLSX.utils.json_to_sheet(
        ventasReportadas.map((v) => ({
          Fecha: v.fecha,
          Cliente: v.cliente,
          Producto: v.producto,
          Cantidad: v.cantidad,
          Tipo: v.tipo,
          Estado: v.estado === "pendiente" ? "Pendiente de facturar" : "Facturado",
          "N° comprobante": v.numeroFactura || "",
        })),
        { header: ["Fecha", "Cliente", "Producto", "Cantidad", "Tipo", "Estado", "N° comprobante"] }
      );
      wsVentasReportadas["!cols"] = [{ wch: 11 }, { wch: 28 }, { wch: 45 }, { wch: 9 }, { wch: 10 }, { wch: 20 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsVentasReportadas, "Ventas reportadas");

      // El flete ya no es por mes (ver "Flete total" en Resumen General —
      // es un único total sobre entregado+stock propio) — acá queda solo
      // ventas/comisión por mes, que sí tiene sentido repartido por fecha
      // real de cada factura.
      const wsPorMes = XLSX.utils.json_to_sheet(
        resumenesPorMes.map((r) => ({
          Mes: r.mes,
          Viajes: r.viajes,
          "Unidades (bicis)": r.unidadesEntregadas || 0,
          "Ventas (neto)": Math.round(r.ventasTotal || 0),
          "% Comisión": r.comisionPorcentaje,
          Comisión: Math.round(r.comisionTotal || 0),
        })),
        { header: ["Mes", "Viajes", "Unidades (bicis)", "Ventas (neto)", "% Comisión", "Comisión"] }
      );
      wsPorMes["!cols"] = [{ wch: 9 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 11 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsPorMes, "Resumen por Mes");

      const wsClientes = XLSX.utils.json_to_sheet(
        panel.clientes.map((c) => ({
          Cliente: c.cliente,
          "Stock actual": c.stock,
          Reportado: c.vendido,
          Cobrado: c.pagado,
          "Cobrado ($)": Math.round(c.cobradoDinero || 0),
          "Vendido sin cobrar": c.pendiente,
          "Entregado (stock+vendido)": c.entregado,
        })),
        { header: ["Cliente", "Stock actual", "Reportado", "Cobrado", "Cobrado ($)", "Vendido sin cobrar", "Entregado (stock+vendido)"] }
      );
      wsClientes["!cols"] = [{ wch: 32 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, wsClientes, "Entregas por Cliente");

      const viajesRows = [];
      viajes.forEach((v, idx) => {
        v.items.forEach((it, j) => {
          viajesRows.push({
            "N° Viaje": j === 0 ? idx + 1 : "",
            Mes: (v.fecha || "").slice(0, 7),
            "Fecha y hora": v.fecha,
            "Cliente destino": v.destino,
            Producto: it.producto,
            Cantidad: it.cantidad,
            Descripción: v.descripcion,
          });
        });
      });
      const wsViajes = XLSX.utils.json_to_sheet(viajesRows, {
        header: ["N° Viaje", "Mes", "Fecha y hora", "Cliente destino", "Producto", "Cantidad", "Descripción"],
      });
      wsViajes["!cols"] = [{ wch: 9 }, { wch: 9 }, { wch: 20 }, { wch: 28 }, { wch: 42 }, { wch: 10 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, wsViajes, "Viajes");

      const retirosRows = [];
      retiros.forEach((v, idx) => {
        v.items.forEach((it, j) => {
          retirosRows.push({
            "N° Retiro": j === 0 ? idx + 1 : "",
            Mes: (v.fecha || "").slice(0, 7),
            "Fecha y hora": v.fecha,
            Origen: v.origen,
            Producto: it.producto,
            Cantidad: it.cantidad,
            Descripción: v.descripcion,
          });
        });
      });
      const wsRetiros = XLSX.utils.json_to_sheet(retirosRows, {
        header: ["N° Retiro", "Mes", "Fecha y hora", "Origen", "Producto", "Cantidad", "Descripción"],
      });
      wsRetiros["!cols"] = [{ wch: 9 }, { wch: 9 }, { wch: 20 }, { wch: 28 }, { wch: 42 }, { wch: 10 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, wsRetiros, "Retiros");

      const ventasRows = [];
      for (const r of resumenesPorMes) {
        for (const d of r.detalle || []) {
          ventasRows.push({
            Mes: r.mes,
            Fecha: d.fecha,
            Cliente: d.cliente,
            "N° Factura": d.numero,
            Tipo: d.tipo,
            Producto: d.modelo,
            Cantidad: d.cantidad,
            Monto: Math.round(d.monto || 0),
            Comisión: Math.round(d.comision || 0),
          });
        }
      }
      const wsVentas = XLSX.utils.json_to_sheet(ventasRows, {
        header: ["Mes", "Fecha", "Cliente", "N° Factura", "Tipo", "Producto", "Cantidad", "Monto", "Comisión"],
      });
      wsVentas["!cols"] = [{ wch: 9 }, { wch: 20 }, { wch: 26 }, { wch: 15 }, { wch: 7 }, { wch: 42 }, { wch: 9 }, { wch: 14 }, { wch: 13 }];
      XLSX.utils.book_append_sheet(wb, wsVentas, "Comprobantes emitidos");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = buf.toString("base64");

      return res.json({ ok: true, base64, filename: `${nombreVendedor} - Informe completo.xlsx` });
    } catch (err) {
      console.error("[descargarInformeCompletoVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Carga a mano cuántos viajes (Lavalle → su depósito) hizo un vendedor en un
// mes puntual — Contabilium no lo registra, así que es la única forma de
// contarlo para calcular el flete. Lo puede cargar el propio vendedor (su
// uid) o un admin/chofer pasando `vendedorUid`.
exports.setViajesVendedorMes = onRequest(
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
      const { mes, viajes, vendedorUid } = req.body || {};
      if (!mes || (mes !== "todo" && !/^\d{4}-\d{2}$/.test(mes))) return res.status(400).json({ error: "Falta mes (formato YYYY-MM, o todo para el historial completo)" });
      if (!(Number(viajes) >= 0)) return res.status(400).json({ error: "viajes tiene que ser un número >= 0" });

      const db = admin.firestore();
      let targetUid = uid;
      if (vendedorUid && vendedorUid !== uid) {
        const callerSnap = await db.doc(`users/${uid}`).get();
        const caller = callerSnap.exists ? callerSnap.data() : null;
        if (!caller || !["admin", "chofer"].includes(caller.role)) {
          return res.status(403).json({ error: "No tenés permiso para cargar la cuenta de otro vendedor" });
        }
        targetUid = vendedorUid;
      }

      await db.doc(`resumenVendedorMensual/${targetUid}_${mes}`).set(
        { viajes: Number(viajes), actualizadoPor: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error("[setViajesVendedorMes] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Lista liviana, para el admin, de quiénes tienen `vendedoresAsignados`
// cargado (hoy en día, solo Alfredo Bavcevich) — para poder elegirlos en el
// selector del resumen de comisión/flete.
exports.adminListDistribuidoresConEquipo = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const db = admin.firestore();
      // No hay forma confiable de filtrar "array no vacío" del lado del
      // servidor en Firestore — son pocos usuarios en total, así que se
      // trae todo y se filtra en memoria.
      const snap = await db.collection("users").get();
      const lista = snap.docs
        .filter((d) => Array.isArray(d.data().vendedoresAsignados) && d.data().vendedoresAsignados.length > 0)
        .map((d) => ({
          uid: d.id,
          name: d.data().name || d.data().username || "",
          cantidadClientesAsignados: d.data().vendedoresAsignados.length,
          comisionPorcentaje: d.data().comisionPorcentaje ?? 5,
          tarifaFletePorViaje: d.data().tarifaFletePorViaje ?? 10000,
          contabiliumDepositoId: d.data().contabiliumDepositoId ?? null,
          contabiliumDepositoNombre: d.data().contabiliumDepositoNombre ?? null,
        }));
      return res.json({ distribuidores: lista });
    } catch (err) {
      console.error("[adminListDistribuidoresConEquipo] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Permite a un admin/chofer configurar la tarifa de flete (por viaje) y el
// % de comisión de un vendedor puntual (ej. Alfredo) — quedan guardados en
// su propio doc de usuario, con default 10000 y 5% si nunca se cargó nada.
exports.adminSetTarifasVendedor = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, comisionPorcentaje, tarifaFletePorViaje } = req.body || {};
      if (!vendedorUid) return res.status(400).json({ error: "Falta vendedorUid" });
      const patch = {};
      if (comisionPorcentaje != null) patch.comisionPorcentaje = Number(comisionPorcentaje);
      if (tarifaFletePorViaje != null) patch.tarifaFletePorViaje = Number(tarifaFletePorViaje);
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Nada para actualizar" });

      await admin.firestore().doc(`users/${vendedorUid}`).set(patch, { merge: true });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[adminSetTarifasVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Para proveedores logísticos con `modoFleteManual` (ej. Jíbaro: cobra 3.5%
// de la carga pero el monto puntual hay que consultárselo viaje por viaje,
// no se puede calcular solo) — guarda lo que cobró por un viaje puntual
// (identificado por el id del movimiento de stock de Contabilium que lo
// generó), en vez de una tarifa fija global.
exports.adminGuardarMontoViajeLogistica = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, viajeId, monto } = req.body || {};
      if (!vendedorUid || viajeId == null) return res.status(400).json({ error: "Falta vendedorUid o viajeId" });
      await admin
        .firestore()
        .doc(`users/${vendedorUid}/montosViajesManuales/${viajeId}`)
        .set({ monto: Number(monto) || 0, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedPorUid: staffUid }, { merge: true });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[adminGuardarMontoViajeLogistica] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Confirma a mano que una venta puntual de un cliente de un vendedor (ej.
// Cuchi) ya se la cobró ÉL MISMO directo al cliente (no por los canales
// normales de Contabilium) — completa o PARCIAL (monto < total de la
// factura/COT). Pedido explícito 21/10/2026: "que para próximos cobros te
// deje elegir clientes y elegir las bicis que se cobró".
//
// Guarda cliente/producto/montoTotal en el momento de confirmar (no los
// vuelve a buscar después por `numero`) — antes se re-buscaba el cliente
// cruzando el número de factura contra el detalle de ventas, y como ese
// número no siempre es único entre comprobantes de distintos clientes,
// terminaba mostrando el cliente equivocado (bug real detectado
// 21/10/2026: una cotización de Leobono apareció atribuida a "compakjet").
exports.adminConfirmarCobroManual = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, numero, monto, montoTotal, cliente, producto } = req.body || {};
      if (!vendedorUid || !numero) return res.status(400).json({ error: "Faltan vendedorUid y numero" });
      const db = admin.firestore();
      const ref = db.doc(`pagosManualesConfirmados/${vendedorUid}`);
      const montoNum = monto == null ? Number(montoTotal || 0) : Number(monto);
      const esCompleto = montoTotal == null || montoNum >= Number(montoTotal);
      await ref.set(
        {
          pagosPorNumero: {
            [String(numero)]: {
              cliente: cliente || "(sin identificar)",
              producto: producto || "",
              monto: montoNum,
              montoTotal: montoTotal != null ? Number(montoTotal) : montoNum,
              tipo: esCompleto ? "completo" : "parcial",
            },
          },
        },
        { merge: true }
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error("[adminConfirmarCobroManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Deshace una confirmación manual de cobro (nueva o vieja).
exports.adminQuitarCobroManual = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, numero } = req.body || {};
      if (!vendedorUid || !numero) return res.status(400).json({ error: "Faltan vendedorUid y numero" });
      const db = admin.firestore();
      const ref = db.doc(`pagosManualesConfirmados/${vendedorUid}`);
      // Saca tanto del formato nuevo (pagosPorNumero, con contexto propio)
      // como del viejo (numeros/montosParciales, por si era una de las
      // confirmaciones cargadas antes de este cambio).
      await ref.set({ numeros: admin.firestore.FieldValue.arrayRemove(String(numero)) }, { merge: true });
      await ref.update({ [`montosParciales.${String(numero)}`]: admin.firestore.FieldValue.delete() }).catch(() => {});
      await ref.update({ [`pagosPorNumero.${String(numero)}`]: admin.firestore.FieldValue.delete() }).catch(() => {});
      return res.json({ ok: true });
    } catch (err) {
      console.error("[adminQuitarCobroManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Cierra un período y lo marca como pagado — pedido explícito 21/10/2026:
// "que se cierre ese número con un botón y lo que queda del mes que tenga
// otro número, desde 0 porque lo anterior ya se le pagó". Guarda el
// período cerrado en un historial (`liquidacionesVendedor`), y corre la
// fecha de arranque del PRÓXIMO informe a hoy (`users/{uid}.fechaUltimaLiquidacion`)
// — a partir de ahí el flete deja de contarse por el stock total (eso ya
// se pagó) y pasa a contarse por movimiento nuevo (retiros + entregas). De
// paso, limpia las confirmaciones manuales de cobro vigentes: ya quedaron
// incluidas en el total que se está cerrando, no tienen que seguir
// restando en el próximo período.
exports.adminCerrarLiquidacionVendedor = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, desde, hasta, totalFlete, totalComision, totalCobradoPorVendedor, totalNetoAPagar, pagosManuales } = req.body || {};
      if (!vendedorUid || !hasta) return res.status(400).json({ error: "Faltan vendedorUid y hasta" });
      const db = admin.firestore();

      await db.collection("liquidacionesVendedor").doc(vendedorUid).collection("periodos").add({
        desde: desde || null,
        hasta,
        totalFlete: Number(totalFlete || 0),
        totalComision: Number(totalComision || 0),
        totalCobradoPorVendedor: Number(totalCobradoPorVendedor || 0),
        totalNetoAPagar: Number(totalNetoAPagar || 0),
        pagosManualesIncluidos: pagosManuales || [],
        cerradoPorUid: staffUid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db.doc(`users/${vendedorUid}`).set({ fechaUltimaLiquidacion: hasta }, { merge: true });
      // Las confirmaciones manuales vigentes ya quedaron guardadas arriba
      // (pagosManualesIncluidos) — se borran del doc "vivo" para que el
      // próximo período arranque sin ellas.
      await db.doc(`pagosManualesConfirmados/${vendedorUid}`).set(
        { numeros: [], montosParciales: {}, pagosPorNumero: {} },
        { merge: true }
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error("[adminCerrarLiquidacionVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Detalle completo del depósito propio de Samurai en Lavalle (modelos,
// colores, cantidades) para quien coordina un grupo de vendedores — mismo
// gate que getMisVendedores (campo `vendedoresAsignados`), separado en su
// propio botón "Depósito" al lado de "Mi stock" en vez de vivir adentro de
// "Mis vendedores".
exports.getMiDepositoPropio = onRequest(
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
      uid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const db = admin.firestore();
      const callerSnap = await db.doc(`users/${uid}`).get();
      if (!callerSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const caller = callerSnap.data();
      // OJO: "contabiliumDepositoId != null" dejó de servir como filtro acá
      // — desde que se habilitaron los pedidos del catálogo (oct/2026),
      // CUALQUIER cliente que puede comprar tiene su propio
      // contabiliumDepositoId, así que ese chequeo solo dejaba afuera a
      // quien no tenía cuenta de distribuidor. El depósito que devuelve
      // esto es el de LAVALLE — stock entero de la empresa, no el del
      // cliente — así que el acceso real tiene que ser "app simple"
      // (Julián/Cuchi, habilitados a mano) o tener equipo propio
      // (supervisor que reparte entre sus clientes), no cualquiera con
      // depósito (bug detectado y corregido 10/10/2026, estaba exponiendo
      // el stock de Lavalle a cualquier cliente del catálogo).
      const tieneEquipo = Array.isArray(caller.vendedoresAsignados) && caller.vendedoresAsignados.length > 0;
      if (caller.appSimpleHabilitada !== true && !tieneEquipo) {
        return res.status(403).json({ error: "No tenés acceso a este depósito" });
      }

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const stockRaw = await getStockByDepositoWithRetry(email, apiKey, LAVALLE_DEPOSITO_ID);
      // includeZeroStock: true para que el filtro de talles pueda mostrar
      // "no disponible" en vez de simplemente omitir el talle sin stock.
      const items = await buildDepositoStockItems(db, email, apiKey, stockRaw, { includeZeroStock: true });

      return res.json({ depositoId: LAVALLE_DEPOSITO_ID, depositoNombre: "Lavalle", items });
    } catch (err) {
      console.error("[getMiDepositoPropio] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Ajuste manual de stock — Contabilium no tiene API oficial para esto, solo
// su consola web ("Modificación de stock"). Se resuelve el idConcepto del
// producto por SKU con la API oficial (confiable), y el ajuste en sí se
// hace con un navegador headless que se loguea en la consola web y repite
// los dos pedidos internos que reverse-engineamos ahí (ver
// contabiliumWebAutomation.js). Solo staff admin — toca stock real.

// Emite una factura/nota real con IVA discriminado de verdad — bug
// detectado 1/10/2026: la API REST oficial de Contabilium (crearComprobante
// en contabiliumService.js) no tiene forma de mandar el IVA por ítem, así
// que todas las facturas automáticas salían con $0 de IVA aunque el precio
// cobrado ya lo incluyera. Para FCA/FCB/FCC se usa en cambio el mecanismo
// real de "carrito" de la consola web (crearComprobanteWeb, reversado por
// captura real 1/10/2026), que sí permite mandar el IVA, y después se pide
// el CAE por la API REST de siempre (mismo objeto de Contabilium, da igual
// por qué canal se creó). COT y REM no son documentos AFIP y no llevan
// IVA discriminado — esos siguen por la API REST vieja, sin cambios.
// Si AFIP rechaza el CAE por "Condicion IVA receptor no es valido para la
// clase de comprobante informado" (visto primero con Calderaro, 21/10/2026),
// se intenta resolver solo, en el momento, en vez de solo mostrar el error:
//   1) Se revisa si la CondicionIva que Contabilium tiene cargada para el
//      cliente quedó desactualizada contra el padrón real de AFIP — si es
//      así, se corrige en Contabilium y se reintenta UNA vez con el mismo
//      tipo de comprobante pedido.
//   2) Si eso no alcanza (el dato ya estaba bien, como le pasó a Calderaro:
//      AFIP y Contabilium ya decían "MO" los dos) y lo que falló fue
//      puntualmente una Factura B, se reintenta automáticamente como
//      Factura C — igual de válida para un receptor que no es Responsable
//      Inscripto — y se avisa en la respuesta que se emitió con otro tipo
//      al pedido. Si lo que falló fue una Factura A, no se reintenta con
//      otro tipo (ahí sí puede corresponder revisar la condición a mano).
// En los dos pasos se borra primero el borrador sin CAE que quedó colgado
// (crearComprobanteWeb ya lo creó como "0001-00000000" antes de fallar en
// AFIP), para no acumular comprobantes huérfanos.
async function emitirComprobanteConIva({ idCliente, idDeposito, tipoFc, items, fechaEmision }) {
  if (!["FCA", "FCB", "FCC"].includes(tipoFc)) {
    return crearComprobante(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), { idCliente, idDeposito, tipoFc, items, fechaEmision });
  }

  const email = CONTABILIUM_EMAIL.value();
  const apiKey = CONTABILIUM_API_KEY.value();
  const itemsWeb = items.map((it) => ({
    sku: it.sku,
    descripcion: it.descripcion,
    cantidad: it.cantidad,
    precioUnitarioConIva: it.precioUnitario,
    iva: 21,
  }));

  async function crearYEmitir(tipo) {
    const { crearComprobanteWeb } = require("./contabiliumWebAutomation");
    // crearComprobanteWeb ya hace las dos cosas: crea el borrador Y pide el
    // CAE por el webmethod real de la consola clásica (ver el comentario
    // grande ahí mismo). Si falla, el error trae idComprobanteBorrador
    // adjunto (el catch de abajo lo reusa).
    const { idComprobante } = await crearComprobanteWeb({
      db: admin.firestore(),
      email: CONTABILIUM_WEB_EMAIL.value(),
      password: CONTABILIUM_WEB_PASSWORD.value(),
      restEmail: email,
      restApiKey: apiKey,
      idPersona: idCliente,
      idInventario: idDeposito || undefined,
      tipoFc: tipo,
      fechaEmision,
      items: itemsWeb,
    });
    // Se relee por REST (solo lectura, eso sí anduvo siempre bien) para
    // devolver el objeto completo y actualizado — Numero real, Cae, etc.
    const comprobante = await getComprobanteById(email, apiKey, idComprobante);
    return { Id: idComprobante, ...(comprobante || {}) };
  }

  try {
    return await crearYEmitir(tipoFc);
  } catch (err) {
    const msg = err.message || String(err);
    if (!/Condicion IVA receptor/i.test(msg)) throw err;
    console.warn("[emitirComprobanteConIva] Error de condición IVA de AFIP, intentando resolver automáticamente:", msg);

    let condicionCorregida = false;
    try {
      const cliente = await getClientById(email, apiKey, idCliente);
      if (cliente?.NroDoc) {
        const afip = await getDatosAfip(email, apiKey, cliente.NroDoc);
        if (afip?.CategoriaImpositiva && afip.CategoriaImpositiva !== cliente.CondicionIva) {
          await updateCliente(email, apiKey, idCliente, { ...cliente, CondicionIva: afip.CategoriaImpositiva });
          condicionCorregida = true;
        }
      }
    } catch (syncErr) {
      console.warn("[emitirComprobanteConIva] No se pudo verificar/sincronizar CondicionIva:", syncErr.message || syncErr);
    }

    if (err.idComprobanteBorrador) {
      try {
        const { deleteComprobante } = require("./contabiliumService");
        await deleteComprobante(email, apiKey, err.idComprobanteBorrador);
      } catch (delErr) {
        console.warn("[emitirComprobanteConIva] No se pudo borrar el borrador huérfano:", delErr.message || delErr);
      }
    }

    if (condicionCorregida) {
      try {
        return await crearYEmitir(tipoFc);
      } catch (retryErr) {
        err = retryErr;
        if (err.idComprobanteBorrador) {
          try {
            const { deleteComprobante } = require("./contabiliumService");
            await deleteComprobante(email, apiKey, err.idComprobanteBorrador);
          } catch (delErr) {
            console.warn("[emitirComprobanteConIva] No se pudo borrar el borrador huérfano del reintento:", delErr.message || delErr);
          }
        }
      }
    }

    // Antes acá se reintentaba sola como Factura C si la B fallaba — se
    // sacó: nosotros somos Responsable Inscripto, una C no discrimina IVA
    // (literal $0 de IVA) y terminaría facturando sin el IVA que sí
    // corresponde cobrar. Mejor mostrar el error real y que se resuelva a
    // mano (revisar el cliente en Contabilium) antes que emitir un
    // comprobante fiscalmente incorrecto solo para que "no falle".
    throw err;
  }
}
// Compartida entre ajustarStockManual y resolveSaleRequest (marcar
// "facturado" a mano) — resuelve el idConcepto por SKU, el idCC guardado
// para el depósito, y dispara el ajuste real vía la consola web de
// Contabilium. Tira si falta el idCC (needsIdCC:true en el error) — quien
// llama decide si eso bloquea la operación o solo avisa.
async function ajustarStockInterno({ depositoId, sku, cantidad, tipoModificacion, idCC, nroRef, observaciones }) {
  const email = CONTABILIUM_EMAIL.value();
  const apiKey = CONTABILIUM_API_KEY.value();
  const conceptos = await getAllConceptos(email, apiKey);
  const concepto = conceptos.find((c) => (c.Codigo || "").trim() === String(sku).trim());
  if (!concepto) {
    const err = new Error(`No se encontró el producto con SKU ${sku} en Contabilium`);
    err.status = 404;
    throw err;
  }

  const db = admin.firestore();
  const idCCDocRef = db.doc("internalData/contabiliumIdCC");
  const idCCSnap = await idCCDocRef.get();
  const idCCMap = idCCSnap.exists ? idCCSnap.data().porDeposito || {} : {};
  const depositoKey = String(depositoId);
  let idCCFinal = idCC != null ? Number(idCC) : idCCMap[depositoKey];
  if (idCCFinal == null) {
    const err = new Error("Falta el ID de Cuenta Corriente (idCC) para este depósito — ingresalo una sola vez.");
    err.needsIdCC = true;
    err.status = 409;
    throw err;
  }
  if (idCC != null && idCCMap[depositoKey] !== Number(idCC)) {
    await idCCDocRef.set({ porDeposito: { ...idCCMap, [depositoKey]: Number(idCC) } }, { merge: true });
  }

  const { ajustarStockWeb } = require("./contabiliumWebAutomation");
  await ajustarStockWeb({
    db,
    email: CONTABILIUM_WEB_EMAIL.value(),
    password: CONTABILIUM_WEB_PASSWORD.value(),
    idConcepto: concepto.Id,
    idInventario: Number(depositoId),
    cantidad,
    tipoModificacion,
    idCC: idCCFinal,
    nroRef,
    observaciones,
  });
}

exports.ajustarStockManual = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { depositoId, sku, cantidad, tipoModificacion, idCC, nroRef, observaciones } = req.body || {};
      if (!depositoId || !sku || cantidad == null || !["R", "M"].includes(tipoModificacion)) {
        return res.status(400).json({ error: "Faltan datos: depositoId, sku, cantidad, tipoModificacion ('R' o 'M')" });
      }

      await ajustarStockInterno({ depositoId, sku, cantidad, tipoModificacion, idCC, nroRef, observaciones });

      return res.json({ ok: true });
    } catch (err) {
      if (err.needsIdCC) return res.status(409).json({ error: err.message, needsIdCC: true });
      console.error("[ajustarStockManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Crea un depósito nuevo de verdad en Contabilium (Inventarios > Depósitos)
// — no hay API oficial para esto, así que va por automatización web (ver
// crearDepositoWeb en contabiliumWebAutomation.js, reversado a partir de una
// captura real del sitio, 29/9/2026). Contabilium no devuelve el ID del
// depósito recién creado en la respuesta — el staff tiene que entrar a
// Contabilium, buscarlo por nombre y copiar el ID de la URL
// (inventariose.aspx?ID=x) para vincularlo a un cliente después, como se
// hizo a mano con Budabike.
// Lee el nombre actual de UN depósito por su ID de Contabilium (solo
// lectura, no toca nada) — para cuando el staff encuentra a mano un
// depósito que puede ser el mismo que Contabilium dice que "ya existe" al
// intentar crear uno nuevo, y hace falta confirmar de qué depósito se trata
// antes de vincularlo.
exports.leerNombreDepositoWeb = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 60, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "Falta id" });
      const { getCookieValida } = require("./contabiliumWebAutomation");
      const cookie = await getCookieValida(admin.firestore(), CONTABILIUM_WEB_EMAIL.value(), CONTABILIUM_WEB_PASSWORD.value());
      const resp = await fetch(`https://app.contabilium.com/modulos/inventarios/inventariose.aspx?ID=${id}`, {
        headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
      });
      const html = await resp.text();
      const m = /name="ctl00\$MainContent\$txtNombre"[^>]*value="([^"]*)"/i.exec(html);
      return res.json({ id, nombre: m ? m[1] : null, encontrado: !!m });
    } catch (err) {
      console.error("[deposito] leerNombreDepositoWeb error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.crearDepositoManual = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 60,
    // Usa el mismo navegador headless (Puppeteer) que el resto de la
    // automatización web — con el límite por defecto de 256MiB se quedaba
    // sin memoria a mitad de sesión (visto 2/10/2026: "Memory limit of
    // 256 MiB exceeded with 283 MiB used", el pedido terminaba en 500 sin
    // mensaje claro para el usuario).
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { nombre, direccion, telefono, idProvincia, idCiudad } = req.body || {};
      if (!nombre || !String(nombre).trim()) {
        return res.status(400).json({ error: "Falta el nombre del depósito" });
      }

      const { crearDepositoWeb } = require("./contabiliumWebAutomation");
      await crearDepositoWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        nombre: String(nombre).trim(),
        direccion: direccion || "",
        telefono: telefono || "",
        ...(idProvincia ? { idProvincia: Number(idProvincia) } : {}),
        ...(idCiudad ? { idCiudad: Number(idCiudad) } : {}),
      });

      return res.json({ ok: true, aviso: "Creado en Contabilium. Andá a Depósitos, buscalo por nombre, y copiá el ID de la URL (inventariose.aspx?ID=x) para vincularlo a un cliente." });
    } catch (err) {
      console.error("[crearDepositoManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Lista de provincias de Argentina — estática, para el selector al crear un
// depósito. No hace falta pegarle a Contabilium en vivo por esto.
exports.listarProvincias = onRequest({ cors: false }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  const staffUid = await requireStaff(req, res);
  if (!staffUid) return;
  const { PROVINCIAS_ARGENTINA } = require("./contabiliumWebAutomation");
  return res.json({ provincias: PROVINCIAS_ARGENTINA });
});

// Ciudades de una provincia puntual — esta sí hay que pedirla en vivo (son
// demasiadas para guardar a mano), para el selector al crear un depósito.
exports.listarCiudadesContabilium = onRequest(
  { cors: false, secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 60, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { idProvincia } = req.body || {};
      if (!idProvincia) return res.status(400).json({ error: "Falta idProvincia" });
      const { listarCiudadesWeb } = require("./contabiliumWebAutomation");
      const ciudades = await listarCiudadesWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idProvincia: Number(idProvincia),
      });
      return res.json({ ciudades: (ciudades || []).map((c) => ({ id: c.ID, nombre: c.Nombre })) });
    } catch (err) {
      console.error("[listarCiudadesContabilium] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Lista los cheques reales que Contabilium tiene disponibles en Tesorería
// (los mismos que aparecen en el desplegable "Cheques" al cobrar) — para
// poder referenciarlos desde Clientes 360 ("Proviene del cheque X") sin
// tener que ir a buscarlos a mano a Contabilium. No los aplica de verdad —
// eso (consumir el cheque real contra una factura, con el flujo nativo de
// Contabilium) queda pendiente, necesita más reverse engineering
// (cobranzase.aspx: agregarItem + agregarForma + guardar, con sessionId).
exports.listarChequesDisponiblesContabilium = onRequest(
  { cors: false, secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { listarChequesDisponiblesWeb } = require("./contabiliumWebAutomation");
      const cheques = await listarChequesDisponiblesWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
      });
      return res.json({
        cheques: (cheques || []).map((c) => ({
          id: c.ID,
          banco: (c.Nombre || "").split(" - Nro:")[0] || "",
          codigo: c.Codigo,
          importe: Number(String(c.Importe || "0").replace(",", ".")),
        })),
      });
    } catch (err) {
      console.error("[listarChequesDisponiblesContabilium] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Carga un cheque de verdad en Tesorería > Cheques de Contabilium — no hay
// API para esto (confirmado, ver probeChequesEndpoints), así que va por
// automatización web (ver cargarChequeWeb en contabiliumWebAutomation.js,
// reversado a partir de una captura real del sitio, sept/2026). Distinto de
// `chequesRegistrados` (cartera interna de Samurai, con foto, que no toca
// Contabilium) — esto es la carga real del lado de Contabilium.
exports.cargarChequeManual = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const {
        banco, idBanco, numero, importe, fechaEmision, fechaCobro, fechaVencimiento,
        emisor, observaciones, esPropio,
      } = req.body || {};

      if ((!banco && idBanco == null) || !numero || importe == null || !fechaEmision || !fechaCobro) {
        return res.status(400).json({
          error: "Faltan datos: banco (o idBanco), numero, importe, fechaEmision, fechaCobro",
        });
      }

      // El front manda fechas ISO (yyyy-mm-dd, de un <input type=date>) —
      // Contabilium las espera en formato dd/mm/yyyy.
      const isoADdMmYyyy = (iso) => {
        if (!iso) return "";
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
        if (!m) return String(iso); // ya viene en otro formato, se manda tal cual
        return `${m[3]}/${m[2]}/${m[1]}`;
      };

      const { cargarChequeWeb } = require("./contabiliumWebAutomation");
      const resultado = await cargarChequeWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        banco,
        idBanco,
        numero,
        importe,
        fechaEmision: isoADdMmYyyy(fechaEmision),
        fechaCobro: isoADdMmYyyy(fechaCobro),
        fechaVencimiento: fechaVencimiento ? isoADdMmYyyy(fechaVencimiento) : "",
        emisor,
        observaciones,
        esPropio: !!esPropio,
      });

      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error("[cargarChequeManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Carga una cobranza "a cuenta" (sin aplicar a ninguna factura) para un
// cliente — no hay forma de hacer esto vía la API REST de Contabilium
// (/comprobantes/cobrar siempre pide un idComprobante real), así que va por
// automatización web (ver cargarCobranzaACuentaWeb en
// contabiliumWebAutomation.js, reversado a partir de una captura real,
// sept/2026). Útil cuando un pago recibido supera lo que falta cobrar de la
// única factura pendiente del cliente — el sobrante queda "a cuenta" para
// aplicarlo a una factura futura, en vez de perderse sin registrar.
exports.cargarCobranzaACuentaManual = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { idPersona, importe, fecha, forma, banco, idBanco, caja, idCaja, nroRef, observaciones } = req.body || {};

      const esEfectivo = forma === "Efectivo";
      const sinCuenta = forma === "Cheque";
      if (!idPersona || importe == null || !fecha || (!esEfectivo && !sinCuenta && !banco && idBanco == null)) {
        return res.status(400).json({
          error: "Faltan datos: idPersona, importe, fecha, banco (o idBanco) — no hace falta banco si forma es Efectivo o Cheque",
        });
      }

      const isoADdMmYyyy = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
      };

      const { cargarCobranzaACuentaWeb } = require("./contabiliumWebAutomation");
      const resultado = await cargarCobranzaACuentaWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idPersona: Number(idPersona),
        importe,
        fecha: isoADdMmYyyy(fecha),
        forma: forma || "Transferencia",
        banco,
        idBanco,
        caja,
        idCaja,
        nroRef,
        observaciones,
      });

      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error("[cargarCobranzaACuentaManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Aplica un pago a una factura puntual (idComprobante real) — mismo flujo
// web que cargarCobranzaACuentaManual pero SIN el riesgo de pisar recibos
// previos que tiene la API REST /comprobantes/cobrar (ver comentario en
// aplicarPagoFacturaWeb). `forma` = "Transferencia" | "Efectivo" | "Cheque" |
// "Nota de crédito" (con idNotaCredito) — mismos valores que el combo de
// Contabilium. `idcheque` es el ID que devuelve cargarChequeManual al haber
// cargado el cheque en Tesorería antes.
exports.aplicarPagoFacturaManual = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const {
        idPersona, idComprobante, comprobante, importe, saldoFactura, fecha,
        forma, banco, idBanco, idcheque, nroRef, idNotaCredito, observaciones,
      } = req.body || {};

      if (!idPersona || !idComprobante || importe == null || saldoFactura == null || !fecha) {
        return res.status(400).json({ error: "Faltan datos: idPersona, idComprobante, importe, saldoFactura, fecha" });
      }

      const isoADdMmYyyy = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
      };

      const { aplicarPagoFacturaWeb } = require("./contabiliumWebAutomation");
      const resultado = await aplicarPagoFacturaWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idPersona: Number(idPersona),
        idComprobante: Number(idComprobante),
        comprobante,
        importe,
        saldoFactura,
        fecha: isoADdMmYyyy(fecha),
        forma: forma || "Transferencia",
        banco,
        idBanco,
        idcheque,
        nroRef,
        idNotaCredito,
        observaciones,
      });

      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error("[aplicarPagoFacturaManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Transferencia real de stock entre depósitos. Dos formas de entrar acá:
// - Staff (admin/chofer): puede transferir entre cualquier par de depósitos.
// - Un supervisor con `vendedoresAsignados` (ej. Alfredo Bavcevich): puede
//   transferir SOLO (a) desde su propio depósito hacia uno de sus clientes
//   asignados, o (b) desde el depósito de Lavalle hacia su propio depósito
//   — nunca entre depósitos ajenos. Se valida siempre del lado del server,
//   no alcanza con que el frontend solo ofrezca esas opciones.
exports.transferirStockManual = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
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
      const { depositoOrigenId, depositoDestinoId, sku, cantidad, items: itemsBody, observaciones, depositoOrigenNombre, depositoDestinoNombre, sinRemito } = req.body || {};
      // Acepta tanto el formato viejo (sku + cantidad sueltos, un solo
      // producto) como el nuevo (items: [{sku, cantidad}, ...] — varios
      // productos en la misma transferencia/remito).
      const items = Array.isArray(itemsBody) && itemsBody.length > 0 ? itemsBody : sku ? [{ sku, cantidad }] : [];
      if (!depositoOrigenId || !depositoDestinoId || items.length === 0 || items.some((it) => !it.sku || !it.cantidad || Number(it.cantidad) <= 0)) {
        return res.status(400).json({ error: "Faltan datos: depositoOrigenId, depositoDestinoId, items (sku + cantidad > 0 cada uno)" });
      }
      if (Number(depositoOrigenId) === Number(depositoDestinoId)) {
        return res.status(400).json({ error: "El depósito de origen y destino no pueden ser el mismo" });
      }

      const db0 = admin.firestore();
      const callerSnap = await db0.doc(`users/${uid}`).get();
      if (!callerSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const caller = callerSnap.data();
      const origenId = Number(depositoOrigenId);
      const destinoId = Number(depositoDestinoId);

      if (!["admin", "chofer"].includes(caller.role)) {
        const asignados = Array.isArray(caller.vendedoresAsignados) ? caller.vendedoresAsignados : [];
        if (asignados.length === 0) {
          return res.status(403).json({ error: "No tenés permiso para transferir stock" });
        }
        const miDeposito = caller.contabiliumDepositoId || null;
        const esDesdeLavalleAMiDeposito = origenId === LAVALLE_DEPOSITO_ID && destinoId === miDeposito;
        let esHaciaUnCliente = false;
        if (miDeposito && origenId === miDeposito) {
          const clientesSnaps = await Promise.all(asignados.map((cUid) => db0.doc(`users/${cUid}`).get()));
          esHaciaUnCliente = clientesSnaps.some((s) => s.exists && s.data().contabiliumDepositoId === destinoId);
        }
        if (!esDesdeLavalleAMiDeposito && !esHaciaUnCliente) {
          return res.status(403).json({ error: "Ese movimiento no está permitido — solo podés mover stock entre tu depósito, Lavalle y tus clientes." });
        }
      }

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const conceptos = await getAllConceptos(email, apiKey);
      const itemsResueltos = [];
      for (const it of items) {
        const concepto = conceptos.find((c) => (c.Codigo || "").trim() === String(it.sku).trim());
        if (!concepto) return res.status(404).json({ error: `No se encontró el producto con SKU ${it.sku} en Contabilium` });
        itemsResueltos.push({ idConcepto: concepto.Id, cantidad: it.cantidad });
      }

      // Se mueve el stock de verdad y se genera el remito interno automático
      // de la transferencia (a nombre de la propia empresa, "movimiento
      // interno") — siempre funciona, no depende de tener un cliente
      // vinculado ni de precios. El remito "real" (a nombre de un
      // proveedor/cliente, para circular en la calle) es un paso aparte,
      // explícito, después de que este movimiento ya se confirmó — ver
      // generarRemitoRealManual.
      const { transferirStockWeb, generarRemitoAutoDesdeTransferencia } = require("./contabiliumWebAutomation");
      const { idTransferencia } = await transferirStockWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        items: itemsResueltos,
        idInventarioOrigen: Number(depositoOrigenId),
        idInventarioDestino: Number(depositoDestinoId),
        observaciones,
        depositoOrigenNombre,
        depositoDestinoNombre,
      });

      // El remito es opcional — algunos movimientos (ej. un supervisor
      // repartiendo entre sus propios clientes) no necesitan el papel, solo
      // mover el stock. Si se pide sin remito, se salta ese paso entero.
      const auto = sinRemito
        ? { remitoArchivo: null, remitoPdfBase64: null }
        : await generarRemitoAutoDesdeTransferencia({
            db: admin.firestore(),
            email: CONTABILIUM_WEB_EMAIL.value(),
            password: CONTABILIUM_WEB_PASSWORD.value(),
            idTransferencia,
            observaciones,
            depositoOrigenNombre,
            depositoDestinoNombre,
            idInventarioOrigen: Number(depositoOrigenId),
            idInventarioDestino: Number(depositoDestinoId),
          });

      return res.json({
        ok: true,
        idTransferencia,
        remitoArchivo: auto.remitoArchivo,
        remitoPdfBase64: auto.remitoPdfBase64,
      });
    } catch (err) {
      console.error("[transferirStockManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Remito "real" (a nombre de un proveedor/cliente elegido a mano) para que
// las bicicletas puedan circular en la calle con papeles válidos — paso
// EXPLÍCITO y aparte del movimiento de stock (que ya generó su propio
// remito interno, a nombre de FEPA TOP). En vez de crear un comprobante
// nuevo vía POST /comprobantes/crear (probado y descartado: esos quedan con
// "Numero": "0001-00000000" — Contabilium no los numera de verdad por esa
// vía, así que nunca se les puede bajar un PDF real) esto reutiliza el
// mismo remito interno que ya generó el movimiento — bien numerado por la
// consola clásica — y le reasigna el cliente + observación antes de bajar
// el PDF de nuevo. Ver asignarProveedorARemito en contabiliumWebAutomation.js.
exports.generarRemitoRealManual = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
  },
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
      const { remitoArchivo: remitoArchivoBody, proveedorContabiliumId, observaciones, incluirMercaderiaConsignacion } = req.body || {};
      if (!remitoArchivoBody) {
        return res.status(400).json({ error: "Falta remitoArchivo (el remito interno que generó el movimiento)." });
      }
      if (!proveedorContabiliumId) {
        return res.status(400).json({ error: "Elegí un proveedor/cliente real para el remito de circulación." });
      }

      const dbAuth = admin.firestore();
      const callerSnap = await dbAuth.doc(`users/${uid}`).get();
      if (!callerSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const caller = callerSnap.data();
      if (!["admin", "chofer"].includes(caller.role)) {
        const asignados = Array.isArray(caller.vendedoresAsignados) ? caller.vendedoresAsignados : [];
        if (asignados.length === 0) {
          return res.status(403).json({ error: "No tenés permiso para generar remitos" });
        }
        const clientesSnaps = await Promise.all(asignados.map((cUid) => dbAuth.doc(`users/${cUid}`).get()));
        const esUnoDeMisClientes = clientesSnaps.some(
          (s) => s.exists && s.data().contabiliumId === Number(proveedorContabiliumId)
        );
        if (!esUnoDeMisClientes) {
          return res.status(403).json({ error: "Ese cliente no es uno de los tuyos." });
        }
      }

      const { asignarProveedorARemito } = require("./contabiliumWebAutomation");
      const resultado = await asignarProveedorARemito({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        remitoArchivo: remitoArchivoBody,
        proveedorContabiliumId,
        observaciones,
        incluirMercaderiaConsignacion: incluirMercaderiaConsignacion !== false,
      });

      if (!resultado.remitoPdfBase64) {
        return res.status(500).json({ error: "No se pudo actualizar el remito o no se pudo bajar el PDF actualizado — probá de nuevo." });
      }

      return res.json({
        ok: true,
        numero: resultado.numero,
        remitoArchivo: resultado.remitoArchivo,
        remitoPdfBase64: resultado.remitoPdfBase64,
      });
    } catch (err) {
      console.error("[generarRemitoRealManual] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Direcciones de los 3 depósitos propios — mismos datos que
// DEPOSITOS_PROPIOS en src/services/logisticaViajes.ts (Credifin no tiene
// dirección cargada todavía, se completa después a mano desde la grilla).
const DEPOSITOS_PROPIOS_INFO = {
  135151: { nombre: "Lavalle (Temperley)", direccion: "Lavalle 105, B1834 Temperley, Provincia de Buenos Aires" },
  133531: { nombre: "Depósito Cañuelas", direccion: "Highway Route 6 Km 96.7, Cañuelas, Provincia de Buenos Aires" },
  131151: { nombre: "Credifin", direccion: "" },
};

// Valida en vivo contra Contabilium (no contra el campo "stock" cacheado de
// "products", que sync cada 15 min) que haya stock suficiente para los ítems
// de un pedido del catálogo. Se llama justo antes de crear el pedido, para
// achicar la ventana en la que el catálogo muestra stock que en Contabilium
// ya no está (venta por otro canal, ajuste manual, etc.). No reemplaza la
// validación de la transacción de Firestore en createOrder (esa sigue
// siendo la que da atomicidad contra otros pedidos simultáneos) — es un
// chequeo adicional, en vivo, contra la fuente real.
exports.checkStockEnVivo = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "No autorizado" });
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const { items } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Falta la lista de items" });
      }

      const { getStockDisponibleBySKU } = require("./contabiliumService");
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const skus = [...new Set(items.map((it) => String(it.sku || "").trim()).filter(Boolean))];
      const stockPorSku = new Map();
      await mapWithConcurrency(skus, 4, async (sku) => {
        try {
          const disponible = await getStockDisponibleBySKU(email, apiKey, sku);
          stockPorSku.set(sku, disponible);
        } catch (err) {
          console.error(`[checkStockEnVivo] error consultando stock de SKU ${sku}:`, err);
          stockPorSku.set(sku, null); // null = no se pudo verificar, no bloquea
        }
      });

      const shortages = [];
      for (const it of items) {
        const sku = String(it.sku || "").trim();
        const qty = Number(it.qty || 0);
        if (!sku) continue;
        const disponible = stockPorSku.get(sku);
        if (disponible != null && disponible < qty) {
          shortages.push({ id: it.id, name: it.name, available: disponible, requested: qty });
        }
      }

      return res.json({ ok: shortages.length === 0, shortages });
    } catch (err) {
      console.error("[checkStockEnVivo] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Confirma un pedido hecho por un cliente desde el catálogo público: por
// cada ítem el admin ya eligió de qué depósito propio sale (ver
// asignaciones) — acá se hace el movimiento de stock real + el remito real
// a nombre del cliente (mismo mecanismo ya probado de "Mover stock":
// transferirStockWeb + generarRemitoAutoDesdeTransferencia +
// asignarProveedorARemito) y se crea el viaje correspondiente en la grilla
// del chofer. No toca el campo "status" del pedido (lo sigue sincronizando
// doOrderStatusSync contra la factura real) — guarda el resultado aparte en
// "envio" para no interferir con ese flujo.
exports.confirmarPedidoCatalogo = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 180,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { orderId, asignaciones, fecha, turno } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId requerido" });
      if (!Array.isArray(asignaciones) || asignaciones.length === 0) {
        return res.status(400).json({ error: "Falta elegir de qué depósito sale cada ítem (asignaciones)" });
      }
      for (const a of asignaciones) {
        if (!a.itemId || !DEPOSITOS_PROPIOS_INFO[Number(a.depositoOrigenId)]) {
          return res.status(400).json({ error: "Cada asignación necesita itemId y un depositoOrigenId válido (Lavalle/Cañuelas/Credifin)" });
        }
      }

      const db = admin.firestore();
      const orderRef = db.doc(`orders/${orderId}`);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return res.status(404).json({ error: "No existe ese pedido" });
      const order = orderSnap.data();
      if (order.envio?.confirmadoAt) {
        return res.status(409).json({ error: "Este pedido ya tiene un envío confirmado." });
      }

      const items = Array.isArray(order.items) ? order.items : [];
      const itemById = new Map(items.map((it) => [it.id, it]));
      const asignacionPorItem = new Map(asignaciones.map((a) => [a.itemId, Number(a.depositoOrigenId)]));
      for (const it of items) {
        if (!asignacionPorItem.has(it.id)) {
          return res.status(400).json({ error: `Falta elegir depósito para "${it.name}"` });
        }
      }

      const customerUid = order.customer?.uid;
      if (!customerUid) return res.status(400).json({ error: "Este pedido no tiene un cliente vinculado a una cuenta." });
      const customerSnap = await db.doc(`users/${customerUid}`).get();
      const customer = customerSnap.exists ? customerSnap.data() : null;
      if (!customer?.contabiliumId || !customer?.contabiliumDepositoId) {
        return res.status(400).json({ error: "El cliente de este pedido no tiene depósito propio vinculado en Contabilium — no se puede generar el remito real." });
      }
      const customerName = customer.name || order.customer?.name || "Cliente";

      // Agrupa los ítems por depósito de origen elegido — un movimiento +
      // remito + viaje por cada depósito que participa del pedido.
      const grupos = new Map();
      for (const it of items) {
        const depId = asignacionPorItem.get(it.id);
        if (!grupos.has(depId)) grupos.set(depId, []);
        grupos.get(depId).push(it);
      }

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const conceptos = await getAllConceptos(email, apiKey);
      const { transferirStockWeb, generarRemitoAutoDesdeTransferencia, asignarProveedorARemito } = require("./contabiliumWebAutomation");

      const resultados = [];
      for (const [depId, itemsGrupo] of grupos) {
        const itemsResueltos = [];
        for (const it of itemsGrupo) {
          const concepto = conceptos.find((c) => (c.Codigo || "").trim() === String(it.sku).trim());
          if (!concepto) throw new Error(`No se encontró el producto con SKU ${it.sku} en Contabilium`);
          itemsResueltos.push({ idConcepto: concepto.Id, cantidad: it.qty });
        }
        const depInfo = DEPOSITOS_PROPIOS_INFO[depId];
        const observaciones = `Pedido web #${orderId} — ${customerName}`;

        const { idTransferencia } = await transferirStockWeb({
          db,
          email: CONTABILIUM_WEB_EMAIL.value(),
          password: CONTABILIUM_WEB_PASSWORD.value(),
          items: itemsResueltos,
          idInventarioOrigen: depId,
          idInventarioDestino: Number(customer.contabiliumDepositoId),
          observaciones,
          depositoOrigenNombre: depInfo.nombre,
          depositoDestinoNombre: customerName,
        });

        const auto = await generarRemitoAutoDesdeTransferencia({
          db,
          email: CONTABILIUM_WEB_EMAIL.value(),
          password: CONTABILIUM_WEB_PASSWORD.value(),
          idTransferencia,
          observaciones,
          depositoOrigenNombre: depInfo.nombre,
          depositoDestinoNombre: customerName,
          idInventarioOrigen: depId,
          idInventarioDestino: Number(customer.contabiliumDepositoId),
        });

        const numeroMatch = auto.remitoArchivo && /(\d{4}-\d{8})/.exec(auto.remitoArchivo);
        const numeroInterno = numeroMatch ? numeroMatch[1] : null;

        let remitoReal = null;
        let remitoEsReal = false;
        if (auto.remitoArchivo) {
          remitoReal = await asignarProveedorARemito({
            db,
            email: CONTABILIUM_WEB_EMAIL.value(),
            password: CONTABILIUM_WEB_PASSWORD.value(),
            remitoArchivo: auto.remitoArchivo,
            proveedorContabiliumId: customer.contabiliumId,
            observaciones,
            incluirMercaderiaConsignacion: true,
          });
          remitoEsReal = !!remitoReal.remitoPdfBase64;
          if (!remitoEsReal) {
            console.error(`[confirmarPedidoCatalogo] no se pudo reasignar el remito ${numeroInterno} al cliente ${customer.contabiliumId} (pedido #${orderId}) — queda a nombre de FEPA TOP, hay que reasignarlo a mano en Contabilium.`);
          }
        } else {
          console.error(`[confirmarPedidoCatalogo] no se generó remito interno para el movimiento del pedido #${orderId} (depósito ${depId}) — el stock se movió pero sin remito.`);
        }

        const resumenItems = itemsGrupo.map((it) => `${it.qty}x ${it.name} (SKU ${it.sku})`).join(", ");
        const viajeRef = await db.collection("logisticaViajes").add({
          fecha: fecha || null,
          turno: turno || "mañana",
          origen: { tipo: "deposito", id: String(depId), nombre: depInfo.nombre, direccion: depInfo.direccion, lat: null, lon: null, horario: null, telefono: null },
          destino: { tipo: "cliente", id: String(customer.contabiliumId), nombre: customerName, direccion: "", lat: null, lon: null, horario: null, telefono: null },
          horaSalida: null,
          duracionMin: null,
          distanciaKm: null,
          descargaMin: 20,
          notas: `Pedido web #${orderId} — ${resumenItems}`,
          estado: "programado",
          choferUid: null,
          choferNombre: null,
          saliAt: null,
          llegoAt: null,
          entregadoAt: null,
          remito: { numero: numeroInterno, id: null, tienePdf: !!(auto.remitoPdfBase64 || remitoReal?.remitoPdfBase64) },
          pedidoPendienteId: null,
          creadoPorUid: staffUid,
          creadoPorNombre: "Confirmación automática de pedido",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        resultados.push({
          depositoOrigenId: depId,
          depositoOrigenNombre: depInfo.nombre,
          idTransferencia,
          remitoNumero: numeroInterno,
          remitoInternoArchivo: auto.remitoArchivo,
          remitoRealArchivo: remitoEsReal ? remitoReal.remitoArchivo : null,
          remitoEsReal,
          viajeId: viajeRef.id,
          // Los PDF en base64 van solo en la respuesta HTTP (no se guardan en
          // Firestore, pesan demasiado) — para descargarlos más tarde está
          // descargarRemitoPorArchivo, que los pide de nuevo con el nombre
          // de archivo guardado arriba.
          remitoInternoPdfBase64: auto.remitoPdfBase64 || null,
          remitoRealPdfBase64: remitoEsReal ? remitoReal.remitoPdfBase64 : null,
        });
      }

      await orderRef.update({
        envio: {
          confirmadoAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmadoPorUid: staffUid,
          resultados: resultados.map(({ remitoInternoPdfBase64, remitoRealPdfBase64, ...r }) => r),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, resultados });
    } catch (err) {
      console.error("[confirmarPedidoCatalogo] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Re-descarga el PDF de un remito ya generado (el real o el interno), por
// su nombre de archivo guardado en order.envio.resultados — para cuando el
// admin vuelve más tarde a buscar el PDF y no lo tiene a mano en pantalla.
exports.descargarRemitoPorArchivo = onRequest(
  { cors: false, secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { remitoArchivo } = req.body || {};
      if (!remitoArchivo) return res.status(400).json({ error: "remitoArchivo requerido" });

      const { descargarRemitoPorArchivoWeb } = require("./contabiliumWebAutomation");
      const { remitoPdfBase64 } = await descargarRemitoPorArchivoWeb({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        remitoArchivo,
      });
      if (!remitoPdfBase64) return res.status(404).json({ error: "No se pudo bajar ese remito — puede que ya no exista o la sesión haya fallado, probá de nuevo." });
      return res.json({ ok: true, remitoPdfBase64 });
    } catch (err) {
      console.error("[descargarRemitoPorArchivo] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Endpoint temporal de investigación — trae el JSON real de un remito
// puntual (buscado por su número visible) para confirmar qué campos expone
// Contabilium de verdad, en vez de seguir adivinando la URL del PDF contra
// producción. Se borra una vez que se resuelva.
// Movimientos reales entre depósitos (incluye las transferencias internas
// que "Mover stock"/remitos no captura, ej. Lavalle→Cuchi→su cliente) —
// para el panel de Movimientos: lee la observación de cada uno y arma
// cuánto salió de nuestros depósitos hacia cada cliente, mes a mes.
exports.obtenerMovimientosStock = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { fechaDesde, fechaHasta } = req.body || {};
      if (!fechaDesde) return res.status(400).json({ error: "Falta fechaDesde" });
      const { obtenerMovimientosStock } = require("./contabiliumWebAutomation");
      const items = await obtenerMovimientosStock({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        fechaDesde,
        fechaHasta,
      });
      return res.json({ items, total: items.length });
    } catch (err) {
      console.error("[obtenerMovimientosStock] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.diagProbarWebmethodsMovimientos = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { probarWebmethodsMovimientos } = require("./contabiliumWebAutomation");
      const resultados = await probarWebmethodsMovimientos({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
      });
      return res.json({ encontrados: resultados.length, resultados });
    } catch (err) {
      console.error("[diagProbarWebmethodsMovimientos] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.diagObtenerRemito = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const numero = String(req.query.numero || "").trim();
      if (!numero) return res.status(400).json({ error: "Falta ?numero= (ej: 0001-00000543)" });
      const { diagObtenerRemito } = require("./contabiliumWebAutomation");
      const resultado = await diagObtenerRemito({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        numero,
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[diagObtenerRemito] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Endpoint temporal de investigación (SOLO LECTURA, no escribe nada en
// Contabilium) — busca en el sitio clásico algún módulo de "depósitos" que
// permita renombrarlos, para poder mostrar el mismo código propio (1-80)
// de Samurai también ahí. Se borra una vez que se resuelva.
// Investiga si Contabilium tiene en algún lado un registro de compras /
// ingreso de stock con precio por unidad — necesario para reconstruir una
// valorización de stock a una fecha pasada (pedido 21/10/2026, Ezequiel
// preguntó "no se puede ver en ctb cuándo se agregó stock y con qué
// precio?"). Prueba tanto la API REST oficial (candidatos de endpoint tipo
// /compras, /proveedores, etc.) como el sitio clásico (links/menú que
// mencionen "compra"/"proveedor"/"ingreso de stock"). Solo lectura, no
// escribe nada en Contabilium. Guarda el resultado en Firestore
// (internalData/diagCompras) para poder revisarlo sin tener que repetir la
// llamada HTTP.
exports.diagExplorarCompras = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 180 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { probeComprasEndpoints } = require("./contabiliumService");
      const { explorarModuloCompras } = require("./contabiliumWebAutomation");
      const db = admin.firestore();

      const [rest, web] = await Promise.all([
        probeComprasEndpoints(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value()).catch((e) => ({ error: e.message })),
        explorarModuloCompras({ db, email: CONTABILIUM_WEB_EMAIL.value(), password: CONTABILIUM_WEB_PASSWORD.value() }).catch((e) => ({ error: e.message })),
      ]);

      const resultado = { rest, web, checkedAt: new Date().toISOString() };
      await db.doc("internalData/diagCompras").set(resultado);
      return res.json(resultado);
    } catch (err) {
      console.error("[diagExplorarCompras] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.diagExplorarHistoricoStock = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { explorarHistoricoStock } = require("./contabiliumWebAutomation");
      const resultado = await explorarHistoricoStock({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        fecha: req.body?.fecha,
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[diagExplorarHistoricoStock] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.diagHistoricoStockReal = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 540, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { obtenerHistoricoStockReal } = require("./contabiliumWebAutomation");
      const resultado = await obtenerHistoricoStockReal({
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        depositoNombre: req.body?.depositoNombre,
        fechaDesde: req.body?.fechaDesde,
        fechaHasta: req.body?.fechaHasta,
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[diagHistoricoStockReal] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Busca TODOS los movimientos de stock (sin filtrar por origen/destino de
// ningún vendedor puntual) cuya observación mencione a Julián, en un rango
// de fechas — para auditar a mano si hay retiros/envíos suyos desde
// depósitos que no sean Lavalle (ej. Credifin) que el informe de Vito no
// esté agarrando (pedido 26/10/2026).
exports.diagMovimientosJulian = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { obtenerMovimientosStock } = require("./contabiliumWebAutomation");
      const fechaDesde = req.body?.fechaDesde || "2026-08-01";
      const fechaHasta = req.body?.fechaHasta || new Date().toISOString().slice(0, 10);
      const movimientos = await obtenerMovimientosStock({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        fechaDesde,
        fechaHasta,
      });
      const julianRe = /juli[aá]n/i;
      const matches = movimientos
        .filter((m) => julianRe.test(m.descripcion || ""))
        .map((m) => ({
          fecha: m.fecha,
          origen: m.origen,
          destino: m.destino,
          codigoNombre: m.codigoNombre,
          cantidad: m.cantidad,
          descripcion: m.descripcion,
        }));
      return res.json({ ok: true, totalMovimientos: movimientos.length, totalConJulian: matches.length, matches });
    } catch (err) {
      console.error("[diagMovimientosJulian] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.diagExplorarModuloDepositos = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { explorarModuloDepositos } = require("./contabiliumWebAutomation");
      const resultado = await explorarModuloDepositos({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[diagExplorarModuloDepositos] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Renombra UN depósito de Contabilium (solo el campo "Nombre", no toca
// dirección/teléfono ni el ID). Prueba de un solo depósito por vez a
// propósito — nunca hace un batch, para que cada cambio se pueda revisar
// antes de seguir con el siguiente.
exports.diagExplorarBorrarDeposito = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "Falta id" });
      const { explorarBorrarDeposito } = require("./contabiliumWebAutomation");
      const resultado = await explorarBorrarDeposito({
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        id: Number(id),
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[diagExplorarBorrarDeposito] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.adminRenombrarDeposito = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120, memory: "512MiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { id, nombreNuevo } = req.body || {};
      if (!id || !nombreNuevo) return res.status(400).json({ error: "Faltan id y/o nombreNuevo" });
      const { renombrarDepositoWeb } = require("./contabiliumWebAutomation");
      const resultado = await renombrarDepositoWeb({
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        id: Number(id),
        nombreNuevo: String(nombreNuevo),
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[adminRenombrarDeposito] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Detalle completo de un remito por su id (solo lectura) — para mostrarlo
// tal cual está en Contabilium antes de decidir si hace falta editarlo.
// Baja el PDF real de Contabilium (con CAE de AFIP) de una factura ya
// emitida — nunca se hizo antes, solo existe para remitos. Prueba varios
// endpoints/nombres candidatos (ver obtenerPdfComprobante en
// contabiliumWebAutomation.js); si ninguno funciona, devuelve el detalle de
// qué se probó para poder ajustar los candidatos.
// Para que el propio cliente baje el PDF REAL de Contabilium (con CAE) de
// una de SUS facturas — hasta ahora "Mi cuenta" solo ofrecía el render
// propio de Samurai (printComprobante), que no sirve como factura fiscal
// de verdad. Pedido explícito 28/10/2026 (reclamo de Bicicletas Araoz).
// Mismo chequeo de pertenencia que getComprobanteDetail.
exports.clienteDescargarPdfComprobante = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
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
      const { idComprobante } = req.body || {};
      if (!idComprobante) return res.status(400).json({ error: "Falta idComprobante" });

      const db = admin.firestore();
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const { contabiliumId } = userSnap.data();
      if (!contabiliumId) return res.status(400).json({ error: "Usuario sin vinculación Contabilium" });

      const comprobante = await getComprobanteById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), Number(idComprobante));
      if (!comprobante) return res.status(404).json({ error: "Comprobante no encontrado" });
      if (comprobante.IdCliente !== contabiliumId) {
        return res.status(403).json({ error: "Acceso denegado" });
      }

      const { obtenerPdfComprobante } = require("./contabiliumWebAutomation");
      const resultado = await obtenerPdfComprobante({
        db,
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idComprobante: Number(idComprobante),
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[clienteDescargarPdfComprobante] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.adminDescargarPdfComprobante = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { idComprobante } = req.body || {};
      if (!idComprobante) return res.status(400).json({ error: "Falta idComprobante" });
      const { obtenerPdfComprobante } = require("./contabiliumWebAutomation");
      const resultado = await obtenerPdfComprobante({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idComprobante: Number(idComprobante),
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[adminDescargarPdfComprobante] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.adminObtenerRemitoDetalle = onRequest(
  {
    cors: false,
    invoker: "public",
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD, CONTABILIUM_EMAIL, CONTABILIUM_API_KEY],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const idRemito = req.method === "POST" ? req.body?.idRemito : req.query.idRemito;
      if (!idRemito) return res.status(400).json({ error: "Falta idRemito" });
      const { obtenerRemitoPorId } = require("./contabiliumWebAutomation");
      const remito = await obtenerRemitoPorId({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idRemito: Number(idRemito),
      });
      // ObtenerRemito (detalle de UNO solo) no trae la razón social del
      // idPersona — ese campo solo viene en ObtenerRemitos (el listado),
      // que acá no se pide. Sin esto el modal mostraba el id pelado ("—
      // (109048271)") aunque el remito SÍ tuviera un cliente real asignado.
      // Se busca por la API REST oficial de Contabilium (clientes/{id}), que
      // sí devuelve RazonSocial para cualquier idPersona, sea FEPA TOP o un
      // cliente real.
      if (remito && remito.idPersona != null && !remito.razonSocialLista) {
        try {
          const { getClientById } = require("./contabiliumService");
          const cliente = await getClientById(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), remito.idPersona);
          if (cliente?.RazonSocial) remito.razonSocialLista = cliente.RazonSocial;
        } catch (e) {
          console.warn("[adminObtenerRemitoDetalle] no se pudo resolver razón social del idPersona:", e.message);
        }
      }
      return res.json(remito);
    } catch (err) {
      console.error("[adminObtenerRemitoDetalle] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Actualiza SOLO la observación de un remito ya existente en Contabilium.
exports.adminEditarObservacionRemito = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { idRemito, observaciones } = req.body || {};
      if (!idRemito) return res.status(400).json({ error: "Falta idRemito" });
      const { editarObservacionRemito } = require("./contabiliumWebAutomation");
      const remito = await editarObservacionRemito({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idRemito: Number(idRemito),
        observaciones: String(observaciones || ""),
      });
      return res.json(remito);
    } catch (err) {
      console.error("[adminEditarObservacionRemito] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Agrupación geográfica de provincias en 5 zonas comerciales (AMBA / Centro
// / NOA-NEA / Cuyo / Patagonia). Buenos Aires no se separa en GBA vs interior
// porque los datos de Contabilium no traen partido/localidad estructurada
// para hacer esa distinción de forma confiable — queda toda en Zona 1.
const ZONA_POR_PROVINCIA = {
  "CABA": 1, "CIUDAD AUTONOMA DE BUENOS AIRES": 1, "CAPITAL FEDERAL": 1, "BUENOS AIRES": 1,
  "SANTA FE": 2, "CORDOBA": 2, "ENTRE RIOS": 2, "LA PAMPA": 2,
  "SALTA": 3, "JUJUY": 3, "TUCUMAN": 3, "SANTIAGO DEL ESTERO": 3, "CATAMARCA": 3, "LA RIOJA": 3,
  "CORRIENTES": 3, "MISIONES": 3, "CHACO": 3, "FORMOSA": 3,
  "MENDOZA": 4, "SAN JUAN": 4, "SAN LUIS": 4,
  "NEUQUEN": 5, "RIO NEGRO": 5, "CHUBUT": 5, "SANTA CRUZ": 5, "TIERRA DEL FUEGO": 5,
};
const NOMBRE_ZONA = {
  1: "Zona 1 - AMBA",
  2: "Zona 2 - Centro",
  3: "Zona 3 - NOA-NEA",
  4: "Zona 4 - Cuyo",
  5: "Zona 5 - Patagonia",
  0: "Zona sin clasificar",
};
// Video de auditoría más reciente por depósito, y su estado (al día/por
// vencer/vencido/sin video) — misma lógica que useCrmData.js / stockAudits.ts
// en el front, portada acá para poder calcularla server-side en los exports.
const AUDIT_INTERVAL_DAYS_DEFAULT = 10;
function construirUltimoVideoPorDeposito(stockAuditsSnap) {
  const map = new Map();
  for (const doc of stockAuditsSnap.docs) {
    const a = doc.data();
    const key = String(a.depositoId);
    const fecha = a.createdAt?.toDate?.() || null;
    if (!fecha) continue;
    if (!map.has(key) || fecha > map.get(key)) map.set(key, fecha);
  }
  return map;
}
function calcularVideoEstado(depositoId, intervalDays, ultimoVideoPorDeposito, programStart) {
  if (depositoId == null) return { estado: "no aplica", ultimaFecha: null };
  const ultimoVideo = ultimoVideoPorDeposito.get(String(depositoId)) || null;
  const base = ultimoVideo || programStart;
  if (!ultimoVideo) return { estado: "sin video", ultimaFecha: null };
  if (!base) return { estado: "vencido", ultimaFecha: ultimoVideo };
  const next = new Date(base);
  next.setDate(next.getDate() + (intervalDays || AUDIT_INTERVAL_DAYS_DEFAULT));
  const msLeft = next.getTime() - Date.now();
  let estado;
  if (msLeft <= 0) estado = "vencido";
  else if (msLeft <= 2 * 24 * 60 * 60 * 1000) estado = "por vencer";
  else estado = "al dia";
  return { estado, ultimaFecha: ultimoVideo };
}

function zonaDeProvincia(provincia) {
  const norm = String(provincia || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // saca acentos
  const num = ZONA_POR_PROVINCIA[norm] || 0;
  return { numero: num, nombre: NOMBRE_ZONA[num] };
}

// Endpoint temporal de investigación — prueba nombres de método candidatos
// para ver si alguno devuelve el idCC de un depósito automáticamente. Se
// borra una vez que se resuelva (o se confirme que no hay forma).
// Exporta el listado completo del mapa a un Excel con dos solapas:
// "Consignados" (con su situación/color marcada a mano) y "Sin depósito"
// (compradores, sin ese seguimiento). Mismo criterio "tiene depósito" que
// usa el mapa (contabiliumDepositoId cargado en su users/{uid}).
exports.exportarMapaClientes = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const XLSX = require("xlsx");
      const db = admin.firestore();
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const [clientes, usersSnap, situSnap, customerTypesSnap, reportDetailSnap, stockAuditsSnap, programSnap] = await Promise.all([
        getAllClientes(email, apiKey),
        db.collection("users").where("kind", "==", "client").get(),
        db.collection("situacionClientes").get(),
        db.collection("customerTypes").get(),
        db.doc("meta/clientesReportDetail").get(),
        db.collection("stockAudits").get(),
        db.doc("meta/stockAuditProgram").get(),
      ]);

      const sinMovimiento = await getContabiliumIdsSinMovimiento(db);
      const provinciaFiltro = String(req.body?.provincia || "").trim().toUpperCase();

      const tituloPorCustomerTypeId = new Map();
      for (const doc of customerTypesSnap.docs) {
        tituloPorCustomerTypeId.set(doc.id, doc.data().title || "");
      }
      const reporteFilaPorContabiliumId = new Map();
      for (const row of reportDetailSnap.exists ? reportDetailSnap.data().rows || [] : []) {
        if (row.contabiliumId != null) reporteFilaPorContabiliumId.set(row.contabiliumId, row);
      }

      // Video de auditoría más reciente por depósito, y estado (al día/por
      // vencer/vencido/sin video) — misma lógica que useCrmData.js /
      // stockAudits.ts en el front, portada acá para que salga en el Excel.
      const programStart = programSnap.exists && programSnap.data().startedAt ? programSnap.data().startedAt.toDate() : null;
      const ultimoVideoPorDeposito = construirUltimoVideoPorDeposito(stockAuditsSnap);

      const depositoPorContabiliumId = new Map();
      const datosExtraPorContabiliumId = new Map(); // instagram, bicicletería, perfil comercial
      const videoPorContabiliumId = new Map();
      for (const doc of usersSnap.docs) {
        const u = doc.data();
        if (u.contabiliumId == null) continue;
        depositoPorContabiliumId.set(u.contabiliumId, u.contabiliumDepositoNombre || (u.contabiliumDepositoId ? "Sí" : null));
        datosExtraPorContabiliumId.set(u.contabiliumId, {
          instagram: u.instagram || "",
          bicicleteria: u.bicicleteria || "",
          perfilComercial: (u.customerTypeId && tituloPorCustomerTypeId.get(u.customerTypeId)) || "",
        });
        videoPorContabiliumId.set(u.contabiliumId, calcularVideoEstado(u.contabiliumDepositoId, u.auditIntervalDays, ultimoVideoPorDeposito, programStart));
      }
      const situacionPorContabiliumId = new Map();
      for (const doc of situSnap.docs) {
        situacionPorContabiliumId.set(Number(doc.id), doc.data());
      }

      const consignados = [];
      const sinDeposito = [];
      for (const c of clientes) {
        if (CLIENTES_EXCLUIDOS_DEL_CRM.has(c.Id) || CLIENTES_FANTASMA_EXCLUIDOS.has(c.Id) || sinMovimiento.has(c.Id)) continue;
        if (provinciaFiltro && String(c.Provincia || "").trim().toUpperCase() !== provinciaFiltro) continue;
        const nombre = c.RazonSocial || c.NombreFantasia || "(sin nombre)";
        const depositoNombre = depositoPorContabiliumId.get(c.Id);
        const extra = datosExtraPorContabiliumId.get(c.Id) || {};
        const reporteFila = reporteFilaPorContabiliumId.get(c.Id) || null;
        const video = videoPorContabiliumId.get(c.Id) || { estado: "no aplica", ultimaFecha: null };
        const zona = zonaDeProvincia(c.Provincia);
        const ctaCte = !reporteFila
          ? "s/dato"
          : reporteFila.saldoDeudor > 0
          ? `Debe $${Math.round(reporteFila.saldoDeudor).toLocaleString("es-AR")}`
          : reporteFila.saldoAFavor > 0
          ? `A favor $${Math.round(reporteFila.saldoAFavor).toLocaleString("es-AR")}`
          : "Al día";
        const base = {
          Nombre: nombre,
          CUIT: c.NroDoc || "",
          Dirección: c.Domicilio || "",
          CP: c.Cp || "",
          Ciudad: limpiarCiudad(c.Ciudad),
          Provincia: c.Provincia || "",
          Zona: zona.nombre,
          Teléfono: c.Telefono || c.Celular || "",
          Bicicletería: extra.bicicleteria || "",
          Instagram: extra.instagram ? `@${extra.instagram}` : "",
          "Modalidad logística": depositoNombre ? "Consignado (distribuidor)" : "Comprador directo",
          "Perfil comercial": extra.perfilComercial || "(sin perfil)",
          "Estado cta. cte.": ctaCte,
          "Último pedido": reporteFila?.fechaUltimaFactura || "(sin facturas)",
          "Video estado": video.estado,
          "Video último": video.ultimaFecha ? video.ultimaFecha.toISOString().slice(0, 10) : "",
        };
        if (depositoNombre) {
          const situ = situacionPorContabiliumId.get(c.Id);
          consignados.push({
            ...base,
            Depósito: depositoNombre,
            Situación: situ?.etiqueta || "(sin marcar)",
            Color: situ?.color || "",
            Llamado: situ?.llamado ? "Sí" : "No",
            Nota: situ?.nota || "",
            "Marcado por": situ?.updatedByNombre || "",
          });
        } else {
          sinDeposito.push(base);
        }
      }

      // El color se ve como texto en la columna "Color" — Excel no permite
      // pintar celdas fácil desde acá sin una librería más pesada, pero
      // dejamos también el emoji al lado del nombre de la situación para
      // que se distinga de un vistazo igual.
      const emojiPorColor = { verde: "🟢", amarillo: "🟡", naranja: "🟠", rojo: "🔴", vencido: "🟣" };
      for (const row of consignados) {
        if (row.Color) row.Situación = `${emojiPorColor[row.Color] || ""} ${row.Situación}`;
      }

      // Nombre de hoja válido para Excel: máx 31 caracteres, sin : \ / ? * [ ],
      // y único dentro del libro (si dos provincias truncadas coinciden).
      function nombreDeHojaUnico(nombre, usados) {
        let base = String(nombre || "(sin provincia)")
          .replace(/[:\\/?*[\]]/g, " ")
          .trim()
          .slice(0, 31) || "(sin provincia)";
        let final = base;
        let i = 2;
        while (usados.has(final)) {
          final = `${base.slice(0, 28)} ${i}`;
          i++;
        }
        usados.add(final);
        return final;
      }

      const wb = XLSX.utils.book_new();
      const usadas = new Set();
      if (provinciaFiltro) {
        // Ya viene filtrado a una sola provincia — una sola hoja, como antes.
        const ws = XLSX.utils.json_to_sheet(consignados);
        XLSX.utils.book_append_sheet(wb, ws, nombreDeHojaUnico(req.body.provincia, usadas));
      } else {
        // Sin filtro: una hoja por zona (Zona 1 a 5 + sin clasificar), y
        // dentro de cada una las filas ordenadas por provincia y nombre.
        const porZona = new Map();
        for (const row of consignados) {
          const key = row.Zona || NOMBRE_ZONA[0];
          if (!porZona.has(key)) porZona.set(key, []);
          porZona.get(key).push(row);
        }
        for (const rows of porZona.values()) {
          rows.sort((a, b) => a.Provincia.localeCompare(b.Provincia, "es") || a.Nombre.localeCompare(b.Nombre, "es"));
        }
        const zonasOrdenadas = [1, 2, 3, 4, 5, 0].map((n) => NOMBRE_ZONA[n]).filter((z) => porZona.has(z));
        for (const zona of zonasOrdenadas) {
          const ws = XLSX.utils.json_to_sheet(porZona.get(zona));
          XLSX.utils.book_append_sheet(wb, ws, nombreDeHojaUnico(zona, usadas));
        }
      }
      const wsSinDeposito = XLSX.utils.json_to_sheet(sinDeposito);
      XLSX.utils.book_append_sheet(wb, wsSinDeposito, nombreDeHojaUnico("Sin depósito", usadas));

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = buf.toString("base64");

      return res.json({
        ok: true,
        base64,
        filename: `Clientes Samurai${provinciaFiltro ? ` - ${req.body.provincia}` : ""} ${new Date().toISOString().slice(0, 10)}.xlsx`,
        totalConsignados: consignados.length,
        totalSinDeposito: sinDeposito.length,
      });
    } catch (err) {
      console.error("[exportarMapaClientes] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Excel "de trabajo" para la ronda de llamadas de presentación de la nueva
// administración (Ezequiel y Mariana): una hoja con el guion sugerido y,
// después, una hoja por zona con el listado numerado de clientes consignados
// (con todos sus datos) para ir tildando durante las llamadas.
exports.exportarGuionLlamadas = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const XLSX = require("xlsx");
      const db = admin.firestore();
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const [clientes, usersSnap, situSnap, customerTypesSnap, reportDetailSnap, stockAuditsSnap, programSnap, geoLocalidadSnap, geoDireccionSnap] = await Promise.all([
        getAllClientes(email, apiKey),
        db.collection("users").where("kind", "==", "client").get(),
        db.collection("situacionClientes").get(),
        db.collection("customerTypes").get(),
        db.doc("meta/clientesReportDetail").get(),
        db.collection("stockAudits").get(),
        db.doc("meta/stockAuditProgram").get(),
        db.doc("meta/geocodeLocalidades").get(),
        db.doc("meta/geocodeDirecciones").get(),
      ]);
      const sinMovimiento = await getContabiliumIdsSinMovimiento(db);

      // Mismas cachés de geocodificación que ya llenó el mapa del CRM
      // (getClientesConUbicacion) — se reutilizan en modo solo-lectura acá,
      // sin volver a pegarle a Google/GeoRef, para poder ordenar la ronda de
      // llamadas por cercanía real en vez de alfabético.
      const geoLocalidadCache = geoLocalidadSnap.exists ? geoLocalidadSnap.data().porClave || {} : {};
      const geoDireccionCache = geoDireccionSnap.exists ? geoDireccionSnap.data().porClave || {} : {};
      const claveLocalidad = (ciudad, provincia) => `${String(ciudad || "").trim().toUpperCase()}|${String(provincia || "").trim().toUpperCase()}`;
      const claveDireccionGeo = (direccion, ciudad, provincia) => `${String(direccion || "").trim().toUpperCase()}|${claveLocalidad(ciudad, provincia)}`;
      function ubicacionDeCliente(c) {
        const claveDir = c.Domicilio && c.Ciudad ? claveDireccionGeo(c.Domicilio, c.Ciudad, c.Provincia) : null;
        const geoDir = claveDir ? geoDireccionCache[claveDir] : null;
        if (geoDir) return { lat: geoDir.lat, lon: geoDir.lon };
        const claveLoc = c.Ciudad ? claveLocalidad(c.Ciudad, c.Provincia) : null;
        const geoLoc = claveLoc ? geoLocalidadCache[claveLoc] : null;
        return geoLoc ? { lat: geoLoc.lat, lon: geoLoc.lon } : null;
      }
      // Distancia aproximada en km (fórmula de Haversine) — alcanza sobra
      // para ordenar una ruta, no hace falta precisión de rutas por calle.
      function distanciaKm(a, b) {
        const R = 6371;
        const dLat = ((b.lat - a.lat) * Math.PI) / 180;
        const dLon = ((b.lon - a.lon) * Math.PI) / 180;
        const s =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
      }
      // Ordena una lista de clientes (con .lat/.lon opcionales) por ruta:
      // vecino más cercano, arrancando por el más al norte-oeste del grupo
      // como punto de partida arbitrario pero estable. Los que no tienen
      // ubicación geocodificada quedan al final, ordenados alfabéticamente,
      // para no inventarles una posición en la ruta.
      function ordenarPorRutaCercana(items) {
        const conUbicacion = items.filter((it) => it._geo);
        const sinUbicacion = items.filter((it) => !it._geo).sort((a, b) => a.Cliente.localeCompare(b.Cliente, "es"));
        if (conUbicacion.length === 0) return sinUbicacion;
        const restantes = [...conUbicacion];
        restantes.sort((a, b) => b._geo.lat - a._geo.lat || a._geo.lon - b._geo.lon);
        const ruta = [restantes.shift()];
        while (restantes.length) {
          const actual = ruta[ruta.length - 1];
          let mejorIdx = 0;
          let mejorDist = Infinity;
          for (let i = 0; i < restantes.length; i++) {
            const d = distanciaKm(actual._geo, restantes[i]._geo);
            if (d < mejorDist) {
              mejorDist = d;
              mejorIdx = i;
            }
          }
          ruta.push(restantes.splice(mejorIdx, 1)[0]);
        }
        return [...ruta, ...sinUbicacion];
      }

      const tituloPorCustomerTypeId = new Map();
      for (const doc of customerTypesSnap.docs) {
        tituloPorCustomerTypeId.set(doc.id, doc.data().title || "");
      }
      const reporteFilaPorContabiliumId = new Map();
      for (const row of reportDetailSnap.exists ? reportDetailSnap.data().rows || [] : []) {
        if (row.contabiliumId != null) reporteFilaPorContabiliumId.set(row.contabiliumId, row);
      }
      const programStart = programSnap.exists && programSnap.data().startedAt ? programSnap.data().startedAt.toDate() : null;
      const ultimoVideoPorDeposito = construirUltimoVideoPorDeposito(stockAuditsSnap);

      const depositoPorContabiliumId = new Map();
      const videoPorContabiliumId = new Map();
      const datosExtraPorContabiliumId = new Map(); // instagram, bicicletería, perfil comercial
      // Clientes que ya tiene asignados a mano un vendedor propio (Alfredo
      // "Cuchi" Bavcevich, Pablo) — se manejan directo con ellos, así que se
      // marcan en la fila (columna "Atendido por") en vez de sacarlos de la
      // lista: el guion tiene que traer TODOS los clientes del mapa, sin
      // excepción, y quien llama decide si igual los suma a la ronda.
      const vendedorPropioPorContabiliumId = new Map();
      for (const doc of usersSnap.docs) {
        const u = doc.data();
        if (u.contabiliumId == null) continue;
        depositoPorContabiliumId.set(u.contabiliumId, u.contabiliumDepositoNombre || (u.contabiliumDepositoId ? "Sí" : null));
        videoPorContabiliumId.set(u.contabiliumId, calcularVideoEstado(u.contabiliumDepositoId, u.auditIntervalDays, ultimoVideoPorDeposito, programStart));
        datosExtraPorContabiliumId.set(u.contabiliumId, {
          instagram: u.instagram || "",
          bicicleteria: u.bicicleteria || "",
          perfilComercial: (u.customerTypeId && tituloPorCustomerTypeId.get(u.customerTypeId)) || "",
        });
        if (/^(alfredo|cuchi|pablo)$/i.test(String(u.vendedor || "").trim())) {
          vendedorPropioPorContabiliumId.set(u.contabiliumId, u.vendedor);
        }
      }
      const situacionPorContabiliumId = new Map();
      for (const doc of situSnap.docs) {
        situacionPorContabiliumId.set(Number(doc.id), doc.data());
      }

      // TODOS los clientes del mapa, sin que falte ninguno — mismo criterio
      // de exclusión que getClientesConUbicacion (el mapa del CRM): solo se
      // sacan los marcados a mano como cuenta de vendedor/fantasma y los que
      // hoy no tienen ningún movimiento (cero stock y cero saldo). Antes acá
      // además se sacaban los sin depósito y los con vendedor propio — eso
      // hacía que el guion trajera MENOS clientes que el mapa; ahora
      // "Depósito" y "Atendido por" quedan como columnas informativas en vez
      // de filtros, para no perder a nadie.
      const filasPorZona = new Map();
      for (const c of clientes) {
        if (CLIENTES_EXCLUIDOS_DEL_CRM.has(c.Id) || CLIENTES_FANTASMA_EXCLUIDOS.has(c.Id) || sinMovimiento.has(c.Id)) continue;
        const depositoNombre = depositoPorContabiliumId.get(c.Id) || "";
        const vendedorPropio = vendedorPropioPorContabiliumId.get(c.Id) || "";
        const nombre = c.RazonSocial || c.NombreFantasia || "(sin nombre)";
        const reporteFila = reporteFilaPorContabiliumId.get(c.Id) || null;
        const situ = situacionPorContabiliumId.get(c.Id);
        const extra = datosExtraPorContabiliumId.get(c.Id) || {};
        const video = videoPorContabiliumId.get(c.Id) || { estado: "no aplica", ultimaFecha: null };
        const zona = zonaDeProvincia(c.Provincia);
        const ctaCte = !reporteFila
          ? "s/dato"
          : reporteFila.saldoDeudor > 0
          ? `Debe $${Math.round(reporteFila.saldoDeudor).toLocaleString("es-AR")}`
          : reporteFila.saldoAFavor > 0
          ? `A favor $${Math.round(reporteFila.saldoAFavor).toLocaleString("es-AR")}`
          : "Al día";
        const fila = {
          Provincia: c.Provincia || "",
          Ciudad: limpiarCiudad(c.Ciudad),
          CP: c.Cp || "",
          Cliente: nombre,
          CUIT: c.NroDoc || "",
          Teléfono: c.Telefono || c.Celular || "",
          Dirección: c.Domicilio || "",
          Bicicletería: extra.bicicleteria || "",
          Instagram: extra.instagram ? `@${extra.instagram}` : "",
          "Perfil comercial": extra.perfilComercial || "(sin perfil)",
          Depósito: depositoNombre || "Sin depósito",
          "Atendido por": vendedorPropio || "",
          Situación: situ?.etiqueta || "(sin marcar)",
          Nota: situ?.nota || "",
          "Marcado por": situ?.updatedByNombre || "",
          "Estado cta. cte.": ctaCte,
          "Último pedido": reporteFila?.fechaUltimaFactura || "(sin facturas)",
          "Video estado": video.estado,
          "Video último": video.ultimaFecha ? video.ultimaFecha.toISOString().slice(0, 10) : "",
          "Llamado hecho (marcar manual)": "",
          "¿Se le ofreció bici?": "",
          "Notas de la llamada": "",
          _geo: ubicacionDeCliente(c),
        };
        const key = zona.nombre;
        if (!filasPorZona.has(key)) filasPorZona.set(key, []);
        filasPorZona.get(key).push(fila);
      }
      // Orden = ruta sugerida (vecino más cercano por geolocalización), no
      // alfabético — así la ronda de llamadas/visitas va de un cliente al
      // siguiente más cercano en vez de saltar por el mapa.
      let totalConUbicacion = 0;
      let totalSinUbicacion = 0;
      for (const [key, rows] of filasPorZona) {
        const ordenado = ordenarPorRutaCercana(rows);
        for (const r of ordenado) {
          if (r._geo) totalConUbicacion++;
          else totalSinUbicacion++;
          delete r._geo;
        }
        filasPorZona.set(key, ordenado);
      }

      const wb = XLSX.utils.book_new();

      // Hoja 1: guion sugerido para la llamada.
      const guion = [
        {
          Etapa: "1. Apertura",
          "Qué decir": "Hola, ¿qué tal? ¿Hablo con el dueño o encargado? Te saluda Ezequiel (o Mariana) — te quería contar que desde ahora quedamos nosotros dos a cargo de la administración de tu cuenta acá en Samurai, así que cualquier gestión de acá en más la vas a manejar directamente con nosotros.",
        },
        {
          Etapa: "2. Control de stock",
          "Qué decir": "Te cuento cómo seguimos con el control de stock consignado: necesitamos que nos sigas mandando el video periódico del depósito, así tenemos siempre al día lo que tenés físicamente y facturamos justo lo que se fue vendiendo — nos evita diferencias a los dos.",
        },
        {
          Etapa: "3. Cuenta corriente",
          "Qué decir": "Aprovecho para repasar cómo está tu cuenta con nosotros (fijate la columna 'Estado cta. cte.' de la hoja de tu zona antes de llamar) y coordinar si falta cargar algún pago o comprobante.",
        },
        {
          Etapa: "4. Intentar sumar una bici",
          "Qué decir": "Y ya que te tengo en línea: ¿cómo veniste con la rotación? Te quiero ofrecer sumar alguna unidad nueva al próximo pedido, hay modelos con muy buena salida esta temporada. ¿Te mando el catálogo actualizado para que elijas?",
        },
        {
          Etapa: "5. Cierre",
          "Qué decir": "Cualquier cosa que necesites de acá en adelante, quedamos nosotros dos — Ezequiel y Mariana — para lo que precises. ¡Gracias por tu tiempo!",
        },
        { Etapa: "", "Qué decir": "" },
        {
          Etapa: "💡 Tip",
          "Qué decir": "No leas el guion textual — usalo de guía. Lo importante en esta primera ronda es que quede clara la nueva administración, dejar pedido el video si está vencido/sin video, y no cerrar la llamada sin intentar la venta de al menos una bici.",
        },
        {
          Etapa: "🗺️ Orden de la lista",
          "Qué decir": "Dentro de cada zona, los clientes ya están ordenados por cercanía real (ruta sugerida: del 1 al siguiente más cercano, y así) — no alfabético. Sirve tanto para la ronda de llamadas como para el chofer si después hay que visitarlos en persona. Los que no tienen dirección geolocalizada quedan al final de la zona, ordenados por nombre.",
        },
      ];
      const wsGuion = XLSX.utils.json_to_sheet(guion, { header: ["Etapa", "Qué decir"] });
      wsGuion["!cols"] = [{ wch: 22 }, { wch: 110 }];
      XLSX.utils.book_append_sheet(wb, wsGuion, "Guion");

      // Hoja por zona: listado numerado de clientes a llamar.
      const usadas = new Set(["Guion"]);
      function nombreDeHojaUnico(nombre) {
        let base = String(nombre || "(sin zona)").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "(sin zona)";
        let final = base;
        let i = 2;
        while (usadas.has(final)) {
          final = `${base.slice(0, 28)} ${i}`;
          i++;
        }
        usadas.add(final);
        return final;
      }
      const zonasOrdenadas = [1, 2, 3, 4, 5, 0].map((n) => NOMBRE_ZONA[n]).filter((z) => filasPorZona.has(z));
      let totalClientes = 0;
      const porZonaJson = [];
      for (const zona of zonasOrdenadas) {
        const rows = filasPorZona.get(zona).map((r, i) => ({ "N°": i + 1, ...r }));
        totalClientes += rows.length;
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, nombreDeHojaUnico(zona));
        porZonaJson.push({ zona, clientes: rows });
      }

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = buf.toString("base64");

      return res.json({
        ok: true,
        base64,
        filename: `Guion de llamadas - nueva administración ${new Date().toISOString().slice(0, 10)}.xlsx`,
        totalClientes,
        totalConUbicacion,
        totalSinUbicacion,
        // Mismos datos en JSON (guion + clientes por zona), para poder armar
        // un PDF único del lado del cliente sin tener que volver a pedirle
        // los datos al backend.
        guion,
        porZona: porZonaJson,
      });
    } catch (err) {
      console.error("[exportarGuionLlamadas] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Prueba/actualiza el precio de UN producto puntual por SKU — nunca se
// escribió un concepto antes en este repo (solo lectura vía getAllConceptos),
// así que este endpoint sirve primero para DESCUBRIR si el REST de
// Contabilium soporta escribir conceptos (dryRun:true solo trae el objeto
// crudo tal cual lo devuelve la API, para ver qué campos tiene de precio/IVA
// antes de tocar nada) y después, ya confirmado, para probar la escritura en
// un solo producto antes de correrlo en masa para todo el catálogo.
exports.adminProbarPrecioProducto = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { sku, precioConIva, dryRun } = req.body || {};
      if (!sku) return res.status(400).json({ error: "Falta sku" });

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const conceptos = await getAllConceptos(email, apiKey);
      const concepto = conceptos.find((c) => String(c.Codigo || "").trim() === String(sku).trim());
      if (!concepto) return res.status(404).json({ error: `No se encontró ningún producto con SKU ${sku} en Contabilium` });

      if (dryRun || precioConIva == null) {
        return res.json({ ok: true, dryRun: true, conceptoCrudo: concepto });
      }

      // La REST vieja (/api/conceptos PUT) rechaza el campo "Tipo" (llega
      // como texto "Producto" en la lectura, pero la escritura espera otra
      // cosa — nunca determinado). En vez de seguir ahí, se usa la API
      // interna real que usa el formulario web nuevo de Contabilium
      // (vir-internalapi.contabilium.com), reversada por captura de red real
      // el 16/10/2026 — ver actualizarPrecioProductoWeb.
      const { actualizarPrecioProductoWeb } = require("./contabiliumWebAutomation");
      const db = admin.firestore();
      const resultado = await actualizarPrecioProductoWeb({
        db,
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        concepto,
        nuevoPrecioConIva: Number(precioConIva),
      });

      // Vuelve a leer el concepto para confirmar si el cambio realmente
      // quedó guardado (no confiar solo en que el PUT devolvió 200).
      const conceptosVerif = await getAllConceptos(email, apiKey);
      const conceptoVerificado = conceptosVerif.find((c) => c.Id === concepto.Id);

      return res.json({
        ok: true,
        dryRun: false,
        conceptoAntes: concepto,
        respuestaPut: resultado,
        conceptoDespues: conceptoVerificado,
        cambioConfirmado: conceptoVerificado?.PrecioFinal === Number(precioConIva),
      });
    } catch (err) {
      console.error("[adminProbarPrecioProducto] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Sincroniza el precio "con IVA" de TODO el catálogo contra Contabilium —
// confirmado con adminProbarPrecioProducto que el campo a escribir es
// `PrecioFinal` y que el PUT funciona. Por defecto (apply:false o ausente)
// solo arma un reporte de diferencias, sin tocar nada. Con apply:true,
// escribe el precio en TODOS los productos donde el precio de Contabilium
// no coincide con el de Samurai (a pedido explícito: la única fuente de
// verdad del precio con IVA es Samurai, así que cualquier diferencia se
// pisa, no solo los que están en 0).
exports.adminSincronizarPreciosCatalogo = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 280,
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { apply } = req.body || {};
      const db = admin.firestore();
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const [conceptos, productsSnap, dollarSnap] = await Promise.all([
        getAllConceptos(email, apiKey),
        db.collection("products").where("active", "==", true).get(),
        db.doc("meta/dollarConfig").get(),
      ]);
      const conceptoPorSku = new Map();
      for (const c of conceptos) {
        const sku = String(c.Codigo || "").trim();
        if (sku) conceptoPorSku.set(sku, c);
      }
      const dollar = dollarSnap.exists ? dollarSnap.data() : {};
      const rate = dollar.mode === "manual" ? Number(dollar.manualValue || 0) : Number(dollar.lastAutoValue || 0);

      const filas = [];
      for (const doc of productsSnap.docs) {
        const p = doc.data();
        const sku = String(p.sku || "").trim();
        if (!sku) continue;
        const concepto = conceptoPorSku.get(sku);
        if (!concepto) continue; // producto de Samurai sin concepto en Contabilium (no debería pasar)

        let target = null;
        let origenTarget = "";
        if (p.priceArs != null && Number(p.priceArs) > 0) {
          target = Math.round(Number(p.priceArs));
          origenTarget = "priceArs cacheado";
        } else if (rate > 0 && Number(p.price) > 0) {
          target = Math.round(Number(p.price) * rate);
          origenTarget = `USD ${p.price} × $${rate}`;
        }
        if (target == null) continue; // sin dato suficiente para saber el precio real

        const actual = Number(concepto.PrecioFinal || 0);
        const diff = actual - target;
        const sinCargar = actual <= 0;
        // Detectado en un caso real (SKU 100001): un producto puede tener el
        // precio final bien cargado pero el % de IVA en 0 en vez de 21 — la
        // factura sale con el total correcto pero sin discriminar IVA, lo
        // cual está mal para una Factura A/B. Se chequea aparte del precio.
        const ivaActual = Number(concepto.Iva ?? 0);
        const ivaOk = ivaActual === 21;
        filas.push({
          sku,
          nombre: p.name || "",
          precioActualContabilium: actual,
          precioObjetivoSamurai: target,
          origenTarget,
          diferencia: diff,
          sinCargar,
          ivaActual,
          ivaOk,
          // A pedido explícito: TODOS los que difieran se corrigen, no solo
          // los que están en 0 — la única fuente de verdad del precio con
          // IVA es Samurai, así que cualquier diferencia se pisa. También se
          // corrige el IVA si no está en 21%.
          seAplicaAutomatico: diff !== 0 || !ivaOk,
        });
      }

      filas.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

      if (!apply) {
        return res.json({
          ok: true,
          dryRun: true,
          totalRevisados: filas.length,
          sinCargar: filas.filter((f) => f.sinCargar).length,
          conDiferenciaManual: filas.filter((f) => !f.sinCargar && f.diferencia !== 0).length,
          conIvaMal: filas.filter((f) => !f.ivaOk).length,
          filas,
        });
      }

      const { actualizarPrecioProductoWeb } = require("./contabiliumWebAutomation");
      const aAplicar = filas.filter((f) => f.seAplicaAutomatico);
      const resultados = [];
      for (const f of aAplicar) {
        try {
          const concepto = conceptoPorSku.get(f.sku);
          // Ver comentario en adminProbarPrecioProducto: la REST vieja
          // rechaza el PUT por el campo "Tipo" — se usa la API interna real
          // del formulario web (vir-internalapi.contabilium.com).
          await actualizarPrecioProductoWeb({
            db,
            email: CONTABILIUM_WEB_EMAIL.value(),
            password: CONTABILIUM_WEB_PASSWORD.value(),
            concepto,
            nuevoPrecioConIva: f.precioObjetivoSamurai,
          });
          resultados.push({ sku: f.sku, ok: true });
        } catch (err) {
          resultados.push({ sku: f.sku, ok: false, error: err.message || String(err) });
        }
        // Esta API nueva no tiene el mismo rate-limit documentado que la
        // REST vieja, pero dejamos igual una pausa corta por las dudas.
        await new Promise((r) => setTimeout(r, 400));
      }

      return res.json({
        ok: true,
        dryRun: false,
        totalAplicados: resultados.filter((r) => r.ok).length,
        totalErrores: resultados.filter((r) => !r.ok).length,
        resultados,
      });
    } catch (err) {
      console.error("[adminSincronizarPreciosCatalogo] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.debugProbeIdCC = onRequest(
  { cors: false, secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { idInventario } = req.body || {};
      const { probarCandidatosIdCC } = require("./contabiliumWebAutomation");
      const resultados = await probarCandidatosIdCC({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        idInventario: Number(idInventario) || 137664,
      });
      return res.json({ resultados });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Ubicaciones (lat/lon) de los vendedores asignados al caller — para el
// mapa de Alfredo. Mismo gate que getMisVendedores. A diferencia de
// getClientesConUbicacion (que trae y geocodifica TODA la cartera, staff
// only), acá se pide el detalle puntual de cada uno de sus 8 clientes por
// id, y se reutilizan las mismas cachés de geocodificación que ya llenó el
// mapa del CRM — no vuelve a pegarle a Google/GeoRef si ya está cacheado.
exports.getUbicacionesMisVendedores = onRequest(
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
      uid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }

    try {
      const db = admin.firestore();
      const callerSnap = await db.doc(`users/${uid}`).get();
      if (!callerSnap.exists) return res.status(404).json({ error: "Usuario no encontrado" });
      const caller = callerSnap.data();
      const asignados = Array.isArray(caller.vendedoresAsignados) ? caller.vendedoresAsignados : [];
      if (asignados.length === 0) {
        return res.status(403).json({ error: "No tenés vendedores asignados" });
      }

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const cacheRef = db.doc("meta/geocodeLocalidades");
      const cacheSnap = await cacheRef.get();
      const cache = cacheSnap.exists ? cacheSnap.data().porClave || {} : {};
      const cacheDirRef = db.doc("meta/geocodeDirecciones");
      const cacheDirSnap = await cacheDirRef.get();
      const cacheDir = cacheDirSnap.exists ? cacheDirSnap.data().porClave || {} : {};
      const claveDe = (ciudad, provincia) => `${String(ciudad || "").trim().toUpperCase()}|${String(provincia || "").trim().toUpperCase()}`;
      const claveDireccion = (direccion, ciudad, provincia) =>
        `${String(direccion || "").trim().toUpperCase()}|${claveDe(ciudad, provincia)}`;

      const items = await mapWithConcurrency(asignados, 5, async (vendedorUid) => {
        const vSnap = await db.doc(`users/${vendedorUid}`).get();
        if (!vSnap.exists) return null;
        const v = vSnap.data();
        if (v.contabiliumId == null) return null;
        const c = await getClientById(email, apiKey, v.contabiliumId);
        if (!c) return null;
        const clave = c.Ciudad ? claveDe(c.Ciudad, c.Provincia) : null;
        const geoLocalidad = clave ? cache[clave] : null;
        const claveDir = c.Domicilio && c.Ciudad ? claveDireccion(c.Domicilio, c.Ciudad, c.Provincia) : null;
        const geoDireccion = claveDir ? cacheDir[claveDir] : null;
        const geo = geoDireccion || geoLocalidad;
        if (!geo) return null;
        return {
          uid: vendedorUid,
          nombre: v.name || v.username || c.RazonSocial || c.NombreFantasia || "",
          contabiliumId: v.contabiliumId,
          ciudad: limpiarCiudad(c.Ciudad),
          provincia: c.Provincia || "",
          direccion: c.Domicilio || "",
          cp: c.Cp || "",
          lat: geo.lat,
          lon: geo.lon,
          ubicacionPrecisa: !!geoDireccion,
        };
      });

      return res.json({ items: items.filter(Boolean) });
    } catch (err) {
      console.error("[getUbicacionesMisVendedores] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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
      // Viene crudo de Contabilium (TipoFc/ImporteTotalNeto, no Tipo/Total) —
      // mismo remapeo que ya se hace en adminGetClientComprobantes, para que
      // el PDF de respaldo (printComprobante) no muestre "undefined"/NaN.
      return res.json({
        ...comprobante,
        Tipo: comprobante.TipoFc || comprobante.Tipo,
        Fecha: comprobante.FechaEmision || comprobante.Fecha,
        Total: parseArNumber(comprobante.ImporteTotalNeto ?? comprobante.Total),
        Saldo: parseArNumber(comprobante.Saldo),
      });
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

// Consulta en vivo los datos del padrón de AFIP para un CUIT — la misma
// consulta que usa Contabilium al crear/editar un Cliente (muestra razón
// social, domicilio, condición IVA, etc. apenas se tipea el CUIT, antes de
// guardar nada). Se usa para la vista previa del form de alta de usuario, así
// el staff ve lo mismo que vería adentro de Contabilium.
exports.consultarDatosAfip = onRequest(
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
      if (!datos || !datos.RazonSocial) {
        return res.status(404).json({ error: "AFIP no devolvió datos para ese CUIT" });
      }
      return res.json({
        razonSocial: datos.RazonSocial || null,
        condicionIva: datos.CategoriaImpositiva || null,
        categoriaMonotributo: datos.CategoriaMonotributo || null,
        domicilio: datos.Domicilio || null,
        pisoDepto: datos.PisoDto || null,
        ciudad: datos.CiudadNombre || null,
        provincia: datos.ProvinciaNombre || null,
        cp: datos.CodigoPostal || null,
        personeria: datos.Personeria || null,
      });
    } catch (err) {
      console.error("[contabilium] consultarDatosAfip error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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
      const vendedorAnterior = u.vendedor || null;

      await userRef.update({ vendedor: vendedor || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

      // Alfredo tiene su propia pantalla "Mover stock" que lista sus
      // clientes desde users/{alfredoUid}.vendedoresAsignados — un array
      // DISTINTO de este campo `vendedor` (que es solo para el panel admin).
      // Antes había que sincronizarlos a mano cada vez (pasó 3 veces hoy:
      // Budabike, Bicicletas Juniors, Ruedas) — ahora queda automático acá.
      const ALFREDO_UID = "KGqXe3UmhqWU3AzNdZA6CobTTS33";
      if (vendedorAnterior === "Alfredo" && vendedor !== "Alfredo") {
        await db.doc(`users/${ALFREDO_UID}`).update({ vendedoresAsignados: admin.firestore.FieldValue.arrayRemove(uid) });
      } else if (vendedor === "Alfredo" && vendedorAnterior !== "Alfredo") {
        await db.doc(`users/${ALFREDO_UID}`).update({ vendedoresAsignados: admin.firestore.FieldValue.arrayUnion(uid) });
      }

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

// Agrega (o saca) un cliente de la lista `vendedoresAsignados` de un
// distribuidor con equipo propio (ej. Alfredo Bavcevich) — esa lista es lo
// único que habilita "Mis clientes"/el resumen de comisión para ver a ese
// cliente. Opcionalmente también fija el depósito de Contabilium del
// cliente en el mismo paso (para el caso típico: cliente nuevo que ya tiene
// depósito armado en Contabilium pero todavía no vinculado acá).
exports.adminAsignarClienteADistribuidor = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { distribuidorUid, clienteUid, quitar, contabiliumDepositoId } = req.body || {};
      if (!distribuidorUid || !clienteUid) return res.status(400).json({ error: "Faltan distribuidorUid y clienteUid" });

      const db = admin.firestore();
      const distribuidorRef = db.doc(`users/${distribuidorUid}`);
      const distribuidorSnap = await distribuidorRef.get();
      if (!distribuidorSnap.exists) return res.status(404).json({ error: "Distribuidor no encontrado" });

      await distribuidorRef.update({
        vendedoresAsignados: quitar
          ? admin.firestore.FieldValue.arrayRemove(clienteUid)
          : admin.firestore.FieldValue.arrayUnion(clienteUid),
      });

      if (!quitar && contabiliumDepositoId) {
        await db.doc(`users/${clienteUid}`).set({ contabiliumDepositoId: Number(contabiliumDepositoId) }, { merge: true });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[adminAsignarClienteADistribuidor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Importa masivamente la "situación" (color/etiqueta/llamado/nota) que el
// staff carga a mano en el Excel que baja del mapa (mismas columnas que
// exportarMapaClientes: Situación/Color/Llamado/Nota/Marcado por), más
// cualquier texto libre suelto (columna extra sin encabezado, o anotado a
// mano al lado del nombre) que se guarda como una entrada nueva en
// seguimiento.historial para no perder ese contexto.
// Cruce por CUIT (normalizado, sin guiones/espacios) — es más confiable que
// el nombre, que en Contabilium puede variar entre RazonSocial/NombreFantasia.
exports.adminImportarSituacionesClientes = onRequest(
  { cors: false, invoker: "public", timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { filas } = req.body || {};
      if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ error: "Falta filas (array)" });

      const db = admin.firestore();
      const staffSnap = await db.doc(`users/${staffUid}`).get();
      const staffNombre = staffSnap.data()?.name || staffSnap.data()?.username || "Importación Excel";

      const onlyDigits = (s) => (s || "").toString().replace(/\D/g, "");

      const usersSnap = await db.collection("users").where("kind", "==", "client").get();
      const porCuit = new Map();
      usersSnap.docs.forEach((d) => {
        const u = d.data();
        const cuitDigits = onlyDigits(u.cuit);
        if (cuitDigits) porCuit.set(cuitDigits, { uid: d.id, contabiliumId: u.contabiliumId, nombre: u.name || "" });
      });

      let actualizados = 0;
      let soloNota = 0;
      let sinCambios = 0;
      const noEncontrados = [];
      const batch = db.batch();
      let opsEnBatch = 0;

      for (const fila of filas) {
        const cuitDigits = onlyDigits(fila.cuit);
        const match = cuitDigits ? porCuit.get(cuitDigits) : null;
        if (!match) {
          noEncontrados.push({ nombre: fila.nombreExcel || "", cuit: fila.cuit || "" });
          continue;
        }

        let huboCambio = false;

        // Situación/color/llamado/nota — mismo documento y forma que usa el
        // mapa (situacionClientes/{contabiliumId}), así el próximo click en
        // el mapa sigue funcionando igual.
        const tieneSituacion =
          fila.color || fila.llamado === true || (fila.nota && fila.nota.trim()) || (fila.marcadoPor && fila.marcadoPor.trim());
        if (match.contabiliumId && tieneSituacion) {
          const ref = db.doc(`situacionClientes/${match.contabiliumId}`);
          batch.set(
            ref,
            {
              ...(fila.color ? { color: fila.color } : {}),
              ...(fila.situacionEtiqueta ? { etiqueta: fila.situacionEtiqueta } : {}),
              ...(fila.nota ? { nota: fila.nota } : {}),
              ...(fila.llamado === true ? { llamado: true } : {}),
              updatedByNombre: fila.marcadoPor || staffNombre,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          opsEnBatch += 1;
          huboCambio = true;
        }

        // El nombre real (de Samurai) suele ser el prefijo del nombre tal
        // cual quedó escrito en el Excel, con anotaciones sueltas pegadas
        // al final (ej. "ANGEL OMAR GODANO ( WAPP ENVIADO)") — se la separa
        // comparando contra el nombre real ya resuelto por CUIT.
        let anotacionNombre = "";
        if (fila.nombreExcel && match.nombre) {
          const normal = (s) => s.toString().trim().toUpperCase().replace(/\s+/g, " ");
          const excelNorm = normal(fila.nombreExcel);
          const realNorm = normal(match.nombre);
          if (excelNorm.startsWith(realNorm)) {
            anotacionNombre = fila.nombreExcel
              .trim()
              .slice(realNorm.length)
              .replace(/^[\s()–\-:,.]+|[\s()]+$/g, "")
              .trim();
          } else if (excelNorm !== realNorm) {
            // No matcheó como prefijo (mayúsculas/orden distinto) — se
            // guarda todo el texto del Excel igual, mejor de más que perder
            // la anotación.
            anotacionNombre = fila.nombreExcel.trim();
          }
        }

        // Todo lo que es texto libre (columna extra del Excel + lo que
        // quedó anotado junto al nombre) se guarda como una entrada de
        // seguimiento nueva, para no perder el detalle de la revisión.
        const textoLibre = [fila.notaExtra, anotacionNombre].filter((t) => t && t.trim()).join(" — ");
        if (textoLibre) {
          const userRef = db.doc(`users/${match.uid}`);
          const entrada = {
            contactado: fila.llamado === true,
            cuentaCoincide: null,
            notas: `Importado desde Excel (${textoLibre.length > 500 ? textoLibre.slice(0, 500) + "…" : textoLibre})`,
            tareaPendiente: "",
            imagenes: [],
            contactadoPor: staffUid,
            vendedorAsignado: null,
            fecha: admin.firestore.Timestamp.now(),
          };
          batch.update(userRef, {
            "seguimiento.historial": admin.firestore.FieldValue.arrayUnion(entrada),
            // Mismos "campos espejo" que actualiza Clientes360 al cargar una
            // nota a mano (Clientes360.jsx ~1281-1301) — las listas/filtros
            // del CRM leen estos campos sueltos, no el array completo.
            "seguimiento.contactado": entrada.contactado,
            "seguimiento.cuentaCoincide": entrada.cuentaCoincide,
            "seguimiento.notas": entrada.notas,
            "seguimiento.tareaPendiente": entrada.tareaPendiente,
            "seguimiento.contactadoPor": entrada.contactadoPor,
            "seguimiento.fecha": entrada.fecha,
          });
          opsEnBatch += 1;
          huboCambio = true;
          if (!tieneSituacion) soloNota += 1;
        }

        if (huboCambio) actualizados += 1;
        else sinCambios += 1;

        // Firestore corta un batch en 500 operaciones — con margen, mandamos
        // de a tandas si el Excel es grande.
        if (opsEnBatch >= 400) {
          await batch.commit();
          opsEnBatch = 0;
        }
      }
      if (opsEnBatch > 0) await batch.commit();

      return res.json({
        total: filas.length,
        actualizados,
        soloNota,
        sinCambios,
        noEncontrados,
      });
    } catch (err) {
      console.error("[adminImportarSituacionesClientes] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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
      const observaciones = cliente?.Observaciones || "";
      // Busca un @handle o un link de instagram.com/... anotado a mano en
      // las Observaciones de Contabilium, para sugerirlo en Samurai sin
      // tener que pedirle a nadie que lo tipee de nuevo.
      const matchLink = observaciones.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
      const matchHandle = observaciones.match(/@([a-zA-Z0-9._]+)/);
      const instagramDetectado = matchLink?.[1] || matchHandle?.[1] || null;
      return res.json({
        telefono: cliente?.Telefono || null,
        celular: cliente?.Celular || null,
        ciudad: limpiarCiudad(cliente?.Ciudad) || null,
        provincia: cliente?.Provincia || null,
        razonSocial: cliente?.RazonSocial || null,
        direccion: cliente?.Domicilio || null,
        cp: cliente?.Cp || null,
        instagramDetectado,
      });
    } catch (err) {
      console.error("[contabilium] adminGetClientPhone error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Carga/edita el teléfono y/o celular de un cliente directo en Contabilium
// — son los dos únicos campos de teléfono que tiene (Telefono y Celular).
// Contabilium no soporta PATCH parcial: hay que traer el registro completo
// y mandarlo de nuevo con los campos pisados.
exports.adminActualizarTelefonosCliente = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { contabiliumId, telefono, celular } = req.body || {};
      if (!contabiliumId) return res.status(400).json({ error: "contabiliumId requerido" });
      if (telefono === undefined && celular === undefined) {
        return res.status(400).json({ error: "Mandá al menos telefono o celular" });
      }
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const cliente = await getClientById(email, apiKey, contabiliumId);
      if (!cliente) return res.status(404).json({ error: "Cliente no encontrado en Contabilium" });
      const patched = {
        ...cliente,
        ...(telefono !== undefined ? { Telefono: telefono } : {}),
        ...(celular !== undefined ? { Celular: celular } : {}),
      };
      await updateCliente(email, apiKey, contabiliumId, patched);
      return res.json({ ok: true, telefono: patched.Telefono || null, celular: patched.Celular || null });
    } catch (err) {
      console.error("[adminActualizarTelefonosCliente] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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
        { tipos: TIPOS_SALDO_CON_COT }
      );
      // Las Cotizaciones (COT) también se muestran — no son factura real
      // (sin CAE), pero durante años se usaron como registro de venta antes
      // de tener facturación electrónica, así que siguen contando como
      // deuda real de cuenta corriente y hay que poder verlas acá, no solo
      // en el cálculo agregado del saldo.
      const items = rawItemsFull.filter((c) => TIPOS_SALDO_CON_COT.includes(c.TipoFc)).map((c) => {
        const saldoAbs = parseArNumber(c.Saldo);
        return {
          ...c,
          Tipo:  c.TipoFc,
          Fecha: c.FechaEmision,
          Total: parseArNumber(c.ImporteTotalNeto),
          Saldo: TIPOS_NC_NEGATIVOS.includes(c.TipoFc) ? -saldoAbs : saldoAbs,
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

// Trae TODAS las Cotizaciones (COT) de la empresa, con el nombre/CUIT real
// del cliente ya resuelto (se cruza contra el listado completo de clientes,
// una sola vez, en vez de un llamado por comprobante) — para la pantalla
// "COTs" del admin.
exports.listCotizaciones = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();

      const [comprobantes, clientes] = await Promise.all([
        getAllComprobantes(email, apiKey, {}),
        getAllClientes(email, apiKey),
      ]);

      const clientePorId = new Map(clientes.map((c) => [c.Id, c]));

      const cots = comprobantes
        .filter((c) => c.TipoFc === "COT")
        .map((c) => {
          const cliente = clientePorId.get(c.IdCliente);
          return {
            id: c.Id,
            numero: c.Numero,
            fecha: c.FechaEmision,
            clienteId: c.IdCliente,
            clienteNombre: cliente?.RazonSocial || cliente?.NombreFantasia || null,
            cuit: cliente?.NroDoc || null,
            total: parseAr(c.ImporteTotalNeto),
            saldo: parseAr(c.Saldo),
          };
        })
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

      return res.json({ total: cots.length, items: cots });
    } catch (err) {
      console.error("[contabilium] listCotizaciones error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Para completar a mano un día de la bitácora "Reporte semanal" que quedó
// vacío (ej. un día que no se cargó en su momento) — trae, directo de
// Contabilium/Firestore, lo mismo que ya se carga para los otros días:
// comprobantes emitidos (facturación) y cobranzas reales (cobrado), ambos
// con número, cliente y monto. Solo lectura, no inventa nada.
exports.adminComprobantesYCobranzasPorFecha = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { fecha } = req.body || {};
      if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const todos = await getAllComprobantes(email, apiKey, { desde: fecha, hasta: fecha });
      const comprobantes = todos
        .filter((c) => ["FCA", "FCB", "FCC", "COT", "NCA", "NCB", "NCC", "NCT"].includes(c.TipoFc))
        .filter((c) => (c.FechaEmision || "").slice(0, 10) === fecha)
        .map((c) => ({
          numero: c.Numero,
          tipo: c.TipoFc,
          cliente: c.RazonSocial || "(sin nombre)",
          monto: parseArNumber(c.ImporteTotalNeto) * (TIPOS_NC_NEGATIVOS.includes(c.TipoFc) ? -1 : 1),
        }));

      const db = admin.firestore();
      const cobranzasSnap = await db.collection("cobranzas").get();
      const cobranzas = cobranzasSnap.docs
        .map((d) => d.data())
        .filter((c) => (c.fecha || "").slice(0, 10) === fecha)
        .map((c) => ({
          numero: c.numero || "(sin número)",
          cliente: c.razonSocial || "(sin nombre)",
          monto: Number(c.importeReal ?? c.importeTotal ?? 0),
        }));

      return res.json({ fecha, comprobantes, cobranzas });
    } catch (err) {
      console.error("[adminComprobantesYCobranzasPorFecha] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Investigación puntual (SOLO LECTURA): reconstruye el precio de lista
// aproximado de cada SKU en una ventana de fechas pasada, a partir de lo
// que realmente se facturó/cotizó ahí — no tenemos historial de precios
// guardado en ningún lado, así que el precio real de venta de la época es
// la mejor referencia disponible (pedido 21/10/2026, valorización de stock
// al 31/12/2025).
exports.diagPreciosHistoricos = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const desde = req.body?.desde || "2025-10-01";
      const hasta = req.body?.hasta || "2025-12-31";
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const comprobantes = await getAllComprobantes(email, apiKey, { desde, hasta });
      const relevantes = comprobantes.filter((c) => ["FCA", "FCB", "FCC", "COT"].includes(c.TipoFc));

      const precioPorSku = {};
      for (const c of relevantes) {
        try {
          const full = await getComprobanteById(email, apiKey, c.Id);
          for (const it of full?.Items || []) {
            const sku = (it.Codigo || "").trim();
            if (!sku) continue;
            const precioUnitario = Number(it.PrecioUnitario) || 0;
            if (precioUnitario <= 0) continue;
            if (!precioPorSku[sku]) precioPorSku[sku] = [];
            precioPorSku[sku].push({ fecha: c.FechaEmision, numero: c.Numero, precioUnitario });
          }
        } catch (err) {
          console.error("[diagPreciosHistoricos] detalle falló", c.Id, err.message);
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      return res.json({ totalComprobantes: relevantes.length, precioPorSku });
    } catch (err) {
      console.error("[diagPreciosHistoricos] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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

// Diagnóstico (SOLO LECTURA): para cada Nota de Crédito real (NCA/NCB/NCC —
// contra una factura, no contra un COT) emitida en la empresa, trae su
// detalle completo (ítems, depósito usado, comprobante original asociado)
// para poder cruzarlo después contra los movimientos de stock reales
// (obtenerMovimientosStock) y confirmar si las bicicletas efectivamente
// volvieron al depósito al anular la factura — pedido 28/10/2026, chequeo
// general de todos los clientes. Primera pasada: trae el detalle crudo
// (`raw`) solo de las primeras `muestra` para poder ver qué campos usa
// Contabilium de verdad (ej. cómo se llama el campo del comprobante
// asociado) antes de armar el cruce automático.
exports.diagNotasCreditoStock = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 540, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const desde = req.query.desde ? String(req.query.desde) : undefined;
      const hasta = req.query.hasta ? String(req.query.hasta) : undefined;
      const muestra = req.query.muestra ? Number(req.query.muestra) : 5;
      const limit = req.query.limit ? Number(req.query.limit) : 500;

      const all = await getAllComprobantes(email, apiKey, { desde, hasta });
      const notasCredito = all.filter((c) => ["NCA", "NCB", "NCC"].includes(c.TipoFc)).slice(0, limit);

      let i = 0;
      const detalles = await mapWithConcurrency(notasCredito, 5, async (nc) => {
        const idx = i++;
        try {
          const full = await getComprobanteById(email, apiKey, nc.Id);
          const base = {
            id: nc.Id,
            numero: nc.Numero,
            tipo: nc.TipoFc,
            fecha: nc.FechaEmision,
            cliente: nc.RazonSocial,
            idCliente: nc.IdCliente,
            inventario: full?.Inventario ?? null,
            idComprobanteAsociado:
              full?.IdComprobanteAsociado ?? full?.ComprobanteAsociado ?? full?.IdComprobanteOrigen ?? null,
            items: (full?.Items || []).map((it) => ({
              sku: it.Codigo,
              descripcion: it.Concepto || it.Descripcion,
              cantidad: it.Cantidad,
            })),
          };
          if (idx < muestra) base.raw = full;
          return base;
        } catch (err) {
          return { id: nc.Id, numero: nc.Numero, error: String(err) };
        }
      });

      return res.json({ totalNotasCredito: notasCredito.length, totalEnPeriodo: all.filter((c) => ["NCA", "NCB", "NCC"].includes(c.TipoFc)).length, detalles });
    } catch (err) {
      console.error("[diagNotasCreditoStock] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Diagnóstico (SOLO LECTURA): trae el historial REAL de movimientos de
// stock de un depósito puntual (pantalla clásica historicoStock.aspx, vía
// obtenerHistoricoStockReal) en un rango de fechas — para cruzarlo a mano
// contra las Notas de Crédito de ese depósito (diagNotasCreditoStock) y
// confirmar si la mercadería realmente volvió al stock al anular una
// factura. Recibe el id numérico del depósito (como viene en el campo
// "Inventario" de un comprobante) y lo resuelve a su nombre real usando
// internalData/contabiliumDepositos (mismo mapeo que ya usa el resto del
// sistema) antes de navegar la pantalla clásica.
exports.diagHistoricoStockDeposito = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 540, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const depositoId = Number(req.query.depositoId);
      const fechaDesde = req.query.fechaDesde ? String(req.query.fechaDesde) : undefined;
      const fechaHasta = req.query.fechaHasta ? String(req.query.fechaHasta) : undefined;
      if (!depositoId) return res.status(400).json({ error: "Falta ?depositoId= (el id numérico, ej. el campo Inventario de un comprobante)" });
      if (!fechaDesde || !fechaHasta) return res.status(400).json({ error: "Faltan ?fechaDesde= y ?fechaHasta= (DD/MM/YYYY)" });

      const db = admin.firestore();
      const depositosSnap = await db.doc("internalData/contabiliumDepositos").get();
      const depositos = depositosSnap.exists ? depositosSnap.data().depositos || [] : [];
      const depo = depositos.find((d) => d.id === depositoId);
      if (!depo) return res.status(404).json({ error: `No se encontró el depósito id=${depositoId} en internalData/contabiliumDepositos` });

      const { obtenerHistoricoStockReal } = require("./contabiliumWebAutomation");
      const resultado = await obtenerHistoricoStockReal({
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        depositoNombre: depo.nombre,
        fechaDesde,
        fechaHasta,
        leerTodo: true,
      });

      return res.json({ depositoId, depositoNombre: depo.nombre, ...resultado });
    } catch (err) {
      console.error("[diagHistoricoStockDeposito] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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
        tipos: TIPOS_SALDO_CON_COT,
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
            tipos: TIPOS_SALDO_CON_COT,
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
// Cuentas de Contabilium que NO son clientes comerciales reales — personas
// del equipo (vendedores/staff) que tienen una cuenta de cliente cargada en
// Contabilium por otro motivo (compra personal, cuenta previa a sumarse al
// equipo, etc.). Se excluyen del mapa/CRM comercial y del Excel exportado,
// aunque sigan existiendo como comprobante/cliente en Contabilium para todo
// lo demás (facturación, etc.) — este filtro es solo para las vistas
// "cartera de clientes". Confirmado a mano contra un reclamo real (sept
// 2026): Mauro Prandi y Gerardo Martínez tienen cuenta de cliente en
// Contabilium siendo del equipo.
const CLIENTES_EXCLUIDOS_DEL_CRM = new Set([
  102561235, // PRANDI MAURO — vendedor
  115207269, // GERARDO ENRIQUE MARTINEZ — vendedor
]);

// Clientes marcados a mano por el equipo comercial como "fantasma": tienen
// cuenta/depósito cargado en Contabilium pero sin movimiento real (alta de
// prueba, stock cargado directo sin transferencia, etc.) — reportado por
// WhatsApp. Se excluyen igual que los de arriba, aunque el motivo sea otro.
const CLIENTES_FANTASMA_EXCLUIDOS = new Set([
  125076379, // YOELMYS CUEVAS TRIMIÑO — stock cargado sin movimiento real (sept 2026)
]);

// Además de la lista a mano, se aplica una regla automática y en vivo: un
// cliente solo aparece en el mapa/CRM si hoy tiene algo pendiente — stock
// consignado actual, deuda o saldo a favor. Si está en cero stock y cero
// saldo (deuda Y a favor) no se borra (sigue existiendo en Contabilium y en
// Firestore), solo se oculta de estas vistas de cartera — apenas vuelva a
// tener stock o movimiento de cuenta corriente, la próxima sincronización de
// meta/clientesReportDetail lo hace reaparecer solo, sin que haga falta
// tocar nada a mano. Ojo: a diferencia de una versión anterior de esta
// regla, NO mira el historial de facturación — un cliente real que ya
// vendió todo y está al día (ej. Edgardo Petean, sept 2026) queda oculto
// igual mientras esté en cero, que es justamente lo que se pidió.
async function getContabiliumIdsSinMovimiento(db) {
  const snap = await db.doc("meta/clientesReportDetail").get();
  const rows = snap.exists ? snap.data().rows || [] : [];
  const sinMovimiento = new Set();
  for (const r of rows) {
    if (!r.contabiliumId) continue;
    const sinStock = !r.stockConsignado || r.stockConsignado <= 0;
    const sinDeuda = !r.saldoDeudor || r.saldoDeudor <= 0;
    const sinAFavor = !r.saldoAFavor || r.saldoAFavor <= 0;
    if (sinStock && sinDeuda && sinAFavor) sinMovimiento.add(r.contabiliumId);
  }
  return sinMovimiento;
}

exports.listContabiliumClientes = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const clientes = await getAllClientes(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      const items = clientes
        .filter((c) => !CLIENTES_EXCLUIDOS_DEL_CRM.has(c.Id))
        .map((c) => ({
          id: `cb-${c.Id}`,
          contabiliumId: c.Id,
          nombre: c.RazonSocial || c.NombreFantasia || "(sin nombre)",
          cuit: c.NroDoc || "",
          telefono: c.Telefono || "",
          telefono2: "",
          provincia: c.Provincia || "",
          ciudad: limpiarCiudad(c.Ciudad),
          rubro: "",
        }));
      return res.json({ items });
    } catch (err) {
      console.error("[contabilium] listContabiliumClientes error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Geocodifica una dirección puntual (calle + altura) en tres pasos:
//  1) GeoRef (apis.datos.gob.ar, oficial INDEC) — mejor precisión cuando la
//     tiene, pero su nomenclador de calles no cubre todas las localidades
//     chicas.
//  2) Si GeoRef no encontró nada, Nominatim (OpenStreetMap) — cubre mucha
//     más calle "de pueblo" (incluye calles numeradas tipo "Calle 17"), a
//     costa de no siempre acertar el número de puerta exacto, pero sí la
//     calle real en vez del centro de la ciudad.
//  3) Si tampoco Nominatim la encontró, Google Geocoding API (paga, pero se
//     cachea por dirección en Firestore así que en la práctica se llama una
//     sola vez por cliente) — cubre lo que ninguno de los dos gratuitos
//     tiene cargado.
// Nominatim exige 1 request/segundo y un User-Agent identificable — por
// eso el caso 2 se llama con throttling aparte del de GeoRef.
async function geocodeDireccionPuntual(direccion, ciudad, provincia, googleApiKey) {
  const direccionLimpia = String(direccion || "").trim();
  if (!direccionLimpia) return null;

  try {
    const params = new URLSearchParams({
      direccion: direccionLimpia,
      provincia: provincia || "",
      localidad: ciudad || "",
      max: "1",
    });
    const r = await fetch(`https://apis.datos.gob.ar/georef/api/direcciones?${params.toString()}`);
    const body = await r.json();
    const d = body?.direcciones?.[0];
    if (d?.ubicacion?.lat != null) {
      return { lat: d.ubicacion.lat, lon: d.ubicacion.lon, fuente: "georef" };
    }
  } catch {
    // sigue al fallback de Nominatim
  }

  try {
    const q = [direccionLimpia, ciudad, provincia, "Argentina"].filter(Boolean).join(", ");
    const params = new URLSearchParams({ q, format: "json", limit: "1", countrycodes: "ar" });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { "User-Agent": "SamuraiBikesAdmin/1.0 (soporte@samurai.ar)" },
    });
    const body = await r.json();
    if (body?.[0]) {
      return { lat: Number(body[0].lat), lon: Number(body[0].lon), fuente: "nominatim" };
    }
  } catch {
    // sigue al fallback de Google
  }

  if (googleApiKey) {
    try {
      const q = [direccionLimpia, ciudad, provincia, "Argentina"].filter(Boolean).join(", ");
      const params = new URLSearchParams({ address: q, region: "ar", key: googleApiKey });
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
      const body = await r.json();
      const loc = body?.results?.[0]?.geometry?.location;
      if (body?.status === "OK" && loc) {
        return { lat: loc.lat, lon: loc.lng, fuente: "google" };
      }
    } catch {
      // sin geocodificación posible para esta dirección
    }
  }

  return null;
}

// Misma cartera de listContabiliumClientes, pero con lat/lon por dirección
// puntual (calle + altura) — para el mapa de clientes del CRM. Cachea cada
// dirección resuelta en Firestore (por texto exacto de domicilio+ciudad+
// provincia) para no volver a geocodificarla en corridas siguientes. Si una
// dirección puntual no se puede resolver, cae al centroide de la localidad
// (GeoRef por CIUDAD|PROVINCIA, cacheado aparte) en vez de dejar al cliente
// totalmente sin ubicar.
exports.getClientesConUbicacion = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, GOOGLE_MAPS_SERVER_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const clientes = await getAllClientes(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      const db = admin.firestore();
      const sinMovimiento = await getContabiliumIdsSinMovimiento(db);
      const cacheRef = db.doc("meta/geocodeLocalidades");
      const cacheSnap = await cacheRef.get();
      const cache = cacheSnap.exists ? cacheSnap.data().porClave || {} : {};

      const claveDe = (ciudad, provincia) => `${String(ciudad || "").trim().toUpperCase()}|${String(provincia || "").trim().toUpperCase()}`;

      const faltantes = new Map(); // clave -> { ciudad, provincia }
      for (const c of clientes) {
        if (!c.Ciudad) continue;
        const clave = claveDe(c.Ciudad, c.Provincia);
        if (!(clave in cache)) faltantes.set(clave, { ciudad: c.Ciudad, provincia: c.Provincia });
      }

      for (const [clave, { ciudad, provincia }] of faltantes) {
        try {
          const params = new URLSearchParams({
            nombre: ciudad,
            provincia: provincia || "",
            campos: "nombre,provincia.nombre,centroide.lat,centroide.lon",
            max: "1",
          });
          const r = await fetch(`https://apis.datos.gob.ar/georef/api/localidades?${params.toString()}`);
          const body = await r.json();
          const loc = body?.localidades?.[0];
          cache[clave] = loc ? { lat: loc.centroide.lat, lon: loc.centroide.lon } : null;
        } catch {
          cache[clave] = null;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      if (faltantes.size > 0) {
        await cacheRef.set({ porClave: cache, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }

      // Segundo nivel de caché: por dirección puntual (calle+altura+ciudad+
      // provincia), mucho más preciso que el centroide de la localidad.
      const cacheDirRef = db.doc("meta/geocodeDirecciones");
      const cacheDirSnap = await cacheDirRef.get();
      const cacheDir = cacheDirSnap.exists ? cacheDirSnap.data().porClave || {} : {};

      const claveDireccion = (direccion, ciudad, provincia) =>
        `${String(direccion || "").trim().toUpperCase()}|${claveDe(ciudad, provincia)}`;

      const direccionesFaltantes = new Map(); // clave -> { direccion, ciudad, provincia }
      for (const c of clientes) {
        if (!c.Domicilio || !c.Ciudad) continue;
        const clave = claveDireccion(c.Domicilio, c.Ciudad, c.Provincia);
        if (!(clave in cacheDir)) {
          direccionesFaltantes.set(clave, { direccion: c.Domicilio, ciudad: c.Ciudad, provincia: c.Provincia });
        }
      }

      const googleApiKey = GOOGLE_MAPS_SERVER_KEY.value();
      let cambiosDir = false;
      for (const [clave, { direccion, ciudad, provincia }] of direccionesFaltantes) {
        const geo = await geocodeDireccionPuntual(direccion, ciudad, provincia, googleApiKey);
        cacheDir[clave] = geo;
        cambiosDir = true;
        // Nominatim exige como máximo 1 req/seg — como GeoRef (intento 1) no
        // siempre llega a pedirle nada a Nominatim, este delay solo pesa
        // cuando realmente hizo falta el fallback.
        await new Promise((resolve) => setTimeout(resolve, geo?.fuente === "nominatim" ? 1100 : 120));
      }
      if (cambiosDir) {
        await cacheDirRef.set({ porClave: cacheDir, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }

      const items = clientes
        .filter((c) => !CLIENTES_EXCLUIDOS_DEL_CRM.has(c.Id) && !CLIENTES_FANTASMA_EXCLUIDOS.has(c.Id) && !sinMovimiento.has(c.Id))
        .map((c) => {
        const clave = c.Ciudad ? claveDe(c.Ciudad, c.Provincia) : null;
        const geoLocalidad = clave ? cache[clave] : null;
        const claveDir = c.Domicilio && c.Ciudad ? claveDireccion(c.Domicilio, c.Ciudad, c.Provincia) : null;
        const geoDireccion = claveDir ? cacheDir[claveDir] : null;
        // Preferí siempre la dirección puntual; si no se pudo geocodificar,
        // cae al centro de la localidad para no dejar al cliente sin pin.
        const geo = geoDireccion || geoLocalidad;
        return {
          id: `cb-${c.Id}`,
          contabiliumId: c.Id,
          nombre: c.RazonSocial || c.NombreFantasia || "(sin nombre)",
          cuit: c.NroDoc || "",
          ciudad: limpiarCiudad(c.Ciudad),
          provincia: c.Provincia || "",
          direccion: c.Domicilio || "",
          cp: c.Cp || "",
          lat: geo?.lat ?? null,
          lon: geo?.lon ?? null,
          ubicacionPrecisa: !!geoDireccion,
        };
      });
      return res.json({ items });
    } catch (err) {
      console.error("[contabilium] getClientesConUbicacion error:", err);
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

// Diagnóstico temporal: descubre el endpoint real de "Movimientos entre
// depósitos" de Contabilium (no está documentado en lo que ya usamos) para
// poder automatizar traslados de stock desde Samurai.
exports.diagProbeMovimientosDeposito = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await probeMovimientosDepositoEndpoints(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value());
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.diagProbeCheques = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const nroCheque = String(req.query.nroCheque || "12197117");
      const result = await probeChequesEndpoints(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), nroCheque);
      return res.json(result);
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
          { tipos: ["FCA", "FCB", "FCC", "NCA", "NCB", "NCC", "NCT", "NDA", "NDB", "NDC", "COT"] }
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
      const staffRoles = ["admin", "chofer"];
      if (!callerSnap.exists || !staffRoles.includes(callerSnap.data().role)) {
        return res.status(403).json({ error: "Acceso denegado" });
      }

      const { depositoId } = req.body || {};
      if (!depositoId) return res.status(400).json({ error: "depositoId requerido" });

      const email  = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const stockItems = await getStockByDepositoWithRetry(email, apiKey, depositoId);
      const pendingSoldBySku = await getPendingSoldBySku(db, { depositoId });
      // includeZeroStock: true para que el admin pueda buscar y ajustar
      // (agregar) stock de un producto que hoy tiene 0 unidades en este
      // depósito — si no, ni aparecería en la lista.
      const items = await buildDepositoStockItems(db, email, apiKey, stockItems, { pendingSoldBySku, includeZeroStock: true });

      return res.json({ depositoId, items });
    } catch (err) {
      console.error("[contabilium] getDepositoStockAdmin error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Rodados Argentinos (depósito único en Contabilium) separado en los 2
// sectores reales "Adrogué"/"Temperley" según la observación de cada
// movimiento histórico — ver `buildStockRodadosPorSector`.
exports.getStockRodadosPorSector = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 300 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const db = admin.firestore();
      const resultado = await buildStockRodadosPorSector(
        db,
        CONTABILIUM_EMAIL.value(),
        CONTABILIUM_API_KEY.value(),
        CONTABILIUM_WEB_EMAIL.value(),
        CONTABILIUM_WEB_PASSWORD.value()
      );
      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error("[getStockRodadosPorSector] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Ventas reportadas por distribuidores (no toca Contabilium):
// el distribuidor marca "vendí esto", queda pendiente hasta que
// Samurai lo factura manualmente en Contabilium y lo marca resuelto.
// ─────────────────────────────────────────────────────────────
exports.reportSale = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 90,
    // Para FCA/FCB/FCC pasa por emitirComprobanteConIva → crearComprobanteWeb
    // (Puppeteer) — con el default de 256MiB se queda sin memoria a mitad de
    // sesión (visto en logs: "Memory limit of 256 MiB exceeded with ~290MiB
    // used"), igual que crearDepositoManual/transferirStockManual.
    memory: "1GiB",
  },
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

      // Antes bloqueaba por TIEMPO (30 min sin importar nada) — eso
      // rechazaba ventas genuinas de una segunda unidad del mismo modelo
      // vendida poco después de la primera, mientras esa primera seguía
      // "pendiente" sin facturar todavía (caso real: Pedal House, 21/10/2026).
      // Ahora valida contra el stock real, con el mismo cálculo que ya usa
      // la propia pantalla del distribuidor para mostrar "Disponibles"
      // (stock real de Contabilium menos lo ya reportado y todavía
      // pendiente de facturar) — si ahí mostraba 1 disponible es porque
      // físicamente queda 1 para reportar, y no hay motivo para bloquearlo.
      const skuLimpio = String(sku).trim();
      let disponibleReal = null;
      try {
        const pendingSoldBySku = await getPendingSoldBySku(db, { distributorUid: uid });
        const stockRaw = await getStockByDepositoWithRetry(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), user.contabiliumDepositoId);
        const items = await buildDepositoStockItems(db, CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), stockRaw, { includeZeroStock: true, pendingSoldBySku });
        const item = items.find((it) => it.sku === skuLimpio);
        disponibleReal = item ? item.stockDisponible : 0;
      } catch (err) {
        console.error("[reportSale] no se pudo verificar el stock real, se deja pasar sin bloquear:", err.message);
      }
      if (disponibleReal != null && disponibleReal < qty) {
        return res.status(409).json({
          error: `No queda stock suficiente para reportar esta venta (disponible: ${disponibleReal}). Si es un error, avisale a Samurai directamente para que lo corrijan.`,
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
      // a que alguien de Samurai lo revise. Reintenta hasta 3 veces con una
      // pausa corta — la mayoría de los fallos son un timeout/lentitud
      // puntual de Contabilium que se resuelve solo. Si algo sigue fallando
      // después de reintentar (cliente sin vincular, error real de la API,
      // etc.) el saleRequest queda "pendiente" como antes, para resolverlo a
      // mano desde Ventas Reportadas — nunca bloquea el reporte del
      // distribuidor — pero ahora además se avisa fuerte a los admins en vez
      // de quedar solo en un log que nadie mira (bug real detectado
      // 28/9/2026: quedaban pendientes en silencio y alguien las marcaba
      // "facturado" a mano después sin que el stock real se tocara nunca).
      let tipoDocumentoEmitido = null;
      let errorFacturacionAuto = null;
      if (user.contabiliumId) {
        const INTENTOS = 3;
        for (let intento = 1; intento <= INTENTOS; intento++) {
          try {
            const comprobante = await emitirComprobanteConIva({
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
            errorFacturacionAuto = null;
            break;
          } catch (err) {
            errorFacturacionAuto = err.message || String(err);
            console.error(`[saleRequests] auto-facturación falló (intento ${intento}/${INTENTOS}):`, err);
            if (intento < INTENTOS) await new Promise((r) => setTimeout(r, 1500 * intento));
          }
        }
        if (errorFacturacionAuto) {
          enviarPushAAdmins({
            title: "🚨 No se pudo facturar sola una venta",
            body: `${user.name || user.email || "Un distribuidor"} reportó ${name || `SKU ${sku}`} y la facturación automática falló ${INTENTOS} veces. Revisar y facturar a mano.`,
            link: "/admin/ventas-reportadas?tab=pendiente",
          });
          await db.collection("notifications").add({
            type: "auto_invoice_failed",
            distributorUid: uid,
            distributorName: user.name || user.email || "",
            saleRequestId: ref.id,
            sku: String(sku).trim(),
            name: name || "",
            error: errorFacturacionAuto,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
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

      enviarPushAAdmins({
        title: "🚲 Nueva venta reportada",
        body: `${user.name || user.email || "Un distribuidor"} reportó ${name || `SKU ${sku}`}`,
        link: "/admin/ventas-reportadas",
      });
      enviarPushAUsuario(uid, {
        title: tipoDocumentoEmitido ? "✅ Tu venta fue facturada" : "📦 Venta reportada",
        body: tipoDocumentoEmitido
          ? `Se facturó automáticamente: ${name || `SKU ${sku}`}`
          : `Registramos tu venta de ${name || `SKU ${sku}`}, la estamos procesando.`,
        link: "/mi-stock",
      });

      return res.json({ ok: true, id: ref.id, tipoDocumentoEmitido });
    } catch (err) {
      console.error("[saleRequests] reportSale error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Ventas ya facturadas (con factura real de Contabilium, `facturaContabilium.Id`)
// que todavía no tienen ninguna cobranza cargada contra esa factura — el
// caso típico es un distribuidor que reportó la venta, se facturó sola
// (reportSale la intenta al toque), pero el cliente todavía no pagó. Cruza
// contra la colección `cobranzas` (sincronizada a diario desde Contabilium,
// cada cobranza trae `detalle: [{IDComprobante, Importe}]`) — si el Id de
// la factura no aparece en ningún `detalle`, está sin cobrar.
exports.listVentasFacturadasSinCobrar = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const db = admin.firestore();

      const cobranzasSnap = await db.collection("cobranzas").get();
      const idsCobrados = new Set();
      cobranzasSnap.forEach((d) => {
        const detalle = d.data().detalle;
        if (Array.isArray(detalle)) detalle.forEach((it) => it && it.IDComprobante != null && idsCobrados.add(it.IDComprobante));
      });

      const facturadasSnap = await db.collection("saleRequests").where("status", "==", "facturado").get();
      const sinCobrar = [];
      facturadasSnap.forEach((d) => {
        const s = d.data();
        const idFactura = s.facturaContabilium?.Id ?? s.facturaContabilium?.ID;
        if (idFactura == null) return; // sin factura real vinculada, no aplica acá
        if (idsCobrados.has(idFactura)) return; // ya tiene cobranza cargada
        sinCobrar.push({
          id: d.id,
          distributorUid: s.distributorUid,
          distributorName: s.distributorName || "",
          sku: s.sku,
          name: s.name || "",
          quantity: s.quantity || 1,
          unitPrice: s.unitPrice || 0,
          facturaNumero: s.facturaContabilium?.Numero || null,
          resolvedAt: s.resolvedAt?.toDate?.().toISOString() || null,
        });
      });

      // Más reciente primero, igual que el resto de las pestañas (antes era
      // al revés y la más nueva quedaba escondida al final de la lista).
      sinCobrar.sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || ""));
      return res.json({ items: sinCobrar });
    } catch (err) {
      console.error("[saleRequests] listVentasFacturadasSinCobrar error:", err);
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

// Marca una solicitud de venta como facturada (staff-only) — para cuando la
// factura real ya se cargó en Contabilium por fuera del flujo automático de
// reportSale (que intenta facturar sola al toque y normalmente ya descuenta
// el stock). Antes esto solo cambiaba el estado y el stock real quedaba sin
// tocar en silencio (bug detectado 28/9/2026, afectó 23 ventas de 8
// clientes) — ahora, al marcarla, también dispara el mismo ajuste de stock
// real que usa "Ajustar stock" en Stock consignado, restando la cantidad
// reportada. Si falta el idCC del depósito (primera vez que se ajusta ese
// depósito) no bloquea: guarda igual el estado, pero devuelve needsIdCC para
// que el staff lo resuelva desde Stock consignado y quede prolijo.
exports.resolveSaleRequest = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { id, facturaNumero } = req.body || {};
      if (!id) return res.status(400).json({ error: "id requerido" });
      if (!facturaNumero) {
        return res.status(400).json({ error: "facturaNumero requerido — hace falta el número real de la factura en Contabilium para poder verificarla." });
      }

      const db = admin.firestore();
      const reqRef = db.doc(`saleRequests/${id}`);
      const reqSnap = await reqRef.get();
      if (!reqSnap.exists) return res.status(404).json({ error: "No existe esa venta reportada" });
      const saleData = reqSnap.data();

      // Verifica que la factura tipeada exista de verdad en Contabilium para
      // ESE cliente, en vez de aceptar cualquier texto — evita que alguien
      // marque una venta como facturada sin que haya factura real detrás
      // (parte del arreglo del bug del 28/9/2026: antes esto no se
      // chequeaba nada). Si el monto no coincide exacto no bloquea (puede
      // haber descuentos/impuestos), pero sí avisa.
      const distUserSnap = saleData.distributorUid ? await db.doc(`users/${saleData.distributorUid}`).get() : null;
      const distUser = distUserSnap?.exists ? distUserSnap.data() : null;
      if (!distUser?.contabiliumId) {
        return res.status(400).json({ error: "El distribuidor de esta venta no tiene contabiliumId vinculado — no se puede verificar la factura." });
      }
      let facturaReal;
      try {
        const comprobantes = await getComprobantesByClientId(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), distUser.contabiliumId, {});
        facturaReal = comprobantes.find((c) => (c.Numero || "").trim() === String(facturaNumero).trim());
      } catch (verifyErr) {
        return res.status(500).json({ error: `No se pudo verificar la factura contra Contabilium: ${verifyErr.message || verifyErr}` });
      }
      if (!facturaReal) {
        return res.status(404).json({ error: `No se encontró la factura "${facturaNumero}" en Contabilium para ${distUser.name || "este cliente"} — revisá el número.` });
      }
      const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));
      const montoEsperado = Number(saleData.unitPrice || 0) * Number(saleData.quantity || 1);
      const montoReal = parseAr(facturaReal.ImporteTotalNeto);
      const montoCoincide = Math.abs(montoReal - montoEsperado) < 1;

      // Si la factura se cargó con el depósito bien vinculado, Contabilium
      // ya descontó el stock real solo al emitirla — ajustarlo de nuevo acá
      // lo descontaría DOS VECES (bug reportado 19/10/2026). Pero si se
      // cargó SIN vincular el depósito, Contabilium nunca se entera de
      // descontarlo (bug real distinto, detectado 28/9/2026) y hace falta
      // este ajuste manual como red de contención. Como el sistema no tiene
      // forma de saber cuál de los dos pasó, lo decide quien cargó la
      // factura: `stockYaDescontado` (true = no tocar nada más, false/no
      // mandado = ajustar acá, como antes).
      const stockYaDescontado = req.body?.stockYaDescontado === true;
      let stockAjustadoManualmente = stockYaDescontado;
      let stockAjusteError = null;
      if (!stockYaDescontado && saleData.depositoId && saleData.sku) {
        try {
          await ajustarStockInterno({
            depositoId: saleData.depositoId,
            sku: saleData.sku,
            cantidad: Number(saleData.quantity || 1),
            tipoModificacion: "M",
            nroRef: facturaNumero || undefined,
            observaciones: `Venta reportada marcada facturada a mano${facturaNumero ? ` (factura ${facturaNumero})` : ""} — ${saleData.name || saleData.sku}`,
          });
          stockAjustadoManualmente = true;
        } catch (stockErr) {
          stockAjusteError = stockErr.needsIdCC
            ? stockErr.message
            : `No se pudo descontar el stock real automáticamente: ${stockErr.message || stockErr}`;
          console.error("[resolveSaleRequest] ajuste de stock falló:", stockErr);
        }
      }

      await reqRef.update({
        status: "facturado",
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: staffUid,
        stockAjustadoManualmente,
        facturaContabilium: {
          Id: facturaReal.Id ?? facturaReal.ID ?? null,
          Numero: facturaReal.Numero || facturaNumero,
          Total: montoReal,
          cargadoManual: true,
        },
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

      return res.json({ ok: true, stockAjustadoManualmente, stockAjusteError, montoCoincide, montoEsperado, montoReal });
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
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 90,
    // Mismo motivo que reportSale — emitirComprobanteConIva usa Puppeteer
    // para FCA/FCB/FCC, 256MiB no alcanza.
    memory: "1GiB",
  },
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

      let comprobante;
      try {
        comprobante = await emitirComprobanteConIva({
          idCliente,
          idDeposito: userData?.contabiliumDepositoId || null,
          tipoFc: "FCA",
          items,
        });
      } catch (crearErr) {
        // Si Contabilium rechaza por falta de stock, lo más probable es que
        // ya exista una Cotización (COT) que descontó ese mismo stock antes
        // (el distribuidor la generó, o alguien la cargó a mano) — en vez de
        // devolver solo el error crudo de Contabilium, avisamos cuál es.
        const msg = crearErr.message || String(crearErr);
        let candidata = null;
        if (/disponible|stock/i.test(msg)) {
          try {
            const totalPedido = items.reduce((acc, it) => acc + Number(it.cantidad) * Number(it.precioUnitario), 0);
            const recientes = await getComprobantesByClientId(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), idCliente, { tipos: ["COT"] });
            candidata = recientes.find((c) => Math.abs(Number(String(c.ImporteTotalNeto || "0").replace(/\./g, "").replace(",", ".")) - totalPedido) < 1) || null;
          } catch {
            candidata = null; // si falla la búsqueda, seguimos con el error original de Contabilium
          }
        }
        if (candidata) {
          const totalPedido = items.reduce((acc, it) => acc + Number(it.cantidad) * Number(it.precioUnitario), 0);
          throw new Error(
            `${msg}\n\nProbablemente ya exista una Cotización (COT) que cubre esta misma venta y ya descontó el stock: ${candidata.Numero} del ${(candidata.FechaEmision || "").slice(0, 10)} por el mismo monto ($${totalPedido.toLocaleString("es-AR")}). Borrala en Contabilium para liberar el stock si querés emitir la factura real.`
          );
        }
        throw crearErr;
      }

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
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 90,
    // Mismo motivo que reportSale/emitirFacturaVenta — emitirComprobanteConIva
    // usa Puppeteer para FCA/FCB/FCC, 256MiB no alcanza (era el Error 500 que
    // veía el admin al facturar desde Clientes 360, confirmado en logs:
    // "Memory limit of 256 MiB exceeded with ~290-300MiB used").
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { contabiliumId, items, tipoFc, fechaEmision, sinDescontarStock } = req.body || {};
      const idCliente = Number(contabiliumId);
      if (!idCliente) return res.status(400).json({ error: "contabiliumId requerido" });
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Agregá al menos un ítem" });
      }
      // COT (cotización) y REM (remito) no son documentos AFIP — no llevan
      // CAE, se emiten directo con número real de Contabilium.
      const tipoFcValido = ["FCA", "FCB", "FCC", "COT", "REM"].includes(tipoFc) ? tipoFc : "FCA";
      // Fecha de emisión opcional (para cargar con fecha pasada, ej.
      // facturar en septiembre algo de agosto) — Contabilium lo admite
      // (formato YYYY-MM-DD). Ojo: para FCA/FCB/FCC electrónicas, AFIP
      // igual puede rechazar el CAE si la fecha está fuera de la ventana
      // que permite (unos pocos días de atraso) — Contabilium devuelve el
      // error tal cual si eso pasa.
      const fechaEmisionValida = /^\d{4}-\d{2}-\d{2}$/.test(fechaEmision || "") ? fechaEmision : undefined;

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
      // la factura descuente stock real, igual que emitirFacturaVenta — a
      // menos que se pida explícitamente lo contrario (ej: la mercadería ya
      // se descontó por otro lado, como una venta de un revendedor de un
      // distribuidor, y esta factura es solo para que el pago tenga su
      // comprobante, no para mover stock de vuelta).
      const db = admin.firestore();
      let idDeposito = null;
      if (!sinDescontarStock) {
        const userQuery = await db.collection("users").where("contabiliumId", "==", idCliente).limit(1).get();
        idDeposito = userQuery.empty ? null : userQuery.docs[0].data().contabiliumDepositoId || null;
      }

      const comprobante = await emitirComprobanteConIva({
        idCliente,
        idDeposito,
        tipoFc: tipoFcValido,
        items: cleanItems,
        fechaEmision: fechaEmisionValida,
      });

      await db.collection("facturasManuales").add({
        contabiliumId: idCliente,
        items: cleanItems,
        tipoFc: tipoFcValido,
        fechaEmision: fechaEmisionValida || null,
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

// ─────────────────────────────────────────────────────────────
// Sub-cuentas de un vendedor/distribuidor (ej. Stortini → Carhué/Viedma).
// Caso real: Stortini consigna parte de su propio stock a dos revendedores
// propios (no son clientes de Samurai, ni tienen contabiliumId/depósito
// propio) y les lleva una cuenta corriente aparte para cada uno — pedido
// explícito 22/10/2026. En Contabilium NO existen como entidades separadas
// — todo sigue siendo UNA sola factura/cliente (Stortini, su contabiliumId
// y su depósito real); esto es una capa de seguimiento nuestra, en
// Firestore, para no perder de vista cuánto stock/saldo tiene cada
// revendedor, aunque todo el movimiento real en Contabilium quede a nombre
// de Stortini.
// Estructura: users/{vendedorUid}.subcuentas = [{ id, nombre, stock: [{sku,
// nombre, cantidad}], saldo, historial: [{tipo, monto, fecha, nota,
// facturaNumero}] }]
function clampStockSubcuenta(stock) {
  return (Array.isArray(stock) ? stock : []).filter((it) => Number(it.cantidad) > 0);
}

exports.adminListSubcuentasVendedor = onRequest(
  { cors: false, invoker: "public" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const vendedorUid = req.body?.vendedorUid || req.query.vendedorUid;
      if (!vendedorUid) return res.status(400).json({ error: "vendedorUid requerido" });
      const snap = await admin.firestore().doc(`users/${vendedorUid}`).get();
      if (!snap.exists) return res.status(404).json({ error: "No existe ese usuario" });
      const subcuentas = snap.data().subcuentas || [];
      return res.json({ subcuentas });
    } catch (err) {
      console.error("[adminListSubcuentasVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Crea o edita una sub-cuenta entera (nombre + stock inicial + saldo
// inicial) — para dar de alta Carhué/Viedma la primera vez, o corregir algo
// a mano después.
exports.adminGuardarSubcuentaVendedor = onRequest(
  { cors: false, invoker: "public" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, id, nombre, stock, saldo } = req.body || {};
      if (!vendedorUid || !id || !nombre) return res.status(400).json({ error: "Faltan vendedorUid, id y nombre" });
      const db = admin.firestore();
      const ref = db.doc(`users/${vendedorUid}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "No existe ese usuario" });
      const subcuentas = snap.data().subcuentas || [];
      const idx = subcuentas.findIndex((s) => s.id === id);
      const nueva = {
        id,
        nombre,
        stock: clampStockSubcuenta(stock),
        saldo: Number(saldo) || 0,
        historial: idx >= 0 ? subcuentas[idx].historial || [] : [],
      };
      if (idx >= 0) subcuentas[idx] = nueva;
      else subcuentas.push(nueva);
      await ref.update({ subcuentas });
      return res.json({ ok: true, subcuentas });
    } catch (err) {
      console.error("[adminGuardarSubcuentaVendedor] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Factura a nombre del VENDEDOR real (su contabiliumId/depósito, como
// siempre) pero descuenta el SKU vendido del stock visible de la
// sub-cuenta elegida, y le suma el total de la factura a SU saldo (no al
// saldo general del vendedor, que ya lo maneja Contabilium solo). La
// cobranza real la sigue recibiendo/registrando el vendedor (Stortini), acá
// solo se actualiza el seguimiento interno de la sub-cuenta.
exports.adminFacturarSubcuenta = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 90,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, subcuentaId, items, tipoFc, fechaEmision } = req.body || {};
      if (!vendedorUid || !subcuentaId) return res.status(400).json({ error: "Faltan vendedorUid y subcuentaId" });
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Agregá al menos un ítem" });

      const db = admin.firestore();
      const ref = db.doc(`users/${vendedorUid}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "No existe ese usuario" });
      const vendedor = snap.data();
      if (!vendedor.contabiliumId) return res.status(400).json({ error: "El vendedor no tiene contabiliumId vinculado" });

      const subcuentas = vendedor.subcuentas || [];
      const idx = subcuentas.findIndex((s) => s.id === subcuentaId);
      if (idx < 0) return res.status(404).json({ error: "No existe esa sub-cuenta" });
      const subcuenta = subcuentas[idx];

      // Verifica ANTES de facturar que la sub-cuenta tenga stock suficiente
      // de cada SKU — evita dejar la factura real emitida en Contabilium
      // pero el seguimiento de la sub-cuenta en un estado imposible (stock
      // negativo).
      const stockPorSku = new Map((subcuenta.stock || []).map((it) => [it.sku, it]));
      for (const it of items) {
        const actual = stockPorSku.get(it.sku)?.cantidad || 0;
        if (Number(it.cantidad) > actual) {
          return res.status(400).json({ error: `${subcuenta.nombre} no tiene ${it.cantidad} de ${it.sku} (tiene ${actual})` });
        }
      }

      const cleanItems = items.map((it, i) => {
        const descripcion = String(it.descripcion || "").trim();
        const cantidad = Number(it.cantidad);
        const precioUnitario = Number(it.precioUnitario);
        if (!descripcion) throw new Error(`Ítem ${i + 1}: falta la descripción`);
        if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error(`Ítem ${i + 1}: cantidad inválida`);
        if (!Number.isFinite(precioUnitario) || precioUnitario < 0) throw new Error(`Ítem ${i + 1}: precio inválido`);
        return { descripcion, cantidad, precioUnitario, sku: it.sku ? String(it.sku).trim() : null };
      });

      const tipoFcValido = ["FCA", "FCB", "FCC", "COT", "REM"].includes(tipoFc) ? tipoFc : "FCA";
      const fechaEmisionValida = /^\d{4}-\d{2}-\d{2}$/.test(fechaEmision || "") ? fechaEmision : undefined;

      const comprobante = await emitirComprobanteConIva({
        idCliente: vendedor.contabiliumId,
        idDeposito: vendedor.contabiliumDepositoId || null,
        tipoFc: tipoFcValido,
        items: cleanItems,
        fechaEmision: fechaEmisionValida,
      });

      // Descuenta el stock de la sub-cuenta (independiente del stock real
      // de Contabilium, que ya lo descontó emitirComprobanteConIva solo) y
      // le suma el total a su saldo.
      const totalFactura = cleanItems.reduce((a, it) => a + it.cantidad * it.precioUnitario, 0);
      const nuevoStock = (subcuenta.stock || []).map((it) => ({ ...it }));
      for (const it of cleanItems) {
        const linea = nuevoStock.find((s) => s.sku === it.sku);
        if (linea) linea.cantidad = Math.max(0, Number(linea.cantidad) - it.cantidad);
      }
      const nuevaSubcuenta = {
        ...subcuenta,
        stock: clampStockSubcuenta(nuevoStock),
        saldo: Number(subcuenta.saldo || 0) + totalFactura,
        historial: [
          ...(subcuenta.historial || []),
          {
            tipo: "factura",
            monto: totalFactura,
            fecha: new Date().toISOString(),
            facturaNumero: comprobante?.Numero || null,
            items: cleanItems,
            registradoPor: staffUid,
          },
        ],
      };
      subcuentas[idx] = nuevaSubcuenta;
      await ref.update({ subcuentas });

      return res.json({ ok: true, comprobante, subcuenta: nuevaSubcuenta });
    } catch (err) {
      console.error("[adminFacturarSubcuenta] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Registra un pago/ajuste manual contra el SALDO de una sub-cuenta (no toca
// Contabilium — el cobro real a Samurai lo recibe el vendedor, esto es solo
// la cuenta corriente interna entre el vendedor y su revendedor). Monto
// positivo = sube el saldo (ej. se le entregó más stock sin facturar
// todavía); negativo = lo baja (pagó algo).
exports.adminRegistrarPagoSubcuenta = onRequest(
  { cors: false, invoker: "public" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { vendedorUid, subcuentaId, monto, nota } = req.body || {};
      if (!vendedorUid || !subcuentaId || monto == null) {
        return res.status(400).json({ error: "Faltan vendedorUid, subcuentaId y monto" });
      }
      const db = admin.firestore();
      const ref = db.doc(`users/${vendedorUid}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "No existe ese usuario" });
      const subcuentas = snap.data().subcuentas || [];
      const idx = subcuentas.findIndex((s) => s.id === subcuentaId);
      if (idx < 0) return res.status(404).json({ error: "No existe esa sub-cuenta" });
      const subcuenta = subcuentas[idx];
      const montoNum = Number(monto);
      const nuevaSubcuenta = {
        ...subcuenta,
        saldo: Number(subcuenta.saldo || 0) - montoNum,
        historial: [
          ...(subcuenta.historial || []),
          { tipo: "pago", monto: montoNum, fecha: new Date().toISOString(), nota: nota || "", registradoPor: staffUid },
        ],
      };
      subcuentas[idx] = nuevaSubcuenta;
      await ref.update({ subcuentas });
      return res.json({ ok: true, subcuenta: nuevaSubcuenta });
    } catch (err) {
      console.error("[adminRegistrarPagoSubcuenta] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

const TIPO_NC_POR_ORIGEN = { COT: "NCT", FCA: "NCA", FCB: "NCB", FCC: "NCC" };

// Nota de crédito contra un comprobante existente (COT o factura real).
// Dos caminos según el tipo de origen:
//  - COT → NCT: no es documento AFIP, se crea directo por la API REST
//    (crearComprobante con IdComprobanteAsociado) — mismo camino que ya usa
//    el resto del sitio para COT, confirmado contra una NCT real hecha a
//    mano (20/10/2026, Juliana Peralta): Contabilium la guarda con
//    IdComprobanteAsociado = id del COT y el total en negativo solo.
//  - FCA/FCB/FCC → NCA/NCB/NCC: factura real, necesita su propio CAE de
//    AFIP — va por el mismo flujo web (Puppeteer) que emite facturas
//    electrónicas, no por la REST pública (que falla con "Condicion IVA
//    receptor" en casos reales, ver comentario en crearComprobanteWeb).
// `montoTotal` (opcional): nota de crédito PARCIAL — un solo ítem por ese
// monto en vez de repetir los ítems originales 1 a 1. Sin él, es un
// reverso completo de la factura/COT original.
exports.crearNotaCredito = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { idComprobanteOriginal, montoTotal, observaciones } = req.body || {};
      const idOriginal = Number(idComprobanteOriginal);
      if (!idOriginal) return res.status(400).json({ error: "idComprobanteOriginal requerido" });

      const email = CONTABILIUM_EMAIL.value();
      const apiKey = CONTABILIUM_API_KEY.value();
      const original = await getComprobanteById(email, apiKey, idOriginal);
      if (!original) return res.status(404).json({ error: "No se encontró el comprobante original" });

      const tipoNC = TIPO_NC_POR_ORIGEN[original.TipoFc];
      if (!tipoNC) {
        return res.status(400).json({ error: `No se puede hacer una NC sobre un comprobante tipo "${original.TipoFc}" — solo COT, FCA, FCB o FCC.` });
      }

      const itemsOriginales = original.Items || [];
      if (itemsOriginales.length === 0) {
        return res.status(400).json({ error: "El comprobante original no tiene ítems para copiar" });
      }

      // NC parcial: un solo ítem con la descripción del primero y el monto
      // pedido (mismo criterio que se usa a mano en Contabilium: un ítem
      // "genérico" por la diferencia, no hay forma de prorratear sola entre
      // varios productos sin que el staff decida a cuál se le aplica).
      const itemsNC = Number.isFinite(Number(montoTotal)) && Number(montoTotal) > 0
        ? [{
            sku: itemsOriginales[0].Codigo || null,
            descripcion: itemsOriginales[0].Concepto || itemsOriginales[0].Descripcion || "Ajuste",
            cantidad: 1,
            precioUnitario: Number(montoTotal),
          }]
        : itemsOriginales.map((it) => ({
            sku: it.Codigo || null,
            descripcion: it.Concepto || it.Descripcion || "",
            cantidad: Number(it.Cantidad) || 1,
            precioUnitario: Number(it.PrecioUnitario) || 0,
          }));

      let resultado;
      if (tipoNC === "NCT") {
        resultado = await crearComprobante(email, apiKey, {
          idCliente: original.IdCliente,
          tipoFc: "NCT",
          items: itemsNC,
          fechaEmision: new Date().toISOString().slice(0, 10),
          idComprobanteAsociado: idOriginal,
        });
      } else {
        const { crearComprobanteWeb } = require("./contabiliumWebAutomation");
        const itemsWeb = itemsNC.map((it) => ({
          sku: it.sku,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precioUnitarioConIva: it.precioUnitario,
          iva: 21,
        }));
        const { idComprobante, cae } = await crearComprobanteWeb({
          db: admin.firestore(),
          email: CONTABILIUM_WEB_EMAIL.value(),
          password: CONTABILIUM_WEB_PASSWORD.value(),
          restEmail: email,
          restApiKey: apiKey,
          idPersona: original.IdCliente,
          idInventario: original.Inventario || undefined,
          tipoFc: tipoNC,
          items: itemsWeb,
          fechaEmision: new Date().toISOString().slice(0, 10),
          observaciones: observaciones || "",
          comprobanteAsociado: idOriginal,
          motivoNC: observaciones || "Ajuste",
        });
        resultado = await getComprobanteById(email, apiKey, idComprobante);
        resultado = { Id: idComprobante, Cae: cae, ...(resultado || {}) };
      }

      await admin.firestore().collection("notasCredito").add({
        idComprobanteOriginal: idOriginal,
        tipoOriginal: original.TipoFc,
        tipoNC,
        montoTotal: montoTotal ? Number(montoTotal) : null,
        observaciones: observaciones || null,
        creadoPor: staffUid,
        creadoAt: admin.firestore.FieldValue.serverTimestamp(),
        resultado: resultado || null,
      });

      return res.json({ ok: true, notaCredito: resultado });
    } catch (err) {
      console.error("[crearNotaCredito] error:", err);
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
// cheque como NroReferencia. Nota de crédito tampoco lleva banco — lo que
// identifica el pago es el IDNotaCredito. Efectivo SÍ necesita una Caja
// (no banco): revisando las cobranzas reales sincronizadas, todas las de
// Efectivo traen `IdCaja: 108982` — sin eso Contabilium tira un error
// interno ("Object reference not set to an instance of an object") al
// intentar cobrar, en vez de un error claro.
const FORMAS_SIN_BANCO = ["Efectivo", "Cheque", "Nota de crédito"];
const CAJA_EFECTIVO_ID = 108982;
exports.cobrarComprobante = onRequest(
  { cors: false, secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { idComprobante, importeTotalNeto, fecha } = req.body || {};
      const id = Number(idComprobante);
      const total = Number(importeTotalNeto);
      if (!id) return res.status(400).json({ error: "idComprobante requerido" });
      if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: "importeTotalNeto inválido" });
      if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ error: "fecha inválida, formato esperado AAAA-MM-DD" });
      }

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
        if (p.formaDePago === "Nota de crédito" && !p.idNotaCredito) {
          return res.status(400).json({ error: "Elegí qué nota de crédito estás aplicando" });
        }
        sumaImportes += importe;
        pagos.push({
          FormaDePago: p.formaDePago,
          IDBanco: FORMAS_SIN_BANCO.includes(p.formaDePago) ? null : Number(p.idBanco),
          IDCaja: p.formaDePago === "Efectivo" ? CAJA_EFECTIVO_ID : null,
          IDNotaCredito: p.formaDePago === "Nota de crédito" ? Number(p.idNotaCredito) : null,
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
        fecha,
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
// Mismo mapeo que src/services/bancos.ts (Contabilium no expone un
// endpoint de bancos) — se repite acá porque el backend no puede importar
// un archivo del frontend.
const BANCOS_POR_ID_SERVER = {
  217296: "Banco Galicia S.A",
  217302: "Banco Santander Río S.A",
  201286: "Banco Supervielle S.A",
  201285: "MercadoPago",
};
// Palabras clave para reconocer cada banco en lo que devuelve la IA (que
// puede escribir "Galicia", "Banco Galicia", "GALICIA", etc.)
const BANCO_KEYWORDS = [
  { idBanco: 217296, keywords: ["galicia"] },
  { idBanco: 217302, keywords: ["santander"] },
  { idBanco: 201286, keywords: ["supervielle"] },
  { idBanco: 201285, keywords: ["mercado pago", "mercadopago", "mp"] },
];
function idBancoDesdeTexto(texto) {
  const t = String(texto || "").toLowerCase();
  for (const { idBanco, keywords } of BANCO_KEYWORDS) {
    if (keywords.some((k) => t.includes(k))) return idBanco;
  }
  return null;
}

// Le pide a Claude que lea la foto/PDF del comprobante y devuelva monto,
// fecha y banco en JSON. Se usa para aplicar el recibo en Contabilium sin
// que un humano tenga que mirar la imagen y elegir el banco a mano. Si la
// IA no está segura o no puede leerla, devuelve null y el pago queda
// pendiente de revisión manual (nunca se fuerza una aplicación dudosa).
async function leerComprobanteConIA(imageUrl, anthropicApiKey) {
  if (!anthropicApiKey) return null;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      console.error(`[pagosCC] leerComprobanteConIA: no se pudo bajar el archivo (status ${imgRes.status}) de ${imageUrl}`);
      return null;
    }
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    // No confiar solo en el header Content-Type — Firebase Storage/CDN a
    // veces lo sirve distinto al que se guardó (ej. octet-stream), lo que
    // antes hacía que un PDF real cayera siempre en "no se pudo leer" sin
    // ningún log (bug detectado 14/10/2026). La firma real del archivo
    // ("%PDF-" al principio) es lo único confiable para saber si es un PDF.
    const esPdfPorFirma = buffer.length > 4 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    const esPdf = esPdfPorFirma || contentType === "application/pdf";
    if (!esPdf && !contentType.startsWith("image/")) {
      console.error(`[pagosCC] leerComprobanteConIA: tipo de archivo no soportado (content-type "${contentType}", ${buffer.length} bytes) de ${imageUrl}`);
      return null;
    }
    const base64 = buffer.toString("base64");
    const contentBlock = esPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: contentType, data: base64 } };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              {
                type: "text",
                text:
                  "Esta es una captura de un comprobante de transferencia o depósito bancario argentino, hecho A FAVOR " +
                  "de la empresa (nosotros somos quien RECIBE la plata, no quien la envía). Extraé el monto transferido, " +
                  "la fecha, el banco/cuenta DE DESTINO — es decir, en qué banco cayó la plata que recibimos, no de " +
                  "dónde salió — fijate en campos como 'Cuenta destino', 'Para', 'Destinatario', el banco asociado al " +
                  "CBU/alias destino, o el nombre del banco/billetera receptora (Galicia, Santander Río, Supervielle o " +
                  "Mercado Pago son las opciones más probables). OJO: si la captura es de la app/sitio de Mercado Pago " +
                  "(tiene su logo arriba) pero el bloque 'Origen y destino' muestra que el destinatario tiene una cuenta " +
                  "en OTRO banco (ej: 'Fepa Top Sas — Banco Supervielle — CBU 0270...'), el banco de destino real es ESE " +
                  "banco (Supervielle en el ejemplo), no 'Mercado Pago' — el logo de la app es solo de quién envió el " +
                  "pago, no de dónde cayó la plata. Sacá el banco de destino del texto del bloque destino, nunca del " +
                  "logo/marca de la pantalla. Si el comprobante solo muestra el banco emisor/origen " +
                  "y no hay forma de saber el destino, dejá el banco en null en vez de adivinar. También extraé el " +
                  "número de referencia/operación/transacción si figura (a veces dice 'Nro de operación', 'Nro de " +
                  "transacción', 'Referencia', 'Comprobante Nro', o un código alfanumérico largo cerca del monto). " +
                  "Respondé ÚNICAMENTE con un JSON de una línea, sin texto adicional, con esta forma exacta: " +
                  '{"monto": <número sin puntos ni comas, ej 305000>, "fecha": "YYYY-MM-DD" o null, ' +
                  '"banco": "<nombre del banco/billetera DE DESTINO tal cual aparece>" o null, ' +
                  '"referencia": "<número/código de operación tal cual aparece>" o null, ' +
                  '"confianza": "alta"|"media"|"baja"}. ' +
                  'Usá "confianza":"baja" si la imagen no es un comprobante bancario claro, no podés leer el monto con ' +
                  'certeza, o no podés determinar el banco de destino con confianza.',
              },
            ],
          },
        ],
      }),
    });
    if (!r.ok) {
      console.error("[pagosCC] Anthropic API error:", r.status, await r.text());
      return null;
    }
    const body = await r.json();
    const text = body?.content?.find((b) => b.type === "text")?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      monto: Number(parsed.monto) || null,
      fecha: parsed.fecha || null,
      banco: parsed.banco || null,
      referencia: parsed.referencia || null,
      confianza: parsed.confianza || "baja",
    };
  } catch (err) {
    console.error("[pagosCC] leerComprobanteConIA error:", err);
    return null;
  }
}

// Lee una foto de comprobante subida por el staff (desde el formulario de
// recibo en Clientes 360) y devuelve monto/fecha/banco/referencia para
// precargar el formulario — el staff siempre confirma/edita antes de
// aplicar el recibo real, esto solo ahorra tipeo.
exports.leerComprobantePagoAdmin = onRequest(
  { cors: false, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ error: "Falta la url de la imagen" });
      const lectura = await leerComprobanteConIA(url, ANTHROPIC_API_KEY.value());
      if (!lectura) return res.json({ ok: true, lectura: null });
      const idBanco = lectura.banco ? idBancoDesdeTexto(lectura.banco) : null;
      return res.json({ ok: true, lectura: { ...lectura, idBanco } });
    } catch (err) {
      console.error("[leerComprobantePagoAdmin] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

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
  {
    cors: false,
    invoker: "public",
    secrets: [CONTABILIUM_EMAIL, CONTABILIUM_API_KEY, ANTHROPIC_API_KEY],
    timeoutSeconds: 60,
  },
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

      const montoNum = Number(monto);

      const cobranzasSnap = await db.collection("cobranzas").where("idPersona", "==", u.contabiliumId).get();
      const cobranzas = cobranzasSnap.docs.map((d) => d.data());
      const match = buscarCobranzaCoincidente(cobranzas, montoNum, fecha);

      const docData = {
        distributorUid: uid,
        distributorName: u.contabiliumDepositoNombre || u.name || "",
        contabiliumId: u.contabiliumId,
        monto: montoNum,
        fecha,
        nota: nota || null,
        comprobanteUrl: url,
        estado: match ? "confirmado_auto" : "pendiente",
        matchedCobranzaNumero: match?.numero || null,
        matchedCobranzaImporte: match ? Number(match.importeReal ?? match.importeTotal ?? 0) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Si no había ya una cobranza cargada a mano que coincida, probamos
      // que la propia IA lea la foto del comprobante (banco, monto, fecha)
      // y — si hay una única factura sin ningún pago previo cuyo saldo
      // coincide exacto con el monto reportado — cargamos el recibo en
      // Contabilium solos, sin pasar por revisión de un humano. Cualquier
      // señal de duda (IA no segura, hay 0 o más de una factura candidata,
      // banco no identificado) hace que quede "pendiente" como antes: nunca
      // se fuerza una aplicación dudosa de plata real.
      let aplicadoAutomaticamente = false;
      if (!match) {
        try {
          const lectura = await leerComprobanteConIA(url, ANTHROPIC_API_KEY.value());
          // Se guarda SIEMPRE que se pudo leer, aunque no se aplique solo —
          // antes esto se descartaba, y el staff terminaba confiando en la
          // fecha que tipeó el distribuidor (a veces mal, por defecto "hoy")
          // en vez de la fecha real que figura en el comprobante.
          if (lectura) {
            docData.lecturaIA = {
              fecha: lectura.fecha || null,
              monto: lectura.monto ?? null,
              banco: lectura.banco || null,
              referencia: lectura.referencia || null,
              confianza: lectura.confianza || "baja",
            };
          }
          const idBancoDetectado = lectura?.banco ? idBancoDesdeTexto(lectura.banco) : null;
          const montoCoincideConIA =
            lectura?.monto != null && Math.abs(lectura.monto - montoNum) <= Math.max(500, montoNum * 0.01);

          if (lectura?.confianza === "alta" && montoCoincideConIA && idBancoDetectado) {
            const facturas = await getComprobantesByClientId(
              CONTABILIUM_EMAIL.value(),
              CONTABILIUM_API_KEY.value(),
              u.contabiliumId,
              { tipos: TIPOS_FACTURA_NOTA }
            );
            // Condición conservadora: la factura tiene que estar 100% sin
            // pagos previos (Saldo === Total) y ese saldo tiene que
            // coincidir con el monto reportado — así nunca reemplazamos un
            // recibo que ya tenía otras líneas cargadas (evita el bug de
            // duplicar/pisar cobranzas existentes).
            const candidatas = facturas.filter((f) => {
              const saldo = parseArNumber(f.Saldo);
              const total = parseArNumber(f.ImporteTotalNeto);
              return saldo > 0 && Math.abs(saldo - total) < 1 && Math.abs(saldo - montoNum) <= 1;
            });

            if (candidatas.length === 1) {
              const factura = candidatas[0];
              const total = parseArNumber(factura.ImporteTotalNeto);
              await cobrarComprobante(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), {
                id: factura.Id,
                importeTotalNeto: total,
                saldo: 0,
                pagos: [
                  {
                    FormaDePago: "Transferencia",
                    IDBanco: idBancoDetectado,
                    IDCaja: null,
                    IDNotaCredito: null,
                    Importe: montoNum,
                    NroReferencia: "Auto (IA) — comprobante subido por el cliente",
                    IDComprobanteAsociado: "",
                  },
                ],
              });
              try {
                const hoy = new Date().toISOString().slice(0, 10);
                await doContabiliumCobranzasSync(CONTABILIUM_EMAIL.value(), CONTABILIUM_API_KEY.value(), {
                  fechaDesde: hoy,
                  fechaHasta: hoy,
                });
              } catch (syncErr) {
                console.error("[pagosCC] no se pudo re-sincronizar cobranzas del día:", syncErr);
              }
              aplicadoAutomaticamente = true;
              docData.estado = "confirmado_auto";
              docData.aplicadoAutomaticamenteConIA = true;
              docData.facturaAplicada = factura.Numero || factura.Id;
              docData.bancoDetectadoIA = lectura.banco;
              docData.montoDetectadoIA = lectura.monto;
            }
          }
        } catch (err) {
          // Cualquier error acá (IA caída, Contabilium rechazó el recibo,
          // etc.) nunca debe romper el reporte del cliente — sigue el flujo
          // normal y queda pendiente de revisión manual.
          console.error("[pagosCC] auto-aplicación con IA falló, queda pendiente:", err);
        }
      }

      const ref = await db.collection("pagosReportados").add(docData);

      if (!match && !aplicadoAutomaticamente) {
        await db.collection("notifications").add({
          type: "pago_cc_pendiente",
          distributorUid: uid,
          distributorName: docData.distributorName,
          pagoReportadoId: ref.id,
          monto: docData.monto,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        enviarPushAAdmins({
          title: "🧾 Comprobante para revisar",
          body: `${docData.distributorName} reportó un pago de ${docData.monto} — necesita revisión manual`,
          link: "/admin/ventas-reportadas?tab=comprobantes",
        });
      } else if (aplicadoAutomaticamente) {
        // Igual se avisa al staff cuando la IA aplicó un recibo solo — es
        // plata real, conviene que quede visible aunque no haga falta
        // ninguna acción.
        await db.collection("notifications").add({
          type: "pago_cc_auto_aplicado",
          distributorUid: uid,
          distributorName: docData.distributorName,
          pagoReportadoId: ref.id,
          monto: docData.monto,
          facturaAplicada: docData.facturaAplicada,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        enviarPushAAdmins({
          title: "✅ Pago aplicado automático",
          body: `${docData.distributorName} — ${docData.monto} aplicado a la factura ${docData.facturaAplicada}`,
          link: "/admin/ventas-reportadas?tab=comprobantes",
        });
        enviarPushAUsuario(uid, {
          title: "✅ Tu pago fue confirmado",
          body: `Registramos tu pago de ${docData.monto} contra la factura ${docData.facturaAplicada}.`,
          link: "/mi-stock",
        });
      } else if (match) {
        enviarPushAUsuario(uid, {
          title: "✅ Tu pago fue confirmado",
          body: `Encontramos tu pago de ${docData.monto} ya registrado en tu cuenta.`,
          link: "/mi-stock",
        });
      }

      return res.json({ ok: true, id: ref.id, confirmadoAutomaticamente: !!match || aplicadoAutomaticamente });
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
      const pagoRef = admin.firestore().doc(`pagosReportados/${id}`);
      await pagoRef.update({
        estado: aprobado ? "confirmado_manual" : "rechazado",
        revisadoPor: staffUid,
        revisadoAt: admin.firestore.FieldValue.serverTimestamp(),
        notaRevision: nota || null,
      });
      const pagoSnap = await pagoRef.get();
      const pagoData = pagoSnap.data();
      if (pagoData?.distributorUid) {
        enviarPushAUsuario(pagoData.distributorUid, {
          title: aprobado ? "✅ Tu pago fue confirmado" : "❌ Tu comprobante fue rechazado",
          body: aprobado
            ? `Confirmamos tu pago de ${pagoData.monto}.`
            : `Tu comprobante de ${pagoData.monto} fue rechazado${nota ? `: ${nota}` : ". Contactanos para más detalle."}`,
          link: "/mi-stock",
        });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error("[pagosCC] reviewPagoReportado error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

// Lista real (en vivo, vía sesión web) de las cuentas bancarias y cajas
// PROPIAS de la empresa en Contabilium — para que el desplegable "Banco
// propio" del form de cobranzas muestre exactamente las mismas opciones
// que tiene Contabilium, en vez de un campo de texto libre donde había que
// escribir el nombre a mano y confiar en que el backend lo matcheara bien.
exports.obtenerBancosYCajasPropios = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 60 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const db = admin.firestore();
      const { getCookieValida, obtenerBancosPropios, obtenerCajasPropias } = require("./contabiliumWebAutomation");
      const hoy = new Date();
      const fechaDdMmYyyy = `${String(hoy.getDate()).padStart(2, "0")}/${String(hoy.getMonth() + 1).padStart(2, "0")}/${hoy.getFullYear()}`;
      const cookie = await getCookieValida(db, CONTABILIUM_WEB_EMAIL.value(), CONTABILIUM_WEB_PASSWORD.value());
      const [bancos, cajas] = await Promise.all([
        obtenerBancosPropios(cookie, fechaDdMmYyyy),
        obtenerCajasPropias(cookie, fechaDdMmYyyy),
      ]);
      return res.json({ bancos, cajas });
    } catch (err) {
      console.error("[pagosCC] obtenerBancosYCajasPropios error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// Confirma un comprobante reportado CARGANDO el recibo de verdad en
// Contabilium — a diferencia de reviewPagoReportado (que solo cambia el
// estado acá en Samurai, sin tocar nada real), esto llama al mismo flujo
// web que ya usamos para cobranzas manuales (aplicarPagoFacturaWeb), así
// que al confirmar un comprobante queda reflejado en la cuenta real del
// cliente, no solo marcado como "listo" en una pantalla. El staff elige a
// mano a qué factura se aplica (o "-1" para cargarlo "a cuenta", sin
// factura puntual) — nunca se adivina sola.
exports.confirmarPagoReportado = onRequest(
  {
    cors: false,
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;

    try {
      const {
        id, idComprobante, comprobante, importe, saldoFactura, fecha,
        forma, banco, idBanco, idCaja, idcheque, nroRef, observaciones,
      } = req.body || {};

      if (!id || !fecha || importe == null || (!idComprobante && idComprobante !== "-1")) {
        return res.status(400).json({ error: "Faltan datos: id, idComprobante (o \"-1\" para a cuenta), importe, fecha" });
      }

      const db = admin.firestore();
      const pagoRef = db.doc(`pagosReportados/${id}`);
      const pagoSnap = await pagoRef.get();
      if (!pagoSnap.exists) return res.status(404).json({ error: "No se encontró el comprobante reportado" });
      const pago = pagoSnap.data();
      if (!pago.contabiliumId) return res.status(400).json({ error: "Este comprobante no tiene cliente vinculado" });

      const isoADdMmYyyy = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
      };

      const esACuenta = String(idComprobante) === "-1";
      const { aplicarPagoFacturaWeb, cargarCobranzaACuentaWeb } = require("./contabiliumWebAutomation");

      let resultado;
      if (esACuenta) {
        resultado = await cargarCobranzaACuentaWeb({
          db,
          email: CONTABILIUM_WEB_EMAIL.value(),
          password: CONTABILIUM_WEB_PASSWORD.value(),
          idPersona: pago.contabiliumId,
          importe,
          fecha: isoADdMmYyyy(fecha),
          forma: forma || "Transferencia",
          banco,
          idBanco,
          caja: forma === "Efectivo" ? banco : undefined,
          idCaja,
          nroRef,
          observaciones: observaciones || `Comprobante subido por el cliente — ${pago.comprobanteUrl || ""}`,
        });
      } else {
        resultado = await aplicarPagoFacturaWeb({
          db,
          email: CONTABILIUM_WEB_EMAIL.value(),
          password: CONTABILIUM_WEB_PASSWORD.value(),
          idPersona: pago.contabiliumId,
          idComprobante: Number(idComprobante),
          comprobante,
          importe,
          saldoFactura: saldoFactura ?? importe,
          fecha: isoADdMmYyyy(fecha),
          forma: forma || "Transferencia",
          banco,
          idBanco,
          idcheque,
          nroRef,
          observaciones: observaciones || `Comprobante subido por el cliente — ${pago.comprobanteUrl || ""}`,
        });
      }

      await pagoRef.update({
        estado: "confirmado_manual",
        revisadoPor: staffUid,
        revisadoAt: admin.firestore.FieldValue.serverTimestamp(),
        facturaAplicada: esACuenta ? "a cuenta" : (comprobante || idComprobante),
        nroComprobanteRecibo: resultado.nroComprobante,
        fechaConfirmada: fecha,
        montoConfirmado: importe,
      });

      if (pago.distributorUid) {
        enviarPushAUsuario(pago.distributorUid, {
          title: "✅ Tu pago fue confirmado",
          body: `Confirmamos tu pago de ${importe} y ya quedó cargado en tu cuenta.`,
          link: "/mi-stock",
        });
      }

      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error("[pagosCC] confirmarPagoReportado error:", err);
      return res.status(500).json({ error: err.message || String(err) });
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
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncConsignedRollup: pausado, salteando");
        return;
      }
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
  const TIPOS_SALDO = TIPOS_SALDO_CON_COT;

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

  // "Debe video": igual criterio que isAuditOverdue del lado del cliente
  // (src/services/stockAudits.ts) — vencido si pasaron más de
  // auditIntervalDays (default 10) desde el último video de auditoría de
  // stock de ese depósito, o desde el arranque del programa si nunca grabó
  // ninguno. Se trae TODA la colección stockAudits de una (son pocos docs,
  // uno cada ~10 días por depósito) y se agarra el más reciente por
  // depositoId en memoria, en vez de pegarle a Firestore depósito por
  // depósito.
  const AUDIT_INTERVAL_DIAS_DEFAULT = 10;
  const programStartSnap = await db.doc("meta/stockAuditProgram").get();
  const programStart = programStartSnap.exists && programStartSnap.data().startedAt?.toDate
    ? programStartSnap.data().startedAt.toDate()
    : null;
  const audisSnap = await db.collection("stockAudits").orderBy("createdAt", "desc").get();
  const ultimoVideoPorDeposito = new Map();
  audisSnap.docs.forEach((d) => {
    const a = d.data();
    const depId = String(a.depositoId || "");
    if (!depId || ultimoVideoPorDeposito.has(depId)) return; // ya tenemos el más reciente de este
    ultimoVideoPorDeposito.set(depId, a.createdAt?.toDate ? a.createdAt.toDate() : null);
  });
  function debeVideoAuditoria(depositoId, intervalDays) {
    if (!depositoId) return false;
    const lastAuditAt = ultimoVideoPorDeposito.get(String(depositoId)) || null;
    const base = lastAuditAt || programStart;
    if (!base) return true;
    const next = new Date(base);
    next.setDate(next.getDate() + (intervalDays || AUDIT_INTERVAL_DIAS_DEFAULT));
    return next.getTime() <= Date.now();
  }

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
    const stockConsignado = dep ? dep.bicicletas : 0;

    return {
      uid: uDoc.id,
      nombre: u.name || "",
      localidad: u.city || "",
      contabiliumId,
      depositoId: u.contabiliumDepositoId || null,
      debeVideo: stockConsignado > 0 ? debeVideoAuditoria(u.contabiliumDepositoId, u.auditIntervalDays) : false,
      stockConsignado,
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
// mide con los ítems de cada factura (FCA o FCB — antes solo se miraba FCA,
// lo que dejaba afuera las pocas Factura B que emite Contabilium), no con
// remitos.
async function computeBusinessDashboard(db, email, apiKey) {
  const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));

  const allComprobantesRaw = await getAllComprobantes(email, apiKey, {});
  const facturas = allComprobantesRaw.filter((c) => c.TipoFc === "FCA" || c.TipoFc === "FCB" || c.TipoFc === "FCC");
  // Las COT (cotización) se procesan aparte, con el mismo detalle de ítems,
  // pero SIN mezclarlas en "facturas"/"porFactura": no son factura real (sin
  // CAE, ej. venta en B) y varias pantallas (saldo en consignación de
  // RemitosReporte, DashboardNegocio) ya asumen que todo lo que hay en
  // porFactura es ingreso real facturado. Igual hace falta su detalle de
  // bicis por día — el contador diario las cuenta como "Vendidas" (ver
  // computeDailyBikeStats) aunque no sean factura.
  const cotizaciones = allComprobantesRaw.filter((c) => c.TipoFc === "COT");

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
    const esFacturaReal = f.TipoFc !== "COT";
    if (!porMes[mes]) {
      porMes[mes] = { mes, facturas: 0, facturado: 0, bicis: 0, facturadoBicis: 0, costoBicis: 0, bicisConCosto: 0 };
    }
    if (esFacturaReal) {
      porMes[mes].facturas += 1;
      porMes[mes].facturado += parseAr(f.ImporteTotalNeto);
    }

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
      bicisFactura += cantidad;
      facturadoBicisFactura += total;
      if (esFacturaReal) {
        porMes[mes].bicis += cantidad;
        porMes[mes].facturadoBicis += total;
        if (costBySku[sku] != null) {
          porMes[mes].costoBicis += cantidad * costBySku[sku];
          porMes[mes].bicisConCosto += cantidad;
        }
      }
    }
    porFactura.push({
      id: f.Id,
      fecha: (f.FechaEmision || "").slice(0, 10),
      cliente: f.RazonSocial || "",
      // Igual que en el remito: el ID real de Contabilium, para cruzar por
      // número y no por el texto de la razón social.
      idCliente: f.IdCliente ?? null,
      tipoFc: f.TipoFc,
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
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncBusinessDashboard: pausado, salteando");
        return;
      }
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
// Contador diario de bicis: facturadas / cobradas / consignadas, día por
// día — para chequear a primera hora (pedido 30/9/2026). No pega contra
// Contabilium en vivo — todo sale de lo que ya está cacheado en Firestore
// por otros syncs (businessDashboardDetail, cobranzas, consignedRollup),
// así que es barato y se puede recalcular todas las veces que haga falta.
//
// Facturadas: bicis de las facturas emitidas ESE día (dato directo,
// businessDashboardDetail.porFactura ya trae fecha+bicis por factura).
//
// Cobradas: acá no hay un campo directo — una factura se puede pagar en
// varias cobranzas parciales, en días distintos. Se reconstruye así: para
// cada factura, se juntan todas sus cobranzas (cobranzas.detalle[].
// IDComprobante == factura.id) ordenadas por fecha, se van acumulando los
// importes, y el día en que el acumulado llega a cubrir el total de la
// factura es el día en que "se terminó de cobrar" — ahí se le suman sus
// bicis a ESE día. Si nunca se completa el pago, no cuenta en ningún día
// (sigue mostrándose como deuda en otros lados de la app, simplemente no
// entra en este contador de "cobradas").
//
// Consignadas: es una foto del momento (cuántas bicis hay ahora en
// depósitos), no algo que se pueda reconstruir para el pasado — arranca a
// guardarse recién desde el primer día que corre este sync. Los días
// anteriores a eso van a quedar sin ese dato.
// Mismo criterio que usa el Sector 1 ("Movimiento de stock", en vivo) de
// Remitos y Cobranza: "entregada a cliente" = sale de uno de los 3
// depósitos propios (Lavalle/Cañuelas/Credifin) O del depósito de Cuchi,
// hacia un destino que NO es ninguno de los 3 propios. El depósito de
// Cuchi cuenta como "cliente" cuando es DESTINO (es la entrega que le
// hacemos a él), y como origen real cuando es ÉL quien entrega a los
// suyos — duplicado acá a propósito (ver src/components/remitos/
// SectorMovimientoStock.jsx) porque ese archivo es del frontend y este es
// backend, no se puede compartir el módulo directamente.
const DEPOSITO_PROPIO_RE_BACKEND = /lavalle|temperley|ca[ñn]uelas|credifin/i;
const CUCHI_RE_BACKEND = /\bcuchi\b|bavcevich/i;
function esEntregaAClienteBackend(m) {
  const origenPropio = DEPOSITO_PROPIO_RE_BACKEND.test((m.origen || "").trim());
  const destinoPropio = DEPOSITO_PROPIO_RE_BACKEND.test((m.destino || "").trim());
  const origenCuchi = CUCHI_RE_BACKEND.test((m.origen || "").trim());
  if (destinoPropio) return false; // interno entre depósitos propios
  return origenPropio || origenCuchi;
}

async function computeDailyBikeStats(db, email, password) {
  const dashSnap = await db.doc("meta/businessDashboardDetail").get();
  const porFactura = dashSnap.exists ? dashSnap.data().porFactura || [] : [];
  const facturaMap = new Map(); // id de Contabilium -> {fecha, bicis, total} — solo FCA/FCB/FCC (factura real)
  const cotizadoPorDia = {}; // bicis en COT (cotización) — no es factura real, pero sí una venta documentada
  for (const f of porFactura) {
    if (f.id == null || !f.fecha) continue;
    if (f.tipoFc === "COT") {
      cotizadoPorDia[f.fecha] = (cotizadoPorDia[f.fecha] || 0) + Number(f.bicis || 0);
      continue;
    }
    facturaMap.set(f.id, { fecha: f.fecha, bicis: Number(f.bicis || 0), total: Number(f.facturado || 0) });
  }

  const facturadoPorDia = {};
  for (const f of facturaMap.values()) {
    facturadoPorDia[f.fecha] = (facturadoPorDia[f.fecha] || 0) + f.bicis;
  }

  const cobranzasSnap = await db.collection("cobranzas").get();
  const pagosPorFactura = new Map(); // id -> [{fecha, importe}]
  cobranzasSnap.forEach((d) => {
    const c = d.data();
    if (c.excluirDeSaldo) return;
    const fecha = String(c.fecha || "").slice(0, 10);
    if (!fecha) return;
    const detalle = Array.isArray(c.detalle) ? c.detalle : [];
    for (const it of detalle) {
      const idFactura = it?.IDComprobante;
      if (idFactura == null || !facturaMap.has(idFactura)) continue;
      if (!pagosPorFactura.has(idFactura)) pagosPorFactura.set(idFactura, []);
      pagosPorFactura.get(idFactura).push({ fecha, importe: Number(it.Importe || 0) });
    }
  });

  const cobradoPorDia = {};
  for (const [idFactura, f] of facturaMap) {
    if (f.total <= 0) continue;
    const pagos = pagosPorFactura.get(idFactura);
    if (!pagos) continue;
    pagos.sort((a, b) => a.fecha.localeCompare(b.fecha));
    let acumulado = 0;
    let fechaCompletado = null;
    for (const p of pagos) {
      acumulado += p.importe;
      if (acumulado >= f.total - 1) {
        fechaCompletado = p.fecha;
        break;
      }
    }
    if (fechaCompletado) {
      cobradoPorDia[fechaCompletado] = (cobradoPorDia[fechaCompletado] || 0) + f.bicis;
    }
  }

  const rollupSnap = await db.doc("meta/consignedRollupDetail").get();
  const porDeposito = rollupSnap.exists ? rollupSnap.data().porDeposito || [] : [];
  const consignadoHoy = porDeposito.reduce((acc, d) => acc + Number(d.bicicletas || 0), 0);

  // Entregadas: NO sale de remitos (eso es "Sector 2", texto de
  // observación) — sale del movimiento de stock real, en vivo, de
  // Contabilium (la misma API que usa el Sector 1 de Remitos y Cobranza:
  // movinventarios/GetPageWithFilters, la que está detrás de
  // modulos/inventarios/movimientosDeStock.aspx). 2 años de ventana de
  // sobra para cubrir todo el historial del negocio sin pegarle con un
  // rango abierto.
  const entregadoPorDia = {};
  try {
    const { obtenerMovimientosStock } = require("./contabiliumWebAutomation");
    const fechaDesdeMov = new Date();
    fechaDesdeMov.setFullYear(fechaDesdeMov.getFullYear() - 2);
    const movimientos = await obtenerMovimientosStock({
      db,
      email,
      password,
      fechaDesde: fechaDesdeMov.toISOString().slice(0, 10),
      fechaHasta: new Date().toISOString().slice(0, 10),
    });
    for (const m of movimientos) {
      if (!/BIC\b/i.test(m.codigoNombre || "")) continue;
      const fecha = (m.fecha || "").slice(0, 10);
      if (!fecha || !esEntregaAClienteBackend(m)) continue;
      entregadoPorDia[fecha] = (entregadoPorDia[fecha] || 0) + Number(m.cantidad || 0);
    }
  } catch (err) {
    console.error("[dailyBikeStats] no se pudo traer movimiento de stock en vivo para 'Entregadas':", err.message);
  }

  // Ventas reportadas: lo que cada distribuidor avisó desde la app que
  // vendió, tenga o no ya factura real cargada — refleja el ritmo de venta
  // en la calle, no el de facturación (que a veces queda atrasado unos
  // días). Se agrupa por el día en que se reportó (createdAt), solo bicis.
  // Se suman también las bicis de COT (cotización): no son venta reportada
  // desde la app, pero documentan una venta real igual (ej. venta en B) —
  // si no se sumaran acá quedarían afuera de "Vendidas" sin aparecer en
  // ningún lado.
  const saleRequestsSnap = await db.collection("saleRequests").get();
  const reportadoPorDia = { ...cotizadoPorDia };
  saleRequestsSnap.forEach((d) => {
    const sr = d.data();
    if ((sr.category || "").toUpperCase() !== "BICICLETAS") return;
    const fecha = sr.createdAt?.toDate ? sr.createdAt.toDate().toISOString().slice(0, 10) : null;
    if (!fecha) return;
    reportadoPorDia[fecha] = (reportadoPorDia[fecha] || 0) + Number(sr.quantity || 0);
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const fechas = new Set([
    ...Object.keys(facturadoPorDia),
    ...Object.keys(cobradoPorDia),
    ...Object.keys(entregadoPorDia),
    ...Object.keys(reportadoPorDia),
    hoy,
  ]);

  const fechasArr = [...fechas];
  const CHUNK = 400;
  for (let i = 0; i < fechasArr.length; i += CHUNK) {
    const batch = db.batch();
    for (const fecha of fechasArr.slice(i, i + CHUNK)) {
      const ref = db.doc(`dailyBikeStats/${fecha}`);
      const data = {
        fecha,
        facturadoBicis: facturadoPorDia[fecha] || 0,
        cobradoBicis: cobradoPorDia[fecha] || 0,
        entregadoBicis: entregadoPorDia[fecha] || 0,
        reportadoBicis: reportadoPorDia[fecha] || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (fecha === hoy) data.consignadoBicis = consignadoHoy;
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
  }

  return { dias: fechasArr.length, consignadoHoy };
}

exports.syncDailyBikeStats = onSchedule(
  {
    schedule: "every day 07:00",
    timeZone: "America/Argentina/Buenos_Aires",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
  },
  async () => {
    try {
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncDailyBikeStats: pausado, salteando");
        return;
      }
      const result = await computeDailyBikeStats(admin.firestore(), CONTABILIUM_WEB_EMAIL.value(), CONTABILIUM_WEB_PASSWORD.value());
      console.log("[dailyBikeStats] sync ok:", result.dias, "días, consignado hoy:", result.consignadoHoy);
    } catch (err) {
      console.error("[dailyBikeStats] sync error:", err);
    }
  }
);

exports.triggerDailyBikeStatsSync = onRequest(
  { cors: false, timeoutSeconds: 300, memory: "512MiB", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const result = await computeDailyBikeStats(admin.firestore(), CONTABILIUM_WEB_EMAIL.value(), CONTABILIUM_WEB_PASSWORD.value());
      return res.json(result);
    } catch (err) {
      console.error("[dailyBikeStats] manual trigger error:", err);
      return res.status(500).json({ error: String(err) });
    }
  }
);

exports.getDailyBikeStats = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { limit } = req.body || {};
      const db = admin.firestore();
      let q = db.collection("dailyBikeStats").orderBy("fecha", "desc");
      if (limit) q = q.limit(Number(limit));
      const snap = await q.get();
      const items = snap.docs.map((d) => d.data());
      return res.json({ items });
    } catch (err) {
      console.error("[dailyBikeStats] getDailyBikeStats error:", err);
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
      // El ID real de Contabilium del destinatario — para poder cruzar
      // remito↔factura↔cobranza por número, no por nombre de texto (que
      // Contabilium a veces escribe distinto entre un lado y el otro,
      // ej. "GRASSELLI" en la factura vs "GRASSELLI WALTER" en el remito).
      idPersona: r.idPersona ?? null,
      bicis,
      esInterno,
      numero: r.numero,
      // Los remitos FEPA→FEPA (movimientos internos entre depósitos
      // propios) se cargaron durante mucho tiempo sin poner el depósito/
      // distribuidor real en ningún campo estructurado — quedó anotado a
      // mano en la observación (ej. "retira bicis julian... lleva a
      // lavalle"). La guardamos para poder mostrarla en vez de un genérico
      // "FEPA TOP (interno)" sin info.
      observaciones: r.observaciones || null,
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

// Trae los remitos en vivo desde la web de Contabilium (paginando +
// detalle de cada uno) y los procesa con la misma lógica que el import
// manual — pensado para reemplazarlo en el uso normal del día a día. El
// import manual (exports.importarRemitos) queda como respaldo por si esta
// vía se cae (sesión vencida, cambios en el sitio, etc).
exports.sincronizarRemitosDesdeWeb = onRequest(
  { cors: false, invoker: "public", secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD], timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { desde, hasta } = req.body || {};
      const { listarRemitosCompletos } = require("./contabiliumWebAutomation");
      const remitos = await listarRemitosCompletos({
        db: admin.firestore(),
        email: CONTABILIUM_WEB_EMAIL.value(),
        password: CONTABILIUM_WEB_PASSWORD.value(),
        fechaDesde: desde || "",
        fechaHasta: hasta || "",
      });
      if (remitos.length === 0) {
        return res.json({ nuevos: 0, actualizados: 0, total: 0, traidos: 0, aviso: "Contabilium no devolvió remitos para ese rango" });
      }
      const result = await importarRemitosDetalle(admin.firestore(), remitos);
      return res.json({ ...result, traidos: remitos.length });
    } catch (err) {
      console.error("[sincronizarRemitosDesdeWeb] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

exports.syncRemitosDesdeWeb = onSchedule(
  {
    schedule: "every 2 hours",
    secrets: [CONTABILIUM_WEB_EMAIL, CONTABILIUM_WEB_PASSWORD],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      const db = admin.firestore();
      if (await syncsContabiliumPausados(db)) {
        console.log("[contabilium] syncRemitosDesdeWeb: pausado, salteando");
        return;
      }
      const { listarRemitosCompletos } = require("./contabiliumWebAutomation");
      // Ventana amplia (4 meses) para no perder ediciones tardías de
      // remitos viejos (ej. alguien completa la observación después), sin
      // tener que traer la base histórica entera en cada corrida.
      const desdeDate = new Date();
      desdeDate.setMonth(desdeDate.getMonth() - 4);
      const fechaDesde = desdeDate.toISOString().slice(0, 10);
      const remitos = await listarRemitosCompletos({ db, email: CONTABILIUM_WEB_EMAIL.value(), password: CONTABILIUM_WEB_PASSWORD.value(), fechaDesde, fechaHasta: "" });
      const result = await importarRemitosDetalle(db, remitos);
      console.log("[syncRemitosDesdeWeb] ok:", JSON.stringify(result));
    } catch (err) {
      console.error("[syncRemitosDesdeWeb] error:", err);
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
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncClientesReport: pausado, salteando");
        return;
      }
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

// Los 3 depósitos propios de FEPA — siempre son el código 1, 2 y 3 (en ese
// orden). El resto (distribuidores/clientes) recibe 4, 5, 6... en el orden
// en que se detectaron por primera vez, y ese código queda fijo para
// siempre aunque se vuelva a correr la sincronización: un depósito nuevo
// solo suma un número al final, nunca reordena a los que ya tenían uno.
const FEPA_DEPOSITOS_ID = [135151, 133531, 131151]; // Lavalle, Depósito Cañuelas, CREDIFIN

async function computeDepositosSync(email, apiKey) {
  const depositosNuevos = await getDepositosViaStockBySKU(email, apiKey, SKU_REFERENCIA_DEPOSITOS);

  if (depositosNuevos.length < MIN_DEPOSITOS_ESPERADOS) {
    throw new Error(
      `Solo se recibieron ${depositosNuevos.length} depósitos (se esperaban al menos ${MIN_DEPOSITOS_ESPERADOS}). No se actualizó la lista guardada, por seguridad.`
    );
  }

  const docRef = admin.firestore().doc("internalData/contabiliumDepositos");
  const prevSnap = await docRef.get();
  const previos = prevSnap.exists ? prevSnap.data().depositos || [] : [];
  const codigoPorId = new Map(previos.filter((d) => d.codigo != null).map((d) => [d.id, d.codigo]));

  FEPA_DEPOSITOS_ID.forEach((id, i) => codigoPorId.set(id, i + 1));

  let siguienteCodigo = codigoPorId.size ? Math.max(...codigoPorId.values()) : 3;
  const depositos = [...depositosNuevos]
    .sort((a, b) => a.id - b.id)
    .map((d) => {
      let codigo = codigoPorId.get(d.id);
      if (codigo == null) {
        siguienteCodigo += 1;
        codigo = siguienteCodigo;
        codigoPorId.set(d.id, codigo);
      }
      return { ...d, codigo };
    })
    .sort((a, b) => a.codigo - b.codigo);

  await docRef.set({
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
      if (await syncsContabiliumPausados(admin.firestore())) {
        console.log("[contabilium] syncContabiliumDepositos: pausado, salteando");
        return;
      }
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
// Manda un mail de prueba cualquiera, a cualquier dirección — para probar
// rápido que Resend sigue andando sin tener que disparar un flujo real.
exports.sendTestEmail = onRequest(
  { cors: false, invoker: "public", secrets: [RESEND_API_KEY] },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { to, subject, html } = req.body || {};
      if (!to) return res.status(400).json({ error: "Falta 'to'" });
      const result = await sendEmail(RESEND_API_KEY.value(), {
        to,
        subject: subject || "Samurai Bicis — Mensaje de prueba",
        html: html || `<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background:#0f172a; padding: 24px 28px; border-radius: 12px 12px 0 0;">
            <h1 style="color:#fff; font-size: 22px; margin:0;">Samurai Bicis</h1>
          </div>
          <div style="border:1px solid #e2e8f0; border-top:none; padding: 28px; border-radius: 0 0 12px 12px;">
            <h2 style="color:#0f172a; font-size:20px;">👋 Bienvenido a Samurai</h2>
          </div>
        </div>`,
      });
      return res.json({ ok: true, result });
    } catch (err) {
      console.error("[sendTestEmail] error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

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

// ─────────────────────────────────────────────────────────────
// Open Galicia (Banco Galicia) — ambiente QA/Homologación. Consulta de
// Saldos y Movimientos de Cuenta, vía autenticación JWT + Mutual SSL,
// siguiendo la documentación oficial provista por el banco.
// ─────────────────────────────────────────────────────────────

const GALICIA_SECRETS = [
  GALICIA_APP_ID,
  GALICIA_APP_KEY,
  GALICIA_ENTERPRISE_ID,
  GALICIA_AUTH_PASSWORD,
  GALICIA_QA_CERT_PEM,
  GALICIA_QA_KEY_PEM,
  GALICIA_QA_KEY_PASSPHRASE,
];

function galiciaMtlsCreds() {
  return {
    certPem: GALICIA_QA_CERT_PEM.value(),
    keyPem: GALICIA_QA_KEY_PEM.value(),
    keyPassphrase: GALICIA_QA_KEY_PASSPHRASE.value(),
  };
}

async function authGaliciaQA() {
  return getGaliciaTokenQA({
    appId: GALICIA_APP_ID.value(),
    appKey: GALICIA_APP_KEY.value(),
    enterpriseId: GALICIA_ENTERPRISE_ID.value(),
    authorizationPassword: GALICIA_AUTH_PASSWORD.value(),
    ...galiciaMtlsCreds(),
  });
}

// Saldos de todas las cuentas de la empresa en Galicia.
exports.getGaliciaSaldos = onRequest({ cors: false, secrets: GALICIA_SECRETS, timeoutSeconds: 60 }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  const staffUid = await requireStaff(req, res);
  if (!staffUid) return;
  try {
    const { accessToken } = await authGaliciaQA();
    const saldos = await getSaldosGaliciaQA({
      appId: GALICIA_APP_ID.value(),
      appKey: GALICIA_APP_KEY.value(),
      accessToken,
      ...galiciaMtlsCreds(),
    });
    return res.json(saldos);
  } catch (err) {
    console.error("[galicia] getGaliciaSaldos error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// Paso 1: pide el extracto de movimientos de una cuenta para un rango de
// fechas. Devuelve un id — el extracto queda "PENDING" hasta que Galicia lo
// procesa (corre cada ~30 min), después hay que consultar
// descargarGaliciaMovimientos con ese mismo id.
exports.solicitarGaliciaMovimientos = onRequest({ cors: false, secrets: GALICIA_SECRETS, timeoutSeconds: 60 }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const staffUid = await requireStaff(req, res);
  if (!staffUid) return;
  try {
    const { accountNumber, startDate, endDate } = req.body || {};
    if (!accountNumber || !startDate || !endDate) {
      return res.status(400).json({ error: "accountNumber, startDate y endDate son requeridos" });
    }
    const { accessToken } = await authGaliciaQA();
    const data = await solicitarExtractoGaliciaQA({
      appId: GALICIA_APP_ID.value(),
      appKey: GALICIA_APP_KEY.value(),
      accessToken,
      accountNumber,
      startDate,
      endDate,
      ...galiciaMtlsCreds(),
    });
    return res.json(data);
  } catch (err) {
    console.error("[galicia] solicitarGaliciaMovimientos error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// Pasos 2 y 3: chequea si un extracto ya está PROCESSED y, si lo está, lo
// descarga completo (siguiendo la paginación) y lo devuelve ya parseado
// como array de movimientos. Si todavía está PENDING, devuelve status
// "PENDING" sin descargar nada — hay que reintentar más tarde.
exports.descargarGaliciaMovimientos = onRequest({ cors: false, secrets: GALICIA_SECRETS, timeoutSeconds: 120 }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const staffUid = await requireStaff(req, res);
  if (!staffUid) return;
  try {
    const { extractoId } = req.body || {};
    if (!extractoId) return res.status(400).json({ error: "extractoId requerido" });

    const { accessToken } = await authGaliciaQA();
    const appId = GALICIA_APP_ID.value();
    const appKey = GALICIA_APP_KEY.value();
    const mtls = galiciaMtlsCreds();

    const extractos = await validarExtractosGaliciaQA({ appId, appKey, accessToken, ...mtls });
    const extracto = extractos.find((e) => e.id === extractoId);
    if (!extracto) return res.status(404).json({ error: "No se encontró ese extracto" });
    if (extracto.status !== "PROCESSED") {
      return res.json({ status: extracto.status, movimientos: null });
    }

    let allMovimientos = [];
    let csvHeader = null;
    // El primer pedido (sin query param) trae la primera página; si viene
    // 206 (Partial Content) hay más — pero como este endpoint no admite
    // pedir "página siguiente" con un parámetro documentado más allá del id
    // base, solo consumimos la primera respuesta tal cual la documentación.
    const { csv } = await descargarExtractoGaliciaQA({ appId, appKey, accessToken, extractoId, ...mtls });
    const movimientos = parseCsvMovimientosGalicia(csv);
    allMovimientos = allMovimientos.concat(movimientos);
    csvHeader = csv.split("\n")[0] || null;

    return res.json({ status: "PROCESSED", header: csvHeader, movimientos: allMovimientos });
  } catch (err) {
    console.error("[galicia] descargarGaliciaMovimientos error:", err);
    return res.status(500).json({ error: String(err) });
  }
});


// Cuenta corriente real de FEPA TOP en Credifin (la logística que nos
// factura los envíos) — Credifin no tiene API pública para partners, se
// reversó su portal de autogestión (ver credifinWebAutomation.js: login
// Auth0 con Puppeteer, cacheado, y de ahí en más fetch directo con el
// token). `desde`/`hasta` en formato YYYY-MM-DD.
exports.credifinGetCtaCte = onRequest(
  { cors: false, secrets: [CREDIFIN_EMAIL, CREDIFIN_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { desde, hasta } = req.body || {};
      if (!desde || !hasta) return res.status(400).json({ error: "Faltan desde/hasta (YYYY-MM-DD)" });
      const { getCtaCteCredifin } = require("./credifinWebAutomation");
      const reporte = await getCtaCteCredifin(admin.firestore(), CREDIFIN_EMAIL.value(), CREDIFIN_PASSWORD.value(), { desde, hasta });
      return res.json({ reporte });
    } catch (err) {
      console.error("[credifin] credifinGetCtaCte error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

// PDF real de un comprobante puntual de Credifin — `comprobantesId` es el
// campo `NroAuxiliar` que trae cada fila de credifinGetCtaCte. Funciona
// aunque la cuenta no tenga habilitada la sección "Comprobantes" (son
// permisos separados, confirmado por captura real).
exports.credifinGetComprobantePdf = onRequest(
  { cors: false, secrets: [CREDIFIN_EMAIL, CREDIFIN_PASSWORD], timeoutSeconds: 120, memory: "1GiB" },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const staffUid = await requireStaff(req, res);
    if (!staffUid) return;
    try {
      const { comprobantesId } = req.body || {};
      if (!comprobantesId) return res.status(400).json({ error: "Falta comprobantesId" });
      const { getComprobantePdfCredifin } = require("./credifinWebAutomation");
      const pdfBase64 = await getComprobantePdfCredifin(admin.firestore(), CREDIFIN_EMAIL.value(), CREDIFIN_PASSWORD.value(), Number(comprobantesId));
      return res.json({ pdfBase64 });
    } catch (err) {
      console.error("[credifin] credifinGetComprobantePdf error:", err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);
