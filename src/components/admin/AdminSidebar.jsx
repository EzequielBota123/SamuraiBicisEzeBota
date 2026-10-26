import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../firebase";
import { subscribeToOrderSyncStatus } from "../../services/contabilium";
import { useAuth } from "../../auth/AuthContext";
import { puedeVerCots } from "../../utils/permisosCots";

// Puntito rojo tipo "no leído" (WhatsApp) para estas 3 secciones: se prende
// cuando hay más pendientes ahora que la última vez que el admin entró ahí,
// y se apaga solo al entrar (ver marcarSeccionVista). "Visto" se guarda por
// usuario en users/{uid}.sidebarVisto, así sobrevive a un refresh/cierre de
// sesión — no es solo estado local del componente.
const SECCIONES_CON_PENDIENTES = {
  "/admin/pedidos-pendientes": "pedidosPendientes",
  "/admin/ventas-reportadas": "ventasReportadas",
  "/admin/orders": "ordenes",
};

function timeAgo(date) {
  if (!date) return "nunca";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return date.toLocaleDateString("es-AR");
}

// Agrupado en secciones (con su título chico) en vez de una lista plana —
// se ve más profesional y ayuda a ubicarse rápido con 20 ítems.
const sections = [
  {
    title: "Panorama",
    items: [
      { to: "/admin", label: "Dashboard", icon: DashboardIcon, exact: true },
      { to: "/admin/dashboard-negocio", label: "Dashboard de Gestión", icon: GestionIcon },
      { to: "/admin/contador-diario", label: "Contador diario", icon: GestionIcon },
      { to: "/admin/reporte-semanal", label: "Reporte semanal", icon: ReporteIcon },
      { to: "/admin/reporte-clientes", label: "Reporte de Clientes", icon: ReporteIcon },
      { to: "/admin/remitos-reporte", label: "Remitos y Cobranza", icon: RemitosIcon },
      { to: "/admin/pedidos-pendientes", label: "Pedidos a confirmar", icon: ReceiptIcon },
    ],
  },
  {
    title: "Clientes",
    items: [
      { to: "/admin/clientes-360", label: "Clientes 360", icon: Clientes360Icon },
      { to: "/admin/vendedores", label: "Vendedores", icon: VendedoresIcon },
      { to: "/admin/crm", label: "CRM", icon: CrmIcon },
    ],
  },
  {
    title: "Dinero",
    items: [
      // "Cobranzas" se mudó a una solapa dentro de "Ventas reportadas", para
      // no ocupar un ítem aparte acá.
      { to: "/admin/movimientos-bancarios", label: "Movimientos Bancarios", icon: MovimientosIcon },
    ],
  },
  {
    title: "Operación",
    items: [
      { to: "/admin/stock-consignado", label: "Stock consignado", icon: BoxIcon },
      { to: "/admin/ventas-reportadas", label: "Ventas reportadas", icon: ReceiptIcon },
      { to: "/admin/orders", label: "Órdenes", icon: ReceiptIcon },
      { to: "/admin/cots", label: "COTs", icon: ReceiptIcon, restricted: true },
      { to: "/admin/chofer", label: "Choferes", icon: BoxIcon },
    ],
  },
  {
    title: "Administración",
    items: [
      { to: "/admin/users", label: "Usuarios", icon: UsersIcon },
      { to: "/admin/products", label: "Productos", icon: BoxIcon },
      { to: "/admin/product-types", label: "Tipos de producto", icon: LayersIcon },
      { to: "/admin/customer-types", label: "Tipos de cliente", icon: TagIcon },
      { to: "/admin/settings", label: "Configuración", icon: SettingsIcon },
    ],
  },
];

