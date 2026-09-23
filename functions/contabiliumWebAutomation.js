// functions/contabiliumWebAutomation.js
// Contabilium no tiene API pública para ajustar/transferir stock — solo lo
// permite desde su consola web ("Modificación de stock"), que arma la
// sesión con cookies (ASP.NET_SessionId + Secure-1CBL) por un mecanismo no
// documentado que no se pudo replicar a mano con requests sueltos. En vez
// de adivinarlo, usamos un navegador headless (Puppeteer) que hace login
// como lo haría una persona real — así el propio sitio arma la cookie solo,
// sin que nosotros tengamos que entender el mecanismo interno — y de ahí en
// más usamos los dos pedidos que sí reverse-engineamos (agregarItem +
// ModificarStock) con esa cookie.
const puppeteer = require("puppeteer-core");
// @sparticuz/chromium se distribuye como ESM compilado — bajo require()
// el objeto real queda en `.default`, no en el módulo raíz.
const chromium = require("@sparticuz/chromium").default;

// Todo remito que genera la app es de mercadería que sigue siendo de
// Samurai (consignada al distribuidor, no vendida) — tiene que decir esto
// en la observación siempre, sin importar la nota que haya escrito quien
// hizo el movimiento.
const MERCADERIA_CONSIGNACION = "MERCADERIA EN CONSIGNACION";

function conMercaderiaConsignacion(texto) {
  if (!texto) return MERCADERIA_CONSIGNACION;
  if (texto.includes(MERCADERIA_CONSIGNACION)) return texto;
  return `${MERCADERIA_CONSIGNACION} — ${texto}`;
}

const BASE = "https://app.contabilium.com";
const STOCK_PAGE = `${BASE}/modulos/inventarios/modificacionStock.aspx`;
const TRANSFER_PAGE = `${BASE}/modulos/inventarios/movimientosDeStocke.aspx`;
const COOKIE_DOC = "meta/contabiliumWebSession";
// La sesión dura ~20hs en el sitio real; la reusamos con margen antes de
// volver a pagar el costo de abrir un navegador entero.
const COOKIE_TTL_MS = 18 * 60 * 60 * 1000;

async function loginYSacarCookie(email, password) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    );
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });

    // El campo de mail no usa type="email" — es un input de texto con
    // placeholder "Email", el sitio lo valida solo con JS. El de contraseña
    // sí es un type="password" real (confirmado por captura de la pantalla).
    const emailSelector = 'input[placeholder*="mail" i]';
    const passSelector = 'input[type="password"]';
    try {
      await page.waitForSelector(emailSelector, { timeout: 45000 });
    } catch (waitErr) {
      const url = page.url();
      const title = await page.title().catch(() => "?");
      const bodySnippet = await page
        .evaluate(() => document.body?.innerText?.slice(0, 400) || "")
        .catch(() => "");
      throw new Error(
        `No apareció el campo de email (url=${url}, title="${title}"). Extracto de la página: ${bodySnippet.replace(/\s+/g, " ")}`
      );
    }
    await page.type(emailSelector, email, { delay: 20 });
    await page.type(passSelector, password, { delay: 20 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}),
      page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const ingresar = btns.find((b) => /ingresar/i.test(b.textContent || ""));
        if (ingresar) ingresar.click();
      }),
    ]);

    if (/\/login/i.test(page.url())) {
      const bodySnippet = await page
        .evaluate(() => document.body?.innerText?.slice(0, 400) || "")
        .catch(() => "");
      throw new Error(
        `El login no avanzó, seguimos en ${page.url()}. Extracto: ${bodySnippet.replace(/\s+/g, " ")}`
      );
    }

    // La cookie de sesión vieja (ASP.NET_SessionId / Secure-1CBL) se arma
    // recién cuando el navegador visita una pantalla del módulo clásico —
    // por eso navegamos ahí antes de leer las cookies.
    await page.goto(STOCK_PAGE, { waitUntil: "networkidle2", timeout: 60000 });

    const cookies = await page.cookies();
    const relevantes = cookies.filter((c) =>
      ["ASP.NET_SessionId", "Secure-1CBL"].includes(c.name)
    );
    if (!relevantes.some((c) => c.name === "Secure-1CBL")) {
      throw new Error("No se pudo obtener la cookie de sesión — ¿falló el login?");
    }
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    return cookieHeader;
  } finally {
    await browser.close();
  }
}

// Cookie cacheada en Firestore para no abrir un navegador en cada ajuste —
// se reusa mientras no venza.
async function getCookieValida(db, email, password) {
  const ref = db.doc(COOKIE_DOC);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;
  if (data?.cookie && data?.expiresAt && data.expiresAt.toMillis() > Date.now()) {
    return data.cookie;
  }
  const cookie = await loginYSacarCookie(email, password);
  await ref.set({
    cookie,
    expiresAt: require("firebase-admin").firestore.Timestamp.fromMillis(Date.now() + COOKIE_TTL_MS),
    updatedAt: require("firebase-admin").firestore.FieldValue.serverTimestamp(),
  });
  return cookie;
}

// Invalida la cookie cacheada (por si un pedido falla por sesión vencida
// antes de tiempo) para forzar un login nuevo en el próximo intento.
async function invalidarCookie(db) {
  await db.doc(COOKIE_DOC).delete().catch(() => {});
}

function headersWeb(cookie, pagina) {
  return {
    "Content-Type": "application/json; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Origin: BASE,
    Referer: pagina,
    Cookie: cookie,
  };
}

