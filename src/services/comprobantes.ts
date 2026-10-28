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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callFunction<T>(name: string, body: unknown, timeoutMs = 280000): Promise<T> {
  const token = await getIdToken();

  // Un corte de red de un instante (wifi que titila, el celular cambiando
  // de antena, etc.) hace que fetch() tire "Failed to fetch" aunque el
  // servidor esté perfecto — un solo reintento corto alcanza para que eso
  // no se le muestre al usuario como si fuera un error real del sistema.
  let lastNetworkError: Error | null = null;
  for (let intento = 0; intento < 2; intento++) {
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
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") {
        throw new Error("La operación tardó demasiado y se canceló. Probá de nuevo.");
      }
      lastNetworkError = e as Error;
      if (intento === 0) {
        await sleep(800);
        continue;
      }
      throw new Error("No se pudo conectar con el servidor. Revisá tu conexión y probá de nuevo.");
    }
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
      throw new Error(err.error || `Error ${res.status}`);
    }
    return res.json();
  }
  // Inalcanzable en la práctica (el loop siempre retorna o tira antes),
  // pero TypeScript necesita un retorno/throw explícito acá.
  throw lastNetworkError || new Error("No se pudo conectar con el servidor.");
}

export type GetComprobantesParams = {
  tipos?: TipoComprobante[];
  desde?: string;
  hasta?: string;
};

// Diagnóstico temporal (21/10/2026): investiga si Contabilium tiene algún
// registro de compras/ingreso de stock con precio por unidad. Se borra una
// vez que se resuelva.
export async function diagExplorarCompras(): Promise<any> {
  return callFunction("diagExplorarCompras", {}, 180000);
}

export type ClientCobranza = {
  id: string;
  numero: string | null;
  fecha: string | null;
  importeTotal: number;
  formasDePago: Array<{ FormaDePago: string; NroReferencia: string | null; Importe: number }>;
  esReimputacion: boolean;
  excluirDeSaldo: boolean;
  detalle: Array<{ IDComprobante: number; Importe: number; numeroFactura: string | null }>;
};

