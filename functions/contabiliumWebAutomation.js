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
const crypto = require("crypto");

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
const CHEQUES_PAGE = `${BASE}/modulos/tesoreria/chequese.aspx`;
const COBRANZAS_PAGE = `${BASE}/cobranzase.aspx`;
const INVENTARIOS_PAGE = `${BASE}/modulos/inventarios/inventariose.aspx`;
const COMPROBANTE_EDITAR_PAGE = `${BASE}/comprobantese.aspx`;
const COMMON_PAGE = `${BASE}/common.aspx`;
const COOKIE_DOC = "meta/contabiliumWebSession";
// La sesión dura ~20hs en el sitio real; la reusamos con margen antes de
// volver a pagar el costo de abrir un navegador entero.
const COOKIE_TTL_MS = 18 * 60 * 60 * 1000;

// Bancos disponibles en el combo de Tesorería > Cheques — Contabilium no
// expone esto por API (se probó, ver probeBancosEndpoints en
// contabiliumService.js, todo 404). Se sacó a mano del <select id="ddlBancos">
// real de la página (confirmado por captura, sept/2026) con:
//   [...document.querySelectorAll('#ddlBancos option')].map(o => o.value + ' | ' + o.textContent).join('\n')
// Se parsea desde el texto crudo tal cual se copió, en vez de tipear un
// objeto a mano, para no arriesgar un error de dedo en el ID de un banco —
// esto carga cheques con plata real.
const BANCOS_RAW = `3 | Banco Cetelem Argentina S.A
6 | Banco Columbia S.A
7 | Banco Comafi S.A
8 | Banco Credicoop C.L
9 | Banco de Corrientes S.A
10 | Banco de Formosa S.A
12 | Banco de inversión y comercio exterior S.A (BICE)
13 | Banco de la Ciudad de Bs As
14 | Banco de la Nación Argentina
15 | Banco de La Pampa SEM
16 | Banco Prov. de Bs. As.
17 | Bancor
18 | Banco San Juan S.A
19 | Banco Santa Cruz S.A
20 | Banco Santiago del Estero S.A
23 | Banco del Chubut S.A
24 | Banco del Sol S.A
25 | Banco del Tucumán S.A
26 | Banco Finansur S.A
27 | Banco Hipotecario S.A
28 | Banco Industrial S.A (BIND)
29 | Banco Interfinanzas S.A
30 | Banco Itaú Argentina S.A
31 | Banco Julio S.A
32 | Banco Macro S.A
33 | Banco Mariva S.A
34 | Banco Masventas S.A
35 | Banco Meridian S.A
36 | Banco Municipal de Rosario S.A
37 | Banco Patagonia S.A
38 | Banco Piano S.A
39 | Banco Provincia de Tierra del Fuego
40 | BPN S.A
42 | Banco Saenz S.A
43 | Banco Santander Río S.A
44 | Banco Supervielle S.A
45 | Banco Voii S.A
46 | BBVA Banco Francés S.A
47 | Citibank N.A Arg S.A.
48 | Deutsche Bank S.A
49 | HSBC Bank Argentina S.A
50 | ICBC S.A
51 | Nuevo Banco de Entre Rios S.A
52 | Nuevo Banco de La Rioja S.A
53 | Nuevo Banco de Santa Fe S.A
54 | Nuevo Banco del Chaco S.A
56 | Banco Galicia S.A
66 | Banco Regional de Cuyo S.A
67 | Banco Municipal de La Plata
68 | Nuevo Banco Suquia S.A
78 | Default
80 | MercadoPago
82 | Standard Bank
83 | TodoPago
85 | Banco Coinag
86 | Banco de Comercio S.A
87 | PayU
88 | Banco BICA
89 | Bank of America ILS
90 | Bancolombia ILS
91 | Bancolombia Compass
93 | TD BANK
94 | PayPal
95 | Banco CMF
96 | Banco Bi Creditanstalt
97 | Banco Roela
98 | PayPertic
99 | Banco Santa Fe
100 | Banco de Valores
101 | Banco Wilobank
102 | Banco Davivienda WOT
103 | Banco Brubank
105 | CuentaDigital
106 | Balanz
107 | Banco Dino
108 | Wibond
109 | Uala
110 | Rebanking
112 | NaranjaPOS
113 | Prisma medios de pago
114 | Banco Mundial
116 | Banco Panama
117 | SiPago
119 | American Express
120 | Visa
122 | Brubank
123 | Mobbex
124 | NaranjaX
125 | Getnet
126 | Bimo
127 | Modo
128 | Mastercard
129 | DLocal
130 | Bank of China
131 | Firstdata
132 | Tarjeta Cabal
133 | PagoNube
134 | BANCO BMA S.A.U.
135 | Bull Market Brokers
136 | Cabal
137 | Diners
138 | Cresium SA
140 | Finan. Prince
141 | Efectivo
142 | BANCO PROVINCIA DEL NEUQUÉN SOCIEDAD ANON.
143 | YOY`;

const BANCOS_TESORERIA = Object.fromEntries(
  BANCOS_RAW.split("\n").map((line) => {
    const [id, ...resto] = line.split(" | ");
    return [id.trim(), resto.join(" | ").trim()];
  })
);

function normalizarTextoBanco(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca tildes
    .toUpperCase()
    .trim();
}

// Trae la lista de bancos EN VIVO desde el propio formulario de Contabilium
// (el <select id="ddlBancos"> viene ya renderizado en el HTML del lado del
// servidor — no hace falta ejecutar JS para verlo, un fetch simple alcanza).
// Así, si Contabilium suma un banco nuevo al combo, se ve acá solo, sin
// tener que volver a capturar nada a mano. Si por lo que sea no se puede
// parsear (cambiaron el HTML, falló la sesión, etc.), se usa la foto fija
// BANCOS_TESORERIA como respaldo — mejor una lista un poco vieja que
// romper la carga del cheque.
async function obtenerMapaBancos(cookie) {
  try {
    const res = await fetch(CHEQUES_PAGE, { headers: { Cookie: cookie, Accept: "text/html" } });
    if (!res.ok) return BANCOS_TESORERIA;
    const html = await res.text();
    const selectMatch = /<select[^>]*id="ddlBancos"[^>]*>([\s\S]*?)<\/select>/i.exec(html);
    if (!selectMatch) return BANCOS_TESORERIA;
    const opciones = [...selectMatch[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/gi)];
    if (opciones.length === 0) return BANCOS_TESORERIA;
    const mapa = {};
    for (const [, id, nombre] of opciones) mapa[id] = nombre.trim();
    return mapa;
  } catch {
    return BANCOS_TESORERIA;
  }
}

// Busca el ID de banco por nombre — exacto primero, si no, por coincidencia
// parcial. Tira error en vez de adivinar si no encuentra nada o si el nombre
// es ambiguo (más de un candidato), porque esto carga plata real.
function resolverIdBanco(nombreBuscado, mapaBancos = BANCOS_TESORERIA) {
  const q = normalizarTextoBanco(nombreBuscado);
  const entradas = Object.entries(mapaBancos);
  const exacto = entradas.find(([, nombre]) => normalizarTextoBanco(nombre) === q);
  if (exacto) return Number(exacto[0]);
  const parciales = entradas.filter(
    ([, nombre]) => normalizarTextoBanco(nombre).includes(q) || q.includes(normalizarTextoBanco(nombre))
  );
  if (parciales.length === 1) return Number(parciales[0][0]);
  if (parciales.length === 0) {
    throw new Error(`No se encontró el banco "${nombreBuscado}" en la lista de Contabilium.`);
  }
  throw new Error(`"${nombreBuscado}" es ambiguo — coincide con: ${parciales.map(([, n]) => n).join(", ")}`);
}

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

