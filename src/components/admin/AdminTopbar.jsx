import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import {
  subscribeNotifications,
  markNotificationRead,
  markNotificationAttended,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
  updateNotificationItems,
} from "../../services/notifications";
import { resolveSaleRequest } from "../../services/comprobantes";
import ThemeToggle from "../ui/ThemeToggle";
import { requestNotificationPermission, showDesktopNotification, playNotificationSound } from "../../utils/desktopNotify";
import { activarNotificacionesPush, permisoNotificacionesEstado } from "../../utils/pushNotifications";
import { useAuth } from "../../auth/AuthContext";

function money(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function isStockRequest(n) {
  return (n.customerNotes || "").includes("Pedido de reposición desde Mi Stock");
}

function saleItemsCount(n) {
  return (n.items || []).reduce((acc, it) => acc + Number(it.quantity || 0), 0);
}

const SEARCH_ITEMS = [
  { label: "Dashboard", to: "/admin", keywords: "metricas inicio resumen" },
  { label: "Usuarios", to: "/admin/users", keywords: "clientes distribuidores cuentas" },
  { label: "Productos", to: "/admin/products", keywords: "catalogo bicicletas" },
  { label: "Stock consignado", to: "/admin/stock-consignado", keywords: "depositos distribuidores inventario" },
  { label: "Ventas reportadas", to: "/admin/ventas-reportadas", keywords: "facturar pendientes" },
  { label: "Órdenes", to: "/admin/orders", keywords: "pedidos compras" },
  { label: "Tipos de producto", to: "/admin/product-types", keywords: "categorias" },
  { label: "Tipos de cliente", to: "/admin/customer-types", keywords: "descuentos" },
  { label: "Configuración", to: "/admin/settings", keywords: "ajustes" },
];

function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function saleItemsTotal(n) {
  return (n.items || []).reduce((acc, it) => acc + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0);
}

function typeMeta(n) {
  if (n.type === "audit_alert") {
    return n.severity === "danger"
      ? { color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900", Icon: AuditIcon }
      : n.severity === "info"
      ? { color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900", Icon: AuditIcon }
      : { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900", Icon: AuditIcon };
  }
  if (n.type === "sale_reported") {
    return { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900", Icon: SaleIcon };
  }
  if (n.type === "comprobante_pago") {
    return { color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900", Icon: SaleIcon };
  }
  if (n.type === "pago_cc_pendiente") {
    return { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900", Icon: SaleIcon };
  }
  if (n.type === "auto_link_cliente") {
    return { color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900", Icon: SaleIcon };
  }
  if (n.type === "auto_invoice_failed") {
    return { color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900", Icon: AuditIcon };
  }
  if (n.type === "pago_cc_auto_aplicado") {
    return { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900", Icon: SaleIcon };
  }
  if (n.type === "clientes_contabilium_auto_creados") {
    return { color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900", Icon: OrderIcon };
  }
  if (isStockRequest(n)) {
    return { color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900", Icon: StockIcon };
  }
  return { color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900", Icon: OrderIcon };
}

function timeAgo(date) {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return date.toLocaleDateString("es-AR");
}

// Bloque de texto listo para pegar la carga en Contabilium (flujo manual asistido).
function buildContabiliumText(n) {
  const lines = [
    `Pedido #${n.orderId}`,
    `Cliente: ${n.customerName}`,
    n.customerCuit ? `CUIT: ${n.customerCuit}` : null,
    n.contabilium?.idListaPrecio != null ? `Lista de precios: ${n.contabilium.idListaPrecio}` : null,
    n.contabilium?.condicionIva != null ? `Condición IVA: ${n.contabilium.condicionIva}` : null,
    n.customerEmail ? `Email: ${n.customerEmail}` : null,
    n.customerPhone ? `Teléfono: ${n.customerPhone}` : null,
    "",
    "Detalle:",
    ...(n.items || []).map(
      (it) => `• ${it.sku ? `[${it.sku}] ` : ""}${it.name} x${it.qty} — ${money(it.price)} c/u — ${money(it.price * it.qty)}`
    ),
    "",
    `Total: ${money(n.total)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export default function AdminTopbar({ onToggleSidebar, mobileOpen }) {
  const history = useHistory();
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  // Push real (FCM) al celular — hasta ahora solo existía este botón en el
  // navbar de clientes; el admin nunca tenía forma de activarlo, por eso no
  // saltaba nada en el celular aunque toda la infraestructura ya estuviera
  // armada del lado del servidor.
  const [notifPermiso, setNotifPermiso] = useState(null);
  const [notifBusy, setNotifBusy] = useState(false);
  useEffect(() => {
    permisoNotificacionesEstado().then(setNotifPermiso);
  }, []);
  async function handleActivarPush() {
    if (!user?.uid) return;
    setNotifBusy(true);
    try {
      await activarNotificacionesPush(user.uid);
      setNotifPermiso("granted");
    } catch (e) {
      alert(e.message || "No se pudo activar");
    } finally {
      setNotifBusy(false);
    }
  }
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [collapsedNameGroups, setCollapsedNameGroups] = useState({});
  const [resolvingId, setResolvingId] = useState(null);
  const panelRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchRef = useRef(null);

  const searchResults = useMemo(() => {
    const q = normalize(searchQuery.trim());
    if (!q) return [];
    return SEARCH_ITEMS.filter(
      (item) => normalize(item.label).includes(q) || normalize(item.keywords).includes(q)
    );
  }, [searchQuery]);

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [searchResults]);

  useEffect(() => {
    function onClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    }
    if (searchOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [searchOpen]);

  function goToSearchResult(item) {
    history.push(item.to);
    setSearchQuery("");
    setSearchOpen(false);
  }

  function handleSearchKeyDown(e) {
    if (!searchResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchActiveIndex((i) => (i + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchActiveIndex((i) => (i - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      goToSearchResult(searchResults[searchActiveIndex] || searchResults[0]);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  }

  function toggleGroup(key) {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleNameGroup(key) {
    setCollapsedNameGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const seenNotifIdsRef = useRef(null); // null = todavía no llegó la primera tanda
  useEffect(() => {
    requestNotificationPermission();
    const unsub = subscribeNotifications(
      (items) => {
        const seen = seenNotifIdsRef.current;
        if (seen) {
          const nuevas = items.filter((n) => !n.read && !seen.has(n.id));
          for (const n of nuevas) {
            const cantidad = n.type === "sale_reported" ? saleItemsCount(n) : n.itemsCount;
            showDesktopNotification(
              n.distributorName || n.customerName || "Samurai",
              n.type === "sale_reported"
                ? `Reportó ${cantidad} unidad(es)`
                : `Nueva notificación${n.total ? ` — ${money(n.total)}` : ""}`
            );
          }
        }
        seenNotifIdsRef.current = new Set(items.map((n) => n.id));
        setNotifications(items);
      },
      (err) => console.error("notifications:", err)
    );
    return unsub;
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const unread = notifications.filter((n) => !n.read).length;

  // Título de la pestaña con el contador — así se ve el aviso aunque el
  // admin esté en otra pestaña del navegador, no solo mirando la campanita.
  useEffect(() => {
    const base = "Samurai Admin";
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [unread]);

  // Agrupa las notificaciones por cliente/distribuidor, conservando el
  // orden general por la más reciente de cada grupo.
  const groupedNotifications = useMemo(() => {
    const order = [];
    const byKey = new Map();
    for (const n of notifications) {
      const isDistributor =
        n.type === "sale_reported" ||
        n.type === "comprobante_pago" ||
        n.type === "pago_cc_pendiente" ||
        n.type === "auto_link_cliente" ||
        n.type === "auto_invoice_failed" ||
        n.type === "pago_cc_auto_aplicado";
      const key = isDistributor ? `d:${n.distributorName || "?"}` : `c:${n.customerName || "?"}`;
      if (!byKey.has(key)) {
        byKey.set(key, { key, label: isDistributor ? n.distributorName : n.customerName, items: [] });
        order.push(key);
      }
      byKey.get(key).items.push(n);
    }
    return order.map((key) => byKey.get(key));
  }, [notifications]);

  async function handleOpenOrder(n) {
    try {
      if (!n.read) await markNotificationRead(n.id);
    } catch (err) {
      console.error(err);
    }
    setOpen(false);
    if (n.type === "sale_reported") {
      // Si ya se facturó/emitió el COT solo para todos los ítems, lleva
      // directo a la pestaña "Facturadas"; si falta alguno, a "Pendientes"
      // — y en los dos casos resalta la fila de este distribuidor puntual.
      const todosFacturados = (n.items || []).length > 0 && (n.items || []).every((it) => it.tipoDocumentoEmitido);
      const tabDestino = todosFacturados ? "facturado" : "pendiente";
      history.push(`/admin/ventas-reportadas?tab=${tabDestino}&distribuidor=${encodeURIComponent(n.distributorName || "")}`);
      return;
    }
    history.push(
      n.type === "audit_alert"
        ? n.depositoId
          ? `/admin/stock-consignado?depositoId=${encodeURIComponent(n.depositoId)}`
          : "/admin/stock-consignado"
        : n.type === "comprobante_pago"
        ? `/admin/ventas-reportadas?tab=comprobantes&distribuidor=${encodeURIComponent(n.distributorName || "")}`
        : n.type === "auto_invoice_failed"
        ? `/admin/ventas-reportadas?tab=pendiente&distribuidor=${encodeURIComponent(n.distributorName || "")}`
        : n.type === "pago_cc_pendiente" || n.type === "auto_link_cliente" || n.type === "pago_cc_auto_aplicado"
        ? `/admin/clientes-360?buscar=${encodeURIComponent(n.distributorName || "")}`
        : n.type === "clientes_contabilium_auto_creados"
        ? "/admin/users"
        : n.orderId
        ? `/admin/orders?orderId=${encodeURIComponent(n.orderId)}`
        : "/admin/orders"
    );
  }

  async function handleDeleteNotification(e, id) {
    e.stopPropagation();
    try {
      await deleteNotification(id);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteAllNotifications() {
    if (notifications.length === 0) return;
    if (!confirm(`¿Seguro que querés eliminar TODAS las notificaciones (${notifications.length})? Esta acción no se puede deshacer.`))
      return;
    try {
      await deleteAllNotifications(notifications.map((n) => n.id));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleResolveItem(e, n, item) {
    e.stopPropagation();
    setResolvingId(item.saleRequestId);
    try {
      await resolveSaleRequest(item.saleRequestId);
      const remaining = (n.items || []).filter((it) => it.saleRequestId !== item.saleRequestId);
      if (remaining.length === 0) {
        await deleteNotification(n.id);
      } else {
        await updateNotificationItems(n.id, remaining);
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "No se pudo marcar facturado.");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleCopy(n) {
    try {
      await navigator.clipboard.writeText(buildContabiliumText(n));
      setCopiedId(n.id);
      setTimeout(() => setCopiedId((id) => (id === n.id ? null : id)), 1800);
      if (!n.attended) await markNotificationAttended(n.id);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-xl dark:border-neutral-800 dark:bg-black/90">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-5 sm:px-8">
        <button
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 lg:hidden dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white"
          onClick={onToggleSidebar}
        >
          {mobileOpen ? "Cerrar" : "Menú"}
        </button>

        <Link
          to="/"
          title="Ir al inicio del sitio"
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-400 hover:text-rose-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        >
          <HomeIcon className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Inicio</span>
        </Link>

        <div className="hidden md:flex items-center gap-3 text-slate-500">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
            Samurai Admin
          </span>
        </div>

        <div className="ml-auto flex flex-1 items-center gap-4">
          <div className="relative hidden lg:block flex-1" ref={searchRef}>
            <label className="sr-only">Buscar</label>
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar en el panel"
                className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500"
              />
            </div>

            {searchOpen && searchQuery.trim() && (
              <div className="absolute left-0 right-0 z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_30px_60px_-30px_rgba(15,23,42,0.35)] dark:border-neutral-700 dark:bg-neutral-900">
                {searchResults.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-400 dark:text-neutral-500">Sin resultados para "{searchQuery}".</p>
                ) : (
                  searchResults.map((item, i) => (
                    <button
                      key={item.to}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        goToSearchResult(item);
                      }}
                      onMouseEnter={() => setSearchActiveIndex(i)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                        i === searchActiveIndex ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400" : "text-slate-700 hover:bg-slate-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      }`}
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className="text-xs text-slate-400 dark:text-neutral-500">{item.to}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {notifPermiso !== "unsupported" && notifPermiso !== null && (profile?.fcmTokens || []).length === 0 && (
            <button
              onClick={handleActivarPush}
              disabled={notifBusy}
              title="Recibir las notificaciones como push real en el celular, aunque no tengas la app abierta"
              className="inline-flex items-center gap-1.5 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400"
            >
              {notifBusy ? "Activando…" : "📲 Activar en el celular"}
            </button>
          )}

          {/* Campana de notificaciones (M5) */}
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setOpen((v) => !v)}
              className={`relative inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-xs font-semibold transition ${
                unread > 0
                  ? "border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white"
              }`}
            >
              <BellIcon className={`h-4 w-4 ${unread > 0 ? "animate-bounce" : ""}`} />
              <span className="hidden sm:inline">Notificaciones</span>
              {unread > 0 ? (
                <span className="inline-flex h-5 min-w-[20px] animate-pulse items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
              )}
            </button>

            {open && (
              // En mobile va "fixed" con márgenes fijos al viewport — con
              // "absolute right-0" el panel podía arrancar fuera de la
              // pantalla por la izquierda si la campana no estaba pegada al
              // borde derecho (texto cortado, reportado en captura real).
              // De sm en adelante vuelve al comportamiento normal, anclado
              // a la campana.
              <div className="fixed inset-x-3 top-16 z-50 max-h-[calc(100vh-5rem)] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_40px_80px_-40px_rgba(15,23,42,0.4)] dark:border-neutral-700 dark:bg-neutral-900 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:left-auto sm:mt-2 sm:max-h-none sm:w-[360px] sm:max-w-[calc(100vw-2rem)]">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Notificaciones {unread > 0 && <span className="text-rose-500">({unread})</span>}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => playNotificationSound()}
                      title="Probar el sonido de notificación"
                      className="text-xs font-medium text-slate-500 transition hover:text-slate-800 dark:text-neutral-400 dark:hover:text-white"
                    >
                      🔊 Probar
                    </button>
                    {unread > 0 && (
                      <button
                        onClick={() => markAllNotificationsRead().catch(console.error)}
                        className="text-xs font-medium text-sky-600 transition hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300"
                      >
                        Marcar todas leídas
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button
                        onClick={handleDeleteAllNotifications}
                        className="text-xs font-medium text-rose-600 transition hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
                      >
                        Eliminar todo
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-[420px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-slate-400 dark:text-neutral-500">
                      No hay notificaciones.
                    </p>
                  ) : (
                    groupedNotifications.map((group) => {
                      const nameCollapsed = group.items.length > 1 && collapsedNameGroups[group.key];
                      return (
                      <div key={group.key}>
                        {group.items.length > 1 && (
                          <button
                            onClick={() => toggleNameGroup(group.key)}
                            className="flex w-full items-center gap-1.5 bg-slate-50 px-4 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100 dark:bg-neutral-800/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
                          >
                            <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3 w-3 shrink-0 transition-transform ${nameCollapsed ? "-rotate-90" : ""}`}>
                              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                            </svg>
                            <span className="flex-1 truncate">{group.label || "Sin nombre"}</span>
                            <span className="shrink-0 normal-case text-slate-400 dark:text-neutral-500">{group.items.length}</span>
                          </button>
                        )}
                        {!nameCollapsed && group.items.map((n) => {
                          const meta = typeMeta(n);
                          const canExpand = n.type === "sale_reported" && (n.items || []).length > 1;
                          const cardCollapsed = canExpand && collapsedGroups[n.id] !== false;
                          return (
                          <div
                            key={n.id}
                            className={`border-b border-slate-100 px-4 py-3 transition dark:border-neutral-800 ${
                              n.read ? "bg-white dark:bg-neutral-900" : "bg-sky-50/60 dark:bg-sky-500/10"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                onClick={() => handleOpenOrder(n)}
                                className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                              >
                                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border ${meta.bg} ${meta.color}`}>
                                  <meta.Icon className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />}
                                    <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                      {n.type === "audit_alert"
                                        ? n.distributorUid
                                          ? `🎥 Auditoría: ${n.customerName}`
                                          : `🎥 ${n.customerName}`
                                        : n.type === "sale_reported"
                                        ? `${n.distributorName || "Distribuidor"} reportó ${saleItemsCount(n)} venta${saleItemsCount(n) === 1 ? "" : "s"}`
                                        : n.type === "comprobante_pago"
                                        ? `${n.distributorName || "Distribuidor"} subió un comprobante de pago`
                                        : n.type === "auto_invoice_failed"
                                        ? `🚨 No se pudo facturar sola: ${n.distributorName || "Distribuidor"}`
                                        : n.type === "pago_cc_auto_aplicado"
                                        ? `✅ Pago aplicado solo: ${n.distributorName || "Distribuidor"}`
                                        : n.type === "clientes_contabilium_auto_creados"
                                        ? `🔗 ${n.cantidad} cliente${n.cantidad === 1 ? "" : "s"} nuevo${n.cantidad === 1 ? "" : "s"} vinculado${n.cantidad === 1 ? "" : "s"} solo`
                                        : isStockRequest(n)
                                        ? `${n.customerName} pidió más stock`
                                        : `${n.customerName} hizo un pedido`}
                                    </span>
                                  </div>
                                  {n.type === "audit_alert" ? (
                                    <p
                                      className={`mt-0.5 text-xs font-medium ${
                                        n.severity === "danger" ? "text-rose-600 dark:text-rose-400" : n.severity === "info" ? "text-sky-700 dark:text-sky-400" : "text-amber-700 dark:text-amber-400"
                                      }`}
                                    >
                                      {n.customerNotes}
                                    </p>
                                  ) : n.type === "sale_reported" ? (
                                    <>
                                      {cardCollapsed && (
                                        <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                          {(n.items || []).map((it) => it.name || `SKU ${it.sku}`).join(", ")}
                                          {n.depositoNombre ? ` · ${n.depositoNombre}` : ""}
                                        </p>
                                      )}
                                      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-500">
                                        {saleItemsCount(n)} unidad{saleItemsCount(n) === 1 ? "" : "es"}
                                        {" · "}{money(saleItemsTotal(n))}
                                      </p>
                                      {(n.items || []).every((it) => it.tipoDocumentoEmitido) ? (
                                        <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                          ✓ {(n.items || []).every((it) => it.tipoDocumentoEmitido === "COT") ? "COT" : "Factura"} emitida automática
                                        </p>
                                      ) : (n.items || []).some((it) => !it.tipoDocumentoEmitido) ? (
                                        <p className="mt-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                                          ⚠️ No se pudo facturar sola — hay que resolverla a mano
                                        </p>
                                      ) : null}
                                    </>
                                  ) : n.type === "comprobante_pago" ? (
                                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                      {n.saleItemName || "Comprobante de pago"} · pendiente de revisar
                                    </p>
                                  ) : n.type === "pago_cc_pendiente" ? (
                                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                      Subió comprobante de {money(n.monto)} · no está en Contabilium todavía — hay que cargar el recibo
                                    </p>
                                  ) : n.type === "auto_link_cliente" ? (
                                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                      🔗 Vinculado automáticamente a "{n.razonSocial}" en Contabilium (id {n.contabiliumId})
                                    </p>
                                  ) : n.type === "auto_invoice_failed" ? (
                                    <>
                                      <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                        {n.name || `SKU ${n.sku}`} — hay que facturarla a mano desde Ventas reportadas
                                      </p>
                                      {n.error && (
                                        <p className="mt-0.5 truncate text-xs text-rose-600 dark:text-rose-400" title={n.error}>
                                          {n.error}
                                        </p>
                                      )}
                                    </>
                                  ) : n.type === "pago_cc_auto_aplicado" ? (
                                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                      {money(n.monto)} aplicado a {n.facturaAplicada || "una factura"} automáticamente
                                    </p>
                                  ) : n.type === "clientes_contabilium_auto_creados" ? (
                                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                      {(n.clientes || []).slice(0, 3).map((c) => c.nombre).join(", ")}
                                      {(n.clientes || []).length > 3 ? "…" : ""}
                                    </p>
                                  ) : (
                                    <>
                                      <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-400">
                                        {n.customerName}
                                        {n.customerCuit ? ` · CUIT ${n.customerCuit}` : ""}
                                      </p>
                                      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-500">
                                        {n.itemsCount} ítem{n.itemsCount === 1 ? "" : "s"} · {money(n.total)}
                                        {n.contabilium?.idListaPrecio != null
                                          ? ` · Lista ${n.contabilium.idListaPrecio}`
                                          : ""}
                                      </p>
                                    </>
                                  )}
                                </div>
                              </button>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <span className="text-[11px] text-slate-400 dark:text-neutral-500">
                                  {timeAgo(n.createdAt)}
                                </span>
                                <button
                                  onClick={(e) => handleDeleteNotification(e, n.id)}
                                  title="Eliminar notificación"
                                  className="text-slate-300 transition hover:text-rose-500 dark:text-neutral-600 dark:hover:text-rose-400"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            {canExpand && (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleGroup(n.id); }}
                                className="mt-1.5 ml-9 flex items-center gap-1 text-[11px] font-medium text-slate-400 transition hover:text-slate-700 dark:text-neutral-500 dark:hover:text-neutral-200"
                              >
                                <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3 w-3 transition-transform ${cardCollapsed ? "" : "rotate-90"}`}>
                                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                </svg>
                                {cardCollapsed ? "Ver detalle" : "Ocultar detalle"}
                              </button>
                            )}

                            {n.type === "sale_reported" && !cardCollapsed && (
                              <ul className="ml-9 mt-2 space-y-1.5 border-l border-slate-100 pl-3 dark:border-neutral-800">
                                {(n.items || []).map((it) => (
                                  <li key={it.saleRequestId} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="min-w-0 truncate text-slate-600 dark:text-neutral-400">
                                      {it.name || `SKU ${it.sku}`} · {it.quantity}u · {money(Number(it.unitPrice || 0) * Number(it.quantity || 0))}
                                    </span>
                                    <button
                                      onClick={(e) => handleResolveItem(e, n, it)}
                                      disabled={resolvingId === it.saleRequestId}
                                      className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950"
                                    >
                                      {resolvingId === it.saleRequestId ? "…" : "Facturado"}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}

                            <div className="mt-2 flex items-center gap-2">
                              {n.type === "audit_alert" ? (
                                <button
                                  onClick={() => handleOpenOrder(n)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                                >
                                  Ver Stock Consignado
                                </button>
                              ) : n.type === "sale_reported" ? (
                                (n.items || []).length === 1 ? (
                                  <button
                                    onClick={(e) => handleResolveItem(e, n, n.items[0])}
                                    disabled={resolvingId === n.items[0]?.saleRequestId}
                                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950"
                                  >
                                    {resolvingId === n.items[0]?.saleRequestId ? "Guardando…" : "Marcar facturado"}
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                                    Pendiente de facturar
                                  </span>
                                )
                              ) : n.type === "comprobante_pago" ? (
                                <button
                                  onClick={() => handleOpenOrder(n)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 transition hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400"
                                >
                                  Revisar comprobante
                                </button>
                              ) : n.type === "pago_cc_pendiente" ? (
                                <button
                                  onClick={() => handleOpenOrder(n)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
                                >
                                  Ir a Clientes 360
                                </button>
                              ) : n.type === "auto_link_cliente" ? (
                                <button
                                  onClick={() => handleOpenOrder(n)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-400"
                                >
                                  Ver cliente vinculado
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleCopy(n)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                                >
                                  {copiedId === n.id ? "¡Copiado!" : "Copiar para Contabilium"}
                                </button>
                              )}
                              {n.attended && (
                                <span className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                                  Cargado
                                </span>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                      );
                    })
                  )}
                </div>

                <Link
                  to="/admin/orders"
                  onClick={() => setOpen(false)}
                  className="block border-t border-slate-100 bg-slate-50 px-4 py-3 text-center text-xs font-semibold text-slate-600 transition hover:text-slate-900 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-300 dark:hover:text-white"
                >
                  Ver todas las órdenes
                </Link>
              </div>
            )}
          </div>

          <ThemeToggle />

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-sky-500 to-indigo-500" title="Mi cuenta" />
            <div className="hidden text-xs text-slate-500 sm:block dark:text-neutral-400">
              <div className="font-semibold text-slate-900 dark:text-white">Admin</div>
              <div>online</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function BellIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SaleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13 5.4 5M7 13l-2.293 2.293A1 1 0 0 0 5.414 17H17" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
    </svg>
  );
}

function AuditIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M23 7 16 12l7 5V7Z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

function StockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function OrderIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function TrashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function HomeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
