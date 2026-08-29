import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, storage, db } from "../firebase";

const BASE_URL = "https://us-central1-bikeshop-ab2f0.cloudfunctions.net";

export type TipoComprobante = "FCA" | "NCA" | "NDA";

export type Comprobante = {
  Id: number;
  Tipo: TipoComprobante;
  Numero: string;
  Fecha: string;
  FechaVencimiento: string | null;
  Total: number;
  Saldo: number;
  IdCliente: number;
  RazonSocial: string;
  [key: string]: unknown;
};

export type ComprobanteDetalle = Comprobante & {
  Items: Array<{
    Descripcion: string;
    Cantidad: number;
    PrecioUnitario: number;
    Total: number;
    [key: string]: unknown;
  }>;
};

async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sesión no iniciada");
  return user.getIdToken();
}

async function callFunction<T>(name: string, body: unknown, timeoutMs = 280000): Promise<T> {
  const token = await getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("La operación tardó demasiado y se canceló. Probá de nuevo.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

export type GetComprobantesParams = {
  tipos?: TipoComprobante[];
  desde?: string;
  hasta?: string;
};

export async function getClientComprobantes(
  params: GetComprobantesParams = {}
): Promise<{ items: Comprobante[]; total: number; saldoTotal: number }> {
  return callFunction("getClientComprobantes", params);
}

export async function getComprobanteDetail(id: number): Promise<ComprobanteDetalle> {
  return callFunction("getComprobanteDetail", { id });
}

export type DepositoStockItem = {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  description: string;
  imageUrl: string;
  images: string[];
  priceArs: number | null;
  stockActual: number;
  stockDisponible: number;
  pendienteVenta: number;
};

export async function getMyDepositoStock(): Promise<{
  depositoId: number;
  depositoNombre: string | null;
  items: DepositoStockItem[];
}> {
  return callFunction("getMyDepositoStock", {});
}

export async function getDepositoStockAdmin(depositoId: number): Promise<{
  depositoId: number;
  items: DepositoStockItem[];
}> {
  return callFunction("getDepositoStockAdmin", { depositoId });
}

export async function adminGetClientComprobantes(contabiliumId: number): Promise<{ items: ComprobanteDetalle[]; total: number; saldoTotal: number }> {
  return callFunction("adminGetClientComprobantes", { contabiliumId });
}

export async function adminGetClientPhone(contabiliumId: number): Promise<{ telefono: string | null }> {
  return callFunction("adminGetClientPhone", { contabiliumId });
}

// Consulta el padrón real de AFIP para un CUIT/documento (vía Contabilium),
// para verificar antes de facturar que la condición IVA cargada coincida
// con la real y evitar rechazos de AFIP al emitir.
export async function verificarCondicionAfip(documento: string): Promise<{
  categoriaImpositiva: string | null;
  categoriaMonotributo: string | null;
  razonSocial: string | null;
}> {
  return callFunction("verificarCondicionAfip", { documento });
}

export async function adminGetComprobanteDetail(id: number): Promise<ComprobanteDetalle> {
  return callFunction("adminGetComprobanteDetail", { id });
}

export type ClienteVinculado = { nombre: string; cuit: string; contabiliumId: number };

export async function listClientesVinculados(): Promise<{ total: number; rows: ClienteVinculado[] }> {
  const token = await getIdToken();
  const res = await fetch(`${BASE_URL}/diagListClientesVinculados`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

export async function adminRenameUsername(uid: string, newUsername: string): Promise<{ ok: true; username: string; email: string }> {
  return callFunction("adminRenameUsername", { uid, newUsername });
}

export async function adminDeleteUser(uid: string): Promise<{ ok: true }> {
  return callFunction("adminDeleteUser", { uid });
}

export async function triggerDepositosSync(): Promise<{ count: number }> {
  return callFunction("triggerDepositosSync", {}, 60000);
}

// Vincula contabiliumId a los usuarios con depósito consignado (útil cuando
// se suma un distribuidor nuevo y falta vincularlo a su ficha de cliente).
export type LinkDepositoClientesResult = {
  applied: boolean;
  totalDepositos: number;
  matchedCount: number;
  unresolvedCount: number;
  alreadyLinkedCount: number;
  sinCuentaCount: number;
  matched: Array<{ uid: string; nombre: string; contabiliumId: number; razonSocial: string; cuit: string | null }>;
  unresolved: Array<{ uid: string; nombre: string; reason?: string; candidatesCount?: number; candidates?: unknown[] }>;
  alreadyLinked: Array<{ uid: string; nombre: string; contabiliumId: number }>;
  sinCuenta: Array<{ depositoId: number; nombre: string }>;
};
export async function adminLinkDepositoClientes(apply: boolean): Promise<LinkDepositoClientesResult> {
  return callFunction("adminLinkDepositoClientes", { apply }, 180000);
}

// Vincula contabiliumId por CUIT a los clientes que todavía no tienen vínculo.
export type LinkClientesByCuitResult = {
  applied: boolean;
  matchedCount: number;
  unresolvedCount: number;
  alreadyLinkedCount: number;
  sinCuitCount: number;
  matched: Array<{ uid: string; nombre: string | null; cuit: string; contabiliumId: number; razonSocial: string }>;
  unresolved: Array<{ uid: string; nombre: string | null; cuit: string; reason?: string }>;
  sinCuit: Array<{ uid: string; nombre: string | null }>;
};
export async function adminLinkClientesByCuit(apply: boolean): Promise<LinkClientesByCuitResult> {
  return callFunction("adminLinkClientesByCuit", { apply }, 280000);
}

export type ClientSignupForm = {
  nombre: string; password: string; email?: string; celular?: string; empresa?: string;
  cuit: string; provincia?: string; localidad?: string; rubro?: string; mensaje?: string;
};

export async function submitClientSignup(form: ClientSignupForm): Promise<{ ok: true; username: string }> {
  const res = await fetch(`${BASE_URL}/submitClientSignup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}



export type LegacyUsersAudit = {
  totalRevisados: number;
  sinCuenta: Array<{ id: string; email: string | null; name: string }>;
  conCuentaDistinta: Array<{ id: string; email: string; name: string; realUid: string }>;
};

export async function auditLegacyUsers(): Promise<LegacyUsersAudit> {
  return callFunction("auditLegacyUsers", {}, 120000);
}

export async function createUserWithPassword(
  name: string,
  password: string
): Promise<{ uid: string; username: string }> {
  return callFunction("createUserWithPassword", { name, password });
}

export async function adminSetUserPassword(uid: string, password: string): Promise<{ ok: true }> {
  return callFunction("adminSetUserPassword", { uid, password });
}

export type ComprobantePagoEstado = "pendiente" | "aprobado" | "rechazado";

export type SaleRequest = {
  id: string;
  distributorUid: string;
  distributorName: string;
  depositoId: number;
  depositoNombre: string | null;
  sku: string;
  name: string;
  category: string | null;
  imageUrl: string;
  quantity: number;
  unitPrice: number | null;
  status: "pendiente" | "facturado";
  createdAt: string | null;
  resolvedAt: string | null;
  comprobantePagoUrl?: string | null;
  comprobantePagoEstado?: ComprobantePagoEstado | null;
  comprobantePagoNota?: string | null;
  comprobantePagoUploadedAt?: string | null;
  comprobantePagoRevisadoAt?: string | null;
  tipoDocumentoEmitido?: "FCA" | "COT" | null;
};

export async function reportSale(item: {
  sku: string;
  name: string;
  category?: string | null;
  imageUrl?: string;
  quantity: number;
  unitPrice?: number | null;
  tipoDocumento?: "FCA" | "COT";
}): Promise<{ ok: true; id: string; tipoDocumentoEmitido: "FCA" | "COT" | null }> {
  return callFunction("reportSale", item);
}

export async function listSaleRequests(): Promise<{ items: SaleRequest[] }> {
  return callFunction("listSaleRequests", {});
}

export type MySaleRequest = {
  id: string;
  sku: string;
  name: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number | null;
  status: "pendiente" | "facturado";
  createdAt: string | null;
  resolvedAt: string | null;
  comprobantePagoUrl?: string | null;
  comprobantePagoEstado?: ComprobantePagoEstado | null;
  comprobantePagoNota?: string | null;
  comprobantePagoUploadedAt?: string | null;
};

export async function listMySaleRequests(): Promise<{ items: MySaleRequest[] }> {
  return callFunction("listMySaleRequests", {});
}

export async function resolveSaleRequest(id: string): Promise<{ ok: true }> {
  return callFunction("resolveSaleRequest", { id });
}

// Emite una factura REAL en Contabilium (con CAE) para una o más ventas
// reportadas del mismo distribuidor, y las marca como facturadas.
export async function emitirFacturaVenta(saleRequestIds: string[]): Promise<{ ok: true; comprobante: unknown }> {
  return callFunction("emitirFacturaVenta", { saleRequestIds }, 60000);
}

export type FacturaManualItem = { descripcion: string; cantidad: number; precioUnitario: number };

// Emite una factura REAL en Contabilium para cualquier cliente vinculado,
// con ítems cargados a mano (venta cerrada en persona, sin depender de que
// el distribuidor la haya reportado desde su celular).
export async function emitirFacturaManual(
  contabiliumId: number,
  items: FacturaManualItem[],
  tipoFc: "FCA" | "FCB" | "FCC" = "FCA"
): Promise<{ ok: true; comprobante: unknown }> {
  return callFunction("emitirFacturaManual", { contabiliumId, items, tipoFc }, 60000);
}

export type FormaDePagoRecibo = "Débito" | "Depósito" | "Efectivo" | "Transferencia" | "Nota de crédito";

export type LineaPagoRecibo = {
  formaDePago: FormaDePagoRecibo;
  monto: number;
  idBanco?: number | null;
  nroReferencia?: string;
};

// Registra un recibo de cobranza contra una factura puntual (descuenta el
// "Debe" sin pasar por facturación) — para clientes de compra directa, sin
// depósito consignado, donde no aplica el circuito de ventas reportadas.
// Acepta varias líneas de pago juntas en un mismo recibo: la API de
// Contabilium REEMPLAZA el recibo entero de un comprobante en cada llamada
// (no lo acumula), así que todas las líneas tienen que ir en un solo pedido.
export async function cobrarComprobante(params: {
  idComprobante: number;
  importeTotalNeto: number;
  pagos: LineaPagoRecibo[];
}): Promise<{ ok: true; saldoRestante: number; resultado: unknown }> {
  return callFunction("cobrarComprobante", params, 60000);
}

export async function deleteSaleRequest(id: string): Promise<{ ok: true }> {
  return callFunction("deleteSaleRequest", { id });
}

// Sube la foto del comprobante de pago a Storage y la adjunta a la venta
// reportada (mismo patrón que uploadAudit en stockAudits.ts).
export async function uploadComprobantePago(saleRequestId: string, file: File): Promise<{ ok: true }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sesión no iniciada");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileRef = ref(storage, `sale-receipts/${saleRequestId}/${Date.now()}.${ext}`);
  const snap = await uploadBytes(fileRef, file, {
    contentType: file.type || "image/jpeg",
    customMetadata: { uploadedBy: user.uid },
  });
  const url = await getDownloadURL(snap.ref);
  return callFunction("attachComprobantePago", { saleRequestId, url });
}

// Comprobante de pago de cuenta corriente, independiente de una venta
// puntual reportada. Se sube a Storage y el backend intenta confirmarlo
// automáticamente contra las cobranzas reales sincronizadas.
export async function reportarPagoCuentaCorriente(file: File, monto: number, fecha: string, nota?: string): Promise<{ ok: true; id: string; confirmadoAutomaticamente: boolean }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sesión no iniciada");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileRef = ref(storage, `pagos-cc/${user.uid}/${Date.now()}.${ext}`);
  const snap = await uploadBytes(fileRef, file, {
    contentType: file.type || "image/jpeg",
    customMetadata: { uploadedBy: user.uid },
  });
  const url = await getDownloadURL(snap.ref);
  return callFunction("reportarPagoCuentaCorriente", { url, monto, fecha, nota: nota || null });
}

export async function reviewPagoReportado(id: string, aprobado: boolean, nota?: string): Promise<{ ok: true }> {
  return callFunction("reviewPagoReportado", { id, aprobado, nota: nota || null });
}

export async function reviewComprobantePago(
  saleRequestId: string,
  aprobado: boolean,
  nota?: string
): Promise<{ ok: true }> {
  return callFunction("reviewComprobantePago", { saleRequestId, aprobado, nota: nota || null });
}

// Uso puntual: manda el aviso de "se implementó la auditoría de stock" por
// mail a todos los distribuidores con email cargado.
export async function sendAuditAnnouncementEmail(): Promise<{
  ok: true;
  totalUsers: number;
  sent: number;
  skipped: number;
  errors: Array<{ email: string; error: string }>;
}> {
  return callFunction("sendAuditAnnouncementEmail", {}, 120000);
}

export type ConsignedRollup = {
  totalBicicletas: number;
  totalValor: number;
  depositosCount: number;
  errors: Array<{ depositoId: number; nombre?: string; error: string }>;
};

export async function triggerConsignedRollupSync(): Promise<ConsignedRollup> {
  return callFunction("triggerConsignedRollupSync", {}, 560000);
}

export type ClienteReporteRow = {
  uid: string;
  nombre: string;
  localidad: string;
  contabiliumId: number | null;
  depositoId: string | null;
  stockConsignado: number;
  valorConsignado: number;
  facturadoTotal: number;
  cantidadFacturas: number;
  fechaPrimeraFactura: string | null;
  fechaUltimaFactura: string | null;
  cobradoTotal: number;
  fechaUltimaCobranza: string | null;
  saldoDeudor: number;
  saldoAFavor: number;
};

export type ClientesReport = {
  totalClientes: number;
  totalStockConsignado: number;
  totalValorConsignado: number;
  totalFacturado: number;
  totalCobrado: number;
  totalDeuda: number;
  totalAFavor: number;
};

export async function triggerClientesReportSync(): Promise<ClientesReport> {
  return callFunction("triggerClientesReportSync", {}, 280000);
}

export async function importarRemitos(remitos: unknown[]): Promise<{ nuevos: number; actualizados: number; total: number }> {
  return callFunction("importarRemitos", { remitos }, 280000);
}

export async function adminAsignarVendedor(uid: string, vendedor: string | null): Promise<{ ok: true; contabiliumSync: boolean }> {
  return callFunction("adminAsignarVendedor", { uid, vendedor });
}

export type VentaPorMes = {
  mes: string;
  facturas: number;
  facturado: number;
  bicis: number;
  facturadoBicis: number;
  costoBicis: number;
  bicisConCosto: number;
  margenBicis: number | null;
};

export type FacturaRaw = { id: number; fecha: string; cliente: string; facturado: number; bicis: number; facturadoBicis: number };

export type PromedioProyeccion = {
  mesesConsiderados: string[];
  bicisPromedioPorMes: number;
  precioPromedioPorBici: number;
  costoPromedioPorBici: number | null;
  margenPromedioPorBici?: number;
};

export type BusinessDashboard = {
  totalFacturas: number;
  totalFacturado: number;
  totalBicisVendidas: number;
  tieneCostosCargados: boolean;
  promedio: PromedioProyeccion | null;
};

export async function triggerBusinessDashboardSync(): Promise<BusinessDashboard> {
  return callFunction("triggerBusinessDashboardSync", {}, 560000);
}

export function subscribeBusinessDashboardDetail(
  onData: (data: { porMes: VentaPorMes[]; porFactura: FacturaRaw[]; updatedAt: Date | null } | null) => void
) {
  return onSnapshot(doc(db, "meta", "businessDashboardDetail"), (snap) => {
    if (!snap.exists()) return onData(null);
    const data = snap.data() as { porMes: VentaPorMes[]; porFactura: FacturaRaw[]; updatedAt?: { toDate: () => Date } };
    onData({ porMes: data.porMes || [], porFactura: data.porFactura || [], updatedAt: data.updatedAt?.toDate?.() || null });
  });
}

export type RemitoPorMes = { mes: string; bicisDistribuidores: number; bicisInternos: number; remitos: number };
export type RemitoPorCliente = { nombre: string; bicis: number };
export type RemitoRaw = { id: number; fecha: string | null; cliente: string; bicis: number; esInterno: boolean; numero: number };

export type RemitosDespachos = {
  totalRemitos: number;
  totalBicisDistribuidores: number;
  totalBicisInternos: number;
  rangoDatos: { desde: string; hasta: string };
  fuente: string;
};

export function subscribeRemitosDespachos(onData: (data: RemitosDespachos | null) => void) {
  return onSnapshot(doc(db, "meta", "remitosDespachos"), (snap) => {
    onData(snap.exists() ? (snap.data() as RemitosDespachos) : null);
  });
}

export function subscribeRemitosDespachosDetail(
  onData: (data: { porMes: RemitoPorMes[]; porCliente: RemitoPorCliente[]; porRemito: RemitoRaw[]; updatedAt: Date | null } | null) => void
) {
  return onSnapshot(doc(db, "meta", "remitosDespachosDetail"), (snap) => {
    if (!snap.exists()) return onData(null);
    const data = snap.data() as {
      porMes: RemitoPorMes[];
      porCliente: RemitoPorCliente[];
      porRemito: RemitoRaw[];
      updatedAt?: { toDate: () => Date };
    };
    onData({
      porMes: data.porMes || [],
      porCliente: data.porCliente || [],
      porRemito: data.porRemito || [],
      updatedAt: data.updatedAt?.toDate?.() || null,
    });
  });
}

export function subscribeBusinessDashboard(onData: (data: BusinessDashboard | null) => void) {
  return onSnapshot(doc(db, "meta", "businessDashboard"), (snap) => {
    onData(snap.exists() ? (snap.data() as BusinessDashboard) : null);
  });
}

// Caché del último reporte (se actualiza solo cada 24hs por
// syncClientesReport, o al toque si alguien toca "Refrescar" en el panel).
export function subscribeClientesReportDetail(
  onData: (data: { rows: ClienteReporteRow[]; updatedAt: Date | null } | null) => void
) {
  return onSnapshot(doc(db, "meta", "clientesReportDetail"), (snap) => {
    if (!snap.exists()) return onData(null);
    const data = snap.data() as { rows: ClienteReporteRow[]; updatedAt?: { toDate: () => Date } };
    onData({ rows: data.rows || [], updatedAt: data.updatedAt?.toDate?.() || null });
  });
}

export type MovimientoMercadoPago = {
  id: number;
  fecha: string;
  monto: number;
  pagador: string | null;
  descripcion: string | null;
  metodo: string | null;
};

// Trae los movimientos/cobros reales de la cuenta de Mercado Pago vía su
// propia API — a diferencia de los otros bancos, no hace falta subir ningún
// extracto a mano.
export async function getMercadoPagoMovimientos(desde?: string, hasta?: string): Promise<{
  movimientos: MovimientoMercadoPago[];
  total: number;
}> {
  const token = await getIdToken();
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  const res = await fetch(`${BASE_URL}/getMercadoPagoMovimientos?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}
