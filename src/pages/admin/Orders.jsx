import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { FirebaseError } from "firebase/app";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { listOrders, updateOrderStatus, linkOrderComprobante, deleteOrder } from "../../services/orders";
import { triggerOrderStatusSync, subscribeToOrderSyncStatus } from "../../services/contabilium";
import { transferirStockManual, generarRemitoRealManual, descargarRemitoPorArchivo, getDepositoStockAdmin } from "../../services/comprobantes";
import { crearViaje } from "../../services/logisticaViajes";
import { useAuth } from "../../auth/AuthContext";
import { BusyButtonContent, LoadingOverlay } from "../../components/ui/LoadingIndicators";

// Baja un PDF ya en base64 (sin pedirlo de nuevo al servidor) con el nombre
// de archivo que se le pase.
function descargarPdfBase64(base64, nombreArchivo) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

// Los 3 depósitos propios — mismos ids que usa "Pedidos a confirmar" y el
// resto del sistema de logística para reconocerlos en Contabilium. La
// dirección es la misma que usa la grilla de logística (DEPOSITOS_PROPIOS
// en logisticaViajes.ts) para armar el viaje con algo más que el nombre.
const DEPOSITOS_PROPIOS_ORDERS = [
  { id: 135151, nombre: "Lavalle", direccion: "Lavalle 105, B1834 Temperley, Provincia de Buenos Aires" },
  { id: 133531, nombre: "Cañuelas", direccion: "Highway Route 6 Km 96.7, Cañuelas, Provincia de Buenos Aires" },
  { id: 131151, nombre: "Credifin", direccion: "" },
];

const statusStyles = {
  pagada: "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  facturado: "border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-400",
  pendiente: "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  cancelada: "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
  solicitud: "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
  // Un pedido con envío confirmado es una consignación — mandamos la bici
  // al depósito propio del cliente, pero no cobramos en el momento, así que
  // "pagada"/"facturado" (que vienen de cotejar contra una factura real)
  // serían engañosos acá. Mientras haya un envío en curso, el badge
  // muestra este estado en vez del de la factura.
  hecho: "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  en_revision: "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
};

