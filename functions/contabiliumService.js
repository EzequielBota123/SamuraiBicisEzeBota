const TOKEN_URL = "https://rest.contabilium.com/token";
const API_BASE  = "https://rest.contabilium.com/api";
const PAGE_SIZE = 100;

let _token = null;
let _tokenExpiry = 0;

async function getAccessToken(email, apiKey) {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     String(email || "").trim(),
    client_secret: String(apiKey || "").trim(),
  });
  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Contabilium auth error ${res.status}: ${detail}`);
  }
  const { access_token } = await res.json();
  _token = access_token;
  _tokenExpiry = Date.now() + 4 * 60 * 60 * 1000;
  return _token;
}

// /conceptos/search ignora pageIndex/pageSize por completo (confirmado con
// pruebas contra la API real) — el parámetro que realmente pagina es "page",
// y el tamaño de página real es fijo (no lo que pidamos). Paginamos hasta
// recibir una página vacía, con un tope de seguridad.
async function getAllConceptos(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const all = [];
  let page = 1;
  while (page <= 200) {
    const res = await fetch(
      `${API_BASE}/conceptos/search?page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Contabilium conceptos error ${res.status}`);
    const { Items = [] } = await res.json();
    if (Items.length === 0) break;
    all.push(...Items);
    page++;
  }
  return all;
}

// Trae todo el stock de un depósito puntual (paginado)
async function getStockByDeposito(email, apiKey, depositoId) {
  const token = await getAccessToken(email, apiKey);
  const all = [];
  let page = 0;
  while (true) {
    const res = await fetch(
      `${API_BASE}/inventarios/getStockByDeposito?id=${depositoId}&page=${page}&pageSize=${PAGE_SIZE}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const err = new Error(`Contabilium stock por depósito error ${res.status}`);
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter) err.retryAfterSeconds = Number(retryAfter);
      throw err;
    }
    const { Items = [], TotalPage = 1 } = await res.json();
    all.push(...Items);
    page++;
    if (page >= TotalPage || Items.length === 0) break;
  }
  return all;
}

// Trae el listado completo de depósitos/almacenes. El endpoint dedicado
// (/inventarios/getDepositos) solo devuelve el depósito propio de Samurai,
// no los de consignación por distribuidor. En cambio, getStockBySKU trae
// en su campo "stock" el desglose por TODOS los depósitos (incluidos los
// de consignación) para el producto consultado — así que lo usamos como
// fuente real de la lista completa, ignorando el stock en sí.
async function getDepositosViaStockBySKU(email, apiKey, sku) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(
    `${API_BASE}/inventarios/getStockBySKU?codigo=${encodeURIComponent(sku)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Contabilium getStockBySKU error ${res.status}`);
  const data = await res.json();
  const stock = Array.isArray(data.stock) ? data.stock : [];
  return stock.map((s) => ({ id: s.Id, nombre: (s.Codigo || "").trim() }));
}

// Depósitos propios de Samurai (no de consignación por distribuidor): stock
// libre para asignar a pedidos nuevos = suma de estos tres, sin contar lo
// que ya está repartido en depósitos de clientes puntuales.
const DEPOSITOS_PROPIOS = [135151, 133531, 131151]; // Lavalle, Depósito Cañuelas, CREDIFIN

// Trae, para un SKU puntual, el stock realmente disponible para asignar a
// pedidos nuevos (suma de los depósitos propios, no el total de la empresa).
async function getStockDisponibleBySKU(email, apiKey, sku) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(
    `${API_BASE}/inventarios/getStockBySKU?codigo=${encodeURIComponent(sku)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Contabilium getStockBySKU error ${res.status}`);
  const data = await res.json();
  const stock = Array.isArray(data.stock) ? data.stock : [];
  return stock
    .filter((s) => DEPOSITOS_PROPIOS.includes(s.Id))
    .reduce((acc, s) => acc + Number(s.StockActual || 0), 0);
}

// Mismo pedido que getStockDisponibleBySKU (un solo golpe a Contabilium),
// pero en vez de descartar el desglose por depósito, lo devuelve completo:
// cuánto hay en cada uno de los 3 depósitos propios por separado, y cuánto
// hay en total repartido en depósitos de clientes (consignado). Se usa para
// la vista "Stock por depósito" del panel de Productos — ahí no alcanza con
// el total combinado que guarda el sync normal, hace falta depósito por
// depósito.
async function getStockDesglosadoBySKU(email, apiKey, sku) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(
    `${API_BASE}/inventarios/getStockBySKU?codigo=${encodeURIComponent(sku)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Contabilium getStockBySKU error ${res.status}`);
  const data = await res.json();
  const stock = Array.isArray(data.stock) ? data.stock : [];
  const porId = new Map(stock.map((s) => [s.Id, Number(s.StockActual || 0)]));
  const [lavalleId, canuelasId, credifinId] = DEPOSITOS_PROPIOS;
  const lavalle = porId.get(lavalleId) || 0;
  const canuelas = porId.get(canuelasId) || 0;
  const credifin = porId.get(credifinId) || 0;
  const totalGeneral = stock.reduce((acc, s) => acc + Number(s.StockActual || 0), 0);
  return {
    lavalle,
    canuelas,
    credifin,
    propiosTotal: lavalle + canuelas + credifin,
    consignadoTotal: Math.max(0, totalGeneral - lavalle - canuelas - credifin),
  };
}

