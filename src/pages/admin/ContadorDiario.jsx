import { useEffect, useState } from "react";
import { getDailyBikeStats, triggerDailyBikeStatsSync } from "../../services/comprobantes";
import ResumenMensualPanel from "../../components/admin/ResumenMensualPanel";
import PrecioDolaresPanel from "../../components/admin/PrecioDolaresPanel";

function formatFecha(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function ContadorDiario() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  function load() {
    setError("");
    getDailyBikeStats(60)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message || "No se pudo cargar"));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      await triggerDailyBikeStatsSync();
      load();
    } catch (e) {
      setError(e.message || "No se pudo actualizar");
    } finally {
      setSyncing(false);
    }
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const totalEntregadas = (items || []).reduce((acc, it) => acc + Number(it.entregadoBicis || 0), 0);
  const totalReportadas = (items || []).reduce((acc, it) => acc + Number(it.reportadoBicis || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">Contador diario de bicis</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Facturadas, entregadas, reportadas, cobradas y consignadas — día por día. Se actualiza solo todas las mañanas a las 7am, pero
            también podés forzarlo cuando quieras.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {syncing ? "Actualizando…" : "🔄 Actualizar ahora"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <ResumenMensualPanel />

      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
        <strong>Cómo se cuenta:</strong> "Facturadas" son las bicis de las facturas emitidas ese día. "Entregadas" son
        las bicis de remitos reales a un cliente ese día (no cuenta mover stock entre depósitos propios, ej. mandarle
        a Cuchi). "Reportadas" son las que un distribuidor avisó desde la app que vendió ese día (tenga o no factura
        real todavía). "Cobradas" son las bicis de facturas que ese día terminaron de pagarse del todo. "Consignadas"
        es una foto del stock total en ese momento — solo hay dato desde el día que se activó este contador.
      </div>

      <PrecioDolaresPanel />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Entregadas (60 días)</p>
          <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">{totalEntregadas}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Reportadas (60 días)</p>
          <p className="mt-1 text-2xl font-bold text-sky-600 dark:text-sky-400">{totalReportadas}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
        {items === null && !error && (
          <p className="p-10 text-center text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>
        )}
        {items !== null && items.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-500 dark:text-neutral-400">
            Todavía no hay datos — tocá "Actualizar ahora" para calcularlos por primera vez.
          </p>
        )}
        {items !== null && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-neutral-800">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                  <th className="px-4 py-3 sm:px-6">Fecha</th>
                  <th className="px-4 py-3 text-right">Facturadas</th>
                  <th className="px-4 py-3 text-right">Entregadas</th>
                  <th className="px-4 py-3 text-right">Reportadas</th>
                  <th className="px-4 py-3 text-right">Cobradas</th>
                  <th className="px-4 py-3 text-right sm:pr-6">Consignadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {items.map((it) => (
                  <tr key={it.fecha} className={it.fecha === hoy ? "bg-sky-50 dark:bg-sky-500/10" : ""}>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white sm:px-6">
                      {formatFecha(it.fecha)}
                      {it.fecha === hoy && <span className="ml-2 text-xs font-normal text-sky-600 dark:text-sky-400">hoy</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-neutral-300">{it.facturadoBicis}</td>
                    <td className="px-4 py-3 text-right text-indigo-600 dark:text-indigo-400">{it.entregadoBicis ?? 0}</td>
                    <td className="px-4 py-3 text-right text-sky-600 dark:text-sky-400">{it.reportadoBicis ?? 0}</td>
                    <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">{it.cobradoBicis}</td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-neutral-300 sm:pr-6">
                      {it.consignadoBicis != null ? it.consignadoBicis : <span className="text-slate-300 dark:text-neutral-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
