// src/components/admin/InformeCompletoVendedorPanel.jsx
// Informe completo en vivo de un vendedor con `vendedoresAsignados` (Cuchi)
// o de logística "solo flete" (Jíbaro/Cañuelas, Credifin, Vito/Julián):
// resumen general, por mes (viajes/flete/ventas/comisión), entregado por
// cliente (ENTREGADO = stock actual consignado + vendido, sin importar de
// qué depósito salió — verificado a mano el 19/10/2026) y el detalle de
// viajes/retiros/ventas. Compartido entre "Mis Vendedores" (lo que ve el
// propio vendedor) y "Cuentas corrientes — Logística" (lo que ve el admin
// de cualquiera de los 4), para no tener dos lógicas/pantallas distintas
// dando números distintos.
import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import {
  getInformeCompletoVendedor,
  descargarInformeCompletoVendedor,
  adminConfirmarCobroManual,
  adminQuitarCobroManual,
  adminCerrarLiquidacionVendedor,
} from "../../services/comprobantes";

function descargarBase64Xlsx(base64, filename) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "informe.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

const money = (n) =>
  n == null ? "—" : Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFechaCorta(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : `${s}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function InformeCompletoVendedorPanel({ vendedorUid }) {
  const [informe, setInforme] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [descargando, setDescargando] = useState(false);
  const [verViajes, setVerViajes] = useState(false);
  const [verRetiros, setVerRetiros] = useState(false);
  const [verReportadas, setVerReportadas] = useState(false);
  const [verVentas, setVerVentas] = useState(false);
  const [verConfirmarCobro, setVerConfirmarCobro] = useState(false);
  const [buscarCliente, setBuscarCliente] = useState("");
  const [ventaElegida, setVentaElegida] = useState(null); // {numero, cliente, modelo, monto}
  const [montoCobradoInput, setMontoCobradoInput] = useState("");
  const [guardandoCobro, setGuardandoCobro] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [clienteModelosAbierto, setClienteModelosAbierto] = useState(null); // nombre del cliente con el desglose de modelos vendidos abierto

  const cargar = useCallback(() => {
    setCargando(true);
    setError("");
    getInformeCompletoVendedor(vendedorUid)
      .then(setInforme)
      .catch((e) => setError(e.message || "No se pudo cargar el informe"))
      .finally(() => setCargando(false));
  }, [vendedorUid]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function descargarExcel() {
    setDescargando(true);
    setError("");
    try {
      const r = await descargarInformeCompletoVendedor(vendedorUid);
      descargarBase64Xlsx(r.base64, r.filename);
    } catch (e) {
      setError(e.message || "No se pudo generar el Excel");
    } finally {
      setDescargando(false);
    }
  }

  async function confirmarCobro() {
    if (!ventaElegida) return;
    setGuardandoCobro(true);
    setError("");
    try {
      const monto = montoCobradoInput === "" ? undefined : Number(montoCobradoInput);
      await adminConfirmarCobroManual(vendedorUid, ventaElegida.numero, monto, ventaElegida.monto, ventaElegida.cliente, ventaElegida.modelo);
      setVentaElegida(null);
      setMontoCobradoInput("");
      setBuscarCliente("");
      cargar();
    } catch (e) {
      setError(e.message || "No se pudo confirmar el cobro");
    } finally {
      setGuardandoCobro(false);
    }
  }

  async function cerrarLiquidacion() {
    if (!informe) return;
    const monto = money(informe.totalNetoAPagar);
    const ok = window.confirm(
      `¿Cerrar este período y marcarlo como pagado?\n\nTotal neto pagado: ${monto}\n\n` +
        `El próximo informe arranca de cero: el flete se va a calcular solo sobre retiros y entregas nuevas a partir de hoy.`
    );
    if (!ok) return;
    setCerrando(true);
    setError("");
    try {
      await adminCerrarLiquidacionVendedor({
        vendedorUid,
        desde: informe.desdeISO,
        hasta: informe.hoyISOVal,
        totalFlete: informe.totalFlete,
        totalComision: informe.totalComision,
        totalCobradoPorVendedor: informe.totalCobradoPorVendedor ?? 0,
        totalNetoAPagar: informe.totalNetoAPagar,
        pagosManuales: informe.pagosManuales || [],
      });
      cargar();
    } catch (e) {
      setError(e.message || "No se pudo cerrar el período");
    } finally {
      setCerrando(false);
    }
  }

  async function quitarCobro(numero) {
    setGuardandoCobro(true);
    setError("");
    try {
      await adminQuitarCobroManual(vendedorUid, numero);
      cargar();
    } catch (e) {
      setError(e.message || "No se pudo quitar la confirmación");
    } finally {
      setGuardandoCobro(false);
    }
  }

  const panel = informe?.panel;
  const todasLasVentas = (informe?.resumenesPorMes || []).flatMap((r) => (r.detalle || []).map((d) => ({ ...d, mes: r.mes })));

  const q = buscarCliente.trim().toLowerCase();
  const resultadosBusqueda = useMemo(() => {
    if (q.length < 2) return [];
    return todasLasVentas
      .filter((v) => (v.cliente || "").toLowerCase().includes(q) && v.numero)
      .slice(0, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, informe]);

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-indigo-800 dark:text-indigo-400">📦 Informe completo</h2>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">
            Entregado, vendido, cobrado, comisión, viajes y retiros — desde {informe ? formatFechaCorta(informe.desdeISO) : "…"}.
            {informe?.fechaUltimaLiquidacion && (
              <> · Última liquidación cerrada: {formatFechaCorta(informe.fechaUltimaLiquidacion)}</>
            )}
          </p>
        </div>
        {informe && !cargando && (
          <div className="flex items-center gap-2">
            <button
              onClick={descargarExcel}
              disabled={descargando}
              className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-800 dark:bg-neutral-900 dark:text-indigo-400"
            >
              {descargando ? "Generando…" : "📥 Descargar Excel"}
            </button>
            <button
              onClick={cerrarLiquidacion}
              disabled={cerrando}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
            >
              {cerrando ? "Cerrando…" : "✅ Cerrar y marcar como pagado"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {cargando && <p className="mt-2 text-xs text-indigo-700/70 dark:text-indigo-400/60">Calculando (puede tardar un minuto)…</p>}

      {/* Aviso bien visible de lo que ya se confirmó cobrado a mano — para
          que salte apenas se abre el informe, no quede escondido. */}
      {informe && !cargando && (informe.pagosManuales?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
          <p className="text-xs font-bold text-emerald-800 dark:text-emerald-400">✅ Ya cobrado (confirmado a mano)</p>
          <ul className="mt-1.5 space-y-1">
            {informe.pagosManuales.map((p) => (
              <li key={p.numero} className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                <span>
                  <strong>{p.cliente}</strong> — {p.producto || "(producto sin identificar)"} — {p.numero} —{" "}
                  {p.tipo === "parcial" ? `${money(p.monto)} de ${money(p.montoTotal)} (parcial)` : money(p.monto)}
                  {p.seDescuenta === false && (
                    <span className="ml-1 text-[10px] font-normal text-slate-500 dark:text-neutral-400">
                      (reconciliación — le pagó a Fepa normal, NO se descuenta)
                    </span>
                  )}
                </span>
                <button
                  onClick={() => quitarCobro(p.numero)}
                  disabled={guardandoCobro}
                  className="text-[11px] text-rose-600 underline hover:text-rose-700 disabled:opacity-50 dark:text-rose-400"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confirmar un cobro nuevo a mano — buscar cliente, elegir la venta,
          cargar cuánto se cobró (completo o parcial). */}
      {informe && !cargando && (
        <div className="mt-3">
          <button
            onClick={() => setVerConfirmarCobro((v) => !v)}
            className="text-xs font-bold text-indigo-800 underline decoration-dotted dark:text-indigo-400"
          >
            💰 {verConfirmarCobro ? "Ocultar" : "Confirmar un cobro"}
          </button>
          {verConfirmarCobro && (
            <div className="mt-2 rounded-xl border border-indigo-200 bg-white p-3 dark:border-indigo-900 dark:bg-neutral-900">
              {!ventaElegida ? (
                <>
                  <input
                    value={buscarCliente}
                    onChange={(e) => setBuscarCliente(e.target.value)}
                    placeholder="Buscar cliente…"
                    className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-sm dark:border-indigo-900 dark:bg-neutral-950 dark:text-white"
                  />
                  {resultadosBusqueda.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-indigo-100 dark:border-indigo-900/50">
                      {resultadosBusqueda.map((v, i) => (
                        <button
                          key={`${v.numero}-${i}`}
                          onClick={() => {
                            setVentaElegida(v);
                            setMontoCobradoInput(String(v.monto));
                          }}
                          className="block w-full border-b border-indigo-50 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-indigo-50 dark:border-indigo-950/50 dark:hover:bg-indigo-950/30"
                        >
                          <span className="font-semibold">{v.cliente}</span> — {v.modelo} — {v.numero} — {money(v.monto)}
                        </button>
                      ))}
                    </div>
                  )}
                  {q.length >= 2 && resultadosBusqueda.length === 0 && (
                    <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Sin resultados para "{buscarCliente}".</p>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-700 dark:text-neutral-200">
                    <strong>{ventaElegida.cliente}</strong> — {ventaElegida.modelo} — {ventaElegida.numero} — Total: {money(ventaElegida.monto)}
                  </p>
                  <label className="block text-xs text-slate-600 dark:text-neutral-300">
                    Monto cobrado
                    <input
                      type="number"
                      value={montoCobradoInput}
                      onChange={(e) => setMontoCobradoInput(e.target.value)}
                      className="ml-2 w-32 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs dark:border-indigo-900 dark:bg-neutral-950 dark:text-white"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={confirmarCobro}
                      disabled={guardandoCobro}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {guardandoCobro ? "Guardando…" : "Confirmar cobro"}
                    </button>
                    <button
                      onClick={() => {
                        setVentaElegida(null);
                        setMontoCobradoInput("");
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-neutral-700 dark:text-neutral-300"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {informe && !cargando && (
        <>
          {/* Resumen general */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Entregado en total</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{panel.totalEntregado}</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Vendidas</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{panel.totalVendido}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Cobradas</p>
              <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{panel.totalPagado}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-[11px] text-amber-700 dark:text-amber-400">Vendidas sin cobrar</p>
              <p className="mt-1 text-base font-bold text-amber-700 dark:text-amber-400">{panel.totalPendiente}</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Viajes (todos)</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{informe.totalViajesComision}</p>
              {informe.usaFleteDeMovimiento && (
                <p className="mt-0.5 text-[10px] text-slate-400 dark:text-neutral-500">
                  {informe.totalUnidadesComision ?? 0} entregas a clientes + {informe.totalRetirado ?? 0} retiros a su depósito
                </p>
              )}
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Flete total</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(informe.totalFlete)}</p>
              {informe.usaFleteDeMovimiento ? (
                <p className="mt-0.5 text-[10px] text-slate-400 dark:text-neutral-500">
                  {(informe.totalUnidadesComision ?? 0) + (informe.totalRetirado ?? 0)} movimientos × {money(informe.totalFlete / (((informe.totalUnidadesComision ?? 0) + (informe.totalRetirado ?? 0)) || 1))}
                </p>
              ) : (
                <p className="mt-0.5 text-[10px] text-slate-400 dark:text-neutral-500">
                  {informe.totalEntregadoMasStock} bicis (entregado + stock propio) × {money(informe.totalFlete / (informe.totalEntregadoMasStock || 1))}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Comisión total</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(informe.totalComision)}</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Entregado + stock propio</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                {informe.totalEntregadoMasStock}
                <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-neutral-500">
                  ({panel.totalEntregado} + {informe.stockPropio} en su depósito)
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total neto a pagarle</p>
              <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{money(informe.totalNetoAPagar)}</p>
              <p className="mt-0.5 text-[10px] text-emerald-700/70 dark:text-emerald-400/70">
                {money(informe.totalFlete + informe.totalComision)} (flete + comisión) − {money(informe.totalCobradoPorVendedor ?? 0)} (ya cobrado por él)
              </p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Ventas reportadas</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                {informe.totalVentasReportadas ?? 0}
                <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-neutral-500">
                  ({informe.totalVentasPendientes ?? 0} sin facturar)
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Cobradas</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{panel.totalPagado}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Cobrado ($)</p>
              <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{money(panel.totalCobradoDinero ?? 0)}</p>
              <p className="mt-0.5 text-[10px] text-slate-400 dark:text-neutral-500">Incluye pagos parciales confirmados a mano</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">COTs</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{informe.totalVentasCOT ?? 0}</p>
            </div>
          </div>

          {/* Resumen por mes — el flete ya NO es por mes (ver tile "Flete
              total" arriba, es un único total sobre entregado+stock), acá
              queda solo la comisión (que sí es por fecha real de cada
              factura) y los viajes/unidades a modo informativo. */}
          <p className="mb-1.5 mt-5 text-xs font-bold text-indigo-800 dark:text-indigo-400">📅 Mes a mes (ventas y comisión)</p>
          <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/50">
            <table className="min-w-full divide-y divide-indigo-100 text-xs dark:divide-indigo-900/50">
              <thead className="bg-indigo-50/60 dark:bg-indigo-950/20">
                <tr className="text-left text-slate-500 dark:text-neutral-400">
                  <th className="px-3 py-2 font-semibold">Mes</th>
                  <th className="px-3 py-2 text-right font-semibold">Viajes</th>
                  <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                  <th className="px-3 py-2 text-right font-semibold">Ventas</th>
                  <th className="px-3 py-2 text-right font-semibold">Comisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50 bg-white dark:divide-indigo-950/30 dark:bg-neutral-900">
                {informe.resumenesPorMes.map((r) => (
                  <tr key={r.mes}>
                    <td className="px-3 py-1.5">{r.mes}</td>
                    <td className="px-3 py-1.5 text-right">{r.viajes}</td>
                    <td className="px-3 py-1.5 text-right">{r.unidadesEntregadas ?? 0}</td>
                    <td className="px-3 py-1.5 text-right">{money(r.ventasTotal)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{money(r.comisionTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-indigo-200 bg-indigo-50/80 font-bold text-slate-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-white">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{informe.totalViajesComision}</td>
                  <td className="px-3 py-2 text-right">{informe.totalUnidadesComision ?? 0}</td>
                  <td className="px-3 py-2 text-right">{money(informe.resumenesPorMes.reduce((a, r) => a + (r.ventasTotal || 0), 0))}</td>
                  <td className="px-3 py-2 text-right">{money(informe.totalComision)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Entregado por cliente */}
          {panel.clientes.length > 0 && (
            <>
              <p className="mb-1.5 mt-5 text-xs font-bold text-indigo-800 dark:text-indigo-400">🧑‍🤝‍🧑 Por cliente</p>
              <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                <table className="min-w-full divide-y divide-indigo-100 text-xs dark:divide-indigo-900/50">
                  <thead className="bg-indigo-50/60 dark:bg-indigo-950/20">
                    <tr className="text-left text-slate-500 dark:text-neutral-400">
                      <th className="px-3 py-2 font-semibold">Cliente</th>
                      <th className="px-3 py-2 text-right font-semibold">Stock</th>
                      <th className="px-3 py-2 text-right font-semibold">Vendidas</th>
                      <th className="px-3 py-2 text-right font-semibold">Cobradas</th>
                      <th className="px-3 py-2 text-right font-semibold">Entregado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-50 bg-white dark:divide-indigo-950/30 dark:bg-neutral-900">
                    {panel.clientes.map((c) => {
                      const modelosAbiertos = clienteModelosAbierto === c.cliente;
                      const tieneModelos = (c.modelos || []).length > 0;
                      return (
                        <Fragment key={c.cliente}>
                          <tr>
                            <td className="px-3 py-1.5">{c.cliente}</td>
                            <td className="px-3 py-1.5 text-right">{c.stock}</td>
                            <td className="px-3 py-1.5 text-right">
                              {tieneModelos ? (
                                <button
                                  type="button"
                                  onClick={() => setClienteModelosAbierto(modelosAbiertos ? null : c.cliente)}
                                  className="underline decoration-dotted hover:text-indigo-600 dark:hover:text-indigo-400"
                                  title="Ver qué modelos vendió"
                                >
                                  {c.vendido} {modelosAbiertos ? "▲" : "▾"}
                                </button>
                              ) : (
                                c.vendido
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {c.pagado}
                              {c.pendiente > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">(+{c.pendiente} sin cobrar)</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right font-semibold">{c.entregado}</td>
                          </tr>
                          {modelosAbiertos && tieneModelos && (
                            <tr>
                              <td colSpan={5} className="bg-indigo-50/40 px-3 py-2 dark:bg-indigo-950/10">
                                <div className="flex flex-wrap gap-1.5">
                                  {c.modelos.map((m) => (
                                    <span
                                      key={m.modelo}
                                      className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 shadow-sm dark:bg-neutral-800 dark:text-neutral-300"
                                    >
                                      {m.modelo} × {m.cantidad}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-indigo-200 bg-indigo-50/80 font-bold text-slate-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-white">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right">{panel.clientes.reduce((a, c) => a + c.stock, 0)}</td>
                      <td className="px-3 py-2 text-right">{panel.totalVendido}</td>
                      <td className="px-3 py-2 text-right">{panel.totalPagado}</td>
                      <td className="px-3 py-2 text-right">{panel.totalEntregado}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {/* Ventas detalladas (colapsable) */}
          {todasLasVentas.length > 0 && (
            <>
              <button
                onClick={() => setVerVentas((v) => !v)}
                className="mb-1.5 mt-5 text-xs font-bold text-indigo-800 underline decoration-dotted dark:text-indigo-400"
              >
                🧾 {verVentas ? "Ocultar" : "Ver"} ventas, una por una ({todasLasVentas.length})
              </button>
              {verVentas && (
                <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                  <table className="min-w-full divide-y divide-indigo-100 text-xs dark:divide-indigo-900/50">
                    <thead className="bg-indigo-50/60 dark:bg-indigo-950/20">
                      <tr className="text-left text-slate-500 dark:text-neutral-400">
                        <th className="px-3 py-2 font-semibold">Fecha</th>
                        <th className="px-3 py-2 font-semibold">Cliente</th>
                        <th className="px-3 py-2 font-semibold">Producto</th>
                        <th className="px-3 py-2 text-right font-semibold">Cant.</th>
                        <th className="px-3 py-2 text-right font-semibold">Monto</th>
                        <th className="px-3 py-2 text-center font-semibold">Cobrada</th>
                        <th className="px-3 py-2 text-right font-semibold">Comisión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-indigo-50 bg-white dark:divide-indigo-950/30 dark:bg-neutral-900">
                      {todasLasVentas.map((v, i) => (
                        <tr key={i} className={v.tipo === "NCA" ? "text-rose-600 dark:text-rose-400" : ""}>
                          <td className="whitespace-nowrap px-3 py-1.5">{formatFechaCorta(v.fecha)}</td>
                          <td className="px-3 py-1.5">{v.cliente}</td>
                          <td className="px-3 py-1.5">
                            {v.modelo}
                            {v.tipo === "NCA" && <span className="ml-1 text-[10px] font-semibold">(N. Crédito)</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right">{v.cantidad ?? "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right">{money(v.monto)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-center">
                            {v.pagada ? (
                              <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">sin cobrar</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">
                            {money(v.comision)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Viajes detallados (colapsable) — entregas DESDE su depósito */}
          <button
            onClick={() => setVerViajes((v) => !v)}
            className="mb-1.5 mt-5 text-xs font-bold text-indigo-800 underline decoration-dotted dark:text-indigo-400"
          >
            🚚 {verViajes ? "Ocultar" : "Ver"} viajes a clientes, agrupados ({informe.viajes.length})
          </button>
          {verViajes && (
            <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/50">
              <table className="min-w-full divide-y divide-indigo-100 text-xs dark:divide-indigo-900/50">
                <thead className="bg-indigo-50/60 dark:bg-indigo-950/20">
                  <tr className="text-left text-slate-500 dark:text-neutral-400">
                    <th className="px-3 py-2 font-semibold">Fecha</th>
                    <th className="px-3 py-2 font-semibold">Destino</th>
                    <th className="px-3 py-2 font-semibold">Productos</th>
                    <th className="px-3 py-2 font-semibold">Observación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-50 bg-white dark:divide-indigo-950/30 dark:bg-neutral-900">
                  {informe.viajes.map((v, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-3 py-1.5 align-top">{formatFechaCorta(v.fecha)}</td>
                      <td className="px-3 py-1.5 align-top">{v.destino}</td>
                      <td className="px-3 py-1.5">
                        {v.items.map((it, j) => (
                          <div key={j}>
                            {it.cantidad}x {it.producto}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-1.5 align-top text-slate-500 dark:text-neutral-400">{v.descripcion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Retiros desde Lavalle/otros (colapsable) — ENTRAN a su depósito */}
          <button
            onClick={() => setVerRetiros((v) => !v)}
            className="mb-1.5 mt-5 text-xs font-bold text-indigo-800 underline decoration-dotted dark:text-indigo-400"
          >
            📦 {verRetiros ? "Ocultar" : "Ver"} retiros de Lavalle/otros, uno por uno ({informe.retiros.length})
          </button>
          {verRetiros && (
            <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/50">
              <table className="min-w-full divide-y divide-indigo-100 text-xs dark:divide-indigo-900/50">
                <thead className="bg-indigo-50/60 dark:bg-indigo-950/20">
                  <tr className="text-left text-slate-500 dark:text-neutral-400">
                    <th className="px-3 py-2 font-semibold">Fecha</th>
                    <th className="px-3 py-2 font-semibold">Origen</th>
                    <th className="px-3 py-2 font-semibold">Productos</th>
                    <th className="px-3 py-2 font-semibold">Observación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-50 bg-white dark:divide-indigo-950/30 dark:bg-neutral-900">
                  {informe.retiros.map((v, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-3 py-1.5 align-top">{formatFechaCorta(v.fecha)}</td>
                      <td className="px-3 py-1.5 align-top">{v.origen}</td>
                      <td className="px-3 py-1.5">
                        {v.items.map((it, j) => (
                          <div key={j}>
                            {it.cantidad}x {it.producto}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-1.5 align-top text-slate-500 dark:text-neutral-400">{v.descripcion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {informe.totalDevuelto > 0 && (
                <p className="border-t border-indigo-100 bg-indigo-50/40 px-3 py-1.5 text-[11px] text-slate-500 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-neutral-400">
                  De estas, {informe.totalDevuelto} unidades se devolvieron después a un depósito propio de Samurai.
                </p>
              )}
            </div>
          )}

          {/* Ventas reportadas por sus clientes (colapsable) */}
          {(informe.ventasReportadas?.length ?? 0) > 0 && (
            <>
              <button
                onClick={() => setVerReportadas((v) => !v)}
                className="mb-1.5 mt-5 text-xs font-bold text-indigo-800 underline decoration-dotted dark:text-indigo-400"
              >
                📲 {verReportadas ? "Ocultar" : "Ver"} ventas reportadas por sus clientes, una por una ({informe.ventasReportadas.length})
              </button>
              {verReportadas && (
                <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                  <table className="min-w-full divide-y divide-indigo-100 text-xs dark:divide-indigo-900/50">
                    <thead className="bg-indigo-50/60 dark:bg-indigo-950/20">
                      <tr className="text-left text-slate-500 dark:text-neutral-400">
                        <th className="px-3 py-2 font-semibold">Fecha</th>
                        <th className="px-3 py-2 font-semibold">Cliente</th>
                        <th className="px-3 py-2 font-semibold">Producto</th>
                        <th className="px-3 py-2 text-right font-semibold">Cant.</th>
                        <th className="px-3 py-2 font-semibold">Tipo</th>
                        <th className="px-3 py-2 font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-indigo-50 bg-white dark:divide-indigo-950/30 dark:bg-neutral-900">
                      {informe.ventasReportadas.map((v, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap px-3 py-1.5">{formatFechaCorta(v.fecha)}</td>
                          <td className="px-3 py-1.5">{v.cliente}</td>
                          <td className="px-3 py-1.5">{v.producto}</td>
                          <td className="px-3 py-1.5 text-right">{v.cantidad}</td>
                          <td className="px-3 py-1.5">{v.tipo}</td>
                          <td className="px-3 py-1.5">
                            {v.estado === "pendiente" ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                                Sin facturar
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                                Facturado {v.numeroFactura ? `(${v.numeroFactura})` : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