// Trae un cliente de Contabilium por su Id
async function getClientById(email, apiKey, contabiliumId) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(
    `${API_BASE}/clientes/${contabiliumId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Contabilium clientes error ${res.status}`);
  return res.json();
}

// Busca un cliente por CUIT/DNI (NroDoc)
// OJO: /clientes/search?nroDoc= ignora por completo el filtro nroDoc (mismo
// tipo de bug que cobranzas/conceptos/comprobantes) — siempre devuelve los
// primeros 5 clientes alfabéticamente, sin importar el documento pedido.
// El parámetro que sí funciona es "filtro" (busca por razón social/doc como
// texto libre); filtramos acá el match exacto de NroDoc del lado nuestro.
async function searchClientByDoc(email, apiKey, nroDoc) {
  const candidatos = await searchClientesByFiltro(email, apiKey, nroDoc);
  const nroDocLimpio = String(nroDoc || "").replace(/\D/g, "");
  const match = candidatos.find((c) => (c.NroDoc || "").replace(/\D/g, "") === nroDocLimpio);
  return match || null;
}

// Busca clientes por razón social/nombre (o cuit/doc) usando el parámetro
// "filtro" documentado en /clientes/search.
async function searchClientesByFiltro(email, apiKey, filtro) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(
    `${API_BASE}/clientes/search?pageSize=10&filtro=${encodeURIComponent(filtro)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Contabilium clientes search error ${res.status}`);
  const { Items = [] } = await res.json();
  return Items;
}

// Trae TODOS los clientes cargados en Contabilium (paginado, mismo patrón
// que getAllConceptos: el parámetro real que pagina es "page", tamaño fijo).
// Uso: CRM interno, para asignar a vendedores/telemarketers la base real de
// Contabilium en vez de solo los usuarios que se registraron en la app.
async function getAllClientes(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const all = [];
  let page = 1;
  while (page <= 200) {
    const res = await fetch(
      `${API_BASE}/clientes/search?page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Contabilium clientes error ${res.status}`);
    const { Items = [] } = await res.json();
    if (Items.length === 0) break;
    all.push(...Items);
    page++;
  }
  return all;
}

// Trae todos los comprobantes de un período y filtra por cliente server-side
// (la API de Contabilium no soporta filtro por IdCliente en /search).
// OJO: /comprobantes/search ignora pageIndex/pageSize por completo (mismo
// bug que cobranzas/conceptos) — el parámetro real es "page", tamaño fijo
// de 50 por página. Sin esto, siempre se veía solo la página 1 de toda la
// empresa, así que la mayoría de los clientes no traían sus facturas reales.
async function getComprobantesByClientId(email, apiKey, contabiliumId, {
  // Incluye las variantes B y C de factura/nota, no solo A — Contabilium a
  // veces emite Factura B (ver diagTiposComprobante), y quedaban afuera del
  // saldo de cuenta corriente si solo se pedía FCA.
  tipos = ["FCA", "FCB", "FCC", "NCA", "NCB", "NCC", "NCT", "NDA", "NDB", "NDC"],
  desde = null,
  hasta = null,
} = {}) {
  const token = await getAccessToken(email, apiKey);

  const fechaHasta = hasta || new Date().toISOString().slice(0, 10);
  // Sin límite de 2 años por defecto: para el saldo real hace falta el
  // historial completo del cliente, no solo lo reciente.
  const defaultDesde = new Date();
  defaultDesde.setFullYear(defaultDesde.getFullYear() - 15);
  const fechaDesde = desde || defaultDesde.toISOString().slice(0, 10);

  const all = [];
  let page = 1;
  const MAX_PAGES = 60; // seguridad: máx ~3000 comprobantes de la empresa

  while (page <= MAX_PAGES) {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      page: String(page),
      fechaDesde,
      fechaHasta,
    });

    const res = await fetch(
      `${API_BASE}/comprobantes/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Contabilium comprobantes error ${res.status}`);
    const payload = await res.json();
    const Items = Array.isArray(payload?.Items) ? payload.Items : (Array.isArray(payload) ? payload : []);
    if (Items.length === 0) break;

    const filtered = Items.filter(
      (c) => c.IdCliente === contabiliumId && tipos.includes(c.TipoFc)
    );
    all.push(...filtered);

    page++;
  }

  all.sort((a, b) => (b.FechaEmision || "").localeCompare(a.FechaEmision || ""));
  return all;
}

// Trae TODOS los comprobantes de la empresa en un rango de fechas (de
// cualquier cliente), sin filtrar por tipo — para reportes globales como
// contar remitos despachados. A diferencia de getComprobantesByClientId, no
// filtra por IdCliente.
async function getAllComprobantes(email, apiKey, { desde, hasta } = {}) {
  const token = await getAccessToken(email, apiKey);

  const fechaHasta = hasta || new Date().toISOString().slice(0, 10);
  const defaultDesde = new Date();
  defaultDesde.setFullYear(defaultDesde.getFullYear() - 15);
  const fechaDesde = desde || defaultDesde.toISOString().slice(0, 10);

  const all = [];
  let page = 1;
  const MAX_PAGES = 200;

  while (page <= MAX_PAGES) {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      page: String(page),
      fechaDesde,
      fechaHasta,
    });
    const res = await fetch(
      `${API_BASE}/comprobantes/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Contabilium comprobantes error ${res.status}`);
    const payload = await res.json();
    const Items = Array.isArray(payload?.Items) ? payload.Items : (Array.isArray(payload) ? payload : []);
    if (Items.length === 0) break;
    all.push(...Items);
    page++;
  }

  return all;
}

