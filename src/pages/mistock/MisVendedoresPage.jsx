import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../../auth/AuthContext";
import { getMisVendedores, getVendedorResumen, getResumenComisionVendedor, setViajesVendedorMes } from "../../services/comprobantes";

const money = (n) =>
  n == null ? "—" : Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : `${s}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}

// Cuenta corriente mensual del propio distribuidor: flete (monto fijo por
// viaje de Lavalle a su depósito, cargado a mano porque Contabilium no lo
// registra) + comisión (% sobre lo que facturan sus clientes asignados ese
// mes, calculado solo desde Contabilium).
function ResumenComision() {
  const [mes, setMes] = useState(mesActual);
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [viajesInput, setViajesInput] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback((m) => {
    setCargando(true);
    setError("");
    getResumenComisionVendedor(m)
      .then((r) => {
        setResumen(r);
        setViajesInput(String(r.viajes));
      })
      .catch((e) => setError(e.message || "No se pudo cargar el resumen"))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    cargar(mes);
  }, [mes, cargar]);

  async function guardarViajes() {
    setGuardando(true);
    try {
      await setViajesVendedorMes(mes, Number(viajesInput) || 0);
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
        <h2 className="text-sm font-bold text-sky-800 dark:text-sky-400">💰 Resumen del mes (flete + comisión)</h2>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
        />
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {cargando && <p className="mt-2 text-xs text-sky-700/70 dark:text-sky-400/60">Cargando…</p>}

      {resumen && !cargando && (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-sky-800 dark:text-sky-300">
              Viajes este mes (Lavalle → tu depósito)
              <input
                type="number"
                min="0"
                value={viajesInput}
                onChange={(e) => setViajesInput(e.target.value)}
                className="ml-1.5 w-20 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
            <button
              onClick={guardarViajes}
              disabled={guardando}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Flete ({resumen.viajes} viaje{resumen.viajes === 1 ? "" : "s"} × {money(resumen.tarifaFletePorViaje)})</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.fleteTotal)}</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Ventas de tus clientes</p>
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
              🚲 Bicis vendidas por tus clientes este mes ({resumen.comisionPorcentaje}% de comisión cada una)
            </p>
            {resumen.detalle.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-neutral-500">Todavía no hay ventas registradas este mes.</p>
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

// Vista para clientes que coordinan un grupo de distribuidores propios (por
// ahora, Alfredo Bavcevich) — resumen de stock consignado, deuda y últimas
// facturas de cada uno. Solo se muestra si el usuario tiene
// `vendedoresAsignados` cargado en su perfil.
//
// Cada tarjeta pide su propio detalle por separado (en vez de un pedido
// gigante para todos juntos) — así una conexión que se corta a mitad de
// camino solo rompe esa tarjeta puntual, con un botón para reintentarla,
// en vez de tirar abajo toda la pantalla.
export default function MisVendedoresPage() {
  const { profile } = useAuth();
  const [lista, setLista] = useState(null);
  const [listaError, setListaError] = useState("");
  const [detalles, setDetalles] = useState({}); // uid -> { loading, error, data }
  const [abierto, setAbierto] = useState(null);

  const cargarDetalle = useCallback((uid) => {
    setDetalles((prev) => ({ ...prev, [uid]: { loading: true, error: "", data: prev[uid]?.data || null } }));
    getVendedorResumen(uid)
      .then((data) => setDetalles((prev) => ({ ...prev, [uid]: { loading: false, error: "", data } })))
      .catch((e) =>
        setDetalles((prev) => ({
          ...prev,
          [uid]: { loading: false, error: e.message || "Se cortó la conexión", data: prev[uid]?.data || null },
        }))
      );
  }, []);

  useEffect(() => {
    setListaError("");
    getMisVendedores()
      .then((r) => {
        setLista(r.vendedores);
        r.vendedores.forEach((v) => cargarDetalle(v.uid));
      })
      .catch((e) => setListaError(e.message || "No se pudo cargar"));
  }, [cargarDetalle]);

  if (!profile?.vendedoresAsignados?.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-slate-500">No tenés vendedores asignados.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Mis clientes</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Stock consignado, deuda y últimas facturas de cada uno.
        </p>
      </div>

      <ResumenComision />

      {lista === null && !listaError && <p className="text-sm text-slate-400">Cargando…</p>}
      {listaError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-400">
          {listaError}
        </div>
      )}

      {lista && (
        <div className="space-y-2">
          {lista.map((v) => {
            const det = detalles[v.uid] || { loading: true, error: "", data: null };
            const d = det.data;
            const isOpen = abierto === v.uid;
            return (
              <div key={v.uid} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <button
                  onClick={() => setAbierto(isOpen ? null : v.uid)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-neutral-800/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {isOpen ? "▾" : "▸"} {v.name || v.depositoNombre || "(sin nombre)"}
                    </p>
                    {det.loading && <p className="text-xs text-slate-400 dark:text-neutral-500">Cargando…</p>}
                  </div>
                  {d && !det.error && (
                    <div className="flex shrink-0 items-center gap-4 text-right">
                      <div>
                        <p className="text-[11px] text-slate-400 dark:text-neutral-500">Stock</p>
                        <p className="text-sm font-semibold text-slate-700 dark:text-neutral-300">
                          {d.stockBicis == null ? "—" : d.stockBicis}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-400 dark:text-neutral-500">Debe</p>
                        <p className={`text-sm font-bold ${Number(d.saldoTotal) > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {money(d.saldoTotal)}
                        </p>
                      </div>
                    </div>
                  )}
                </button>

                {det.error && (
                  <div className="flex items-center justify-between gap-2 border-t border-rose-100 bg-rose-50 px-4 py-2 dark:border-rose-900/40 dark:bg-rose-950/20">
                    <p className="text-xs text-rose-600 dark:text-rose-400">
                      ⚠️ Se cortó la conexión al traer este cliente. {det.error}
                    </p>
                    <button
                      onClick={() => cargarDetalle(v.uid)}
                      className="shrink-0 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
                    >
                      Reintentar
                    </button>
                  </div>
                )}

                {isOpen && d && (
                  <div className="border-t border-slate-100 px-4 py-3 dark:border-neutral-800">
                    <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">Bicicletas consignadas</p>
                    {d.bicis.length === 0 ? (
                      <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">Sin stock.</p>
                    ) : (
                      <div className="mb-3 space-y-1">
                        {d.bicis.map((b, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-slate-700 dark:text-neutral-300">{b.name}</span>
                            <span className="shrink-0 font-semibold text-slate-900 dark:text-white">× {b.stockActual}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">Últimas facturas</p>
                    {d.facturasRecientes.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-neutral-500">Sin facturas.</p>
                    ) : (
                      <div className="space-y-1">
                        {d.facturasRecientes.map((f, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-slate-600 dark:text-neutral-300">
                              {f.numero} · {formatFecha(f.fecha)}
                            </span>
                            <span className="text-slate-700 dark:text-neutral-300">
                              {money(f.total)}{" "}
                              <span className={Number(f.saldo) > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}>
                                ({money(f.saldo)})
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
