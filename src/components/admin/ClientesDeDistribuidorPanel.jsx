import { useCallback, useEffect, useState } from "react";
import { getMisVendedores, getVendedorResumen } from "../../services/comprobantes";

const money = (n) =>
  n == null ? "—" : Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : `${s}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Lista de clientes de un distribuidor (stock consignado, deuda y últimas
// facturas de cada uno) — misma vista que el propio distribuidor ve en "Mis
// clientes" (src/pages/mistock/MisVendedoresPage.jsx), pero reutilizable
// para que el admin también la pueda ver desde el panel de Vendedores, para
// CUALQUIER distribuidor con equipo (pasando `distribuidorUid`; sin ese
// prop, pide la cartera del propio usuario logueado).
//
// Cada tarjeta pide su propio detalle por separado (en vez de un pedido
// gigante para todos juntos) — así una conexión que se corta a mitad de
// camino solo rompe esa tarjeta puntual, con un botón para reintentarla, en
// vez de tirar abajo toda la pantalla.
export default function ClientesDeDistribuidorPanel({ distribuidorUid }) {
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

  const recargarLista = useCallback(() => {
    setLista(null);
    setListaError("");
    setDetalles({});
    getMisVendedores(distribuidorUid)
      .then((r) => {
        setLista(r.vendedores);
        r.vendedores.forEach((v) => cargarDetalle(v.uid));
      })
      .catch((e) => setListaError(e.message || "No se pudo cargar"));
  }, [distribuidorUid, cargarDetalle]);

  useEffect(() => {
    recargarLista();
  }, [recargarLista]);

  return (
    <div>
      {lista === null && !listaError && <p className="text-sm text-slate-400">Cargando…</p>}
      {listaError && listaError.includes("No tenés vendedores asignados") ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Todavía no tiene clientes propios.</p>
      ) : (
        listaError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-400">
            {listaError}
          </div>
        )
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