// `refererPagina` separado de `pagina` porque algunos webmethods viven en un
// .aspx compartido (ej. common.aspx/obtenerUltimoNroRecibo) pero el browser
// real los pide con el Referer de la pantalla donde se están usando (ej.
// cobranzase.aspx) — por defecto son la misma URL.
async function postWebMethod(cookie, metodo, body, pagina = STOCK_PAGE, refererPagina = pagina) {
  const res = await fetch(`${pagina}/${metodo}`, {
    method: "POST",
    headers: headersWeb(cookie, refererPagina),
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

// Variante GET de postWebMethod — algunos webmethods de Contabilium (ej.
// common.aspx/obtenerCiudades?idProvincia=X) van por querystring en vez de
// JSON en el body, confirmado por captura real (2/10/2026).
async function getWebMethod(cookie, urlCompleta, refererPagina) {
  const res = await fetch(urlCompleta, {
    method: "GET",
    headers: headersWeb(cookie, refererPagina),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // sesión vencida devolviendo HTML, mismo criterio que postWebMethod.
  }
  if (!res.ok || json === null) {
    throw new Error(`Contabilium (GET ${urlCompleta}) respondió ${res.status}: ${text.slice(0, 300)}`);
  }
  return json.d;
}

// Provincias de Argentina — lista estática (no cambia), sacada de la
// respuesta real de common.aspx/obtenerProvincias?idPais=10 (2/10/2026).
const PROVINCIAS_ARGENTINA = [
  { id: 1, nombre: "Buenos Aires" },
  { id: 3, nombre: "Catamarca" },
  { id: 4, nombre: "Chaco" },
  { id: 5, nombre: "Chubut" },
  { id: 2, nombre: "Ciudad de Buenos Aires" },
  { id: 6, nombre: "Cordoba" },
  { id: 7, nombre: "Corrientes" },
  { id: 8, nombre: "Entre Rios" },
  { id: 9, nombre: "Formosa" },
  { id: 10, nombre: "Jujuy" },
  { id: 11, nombre: "La Pampa" },
  { id: 12, nombre: "La Rioja" },
  { id: 13, nombre: "Mendoza" },
  { id: 14, nombre: "Misiones" },
  { id: 15, nombre: "Neuquen" },
  { id: 16, nombre: "Rio Negro" },
  { id: 17, nombre: "Salta" },
  { id: 18, nombre: "San Juan" },
  { id: 19, nombre: "San Luis" },
  { id: 20, nombre: "Santa Cruz" },
  { id: 21, nombre: "Santa Fe" },
  { id: 22, nombre: "Santiago del Estero" },
  { id: 23, nombre: "Tierra del Fuego" },
  { id: 24, nombre: "Tucuman" },
];

// Ciudades de una provincia — esta lista sí hay que pedirla en vivo (son
// cientas/miles según la provincia), vía el mismo webmethod que usa la
// consola web.
async function listarCiudadesWeb({ db, email, password, idProvincia }) {
  const cookie = await getCookieValida(db, email, password);
  const intentar = () =>
    getWebMethod(cookie, `${COMMON_PAGE}/obtenerCiudades?idProvincia=${idProvincia}`, INVENTARIOS_PAGE);
  try {
    return await intentar();
  } catch (err) {
    await invalidarCookie(db);
    const cookieNueva = await getCookieValida(db, email, password);
    return getWebMethod(cookieNueva, `${COMMON_PAGE}/obtenerCiudades?idProvincia=${idProvincia}`, INVENTARIOS_PAGE);
  }
}

// Cheques reales disponibles en Tesorería (los que aparecen en el
// desplegable "Cheques" al cobrar en cobranzase.aspx) — confirmado por
// captura real del sitio (2/10/2026): POST a common.aspx/
// obtenerChequesCobranzas con {EsPropio, idMoneda}. Solo para LISTAR y
// poder referenciarlos (ver "Proviene del cheque X" en Clientes 360) — no
// aplica el cheque de verdad, eso sigue siendo manual en Contabilium (ver
// nota en index.js).
async function listarChequesDisponiblesWeb({ db, email, password, idMoneda = 94492, esPropio = false }) {
  const cookie = await getCookieValida(db, email, password);
  const body = { EsPropio: esPropio, idMoneda };
  const intentar = () => postWebMethod(cookie, "obtenerChequesCobranzas", body, COMMON_PAGE, `${BASE}/cobranzase.aspx`);
  try {
    return await intentar();
  } catch (err) {
    await invalidarCookie(db);
    const cookieNueva = await getCookieValida(db, email, password);
    return postWebMethod(cookieNueva, "obtenerChequesCobranzas", body, COMMON_PAGE, `${BASE}/cobranzase.aspx`);
  }
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

// Crea un depósito nuevo en Contabilium — un solo webmethod JSON ("guardar"
// en inventariose.aspx), confirmado por captura real del sitio (29/9/2026).
// Ojo: la respuesta siempre viene {d: null} aunque haya salido bien —
// Contabilium no devuelve acá el ID del depósito recién creado. Después de
// crearlo hay que entrar a Depósitos → buscarlo por nombre → copiar el ID
// de la URL de edición (inventariose.aspx?ID=x) para vincularlo a un
// cliente, igual que se hizo a mano con Budabike.
// idProvincia/idCiudad son códigos internos de Contabilium (no ISO/oficiales)
// — 2/27869 es lo que usa la cuenta para Ciudad Autónoma de Buenos Aires,
// sacado de la captura real; sirve como default razonable ya que estos
// depósitos son virtuales (ligados a un cliente, no una sucursal física).
async function crearDepositoWeb({ db, email, password, nombre, direccion, telefono, idProvincia = 2, idCiudad = 27869 }) {
  let cookie = await getCookieValida(db, email, password);

  const hoy = new Date();
  const fechaHoy = `${String(hoy.getDate()).padStart(2, "0")}/${String(hoy.getMonth() + 1).padStart(2, "0")}/${hoy.getFullYear()}`;

  const body = {
    id: 0,
    nombre,
    activo: 1,
    idProvincia,
    idCiudad,
    direccion: direccion || "",
    telefono: telefono || "",
    defectoReservas: "0",
    fechaUltimoInventario: fechaHoy,
  };

  const intentar = () => postWebMethod(cookie, "guardar", body, INVENTARIOS_PAGE, INVENTARIOS_PAGE);

  try {
    await intentar();
  } catch (err) {
    console.warn("[contabiliumWebAutomation] crearDepositoWeb: primer intento falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    await intentar();
  }
}

// Crea una factura real CON IVA discriminado por ítem — confirmado por
// captura real del sitio (1/10/2026). La API REST oficial de Contabilium
// (ver crearComprobante en contabiliumService.js) no tiene forma de mandar
// el IVA por ítem, así que esas facturas siempre salían con $0 de IVA. Acá
// se replica el mecanismo real que usa la propia consola web: un "carrito"
// de sesión (mismo sessionId en todos los pedidos) donde primero se van
// agregando los ítems uno por uno (agregarItem, con el IVA adentro) y
// recién al final se confirma todo junto (guardar). El CAE (autorización
// AFIP) también se pide acá mismo, por el webmethod real "generarCae" (ver
// más abajo) — NO por la API REST (emitirFacturaElectronica), que calcula
// mal la condición de IVA del receptor en algunos casos (visto con
// Calderaro, 21/10/2026: la REST rechazaba, la consola clásica facturaba
// bien con los mismos datos). El comprobante que crea este flujo web es el
// mismo objeto de Contabilium, se puede seguir leyendo por REST después.
//
// Constantes fijas de la cuenta (sacadas de la captura, confirmadas con
// Ezequiel 1/10/2026):
//   - idPlanDeCuenta/codigoCta: "4.1.1 - Ventas" — cuenta contable de venta
//     estándar, la misma para cualquier producto.
//   - idPuntoVenta: 117923 — ID interno del punto de venta "0001".
//   - idMoneda/idMonedaDefecto: 94492 — ARS.
//   - idVendedor: 34678 — usuario de la cuenta (ezequielbota@samurai.ar),
//     el mismo que usan las credenciales CONTABILIUM_WEB_EMAIL.
//   - condicionVenta: 714257 — "Cuenta corriente", la condición con la que
//     salen todas las facturas automáticas hoy (Stortini, Bici Shop, etc.).
const CONTABILIUM_CTA_VENTAS = { idPlanDeCuenta: 1135383, codigoCta: "4.1.1 - Ventas" };
const CONTABILIUM_ID_PUNTO_VENTA = "117923";
const CONTABILIUM_ID_MONEDA_ARS = "94492";
const CONTABILIUM_ID_VENDEDOR_DEFAULT = "34678";
const CONTABILIUM_CONDICION_VENTA_CTA_CTE = "714257";

function formatFechaDDMMYYYY(d) {
  const date = d ? new Date(d) : new Date();
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

async function crearComprobanteWeb({
  db,
  email,
  password,
  restEmail,
  restApiKey,
  idPersona,
  idInventario,
  tipoFc = "FCA",
  items, // [{ sku, descripcion, cantidad, precioUnitarioConIva, iva = 21 }]
  fechaEmision,
  fechaVencimiento,
  idVendedor = CONTABILIUM_ID_VENDEDOR_DEFAULT,
  condicionVenta = CONTABILIUM_CONDICION_VENTA_CTA_CTE,
  observaciones = "",
}) {
  let cookie = await getCookieValida(db, email, password);

  const { getAllConceptos } = require("./contabiliumService");
  const conceptos = await getAllConceptos(restEmail, restApiKey);
  const conceptoIdBySku = new Map();
  for (const c of conceptos) {
    const code = (c.Codigo || "").trim();
    if (code) conceptoIdBySku.set(code, c.Id);
  }

  const sessionId = require("crypto").randomUUID();
  const fechaStr = formatFechaDDMMYYYY(fechaEmision);
  const fechaVtoStr = fechaVencimiento
    ? formatFechaDDMMYYYY(fechaVencimiento)
    : formatFechaDDMMYYYY(new Date(new Date(fechaEmision || Date.now()).getTime() + 30 * 24 * 60 * 60 * 1000));

  const intentar = async () => {
    for (const it of items) {
      const idConcepto = it.sku ? conceptoIdBySku.get(String(it.sku).trim()) : null;
      if (it.sku && !idConcepto) {
        throw new Error(`No se encontró el producto con SKU ${it.sku} en Contabilium`);
      }
      await postWebMethod(
        cookie,
        "agregarItem",
        {
          sessionId,
          id: 0,
          idConcepto: idConcepto ? String(idConcepto) : "",
          concepto: it.descripcion || `SKU ${it.sku}`,
          iva: Number(it.iva ?? 21).toFixed(2).replace(".", ","),
          precio: String(it.precioUnitarioConIva),
          bonif: "0",
          cantidad: String(it.cantidad ?? 1),
          idPersona,
          codigo: it.sku || "",
          idPlanDeCuenta: CONTABILIUM_CTA_VENTAS.idPlanDeCuenta,
          codigoCta: CONTABILIUM_CTA_VENTAS.codigoCta,
          idInventario,
          tipoDeCambio: "1",
          idMonedaComprobante: CONTABILIUM_ID_MONEDA_ARS,
          idMonedaDefecto: CONTABILIUM_ID_MONEDA_ARS,
          idCategoria: "",
          nombreCategoria: "",
        },
        COMPROBANTE_EDITAR_PAGE
      );
    }

    const resultado = await postWebMethod(
      cookie,
      "guardar",
      {
        sessionId,
        id: 0,
        idPersona,
        tipo: tipoFc,
        modo: "E",
        fecha: fechaStr,
        condicionVenta: String(condicionVenta),
        tipoConcepto: 3,
        fechaVencimiento: fechaVtoStr,
        fechaServDesde: "",
        fechaServHasta: "",
        idPuntoVenta: CONTABILIUM_ID_PUNTO_VENTA,
        nroComprobante: "",
        idInventario,
        obs: observaciones || "",
        idJurisdiccion: 0,
        idIntegracion: "0",
        idVentaIntegracion: "",
        idOrdenVenta: "0",
        impInternos: 0,
        idPresupuesto: 0,
        idMoneda: CONTABILIUM_ID_MONEDA_ARS,
        tipoDeCambio: "1",
        idMonedaDefecto: CONTABILIUM_ID_MONEDA_ARS,
        fceMiPYME: false,
        comprobanteAsociado: "",
        idVendedor: String(idVendedor),
        cancelaEnMismaMoneda: false,
        issue: true,
      },
      COMPROBANTE_EDITAR_PAGE
    );

    const idComprobante = typeof resultado === "number" ? resultado : Number(resultado?.Id ?? resultado?.IDComprobante ?? resultado);
    if (!Number.isFinite(idComprobante) || idComprobante <= 0) {
      throw new Error(`Contabilium no devolvió un ID de comprobante válido: ${JSON.stringify(resultado)}`);
    }
    return idComprobante;
  };

  let idComprobante;
  try {
    idComprobante = await intentar();
  } catch (err) {
    console.warn("[contabiliumWebAutomation] crearComprobanteWeb: primer intento falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    idComprobante = await intentar();
  }

  // Pide el CAE por el MISMO camino que usa un humano clickeando "Emitir
  // factura eléctronica" en la consola clásica (webmethod "generarCae" de
  // comprobantese.aspx) — NO por la API REST pública (emitirFacturaElectronica
  // en contabiliumService.js, que sigue existiendo para casos viejos/COT).
  // Confirmado por captura real (21/10/2026, caso Calderaro): la REST
  // rechazaba con "Condicion IVA receptor no es valido para la clase de
  // comprobante informado" un comprobante que la consola clásica facturaba
  // sin problema con los mismos datos — la REST calcula ese código distinto
  // (y peor) que el webmethod real, no es un problema del dato cargado.
  //
  // A propósito, este paso queda AFUERA del reintento-con-sesión-nueva de
  // arriba: si generarCae falla, no tiene sentido volver a crear TODO el
  // borrador de cero (agregarItem + guardar) — eso solo dejaría un segundo
  // borrador huérfano. El llamador (emitirComprobanteConIva en index.js) es
  // quien decide qué hacer con un error acá (reintentar con otro tipo de
  // comprobante, limpiar el huérfano, etc.), usando el idComprobante que le
  // adjuntamos al error.
  try {
    const cae = await postWebMethod(
      cookie,
      "generarCae",
      {
        sessionId,
        id: idComprobante,
        idPersona,
        tipo: tipoFc,
        modo: "E",
        fecha: fechaStr,
        condicionVenta: String(condicionVenta),
        tipoConcepto: 3,
        fechaVencimiento: fechaVtoStr,
        fechaServDesde: "",
        fechaServHasta: "",
        idPuntoVenta: CONTABILIUM_ID_PUNTO_VENTA,
        nroComprobante: "",
        obs: observaciones || "",
        idMoneda: CONTABILIUM_ID_MONEDA_ARS,
        tipoDeCambio: "1",
        fceMiPYME: false,
        motivoNC: "",
        cancelaEnMismaMoneda: false,
        // Solo relevante cuando se factura a un cliente RI tildando
        // "Emitir como consumidor final" en la consola — no es un flujo que
        // usemos acá, siempre false.
        forzarCF: false,
      },
      COMPROBANTE_EDITAR_PAGE
    );
    return { idComprobante, cae };
  } catch (err) {
    err.idComprobanteBorrador = idComprobante;
    throw err;
  }
}

// Cuenta propia (de Contabilium) default a la que se asocia un cheque
// nuevo — confirmado por captura real (sept/2026). Se manda igual para
// cheques de terceros, no solo propios; no hay selector visible para esto
// en el form, así que asumimos que es fija para esta empresa. Si en algún
// momento Contabilium empieza a exigir otra, esto se puede convertir en
// parámetro.
const ID_BANCO_PROPIO_DEFAULT = "201285";
const ID_MONEDA_ARS = "94492";

// Carga un cheque nuevo en Tesorería > Cheques (comboBox "guardar",
// confirmado por captura real del pedido que hace la propia consola de
// Contabilium al dar de alta, sept/2026). Devuelve el ID del cheque nuevo.
// `banco` es el nombre tal cual aparece en el desplegable (se resuelve a su
// ID con resolverIdBanco) — o se puede pasar `idBanco` directo si ya se
// conoce.
async function cargarChequeWeb({
  db,
  email,
  password,
  banco,
  idBanco,
  numero,
  importe,
  fechaEmision,
  fechaCobro,
  fechaVencimiento,
  emisor,
  observaciones,
  esPropio = false,
  idBancoPropio = ID_BANCO_PROPIO_DEFAULT,
  idMoneda = ID_MONEDA_ARS,
}) {
  let cookie = await getCookieValida(db, email, password);

  let idBancoFinal;
  let bancoNombre = null;
  if (idBanco != null) {
    idBancoFinal = Number(idBanco);
  } else {
    const mapaBancos = await obtenerMapaBancos(cookie);
    idBancoFinal = resolverIdBanco(banco, mapaBancos);
    bancoNombre = mapaBancos[String(idBancoFinal)] || null;
  }

  const body = {
    id: 0,
    idBanco: String(idBancoFinal),
    idBancoPropio: String(idBancoPropio),
    numero: String(numero),
    importe: Number(importe).toFixed(2),
    fechaEmision,
    fechaCobro,
    fechaVencimiento: fechaVencimiento || "",
    estado: "Libre",
    emisor: emisor || "",
    observaciones: observaciones || "",
    esPropio: !!esPropio,
    esABM: true,
    idMoneda: String(idMoneda),
  };

  const nombreFinal = () => bancoNombre || BANCOS_TESORERIA[String(idBancoFinal)] || null;

  try {
    const idCheque = await postWebMethod(cookie, "guardar", body, CHEQUES_PAGE);
    return { idCheque, idBanco: idBancoFinal, bancoNombre: nombreFinal() };
  } catch (err) {
    console.warn("[contabiliumWebAutomation] cargarChequeWeb primer intento falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    const idCheque = await postWebMethod(cookie, "guardar", body, CHEQUES_PAGE);
    return { idCheque, idBanco: idBancoFinal, bancoNombre: nombreFinal() };
  }
}

// Cuentas bancarias PROPIAS de la empresa (distinto de BANCOS_TESORERIA, que
// son los bancos de TERCEROS que emiten cheques) — se usan como "Banco" al
// cargar una cobranza. A diferencia de la lista de Tesorería, esta sí tiene
// un endpoint real (GET, confirmado por captura, sept/2026) — se trae
// siempre en vivo, no hace falta lista fija de respaldo.
async function obtenerBancosPropios(cookie, fechaDdMmYyyy) {
  const url = `${COMMON_PAGE}/obtenerBancos?idMoneda=0&activo=true&stringFecha=${encodeURIComponent(JSON.stringify(fechaDdMmYyyy))}`;
  const res = await fetch(url, { headers: headersWeb(cookie, COBRANZAS_PAGE) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // sesión vencida u otro error — se trata como lista vacía, el llamador
    // decide qué hacer (tira error si no puede resolver el banco pedido).
  }
  const items = json?.d || [];
  return items.map((b) => ({ id: Number(b.ID), nombre: b.Nombre }));
}

// Cajas propias (ej. "Caja" para Efectivo) — mismo endpoint "gemelo" de
// obtenerBancos, visto en la misma tanda de pedidos de red al cargar la
// sección "Forma de cobro" (confirmado que existe el pedido, mismo patrón
// de query params que obtenerBancos — no se llegó a capturar la respuesta
// exacta, así que si falla acá es lo primero a re-capturar).
async function obtenerCajasPropias(cookie, fechaDdMmYyyy) {
  const url = `${COMMON_PAGE}/obtenerCajas?idMoneda=0&activo=true&stringFecha=${encodeURIComponent(JSON.stringify(fechaDdMmYyyy))}`;
  const res = await fetch(url, { headers: headersWeb(cookie, COBRANZAS_PAGE) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ver obtenerBancosPropios
  }
  const items = json?.d || [];
  return items.map((c) => ({ id: Number(c.ID), nombre: c.Nombre }));
}

function resolverIdBancoPropio(nombreBuscado, bancos) {
  const q = normalizarTextoBanco(nombreBuscado);
  const exacto = bancos.find((b) => normalizarTextoBanco(b.nombre) === q);
  if (exacto) return exacto.id;
  const parciales = bancos.filter(
    (b) => normalizarTextoBanco(b.nombre).includes(q) || q.includes(normalizarTextoBanco(b.nombre))
  );
  if (parciales.length === 1) return parciales[0].id;
  if (parciales.length === 0) {
    throw new Error(`No se encontró la cuenta bancaria propia "${nombreBuscado}". Disponibles: ${bancos.map((b) => b.nombre).join(", ")}`);
  }
  throw new Error(`"${nombreBuscado}" es ambiguo — coincide con: ${parciales.map((b) => b.nombre).join(", ")}`);
}

// Carga una cobranza "a cuenta" (sin aplicar a ninguna factura, idComprobante
// "-1") — para dinero recibido que todavía no corresponde a una factura
// puntual (ej. un pago que superó lo pendiente de la única factura del
// cliente). Confirmado por captura real del flujo completo, sept/2026:
// arma una "sesión" (sessionId propio, generado acá) con agregarItem (la
// línea "Cobranza a cuenta") + agregarForma (la forma de pago) y recién
// entonces guardar la confirma — mismo patrón de "carrito" que el ajuste de
// stock. Antes hay que pedir el próximo número de recibo (obtenerUltimoNroRecibo)
// porque Contabilium lo espera ya resuelto en el body de "guardar".
async function cargarCobranzaACuentaWeb({
  db,
  email,
  password,
  idPersona,
  importe,
  fecha, // dd/mm/yyyy
  forma = "Transferencia",
  banco,
  idBanco,
  caja,
  idCaja,
  nroRef,
  observaciones,
  idMoneda = ID_MONEDA_ARS,
}) {
  let cookie = await getCookieValida(db, email, password);
  const esEfectivo = forma === "Efectivo";
  // "Cheque" no pide banco ni caja — mismo patrón ya probado y en producción
  // en el recibo de factura (ReciboForm): se manda la forma "Cheque" sola,
  // con el número de cheque como referencia, sin idBanco/idCaja.
  const sinCuenta = forma === "Cheque";

  const intentar = async () => {
    let idBancoFinal = !esEfectivo && !sinCuenta ? (idBanco != null ? Number(idBanco) : null) : null;
    let idCajaFinal = esEfectivo ? (idCaja != null ? Number(idCaja) : null) : null;
    let bancoNombre = null;
    if (!esEfectivo && !sinCuenta && idBancoFinal == null) {
      const bancos = await obtenerBancosPropios(cookie, fecha);
      idBancoFinal = resolverIdBancoPropio(banco, bancos);
      bancoNombre = bancos.find((b) => b.id === idBancoFinal)?.nombre || null;
    }
    if (esEfectivo && idCajaFinal == null) {
      const cajas = await obtenerCajasPropias(cookie, fecha);
      idCajaFinal = resolverIdBancoPropio(caja || "Caja", cajas);
      bancoNombre = cajas.find((c) => c.id === idCajaFinal)?.nombre || null;
    }

    const nroComprobante = await postWebMethod(
      cookie,
      "obtenerUltimoNroRecibo",
      { tipoComprobante: "RC", idPunto: 117923 },
      COMMON_PAGE,
      COBRANZAS_PAGE
    );

    const sessionId = crypto.randomUUID();

    await postWebMethod(
      cookie,
      "agregarItem",
      {
        sessionId,
        id: 0,
        idComprobante: "-1",
        comprobante: "Cobranza a cuenta",
        idMonedaCobranza: String(idMoneda),
        idMonedaDefecto: String(idMoneda),
        importe: String(importe),
        saldo: "0.00",
        tipoDeCambio: "1",
      },
      COBRANZAS_PAGE
    );

    await postWebMethod(
      cookie,
      "agregarForma",
      {
        sessionId,
        id: 0,
        forma,
        idBanco: idBancoFinal != null ? String(idBancoFinal) : "",
        idCaja: idCajaFinal != null ? String(idCajaFinal) : "",
        idComprobanteAsociado: "0",
        idNotaCredito: "",
        idcheque: "",
        importe: String(importe),
        importeBrutoNC: "0",
        nroRef: nroRef || "",
        fecha,
        ComprobanteAsociado: "",
      },
      COBRANZAS_PAGE
    );

    await postWebMethod(
      cookie,
      "guardar",
      {
        sessionId,
        id: 0,
        idPersona,
        tipo: "RC",
        fecha,
        idMoneda: String(idMoneda),
        idPuntoVenta: "117923",
        nroComprobante,
        obs: observaciones || "",
        sobranteACuenta: false,
        tipoDeCambio: "1",
      },
      COBRANZAS_PAGE
    );

    return { nroComprobante, idBanco: idBancoFinal, bancoNombre };
  };

  try {
    return await intentar();
  } catch (err) {
    console.warn("[contabiliumWebAutomation] cargarCobranzaACuentaWeb primer intento falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    return await intentar();
  }
}

// Aplica un pago a UNA factura puntual (idComprobante real, no "-1") — mismo
// flujo de sesión que cargarCobranzaACuentaWeb, pero para cobranzas normales.
// A diferencia de cobrarComprobante (REST, /comprobantes/cobrar), esto NO
// pisa recibos previos de la misma factura — cada llamada crea un recibo
// numerado nuevo e independiente (confirmado: Miras ya tenía 5 cobranzas
// separadas conviviendo, hechas así, sept/2026). `forma` acepta lo mismo que
// el combo "Forma de cobro" de Contabilium — "Cheque" usa `idcheque` (el ID
// que devuelve cargarChequeWeb al cargarlo en Tesorería) en vez de idBanco.
async function aplicarPagoFacturaWeb({
  db,
  email,
  password,
  idPersona,
  idComprobante,
  comprobante, // número visible de la factura, ej "0001-00000260" — solo para el label
  importe,
  saldoFactura, // saldo pendiente ACTUAL de la factura — Contabilium exige importe <= saldo acá
  fecha, // dd/mm/yyyy
  forma = "Transferencia",
  banco,
  idBanco,
  idcheque,
  nroRef,
  idNotaCredito,
  observaciones,
  idMoneda = ID_MONEDA_ARS,
}) {
  let cookie = await getCookieValida(db, email, password);

  const intentar = async () => {
    let idBancoFinal = idBanco != null ? Number(idBanco) : null;
    if (idBancoFinal == null && !idcheque && !idNotaCredito) {
      const bancos = await obtenerBancosPropios(cookie, fecha);
      idBancoFinal = resolverIdBancoPropio(banco, bancos);
    }

    const nroComprobante = await postWebMethod(
      cookie,
      "obtenerUltimoNroRecibo",
      { tipoComprobante: "RC", idPunto: 117923 },
      COMMON_PAGE,
      COBRANZAS_PAGE
    );

    const sessionId = crypto.randomUUID();

    await postWebMethod(
      cookie,
      "agregarItem",
      {
        sessionId,
        id: 0,
        idComprobante: String(idComprobante),
        comprobante: comprobante || String(idComprobante),
        idMonedaCobranza: String(idMoneda),
        idMonedaDefecto: String(idMoneda),
        importe: String(importe),
        saldo: Number(saldoFactura).toFixed(2),
        tipoDeCambio: "1",
      },
      COBRANZAS_PAGE
    );

    await postWebMethod(
      cookie,
      "agregarForma",
      {
        sessionId,
        id: 0,
        forma,
        idBanco: idBancoFinal != null ? String(idBancoFinal) : "",
        idCaja: "",
        idComprobanteAsociado: "0",
        idNotaCredito: idNotaCredito != null ? String(idNotaCredito) : "",
        idcheque: idcheque != null ? String(idcheque) : "",
        importe: String(importe),
        importeBrutoNC: idNotaCredito != null ? String(importe) : "0",
        nroRef: nroRef || "",
        fecha,
        ComprobanteAsociado: "",
      },
      COBRANZAS_PAGE
    );

    await postWebMethod(
      cookie,
      "guardar",
      {
        sessionId,
        id: 0,
        idPersona,
        tipo: "RC",
        fecha,
        idMoneda: String(idMoneda),
        idPuntoVenta: "117923",
        nroComprobante,
        obs: observaciones || "",
        sobranteACuenta: false,
        tipoDeCambio: "1",
      },
      COBRANZAS_PAGE
    );

    return { nroComprobante };
  };

  try {
    return await intentar();
  } catch (err) {
    console.warn("[contabiliumWebAutomation] aplicarPagoFacturaWeb primer intento falló, reintentando con sesión nueva:", err.message);
    await invalidarCookie(db);
    cookie = await getCookieValida(db, email, password);
    return await intentar();
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
async function asignarProveedorARemito({ db, email, password, remitoArchivo, proveedorContabiliumId, observaciones, incluirMercaderiaConsignacion = true }) {
  const numeroMatch = remitoArchivo && /(\d{4}-\d{8})/.exec(remitoArchivo);
  if (!numeroMatch) {
    console.warn(`[asignarProveedorARemito] no se pudo sacar el número de "${remitoArchivo}"`);
    return { remitoArchivo: null, remitoPdfBase64: null, numero: null };
  }

  const cookie = await getCookieValida(db, email, password);
  const idRemito = await buscarIdRemitoPorNumero(cookie, numeroMatch[1]);
  if (!idRemito) {
    console.warn(`[asignarProveedorARemito] no se encontró idRemito para el número ${numeroMatch[1]}`);
    return { remitoArchivo: null, remitoPdfBase64: null, numero: numeroMatch[1] };
  }

  const getRes = await fetch(`${BASE}/api/remitos/ObtenerRemito?idRemito=${idRemito}`, {
    method: "GET",
    headers: apiHeadersFactory(cookie),
  });
  if (!getRes.ok) {
    console.warn(`[asignarProveedorARemito] ObtenerRemito falló (status ${getRes.status}) para idRemito ${idRemito}`);
    return { remitoArchivo: null, remitoPdfBase64: null, numero: numeroMatch[1] };
  }
  const remito = await getRes.json();
  remito.idPersona = Number(proveedorContabiliumId);
  remito.observaciones = incluirMercaderiaConsignacion
    ? conMercaderiaConsignacion(observaciones || remito.observaciones)
    : (observaciones || remito.observaciones || "");
  const guardarRes = await fetch(`${BASE}/api/remitos/GuardarRemito`, {
    method: "POST",
    headers: apiHeadersFactory(cookie, { "Content-Type": "application/json;charset=UTF-8" }),
    body: JSON.stringify(remito),
  });
  if (!guardarRes.ok) {
    const texto = await guardarRes.text().catch(() => "");
    console.warn(`[asignarProveedorARemito] GuardarRemito falló (status ${guardarRes.status}) para idRemito ${idRemito}: ${texto.slice(0, 300)}`);
    return { remitoArchivo: null, remitoPdfBase64: null, numero: numeroMatch[1] };
  }

  // El PDF hay que regenerarlo DESPUÉS de guardar el cambio de cliente, si
  // no queda con los datos viejos (FEPA TOP) aunque el remito ya esté
  // actualizado.
  const archivo = await generarArchivoRemitoPorId(cookie, idRemito);
  if (!archivo) {
    console.warn(`[asignarProveedorARemito] GenerarFile no devolvió archivo para idRemito ${idRemito} (proveedorContabiliumId ${proveedorContabiliumId})`);
    return { remitoArchivo: null, remitoPdfBase64: null, numero: numeroMatch[1] };
  }
  const remitoPdfBase64 = await bajarPdfPorNombreArchivo(cookie, archivo);
  if (!remitoPdfBase64) {
    console.warn(`[asignarProveedorARemito] bajarPdfPorNombreArchivo no trajo un PDF real para "${archivo}" (idRemito ${idRemito}, proveedorContabiliumId ${proveedorContabiliumId})`);
  }
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

// Re-descarga el PDF de un remito ya generado, por su nombre de archivo
// guardado (ej. el que quedó en order.envio.resultados) — para volver a
// bajarlo después, sin tener que repetir todo el movimiento.
async function descargarRemitoPorArchivoWeb({ db, email, password, remitoArchivo }) {
  const cookie = await getCookieValida(db, email, password);
  const remitoPdfBase64 = await bajarPdfPorNombreArchivo(cookie, remitoArchivo);
  return { remitoPdfBase64 };
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

// Investigación puntual (SOLO LECTURA): el usuario encontró a mano
// /modulos/reportes/historicoStock.aspx, un reporte de Contabilium que
// podría traer el stock a una fecha pasada — justo lo que hace falta para
// valorizar el stock al 31/12/2025 (pedido 21/10/2026). Baja el HTML de esa
// página (para ver inputs/fecha/JS) y después prueba webmethods candidatos
// típicos de ASP.NET con un rango de fechas, a ver si alguno responde JSON.
const HISTORICO_STOCK_PAGE = `${BASE}/modulos/reportes/historicoStock.aspx`;

async function explorarHistoricoStock({ db, email, password, fecha }) {
  const cookie = await getCookieValida(db, email, password);
  // Un GET directo a esta URL devolvía la página de login aunque el cookie
  // es válido (confirmado: otra página con el mismo cookie sí funciona) —
  // probablemente chequea el Referer para confirmar que se navega "desde
  // adentro" del sitio, no una entrada directa.
  const res = await fetch(HISTORICO_STOCK_PAGE, {
    headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", Referer: `${BASE}/modulos/home/home.aspx` },
  });
  const html = await res.text();

  // Junta nombres de webmethods mencionados en el HTML/JS de la página
  // (patrón "PageMethods.Nombre(" o similar) para no tener que adivinar
  // completamente a ciegas.
  const webmethodsEnHtml = [...new Set(
    [...html.matchAll(/PageMethods\.(\w+)\(/g)].map((m) => m[1])
  )];

  const apiHeaders = (extra = {}) => ({
    Accept: "application/json, text/plain, */*",
    Origin: BASE,
    Referer: HISTORICO_STOCK_PAGE,
    Cookie: cookie,
    ...extra,
  });
  const candidatos = [
    ...webmethodsEnHtml,
    "ObtenerHistoricoStock", "BuscarHistoricoStock", "GetHistoricoStock",
    "ObtenerStockHistorico", "BuscarStockHistorico", "ObtenerStockAFecha",
    "ObtenerReporte", "BuscarReporte", "ObtenerDatos", "Buscar",
  ];
  const fechaUsar = fecha || "2025-12-31";
  const bodiesAProbar = [
    { fecha: fechaUsar },
    { fechaHasta: fechaUsar },
    { fechaDesde: fechaUsar, fechaHasta: fechaUsar },
    { page: 1, pageSize: 20 },
    {},
  ];
  const resultados = [];
  for (const metodo of [...new Set(candidatos)]) {
    for (const body of bodiesAProbar) {
      try {
        const r = await fetch(`${HISTORICO_STOCK_PAGE}/${metodo}`, {
          method: "POST",
          headers: apiHeaders({ "Content-Type": "application/json;charset=UTF-8" }),
          body: JSON.stringify(body),
        });
        const text = await r.text();
        let esJson = false;
        try { JSON.parse(text); esJson = true; } catch {}
        if (r.ok && esJson) {
          resultados.push({ metodo, body, status: r.status, muestra: text.slice(0, 500) });
          break;
        }
      } catch {}
    }
  }

  return {
    htmlLength: html.length,
    webmethodsEncontradosEnHtml: webmethodsEnHtml,
    webmethodsQueRespondenJson: resultados,
    htmlMuestra: html.slice(0, 2000),
  };
}

// El GET directo con cookie reusada a historicoStock.aspx siempre volvía al
// login (confirmado: el mismo cookie SÍ funciona en otras páginas clásicas)
// — esta pantalla parece necesitar una sesión de navegador real, no solo el
// cookie. Acá se abre Puppeteer, se loguea de cero, y se navega/completa el
// formulario como lo haría una persona (depósito + fechas + Buscar), para
// después leer la tabla resultante directo del DOM. Solo lectura.
async function obtenerHistoricoStockReal({ email, password, depositoNombre, fechaDesde, fechaHasta }) {
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

    // Igual que en loginYSacarCookie: la cookie clásica se termina de armar
    // recién al visitar una pantalla del módulo viejo.
    await page.goto(STOCK_PAGE, { waitUntil: "networkidle2", timeout: 60000 });

    await page.goto(HISTORICO_STOCK_PAGE, { waitUntil: "networkidle2", timeout: 60000 });
    if (/\/login/i.test(page.url())) {
      const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || "").catch(() => "");
      return { ok: false, error: `Navegando de verdad igual terminó en login (url=${page.url()}). Extracto: ${bodySnippet}` };
    }

    // Si no piden filtrar nada, devolvemos solo el diagnóstico de la
    // estructura del formulario (selectores reales), sin tocar nada más.
    if (!depositoNombre && !fechaDesde && !fechaHasta) {
      const estructuraFormulario = await page.evaluate(() => {
        const campos = [];
        document.querySelectorAll("label").forEach((lbl) => {
          const texto = (lbl.textContent || "").trim();
          if (texto) campos.push({ label: texto });
        });
        const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
          tag: "input", type: i.type, id: i.id, name: i.name, placeholder: i.placeholder, value: i.value,
        }));
        const selects = Array.from(document.querySelectorAll("select")).map((s) => ({
          tag: "select", id: s.id, name: s.name,
          opciones: Array.from(s.options).map((o) => o.textContent.trim()).slice(0, 10),
        }));
        return { labels: campos, inputs, selects, bodyTextSample: document.body.innerText.slice(0, 500) };
      });
      return { ok: true, url: page.url(), estructuraFormulario };
    }

    // Depósito: <select id="ddlInventarios"> con el nombre tal cual figura
    // en Contabilium — se elige por texto visible, no por value (no lo
    // conocemos de antemano).
    if (depositoNombre) {
      const elegido = await page.evaluate((nombre) => {
        const sel = document.getElementById("ddlInventarios");
        if (!sel) return { ok: false, error: "No se encontró el select de depósito (ddlInventarios)" };
        const opt = Array.from(sel.options).find(
          (o) => o.textContent.trim().toUpperCase() === nombre.trim().toUpperCase()
        );
        if (!opt) {
          return { ok: false, error: `No se encontró el depósito "${nombre}" en el select`, opciones: Array.from(sel.options).map((o) => o.textContent.trim()) };
        }
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }, depositoNombre);
      if (!elegido.ok) return elegido;
    }

    // Fechas: inputs de texto dd/mm/yyyy con máscara/datepicker propio —
    // hay que limpiar el campo de verdad (seleccionar todo + borrar) antes
    // de tipear, y disparar los eventos que la máscara espera.
    async function setFecha(selectorId, ddmmyyyy) {
      if (!ddmmyyyy) return;
      await page.click(`#${selectorId}`);
      // La máscara del campo no se vacía con un simple "select all + borrar"
      // (quedaba una mezcla del valor viejo con el nuevo) — se borra de a un
      // caracter por vez con Backspace hasta vaciarlo de verdad.
      await page.evaluate((id) => document.getElementById(id)?.focus(), selectorId);
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("End");
        await page.keyboard.press("Backspace");
      }
      await page.type(`#${selectorId}`, ddmmyyyy, { delay: 40 });
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }, selectorId);
    }
    await setFecha("txtFechaDesde", fechaDesde);
    await setFecha("txtFechaHasta", fechaHasta);

    const debugAntesDeBuscar = await page.evaluate(() => ({
      fechaDesdeDOM: document.getElementById("txtFechaDesde")?.value,
      fechaHastaDOM: document.getElementById("txtFechaHasta")?.value,
      depositoDOM: document.getElementById("ddlInventarios")?.value,
      depositoTextoDOM: document.getElementById("ddlInventarios")?.selectedOptions?.[0]?.textContent,
      erroresVisibles: Array.from(document.querySelectorAll("*"))
        .filter((e) => /es mayor a la fecha/i.test(e.textContent || "") && e.children.length === 0 && e.offsetParent !== null)
        .map((e) => e.textContent.trim()),
    }));

    // Botón "Buscar" — no es un <input>, es un <button> con ese texto.
    const clickeoBuscar = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a, input[type=button]"));
      const buscar = btns.find((b) => /^buscar$/i.test((b.textContent || b.value || "").trim()));
      if (!buscar) return { ok: false, error: "No se encontró el botón Buscar", textosVistos: btns.map((b) => (b.textContent || b.value || "").trim()).filter(Boolean).slice(0, 30) };
      buscar.click();
      return { ok: true };
    });
    if (!clickeoBuscar.ok) return clickeoBuscar;

    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    // Scrapea la tabla de resultados + pagina hasta el final (botón → al
    // lado de "Mostrando X-Y de Z"), juntando todas las filas.
    async function leerFilasTabla() {
      return page.evaluate(() => {
        const filas = [];
        const tablas = Array.from(document.querySelectorAll("table"));
        // La tabla de resultados es la que tiene headers tipo "Fecha"/"Depósito"/"Stock actualizado".
        const tabla = tablas.find((t) => /stock actualizado/i.test(t.innerText));
        if (!tabla) return filas;
        const filasTr = Array.from(tabla.querySelectorAll("tbody tr"));
        for (const tr of filasTr) {
          const celdas = Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim());
          if (celdas.length >= 8) {
            filas.push({
              fecha: celdas[0], deposito: celdas[1], accion: celdas[2], codigo: celdas[3],
              producto: celdas[4], cantidadModificada: celdas[5], stockActualizado: celdas[6],
              observaciones: celdas[7], modificadoPor: celdas[8] || "",
            });
          }
        }
        return filas;
      });
    }

    const todasLasFilas = [];
    let totalTexto = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("*")).find((e) => /Mostrando \d+/i.test(e.textContent || "") && e.children.length === 0);
      return el ? el.textContent.trim() : null;
    });
    let seguir = true;
    let vueltas = 0;
    while (seguir && vueltas < 500) {
      vueltas++;
      const filas = await leerFilasTabla();
      todasLasFilas.push(...filas);
      const avanzo = await page.evaluate(() => {
        const candidatos = Array.from(document.querySelectorAll("button, a"));
        const siguiente = candidatos.find((b) => {
          const t = (b.getAttribute("aria-label") || b.title || b.textContent || "").trim();
          return /^(→|siguiente|next|>)$/i.test(t) || t === "›";
        });
        if (!siguiente || siguiente.disabled || siguiente.classList.contains("disabled")) return false;
        siguiente.click();
        return true;
      });
      if (!avanzo) seguir = false;
      else await new Promise((r) => setTimeout(r, 1200));
    }

    return { ok: true, debugAntesDeBuscar, totalTexto, totalFilas: todasLasFilas.length, filas: todasLasFilas };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    await browser.close();
  }
}

// Investigación puntual (solo lectura, no escribe nada): busca en el HTML
// de varias pantallas del sitio clásico algún link o referencia a un
// módulo de "depósitos" (para poder eventualmente renombrarlos), y en las
// páginas candidatas que encuentra, junta los nombres de webmethods que el
// propio HTML/JS menciona (patrón típico de ASP.NET: "Pagina.aspx/Metodo").
// Investigación puntual (SOLO LECTURA): busca en el HTML de varias
// pantallas del sitio clásico algún link o mención a compras/proveedores/
// ingreso de stock — para encontrar dónde (si existe) Contabilium guarda el
// precio con el que entró cada unidad al stock, necesario para reconstruir
// una valorización histórica a una fecha pasada (pedido 21/10/2026).
async function explorarModuloCompras({ db, email, password }) {
  const cookie = await getCookieValida(db, email, password);
  const paginasBase = [
    `${BASE}/`,
    `${BASE}/modulos/home/home.aspx`,
    `${BASE}/modulos/inventarios/inventarios.aspx`,
    `${BASE}/modulos/inventarios/movimientosDeStocke.aspx`,
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

  const palabrasClave = /compra|proveedor|ingreso\s*de\s*stock|alta\s*de\s*stock|orden\s*de\s*compra/i;
  const linkConTextoRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]{0,80})<\/a>/gi;
  const menuCandidatos = new Set();
  for (const [, { html }] of Object.entries(htmlsPorPagina)) {
    if (!html) continue;
    let m;
    while ((m = linkConTextoRegex.exec(html))) {
      const [, href, texto] = m;
      if (palabrasClave.test(texto)) menuCandidatos.add(`${texto.trim()} -> ${href}`);
    }
  }

  // Texto plano del cuerpo (por si el menú arma la navegación por JS y el
  // texto no está en un <a href>).
  const contextoPorPagina = {};
  for (const [pagina, { html }] of Object.entries(htmlsPorPagina)) {
    if (!html) continue;
    const textoPlano = html.replace(/\s+/g, " ");
    const hits = [];
    let mh;
    const buscador = /compra\w*|proveedor\w*/gi;
    while ((mh = buscador.exec(textoPlano)) && hits.length < 15) {
      hits.push(textoPlano.slice(Math.max(0, mh.index - 60), mh.index + 60));
    }
    if (hits.length) contextoPorPagina[pagina] = hits;
  }

  return {
    paginasCandidatasPorTextoDeMenu: [...menuCandidatos].sort(),
    contextoDeMencionesEnElCuerpo: contextoPorPagina,
    tamañosHtmlBase: Object.fromEntries(Object.entries(htmlsPorPagina).map(([k, v]) => [k, v.html ? v.html.length : v.error])),
  };
}

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

// Descarga el archivo apuntado por un Href relativo tal cual lo devuelve
// Contabilium (ej. "/pdfGenerator.ashx?file=X.pdf&year=2026") — sin
// "tipoDeArchivo", ese parámetro era una adivinanza equivocada; el real es
// "year". Confirmado capturando el pedido real de la propia consola.
async function bajarPdfPorHref(cookie, href) {
  const url = href.startsWith("http") ? href : `${BASE}${href}`;
  try {
    const res = await fetch(url, { headers: apiHeadersFactory(cookie, { Accept: "application/pdf,*/*" }) });
    const buf = Buffer.from(await res.arrayBuffer());
    const esPdfReal = res.ok && buf.length > 4 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
    // Si no vino un PDF real, el cuerpo suele ser corto (página de error,
    // sesión vencida, "archivo no encontrado") — se guarda para poder ver
    // la razón real en vez de solo el tamaño en bytes.
    const textoError = !esPdfReal ? buf.subarray(0, 300).toString("utf8") : null;
    return { ok: esPdfReal, status: res.status, bytes: buf.length, pdfBase64: esPdfReal ? buf.toString("base64") : null, textoError };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const COMPROBANTES_PAGE = `${BASE}/comprobantes.aspx`;

// Flujo real confirmado capturando el pedido exacto que hace la propia
// consola de Contabilium al abrir una factura (DevTools → Network →
// common.aspx/ObtenerComprobante, Referer: comprobantes.aspx): la respuesta
// trae el campo "Href" con "file" y "year", pero OJO — ese Href solo no
// alcanza. Confirmado el 2026-10-07 mirando el pedido real que dispara el
// botón "Descargar Factura" de la propia consola: a esa misma URL le suma
// un tercer parámetro, "idComprobante", que la respuesta de ObtenerComprobante
// NO incluye. Sin él, pdfGenerator.ashx devuelve "Archivo desconocido!" para
// comprobantes con nombre de archivo largo (ej. razón social extensa) —
// aparentemente Contabilium usa ese id para resolver/generar el archivo
// cuando el nombre por sí solo no asocia unívocamente, y sin él a veces
// encuentra el PDF (nombres cortos) y a veces no (nombres largos).
async function obtenerPdfComprobante({ db, email, password, idComprobante }) {
  const cookie = await getCookieValida(db, email, password);
  const intentos = [];

  let detalle;
  try {
    detalle = await postWebMethod(cookie, "ObtenerComprobante", { idComprobante }, COMMON_PAGE, COMPROBANTES_PAGE);
    intentos.push({ paso: "ObtenerComprobante", href: detalle?.Href, path: detalle?.Path });
  } catch (e) {
    intentos.push({ paso: "ObtenerComprobante", error: e.message });
    return { ok: false, pdfBase64: null, intentos };
  }

  if (!detalle?.Href) {
    intentos.push({ paso: "ObtenerComprobante", error: "La respuesta no trajo Href" });
    return { ok: false, pdfBase64: null, intentos };
  }

  const separador = detalle.Href.includes("?") ? "&" : "?";
  const hrefCompleto = `${detalle.Href}${separador}idComprobante=${idComprobante}`;
  const r = await bajarPdfPorHref(cookie, hrefCompleto);
  intentos.push({ paso: "bajarPdfPorHref", href: hrefCompleto, status: r.status, bytes: r.bytes, ok: r.ok, error: r.error, textoError: r.textoError });
  if (r.ok) {
    return { ok: true, pdfBase64: r.pdfBase64, archivo: detalle.Path, intentos };
  }
  return { ok: false, pdfBase64: null, intentos };
}

// La API nueva de Contabilium (api.contabilium.com/v2 — la que usa el SPA
// moderno, distinta de la REST API oficial de rest.contabilium.com que ya
// usamos en contabiliumService.js) pide un JWT propio vía
// common.aspx/getTokenV2, usando la MISMA cookie de sesión ASP.NET que ya
// tenemos de Puppeteer (confirmado por captura real, 7/10/2026) — no hace
// falta loguear de nuevo, solo pedir este token con la cookie que ya
// tenemos. Dura ~12hs (visto en el JWT: exp-iat = 43200s), así que lo
// cacheamos en Firestore y lo renovamos cuando venza.
const API_V2_TOKEN_DOC = "internalData/contabiliumApiV2Token";
const MOVIMIENTOS_PAGE = `${BASE}/modulos/inventarios/movimientosDeStock.aspx`;

async function obtenerTokenApiV2(db, cookie) {
  const snap = await db.doc(API_V2_TOKEN_DOC).get();
  const data = snap.exists ? snap.data() : null;
  if (data?.token && data?.expiraEn && Date.now() < data.expiraEn - 60000) {
    return data.token;
  }
  const token = await postWebMethod(cookie, "getTokenV2", {}, `${BASE}/common.aspx`, MOVIMIENTOS_PAGE);
  if (!token) throw new Error("getTokenV2 no devolvió token");
  // Igual que se ve en el JWT real: nbf/iat ahora, exp 12hs después — no
  // hace falta decodificarlo, alcanza con guardar la expiración aproximada.
  await db.doc(API_V2_TOKEN_DOC).set({ token, expiraEn: Date.now() + 11.5 * 60 * 60 * 1000 });
  return token;
}

// Trae TODOS los movimientos entre depósitos de un rango de fechas,
// paginando solo (la API real pagina de a 50) — para el panel de
// "Movimientos" que lee la observación de cada uno y distingue cuánto
// salió de nuestros depósitos a cada cliente/distribuidor, mes a mes.
async function obtenerMovimientosStock({ db, email, password, fechaDesde, fechaHasta, idOrigen = "", idDestino = "", concepto = "" }) {
  let cookie = await getCookieValida(db, email, password);
  let tokenApi = await obtenerTokenApiV2(db, cookie);

  async function pedirPagina(pageNumber) {
    const params = new URLSearchParams({
      idOrigen: String(idOrigen),
      idDestino: String(idDestino),
      concepto: String(concepto),
      fechaDesde: fechaDesde || "",
      fechaHasta: fechaHasta || "",
      pageSize: "50",
      pageNumber: String(pageNumber),
    });
    const res = await fetch(`https://api.contabilium.com/v2/movinventarios/GetPageWithFilters?${params.toString()}`, {
      headers: { Accept: "*/*", Authorization: `Bearer ${tokenApi}` },
    });
    if (res.status === 401) return null; // token vencido, hay que renovar
    if (!res.ok) throw new Error(`movinventarios/GetPageWithFilters respondió ${res.status}`);
    return res.json();
  }

  const todos = [];
  let pageNumber = 1;
  const MAX_PAGINAS = 100; // 100 x 50 = 5000 movimientos de margen, de sobra
  while (pageNumber <= MAX_PAGINAS) {
    let data = await pedirPagina(pageNumber);
    if (data === null) {
      // Token vencido a mitad de camino — se renueva una vez y se reintenta
      // esa misma página (no hace falta arrancar de cero).
      await db.doc(API_V2_TOKEN_DOC).delete().catch(() => {});
      tokenApi = await obtenerTokenApiV2(db, cookie);
      data = await pedirPagina(pageNumber);
      if (data === null) throw new Error("No se pudo renovar el token de la API v2");
    }
    const items = Array.isArray(data) ? data : (data?.items || data?.Items || []);
    if (items.length === 0) break;
    todos.push(...items);
    if (items.length < 50) break;
    pageNumber++;
  }
  return todos;
}

// Tercera API de Contabilium descubierta (vir-internalapi.contabilium.com),
// la que usa el formulario nuevo "Editar producto" (v3/attributes/edition) —
// distinta tanto de la REST pública (rest.contabilium.com, que rechaza el
// PUT de conceptos por el campo "Tipo") como de la v2 (api.contabilium.com,
// usada para movimientos). Confirmado por captura real de red, 16/10/2026:
// el Bearer token es LITERAL el valor de la cookie "Secure-1CBL" que ya
// conseguimos con loginYSacarCookie — no hace falta pedir un token aparte.
// El payload no tiene campo "Tipo" en absoluto.
const VIR_INTERNAL_API = "https://vir-internalapi.contabilium.com/api/products";

function extraerSecure1CBL(cookie) {
  const match = /(?:^|;\s*)Secure-1CBL=([^;]+)/.exec(cookie);
  if (!match) throw new Error("La cookie no tiene Secure-1CBL — ¿falló el login?");
  return match[1];
}

// `concepto` es el objeto crudo tal cual lo devuelve getAllConceptos (REST
// vieja, de solo lectura) — de ahí sacamos todos los campos que no cambian,
// mapeados al formato que espera esta API nueva. `nuevoPrecioConIva` es el
// único valor que realmente queremos modificar.
async function actualizarPrecioProductoWeb({ db, email, password, concepto, nuevoPrecioConIva }) {
  const cookie = await getCookieValida(db, email, password);
  const token = extraerSecure1CBL(cookie);

  const body = {
    name: concepto.Nombre || "",
    status: concepto.Estado === "Activo" ? "A" : "I",
    description: concepto.Descripcion || "",
    // IdRubro/IdSubrubro a veces vienen como string vacío ("") en vez de
    // null cuando el producto no tiene subrubro cargado — Number("") da 0,
    // que Contabilium rechaza como un subrubro inexistente (QUERY_EXCEPTION).
    headingId: concepto.IdRubro ? Number(concepto.IdRubro) : null,
    subHeadingId: concepto.IdSubrubro ? Number(concepto.IdSubrubro) : null,
    code: concepto.Codigo || "",
    barcode: concepto.CodigoBarras || "",
    minStock: Number(concepto.StockMinimo || 0),
    currencyId: concepto.IDMoneda != null ? Number(concepto.IDMoneda) : null,
    internalCost: Number(concepto.CostoInterno || 0),
    profitability: Number(concepto.Rentabilidad || 0),
    unitPrice: Number(nuevoPrecioConIva),
    iva: 21,
    visible: true,
    RG5329: !!concepto.AplicaRG5329,
    observations: concepto.Observaciones || "",
    ivaRateId: 5, // visto en captura real para 21% — todo el catálogo usa 21%
    unitPriceForAll: false,
    ivaForAll: false,
  };

  const res = await fetch(`${VIR_INTERNAL_API}/${concepto.Id}`, {
    method: "PUT",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Authorization: token,
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let respBody;
  try { respBody = JSON.parse(text); } catch { respBody = text; }
  if (!res.ok) {
    const msg = typeof respBody === "string" ? respBody : (respBody?.message || respBody?.Message || JSON.stringify(respBody));
    throw new Error(`vir-internalapi no pudo actualizar el producto (status ${res.status}): ${msg}`);
  }
  return respBody;
}

module.exports = {
  ajustarStockWeb,
  transferirStockWeb,
  generarRemitoAutoDesdeTransferencia,
  obtenerPdfRemitoPorNumero,
  obtenerPdfComprobante,
  asignarProveedorARemito,
  listarRemitosCompletos,
  getCookieValida,
  invalidarCookie,
  probarCandidatosIdCC,
  diagObtenerRemito,
  probarWebmethodsMovimientos,
  explorarModuloDepositos,
  explorarModuloCompras,
  explorarHistoricoStock,
  obtenerHistoricoStockReal,
  renombrarDepositoWeb,
  crearDepositoWeb,
  crearComprobanteWeb,
  PROVINCIAS_ARGENTINA,
  listarCiudadesWeb,
  listarChequesDisponiblesWeb,
  obtenerRemitoPorId,
  editarObservacionRemito,
  cargarChequeWeb,
  resolverIdBanco,
  obtenerMapaBancos,
  BANCOS_TESORERIA,
  cargarCobranzaACuentaWeb,
  obtenerBancosPropios,
  obtenerCajasPropias,
  resolverIdBancoPropio,
  aplicarPagoFacturaWeb,
  obtenerMovimientosStock,
  descargarRemitoPorArchivoWeb,
  actualizarPrecioProductoWeb,
};
