// src/components/admin/ResumenComisionPanel.jsx
// Panel de cuenta corriente (flete + comisión) de un distribuidor con
// `vendedoresAsignados` — ej. Alfredo "Cuchi" Bavcevich — con el desglose
// bici por bici de lo que vendieron sus clientes ese mes. Autocontenido
// (pide sus propios datos) para poder colgarlo tanto en Vendedores como en
// la ficha del cliente en Clientes 360, sin duplicar la lógica.
import { useCallback, useEffect, useState } from "react";
import { getResumenComisionVendedor, setViajesVendedorMes, adminSetTarifasVendedor } from "../../services/comprobantes";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : `${s}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}

export default function ResumenComisionPanel({ vendedorUid, comisionPorcentajeInicial, tarifaFletePorViajeInicial, onTarifasGuardadas }) {
  const [mes, setMes] = useState(mesActual);
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [viajesInput, setViajesInput] = useState("");
  const [comisionInput, setComisionInput] = useState(comisionPorcentajeInicial != null ? String(comisionPorcentajeInicial) : "5");
  const [fleteInput, setFleteInput] = useState(tarifaFletePorViajeInicial != null ? String(tarifaFletePorViajeInicial) : "10000");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback((m) => {
    if (!vendedorUid) return;
    setCargando(true);
    setError("");
    getResumenComisionVendedor(m, vendedorUid)
      .then((r) => {
        setResumen(r);
        setViajesInput(String(r.viajes));
        setComisionInput(String(r.comisionPorcentaje));
        setFleteInput(String(r.tarifaFletePorViaje));
      })
      .catch((e) => setError(e.message || "No se pudo cargar el resumen"))
      .finally(() => setCargando(false));
  }, [vendedorUid]);

  useEffect(() => {
    cargar(mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, vendedorUid]);

  async function guardarViajes() {
    setGuardando(true);
    try {
      await setViajesVendedorMes(mes, Number(viajesInput) || 0, vendedorUid);
      cargar(mes);
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarTarifas() {
    setGuardando(true);
    try {
      await adminSetTarifasVendedor(vendedorUid, {
        comisionPorcentaje: Number(comisionInput),
        tarifaFletePorViaje: Number(fleteInput),
      });
      onTarifasGuardadas?.({ comisionPorcentaje: Number(comisionInput), tarifaFletePorViaje: Number(fleteInput) });
      cargar(mes);
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-sky-800 dark:text-sky-400">💰 Cuenta corriente (flete + comisión)</h2>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
        />
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-b border-sky-100 pb-3 dark:border-sky-900/40">
        <label className="text-xs text-sky-800 dark:text-sky-300">
          % comisión
          <input
            type="number"
            min="0"
            step="0.1"
            value={comisionInput}
            onChange={(e) => setComisionInput(e.target.value)}
            className="ml-1.5 w-16 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        <label className="text-xs text-sky-800 dark:text-sky-300">
          Flete por viaje ($)
          <input
            type="number"
            min="0"
            value={fleteInput}
            onChange={(e) => setFleteInput(e.target.value)}
            className="ml-1.5 w-24 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        <label className="text-xs text-sky-800 dark:text-sky-300">
          Viajes este mes
          <input
            type="number"
            min="0"
            value={viajesInput}
            onChange={(e) => setViajesInput(e.target.value)}
            className="ml-1.5 w-16 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        <button
          onClick={guardarTarifas}
          disabled={guardando}
          className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-60 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-400"
        >
          Guardar tarifas
        </button>
        <button
          onClick={guardarViajes}
          disabled={guardando}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
        >
          {guardando ? "Guardando…" : "Guardar viajes"}
        </button>
      </div>

      {cargando && <p className="mt-3 text-xs text-sky-700/70 dark:text-sky-400/60">Cargando resumen…</p>}

      {resumen && !cargando && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Flete ({resumen.viajes} viaje{resumen.viajes === 1 ? "" : "s"})</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.fleteTotal)}</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Ventas de sus clientes</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.ventasTotal)}</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Comisión ({resumen.comisionPorcentaje}%)</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.comisionTotal)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total a cobrar</p>
              <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{money(resumen.totalACobrar)}</p>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-bold text-sky-800 dark:text-sky-400">
              🚲 Bicis vendidas por sus clientes este mes ({resumen.comisionPorcentaje}% de comisión cada una)
            </p>
            {resumen.detalle.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-neutral-500">Sin ventas registradas este mes.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-sky-100 dark:border-sky-900/50">
                <table className="min-w-full divide-y divide-sky-100 text-xs dark:divide-sky-900/50">
                  <thead className="bg-sky-50/60 dark:bg-sky-950/20">
                    <tr className="text-left text-slate-500 dark:text-neutral-400">
                      <th className="px-3 py-2 font-semibold">Fecha</th>
                      <th className="px-3 py-2 font-semibold">Cliente</th>
                      <th className="px-3 py-2 font-semibold">Modelo</th>
                      <th className="px-3 py-2 font-semibold">Cant.</th>
                      <th className="px-3 py-2 font-semibold text-right">Monto</th>
                      <th className="px-3 py-2 font-semibold text-right">Comisión</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sky-50 bg-white dark:divide-sky-950/30 dark:bg-neutral-900">
                    {resumen.detalle.map((d, i) => (
                      <tr key={i} className={d.tipo === "NCA" ? "text-rose-600 dark:text-rose-400" : ""}>
                        <td className="whitespace-nowrap px-3 py-1.5">{formatFecha(d.fecha)}</td>
                        <td className="px-3 py-1.5">{d.cliente}</td>
                        <td className="px-3 py-1.5">
                          {d.modelo}
                          {d.tipo === "NCA" && <span className="ml-1 text-[10px] font-semibold">(N. Crédito)</span>}
                        </td>
                        <td className="px-3 py-1.5">{d.cantidad ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">{money(d.monto)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">{money(d.comision)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-sky-200 bg-sky-50/80 font-bold text-slate-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-white">
                      <td className="px-3 py-2" colSpan={4}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{money(resumen.ventasTotal)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{money(resumen.comisionTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
