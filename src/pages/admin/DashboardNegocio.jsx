// src/pages/admin/DashboardNegocio.jsx
import { useEffect, useMemo, useState } from "react";
import {
  subscribeBusinessDashboard,
  subscribeBusinessDashboardDetail,
  triggerBusinessDashboardSync,
  subscribeClientesReportDetail,
  subscribeRemitosDespachos,
  subscribeRemitosDespachosDetail,
} from "../../services/comprobantes";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function mesLabel(mes) {
  if (!mes) return "-";
  const [y, m] = mes.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("es-AR", { month: "short", year: "numeric" });
}

export default function DashboardNegocio() {
  const [resumen, setResumen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reporteClientes, setReporteClientes] = useState(null);
  const [remitosResumen, setRemitosResumen] = useState(null);
  const [remitosDetail, setRemitosDetail] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState("");
  const [bicisSimulacion, setBicisSimulacion] = useState(10);

  useEffect(() => {
    const u1 = subscribeBusinessDashboard(setResumen);
    const u2 = subscribeBusinessDashboardDetail(setDetail);
    const u3 = subscribeClientesReportDetail(setReporteClientes);
    const u4 = subscribeRemitosDespachos(setRemitosResumen);
    const u5 = subscribeRemitosDespachosDetail(setRemitosDetail);
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
    };
  }, []);

  async function handleRefrescar() {
    setRefrescando(true);
    setError("");
    try {
      await triggerBusinessDashboardSync();
    } catch (e) {
      setError(e.message || "No se pudo actualizar (puede tardar varios minutos, probá de nuevo si dio timeout)");
    } finally {
      setRefrescando(false);
    }
  }

  const porMes = detail?.porMes || [];
  const ultimos12 = useMemo(() => porMes.slice(-12), [porMes]);
  const maxFacturado = useMemo(() => Math.max(1, ...ultimos12.map((m) => m.facturado)), [ultimos12]);
  const maxBicis = useMemo(() => Math.max(1, ...ultimos12.map((m) => m.bicis)), [ultimos12]);

  const deudaTotal = reporteClientes?.rows?.reduce((a, r) => a + (r.saldoDeudor || 0), 0) || 0;
  const aFavorTotal = reporteClientes?.rows?.reduce((a, r) => a + (r.saldoAFavor || 0), 0) || 0;

  const promedio = resumen?.promedio;
  const proyeccion = promedio
    ? {
        facturado: bicisSimulacion * promedio.precioPromedioPorBici,
        margen: promedio.margenPromedioPorBici != null ? bicisSimulacion * promedio.margenPromedioPorBici : null,
      }
    : null;

  const loading = resumen === undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard de Gestión</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Ventas, facturación y salud financiera de la empresa
            {detail?.updatedAt ? ` · actualizado ${detail.updatedAt.toLocaleString("es-AR")}` : ""}
          </p>
        </div>
        <button
          onClick={handleRefrescar}
          disabled={refrescando}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          {refrescando ? "Actualizando… (puede tardar varios minutos)" : "🔄 Refrescar"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {!resumen && !loading && (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Sin datos todavía — tocá "Refrescar" para generar el dashboard.</p>
      )}

      {resumen && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-slate-500 dark:text-neutral-400">Bicis vendidas (histórico)</p>
              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{resumen.totalBicisVendidas.toLocaleString("es-AR")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-slate-500 dark:text-neutral-400">Facturado (histórico)</p>
              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{money(resumen.totalFacturado)}</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30">
              <p className="text-xs text-rose-600 dark:text-rose-400">Deuda total (clientes)</p>
              <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-300">{money(deudaTotal)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">A favor total (clientes)</p>
              <p className="mt-1 text-xl font-bold text-emerald-800 dark:text-emerald-300">{money(aFavorTotal)}</p>
            </div>
          </div>

          {detail?.bicisInactivasExcluidas?.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              ⚠️ {detail.bicisInactivasExcluidas.length} bici(s) facturada(s) no se cuentan en "bicis por mes" porque su producto está
              inactivo hoy en el catálogo (reactivalo si fue un error): {" "}
              {[...new Set(detail.bicisInactivasExcluidas.map((b) => `${b.nombre} (${b.mes})`))].slice(0, 10).join(", ")}
            </div>
          )}

          {!resumen.tieneCostosCargados && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              ⚠️ No hay costo cargado en ningún producto todavía — el margen (ganancia) no se puede calcular. Cargalo en cada bici desde
              Productos → editar → campo "Costo (ARS)".
            </div>
          )}

          {/* Ventas por mes */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Bicis vendidas y facturación por mes (últimos 12)</h2>
            {ultimos12.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500">Sin ventas registradas todavía.</p>
            ) : (
              <div className="space-y-2 overflow-x-auto">
                {ultimos12.map((m) => (
                  <div key={m.mes} className="flex items-center gap-3 text-xs">
                    <span className="w-16 shrink-0 text-slate-500 dark:text-neutral-400">{mesLabel(m.mes)}</span>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-neutral-800">
                          <div
                            className="h-2 rounded-full bg-indigo-500"
                            style={{ width: `${Math.max(2, (m.facturado / maxFacturado) * 100)}%` }}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right font-medium text-slate-700 dark:text-neutral-300">{money(m.facturado)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-neutral-800">
                          <div className="h-2 rounded-full bg-sky-400" style={{ width: `${Math.max(2, (m.bicis / maxBicis) * 100)}%` }} />
                        </div>
                        <span className="w-24 shrink-0 text-right text-slate-500 dark:text-neutral-400">{m.bicis} bicis</span>
                      </div>
                    </div>
                    {m.margenBicis != null && (
                      <span
                        className={`w-24 shrink-0 text-right text-[11px] font-semibold ${m.margenBicis >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                      >
                        margen {money(m.margenBicis)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Despachos reales por remito */}
          {remitosResumen && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">📦 Despachos reales (remitos de Contabilium)</h2>
              <p className="mb-3 text-xs text-slate-500 dark:text-neutral-400">
                {remitosResumen.fuente} · rango {remitosResumen.rangoDatos.desde} a {remitosResumen.rangoDatos.hasta}. Los remitos no tienen API
                pública en Contabilium — este dato es una foto exportada a mano, no se actualiza solo (avisame cuando quieras un refresco).
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-neutral-800">
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400">Remitos totales</p>
                  <p className="text-base font-bold text-slate-900 dark:text-white">{remitosResumen.totalRemitos}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30">
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Bicis a distribuidores</p>
                  <p className="text-base font-bold text-emerald-800 dark:text-emerald-300">{remitosResumen.totalBicisDistribuidores.toLocaleString("es-AR")}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-neutral-800">
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400">Bicis mov. interno (propios)</p>
                  <p className="text-base font-bold text-slate-900 dark:text-white">{remitosResumen.totalBicisInternos.toLocaleString("es-AR")}</p>
                </div>
              </div>

              {remitosDetail?.porCliente?.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-neutral-300">Top clientes por bicis despachadas</p>
                  <div className="space-y-1">
                    {remitosDetail.porCliente.slice(0, 10).map((c) => (
                      <div key={c.nombre} className="flex items-center justify-between text-xs">
                        <span className="truncate text-slate-600 dark:text-neutral-300">{c.nombre}</span>
                        <span className="shrink-0 font-semibold text-slate-900 dark:text-white">{c.bicis}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Proyección */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
            <h2 className="mb-1 text-sm font-semibold text-indigo-900 dark:text-indigo-300">📈 Proyección</h2>
            {!promedio ? (
              <p className="text-sm text-indigo-700 dark:text-indigo-400">
                Sin suficientes meses con ventas todavía para calcular un promedio confiable.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-indigo-700 dark:text-indigo-400">
                  Basado en el promedio real de {promedio.mesesConsiderados.map(mesLabel).join(", ")}: se vendieron{" "}
                  <b>{promedio.bicisPromedioPorMes.toFixed(1)} bicis/mes</b> a un precio promedio de{" "}
                  <b>{money(promedio.precioPromedioPorBici)}</b> por bici
                  {promedio.costoPromedioPorBici != null && <> (costo promedio {money(promedio.costoPromedioPorBici)})</>}.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm font-medium text-indigo-900 dark:text-indigo-300">Si vendemos</label>
                  <input
                    type="number"
                    min={0}
                    value={bicisSimulacion}
                    onChange={(e) => setBicisSimulacion(Number(e.target.value) || 0)}
                    className="w-24 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm dark:border-indigo-700 dark:bg-neutral-900 dark:text-white"
                  />
                  <span className="text-sm font-medium text-indigo-900 dark:text-indigo-300">bicis más este mes:</span>
                </div>
                {proyeccion && (
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-white p-3 dark:bg-neutral-900">
                      <p className="text-[11px] text-slate-500 dark:text-neutral-400">Facturación extra</p>
                      <p className="text-base font-bold text-slate-900 dark:text-white">{money(proyeccion.facturado)}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 dark:bg-neutral-900">
                      <p className="text-[11px] text-slate-500 dark:text-neutral-400">Ganancia extra</p>
                      <p className="text-base font-bold text-slate-900 dark:text-white">
                        {proyeccion.margen != null ? money(proyeccion.margen) : "Sin costo cargado"}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