// Diagnóstico temporal: respuesta cruda de /clientes/search?nroDoc= para
// ver si el filtro realmente funciona.
async function debugClienteSearchRaw(email, apiKey, nroDoc) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(
    `${API_BASE}/clientes/search?pageSize=5&pageIndex=1&nroDoc=${encodeURIComponent(nroDoc)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await res.json();
  return { status: res.status, body };
}

// Diagnóstico temporal: busca un cliente por CUIT y suma el Saldo de todas
// sus facturas (con el fix de paginación), para comparar contra el reporte
// real de "Cuenta corriente" de Contabilium.
async function debugSaldoByCuit(email, apiKey, cuit) {
  const candidatos = await searchClientesByFiltro(email, apiKey, cuit);
  const cliente = candidatos.find((c) => (c.NroDoc || "").replace(/\D/g, "") === cuit.replace(/\D/g, "")) || candidatos[0];
  if (!cliente) return { error: "No se encontró cliente con ese CUIT", candidatos };
  const comprobantes = await getComprobantesByClientId(email, apiKey, cliente.Id);
  const parseAr = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", "."));
  const saldoTotal = comprobantes.reduce((acc, c) => {
    const saldoAbs = parseAr(c.Saldo);
    return acc + (["NCA", "NCB", "NCC", "NCT"].includes(c.TipoFc) ? -saldoAbs : saldoAbs);
  }, 0);
  return {
    contabiliumId: cliente.Id,
    razonSocial: cliente.RazonSocial,
    totalComprobantes: comprobantes.length,
    saldoTotal,
    detalle: comprobantes.map((c) => ({
      Tipo: c.TipoFc,
      Numero: c.Numero,
      Fecha: c.FechaEmision,
      Total: c.ImporteTotalNeto,
      Saldo: c.Saldo,
      SaldoParsed: parseAr(c.Saldo),
    })),
  };
}

// Diagnóstico temporal: prueba si /comprobantes/search pagina de verdad con
// pageIndex, o si (como cobranzas/conceptos) hay que usar "page".
async function debugComprobantesPaging(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const authHeaders = { Authorization: `Bearer ${token}` };
  const fechaHasta = new Date().toISOString().slice(0, 10);
  const desde10y = new Date();
  desde10y.setFullYear(desde10y.getFullYear() - 10);
  const fechaDesde = desde10y.toISOString().slice(0, 10);

  const base = { fechaDesde, fechaHasta };
  const variants = [
    { pageSize: "100", pageIndex: "1" },
    { pageSize: "100", pageIndex: "2" },
    { pageSize: "100", page: "2" },
  ];
  const results = [];
  for (const v of variants) {
    const params = new URLSearchParams({ ...base, ...v });
    const r = await fetch(`${API_BASE}/comprobantes/search?${params.toString()}`, { headers: authHeaders });
    const body = await r.json();
    const items = Array.isArray(body?.Items) ? body.Items : (Array.isArray(body) ? body : []);
    results.push({
      variant: v,
      status: r.status,
      itemsCount: items.length,
      TotalItems: body?.TotalItems,
      firstIds: items.slice(0, 3).map((c) => c.Id),
    });
  }
  return results;
}

// Trae el detalle completo de un comprobante (líneas de ítems) para generar PDF
async function getComprobanteById(email, apiKey, id) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(
    `${API_BASE}/comprobantes/${id}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Contabilium comprobante ${id} error ${res.status}`);
  return res.json();
}

// /cobranzas/search ignora pageIndex/pageSize por completo: siempre devuelve
// los mismos 50 registros más recientes del rango pedido (confirmado con
// pruebas contra la API real). Paginamos "a mano" achicando fechaHasta a la
// fecha más antigua del lote devuelto, hasta cubrir todo el rango.
const COBRANZAS_FIXED_PAGE_SIZE = 50;

function parseFechaDDMMYYYY(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ""));
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function toYYYYMMDD(d) {
  return d.toISOString().slice(0, 10);
}

// Trae el listado completo de cobranzas de un rango de fechas (sin detalle
// de formas de pago — eso requiere getCobranzaById por cada una).
// Igual que comprobantes/search: /cobranzas/search también soporta
// paginación real por `page` (a diferencia de lo que asume getCobranzasList,
// que recorta la ventana de fechas asumiendo que ese filtro funciona). Este
// método pagina por `page` sin filtro de fechas y filtra del lado nuestro
// por IDPersona, para encontrar cobranzas que el otro método se salteaba.
async function buscarCobranzasPorClientePaginado(email, apiKey, idPersona) {
  const token = await getAccessToken(email, apiKey);
  const found = [];
  let page = 1;
  let totalSeen = 0;
  const MAX_PAGES = 200;
  const fechaDesde15aa = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 15);
    return d.toISOString().slice(0, 10);
  })();
  const fechaHastaHoy = new Date().toISOString().slice(0, 10);
  const seenIds = new Set();
  while (page <= MAX_PAGES) {
    const params = new URLSearchParams({
      pageSize: "50",
      page: String(page),
      fechaDesde: fechaDesde15aa,
      fechaHasta: fechaHastaHoy,
    });
    const res = await fetch(`${API_BASE}/cobranzas/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`cobranzas/search error ${res.status}`);
    const { Items = [] } = await res.json();
    if (Items.length === 0) break;
    let newCount = 0;
    for (const it of Items) {
      const id = it.ID ?? it.Id;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      newCount++;
      totalSeen++;
      const idp = it.IDPersona ?? it.IdPersona;
      if (idp === idPersona) {
        found.push({ id, numero: it.Numero, fecha: it.Fecha });
      }
    }
    if (newCount === 0) break; // la página se repite: no hay paginación real
    page++;
  }
  return { pagesRead: page - 1, totalSeen, foundCount: found.length, found };
}