export default function AdminSidebar({ collapsed, forceExpanded, onToggle, onNavigate }) {
  const { user } = useAuth();
  const [syncStatus, setSyncStatus] = useState(null);
  const [pendientesCounts, setPendientesCounts] = useState({});
  const [sidebarVisto, setSidebarVisto] = useState({});
  // En modo "riel de íconos" (collapsed=true), pasar el mouse por encima
  // despliega los nombres en un panel flotante aparte (ver `overlayAbierto`
  // más abajo) que se anima con CSS (opacity+transform) en vez de
  // aparecer/desaparecer de golpe — para eso el riel y el panel flotante
  // están SIEMPRE montados los dos, nunca se insertan/sacan del DOM, así el
  // navegador puede animar la transición. Si está "fijado" abierto
  // (collapsed=false, con el botón «/») el riel mismo se ve expandido
  // directo, sin depender del hover.
  const [hovering, setHovering] = useState(false);
  // Al sacar el mouse no cierra en seco: espera un toque (misma sensación
  // que un menú de verdad, ej. Linear/Notion) para que no se cierre de
  // golpe si el cursor pasa rápido entre el riel y el panel flotante —
  // cancela el cierre si vuelve a entrar antes de que se cumpla.
  const cierreTimeoutRef = useRef(null);
  function abrirHover() {
    if (cierreTimeoutRef.current) {
      clearTimeout(cierreTimeoutRef.current);
      cierreTimeoutRef.current = null;
    }
    setHovering(true);
  }
  function cerrarHoverConDelay() {
    cierreTimeoutRef.current = setTimeout(() => setHovering(false), 150);
  }
  useEffect(() => () => cierreTimeoutRef.current && clearTimeout(cierreTimeoutRef.current), []);
  // En el drawer mobile (forceExpanded, ver AdminLayout) siempre se ve
  // completo — no hay forma de "hacer hover" en touch, así que el riel de
  // íconos con hover es solo comportamiento de escritorio.
  const pinneadoExpandido = !collapsed || forceExpanded;
  const overlayAbierto = collapsed && !forceExpanded && hovering;
  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter((it) => !it.restricted || puedeVerCots(user?.uid)) }))
    .filter((s) => s.items.length > 0);

  useEffect(() => {
    return subscribeToOrderSyncStatus(setSyncStatus);
  }, []);

  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, "pedidosPendientes"), where("estado", "==", "pendiente")),
      (snap) => setPendientesCounts((p) => ({ ...p, pedidosPendientes: snap.size })),
      () => {}
    );
    const u2 = onSnapshot(
      query(collection(db, "saleRequests"), where("status", "==", "pendiente")),
      (snap) => setPendientesCounts((p) => ({ ...p, ventasReportadas: snap.size })),
      () => {}
    );
    const u3 = onSnapshot(
      query(collection(db, "orders"), where("status", "==", "pendiente")),
      (snap) => setPendientesCounts((p) => ({ ...p, ordenes: snap.size })),
      () => {}
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      setSidebarVisto(snap.data()?.sidebarVisto || {});
    });
  }, [user]);

  // Se llama al clickear una de estas 3 secciones: guarda el conteo actual
  // como "ya visto" — la próxima vez el puntito solo vuelve si el conteo
  // subió por encima de esto.
  function marcarSeccionVista(key) {
    if (!user) return;
    const actualizado = { ...sidebarVisto, [key]: pendientesCounts[key] || 0 };
    setSidebarVisto(actualizado);
    setDoc(doc(db, "users", user.uid), { sidebarVisto: actualizado }, { merge: true }).catch(() => {});
  }

  const hasErrors = (syncStatus?.errors?.length || 0) > 0;

  function Item({ to, label, icon, exact, showLabel }) {
    const Icon = icon;
    const claveSeccion = SECCIONES_CON_PENDIENTES[to];
    const tienePendienteSinVer = claveSeccion
      ? (pendientesCounts[claveSeccion] || 0) > (sidebarVisto[claveSeccion] || 0)
      : false;
    return (
      <NavLink
        exact={!!exact}
        to={to}
        onClick={() => {
          if (claveSeccion) marcarSeccionVista(claveSeccion);
          onNavigate?.();
        }}
        title={showLabel ? undefined : label}
        className="group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-medium text-slate-500 transition-colors duration-150 hover:bg-slate-100/80 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-white"
        activeClassName="!text-slate-900 dark:!text-white [&>.sb-active-bg]:opacity-100 [&>.sb-active-bar]:opacity-100"
      >
        <span className="sb-active-bg pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-sky-50 to-indigo-50 opacity-0 transition-opacity duration-150 dark:from-sky-500/10 dark:to-indigo-500/10" />
        <span className="sb-active-bar pointer-events-none absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sky-500 opacity-0 transition-opacity duration-150" />
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 group-hover:text-slate-700 dark:text-neutral-500 dark:group-hover:text-neutral-200">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
          {tienePendienteSinVer && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-neutral-950" />
          )}
        </span>
        {showLabel && <span className="relative truncate">{label}</span>}
        {showLabel && tienePendienteSinVer && (
          <span className="relative ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
        )}
      </NavLink>
    );
  }

  return (
    <>
      {/* Riel estático: SIEMPRE en el flujo normal, ocupa el ancho que le da
          el grid del layout (88px colapsado / 300px fijado). Nunca cambia
          de posición — lo que varía con el hover es solo el panel flotante
          de acá abajo. */}
      <div
        onMouseEnter={() => collapsed && !forceExpanded && abrirHover()}
        onMouseLeave={() => cerrarHoverConDelay()}
        className="flex h-full w-full flex-col px-3 py-5"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <img src="/img/samurai-favicon-round.png" alt="Samurai" className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-slate-200 dark:ring-neutral-800" />
              {pinneadoExpandido && (
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-white">Samurai Admin</p>
                  <p className="truncate text-[11px] text-slate-400 dark:text-neutral-500">Panel interno</p>
                </div>
              )}
            </div>
            <button
              onClick={onToggle}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-200"
              title={collapsed ? "Fijar expandido" : "Volver a riel de íconos"}
            >
              <ChevronIcon className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
            </button>
          </div>

          <nav className={`mt-6 flex-1 space-y-5 overflow-y-auto ${pinneadoExpandido ? "" : "flex flex-col items-center"}`}>
            {visibleSections.map((s) => (
              <div key={s.title} className={pinneadoExpandido ? "space-y-1" : "w-full space-y-1"}>
                {pinneadoExpandido && (
                  <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-600">
                    {s.title}
                  </p>
                )}
                {s.items.map((it) => (
                  <Item key={it.to} {...it} showLabel={pinneadoExpandido} />
                ))}
              </div>
            ))}
          </nav>

          <div
            className={`mt-4 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-neutral-800 dark:bg-white/[0.03] dark:text-neutral-400 ${
              pinneadoExpandido ? "" : "flex justify-center p-2"
            }`}
          >
            {pinneadoExpandido ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasErrors ? "bg-rose-500" : "bg-emerald-400"}`} />
                  <p className="font-semibold text-slate-700 dark:text-neutral-200">Sync con Contabilium</p>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">Última corrida: {timeAgo(syncStatus?.lastSync)}</p>
                {hasErrors ? (
                  <p className="text-[11px] text-rose-500">{syncStatus.errors.length} error(es)</p>
                ) : (
                  <p className="text-[11px] text-slate-400 dark:text-neutral-500">
                    {syncStatus?.updated ?? 0} actualizada(s) de {syncStatus?.checked ?? 0} revisadas
                  </p>
                )}
              </>
            ) : (
              <span className={`h-2 w-2 rounded-full ${hasErrors ? "bg-rose-500" : "bg-emerald-400"}`} title="Sync con Contabilium" />
            )}
          </div>
        </div>
      </div>

      {/* Panel flotante del hover: montado siempre que el riel esté en modo
          "colapsado de escritorio", pero controlado 100% por CSS
          (opacity+translate), nunca por mount/unmount — así la aparición se
          anima en vez de aparecer de golpe. Va por portal directo a <body>
          porque el <aside> que lo contendría en el flujo normal tiene
          `transform` (para la animación del cajón mobile) + recorta overflow
          — eso convierte cualquier `position:fixed` de adentro en un cuadro
          atrapado al ancho del riel (88px) en vez de los 272px reales
          (confirmado armando una página de prueba aislada y viéndolo en
          vivo). Portal = nace como hijo directo de <body>, sin ese problema.
      */}
      {collapsed && !forceExpanded && createPortal(
        <div
          onMouseEnter={() => abrirHover()}
          onMouseLeave={() => cerrarHoverConDelay()}
          style={{ transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          className={`fixed inset-y-0 left-0 z-50 w-[272px] overflow-y-auto border-r border-slate-200/80 bg-white/95 px-3 py-5 shadow-[0_30px_60px_-20px_rgba(15,23,42,0.25)] backdrop-blur-xl transition-all duration-[220ms] dark:border-neutral-800/80 dark:bg-neutral-950/95 ${
            overlayAbierto ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0"
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3">
              <img src="/img/samurai-favicon-round.png" alt="Samurai" className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-slate-200 dark:ring-neutral-800" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-white">Samurai Admin</p>
                <p className="truncate text-[11px] text-slate-400 dark:text-neutral-500">Panel interno</p>
              </div>
            </div>

            <nav className="mt-6 flex-1 space-y-5 overflow-y-auto">
              {visibleSections.map((s) => (
                <div key={s.title} className="space-y-1">
                  <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-600">
                    {s.title}
                  </p>
                  {s.items.map((it) => (
                    <Item key={it.to} {...it} showLabel />
                  ))}
                </div>
              ))}
            </nav>

            <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-neutral-800 dark:bg-white/[0.03] dark:text-neutral-400">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasErrors ? "bg-rose-500" : "bg-emerald-400"}`} />
                <p className="font-semibold text-slate-700 dark:text-neutral-200">Sync con Contabilium</p>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">Última corrida: {timeAgo(syncStatus?.lastSync)}</p>
              {hasErrors ? (
                <p className="text-[11px] text-rose-500">{syncStatus.errors.length} error(es)</p>
              ) : (
                <p className="text-[11px] text-slate-400 dark:text-neutral-500">
                  {syncStatus?.updated ?? 0} actualizada(s) de {syncStatus?.checked ?? 0} revisadas
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function ChevronIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function DashboardIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z" strokeWidth="1.5" />
    </svg>
  );
}
function UsersIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function BoxIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.3 7.3 12 12l8.7-4.7" />
    </svg>
  );
}
function ReceiptIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M4 3h14l2 3v14a2 2 0 0 1-2 2H4z" />
      <path d="M8 12h8M8 7h8M8 17h5" />
    </svg>
  );
}

function Clientes360Icon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M7 18a5 5 0 0 1 10 0" strokeLinecap="round" />
    </svg>
  );
}

function CobranzasIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 6v0M18 18v0" strokeLinecap="round" />
    </svg>
  );
}

function MovimientosIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VendedoresIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RemitosIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M9 3h6a2 2 0 0 1 2 2v14l-5-3-5 3V5a2 2 0 0 1 2-2Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GestionIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M3 3v18h18M7 15l4-5 3 3 5-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReporteIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M9 17V9M13 17v-5M17 17V7M5 21h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LayersIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

function TagIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M20.59 13.41 11 3H4v7l9.59 9.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82Z" />
      <path d="M7 7h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrmIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SettingsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