// El pedido tiene su propio ciclo de vida de pago (pendiente → facturado →
// pagada, sincronizado contra una factura real) pero una vez que hay un
// envío confirmado eso deja de ser lo relevante para mostrar en la lista:
// lo que importa ahí es si el envío (stock + remito real) quedó bien o
// necesita revisión a mano — el cobro es aparte, como con cualquier
// distribuidor en cuenta corriente.
function displayStatus(order) {
  const resultados = order.envio?.resultados;
  if (resultados && resultados.length > 0) {
    const todosReal = resultados.every((r) => r.remitoEsReal);
    return todosReal ? { key: "hecho", label: "hecho" } : { key: "en_revision", label: "en revisión" };
  }
  return { key: order.status, label: order.status };
}

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
  const location = useLocation();

  useEffect(() => {
    return subscribeToOrderSyncStatus(setSyncStatus);
  }, []);

  // Si llegamos acá desde una notificación de pedido nuevo (?orderId=X), le
  // abrimos directo el detalle en vez de dejarlo perdido en la lista.
  useEffect(() => {
    if (!rows.length) return;
    const params = new URLSearchParams(location.search);
    const orderIdParam = params.get("orderId");
    if (!orderIdParam) return;
    const match = rows.find((o) => String(o.id) === orderIdParam);
    if (match) setDetailOrder(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, location.search]);

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
  async function markDone(id) {
    setActionError("");
    try {
      await updateOrderStatus(id, "hecho");
      setRows((prev) => prev.map((o) => (o.id === id ? { ...o, status: "hecho" } : o)));
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
                    statusStyles[displayStatus(o).key] || "border border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current/80" />
                  {displayStatus(o).label}
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
                      statusStyles[displayStatus(o).key] || "border border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-current/80" />
                    {displayStatus(o).label}
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
        onMarkDone={markDone}
        onCancel={cancel}
        onReactivate={reactivate}
        onEnvioConfirmado={(orderId, envio) => {
          setRows((prev) => prev.map((o) => (o.id === orderId ? { ...o, envio } : o)));
          setDetailOrder((prev) => (prev && prev.id === orderId ? { ...prev, envio } : prev));
        }}
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

// Saca marca/modelo/talle en limpio del nombre completo del producto (ej:
// "BIC MTB SAMURAI GOZEN R29 TALLE S ROSA - SHIMANO" → "GOZEN S ROSA") —
// nada de SKU ni precio, es lo único que el chofer necesita para armar el
// pedido físico.
function nombreParaChofer(nombreCompleto) {
  if (!nombreCompleto) return "";
  return nombreCompleto
    .replace(/\bBIC\b/gi, "")
    .replace(/\bMTB\b/gi, "")
    .replace(/\bSAMURAI\b/gi, "")
    .replace(/\bSHIMANO\b/gi, "")
    .replace(/\b21\s?V\b/gi, "")
    .replace(/\bR2[49]\b/gi, "")
    .replace(/\bTALLE\b/gi, "")
    .replace(/\bT\.\s*/gi, "")
    .replace(/-\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Versión simplificada para pasarle al chofer: a quién, cuántas de cada
// bici (sin precio, sin SKU, sin nada que no haga falta para preparar el
// pedido) y el total.
function buildOrderTextChofer(order) {
  const items = order.items || [];
  const totalBicis = items.reduce((a, b) => a + Number(b.qty || 0), 0);
  const lines = [
    order.customer?.name || "-",
    "",
    ...items.map((it) => `${it.qty} ${nombreParaChofer(it.name)}`),
    "",
    `Total: ${totalBicis}`,
  ];
  return lines.join("\n");
}

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

// Una fila de un depósito ya confirmado: pide el PDF de nuevo (no se
// guarda el base64 en Firestore, pesa demasiado) y avisa fuerte si el
// remito quedó a nombre de FEPA TOP en vez del cliente real.
function RemitoResultadoRow({ r }) {
  const [descargando, setDescargando] = useState(null); // "real" | "interno" | null

  async function descargar(tipo) {
    const archivo = tipo === "real" ? r.remitoRealArchivo : r.remitoInternoArchivo;
    if (!archivo) return;
    setDescargando(tipo);
    try {
      const { remitoPdfBase64 } = await descargarRemitoPorArchivo(archivo);
      descargarPdfBase64(remitoPdfBase64, `remito-${r.remitoNumero || r.depositoOrigenNombre}-${tipo}.pdf`);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setDescargando(null);
    }
  }

  return (
    <li className="rounded-lg bg-white p-2 dark:bg-neutral-900">
      <p>
        Desde {r.depositoOrigenNombre}: remito {r.remitoNumero || "(sin número)"}
      </p>
      {!r.remitoEsReal && (
        <p className="mt-1 font-semibold text-rose-600 dark:text-rose-400">
          ⚠️ No se pudo reasignar a nombre del cliente — este remito quedó a nombre de FEPA TOP. Hay que reasignarlo a mano en Contabilium (Remitos → buscar {r.remitoNumero}).
        </p>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        {r.remitoRealArchivo && (
          <button
            onClick={() => descargar("real")}
            disabled={descargando !== null}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
          >
            {descargando === "real" ? "Descargando…" : "📄 Descargar remito (cliente)"}
          </button>
        )}
        {r.remitoInternoArchivo && (
          <button
            onClick={() => descargar("interno")}
            disabled={descargando !== null}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {descargando === "interno" ? "Descargando…" : "📄 Descargar remito interno (FEPA TOP)"}
          </button>
        )}
      </div>
    </li>
  );
}

function OrderDetailModal({ order, onClose, onMarkPaid, onMarkDone, onCancel, onReactivate, onEnvioConfirmado, authLoading }) {
  const [copied, setCopied] = useState(false);
  const [copiedChofer, setCopiedChofer] = useState(false);
  if (!order) return null;
  const items = order.items || [];
  const esSolicitudSinCuenta = order.status === "solicitud" && !order.customer?.uid;
  const puedeConfirmarEnvio = order.customer?.uid && order.status !== "cancelada" && !order.envio?.confirmadoAt;

  function handleCopy() {
    navigator.clipboard.writeText(buildOrderText(order));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleCopyChofer() {
    navigator.clipboard.writeText(buildOrderTextChofer(order));
    setCopiedChofer(true);
    setTimeout(() => setCopiedChofer(false), 1800);
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
            <button
              onClick={handleCopyChofer}
              title="Texto simple sin precios ni SKU, listo para pasarle al chofer"
              className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-white"
            >
              {copiedChofer ? "✅ Copiado" : "🚚 Copiar para chofer"}
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
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-0.5 text-xs ${statusStyles[displayStatus(order).key] || "border border-slate-200 bg-slate-50 text-slate-600"}`}>
              {displayStatus(order).label}
            </span>
            {order.envio?.resultados?.length > 0 && (
              <span className="ml-1 text-[11px] text-slate-400 dark:text-neutral-500">(factura/cobro real: {order.status})</span>
            )}
          </p>
          {order.contabiliumComprobanteNumero && (
            <p><span className="text-slate-500 dark:text-neutral-400">Comprobante:</span> {order.contabiliumComprobanteNumero}</p>
          )}
        </div>

        {esSolicitudSinCuenta && (
          <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/20">
            <p className="w-full text-xs text-sky-800 dark:text-sky-400">
              Pidió comprar sin tener cuenta de distribuidor — avisale por WhatsApp:
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

        {order.envio?.confirmadoAt && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            <p className="font-semibold">✅ Envío confirmado — stock movido</p>
            <ul className="mt-2 space-y-2">
              {(order.envio.resultados || []).map((r, i) => (
                <RemitoResultadoRow key={i} r={r} />
              ))}
            </ul>
            <a href="/admin/chofer/grilla" className="mt-2 inline-block underline">
              ver viaje(s) en la grilla →
            </a>
          </div>
        )}

        {puedeConfirmarEnvio && <ConfirmarEnvioPanel order={order} onEnvioConfirmado={onEnvioConfirmado} />}

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
          {order.status !== "hecho" && (
            <button
              onClick={() => { onMarkDone(order.id); onClose(); }}
              disabled={authLoading}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
            >
              Marcar hecho
            </button>
          )}
          {order.status !== "pendiente" && (
            <button
              onClick={() => { onReactivate(order.id); onClose(); }}
              disabled={authLoading}
              className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400"
            >
              Marcar pendiente
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
        </div>
      </div>
    </div>
  );
}

// El admin elige UN depósito para todo el pedido (lo normal: todo sale del
// mismo lugar) — solo si algún ítem puntual no tiene stock ahí aparece la
// opción de mandar ESE ítem desde otro depósito (ahí sí, un movimiento +
// remito aparte para ese grupo). Cada grupo se procesa en DOS pasos
// separados, igual que "Mover stock" en Stock consignado: primero el
// movimiento real (que ya genera el remito interno, a nombre de FEPA TOP,
// y el viaje en la grilla), y recién después, como acción aparte y
// reintentable, "Generar remito real" — que le dice claramente si logró
// tomar al cliente real o no.
function ConfirmarEnvioPanel({ order, onEnvioConfirmado }) {
  const { user, profile } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [stockPorDeposito, setStockPorDeposito] = useState({});
  const [stockCargando, setStockCargando] = useState({});
  const [depositoGlobal, setDepositoGlobal] = useState("");
  const [excepciones, setExcepciones] = useState({}); // { itemId: depositoId } — solo para ítems sin stock en el global
  const [sustituciones, setSustituciones] = useState({}); // { itemId: { sku, name } } — reemplazo de bici cuando no hay stock del modelo pedido
  const [buscadorAbierto, setBuscadorAbierto] = useState(null); // itemId con el buscador de sustituto abierto
  const [filtroSustituto, setFiltroSustituto] = useState("");
  const [error, setError] = useState("");
  const [cliente, setCliente] = useState(null); // { contabiliumId, contabiliumDepositoId, name, phone }
  const [clienteError, setClienteError] = useState("");

  // grupos: null hasta que se confirman los depósitos; después, un array
  // [{ depId, depInfo, items }] fijo — ya no cambia aunque se reintente un
  // paso puntual.
  const [grupos, setGrupos] = useState(null);
  // pasos: { [depId]: { moviendo, movido: {idTransferencia, remitoArchivo, remitoNumero, remitoPdfBase64}|null, viajeId, generandoReal, remitoReal: {remitoArchivo, remitoPdfBase64, numero}|null, errorMover, errorReal } }
  const [pasos, setPasos] = useState({});

  const items = order.items || [];

  useEffect(() => {
    if (!abierto) return;
    DEPOSITOS_PROPIOS_ORDERS.forEach((d) => {
      if (stockPorDeposito[d.id] || stockCargando[d.id]) return;
      setStockCargando((s) => ({ ...s, [d.id]: true }));
      getDepositoStockAdmin(d.id)
        .then((r) => setStockPorDeposito((s) => ({ ...s, [d.id]: r.items || [] })))
        .catch(() => setStockPorDeposito((s) => ({ ...s, [d.id]: [] })))
        .finally(() => setStockCargando((s) => ({ ...s, [d.id]: false })));
    });
    if (!cliente && !clienteError && order.customer?.uid) {
      getDoc(doc(db, "users", order.customer.uid))
        .then((snap) => {
          const u = snap.exists() ? snap.data() : null;
          if (!u?.contabiliumId || !u?.contabiliumDepositoId) {
            setClienteError("El cliente de este pedido no tiene depósito propio vinculado en Contabilium — no se puede generar el remito real.");
            return;
          }
          setCliente({ contabiliumId: u.contabiliumId, contabiliumDepositoId: u.contabiliumDepositoId, name: u.name || order.customer.name, phone: u.phone || order.customer.phone || null });
        })
        .catch((e) => setClienteError(e.message || String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  function stockDe(depId, sku) {
    return (stockPorDeposito[depId] || []).find((p) => p.sku === sku)?.stockDisponible ?? null;
  }

  // Si el ítem fue reemplazado por otra bici (sustituciones), de acá en
  // adelante se trata como si el pedido fuera por esa bici — mismo qty/id,
  // sku/nombre del sustituto.
  function itemEfectivo(it) {
    const sus = sustituciones[it.id];
    return sus ? { ...it, sku: sus.sku, name: sus.name } : it;
  }

  const depGlobalId = depositoGlobal ? Number(depositoGlobal) : null;
  // Para la validación/grupos: usa el sku ya sustituido, si lo hay.
  const itemsConFaltante = depGlobalId
    ? items.filter((it) => {
        const itEf = itemEfectivo(it);
        const s = stockDe(depGlobalId, itEf.sku);
        return s != null && it.qty > s;
      })
    : [];
  // Para mostrar el bloque de "sin stock / reemplazar": además de los que
  // siguen sin alcanzar, incluye los que ya tienen un reemplazo elegido
  // (aunque el sustituto sí alcance) para no perder el botón de deshacer.
  const itemsParaBloque = depGlobalId
    ? items.filter((it) => {
        const s = stockDe(depGlobalId, it.sku);
        return (s != null && it.qty > s) || sustituciones[it.id];
      })
    : [];
  const catalogoDeposito = stockPorDeposito[depGlobalId] || [];

  function confirmarDepositos() {
    if (!depGlobalId) {
      setError("Elegí de qué depósito sale el pedido.");
      return;
    }
    if (!cliente) {
      setError(clienteError || "Esperando los datos del cliente…");
      return;
    }
    setError("");
    const mapa = new Map();
    for (const it of items) {
      const itEf = itemEfectivo(it);
      const depId = Number(excepciones[it.id] || depGlobalId);
      if (!mapa.has(depId)) mapa.set(depId, []);
      mapa.get(depId).push(itEf);
    }
    const nuevosGrupos = Array.from(mapa.entries()).map(([depId, itemsGrupo]) => ({
      depId,
      depInfo: DEPOSITOS_PROPIOS_ORDERS.find((d) => d.id === depId),
      items: itemsGrupo,
    }));
    setGrupos(nuevosGrupos);
    setPasos(Object.fromEntries(nuevosGrupos.map((g) => [g.depId, {}])));
  }

  // Guarda en el pedido el estado actual de todos los grupos — se llama
  // después de cada paso (mover o remito real) para no perder nada si se
  // cierra el modal a mitad de camino.
  function persistir(pasosActuales) {
    const resultados = (grupos || []).map((g) => {
      const p = pasosActuales[g.depId] || {};
      return {
        depositoOrigenId: g.depId,
        depositoOrigenNombre: g.depInfo?.nombre,
        idTransferencia: p.movido?.idTransferencia ?? null,
        remitoNumero: p.remitoReal?.numero || p.movido?.remitoNumero || null,
        remitoInternoArchivo: p.movido?.remitoArchivo || null,
        remitoRealArchivo: p.remitoReal?.remitoArchivo || null,
        remitoEsReal: !!p.remitoReal?.remitoPdfBase64,
        viajeId: p.viajeId || null,
      };
    });
    updateDoc(doc(db, "orders", order.id), {
      envio: { confirmadoAt: serverTimestamp(), confirmadoPorUid: user?.uid || null, resultados },
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    onEnvioConfirmado?.(order.id, { confirmadoAt: new Date(), resultados });
  }

  async function moverStock(g) {
    setPasos((prev) => ({ ...prev, [g.depId]: { ...prev[g.depId], moviendo: true, errorMover: null } }));
    try {
      const observaciones = `Pedido web #${order.id} — ${cliente.name}`;
      const r = await transferirStockManual({
        depositoOrigenId: g.depId,
        depositoDestinoId: Number(cliente.contabiliumDepositoId),
        items: g.items.map((it) => ({ sku: it.sku, cantidad: it.qty, name: it.name })),
        observaciones,
        depositoOrigenNombre: g.depInfo?.nombre,
        depositoDestinoNombre: cliente.name,
      });
      const numeroMatch = r.remitoArchivo && /(\d{4}-\d{8})/.exec(r.remitoArchivo);
      let viajeId = null;
      try {
        const resumenItems = g.items.map((it) => `${it.qty}x ${it.name} (SKU ${it.sku})`).join(", ");
        viajeId = await crearViaje(
          {
            fecha: null,
            turno: "mañana",
            origen: { tipo: "deposito", id: String(g.depId), nombre: g.depInfo?.nombre || "", direccion: g.depInfo?.direccion || "", lat: null, lon: null, horario: null, telefono: null },
            destino: { tipo: "cliente", id: String(cliente.contabiliumId), nombre: cliente.name, direccion: "", lat: null, lon: null, horario: null, telefono: cliente.phone || null },
            horaSalida: null,
            duracionMin: null,
            distanciaKm: null,
            descargaMin: 20,
            notas: `Pedido web #${order.id} — ${resumenItems}`,
            remito: { numero: numeroMatch ? numeroMatch[1] : null, id: null, tienePdf: !!r.remitoPdfBase64 },
            pedidoPendienteId: null,
          },
          { uid: user?.uid || "", nombre: profile?.name || user?.email || null }
        );
      } catch {
        // el movimiento ya se hizo — si falla crear el viaje (ej. sin red un
        // instante) no hay que perder el progreso, se puede cargar a mano
      }
      setPasos((prev) => {
        const next = {
          ...prev,
          [g.depId]: {
            ...prev[g.depId],
            moviendo: false,
            movido: { idTransferencia: r.idTransferencia, remitoArchivo: r.remitoArchivo, remitoNumero: numeroMatch ? numeroMatch[1] : null, remitoPdfBase64: r.remitoPdfBase64 },
            viajeId,
          },
        };
        persistir(next);
        return next;
      });
    } catch (e) {
      setPasos((prev) => ({ ...prev, [g.depId]: { ...prev[g.depId], moviendo: false, errorMover: e.message || String(e) } }));
    }
  }

  async function generarReal(g) {
    const p = pasos[g.depId];
    if (!p?.movido?.remitoArchivo) return;
    setPasos((prev) => ({ ...prev, [g.depId]: { ...prev[g.depId], generandoReal: true, errorReal: null } }));
    try {
      const r = await generarRemitoRealManual({
        remitoArchivo: p.movido.remitoArchivo,
        proveedorContabiliumId: cliente.contabiliumId,
        observaciones: `Pedido web #${order.id} — ${cliente.name}`,
        incluirMercaderiaConsignacion: true,
      });
      setPasos((prev) => {
        const next = { ...prev, [g.depId]: { ...prev[g.depId], generandoReal: false, remitoReal: { remitoArchivo: r.remitoArchivo, remitoPdfBase64: r.remitoPdfBase64, numero: r.numero } } };
        persistir(next);
        return next;
      });
    } catch (e) {
      setPasos((prev) => ({ ...prev, [g.depId]: { ...prev[g.depId], generandoReal: false, errorReal: e.message || String(e) } }));
    }
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="mt-4 w-full rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
      >
        📦 Confirmar envío (mueve stock real + remito + viaje)
      </button>
    );
  }

  if (!grupos) {
    return (
      <div className="mt-4 space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">
          ¿De qué depósito sale este pedido? — esto va a mover stock real en Contabilium.
        </p>
        {clienteError && <p className="text-xs text-rose-600 dark:text-rose-400">{clienteError}</p>}
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

        <select
          value={depositoGlobal}
          onChange={(e) => {
            setDepositoGlobal(e.target.value);
            setExcepciones({});
          }}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-medium dark:border-neutral-700 dark:bg-neutral-800"
        >
          <option value="">Elegí depósito…</option>
          {DEPOSITOS_PROPIOS_ORDERS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre} {stockCargando[d.id] ? "(cargando stock…)" : ""}
            </option>
          ))}
        </select>

        {depGlobalId && itemsParaBloque.length > 0 && (
          <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">
              No hay stock suficiente en {DEPOSITOS_PROPIOS_ORDERS.find((d) => d.id === depGlobalId)?.nombre} para estos ítems — elegí de dónde salen, o reemplazalos por otra bici:
            </p>
            {itemsParaBloque.map((it) => (
              <div key={it.id} className="rounded-lg bg-white p-2 text-xs dark:bg-neutral-900">
                <p className="font-medium text-slate-800 dark:text-white">
                  {it.qty}x {it.name} <span className="text-slate-400">(stock en {DEPOSITOS_PROPIOS_ORDERS.find((d) => d.id === depGlobalId)?.nombre}: {stockDe(depGlobalId, it.sku) ?? 0})</span>
                </p>
                <select
                  value={excepciones[it.id] || ""}
                  onChange={(e) => setExcepciones((prev) => ({ ...prev, [it.id]: e.target.value }))}
                  disabled={!!sustituciones[it.id]}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  <option value="">Mantener en {DEPOSITOS_PROPIOS_ORDERS.find((d) => d.id === depGlobalId)?.nombre} (no alcanza)</option>
                  {DEPOSITOS_PROPIOS_ORDERS.filter((d) => d.id !== depGlobalId).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre} — stock {stockDe(d.id, it.sku) ?? "?"}
                    </option>
                  ))}
                </select>

                <div className="mt-2 border-t border-rose-100 pt-2 dark:border-rose-500/20">
                  {sustituciones[it.id] ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-emerald-700 dark:text-emerald-400">
                        🔁 Reemplazado por: {sustituciones[it.id].name} (SKU {sustituciones[it.id].sku}, stock {stockDe(depGlobalId, sustituciones[it.id].sku) ?? 0})
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setSustituciones((prev) => {
                            const next = { ...prev };
                            delete next[it.id];
                            return next;
                          })
                        }
                        className="shrink-0 text-slate-400 underline"
                      >
                        Deshacer
                      </button>
                    </div>
                  ) : buscadorAbierto === it.id ? (
                    <div className="space-y-1">
                      <input
                        autoFocus
                        value={filtroSustituto}
                        onChange={(e) => setFiltroSustituto(e.target.value)}
                        placeholder="Buscar bici por nombre o SKU…"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800"
                      />
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-neutral-700">
                        {catalogoDeposito.length === 0 && (
                          <p className="px-2 py-1.5 text-slate-400">Cargando catálogo…</p>
                        )}
                        {catalogoDeposito
                          .filter((p) => {
                            const q = filtroSustituto.trim().toLowerCase();
                            if (!q) return true;
                            return (p.name || "").toLowerCase().includes(q) || (p.sku || "").includes(q);
                          })
                          .map((p) => (
                            <button
                              type="button"
                              key={p.sku}
                              onClick={() => {
                                setSustituciones((prev) => ({ ...prev, [it.id]: { sku: p.sku, name: p.name } }));
                                setBuscadorAbierto(null);
                                setFiltroSustituto("");
                              }}
                              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-neutral-800"
                            >
                              <span className="text-slate-700 dark:text-neutral-200">{p.name}</span>
                              <span
                                className={`shrink-0 font-semibold ${
                                  (p.stockDisponible ?? 0) > 0 ? "text-emerald-600" : "text-slate-400"
                                }`}
                              >
                                stock {p.stockDisponible ?? 0}
                              </span>
                            </button>
                          ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setBuscadorAbierto(null);
                          setFiltroSustituto("");
                        }}
                        className="text-slate-400 underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setBuscadorAbierto(it.id);
                        setFiltroSustituto("");
                      }}
                      className="font-medium text-indigo-600 underline dark:text-indigo-400"
                    >
                      🔄 Cambiar por otra bici
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => setAbierto(false)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 dark:border-neutral-700">
            Cancelar
          </button>
          <button
            onClick={confirmarDepositos}
            disabled={!cliente}
            className="flex-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {!cliente && !clienteError ? "Buscando datos del cliente…" : "Confirmar depósito(s)"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">Paso 1: mover stock real. Paso 2 (aparte): generar el remito real.</p>
        <button onClick={() => setAbierto(false)} className="text-xs text-amber-700 underline dark:text-amber-400">
          Cerrar
        </button>
      </div>
      {grupos.map((g) => {
        const p = pasos[g.depId] || {};
        return (
          <div key={g.depId} className="space-y-2 rounded-xl bg-white p-3 text-xs dark:bg-neutral-900">
            <p className="font-semibold text-slate-800 dark:text-white">
              Desde {g.depInfo?.nombre} — {g.items.length} ítem(s)
            </p>

            {!p.movido && (
              <>
                {p.errorMover && <p className="text-rose-600 dark:text-rose-400">{p.errorMover}</p>}
                <button
                  onClick={() => moverStock(g)}
                  disabled={p.moviendo}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-900 disabled:opacity-60 dark:bg-neutral-700"
                >
                  {p.moviendo ? "Moviendo stock…" : "1️⃣ Mover stock real"}
                </button>
              </>
            )}

            {p.movido && (
              <>
                <p className="text-emerald-600 dark:text-emerald-400">
                  ✓ Stock movido — remito interno {p.movido.remitoNumero || "(sin número)"}
                  {p.viajeId ? " — viaje creado" : " — ⚠ no se pudo crear el viaje, cargalo a mano"}
                </p>
                {p.movido.remitoPdfBase64 && (
                  <button
                    onClick={() => descargarPdfBase64(p.movido.remitoPdfBase64, `remito-${p.movido.remitoNumero}-interno.pdf`)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    📄 Descargar remito interno (FEPA TOP)
                  </button>
                )}

                {!p.remitoReal && (
                  <div className="mt-1">
                    {p.errorReal && <p className="text-rose-600 dark:text-rose-400">{p.errorReal}</p>}
                    <button
                      onClick={() => generarReal(g)}
                      disabled={p.generandoReal}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      {p.generandoReal ? "Generando…" : "2️⃣ Generar remito real"}
                    </button>
                  </div>
                )}

                {p.remitoReal && !p.remitoReal.remitoPdfBase64 && (
                  <div className="mt-1 rounded-lg border border-rose-200 bg-rose-50 p-2 dark:border-rose-500/30 dark:bg-rose-500/10">
                    <p className="font-semibold text-rose-700 dark:text-rose-400">⚠️ No tomó al cliente real — sigue a nombre de FEPA TOP.</p>
                    <button
                      onClick={() => generarReal(g)}
                      disabled={p.generandoReal}
                      className="mt-1 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      {p.generandoReal ? "Reintentando…" : "Reintentar remito real"}
                    </button>
                  </div>
                )}

                {p.remitoReal?.remitoPdfBase64 && (
                  <div className="mt-1">
                    <p className="text-emerald-600 dark:text-emerald-400">✓ Remito real generado a nombre de {cliente.name}</p>
                    <button
                      onClick={() => descargarPdfBase64(p.remitoReal.remitoPdfBase64, `remito-${p.remitoReal.numero}-real.pdf`)}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                    >
                      📄 Descargar remito real
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