async function probeBancosEndpoints(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const candidatos = ["bancos", "cuentasbancarias", "cuentas", "bancos/search", "cuentasbancarias/search"];
  const out = {};
  for (const path of candidatos) {
    try {
      const res = await fetch(`${API_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      out[path] = { status: res.status, body: text.slice(0, 500) };
    } catch (err) {
      out[path] = { error: String(err) };
    }
  }
  return out;
}

// Diagnóstico: busca el endpoint real de "Movimientos entre depósitos" (lo
// que se ve en Inventarios en la UI de Contabilium) probando variantes de
// nombre candidatas, tanto GET como con un pequeño POST de prueba.
// Diagnóstico: busca el endpoint real de "Cheques" (cartera de cheques
// recibidos/propios) para poder encontrar el ID interno de un cheque ya
// cargado a mano en Contabilium y así poder imputarlo desde /comprobantes/cobrar.
async function probeChequesEndpoints(email, apiKey, nroCheque) {
  const token = await getAccessToken(email, apiKey);
  const candidatos = [
    `cheques/search?nroCheque=${nroCheque}`,
    `cheques?nroCheque=${nroCheque}`,
    `cheques/search`,
    `cheques`,
    `chequesrecibidos/search?nroCheque=${nroCheque}`,
    `chequesrecibidos`,
    `tesoreria/cheques/search?nroCheque=${nroCheque}`,
    `tesoreria/cheques`,
  ];
  const out = {};
  for (const path of candidatos) {
    try {
      const res = await fetch(`${API_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      out[path] = { status: res.status, body: text.slice(0, 800) };
    } catch (err) {
      out[path] = { error: String(err) };
    }
  }
  return out;
}

async function probeMovimientosDepositoEndpoints(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const candidatosGet = [
    "movimientosdeposito",
    "movimientosdeposito/search",
    "movimientos-deposito",
    "movimientodeposito",
    "movimientodeposito/search",
    "depositomovimientos",
    "depositomovimientos/search",
    "depositos/movimientos",
    "stockmovimientos",
    "stockmovimientos/search",
    "movimientostock",
    "movimientostock/search",
    "traslados",
    "traslados/search",
    "transferenciasdeposito",
    "transferenciasdeposito/search",
    "movimientosentredepositos",
    "movimientosentredepositos/search",
    "inventarios/movimientos",
    "inventario/movimientos",
    "inventariomovimientos",
    "inventariomovimientos/search",
    "stock/transferencia",
    "stock/transferencias",
    "depositos/transferencia",
    "depositos/transferencias",
    "depositos/traslado",
    "depositos/traslados",
    "movimientointerno",
    "movimientosinternos",
    "movimientosinternos/search",
    "remitointerno",
    "remitosinternos",
    "remitosinternos/search",
    "movimientostockdeposito",
    "movimientostockdeposito/search",
    "movimientosstock",
    "movimientosstock/search",
    "transferenciastock",
    "transferenciastock/search",
    "movimientoentredepositos",
  ];
  const out = { get: {} };
  for (const path of candidatosGet) {
    try {
      const res = await fetch(`${API_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      out.get[path] = { status: res.status, body: text.slice(0, 300) };
    } catch (err) {
      out.get[path] = { error: String(err) };
    }
  }
  return out;
}

// Sondeo de endpoints de compras/proveedores/alta de stock inicial — para
// investigar si Contabilium registra en algún lado el precio con el que
// entró cada unidad (necesario para reconstruir una valorización de stock
// histórica a una fecha pasada, pedido 21/10/2026).
async function probeComprasEndpoints(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const candidatosGet = [
    "compras", "compras/search",
    "ordenescompra", "ordenescompra/search", "ordenesdecompra", "ordenesdecompra/search",
    "facturascompra", "facturascompra/search", "facturasdecompra", "facturasdecompra/search",
    "comprobantescompra", "comprobantescompra/search",
    "proveedores", "proveedores/search",
    "ingresos", "ingresos/search", "ingresosdestock", "ingresosdestock/search",
    "altastock", "altastock/search", "altadestock", "altadestock/search",
    "remitoscompra", "remitoscompra/search",
    "stock/ingreso", "stock/ingresos", "stock/altas", "stock/alta",
    "inventarios/compras", "inventarios/ingresos", "inventarios/altas",
  ];
  const out = { get: {} };
  for (const path of candidatosGet) {
    try {
      const res = await fetch(`${API_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      out.get[path] = { status: res.status, body: text.slice(0, 400) };
    } catch (err) {
      out.get[path] = { error: String(err) };
    }
  }
  return out;
}

async function testPageIndexRaw(email, apiKey, fechaDesde, fechaHasta) {
  const token = await getAccessToken(email, apiKey);
  const out = {};
  for (const pageIndex of [1, 2, 3]) {
    const params = new URLSearchParams({ pageSize: "50", pageIndex: String(pageIndex), fechaDesde, fechaHasta });
    const res = await fetch(`${API_BASE}/cobranzas/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = res.ok ? await res.json() : { error: `status ${res.status}` };
    const items = body.Items || [];
    out[`pageIndex${pageIndex}`] = {
      status: res.status,
      count: items.length,
      firstIds: items.slice(0, 5).map((it) => it.ID ?? it.Id),
      lastIds: items.slice(-5).map((it) => it.ID ?? it.Id),
    };
  }
  return out;
}

async function getCobranzasList(email, apiKey, { fechaDesde, fechaHasta }) {
  const token = await getAccessToken(email, apiKey);
  const seen = new Map(); // id -> item
  const desdeDate = new Date(fechaDesde);
  let cursorHasta = fechaHasta;
  let guard = 0;

  while (guard++ < 500) {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      pageIndex: "1",
      fechaDesde,
      fechaHasta: cursorHasta,
    });
    const res = await fetch(`${API_BASE}/cobranzas/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Contabilium cobranzas/search error ${res.status}`);
    const { Items = [] } = await res.json();
    if (Items.length === 0) break;

    let minFecha = null;
    let newCount = 0;
    for (const it of Items) {
      const id = it.ID ?? it.Id;
      if (!seen.has(id)) {
        seen.set(id, it);
        newCount++;
      }
      const f = parseFechaDDMMYYYY(it.Fecha);
      if (f && (!minFecha || f < minFecha)) minFecha = f;
    }

    // Menos de una página completa: ya llegamos al principio del rango.
    if (Items.length < COBRANZAS_FIXED_PAGE_SIZE) break;
    if (!minFecha || minFecha < desdeDate) break;

    if (newCount === 0) break; // sin progreso, cortamos

    let nextHasta = toYYYYMMDD(minFecha);
    if (nextHasta === cursorHasta) {
      // Los 50 ítems son del mismo día que el cursor: retrocedemos un día
      // más para no quedar trabados (podríamos perder algún ítem extra de
      // ese día puntual si hay +50 cobranzas en 24hs, caso muy improbable).
      const prev = new Date(minFecha);
      prev.setDate(prev.getDate() - 1);
      nextHasta = toYYYYMMDD(prev);
    }
    cursorHasta = nextHasta;
  }

  return Array.from(seen.values());
}

// Convierte un comprobante creado en modo borrador (/comprobantes/crear) en
// una factura electrónica real: le pide el CAE y el número definitivo a
// AFIP. Sin este paso el comprobante queda como borrador para siempre —
// visible en Contabilium con número "0001-00000000" y sin CAE — hasta que
// alguien lo termine a mano desde la web. Solo aplica a comprobantes
// fiscales (FCA/FCB/FCC); las Cotizaciones (COT) ya salen con número real
// desde /comprobantes/crear, no son documentos AFIP.
async function emitirFacturaElectronica(email, apiKey, id) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(`${API_BASE}/comprobantes/emitirFE?id=${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium no pudo emitir la factura electrónica: ${msg}`);
  }
  if (body?.Error) {
    throw new Error(`Contabilium rechazó la emisión electrónica: ${body.Error}`);
  }
  return body;
}

// Registra un recibo de cobranza contra un comprobante puntual — es lo que
// descuenta el "Debe" de un cliente sin pasar por facturación. `saldo` es
// el saldo que le queda al comprobante DESPUÉS de este recibo ("0" = se
// canceló entero); `pagos` son las formas de pago del recibo.
async function cobrarComprobante(email, apiKey, { id, importeTotalNeto, saldo, fecha, pagos }) {
  const token = await getAccessToken(email, apiKey);
  const payload = {
    Id: id,
    ImporteTotalNeto: String(importeTotalNeto),
    Saldo: String(saldo),
    // Sin esto Contabilium le pone la fecha de hoy al recibo — se manda solo
    // si el staff eligió una fecha distinta a propósito (asentar un pago
    // recibido otro día).
    ...(fecha ? { Fecha: fecha } : {}),
    Pagos: pagos,
  };
  const res = await fetch(`${API_BASE}/comprobantes/cobrar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium rechazó el recibo: ${msg}`);
  }
  return body;
}

// Trae el detalle completo de una cobranza (incluye FormasDePago con
// NroReferencia — cheque, transferencia, etc.)
async function getCobranzaById(email, apiKey, id) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(`${API_BASE}/cobranzas/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Contabilium cobranza ${id} error ${res.status}`);
  return res.json();
}

// Diagnóstico temporal: prueba variantes de endpoint candidatas a exponer el
// reporte de "Cuenta corriente" completo (con saldo de inicio + RC + COT),
// que /comprobantes/search NO trae. Devuelve status + un extracto del body
// de cada candidato para ver cuál responde con datos reales.
async function debugProbeCcEndpoints(email, apiKey, contabiliumId) {
  const token = await getAccessToken(email, apiKey);
  const candidates = [
    `/cuentacorriente/search?idCliente=${contabiliumId}`,
    `/cuentacorriente/get?idCliente=${contabiliumId}`,
    `/cuentacorriente/getbycliente?idCliente=${contabiliumId}`,
    `/clientes/${contabiliumId}/cuentacorriente`,
    `/reportes/cuentacorriente?idCliente=${contabiliumId}`,
    `/reportecuentacorriente/search?idCliente=${contabiliumId}`,
    `/movimientos/search?idCliente=${contabiliumId}`,
    `/movimientoscliente/search?idCliente=${contabiliumId}`,
    `/recibos/search?idCliente=${contabiliumId}`,
    `/recibocobro/search?idCliente=${contabiliumId}`,
    `/cobrorecibos/search?idCliente=${contabiliumId}`,
    `/cotizaciones/search?idCliente=${contabiliumId}`,
    `/rc/search?idCliente=${contabiliumId}`,
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text().catch(() => "");
      results.push({ path, status: res.status, bodyPreview: text.slice(0, 300) });
    } catch (err) {
      results.push({ path, status: "ERR", bodyPreview: String(err) });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { contabiliumId, results };
}

// Prueba candidatos de endpoint para el módulo "Remitos" (Ventas > Remitos
// en la UI de Contabilium, app.contabilium.com/modulos/ventas/remitos.aspx),
// que no forma parte de /comprobantes/search.
async function debugProbeRemitosEndpoints(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const fechaHasta = new Date().toISOString().slice(0, 10);
  const desde30d = new Date();
  desde30d.setDate(desde30d.getDate() - 30);
  const fechaDesde = desde30d.toISOString().slice(0, 10);
  const candidates = [
    `/remitos/search?pageSize=5&page=1&fechaDesde=${fechaDesde}&fechaHasta=${fechaHasta}`,
    `/remito/search?pageSize=5&page=1&fechaDesde=${fechaDesde}&fechaHasta=${fechaHasta}`,
    `/remitos/search?pageSize=5&pageIndex=1`,
    `/remitosventas/search?pageSize=5&page=1`,
    `/ventaremitos/search?pageSize=5&page=1`,
    `/remitosrealizados/search?pageSize=5&page=1`,
    // Hipótesis: viven en /comprobantes/search pero ocultos salvo que se
    // pida el tipo explícitamente.
    `/comprobantes/search?pageSize=5&page=1&fechaDesde=${fechaDesde}&fechaHasta=${fechaHasta}&tipoFc=REM`,
    `/comprobantes/search?pageSize=5&page=1&fechaDesde=${fechaDesde}&fechaHasta=${fechaHasta}&tipo=REM`,
    `/comprobantes/search?pageSize=5&page=1&fechaDesde=${fechaDesde}&fechaHasta=${fechaHasta}&TipoFc=REM`,
    `/comprobantes/search?pageSize=5&page=1&fechaDesde=${fechaDesde}&fechaHasta=${fechaHasta}&tipoComprobante=REM`,
    `/ventas/remitos/search?pageSize=5&page=1`,
    `/remitosdeposito/search?pageSize=5&page=1`,
    `/remitodeposito/search?pageSize=5&page=1`,
    `/notaremito/search?pageSize=5&page=1`,
    `/notasremito/search?pageSize=5&page=1`,
    `/despachos/search?pageSize=5&page=1`,
    `/entregas/search?pageSize=5&page=1`,
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text().catch(() => "");
      results.push({ path, status: res.status, bodyPreview: text.slice(0, 500) });
    } catch (err) {
      results.push({ path, status: "ERR", bodyPreview: String(err) });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { results };
}

// Prueba candidatos de endpoint para CREAR un comprobante (factura), con un
// body vacío/inválido a propósito: la idea es solo ver si el endpoint existe
// y qué campos exige (error 400 de validación), sin llegar a crear ningún
// comprobante fiscal real. Si alguno responde 200/201 con body vacío sería
// muy raro (probablemente rechace por falta de datos) — en ese caso no usar
// ese resultado, avisar antes de seguir.
async function debugProbeCrearComprobanteEndpoints(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const candidates = [
    "/comprobantes",
    "/comprobantes/crear",
    "/comprobantes/create",
    "/comprobantes/nuevo",
    "/comprobantes/add",
    "/facturas",
    "/facturas/crear",
    "/facturaventa",
    "/facturaventa/crear",
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text().catch(() => "");
      results.push({ path, status: res.status, bodyPreview: text.slice(0, 500) });
    } catch (err) {
      results.push({ path, status: "ERR", bodyPreview: String(err) });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { results };
}

// Sondea el schema real de POST /comprobantes/crear mandando payloads cada
// vez más completos, siempre con IdCliente:0 (no existe ningún cliente con
// ese id) para que Contabilium lo rechace por cliente inválido en vez de
// crear un comprobante real — así vemos los mensajes de validación de campo
// en campo sin arriesgarnos a emitir una factura fiscal de verdad.
async function debugProbeCrearComprobantePayload(email, apiKey) {
  const token = await getAccessToken(email, apiKey);
  const base = { IdCliente: 0, TipoFc: "FCA", Modo: "Electrónica", PuntoVenta: 117923, FechaEmision: new Date().toISOString().slice(0, 10) };
  const payloads = [
    { ...base, Items: [{ Descripcion: "Prueba", Cantidad: 1, PrecioUnitario: 100 }] },
    { ...base, CondicionVenta: "Contado", Items: [{ Descripcion: "Prueba", Cantidad: 1, PrecioUnitario: 100 }] },
    { ...base, CondicionVenta: "Cuenta corriente", Items: [{ Descripcion: "Prueba", Cantidad: 1, PrecioUnitario: 100 }] },
    { ...base, Items: [{ Descripcion: "Prueba", Cantidad: 1, PrecioUnitario: 100, IdConcepto: 0 }] },
  ];
  const results = [];
  for (const payload of payloads) {
    try {
      const res = await fetch(`${API_BASE}/comprobantes/crear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => "");
      results.push({ payload, status: res.status, bodyPreview: text.slice(0, 800) });
    } catch (err) {
      results.push({ payload, status: "ERR", bodyPreview: String(err) });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { results };
}

// Sondea cómo vincular un ítem de factura a un producto/depósito real para
// que Contabilium descuente stock (hoy los ítems son texto libre y no
// tocan inventario). Trae un concepto real (getAllConceptos, solo lectura)
// y prueba variantes de payload con IdCliente:0 — siempre rechazado por
// "cliente inexistente" antes de llegar a emitir nada, así vemos qué campos
// de depósito/inventario acepta o pide sin arriesgar una factura real.
async function debugProbeStockDescuento(email, apiKey, depositoId) {
  const conceptos = await getAllConceptos(email, apiKey);
  const conceptoReal = conceptos.find((c) => (c.Codigo || "").trim());
  if (!conceptoReal) return { error: "No se encontró ningún concepto con Codigo" };

  const token = await getAccessToken(email, apiKey);
  const base = { IdCliente: 0, TipoFc: "FCA", Modo: "Electrónica", PuntoVenta: 117923, FechaEmision: new Date().toISOString().slice(0, 10) };
  const itemBase = { Descripcion: conceptoReal.Codigo, Cantidad: 1, PrecioUnitario: 100, IdConcepto: conceptoReal.Id };

  const payloads = [
    { ...base, Inventario: true, Items: [{ ...itemBase, IdArticulo: conceptoReal.Id }] },
    { ...base, Inventario: true, Items: [{ ...itemBase, IdProducto: conceptoReal.Id }] },
    { ...base, Inventario: true, Items: [{ ...itemBase, Codigo: conceptoReal.Codigo }] },
    { ...base, Inventario: true, Detalle: [{ ...itemBase, IdDeposito: depositoId }] },
    { ...base, Inventario: 1, Items: [{ ...itemBase, IdDeposito: depositoId }] },
    { ...base, Inventario: true, IdDeposito: depositoId, Items: [{ Descripcion: conceptoReal.Codigo, Cantidad: 1, PrecioUnitario: 100, IdConcepto: conceptoReal.Id, Deposito: depositoId }] },
    { ...base, Inventario: true, Items: [{ ...itemBase, IdDeposito: depositoId, ActualizaStock: true }] },
  ];

  const results = [];
  for (const payload of payloads) {
    try {
      const res = await fetch(`${API_BASE}/comprobantes/crear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => "");
      results.push({ payload, status: res.status, bodyPreview: text.slice(0, 800) });
    } catch (err) {
      results.push({ payload, status: "ERR", bodyPreview: String(err) });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { conceptoUsado: { Id: conceptoReal.Id, Codigo: conceptoReal.Codigo }, results };
}

// Punto de venta electrónico de Samurai en Contabilium — confirmado real
// (visto en comprobantes ya emitidos vía /comprobantes/search).
const PUNTO_VENTA_SAMURAI = 117923;

// Crea un comprobante (factura) REAL en Contabilium. A diferencia de las
// funciones debugProbe*, esto emite de verdad — con CAE, irreversible.
// Formato de payload confirmado por prueba directa contra la API real.
//
// Si se pasa `idDeposito`, y cada ítem trae `sku` (y ese SKU matchea un
// concepto real de Contabilium), la factura queda vinculada al inventario:
// `Inventario: 1` (¡numérico, no boolean — con `true` Contabilium rechaza
// el comprobante entero con "no tiene items asociados", confirmado a
// pruebas!) + `IdConcepto`/`IdDeposito` por ítem, así Contabilium descuenta
// stock del depósito consignado real del cliente. Los ítems sin SKU
// reconocido (ej. una línea de texto libre / ajuste manual) se mandan
// igual pero sin tocar inventario.
async function crearComprobante(email, apiKey, { idCliente, idDeposito, tipoFc = "FCA", items, fechaEmision }) {
  const token = await getAccessToken(email, apiKey);

  let conceptoIdBySku = null;
  if (idDeposito && items.some((it) => it.sku)) {
    const conceptos = await getAllConceptos(email, apiKey);
    conceptoIdBySku = new Map();
    for (const c of conceptos) {
      const code = (c.Codigo || "").trim();
      if (code) conceptoIdBySku.set(code, c.Id);
    }
  }

  // "Inventario" es el ID del depósito (entero), no un flag — según la doc
  // oficial de la API (EmitirFECobrada/CreateComprobante lo marcan como
  // obligatorio y del tipo Entero). Antes se mandaba el literal 1, que
  // Contabilium interpretaba como un depósito inexistente y por eso
  // rechazaba cualquier factura con SKU por "stock insuficiente".
  const payloadItems = items.map((it) => {
    const base = {
      Concepto: it.descripcion,
      Cantidad: it.cantidad,
      PrecioUnitario: it.precioUnitario,
    };
    const idConcepto = it.sku && conceptoIdBySku ? conceptoIdBySku.get(String(it.sku).trim()) : null;
    if (idConcepto) return { ...base, IdConcepto: idConcepto };
    return base;
  });

  const payload = {
    IdCliente: idCliente,
    TipoFc: tipoFc,
    Modo: "E",
    PuntoVenta: PUNTO_VENTA_SAMURAI,
    FechaEmision: fechaEmision || new Date().toISOString().slice(0, 10),
    ...(idDeposito ? { Inventario: idDeposito } : {}),
    Items: payloadItems,
  };
  const res = await fetch(`${API_BASE}/comprobantes/crear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium rechazó el comprobante: ${msg}`);
  }

  const idComprobante = typeof body === "number" ? body : Number(body?.Id ?? body);

  // FCA/FCB/FCC quedan como borrador (sin CAE, "0001-00000000") hasta que
  // se emiten electrónicamente — se hace acá mismo para que quede como
  // factura real de una. Cotizaciones (COT) y remitos (REM) no son
  // documentos AFIP, no aplica.
  if (tipoFc !== "COT" && tipoFc !== "REM" && Number.isFinite(idComprobante)) {
    const fe = await emitirFacturaElectronica(email, apiKey, idComprobante);
    return { Id: idComprobante, ...fe };
  }

  return body;
}

// Consulta el padrón real de AFIP para un CUIT/documento, vía la propia
// integración de Contabilium (no requiere certificado AFIP propio). Se usa
// para validar/corregir la CondicionIva de un cliente antes de facturar,
// evitando el error "Condicion IVA receptor no valido" cuando el dato
// cargado en Contabilium no coincide con lo que AFIP tiene registrado.
async function getDatosAfip(email, apiKey, documento) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(`${API_BASE}/clientes/datosAfip?documento=${encodeURIComponent(documento)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium no pudo consultar AFIP: ${msg}`);
  }
  return body;
}

// Actualiza los datos de un cliente ya existente — Contabilium exige mandar
// el registro completo (razonSocial, condicionIva, tipoDoc, nroDoc, idPais,
// idProvincia, domicilio son obligatorios), no soporta un PATCH parcial.
async function updateCliente(email, apiKey, id, cliente) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(`${API_BASE}/clientes?id=${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cliente),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium no pudo actualizar el cliente: ${msg}`);
  }
  return body;
}

// Crea un cliente nuevo en Contabilium. Mismo shape de objeto que
// updateCliente pero sin id (POST en vez de PUT) — se usa cuando un
// distribuidor tiene depósito consignado pero nunca se le cargó la ficha de
// Cliente (son entidades separadas en Contabilium).
async function crearCliente(email, apiKey, cliente) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(`${API_BASE}/clientes/crear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cliente),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium no pudo crear el cliente: ${msg}`);
  }
  return body;
}

// Elimina un comprobante — Contabilium solo lo permite si NO tiene cobranzas
// realizadas y NO fue emitido electrónicamente (sin CAE). Se usa para
// limpiar borradores huérfanos que quedan cuando `crearComprobante` logra
// el paso de creación pero falla la autorización AFIP: ese borrador ya
// descontó stock del depósito, y borrarlo es lo que lo devuelve.
async function deleteComprobante(email, apiKey, id) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(`${API_BASE}/comprobantes/?id=${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium no pudo eliminar el comprobante: ${msg}`);
  }
  return body;
}

// Actualiza un concepto (producto) ya existente — nunca probado antes en
// este repo, no hay precedente de escritura de conceptos (solo lectura vía
// getAllConceptos). Mirror del patrón de updateCliente: PUT con el objeto
// completo (Contabilium en general no soporta PATCH parcial), a un endpoint
// candidato /conceptos?id=X — si Contabilium devuelve 404/405 acá, significa
// que el REST no soporta escribir conceptos y hay que ir por automatización
// web (como se hizo para stock/remitos en contabiliumWebAutomation.js).
async function updateConcepto(email, apiKey, id, concepto) {
  const token = await getAccessToken(email, apiKey);
  const res = await fetch(`${API_BASE}/conceptos?id=${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(concepto),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "string" ? body : (body?.Message || body?.message || JSON.stringify(body));
    throw new Error(`Contabilium no pudo actualizar el concepto (status ${res.status}): ${msg}`);
  }
  return body;
}

module.exports = { getAllConceptos, getClientById, searchClientByDoc, getComprobantesByClientId, getAllComprobantes, getComprobanteById, getStockByDeposito, getDepositosViaStockBySKU, searchClientesByFiltro, getAllClientes, getCobranzasList, getCobranzaById, getStockDisponibleBySKU, getStockDesglosadoBySKU, buscarCobranzasPorClientePaginado, testPageIndexRaw, probeBancosEndpoints, probeMovimientosDepositoEndpoints, probeChequesEndpoints, probeComprasEndpoints, debugComprobantesPaging, debugSaldoByCuit, debugClienteSearchRaw, debugProbeCcEndpoints, debugProbeRemitosEndpoints, debugProbeCrearComprobanteEndpoints, debugProbeCrearComprobantePayload, debugProbeStockDescuento, emitirFacturaElectronica, cobrarComprobante, crearComprobante, getDatosAfip, deleteComprobante, updateCliente, crearCliente, updateConcepto };
