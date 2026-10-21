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
import { useState, useEffect } from "react";
import { getInformeCompletoVendedor, descargarInformeCompletoVendedor } from "../../services/comprobantes";

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
  const [verVentas, setVerVentas] = useState(false);

  useEffect(() => {
    setCargando(true);
    setError("");
    getInformeCompletoVendedor(vendedorUid)
      .then(setInforme)
      .catch((e) => setError(e.message || "No se pudo cargar el informe"))
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedorUid]);

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

  const panel = informe?.panel;
  const todasLasVentas = (informe?.resumenesPorMes || []).flatMap((r) => (r.detalle || []).map((d) => ({ ...d, mes: r.mes })));

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-indigo-800 dark:text-indigo-400">📦 Informe completo</h2>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">
            Entregado, vendido, cobrado, comisión, viajes y retiros — desde {informe ? formatFechaCorta(informe.desdeISO) : "…"}.
          </p>
        </div>
        {informe && !cargando && (
          <button
            onClick={descargarExcel}
            disabled={descargando}
            className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-800 dark:bg-neutral-900 dark:text-indigo-400"
          >
            {descargando ? "Generando…" : "📥 Descargar Excel"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {cargando && <p className="mt-2 text-xs text-indigo-700/70 dark:text-indigo-400/60">Calculando (puede tardar un minuto)…</p>}

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
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Unidades (para flete)</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{informe.totalUnidadesComision ?? 0}</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Flete total</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(informe.totalFlete)}</p>
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
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total a cobrar</p>
              <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{money(informe.totalFlete + informe.totalComision)}</p>
            </div>
          </div>

          {/* Resumen por mes */}
          <p className="mb-1.5 mt-5 text-xs font-bold text-indigo-800 dark:text-indigo-400">📅 Mes a mes</p>
          <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/50">
            <table className="min-w-full divide-y divide-indigo-100 text-xs dark:divide-indigo-900/50">
              <thead className="bg-indigo-50/60 dark:bg-indigo-950/20">
                <tr className="text-left text-slate-500 dark:text-neutral-400">
                  <th className="px-3 py-2 font-semibold">Mes</th>
                  <th className="px-3 py-2 text-right font-semibold">Viajes</th>
                  <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                  <th className="px-3 py-2 text-right font-semibold">Flete</th>
                  <th className="px-3 py-2 text-right font-semibold">Ventas</th>
                  <th className="px-3 py-2 text-right font-semibold">Comisión</th>
                  <th className="px-3 py-2 text-right font-semibold">Total a cobrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50 bg-white dark:divide-indigo-950/30 dark:bg-neutral-900">
                {informe.resumenesPorMes.map((r) => (
                  <tr key={r.mes}>
                    <td className="px-3 py-1.5">{r.mes}</td>
                    <td className="px-3 py-1.5 text-right">{r.viajes}</td>
                    <td className="px-3 py-1.5 text-right">{r.unidadesEntregadas ?? 0}</td>
                    <td className="px-3 py-1.5 text-right">{money(r.fleteTotal)}</td>
                    <td className="px-3 py-1.5 text-right">{money(r.ventasTotal)}</td>
                    <td className="px-3 py-1.5 text-right">{money(r.comisionTotal)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{money(r.fleteTotal + r.comisionTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-indigo-200 bg-indigo-50/80 font-bold text-slate-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-white">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{informe.totalViajesComision}</td>
                  <td className="px-3 py-2 text-right">{informe.totalUnidadesComision ?? 0}</td>
                  <td className="px-3 py-2 text-right">{money(informe.totalFlete)}</td>
                  <td className="px-3 py-2 text-right">{money(informe.resumenesPorMes.reduce((a, r) => a + (r.ventasTotal || 0), 0))}</td>
                  <td className="px-3 py-2 text-right">{money(informe.totalComision)}</td>
                  <td className="px-3 py-2 text-right">{money(informe.totalFlete + informe.totalComision)}</td>
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
                    {panel.clientes.map((c) => (
                      <tr key={c.cliente}>
                        <td className="px-3 py-1.5">{c.cliente}</td>
                        <td className="px-3 py-1.5 text-right">{c.stock}</td>
                        <td className="px-3 py-1.5 text-right">{c.vendido}</td>
                        <td className="px-3 py-1.5 text-right">
                          {c.pagado}
                          {c.pendiente > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">(+{c.pendiente} sin cobrar)</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold">{c.entregado}</td>
                      </tr>
                    ))}
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
                          <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">{money(v.comision)}</td>
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
        </>
      )}
    </div>
  );
}