export async function getClientComprobantes(
  params: GetComprobantesParams = {}
): Promise<{ items: Comprobante[]; total: number; saldoTotal: number; cobranzas: ClientCobranza[] }> {
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

export type FacturaResumen = {
  numero: string;
  tipo: string;
  fecha: string;
  total: number;
  saldo: number;
  pagada: boolean;
};

export type BiciResumen = {
  name: string;
  sku: string;
  stockActual: number;
  priceArs: number | null;
};

export type VendedorBasico = {
  uid: string;
  name: string | null;
  depositoNombre: string | null;
  depositoId: number | null;
  contabiliumId: number | null;
};

export type VendedorResumen = {
  uid: string;
  name: string | null;
  depositoNombre: string | null;
  stockBicis: number | null;
  bicis: BiciResumen[];
  saldoTotal: number | null;
  facturasRecientes: FacturaResumen[];
  modelosVendidos: Array<{ modelo: string; cantidad: number }>;
  error?: string;
};

// Para clientes que coordinan un grupo de distribuidores propios (campo
// `vendedoresAsignados` en su doc de usuario) — lista liviana (solo
// nombres), sin tocar Contabilium. El detalle pesado de cada uno se pide
// aparte con getVendedorResumen, uno por uno.
// `distribuidorUid` es opcional — solo lo usa el admin/chofer desde el panel
// de Vendedores para ver la cartera de OTRO distribuidor (ej. Alfredo), no
// la propia. Un distribuidor normal lo ignora (o lo manda y el server lo
// rechaza si no es el suyo).
export async function getMisVendedores(distribuidorUid?: string): Promise<{
  vendedores: VendedorBasico[];
}> {
  return callFunction("getMisVendedores", distribuidorUid ? { distribuidorUid } : {});
}

// Paso 1 del alta de cliente propio (ver distribuidorCrearCliente en
// functions/index.js): crea el cliente en Contabilium (desde el CUIT, padrón
// AFIP) + el usuario Samurai, y lo deja asignado automáticamente como
// cliente del distribuidor que llama (sin paso de admin aparte).
export async function distribuidorCrearCliente(data: {
  name: string;
  password: string;
  cuit: string;
  telefono?: string;
}): Promise<{ ok: true; uid: string; username: string; contabiliumId: number; razonSocial: string }> {
  return callFunction("distribuidorCrearCliente", data, 60000);
}

// Paso 2 (solo después de que el Paso 1 confirmó): crea el depósito en
// Contabilium para ese cliente y lo vincula (contabiliumDepositoId).
export async function distribuidorCrearDepositoCliente(data: {
  clienteUid: string;
  nombreDeposito: string;
  direccion?: string;
  telefono?: string;
}): Promise<{ ok: true; depositoId: number; depositoNombre: string }> {
  return callFunction("distribuidorCrearDepositoCliente", data, 120000);
}

// Detalle pesado (stock, deuda, últimas facturas) de un solo vendedor —
// pedido chico e independiente por cada tarjeta, para que una conexión
// inestable solo afecte a esa tarjeta y no a toda la pantalla.
export async function getVendedorResumen(vendedorUid: string): Promise<VendedorResumen> {
  return callFunction("getVendedorResumen", { vendedorUid }, 60000);
}

export type VendedorClienteDetalle = {
  cliente: {
    uid: string;
    name: string;
    cuit: string | null;
    contabiliumId: number | null;
    contabiliumDepositoId: number | null;
    contabiliumDepositoNombre: string | null;
  };
  comprobantes: Array<Record<string, unknown>>;
  saldoTotal: number;
  stock: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  pagosReportados: Array<Record<string, unknown>>;
  cheques: Array<Record<string, unknown>>;
  ventasReportadas: Array<Record<string, unknown>>;
  cobranzas: Array<Record<string, unknown>>;
  notasEntrega: Array<Record<string, unknown>>;
  telefono: string | null;
  celular: string | null;
  ciudad: string | null;
  provincia: string | null;
};

// Detalle completo de solo lectura de un cliente propio (mismo nivel que
// Clientes 360, pero el distribuidor no necesita loguearse como admin) —
// solo funciona si `clienteUid` está en su propio `vendedoresAsignados`.
export async function getVendedorClienteDetalle(clienteUid: string): Promise<VendedorClienteDetalle> {
  return callFunction("getVendedorClienteDetalle", { clienteUid }, 60000);
}

export type DetalleVentaComision = {
  cliente: string;
  modelo: string;
  cantidad: number | null;
  monto: number;
  comision: number;
  pagada: boolean;
  tipo: "FCA" | "NCA";
  numero: string;
  fecha: string;
};

export type ViajeDetalleManual = { id: number | string; fecha: string; destino: string; bicis: number; monto: number | null };

export type ResumenComisionVendedor = {
  mes: string;
  viajes: number;
  tarifaFletePorViaje: number;
  fleteTotal: number;
  comisionPorcentaje: number;
  ventasTotal: number;
  ventasCobradas: number;
  comisionTotal: number;
  totalACobrar: number;
  cantidadClientesAsignados: number;
  detalle: DetalleVentaComision[];
  // Proveedores con monto por viaje a cargar a mano (ej. Jíbaro: cobra 3.5%
  // de la carga pero hay que consultarle el monto puntual de cada viaje).
  modoFleteManual: boolean;
  viajesDetalle: ViajeDetalleManual[];
};

// Cuenta corriente mensual (flete por viaje + comisión sobre lo que
// facturan sus clientes asignados) de un supervisor con `vendedoresAsignados`
// — sin `vendedorUid` trae la propia; un admin/chofer puede pasarlo para ver
// la de otro.
export async function getResumenComisionVendedor(mes: string, vendedorUid?: string): Promise<ResumenComisionVendedor> {
  return callFunction("getResumenComisionVendedor", { mes, vendedorUid }, 170000);
}

// Excel de un mes puntual (Resumen + Viajes + Ventas) para descargar.
export async function descargarResumenVendedorExcel(
  mes: string,
  vendedorUid?: string
): Promise<{ ok: true; base64: string; filename: string }> {
  return callFunction("descargarResumenVendedorExcel", { mes, vendedorUid }, 170000);
}

export type ClientePanelVendedor = {
  cliente: string;
  stock: number;
  vendido: number;
  modelos: Array<{ modelo: string; cantidad: number }>;
  pagado: number;
  pendiente: number;
  entregado: number;
};

export type PanelClientesVendedor = {
  vendedor: string;
  desde: string;
  totalEntregado: number;
  totalVendido: number;
  totalPagado: number;
  totalPendiente: number;
  clientes: ClientePanelVendedor[];
};

// Panel en vivo: por cada cliente asignado, "entregado" = stock actual +
// vendido (sin importar de qué depósito salió la mercadería) — ver el
// comentario largo en buildPanelClientesVendedor (backend) sobre por qué
// esta regla reemplaza al rastreo de movimientos por origen.
export async function getPanelClientesVendedor(vendedorUid?: string, desde?: string): Promise<PanelClientesVendedor> {
  return callFunction("getPanelClientesVendedor", { vendedorUid, desde }, 280000);
}

export type InformeCompletoVendedor = {
  nombreVendedor: string;
  desdeISO: string;
  hoyISOVal: string;
  panel: PanelClientesVendedor;
  resumenesPorMes: Array<{
    mes: string;
    viajes: number;
    fleteTotal: number;
    ventasTotal: number;
    comisionPorcentaje: number;
    comisionTotal: number;
    totalACobrar: number;
    detalle: DetalleVentaComision[];
  }>;
  viajes: Array<{ fecha: string; destino: string; descripcion: string; items: Array<{ producto: string; cantidad: number | null }> }>;
  totalFlete: number;
  totalComision: number;
  totalViajesComision: number;
  retiros: Array<{ fecha: string; origen: string; descripcion: string; items: Array<{ producto: string; cantidad: number | null }> }>;
  totalRetirado: number;
  devoluciones: Array<{ fecha: string; destino: string; items: Array<{ producto: string; cantidad: number | null }> }>;
  totalDevuelto: number;
};

// Todo junto (panel por cliente + resumen mes a mes + viajes detallados),
// para mostrar en pantalla sin tener que pedir cada cosa por separado.
export async function getInformeCompletoVendedor(vendedorUid?: string): Promise<InformeCompletoVendedor> {
  return callFunction("getInformeCompletoVendedor", { vendedorUid }, 280000);
}

// El mismo informe de arriba, pero como Excel descargable.
export async function descargarInformeCompletoVendedor(
  vendedorUid?: string
): Promise<{ ok: true; base64: string; filename: string }> {
  return callFunction("descargarInformeCompletoVendedor", { vendedorUid }, 280000);
}

// Carga a mano cuántos viajes (Lavalle → su depósito) hizo en ese mes —
// Contabilium no lo registra, es la única forma de contarlo para el flete.
export async function setViajesVendedorMes(mes: string, viajes: number, vendedorUid?: string): Promise<{ ok: true }> {
  return callFunction("setViajesVendedorMes", { mes, viajes, vendedorUid });
}

export type DistribuidorConEquipo = {
  uid: string;
  name: string;
  cantidadClientesAsignados: number;
  comisionPorcentaje: number;
  tarifaFletePorViaje: number;
  contabiliumDepositoId: number | null;
  contabiliumDepositoNombre: string | null;
};

// Admin: lista de quiénes tienen `vendedoresAsignados` cargado, para elegir
// a quién ver/configurar en el resumen de comisión.
export async function adminListDistribuidoresConEquipo(): Promise<{ distribuidores: DistribuidorConEquipo[] }> {
  return callFunction("adminListDistribuidoresConEquipo", {});
}

// Admin: configura la tarifa de flete por viaje y/o el % de comisión de un
// distribuidor puntual.
export async function adminSetTarifasVendedor(
  vendedorUid: string,
  params: { comisionPorcentaje?: number; tarifaFletePorViaje?: number }
): Promise<{ ok: true }> {
  return callFunction("adminSetTarifasVendedor", { vendedorUid, ...params });
}

// Para proveedores con `modoFleteManual` (hoy: Jíbaro) — guarda lo que
// cobró por un viaje puntual (id = el movimiento de stock de Contabilium
// que lo generó).
export async function adminGuardarMontoViajeLogistica(
  vendedorUid: string,
  viajeId: number | string,
  monto: number
): Promise<{ ok: true }> {
  return callFunction("adminGuardarMontoViajeLogistica", { vendedorUid, viajeId, monto });
}

// Confirma a mano que una venta puntual ya se cobró (completa o parcial,
// si se manda `monto` menor a `montoTotal`). Guarda cliente/producto en el
// momento de confirmar, para no tener que re-buscarlos después.
export async function adminConfirmarCobroManual(
  vendedorUid: string,
  numero: string,
  monto: number | undefined,
  montoTotal: number | undefined,
  cliente: string,
  producto: string
): Promise<{ ok: true }> {
  return callFunction("adminConfirmarCobroManual", { vendedorUid, numero, monto, montoTotal, cliente, producto });
}

export async function adminQuitarCobroManual(vendedorUid: string, numero: string): Promise<{ ok: true }> {
  return callFunction("adminQuitarCobroManual", { vendedorUid, numero });
}

// Cierra el período actual del vendedor: guarda un histórico de lo
// liquidado, marca `fechaUltimaLiquidacion` (para que el próximo informe
// arranque de cero, cobrando flete solo por movimientos nuevos) y limpia
// los cobros manuales confirmados (ya quedaron saldados en este cierre).
export async function adminCerrarLiquidacionVendedor(params: {
  vendedorUid: string;
  desde: string;
  hasta: string;
  totalFlete: number;
  totalComision: number;
  totalCobradoPorVendedor: number;
  totalNetoAPagar: number;
  pagosManuales: unknown[];
}): Promise<{ ok: true }> {
  return callFunction("adminCerrarLiquidacionVendedor", params);
}

// Detalle completo (modelos, colores, cantidades) del depósito propio de
// Samurai en Lavalle — mismo permiso que getMisVendedores.
export async function getMiDepositoPropio(): Promise<{
  depositoId: number;
  depositoNombre: string | null;
  items: DepositoStockItem[];
}> {
  return callFunction("getMiDepositoPropio", {});
}

export async function getDepositoStockAdmin(depositoId: number): Promise<{
  depositoId: number;
  items: DepositoStockItem[];
}> {
  return callFunction("getDepositoStockAdmin", { depositoId });
}

export type RodadosSectorItem = {
  sku: string;
  name: string;
  category: string | null;
  imageUrl: string;
  stockActual: number;
  stockDisponible: number;
};

// Rodados Argentinos es un solo depósito en Contabilium, pero físicamente
// son 2 (Adrogué y Temperley) — esto separa el stock "a mano" clasificando
// cada movimiento histórico por lo que dice su observación.
export async function getStockRodadosPorSector(): Promise<{
  ok: true;
  sectores: {
    adrogue: { items: RodadosSectorItem[]; total: number };
    temperley: { items: RodadosSectorItem[]; total: number };
    sinClasificar: { items: RodadosSectorItem[]; total: number };
  };
  stockTotalReal: number | null;
  totalFilasLeidas: number;
}> {
  return callFunction("getStockRodadosPorSector", {});
}

export async function adminGetClientComprobantes(contabiliumId: number): Promise<{ items: ComprobanteDetalle[]; total: number; saldoTotal: number }> {
  return callFunction("adminGetClientComprobantes", { contabiliumId });
}

export async function adminGetClientPhone(contabiliumId: number): Promise<{
  telefono: string | null;
  celular: string | null;
  ciudad: string | null;
  provincia: string | null;
  razonSocial: string | null;
  direccion: string | null;
  cp: string | null;
  instagramDetectado: string | null;
}> {
  return callFunction("adminGetClientPhone", { contabiliumId });
}

export async function adminActualizarTelefonosCliente(
  contabiliumId: number,
  params: { telefono?: string; celular?: string }
): Promise<{ ok: true; telefono: string | null; celular: string | null }> {
  return callFunction("adminActualizarTelefonosCliente", { contabiliumId, ...params });
}

export interface ClienteConUbicacion {
  id: string;
  contabiliumId: number;
  nombre: string;
  cuit: string;
  ciudad: string;
  provincia: string;
  direccion: string;
  cp: string;
  lat: number | null;
  lon: number | null;
  // true = geocodificado por la dirección puntual (calle+altura real);
  // false = sin esa geocodificación, cayó al centro de la localidad.
  ubicacionPrecisa: boolean;
}

// Excel con dos solapas ("Consignados" con su situación/color marcado a
// mano, y "Sin depósito") — usado en el botón "Exportar" del mapa.
export async function exportarMapaClientes(provincia?: string): Promise<{
  base64: string;
  filename: string;
  totalConsignados: number;
  totalSinDeposito: number;
}> {
  return callFunction("exportarMapaClientes", provincia ? { provincia } : {}, 120000);
}

// Guion de llamadas (nueva administración): además del Excel (base64), trae
// el mismo contenido en JSON (guion + clientes por zona) para armar el PDF
// combinado del lado del cliente sin pedirle los datos de nuevo al backend.
export type GuionLlamadasEtapa = { Etapa: string; "Qué decir": string };
export type GuionLlamadasCliente = Record<string, string | number>;
export type GuionLlamadasZona = { zona: string; clientes: GuionLlamadasCliente[] };
export async function exportarGuionLlamadas(): Promise<{
  base64: string;
  filename: string;
  totalClientes: number;
  guion: GuionLlamadasEtapa[];
  porZona: GuionLlamadasZona[];
}> {
  return callFunction("exportarGuionLlamadas", {}, 120000);
}

export async function getClientesConUbicacion(): Promise<{ items: ClienteConUbicacion[] }> {
  // La primera corrida puede tener que geocodificar muchas direcciones
  // nuevas contra GeoRef/Nominatim (con throttling) — le damos más margen
  // que el timeout general para que no aborte antes de que el backend
  // (300s) termine y quede todo cacheado para la próxima vez.
  return callFunction("getClientesConUbicacion", {}, 300000);
}

export interface UbicacionVendedor {
  uid: string;
  nombre: string;
  contabiliumId: number;
  ciudad: string;
  provincia: string;
  direccion: string;
  cp: string;
  lat: number;
  lon: number;
  ubicacionPrecisa: boolean;
}

// Ubicaciones de los vendedores asignados al caller (mapa de Alfredo) —
// mismo permiso que getMisVendedores/getMiDepositoPropio.
export async function getUbicacionesMisVendedores(): Promise<{ items: UbicacionVendedor[] }> {
  return callFunction("getUbicacionesMisVendedores", {});
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

export async function consultarDatosAfip(documento: string): Promise<{
  razonSocial: string | null;
  condicionIva: string | null;
  categoriaMonotributo: string | null;
  domicilio: string | null;
  pisoDepto: string | null;
  ciudad: string | null;
  provincia: string | null;
  cp: string | null;
  personeria: string | null;
}> {
  return callFunction("consultarDatosAfip", { documento });
}

export async function adminGetComprobanteDetail(id: number): Promise<ComprobanteDetalle> {
  return callFunction("adminGetComprobanteDetail", { id });
}

// Baja el PDF real de Contabilium (con CAE de AFIP) de una factura ya
// emitida — replica el pedido real de la consola (common.aspx/ObtenerComprobante
// para conseguir el Href, después lo descarga). `intentos` trae el detalle
// de cada paso, útil si algún día cambia el mecanismo interno.
// Cuenta corriente real de FEPA TOP en Credifin (la logística que nos
// factura los envíos) — Credifin no tiene API pública, se reversó su portal
// de autogestión (ver credifinWebAutomation.js en functions/). `desde`/
// `hasta` en formato YYYY-MM-DD.
export type CredifinMovimiento = {
  Fecha: string;
  Comprobante: string;
  Concepto: string;
  Debitos: number;
  Creditos: number;
  Saldo: number;
  Filial_Origen?: string;
  Filial_Destino?: string;
  NroAuxiliar: number;
};
export async function credifinGetCtaCte(desde: string, hasta: string): Promise<{ reporte: CredifinMovimiento[] }> {
  return callFunction("credifinGetCtaCte", { desde, hasta }, 120000);
}

// PDF real de un comprobante puntual de Credifin — `comprobantesId` es el
// campo NroAuxiliar de cada fila de credifinGetCtaCte.
export async function credifinGetComprobantePdf(comprobantesId: number): Promise<{ pdfBase64: string }> {
  return callFunction("credifinGetComprobantePdf", { comprobantesId }, 120000);
}

// Listado real de envíos (guías) de FEPA TOP en Credifin — sin estado de
// entrega en vivo (Credifin no lo expone en esta API), pero con código de
// seguimiento y el comprobante real asociado una vez facturado.
export type CredifinGuia = {
  id: number;
  fecha: string;
  codigo_seguimiento: string;
  onombre: string;
  olocalidad: string;
  dnombre: string;
  dlocalidad: string;
  guias_comprobantes: { id: number; guias_id: number; valor: string; conformar: boolean }[];
  relacion_guia_comprobantes?: { id: number; referencias_id: number; comprobantes_ventas_id: number };
};
export async function credifinGetGuias(params: { page?: number; limit?: number; searchValue?: string } = {}): Promise<{
  guias: CredifinGuia[];
  totalDataSize: number | null;
}> {
  return callFunction("credifinGetGuias", params, 120000);
}

export async function adminDescargarPdfComprobante(idComprobante: number): Promise<{
  ok: boolean;
  pdfBase64: string | null;
  archivo?: string;
  intentos: any[];
}> {
  return callFunction("adminDescargarPdfComprobante", { idComprobante }, 60000);
}

// Igual que la de arriba, pero para que el propio cliente baje el PDF real
// (con CAE) de UNA DE SUS facturas desde "Mi cuenta" — el backend verifica
// que esa factura sea suya antes de devolverla.
export async function clienteDescargarPdfComprobante(idComprobante: number): Promise<{
  ok: boolean;
  pdfBase64: string | null;
  archivo?: string;
  intentos: any[];
}> {
  return callFunction("clienteDescargarPdfComprobante", { idComprobante }, 60000);
}

// Le pide a Claude que lea una foto de comprobante de pago (ya subida a
// Storage) y devuelva monto/fecha/banco/referencia — para precargar el
// formulario de recibo en Clientes 360 sin tipear a mano. El staff siempre
// revisa/edita el resultado antes de aplicar el recibo real.
export async function leerComprobantePagoAdmin(url: string): Promise<{
  ok: true;
  lectura: {
    monto: number | null;
    fecha: string | null;
    banco: string | null;
    referencia: string | null;
    confianza: "alta" | "media" | "baja";
    idBanco: number | null;
  } | null;
}> {
  return callFunction("leerComprobantePagoAdmin", { url });
}

export type Cotizacion = {
  id: number;
  numero: string;
  fecha: string;
  clienteId: number;
  clienteNombre: string | null;
  cuit: string | null;
  total: number;
  saldo: number;
};

export async function listCotizaciones(): Promise<{ total: number; items: Cotizacion[] }> {
  const token = await getIdToken();
  const res = await fetch(`${BASE_URL}/listCotizaciones`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
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
  password: string,
  opts?: { cuit?: string; telefono?: string; depositoId?: number | null; depositoNombre?: string | null }
): Promise<{ uid: string; username: string; contabiliumId: number | null }> {
  return callFunction("createUserWithPassword", { name, password, ...opts });
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

export async function listVentasFacturadasSinCobrar(): Promise<{
  items: {
    id: string;
    distributorUid: string;
    distributorName: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    facturaNumero: string | null;
    resolvedAt: string | null;
  }[];
}> {
  return callFunction("listVentasFacturadasSinCobrar", {});
}

export async function resolveSaleRequest(
  id: string,
  facturaNumero: string,
  stockYaDescontado: boolean
): Promise<{
  ok: true;
  stockAjustadoManualmente: boolean;
  stockAjusteError: string | null;
  montoCoincide: boolean;
  montoEsperado: number;
  montoReal: number;
}> {
  return callFunction("resolveSaleRequest", { id, facturaNumero, stockYaDescontado }, 60000);
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
  tipoFc: "FCA" | "FCB" | "FCC" = "FCA",
  fechaEmision?: string, // "YYYY-MM-DD" opcional — para cargar con fecha pasada
  sinDescontarStock?: boolean // no le resta stock al depósito propio del cliente (ej: ya se descontó por otro lado)
): Promise<{ ok: true; comprobante: unknown }> {
  return callFunction("emitirFacturaManual", { contabiliumId, items, tipoFc, fechaEmision, sinDescontarStock }, 60000);
}

// ─────────────────────────────────────────────────────────────
// Sub-cuentas de un vendedor/distribuidor (ej. Stortini → Carhué/Viedma):
// revendedores propios suyos, sin contabiliumId/depósito propio en
// Contabilium — seguimiento de stock/saldo nuestro, aparte, aunque la
// factura real siempre sale a nombre del vendedor.
export type StockSubcuenta = { sku: string; nombre: string; cantidad: number };
export type HistorialSubcuenta = {
  tipo: "factura" | "pago";
  monto: number;
  fecha: string;
  nota?: string;
  facturaNumero?: string | null;
  items?: FacturaManualItem[];
};
export type Subcuenta = {
  id: string;
  nombre: string;
  stock: StockSubcuenta[];
  saldo: number;
  historial: HistorialSubcuenta[];
};

export async function listSubcuentasVendedor(vendedorUid: string): Promise<{ subcuentas: Subcuenta[] }> {
  return callFunction("adminListSubcuentasVendedor", { vendedorUid });
}

export async function guardarSubcuentaVendedor(
  vendedorUid: string,
  subcuenta: { id: string; nombre: string; stock: StockSubcuenta[]; saldo: number }
): Promise<{ ok: true; subcuentas: Subcuenta[] }> {
  return callFunction("adminGuardarSubcuentaVendedor", { vendedorUid, ...subcuenta });
}

export async function facturarSubcuenta(
  vendedorUid: string,
  subcuentaId: string,
  items: Array<FacturaManualItem & { sku: string }>,
  tipoFc: "FCA" | "FCB" | "FCC" | "COT" = "FCA",
  fechaEmision?: string
): Promise<{ ok: true; comprobante: unknown; subcuenta: Subcuenta }> {
  return callFunction("adminFacturarSubcuenta", { vendedorUid, subcuentaId, items, tipoFc, fechaEmision }, 60000);
}

export async function registrarPagoSubcuenta(
  vendedorUid: string,
  subcuentaId: string,
  monto: number,
  nota?: string
): Promise<{ ok: true; subcuenta: Subcuenta }> {
  return callFunction("adminRegistrarPagoSubcuenta", { vendedorUid, subcuentaId, monto, nota });
}

export interface ContabiliumClienteResultado {
  contabiliumId: number;
  razonSocial: string;
  cuit: string | null;
  condicionIva: string | null;
  email: string | null;
  telefono: string | null;
}

// Busca clientes de Contabilium por nombre — usado para elegir el
// destinatario de un remito cuando no es el mismo cliente de la factura
// (ej: remito a una empresa de flete intermedia, y otro remito de esa
// empresa al cliente final — igual que se hace en Contabilium).
export async function searchContabiliumClientes(q: string): Promise<{ total: number; resultados: ContabiliumClienteResultado[] }> {
  return callFunction(`adminSearchContabiliumClientes?q=${encodeURIComponent(q)}`, {});
}

export type ClientePorTelefono = {
  contabiliumId: number;
  razonSocial: string;
  cuit: string | null;
  telefono: string | null;
  celular: string | null;
  email: string | null;
};

// Busca a qué cliente corresponde un número de teléfono (matchea por los
// últimos 8 dígitos, sin importar el formato con el que esté cargado).
export async function adminBuscarClientePorTelefono(telefono: string): Promise<{ total: number; resultados: ClientePorTelefono[] }> {
  return callFunction(`adminBuscarClientePorTelefono?telefono=${encodeURIComponent(telefono)}`, {}, 60000);
}

export type FormaDePagoRecibo = "Débito" | "Depósito" | "Efectivo" | "Transferencia" | "Cheque" | "Nota de crédito";

export type LineaPagoRecibo = {
  formaDePago: FormaDePagoRecibo;
  monto: number;
  idBanco?: number | null;
  nroReferencia?: string;
  idNotaCredito?: number | null;
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
  fecha?: string;
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

// Confirma un comprobante reportado cargando el recibo REAL en Contabilium
// (a diferencia de reviewPagoReportado, que solo marca un estado acá). El
// staff elige a qué factura se aplica — mandá idComprobante: "-1" para
// cargarlo "a cuenta" (sin factura puntual). Fecha en yyyy-mm-dd.
export async function obtenerBancosYCajasPropios(): Promise<{
  bancos: { id: number; nombre: string }[];
  cajas: { id: number; nombre: string }[];
}> {
  return callFunction("obtenerBancosYCajasPropios", {}, 60000);
}

export async function confirmarPagoReportado(params: {
  id: string;
  idComprobante: number | "-1";
  comprobante?: string;
  importe: number;
  saldoFactura?: number;
  fecha: string;
  forma?: string;
  banco?: string;
  idBanco?: number;
  idCaja?: number;
  idcheque?: number;
  nroRef?: string;
  observaciones?: string;
}): Promise<{ ok: true; nroComprobante: string }> {
  return callFunction("confirmarPagoReportado", params, 120000);
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

export async function sincronizarRemitosDesdeWeb(desde?: string, hasta?: string): Promise<{
  nuevos: number;
  actualizados: number;
  total: number;
  traidos: number;
  aviso?: string;
}> {
  return callFunction("sincronizarRemitosDesdeWeb", { desde, hasta }, 540000);
}

export async function adminAsignarVendedor(uid: string, vendedor: string | null): Promise<{ ok: true; contabiliumSync: boolean }> {
  return callFunction("adminAsignarVendedor", { uid, vendedor });
}

// Agrega (o saca, con quitar:true) un cliente de la lista de clientes a
// cargo de un distribuidor con equipo propio (ej. Alfredo Bavcevich) —
// opcionalmente fija de una el depósito de Contabilium del cliente.
export async function adminAsignarClienteADistribuidor(
  distribuidorUid: string,
  clienteUid: string,
  params: { quitar?: boolean; contabiliumDepositoId?: number } = {}
): Promise<{ ok: true }> {
  return callFunction("adminAsignarClienteADistribuidor", { distribuidorUid, clienteUid, ...params });
}

export type FilaImportarSituacion = {
  nombreExcel?: string;
  cuit?: string;
  situacionEtiqueta?: string;
  color?: "verde" | "amarillo" | "naranja" | "rojo" | "vencido" | "";
  llamado?: boolean;
  nota?: string;
  marcadoPor?: string;
  notaExtra?: string;
};

export type ResultadoImportarSituaciones = {
  total: number;
  actualizados: number;
  soloNota: number;
  sinCambios: number;
  noEncontrados: { nombre: string; cuit: string }[];
};

export async function adminImportarSituacionesClientes(filas: FilaImportarSituacion[]): Promise<ResultadoImportarSituaciones> {
  return callFunction("adminImportarSituacionesClientes", { filas }, 120000);
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

export type RemitoContabiliumDetalle = {
  id: number;
  numero?: string;
  idPersona?: number;
  razonSocialLista?: string;
  observaciones?: string | null;
  items?: { codigoConcepto?: string; descripcion?: string; cantidad?: number }[];
  [key: string]: unknown;
};

export type MovimientoStock = {
  id: number;
  fecha: string;
  origen: string;
  destino: string;
  descripcion: string;
  codigoNombre: string;
  cantidad: string;
  usuarioAlta: string;
};

export async function obtenerMovimientosStock(fechaDesde: string, fechaHasta?: string): Promise<{ items: MovimientoStock[]; total: number }> {
  return callFunction("obtenerMovimientosStock", { fechaDesde, fechaHasta }, 120000);
}

export async function adminObtenerRemitoDetalle(idRemito: number): Promise<RemitoContabiliumDetalle> {
  return callFunction("adminObtenerRemitoDetalle", { idRemito }, 60000);
}

export async function adminEditarObservacionRemito(idRemito: number, observaciones: string): Promise<RemitoContabiliumDetalle> {
  return callFunction("adminEditarObservacionRemito", { idRemito, observaciones }, 60000);
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

// Desglose de stock de bicicletas por depósito (Lavalle/Cañuelas/Credifin +
// total consignado), SKU por SKU — lo arma el mismo sync de Contabilium que
// ya corre cada 15 min (doContabiliumSync), aparte de los documentos
// públicos de "products" para no exponer ahí cuánto stock interno/
// consignado tiene la empresa. Solo para el panel admin.
export type StockPorDepositoSku = {
  sku: string;
  nombre: string;
  lavalle: number;
  canuelas: number;
  credifin: number;
  propiosTotal: number;
  consignadoTotal: number;
};
export function subscribeStockPorDepositoDetail(
  onData: (data: { porSku: StockPorDepositoSku[]; updatedAt: Date | null } | null) => void
) {
  return onSnapshot(doc(db, "meta", "stockPorDepositoDetail"), (snap) => {
    if (!snap.exists()) return onData(null);
    const data = snap.data() as { porSku: StockPorDepositoSku[]; updatedAt?: { toDate: () => Date } };
    onData({ porSku: data.porSku || [], updatedAt: data.updatedAt?.toDate?.() || null });
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

export type GaliciaCuenta = {
  number: string;
  iban: string;
  type: string;
  balance: number;
  currency: string;
};

// Saldos de las cuentas de Galicia (Open Galicia, API en vivo).
export async function getGaliciaSaldos(): Promise<{
  data: Array<{ accounts_cc: GaliciaCuenta[]; accounts_ca: GaliciaCuenta[]; totals: Array<{ amount: number; currency: string }> }>;
}> {
  return callFunction("getGaliciaSaldos", {}, 60000);
}

export type GaliciaExtractoSolicitado = {
  id: string;
  name: string;
  status: string;
  created_date: string;
  account_number: string;
};

// Paso 1/2 del flujo de movimientos: pide a Galicia que genere el extracto
// de una cuenta para un rango de fechas. El banco lo procesa por lote (cada
// ~30 min), así que hay que consultar descargarGaliciaMovimientos después.
export async function solicitarGaliciaMovimientos(
  accountNumber: string,
  startDate: string,
  endDate: string
): Promise<GaliciaExtractoSolicitado> {
  return callFunction("solicitarGaliciaMovimientos", { accountNumber, startDate, endDate }, 60000);
}

export type GaliciaMovimiento = {
  DebitosNum: number | null;
  CreditosNum: number | null;
  SaldoNum: number | null;
  [key: string]: unknown;
};

// Paso 2/2: si el extracto solicitado ya está PROCESSED, devuelve los
// movimientos parseados; si sigue PENDING, devuelve status: "PENDING" y
// movimientos: null (hay que reintentar más tarde).
export async function descargarGaliciaMovimientos(extractoId: string): Promise<{
  status: string;
  header: string | null;
  movimientos: GaliciaMovimiento[] | null;
}> {
  return callFunction("descargarGaliciaMovimientos", { extractoId }, 120000);
}

// Ajuste manual de stock en Contabilium (no tiene API oficial para esto —
// se hace con una automatización de la consola web, puede tardar unos
// segundos más de lo normal por eso).
// Temporal: prueba nombres de método candidatos en Contabilium a ver si
// alguno devuelve el idCC de un depósito automáticamente. Se puede borrar
// una vez que se resuelva de un lado u otro.
export async function debugProbeIdCC(idInventario: number): Promise<{ resultados: unknown[] }> {
  return callFunction("debugProbeIdCC", { idInventario }, 120000);
}

// Transferencia real entre depósitos (no pide idCC — es automática de punta
// a punta). Solo staff admin.
export async function transferirStockManual(params: {
  depositoOrigenId: number;
  depositoDestinoId: number;
  items: { sku: string; cantidad: number; name?: string }[];
  observaciones?: string;
  depositoOrigenNombre?: string;
  depositoDestinoNombre?: string;
  sinRemito?: boolean;
}): Promise<{
  ok: true;
  idTransferencia: number | null;
  remitoArchivo: string | null;
  remitoPdfBase64: string | null;
}> {
  return callFunction("transferirStockManual", params, 120000);
}

// Paso aparte, después del movimiento: un remito "real" (comprobante REM a
// nombre de un cliente/proveedor elegido a mano) para que la mercadería
// pueda circular en la calle con papeles válidos.
export async function generarRemitoRealManual(params: {
  remitoArchivo: string;
  proveedorContabiliumId: number;
  observaciones?: string;
  incluirMercaderiaConsignacion?: boolean;
}): Promise<{
  ok: true;
  numero: string | null;
  remitoArchivo: string | null;
  remitoPdfBase64: string | null;
}> {
  return callFunction("generarRemitoRealManual", params, 120000);
}

// Confirma un pedido del catálogo: mueve stock real + genera remito real +
// crea el viaje en la grilla, de una sola vez, para cada depósito que el
// admin eligió por ítem.
export async function confirmarPedidoCatalogo(params: {
  orderId: string;
  asignaciones: { itemId: string; depositoOrigenId: number }[];
  fecha?: string;
  turno?: string;
}): Promise<{
  ok: true;
  resultados: Array<{
    depositoOrigenId: number;
    depositoOrigenNombre: string;
    idTransferencia: number | null;
    remitoNumero: string | null;
    remitoInternoArchivo: string | null;
    remitoRealArchivo: string | null;
    remitoEsReal: boolean;
    viajeId: string;
    remitoInternoPdfBase64: string | null;
    remitoRealPdfBase64: string | null;
  }>;
}> {
  return callFunction("confirmarPedidoCatalogo", params, 180000);
}

// Re-descarga el PDF de un remito ya generado (real o interno) por el
// nombre de archivo que quedó guardado en order.envio.resultados.
export async function descargarRemitoPorArchivo(remitoArchivo: string): Promise<{ ok: true; remitoPdfBase64: string }> {
  return callFunction("descargarRemitoPorArchivo", { remitoArchivo }, 60000);
}

export interface DailyBikeStat {
  fecha: string;
  facturadoBicis: number;
  cobradoBicis: number;
  entregadoBicis: number;
  reportadoBicis: number;
  consignadoBicis?: number;
}

export async function getDailyBikeStats(limit?: number): Promise<{ items: DailyBikeStat[] }> {
  return callFunction("getDailyBikeStats", { limit });
}

export async function triggerDailyBikeStatsSync(): Promise<{ dias: number; consignadoHoy: number }> {
  return callFunction("triggerDailyBikeStatsSync", {}, 60000);
}

export async function crearDepositoManual(params: {
  nombre: string;
  direccion?: string;
  telefono?: string;
  idProvincia?: number;
  idCiudad?: number;
}): Promise<{ ok: true; aviso: string }> {
  return callFunction("crearDepositoManual", params, 60000);
}

export async function listarProvincias(): Promise<{ provincias: { id: number; nombre: string }[] }> {
  return callFunction("listarProvincias", {});
}

export async function listarCiudadesContabilium(idProvincia: number): Promise<{ ciudades: { id: number; nombre: string }[] }> {
  return callFunction("listarCiudadesContabilium", { idProvincia }, 60000);
}

export interface ChequeDisponible {
  id: number;
  banco: string;
  codigo: string;
  importe: number;
}

export async function listarChequesDisponiblesContabilium(): Promise<{ cheques: ChequeDisponible[] }> {
  return callFunction("listarChequesDisponiblesContabilium", {}, 60000);
}

// Pide provincia y ciudad por prompt (match por texto contra las listas
// reales de Contabilium) — devuelve los IDs reales, o null si el usuario
// cancela. Pensado para reusarse en los dos lugares donde se crea un
// depósito (Users.jsx y StockConsignado.jsx).
function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export async function pedirProvinciaYCiudad(): Promise<{ idProvincia: number; idCiudad: number } | null> {
  const { provincias } = await listarProvincias();
  const nombreProvincia = window.prompt(
    `Provincia (ej: ${provincias.slice(0, 4).map((p) => p.nombre).join(", ")}...):`,
    "Ciudad de Buenos Aires"
  );
  if (!nombreProvincia || !nombreProvincia.trim()) return null;
  const qp = normalizarTexto(nombreProvincia);
  const provincia = provincias.find((p) => normalizarTexto(p.nombre) === qp) || provincias.find((p) => normalizarTexto(p.nombre).includes(qp));
  if (!provincia) {
    window.alert(`No encontré la provincia "${nombreProvincia}". Probá de nuevo con el nombre exacto.`);
    return null;
  }

  const { ciudades } = await listarCiudadesContabilium(provincia.id);
  const nombreCiudad = window.prompt(
    `Ciudad/localidad en ${provincia.nombre} (hay ${ciudades.length} opciones, escribí el nombre tal cual):`
  );
  if (!nombreCiudad || !nombreCiudad.trim()) return null;
  const qc = normalizarTexto(nombreCiudad);
  const ciudad = ciudades.find((c) => normalizarTexto(c.nombre) === qc) || ciudades.find((c) => normalizarTexto(c.nombre).includes(qc));
  if (!ciudad) {
    window.alert(`No encontré la ciudad "${nombreCiudad}" en ${provincia.nombre}. Probá de nuevo con el nombre exacto.`);
    return null;
  }

  return { idProvincia: provincia.id, idCiudad: ciudad.id };
}

export async function ajustarStockManual(params: {
  depositoId: number;
  sku: string;
  cantidad: number;
  tipoModificacion: "R" | "M";
  idCC?: number | null;
  nroRef?: string;
  observaciones?: string;
}): Promise<{ ok: true }> {
  return callFunction("ajustarStockManual", params, 120000);
}

// Prueba/actualiza el precio de UN producto por SKU en Contabilium — paso
// previo a la sincronización masiva, para confirmar si el REST de
// Contabilium soporta escribir conceptos (nunca se hizo antes acá) y qué
// campos trae crudos. dryRun:true no modifica nada, solo trae el objeto
// crudo del concepto tal cual lo devuelve Contabilium.
export async function adminProbarPrecioProducto(params: {
  sku: string;
  precioConIva?: number;
  dryRun?: boolean;
}): Promise<any> {
  return callFunction("adminProbarPrecioProducto", params, 60000);
}

// Sincroniza el precio con IVA de TODO el catálogo contra Contabilium.
// apply:false (default) solo arma el reporte de diferencias, sin escribir
// nada. apply:true escribe SOLO en los productos que hoy están sin precio
// cargado en Contabilium — los que ya tienen un precio distinto cargado
// quedan listados aparte, para revisar a mano antes de pisarlos.
export async function adminSincronizarPreciosCatalogo(apply: boolean): Promise<any> {
  return callFunction("adminSincronizarPreciosCatalogo", { apply }, 280000);
}

// Carga un cheque de verdad en Tesorería > Cheques de Contabilium (no en la
// cartera interna `chequesRegistrados` de Samurai) — automatización web, ver
// cargarChequeWeb en contabiliumWebAutomation.js. `banco` es el nombre tal
// cual figura en el desplegable de Contabilium (se resuelve solo, con
// coincidencia parcial). Fechas en formato yyyy-mm-dd (de un <input date>).
export async function cargarChequeManual(params: {
  banco: string;
  numero: string;
  importe: number;
  fechaEmision: string;
  fechaCobro: string;
  fechaVencimiento?: string;
  emisor?: string;
  observaciones?: string;
  esPropio?: boolean;
}): Promise<{ ok: true; idCheque: number; idBanco: number; bancoNombre: string | null }> {
  return callFunction("cargarChequeManual", params, 120000);
}

// Carga una cobranza "a cuenta" (sin aplicar a ninguna factura) para un
// cliente — automatización web, ver cargarCobranzaACuentaWeb en
// contabiliumWebAutomation.js. `banco` es la cuenta PROPIA de la empresa
// (ej. "Banco Supervielle"), no el banco del cliente. Fecha en yyyy-mm-dd.
export async function cargarCobranzaACuentaManual(params: {
  idPersona: number;
  importe: number;
  fecha: string;
  forma?: string;
  banco?: string;
  idBanco?: number;
  caja?: string;
  idCaja?: number;
  nroRef?: string;
  observaciones?: string;
}): Promise<{ ok: true; nroComprobante: string; idBanco: number; bancoNombre: string | null }> {
  return callFunction("cargarCobranzaACuentaManual", params, 120000);
}