async function postWebMethod(cookie, metodo, body, pagina = STOCK_PAGE) {
  const res = await fetch(`${pagina}/${metodo}`, {
    method: "POST",
    headers: headersWeb(cookie, pagina),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Si Contabilium devuelve HTML (típico de una sesión vencida
    // redirigiendo al login), no es JSON — lo tratamos como sesión inválida.
  }
  if (!res.ok || json === null) {
    throw new Error(`Contabilium (${metodo}) respondió ${res.status}: ${text.slice(0, 300)}`);
  }
  return json.d;
}

// Ajuste manual de stock — dos pasos confirmados por captura real del sitio:
// 1) agregarItem: carga el producto+cantidad en el "carrito" de la sesión.
// 2) ModificarStock: confirma el ajuste sobre ese depósito.
async function ajustarStockWeb({ db, email, password, idConcepto, idInventario, cantidad, tipoModificacion, idCC, nroRef, observaciones }) {
  let cookie = await getCookieValida(db, email, password);

  const intentar = async () => {
    await postWebMethod(cookie, "agregarItem", {
      idConcepto,
      idInventario,
      cantidad: String(cantidad),
      tipoModificacion, // 'R' = Reemplazar, 'M' = Modificar (sumar/restar)
      valorIngresado: 0,
    });
    // idCC es un "value type" del lado de Contabilium (probablemente int) —
    // mandar null tira 500 ("Cannot convert null to a value type"). Si no
    // nos pasaron uno, directamente omitimos la clave del JSON.
    const modificarBody = {
      idInventario,
      nroRef: nroRef || "",
      observaciones: observaciones || "",
      crearAsiento: false,
    };
    if (idCC != null) modificarBody.idCC = idCC;
    await postWebMethod(cookie, "ModificarStock", modificarBody);
  };

  try {
    await intentar();
  } catch (err) {
    // Reintenta una vez con una sesión nueva por si la cacheada venció
    // antes de lo esperado.
    console.warn("[contabiliumWebAutomation] primer intento falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    await intentar();
  }
}

// Transferencia real entre depósitos — a diferencia del ajuste manual, NO
// pide idCC. Pasos confirmados por captura real: limpiarItems (por si quedó
// algo de un intento anterior a medio hacer), agregarItem (carga el
// producto+cantidad desde el depósito origen), TransferirStock (confirma el
// movimiento — devuelve idTransferencia) y GenerarRemitoDesdeTransferencia
// (genera el remito de esa transferencia, con ese mismo id — vive en
// /api/remitos, no en el módulo clásico .aspx).
function apiHeadersFactory(cookie, extra = {}) {
  return {
    Accept: "application/json, text/plain, */*",
    Origin: BASE,
    Referer: TRANSFER_PAGE,
    Cookie: cookie,
    ...extra,
  };
}

// Busca el id interno de un remito por su número visible (ej:
// "0001-00000543") — la lista de remitos recientes es la única forma de
// mapear número -> id, no hay un endpoint que lo resuelva directo.
async function buscarIdRemitoPorNumero(cookie, numero) {
  const res = await fetch(`${BASE}/api/remitos/ObtenerRemitos`, {
    method: "POST",
    headers: apiHeadersFactory(cookie, { "Content-Type": "application/json;charset=UTF-8" }),
    body: JSON.stringify({ condicion: "", periodo: "30", fechaDesde: "", fechaHasta: "", page: 1, pageSize: 50 }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const lista = json?.data || json?.items || json?.remitos || (Array.isArray(json) ? json : []);
  const match = lista.find((r) => r.numero === numero);
  return match?.id ?? null;
}

// Agrega una observación a un remito ya generado — Contabilium no deja
// editar el movimiento de depósito en sí, pero sí el remito.
async function actualizarObservacionRemito(cookie, idRemito, textoObservacion) {
  const getRes = await fetch(`${BASE}/api/remitos/ObtenerRemito?idRemito=${idRemito}`, {
    method: "GET",
    headers: apiHeadersFactory(cookie),
  });
  if (!getRes.ok) return;
  const remito = await getRes.json();
  remito.observaciones = textoObservacion;
  await fetch(`${BASE}/api/remitos/GuardarRemito`, {
    method: "POST",
    headers: apiHeadersFactory(cookie, { "Content-Type": "application/json;charset=UTF-8" }),
    body: JSON.stringify(remito),
  });
}

// Reasigna el cliente ("proveedor") de un remito ya generado por
// generarRemitoAutoDesdeTransferencia (nace a nombre de FEPA TOP, la propia
// empresa) y regenera su PDF con los datos nuevos — así se reusa el remito
// interno que YA quedó bien numerado por la consola clásica, en vez de
// crear un comprobante nuevo vía la API REST oficial (probado: esos quedan
// con "Numero": "0001-00000000", sin numerar de verdad, y nunca se les
// puede bajar el PDF). El campo real del cliente en el JSON de Contabilium
// es "idPersona" (confirmado contra la API real, sept 2026), no "idCliente".
async function asignarProveedorARemito({ db, email, password, remitoArchivo, proveedorContabiliumId, observaciones }) {
  const numeroMatch = remitoArchivo && /(\d{4}-\d{8})/.exec(remitoArchivo);
  if (!numeroMatch) return { remitoArchivo: null, remitoPdfBase64: null, numero: null };

  const cookie = await getCookieValida(db, email, password);
  const idRemito = await buscarIdRemitoPorNumero(cookie, numeroMatch[1]);
  if (!idRemito) return { remitoArchivo: null, remitoPdfBase64: null, numero: numeroMatch[1] };

  const getRes = await fetch(`${BASE}/api/remitos/ObtenerRemito?idRemito=${idRemito}`, {
    method: "GET",
    headers: apiHeadersFactory(cookie),
  });
  if (!getRes.ok) return { remitoArchivo: null, remitoPdfBase64: null, numero: numeroMatch[1] };
  const remito = await getRes.json();
  remito.idPersona = Number(proveedorContabiliumId);
  remito.observaciones = conMercaderiaConsignacion(observaciones || remito.observaciones);
  await fetch(`${BASE}/api/remitos/GuardarRemito`, {
    method: "POST",
    headers: apiHeadersFactory(cookie, { "Content-Type": "application/json;charset=UTF-8" }),
    body: JSON.stringify(remito),
  });

  // El PDF hay que regenerarlo DESPUÉS de guardar el cambio de cliente, si
  // no queda con los datos viejos (FEPA TOP) aunque el remito ya esté
  // actualizado.
  const archivo = await generarArchivoRemitoPorId(cookie, idRemito);
  if (!archivo) return { remitoArchivo: null, remitoPdfBase64: null, numero: numeroMatch[1] };
  const remitoPdfBase64 = await bajarPdfPorNombreArchivo(cookie, archivo);
  return { remitoArchivo: remitoPdfBase64 ? archivo : null, remitoPdfBase64, numero: numeroMatch[1] };
}

// Baja el PDF ya generado de un remito por su nombre de archivo — URL
// confirmada capturando el pedido real que hace la propia consola de
// Contabilium al descargar un remito (DevTools → Network): el path es en
// la raíz, sin mayúsculas ni subcarpeta, y necesita el query param
// "tipoDeArchivo=remito" o Contabilium no devuelve el PDF.
async function bajarPdfPorNombreArchivo(cookie, archivo) {
  const url = `${BASE}/pdfGenerator.ashx?file=${encodeURIComponent(archivo)}&tipoDeArchivo=remito`;
  try {
    const res = await fetch(url, { headers: apiHeadersFactory(cookie, { Accept: "application/pdf,*/*" }) });
    const contentType = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    // No confiar solo en el Content-Type — Contabilium a veces lo devuelve
    // como application/octet-stream (o sin header) para el mismo PDF real.
    // La firma real de un PDF ("%PDF-" al principio del archivo) es lo único
    // confiable; si no está, es una página de error/login disfrazada de
    // descarga (sesión vencida, archivo no encontrado, etc.).
    const esPdfReal = res.ok && buf.length > 4 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
    if (esPdfReal) {
      return buf.toString("base64");
    }
    const preview = buf.subarray(0, 300).toString("utf8").replace(/\s+/g, " ").trim();
    console.warn(
      `[contabiliumWebAutomation] pdfGenerator no devolvió un PDF real para ${archivo}: status=${res.status} contentType=${contentType} bytes=${buf.length} preview="${preview}"`
    );
  } catch (e) {
    console.warn(`[contabiliumWebAutomation] pdfGenerator falló para ${archivo}:`, e.message);
  }
  return null;
}

// Genera el remito automático "de toda la vida" a partir de una
// transferencia ya hecha (GenerarRemitoDesdeTransferencia) y le baja el PDF.
// Se usa como respaldo cuando no hay remito personalizado (sin cliente
// detectado, o Contabilium lo rechazó) para no dejar a nadie sin remito.
async function generarRemitoAutoDesdeTransferencia({ db, email, password, idTransferencia, observaciones, depositoOrigenNombre, depositoDestinoNombre, idInventarioOrigen, idInventarioDestino }) {
  let cookie = await getCookieValida(db, email, password);

  const intentar = async () => {
    let remitoArchivo = null;
    const res = await fetch(`${BASE}/api/remitos/GenerarRemitoDesdeTransferencia?idTransferencia=${idTransferencia}`, {
      method: "POST",
      headers: apiHeadersFactory(cookie),
    });
    if (res.ok) {
      const text = await res.text();
      remitoArchivo = text.replace(/^"|"$/g, ""); // viene entre comillas, es un string JSON plano
    }

    const remitoPdfBase64 = remitoArchivo ? await bajarPdfPorNombreArchivo(cookie, remitoArchivo) : null;

    // El nombre del archivo trae el número visible del remito embebido, ej:
    // "FEPA_TOP_RP-0001-00000543.pdf" -> "0001-00000543".
    const numeroMatch = remitoArchivo && /(\d{4}-\d{8})/.exec(remitoArchivo);
    if (numeroMatch) {
      const idRemito = await buscarIdRemitoPorNumero(cookie, numeroMatch[1]);
      if (idRemito) {
        const direccion = `Transferencia: ${depositoOrigenNombre || idInventarioOrigen} → ${depositoDestinoNombre || idInventarioDestino}`;
        const texto = conMercaderiaConsignacion(observaciones || direccion);
        await actualizarObservacionRemito(cookie, idRemito, texto).catch((e) =>
          console.warn("[contabiliumWebAutomation] no se pudo actualizar observación del remito:", e.message)
        );
      }
    }

    return { remitoArchivo, remitoPdfBase64 };
  };

  try {
    return await intentar();
  } catch (err) {
    console.warn("[contabiliumWebAutomation] generación de remito automático falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    return await intentar();
  }
}

// El número que devuelve crearComprobante puede venir sin el formato visible
// "0001-00000543" (a veces solo el entero, ej. 543) — lo normalizamos contra
// ese formato, que es el que usa Contabilium en pantalla, asumiendo el mismo
// punto de venta 0001.
function normalizarNumeroRemito(numero) {
  const str = String(numero || "").trim();
  if (/^\d{4}-\d{8}$/.test(str)) return str;
  const soloDigitos = str.replace(/\D/g, "");
  if (!soloDigitos) return null;
  return `0001-${soloDigitos.padStart(8, "0")}`;
}

// Le pide a Contabilium que genere el archivo de un remito por su id interno
// — endpoint confirmado capturando el pedido real que hace la propia
// consola al apretar "Descargar Remito" (DevTools → Network:
// POST /api/remitos/GenerarFile?idRemito=X devuelve el nombre de archivo
// entre comillas, ej. "FEPA_TOP_RP-0001-00000550.pdf").
async function generarArchivoRemitoPorId(cookie, idRemito) {
  const res = await fetch(`${BASE}/api/remitos/GenerarFile?idRemito=${idRemito}`, {
    method: "POST",
    headers: apiHeadersFactory(cookie),
  });
  if (!res.ok) return null;
  const text = await res.text();
  return text.replace(/^"|"$/g, "").trim() || null;
}

// Baja el PDF real de un remito que ya existe como comprobante (creado vía
// crearComprobante REST, tipoFc REM) — lo busca por número, le pide a
// Contabilium que genere su archivo (GenerarFile) y baja ese PDF con la URL
// real del generador de reportes.
async function obtenerPdfRemitoPorNumero({ db, email, password, numero }) {
  const cookie = await getCookieValida(db, email, password);
  const numeroNormalizado = normalizarNumeroRemito(numero);
  if (!numeroNormalizado) return { remitoArchivo: null, remitoPdfBase64: null };

  const idRemito = await buscarIdRemitoPorNumero(cookie, numeroNormalizado);
  if (!idRemito) return { remitoArchivo: null, remitoPdfBase64: null };

  const archivo = await generarArchivoRemitoPorId(cookie, idRemito);
  if (!archivo) return { remitoArchivo: null, remitoPdfBase64: null };

  const remitoPdfBase64 = await bajarPdfPorNombreArchivo(cookie, archivo);
  return { remitoArchivo: remitoPdfBase64 ? archivo : null, remitoPdfBase64 };
}

async function transferirStockWeb({
  db,
  email,
  password,
  items, // [{ idConcepto, cantidad }, ...] — uno o varios productos en el mismo remito
  idInventarioOrigen,
  idInventarioDestino,
  observaciones,
  depositoOrigenNombre,
  depositoDestinoNombre,
}) {
  let cookie = await getCookieValida(db, email, password);

  const intentar = async () => {
    await postWebMethod(cookie, "limpiarItems", {}, TRANSFER_PAGE).catch(() => {});
    for (const item of items) {
      await postWebMethod(
        cookie,
        "agregarItem",
        { idConcepto: item.idConcepto, idInventario: idInventarioOrigen, cantidad: String(item.cantidad) },
        TRANSFER_PAGE
      );
    }

    // El movimiento de depósito siempre queda anotado con la dirección real
    // (origen → destino), sumando la nota del usuario si escribió una — así
    // el movimiento se entiende solo en Contabilium sin depender del remito.
    const direccion = `${depositoOrigenNombre || idInventarioOrigen} → ${depositoDestinoNombre || idInventarioDestino}`;
    const textoObservaciones = observaciones ? `Transferencia: ${direccion} — ${observaciones}` : `Transferencia: ${direccion}`;

    const resultado = await postWebMethod(
      cookie,
      "TransferirStock",
      { idInventarioOrigen, idInventarioDestino, observaciones: textoObservaciones },
      TRANSFER_PAGE
    );
    const idTransferencia = resultado?.idTransferencia ?? resultado;

    return { idTransferencia };
  };

  try {
    return await intentar();
  } catch (err) {
    console.warn("[contabiliumWebAutomation] transferencia falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    return await intentar();
  }
}

// Investigación puntual: prueba varios nombres de método candidatos en las
// dos páginas clásicas de inventario, para ver si alguno devuelve el idCC
// de un depósito sin que haga falta capturarlo a mano con DevTools.
async function probarCandidatosIdCC({ db, email, password, idInventario }) {
  const cookie = await getCookieValida(db, email, password);
  const paginas = [
    `${BASE}/modulos/inventarios/modificacionStock.aspx`,
    `${BASE}/modulos/inventarios/movimientosDeStocke.aspx`,
  ];
  const metodos = [
    "cantidadItems",
    "obtenerCC",
    "ObtenerCC",
    "obtenerCuentaCorriente",
    "ObtenerCuentaCorriente",
    "obtenerIdCC",
    "ObtenerIdCC",
    "obtenerDatosDeposito",
    "ObtenerDatosDeposito",
    "obtenerDeposito",
    "ObtenerDeposito",
    "obtenerInventario",
    "ObtenerInventario",
    "getCC",
    "obtenerInfoDeposito",
  ];
  const payloadsAProbar = [{}, { idInventario }, { idDeposito: idInventario }, { id: idInventario }];

  const resultados = [];
  for (const pagina of paginas) {
    for (const metodo of metodos) {
      for (const payload of payloadsAProbar) {
        try {
          const res = await fetch(`${pagina}/${metodo}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Accept: "application/json, text/javascript, */*; q=0.01",
              Origin: BASE,
              Referer: pagina,
              Cookie: cookie,
            },
            body: JSON.stringify(payload),
          });
          const text = await res.text();
          if (res.status === 404 || res.status === 500) continue; // método no existe o no aplica
          resultados.push({
            pagina: pagina.split("/").pop(),
            metodo,
            payload,
            status: res.status,
            body: text.slice(0, 500),
          });
        } catch (e) {
          // ignorar, seguimos probando el resto
        }
      }
    }
  }
  return resultados;
}

// Diagnóstico: trae el JSON crudo de un remito real (buscándolo por su
// número visible) para ver qué campos expone Contabilium de verdad — en vez
// de seguir adivinando la URL del PDF a ciegas. Si alguno de los campos es
// una URL al PDF, ahí queda confirmado sin prueba y error contra
// producción.
async function diagObtenerRemito({ db, email, password, numero }) {
  const cookie = await getCookieValida(db, email, password);
  const apiHeaders = (extra = {}) => ({
    Accept: "application/json, text/plain, */*",
    Origin: BASE,
    Referer: TRANSFER_PAGE,
    Cookie: cookie,
    ...extra,
  });

  const listRes = await fetch(`${BASE}/api/remitos/ObtenerRemitos`, {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json;charset=UTF-8" }),
    body: JSON.stringify({ condicion: "", periodo: "30", fechaDesde: "", fechaHasta: "", page: 1, pageSize: 50 }),
  });
  const listJson = listRes.ok ? await listRes.json() : null;
  const lista = listJson?.data || listJson?.items || listJson?.remitos || (Array.isArray(listJson) ? listJson : []);
  const match = lista.find((r) => r.numero === numero);
  if (!match) {
    return { encontrado: false, listaMuestra: lista.slice(0, 3) };
  }

  const getRes = await fetch(`${BASE}/api/remitos/ObtenerRemito?idRemito=${match.id}`, {
    method: "GET",
    headers: apiHeaders(),
  });
  const remito = getRes.ok ? await getRes.json() : { error: `status ${getRes.status}` };

  return { encontrado: true, filaEnListado: match, detalleCompleto: remito };
}

// Trae TODOS los remitos entre dos fechas (paginando) con su detalle
// completo (items, idPersona, observaciones) — reemplaza el flujo manual de
// bajar un JSON a mano desde la consola de Contabilium y subirlo acá.
// "periodo" en el listado es un preset del combo del sitio (7/15/30/etc);
// cuando se pasan fechaDesde/fechaHasta explícitas se manda vacío, que es
// como el propio sitio lo hace al elegir un rango custom.
async function listarRemitosCompletos({ db, email, password, fechaDesde, fechaHasta, onProgreso }) {
  const cookie = await getCookieValida(db, email, password);
  const apiHeaders = (extra = {}) => ({
    Accept: "application/json, text/plain, */*",
    Origin: BASE,
    Referer: TRANSFER_PAGE,
    Cookie: cookie,
    ...extra,
  });

  const filas = [];
  let page = 1;
  const pageSize = 100;
  while (true) {
    const res = await fetch(`${BASE}/api/remitos/ObtenerRemitos`, {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json;charset=UTF-8" }),
      body: JSON.stringify({ condicion: "", periodo: "", fechaDesde, fechaHasta, page, pageSize }),
    });
    if (!res.ok) throw new Error(`Contabilium (ObtenerRemitos) respondió ${res.status}`);
    const json = await res.json();
    const lista = json?.data || json?.items || json?.remitos || (Array.isArray(json) ? json : []);
    if (!lista.length) break;
    filas.push(...lista);
    if (onProgreso) onProgreso({ etapa: "listado", pagina: page, acumulado: filas.length });
    if (lista.length < pageSize) break;
    page += 1;
    if (page > 200) break; // resguardo — no debería hacer falta con rangos razonables
  }

  // Detalle de cada uno, con concurrencia acotada (Contabilium es un sitio
  // clásico ASP.NET, no pensado para ráfagas de pedidos en paralelo).
  const detalles = new Array(filas.length);
  const CONCURRENCIA = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < filas.length) {
      const i = cursor;
      cursor += 1;
      const fila = filas[i];
      try {
        const getRes = await fetch(`${BASE}/api/remitos/ObtenerRemito?idRemito=${fila.id}`, {
          method: "GET",
          headers: apiHeaders(),
        });
        detalles[i] = getRes.ok ? await getRes.json() : null;
      } catch {
        detalles[i] = null;
      }
      if (onProgreso && (i + 1) % 25 === 0) onProgreso({ etapa: "detalle", hechos: i + 1, total: filas.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, filas.length) }, worker));

  return filas.map((fila, i) => {
    const d = detalles[i];
    return {
      idRemito: fila.id,
      numero: fila.numero,
      razonSocialLista: fila.razonSocial,
      fecha: d?.fecha || null,
      idPersona: d?.idPersona ?? null,
      items: (d?.items || []).map((it) => ({ codigoConcepto: it.codigoConcepto, cantidad: it.cantidad })),
      observaciones: d?.observaciones || "",
    };
  });
}

// Diagnóstico: prueba nombres candidatos de webmethod en la página de
// movimientos de stock (movimientosDeStocke.aspx), buscando un listado con
// historial (idInventarioOrigen/idInventarioDestino reales) que sirva para
// completar los remitos internos cuya observación no alcanza para saber el
// destino real.
async function probarWebmethodsMovimientos({ db, email, password }) {
  const cookie = await getCookieValida(db, email, password);
  const apiHeaders = (extra = {}) => ({
    Accept: "application/json, text/plain, */*",
    Origin: BASE,
    Referer: TRANSFER_PAGE,
    Cookie: cookie,
    ...extra,
  });
  const candidatos = [
    "ObtenerMovimientos",
    "ObtenerMovimientosStock",
    "BuscarMovimientos",
    "ListarMovimientos",
    "ObtenerTransferencias",
    "BuscarTransferencias",
    "ObtenerHistorial",
    "ObtenerHistorialMovimientos",
    "GetMovimientos",
    "ObtenerMovimientosDeposito",
  ];
  const bodiesAProbar = [
    { page: 1, pageSize: 20 },
    { condicion: "", periodo: "30", fechaDesde: "", fechaHasta: "", page: 1, pageSize: 20 },
    {},
  ];
  const resultados = [];
  for (const metodo of candidatos) {
    for (const body of bodiesAProbar) {
      try {
        const res = await fetch(`${TRANSFER_PAGE}/${metodo}`, {
          method: "POST",
          headers: apiHeaders({ "Content-Type": "application/json;charset=UTF-8" }),
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let esJson = false;
        let muestra = text.slice(0, 300);
        try {
          JSON.parse(text);
          esJson = true;
        } catch {}
        if (res.ok && esJson) {
          resultados.push({ metodo, body, status: res.status, esJson, muestra });
          break; // ya encontramos un body que funciona para este método, no hace falta probar los otros
        }
      } catch (err) {
        // sigue con el próximo candidato
      }
    }
  }
  return resultados;
}

// Investigación puntual (solo lectura, no escribe nada): busca en el HTML
// de varias pantallas del sitio clásico algún link o referencia a un
// módulo de "depósitos" (para poder eventualmente renombrarlos), y en las
// páginas candidatas que encuentra, junta los nombres de webmethods que el
// propio HTML/JS menciona (patrón típico de ASP.NET: "Pagina.aspx/Metodo").
async function explorarModuloDepositos({ db, email, password }) {
  const cookie = await getCookieValida(db, email, password);

  const paginasBase = [
    `${BASE}/`,
    `${BASE}/modulos/home/home.aspx`,
    STOCK_PAGE,
    TRANSFER_PAGE,
    `${BASE}/modulos/inventarios/inventarios.aspx`,
    `${BASE}/modulos/seguridad/mis-datos.aspx`,
  ];

  const htmlsPorPagina = {};
  for (const url of paginasBase) {
    try {
      const res = await fetch(url, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } });
      htmlsPorPagina[url] = { status: res.status, html: await res.text() };
    } catch (e) {
      htmlsPorPagina[url] = { status: null, error: e.message };
    }
  }

  // 1) De cada HTML, sacar todos los .aspx mencionados (href, action, JS)
  // y quedarse con los que suenan a depósito/almacén/sucursal/config.
  const aspxRegex = /["'(]([^"'()]*?\/modulos\/[a-zA-Z0-9_\-\/]+\.aspx)/gi;
  const palabrasClave = /dep[oó]sit|almac[eé]n|sucursal|configuraci[oó]n|empresa|sede|stock|puntoDeVenta|puntosDeVenta|ubicaci[oó]n/i;
  const candidatos = new Set();
  const todosLosAspx = new Set();
  for (const [pagina, { html }] of Object.entries(htmlsPorPagina)) {
    if (!html) continue;
    let m;
    while ((m = aspxRegex.exec(html))) {
      const ruta = m[1];
      todosLosAspx.add(ruta);
      if (palabrasClave.test(ruta)) candidatos.add(ruta.startsWith("http") ? ruta : `${BASE}${ruta.startsWith("/") ? "" : "/"}${ruta}`);
    }
  }

  // 2) Además, buscar cualquier link de menú cuyo TEXTO visible mencione
  // depósito/almacén/sucursal (a veces el href es genérico tipo #, y el
  // menú arma la navegación por JS con un data-atributo).
  const linkConTextoRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]{0,60})<\/a>/gi;
  const menuCandidatos = new Set();
  const todosLosLinksDeTexto = new Set();
  for (const [pagina, { html }] of Object.entries(htmlsPorPagina)) {
    if (!html) continue;
    let m;
    while ((m = linkConTextoRegex.exec(html))) {
      const [, href, texto] = m;
      const textoLimpio = texto.trim();
      if (pagina === `${BASE}/` && textoLimpio) todosLosLinksDeTexto.add(`${textoLimpio} -> ${href}`);
      if (palabrasClave.test(texto)) menuCandidatos.add(`${textoLimpio} -> ${href}`);
    }
  }

  // 3) Para cada .aspx candidato encontrado, bajarlo y sacar los nombres de
  // webmethod que mencione (patrón "NombreDePagina.aspx/Metodo").
  // Las páginas base ya las tenemos bajadas (inventarios.aspx entre ellas,
  // que resultó ser el módulo real de "Depósitos - Administración") — no
  // hace falta pedirlas de nuevo, solo sacarles los webmethods también.
  const paginasCandidatas = [...new Set([...candidatos, ...paginasBase])];
  const webmethodsPorPagina = {};
  const jsFuncionesPorPagina = {};
  for (const url of paginasCandidatas.slice(0, 12)) {
    try {
      const html = htmlsPorPagina[url]?.html || (await (await fetch(url, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } })).text());
      const metodoRegex = /\.aspx\/([A-Za-z0-9_]+)/g;
      const metodos = new Set();
      let mm;
      while ((mm = metodoRegex.exec(html))) metodos.add(mm[1]);
      webmethodsPorPagina[url] = { metodos: [...metodos], largoHtml: html.length };

      // Funciones JS del objeto de la página (ej. "inventarios.nuevo",
      // "inventarios.editar") — ahí suele estar el nombre real del
      // webmethod que dispara guardar/editar un depósito.
      const jsFuncRegex = /\b([a-zA-Z]+)\.(editar|guardar|nuevo|eliminar|borrar|modificar|actualizar|save|edit|delete|update)\w*\s*[:=(]/gi;
      const jsFuncs = new Set();
      let jm;
      while ((jm = jsFuncRegex.exec(html))) jsFuncs.add(jm[0].replace(/[:=(]$/, ""));
      if (jsFuncs.size) jsFuncionesPorPagina[url] = [...jsFuncs];
    } catch (e) {
      webmethodsPorPagina[url] = { error: e.message };
    }
  }

  // 4) Escaneo de texto plano (no solo links) en cada página base — para
  // pescar cualquier mención de depósito/almacén/sucursal que esté en el
  // cuerpo de la página (un título, un tooltip, un <option>) y no en un
  // <a href>. Se guarda un fragmento de contexto alrededor de cada hit.
  const contextoPorPagina = {};
  for (const [pagina, { html }] of Object.entries(htmlsPorPagina)) {
    if (!html) continue;
    const textoPlano = html.replace(/\s+/g, " ");
    const hits = [];
    const buscador = /dep[oó]sit\w*|almac[eé]n\w*|sucursal\w*/gi;
    let mh;
    while ((mh = buscador.exec(textoPlano)) && hits.length < 15) {
      hits.push(textoPlano.slice(Math.max(0, mh.index - 60), mh.index + 60));
    }
    if (hits.length) contextoPorPagina[pagina] = hits;
  }

  // 5) inventarios.aspx tiene "inventarios.editar" pero el webmethod que
  // dispara no está inline en el HTML — vive en algún <script src="...">
  // propio de la página. Bajamos esos scripts y buscamos ahí el nombre
  // real del método (patrón ".aspx/Metodo") y el cuerpo de la función
  // "editar"/"guardar" para ver qué campos manda.
  const invHtml = htmlsPorPagina[`${BASE}/modulos/inventarios/inventarios.aspx`]?.html || "";
  const scriptSrcRegex = /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
  const scriptsPropios = [];
  let sm;
  while ((sm = scriptSrcRegex.exec(invHtml))) {
    const src = sm[1];
    if (/inventari/i.test(src)) scriptsPropios.push(src.startsWith("http") ? src : `${BASE}${src.startsWith("/") ? "" : "/"}${src}`);
  }
  const detalleScriptsInventarios = {};
  for (const src of scriptsPropios) {
    try {
      const res = await fetch(src, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } });
      const js = await res.text();
      const metodoRegex = /\.aspx\/([A-Za-z0-9_]+)/g;
      const metodos = new Set();
      let mm2;
      while ((mm2 = metodoRegex.exec(js))) metodos.add(mm2[1]);
      // Fragmento alrededor de "editar" y "guardar" del propio objeto
      // inventarios, para ver qué campos arma antes de mandarlos.
      const fragmentos = [];
      const funcRegex = /(editar|guardar|nuevo)\s*[:=]\s*function[^{]*\{/gi;
      let fm;
      while ((fm = funcRegex.exec(js))) {
        fragmentos.push(js.slice(fm.index, fm.index + 500));
      }
      detalleScriptsInventarios[src] = { largoJs: js.length, metodosAspx: [...metodos], fragmentosEditarGuardar: fragmentos };
    } catch (e) {
      detalleScriptsInventarios[src] = { error: e.message };
    }
  }

  // 6) "editar" no es un webmethod suelto, es una página de formulario
  // aparte (inventariose.aspx?ID=x). La cargamos SOLO CON GET (no se
  // manda nada, no se cambia nada) sobre nuestro propio depósito Lavalle,
  // para ver los campos del formulario y qué webmethod usa su botón
  // "Guardar" — sin tocar ningún dato real.
  let detalleFormularioEdicion = null;
  try {
    const idDePrueba = 135151; // Lavalle — depósito propio, solo se lee
    const urlEdicion = `${BASE}/modulos/inventarios/inventariose.aspx?ID=${idDePrueba}`;
    const resEd = await fetch(urlEdicion, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } });
    const htmlEd = await resEd.text();
    const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*(?:value=["']([^"']*)["'])?[^>]*>/gi;
    const campos = [];
    let im;
    while ((im = inputRegex.exec(htmlEd))) campos.push({ name: im[1], value: im[2] || null });
    const scriptSrcRegex2 = /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
    const scriptsEdicion = [];
    let sm2;
    while ((sm2 = scriptSrcRegex2.exec(htmlEd))) if (/inventari/i.test(sm2[1])) scriptsEdicion.push(sm2[1]);
    let jsEdicion = null;
    if (scriptsEdicion[0]) {
      const srcAbs = scriptsEdicion[0].startsWith("http") ? scriptsEdicion[0] : `${BASE}${scriptsEdicion[0].startsWith("/") ? "" : "/"}${scriptsEdicion[0]}`;
      const jsRes = await fetch(srcAbs, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } });
      const jsTxt = await jsRes.text();
      const metodoRegex2 = /\.aspx\/([A-Za-z0-9_]+)/g;
      const metodosEd = new Set();
      let mm3;
      while ((mm3 = metodoRegex2.exec(jsTxt))) metodosEd.add(mm3[1]);
      const guardarRegex = /(guardar|save)\s*[:=]\s*function[^{]*\{/gi;
      const fragGuardar = [];
      let gm;
      while ((gm = guardarRegex.exec(jsTxt))) fragGuardar.push(jsTxt.slice(gm.index, gm.index + 600));
      jsEdicion = { src: srcAbs, metodosAspx: [...metodosEd], fragmentosGuardar: fragGuardar };
    }
    detalleFormularioEdicion = { url: urlEdicion, status: resEd.status, campos, scriptsEdicion, jsEdicion };
  } catch (e) {
    detalleFormularioEdicion = { error: e.message };
  }

  return {
    paginasCandidatasPorAspx: paginasCandidatas,
    paginasCandidatasPorTextoDeMenu: [...menuCandidatos],
    todosLosAspxEncontrados: [...todosLosAspx].sort(),
    todosLosLinksDeTextoEnHome: [...todosLosLinksDeTexto].sort(),
    contextoDeMencionesEnElCuerpo: contextoPorPagina,
    webmethodsPorPagina,
    jsFuncionesPorPagina,
    scriptsPropiosDeInventarios: scriptsPropios,
    detalleScriptsInventarios,
    detalleFormularioEdicion,
    tamañosHtmlBase: Object.fromEntries(Object.entries(htmlsPorPagina).map(([k, v]) => [k, v.html ? v.html.length : v.error])),
  };
}

// Renombra UN depósito (campo "Nombre" en /modulos/inventarios/inventariose.aspx?ID=x).
// Solo toca el nombre: no toca dirección, teléfono, ni el ID interno que
// usa Contabilium (y que usa todo nuestro código) — el ID nunca cambia.
// Usa un navegador real (como el login) porque es un formulario clásico de
// ASP.NET con __VIEWSTATE, no un webmethod JSON: reproducir eso a mano con
// requests sueltos es frágil, así que dejamos que el sitio arme todo solo,
// exactamente como lo haría una persona escribiendo y tocando "Guardar".
// Lee el nombre antes y después para poder confirmar que el cambio pegó.
async function renombrarDepositoWeb({ email, password, id, nombreNuevo }) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    );
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });

    const emailSelector = 'input[placeholder*="mail" i]';
    const passSelector = 'input[type="password"]';
    await page.waitForSelector(emailSelector, { timeout: 45000 });
    await page.type(emailSelector, email, { delay: 20 });
    await page.type(passSelector, password, { delay: 20 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}),
      page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const ingresar = btns.find((b) => /ingresar/i.test(b.textContent || ""));
        if (ingresar) ingresar.click();
      }),
    ]);
    if (/\/login/i.test(page.url())) {
      throw new Error(`El login no avanzó, seguimos en ${page.url()}`);
    }

    const urlEdicion = `${BASE}/modulos/inventarios/inventariose.aspx?ID=${id}`;
    const nombreSelector = 'input[name="ctl00$MainContent$txtNombre"]';

    await page.goto(urlEdicion, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(nombreSelector, { timeout: 30000 });
    const nombreAntes = await page.$eval(nombreSelector, (el) => el.value);

    await page.evaluate(
      (sel) => {
        document.querySelector(sel).value = "";
      },
      nombreSelector
    );
    await page.type(nombreSelector, nombreNuevo, { delay: 10 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const candidatos = Array.from(document.querySelectorAll("button, input[type=submit], input[type=button], a"));
        const guardar = candidatos.find((el) => /guardar/i.test(el.textContent || el.value || ""));
        if (guardar) guardar.click();
      }),
    ]);

    // Releer desde cero (no confiar en lo que quedó en pantalla tras el
    // guardado) para confirmar que el nombre nuevo realmente quedó grabado.
    await page.goto(urlEdicion, { waitUntil: "networkidle2", timeout: 60000 });
    const nombreDespues = await page.$eval(nombreSelector, (el) => el.value).catch(() => null);

    return { id, nombreAntes, nombreNuevo, nombreDespues, ok: nombreDespues === nombreNuevo };
  } finally {
    await browser.close();
  }
}

// Detalle completo de UN remito por su id interno (solo lectura) — para
// mostrarlo tal cual está en Contabilium antes de decidir si hace falta
// tocar algo.
async function obtenerRemitoPorId({ db, email, password, idRemito }) {
  const cookie = await getCookieValida(db, email, password);
  const res = await fetch(`${BASE}/api/remitos/ObtenerRemito?idRemito=${idRemito}`, {
    method: "GET",
    headers: apiHeadersFactory(cookie),
  });
  if (!res.ok) throw new Error(`Contabilium devolvió ${res.status} al pedir el remito ${idRemito}`);
  return res.json();
}

// Wrapper público de actualizarObservacionRemito (arriba, ya probada en
// producción por asignarProveedorARemito) — resuelve la cookie y devuelve
// el remito ya actualizado para poder confirmar en pantalla que pegó.
async function editarObservacionRemito({ db, email, password, idRemito, observaciones }) {
  const cookie = await getCookieValida(db, email, password);
  await actualizarObservacionRemito(cookie, idRemito, observaciones);
  const res = await fetch(`${BASE}/api/remitos/ObtenerRemito?idRemito=${idRemito}`, {
    method: "GET",
    headers: apiHeadersFactory(cookie),
  });
  if (!res.ok) throw new Error(`Se guardó pero no se pudo releer el remito ${idRemito} (status ${res.status})`);
  return res.json();
}

module.exports = {
  ajustarStockWeb,
  transferirStockWeb,
  generarRemitoAutoDesdeTransferencia,
  obtenerPdfRemitoPorNumero,
  asignarProveedorARemito,
  listarRemitosCompletos,
  getCookieValida,
  invalidarCookie,
  probarCandidatosIdCC,
  diagObtenerRemito,
  probarWebmethodsMovimientos,
  explorarModuloDepositos,
  renombrarDepositoWeb,
  obtenerRemitoPorId,
  editarObservacionRemito,
};
