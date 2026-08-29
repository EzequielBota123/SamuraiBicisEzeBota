import { useEffect, useState, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { listSaleRequests, resolveSaleRequest, deleteSaleRequest, reviewComprobantePago, emitirFacturaVenta } from "../../services/comprobantes";
import { LoadingOverlay } from "../../components/ui/LoadingIndicators";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function TrashIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export default function SaleRequests() {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [reviewingId, setReviewingId] = useState(null);
  const [emittingGroup, setEmittingGroup] = useState(null);
  const [tab, setTab] = useState("pendiente");
  const [collapsed, setCollapsed] = useState({});
  const location = useLocation();
  const [distribuidorDestacado, setDistribuidorDestacado] = useState(null);
  const groupRefs = useRef({});

  function toggleGroup(name) {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  // Soporta llegar acá desde una notificación (?tab=pendiente|facturado&distribuidor=X):
  // abre directo en la pestaña que corresponde y hace scroll + resalta esa
  // fila puntual, en vez de dejar al staff buscando entre todo el listado.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    const distribuidorParam = params.get("distribuidor");
    if (tabParam === "pendiente" || tabParam === "facturado" || tabParam === "comprobantes") {
      setTab(tabParam);
    }
    if (distribuidorParam) {
      setDistribuidorDestacado(distribuidorParam);
      const t = setTimeout(() => {
        groupRefs.current[distribuidorParam]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
      const clear = setTimeout(() => setDistribuidorDestacado(null), 3000);
      return () => { clearTimeout(t); clearTimeout(clear); };
    }
  }, [location.search]);

  function load() {
    setLoading(true);
    setError("");
    listSaleRequests()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message || "No se pudo cargar"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const comprobantesPendientes = useMemo(
    () => (items || []).filter((it) => it.comprobantePagoEstado === "pendiente"),
    [items]
  );

  const filtered = useMemo(() => {
    if (tab === "comprobantes") return comprobantesPendientes;
    return (items || []).filter((it) => it.status === tab);
  }, [items, tab, comprobantesPendientes]);

  // Agrupa por distribuidor.
  const groups = useMemo(() => {
    const byDistributor = new Map();
    for (const it of filtered) {
      const key = it.distributorName || "Sin nombre";
      if (!byDistributor.has(key)) byDistributor.set(key, []);
      byDistributor.get(key).push(it);
    }
    return Array.from(byDistributor.entries()).map(([distributorName, list]) => {
      const subtotal = list.reduce((acc, it) => acc + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0);
      return { distributorName, depositoNombre: list[0]?.depositoNombre, items: list, subtotal };
    }).sort((a, b) => b.items.length - a.items.length);
  }, [filtered]);

  const totalPendiente = useMemo(() => {
    return (items || [])
      .filter((it) => it.status === "pendiente")
      .reduce((acc, it) => acc + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0);
  }, [items]);

  async function handleResolve(id) {
    if (!confirm("¿Marcar esta venta como facturada en Contabilium?")) return;
    setResolvingId(id);
    try {
      await resolveSaleRequest(id);
      load();
    } catch (e) {
      alert(e.message || "No se pudo actualizar");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleReview(id, aprobado) {
    if (!aprobado && !confirm("¿Rechazar este comprobante de pago?")) return;
    const nota = aprobado ? undefined : (prompt("Motivo del rechazo (opcional):") || "");
    setReviewingId(id);
    try {
      await reviewComprobantePago(id, aprobado, nota);
      load();
    } catch (e) {
      alert(e.message || "No se pudo actualizar");
    } finally {
      setReviewingId(null);
    }
  }

  async function handleEmitirFactura(group) {
    const detalle = group.items.map((it) => `• ${it.name} x${it.quantity} — ${money(Number(it.unitPrice || 0) * Number(it.quantity || 0))}`).join("\n");
    const ok = confirm(
      `Vas a EMITIR UNA FACTURA REAL en Contabilium (con CAE, irreversible) para ${group.distributorName}:\n\n${detalle}\n\nTotal: ${money(group.subtotal)}\n\n¿Confirmás?`
    );
    if (!ok) return;
    setEmittingGroup(group.distributorName);
    try {
      const result = await emitirFacturaVenta(group.items.map((it) => it.id));
      const numero = result?.comprobante?.Numero || result?.comprobante?.numero;
      alert(`Factura emitida${numero ? `: ${numero}` : ""}. Revisala en Contabilium para confirmar el CAE.`);
      load();
    } catch (e) {
      alert(e.message || "No se pudo emitir la factura");
    } finally {
      setEmittingGroup(null);
    }
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar esta venta reportada definitivamente? Esta acción no se puede deshacer.")) return;
    setDeletingId(id);
    try {
      await deleteSaleRequest(id);
      setItems((prev) => (prev || []).filter((it) => it.id !== id));
    } catch (e) {
      alert(e.message || "No se pudo eliminar");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteAll() {
    if (filtered.length === 0) return;
    if (!confirm(`¿Seguro que querés eliminar TODO (${filtered.length} ventas reportadas)? Esta acción no se puede deshacer.`))
      return;
    try {
      for (const it of filtered) {
        await deleteSaleRequest(it.id);
      }
      const ids = new Set(filtered.map((it) => it.id));
      setItems((prev) => (prev || []).filter((it) => !ids.has(it.id)));
    } catch (e) {
      alert(e.message || "No se pudieron eliminar todas");
    }
  }

  async function handleDeleteGroup(group) {
    if (!confirm(`¿Seguro que querés eliminar todo lo de ${group.distributorName} (${group.items.length} ítems)? Esta acción no se puede deshacer.`))
      return;
    try {
      for (const it of group.items) {
        await deleteSaleRequest(it.id);
      }
      const ids = new Set(group.items.map((it) => it.id));
      setItems((prev) => (prev || []).filter((it) => !ids.has(it.id)));
    } catch (e) {
      alert(e.message || "No se pudieron eliminar");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">Ventas reportadas</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Cuando un distribuidor marca una bici como vendida en "Mi stock", aparece acá. No toca Contabilium —
          cuando ustedes la facturen manualmente, márquenla como facturada.
        </p>
      </div>

      <div className="min-w-0 overflow-hidden rounded-3xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Pendiente de facturar</p>
        <p className="mt-1 truncate text-2xl font-black text-amber-700 dark:text-amber-400 sm:text-4xl" title={money(totalPendiente)}>
          {money(totalPendiente)}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("pendiente")}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              tab === "pendiente" ? "bg-slate-900 text-white dark:bg-white dark:text-neutral-900" : "border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            Pendientes
          </button>
          <button
            onClick={() => setTab("facturado")}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              tab === "facturado" ? "bg-slate-900 text-white dark:bg-white dark:text-neutral-900" : "border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            Facturadas
          </button>
          <button
            onClick={() => setTab("comprobantes")}
            className={`relative rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              tab === "comprobantes" ? "bg-slate-900 text-white dark:bg-white dark:text-neutral-900" : "border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            Comprobantes a revisar
            {comprobantesPendientes.length > 0 && (
              <span className="ml-2 rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
                {comprobantesPendientes.length}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={handleDeleteAll}
          disabled={filtered.length === 0}
          title="Eliminar todas las ventas reportadas visibles"
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Eliminar todo
        </button>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
        {loading && (
          <LoadingOverlay label="Cargando…" className="rounded-[inherit] border border-slate-200 bg-white text-slate-600" />
        )}
        {error && <div className="p-6 text-sm text-rose-600">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-neutral-400">
            {tab === "pendiente"
              ? "No hay ventas pendientes de facturar."
              : tab === "comprobantes"
              ? "No hay comprobantes de pago pendientes de revisar."
              : "Todavía no facturaron ninguna."}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="divide-y divide-slate-200 dark:divide-neutral-800">
            {groups.map((group) => {
              const isCollapsed = !!collapsed[group.distributorName];
              const destacado = distribuidorDestacado === group.distributorName;
              return (
              <div
                key={group.distributorName}
                ref={(el) => { groupRefs.current[group.distributorName] = el; }}
                className={destacado ? "ring-2 ring-sky-400 ring-inset transition" : ""}
              >
                <div className="flex w-full flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 dark:bg-neutral-800/60 sm:px-6">
                  <button
                    onClick={() => toggleGroup(group.distributorName)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    >
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{group.distributorName}</p>
                      {group.depositoNombre && (
                        <p className="truncate text-xs text-slate-400 dark:text-neutral-500">{group.depositoNombre}</p>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs text-slate-500 dark:text-neutral-400">
                      <p>{group.items.length} ítem{group.items.length === 1 ? "" : "s"}</p>
                      <p className="font-semibold text-slate-700 dark:text-neutral-300">{money(group.subtotal)}</p>
                    </div>
                    {tab === "pendiente" && (
                      <button
                        disabled={emittingGroup === group.distributorName}
                        onClick={() => handleEmitirFactura(group)}
                        title="Emite una factura real en Contabilium (con CAE) por todo lo pendiente de este distribuidor"
                        className="shrink-0 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
                      >
                        {emittingGroup === group.distributorName ? "Emitiendo…" : "🧾 Emitir factura"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      title={`Eliminar todo de ${group.distributorName}`}
                      className="shrink-0 rounded-2xl border border-rose-200 bg-white p-1.5 text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-neutral-900 dark:hover:bg-rose-500/10"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                <>
                {/* Mobile: tarjetas */}
                <ul className="divide-y divide-slate-100 dark:divide-neutral-800 md:hidden">
                  {group.items.map((it) => (
                    <li key={it.id} className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">{it.name}</p>
                          <p className="text-xs text-slate-400 dark:text-neutral-500">SKU: {it.sku}</p>
                          {it.tipoDocumentoEmitido && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                              ✓ {it.tipoDocumentoEmitido === "COT" ? "COT" : "Factura"} emitida automática
                            </span>
                          )}
                        </div>
                        <p className="shrink-0 text-right font-semibold text-slate-900 dark:text-white">
                          {money(Number(it.unitPrice || 0) * Number(it.quantity || 0))}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-neutral-400">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-neutral-800 dark:text-neutral-300">{it.quantity} u.</span>
                        <span>{formatDate(it.createdAt)}</span>
                      </div>
                      {it.comprobantePagoEstado === "pendiente" && (
                        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-2.5 dark:border-sky-500/30 dark:bg-sky-500/10">
                          <a
                            href={it.comprobantePagoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-sky-700 underline dark:text-sky-400"
                          >
                            Ver comprobante
                          </a>
                          <button
                            disabled={reviewingId === it.id}
                            onClick={() => handleReview(it.id, true)}
                            className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                          >
                            Aprobar
                          </button>
                          <button
                            disabled={reviewingId === it.id}
                            onClick={() => handleReview(it.id, false)}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                          >
                            Rechazar
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        {tab === "pendiente" && (
                          <button
                            disabled={resolvingId === it.id}
                            onClick={() => handleResolve(it.id)}
                            className="flex-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                          >
                            {resolvingId === it.id ? "Guardando…" : "Marcar facturado"}
                          </button>
                        )}
                        <button
                          disabled={deletingId === it.id}
                          onClick={() => handleDelete(it.id)}
                          title="Eliminar"
                          className="rounded-2xl border border-rose-200 bg-white px-3 py-2 text-xs text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-500/30 dark:bg-neutral-900 dark:hover:bg-rose-500/10"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Desktop: tabla */}
                <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full divide-y divide-slate-100 text-sm text-slate-600 dark:divide-neutral-800 dark:text-neutral-300">
                  <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                    {group.items.map((it) => (
                      <tr key={it.id}>
                        <td className="w-40 px-4 py-4 text-slate-500 dark:text-neutral-400 sm:px-6">{formatDate(it.createdAt)}</td>
                        <td className="px-4 py-4">
                          <p className="font-medium text-slate-900 dark:text-white">{it.name}</p>
                          <p className="text-xs text-slate-400 dark:text-neutral-500">SKU: {it.sku}</p>
                          {it.tipoDocumentoEmitido && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                              ✓ {it.tipoDocumentoEmitido === "COT" ? "COT" : "Factura"} emitida automática
                            </span>
                          )}
                          {it.comprobantePagoEstado === "pendiente" && (
                            <a
                              href={it.comprobantePagoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-xs font-semibold text-sky-600 underline dark:text-sky-400"
                            >
                              Ver comprobante de pago →
                            </a>
                          )}
                        </td>
                        <td className="w-20 px-4 py-4 text-right font-semibold text-slate-900 dark:text-white">{it.quantity}</td>
                        <td className="w-32 px-4 py-4 text-right font-semibold text-slate-900 dark:text-white">
                          {money(Number(it.unitPrice || 0) * Number(it.quantity || 0))}
                        </td>
                        <td className="w-52 px-4 py-4 text-right sm:pr-6">
                          <div className="flex items-center justify-end gap-2">
                            {it.comprobantePagoEstado === "pendiente" && (
                              <>
                                <button
                                  disabled={reviewingId === it.id}
                                  onClick={() => handleReview(it.id, true)}
                                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                                >
                                  Aprobar
                                </button>
                                <button
                                  disabled={reviewingId === it.id}
                                  onClick={() => handleReview(it.id, false)}
                                  className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                                >
                                  Rechazar
                                </button>
                              </>
                            )}
                            {tab === "pendiente" && (
                              <button
                                disabled={resolvingId === it.id}
                                onClick={() => handleResolve(it.id)}
                                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                              >
                                {resolvingId === it.id ? "Guardando…" : "Marcar facturado"}
                              </button>
                            )}
                            <button
                              disabled={deletingId === it.id}
                              onClick={() => handleDelete(it.id)}
                              title="Eliminar"
                              className="rounded-2xl border border-rose-200 bg-white p-1.5 text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-500/30 dark:bg-neutral-900 dark:hover:bg-rose-500/10"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                </>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
