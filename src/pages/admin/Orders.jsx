import { useEffect, useMemo, useState } from "react";
import { FirebaseError } from "firebase/app";
import { listOrders, updateOrderStatus, linkOrderComprobante, deleteOrder } from "../../services/orders";
import { triggerOrderStatusSync, subscribeToOrderSyncStatus } from "../../services/contabilium";
import { useAuth } from "../../auth/AuthContext";
import { BusyButtonContent, LoadingOverlay } from "../../components/ui/LoadingIndicators";

const statusStyles = {
  pagada: "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  facturado: "border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-400",
  pendiente: "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  cancelada: "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
  solicitud: "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
};

function syncTimeAgo(date) {
  if (!date) return "nunca";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return date.toLocaleString("es-AR");
}

function money(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
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

export default function Orders() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [actionError, setActionError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncStatus, setSyncStatus] = useState(null);
  const [linkingId, setLinkingId] = useState(null);
  const [linkValue, setLinkValue] = useState("");
  const [detailOrder, setDetailOrder] = useState(null);
  const { loading: authLoading } = useAuth();

  useEffect(() => {
    return subscribeToOrderSyncStatus(setSyncStatus);
  }, []);

  async function fetchOrders(reset = true) {
    setLoading(true);
    try {
      const opts = {
        status,
        from: from ? new Date(from) : null,
        to: to ? new Date(to) : null,
        pageSize: 100,
        cursor: reset ? null : cursor,
      };
      const { items, nextCursor } = await listOrders(opts);
      setRows((prev) => (reset ? items : [...prev, ...items]));
      setCursor(nextCursor);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, from, to]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((o) => {
      const idText = String(o.id).toLowerCase().includes(query);
      const nameText = String(o.customerNameLower || o.customer?.name || "")
        .toLowerCase()
        .includes(query);
      const emailText = String(o.customer?.email || "").toLowerCase().includes(query);
      const phoneText = String(o.customer?.phone || "").toLowerCase().includes(query);
      const notesText = String(o.customer?.notes || "").toLowerCase().includes(query);
      return idText || nameText || emailText || phoneText || notesText;
    });
  }, [rows, q]);

  const total = useMemo(() => filtered.reduce((a, b) => a + Number(b.total || 0), 0), [filtered]);

  async function markPaid(id) {
    setActionError("");
    try {
      await updateOrderStatus(id, "pagada");
      setRows((prev) => prev.map((o) => (o.id === id ? { ...o, status: "pagada" } : o)));
    } catch (e) {
      console.error(e);
      if (e instanceof FirebaseError) {
        setActionError("Necesitás permisos de administrador");
      } else {
        setActionError("No se pudo actualizar la orden.");
      }
    }
  }
  async function cancel(id) {
    setActionError("");
    try {
      await updateOrderStatus(id, "cancelada");
      setRows((prev) => prev.map((o) => (o.id === id ? { ...o, status: "cancelada" } : o)));
    } catch (e) {
      console.error(e);
      if (e instanceof FirebaseError) {
        setActionError("Necesitás permisos de administrador");
      } else {
        setActionError("No se pudo actualizar la orden.");
      }
    }
  }
  async function reactivate(id) {
    setActionError("");
    try {
      await updateOrderStatus(id, "pendiente");
      setRows((prev) => prev.map((o) => (o.id === id ? { ...o, status: "pendiente" } : o)));
    } catch (e) {
      console.error(e);
      if (e instanceof FirebaseError) {
        setActionError("Necesitás permisos de administrador");
      } else {
        setActionError("No se pudo actualizar la orden.");
      }
    }
  }

  async function handleDelete(id) {
    if (!confirm(`¿Eliminar la orden #${id} definitivamente? Esta acción no se puede deshacer.`)) return;
    setActionError("");
    try {
      await deleteOrder(id);
      setRows((prev) => prev.filter((o) => o.id !== id));
    } catch (e) {
      console.error(e);
      setActionError("No se pudo eliminar la orden.");
    }
  }

  async function handleDeleteAll() {
    if (filtered.length === 0) return;
    if (!confirm(`¿Seguro que querés eliminar TODO (${filtered.length} órdenes)? Esta acción no se puede deshacer.`))
      return;
    setActionError("");
    try {
      for (const o of filtered) {
        await deleteOrder(o.id);
      }
      const ids = new Set(filtered.map((o) => o.id));
      setRows((prev) => prev.filter((o) => !ids.has(o.id)));
    } catch (e) {
      console.error(e);
      setActionError("No se pudieron eliminar todas las órdenes.");
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg("");
    setActionError("");
    try {
      const res = await triggerOrderStatusSync();
      setSyncMsg(`Sincronización completa: ${res.updated} actualizada(s) de ${res.checked} revisada(s).`);
      await fetchOrders(true);
    } catch (e) {
      console.error(e);
      setActionError("No se pudo sincronizar con Contabilium.");
    } finally {
      setSyncing(false);
    }
  }

  function startLink(o) {
    setLinkingId(o.id);
    setLinkValue(o.contabiliumComprobanteNumero || "");
    setActionError("");
  }

  async function saveLink(id) {
    setActionError("");
    try {
      await linkOrderComprobante(id, linkValue);
      setRows((prev) =>
        prev.map((o) => (o.id === id ? { ...o, contabiliumComprobanteNumero: linkValue.trim() || null } : o))
      );
      setLinkingId(null);
      setLinkValue("");
    } catch (e) {
      console.error(e);
      setActionError("No se pudo vincular el comprobante.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_45px_85px_-60px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="absolute -right-24 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-indigo-200/60 blur-3xl" />
        <div className="relative space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
            Gestión de órdenes
          </div>
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr] lg:items-center">
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Órdenes</h1>
              <p className="mt-3 text-sm text-slate-600 dark:text-neutral-400">
                Controlá el flujo de pedidos con filtros dinámicos y loaders visibles para cada sincronización.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              Total filtrado: <span className="font-semibold text-slate-900 dark:text-white">{money(total)}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_65px_-45px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="grid gap-4 md:grid-cols-5">
          <input
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500 md:col-span-2"
            placeholder="Buscar por #orden o cliente…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Todos los estados</option>
            <option value="pagada">Pagada</option>
            <option value="facturado">Facturado</option>
            <option value="pendiente">Pendiente</option>
            <option value="cancelada">Cancelada</option>
            <option value="solicitud">Solicitud</option>
          </select>
          <input
            type="date"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white [color-scheme:dark]"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            type="date"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white [color-scheme:dark]"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-neutral-400">
            Sincronización de estados:{" "}
            <span className="font-semibold text-slate-700 dark:text-neutral-300">{syncTimeAgo(syncStatus?.lastSync)}</span>
            {syncStatus?.errors?.length ? (
              <span className="ml-2 text-rose-500">({syncStatus.errors.length} error/es)</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-400"
              title="Coteja las órdenes pendientes/facturadas contra Contabilium"
            >
              <BusyButtonContent busy={syncing} busyLabel="Sincronizando…" label="Sincronizar con Contabilium" />
            </button>
            <button
              onClick={() => fetchOrders(false)}
              disabled={!cursor || loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
            >
              <BusyButtonContent busy={loading} busyLabel="Cargando…" label="Cargar más" />
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={filtered.length === 0}
              title="Eliminar todas las órdenes visibles"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Eliminar todo
            </button>
          </div>
        </div>
      </div>

      {syncMsg && (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
          {syncMsg}
        </div>
      )}

      {actionError && (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {actionError}
        </div>
      )}

      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_40px_80px_-60px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        {loading && (
          <LoadingOverlay
            label="Actualizando listado…"
            className="rounded-[inherit] border border-slate-200 bg-white/80 text-slate-600"
            labelClassName="text-slate-600"
          />
        )}
        {/* Mobile: tarjetas */}
        <ul className="divide-y divide-slate-100 dark:divide-neutral-800 md:hidden">
          {filtered.map((o) => (
            <li key={o.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-slate-400 dark:text-neutral-500">#{o.id}</p>
                  <p className="truncate font-semibold text-slate-900 dark:text-white">{o.customer?.name || "-"}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-neutral-400">{o.customer?.email || "-"}</p>
                  {o.customer?.phone && <p className="text-xs text-slate-500 dark:text-neutral-400">{o.customer.phone}</p>}
                </div>
                <span
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
                    statusStyles[o.status] || "border border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current/80" />
                  {o.status}
                </span>
              </div>

              {o.customer?.notes && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">{o.customer.notes}</p>
              )}

              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
                <span>{o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("es-AR") : "-"}</span>
                <span className="text-base font-semibold text-slate-900 dark:text-white">{money(o.total || 0)}</span>
              </div>

              <div className="text-xs">
                {linkingId === o.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={linkValue}
                      onChange={(e) => setLinkValue(e.target.value)}
                      placeholder="N° comprobante"
                      className="w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                    />
                    <button
                      onClick={() => saveLink(o.id)}
                      className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => { setLinkingId(null); setLinkValue(""); }}
                      className="shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                    >
                      ✕
                    </button>
                  </div>
                ) : o.contabiliumComprobanteNumero ? (
                  <button
                    onClick={() => startLink(o)}
                    className="font-mono text-xs text-indigo-700 underline-offset-2 hover:underline"
                    title="Editar comprobante vinculado"
                  >
                    Comprobante: {o.contabiliumComprobanteNumero}
                  </button>
                ) : (o.status === "pendiente" || o.status === "facturado") ? (
                  <button
                    onClick={() => startLink(o)}
                    className="text-xs text-slate-400 transition hover:text-sky-600 dark:text-neutral-500"
                  >
                    + Vincular comprobante
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setDetailOrder(o)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  Ver detalle
                </button>
                {o.status !== "pagada" && o.status !== "cancelada" && (
                  <button
                    onClick={() => markPaid(o.id)}
                    disabled={authLoading}
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                  >
                    Marcar pagada
                  </button>
                )}
                {o.status !== "cancelada" && (
                  <button
                    onClick={() => cancel(o.id)}
                    disabled={authLoading}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                  >
                    Cancelar
                  </button>
                )}
                {o.status === "cancelada" && (
                  <button
                    onClick={() => reactivate(o.id)}
                    disabled={authLoading}
                    className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400"
                  >
                    Reactivar
                  </button>
                )}
                <button
                  onClick={() => handleDelete(o.id)}
                  title="Eliminar orden"
                  className="rounded-2xl border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-neutral-800 dark:hover:bg-rose-500/10"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-12 text-center text-sm text-slate-500 dark:text-neutral-400">
              {loading ? "Cargando órdenes…" : "Sin resultados."}
            </li>
          )}
        </ul>

        {/* Desktop: tabla */}
        <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm text-slate-600 dark:divide-neutral-800 dark:text-neutral-300">
          <thead className="bg-slate-50 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="px-4 py-3 text-left"># Orden</th>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Comentario</th>
              <th className="px-4 py-3 text-left">Fecha</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Comprobante</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
            {filtered.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-4 font-mono text-xs text-slate-500 dark:text-neutral-400">#{o.id}</td>
                <td className="px-4 py-4">
                  <p className="font-medium text-slate-800 dark:text-white">{o.customer?.name || "-"}</p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">{o.customer?.email || "-"}</p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">{o.customer?.phone || "-"}</p>
                </td>
                <td className="px-4 py-4 max-w-[240px] break-words text-slate-500 dark:text-neutral-400">{o.customer?.notes || "-"}</td>
                <td className="px-4 py-4 text-slate-500 dark:text-neutral-400">
                  {o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("es-AR") : "-"}
                </td>
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
                      statusStyles[o.status] || "border border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-current/80" />
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-4">
                  {linkingId === o.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={linkValue}
                        onChange={(e) => setLinkValue(e.target.value)}
                        placeholder="N° comprobante"
                        className="w-32 rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                      />
                      <button
                        onClick={() => saveLink(o.id)}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => { setLinkingId(null); setLinkValue(""); }}
                        className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                      >
                        ✕
                      </button>
                    </div>
                  ) : o.contabiliumComprobanteNumero ? (
                    <button
                      onClick={() => startLink(o)}
                      className="font-mono text-xs text-indigo-700 underline-offset-2 hover:underline"
                      title="Editar comprobante vinculado"
                    >
                      {o.contabiliumComprobanteNumero}
                    </button>
                  ) : (o.status === "pendiente" || o.status === "facturado") ? (
                    <button
                      onClick={() => startLink(o)}
                      className="text-xs text-slate-400 transition hover:text-sky-600 dark:text-neutral-500"
                    >
                      + Vincular
                    </button>
                  ) : (
                    <span className="text-xs text-slate-300 dark:text-neutral-600">—</span>
                  )}
                </td>
                <td className="px-4 py-4 text-right font-semibold text-slate-900 dark:text-white">{money(o.total || 0)}</td>
                <td className="px-4 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setDetailOrder(o)}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    >
                      Ver detalle
                    </button>
                    <button
                      onClick={() => handleDelete(o.id)}
                      title="Eliminar orden"
                      className="rounded-2xl border border-rose-200 bg-white p-1.5 text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-neutral-800 dark:hover:bg-rose-500/10"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
                <tr>
                  <td className="px-4 py-12 text-center text-slate-500 dark:text-neutral-400" colSpan={8}>
                    {loading ? "Cargando órdenes…" : "Sin resultados."}
                  </td>
                </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <OrderDetailModal
        order={detailOrder}
        onClose={() => setDetailOrder(null)}
        onMarkPaid={markPaid}
        onCancel={cancel}
        onReactivate={reactivate}
        authLoading={authLoading}
      />
    </div>
  );
}

function buildOrderText(order) {
  const items = order.items || [];
  const lines = [
    `Pedido #${order.id}`,
    `Cliente: ${order.customer?.name || "-"}`,
    order.customer?.email ? `Email: ${order.customer.email}` : null,
    order.customer?.phone ? `Teléfono: ${order.customer.phone}` : null,
    order.customer?.notes ? `Comentario: ${order.customer.notes}` : null,
    `Fecha: ${order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString("es-AR") : "-"}`,
    "",
    "Ítems:",
    ...items.map(
      (it) => `• ${it.sku ? `[${it.sku}] ` : ""}${it.name} x${it.qty} — ${money(it.price)} c/u — ${money((it.price || 0) * (it.qty || 0))}`
    ),
    "",
    `Total: ${money(order.total || 0)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

const WHATSAPP_EMPRESA = "5491149166234";

function soloDigitos(s) {
  return String(s || "").replace(/\D/g, "");
}

// Mensaje listo para el cliente que hizo una "solicitud" desde el catálogo
// público sin tener cuenta de distribuidor — le pide que se registre antes
// de poder comprar.
function mensajeParaClienteSinCuenta(order) {
  const nombre = (order.customer?.name || "").split(" ")[0] || "";
  return [
    `Hola ${nombre}! Vimos tu pedido de ${order.items?.[0]?.name || "una bici"} en nuestro catálogo.`,
    "",
    "Para poder comprar necesitás una cuenta de distribuidor aprobada en nuestro sistema — es rápido, completá este formulario y te damos de alta: https://samurai.ar/quiero-ser-cliente",
    "",
    "Una vez aprobado, ya podés hacer el pedido directo desde tu cuenta. ¡Cualquier duda, contame!",
  ].join("\n");
}

function mensajeParaEmpresaSobreLead(order) {
  return [
    `Te paso un lead nuevo: ${order.customer?.name || "(sin nombre)"} (${order.customer?.email || "sin email"}, ${order.customer?.phone || "sin teléfono"}) pidió comprar "${order.items?.[0]?.name || "-"}" desde el catálogo público, pero no tiene cuenta de distribuidor.`,
    "Le mandé el link para que se registre en \"Quiero ser distribuidor\" — seguilo para cerrar la venta una vez que complete el alta.",
  ].join("\n");
}

function OrderDetailModal({ order, onClose, onMarkPaid, onCancel, onReactivate, authLoading }) {
  const [copied, setCopied] = useState(false);
  if (!order) return null;
  const items = order.items || [];
  const esSolicitudSinCuenta = order.status === "solicitud" && !order.customer?.uid;

  function handleCopy() {
    navigator.clipboard.writeText(buildOrderText(order));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 dark:bg-black/60">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Pedido #{order.id}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-white"
            >
              {copied ? "✅ Copiado" : "📋 Copiar pedido"}
            </button>
            <button onClick={onClose} className="rounded-2xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
              Cerrar
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-1 text-sm">
          <p><span className="text-slate-500 dark:text-neutral-400">Cliente:</span> {order.customer?.name || "-"}</p>
          {order.customer?.email && <p><span className="text-slate-500 dark:text-neutral-400">Email:</span> {order.customer.email}</p>}
          {order.customer?.phone && <p><span className="text-slate-500 dark:text-neutral-400">Teléfono:</span> {order.customer.phone}</p>}
          {order.customer?.notes && <p><span className="text-slate-500 dark:text-neutral-400">Comentario:</span> {order.customer.notes}</p>}
          <p>
            <span className="text-slate-500 dark:text-neutral-400">Fecha:</span>{" "}
            {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString("es-AR") : "-"}
          </p>
          <p>
            <span className="text-slate-500 dark:text-neutral-400">Estado:</span>{" "}
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-0.5 text-xs ${statusStyles[order.status] || "border border-slate-200 bg-slate-50 text-slate-600"}`}>
              {order.status}
            </span>
          </p>
          {order.contabiliumComprobanteNumero && (
            <p><span className="text-slate-500 dark:text-neutral-400">Comprobante:</span> {order.contabiliumComprobanteNumero}</p>
          )}
        </div>

        {esSolicitudSinCuenta && (
          <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/20">
            <p className="w-full text-xs text-sky-800 dark:text-sky-400">
              Pidió comprar sin tener cuenta de distribuidor — avisale a él y a Contacto Empresa por WhatsApp:
            </p>
            {order.customer?.phone && (
              <a
                href={`https://wa.me/54${soloDigitos(order.customer.phone)}?text=${encodeURIComponent(mensajeParaClienteSinCuenta(order))}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                💬 Escribirle a {order.customer.name || "cliente"}
              </a>
            )}
            <a
              href={`https://wa.me/${WHATSAPP_EMPRESA}?text=${encodeURIComponent(mensajeParaEmpresaSobreLead(order))}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-neutral-900"
            >
              💬 Avisar a Contacto Empresa
            </a>
          </div>
        )}

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Items pedidos</p>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 dark:divide-neutral-800 dark:border-neutral-800">
            {items.map((it, idx) => (
              <li key={idx} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="break-words font-medium text-slate-800 dark:text-white">{it.name}</p>
                  {it.sku && <p className="font-mono text-xs text-slate-400 dark:text-neutral-500">SKU: {it.sku}</p>}
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    {it.qty} x {money(it.price)} c/u
                  </p>
                </div>
                <p className="shrink-0 font-semibold text-slate-900 dark:text-white">{money((it.price || 0) * (it.qty || 0))}</p>
              </li>
            ))}
            {items.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400 dark:text-neutral-500">Sin items registrados.</li>
            )}
          </ul>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 dark:bg-neutral-800">
          <span className="text-sm font-semibold text-slate-600 dark:text-neutral-300">Total</span>
          <span className="text-lg font-bold text-slate-900 dark:text-white">{money(order.total || 0)}</span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {order.status !== "pagada" && order.status !== "cancelada" && (
            <button
              onClick={() => { onMarkPaid(order.id); onClose(); }}
              disabled={authLoading}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
            >
              Marcar pagada
            </button>
          )}
          {order.status !== "cancelada" && (
            <button
              onClick={() => { onCancel(order.id); onClose(); }}
              disabled={authLoading}
              className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
            >
              Cancelar
            </button>
          )}
          {order.status === "cancelada" && (
            <button
              onClick={() => { onReactivate(order.id); onClose(); }}
              disabled={authLoading}
              className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400"
            >
              Reactivar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
