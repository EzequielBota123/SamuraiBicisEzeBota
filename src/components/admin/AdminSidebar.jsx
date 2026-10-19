import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { subscribeToOrderSyncStatus } from "../../services/contabilium";
import { useAuth } from "../../auth/AuthContext";
import { puedeVerCots } from "../../utils/permisosCots";

function timeAgo(date) {
  if (!date) return "nunca";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return date.toLocaleDateString("es-AR");
}

const items = [
  // Panorama general / reportes de gestión
  { to: "/admin", label: "Dashboard", icon: DashboardIcon, exact: true },
  { to: "/admin/dashboard-negocio", label: "Dashboard de Gestión", icon: GestionIcon },
  { to: "/admin/contador-diario", label: "Contador diario", icon: GestionIcon },
  { to: "/admin/reporte-semanal", label: "Reporte semanal", icon: ReporteIcon },
  { to: "/admin/reporte-clientes", label: "Reporte de Clientes", icon: ReporteIcon },
  { to: "/admin/remitos-reporte", label: "Remitos y Cobranza", icon: RemitosIcon },
  { to: "/admin/pedidos-pendientes", label: "Pedidos a confirmar", icon: ReceiptIcon },
  // Clientes y relación
  { to: "/admin/clientes-360", label: "Clientes 360", icon: Clientes360Icon },
  { to: "/admin/vendedores", label: "Vendedores", icon: VendedoresIcon },
  { to: "/admin/crm", label: "CRM", icon: CrmIcon },
  // Dinero: bancos ("Cobranzas" se mudó a una solapa dentro de "Ventas
  // reportadas", para no ocupar un ítem aparte acá)
  { to: "/admin/movimientos-bancarios", label: "Movimientos Bancarios", icon: MovimientosIcon },
  // Operación: stock, ventas, órdenes
  { to: "/admin/stock-consignado", label: "Stock consignado", icon: BoxIcon },
  { to: "/admin/ventas-reportadas", label: "Ventas reportadas", icon: ReceiptIcon },
  { to: "/admin/orders", label: "Órdenes", icon: ReceiptIcon },
  { to: "/admin/cots", label: "COTs", icon: ReceiptIcon, restricted: true },
  { to: "/admin/chofer", label: "Choferes", icon: BoxIcon },
  // Administración y catálogo
  { to: "/admin/users", label: "Usuarios", icon: UsersIcon },
  { to: "/admin/products", label: "Productos", icon: BoxIcon },
  { to: "/admin/product-types", label: "Tipos de producto", icon: LayersIcon },
  { to: "/admin/customer-types", label: "Tipos de cliente", icon: TagIcon },
  { to: "/admin/settings", label: "Configuración", icon: SettingsIcon },
];

export default function AdminSidebar({ collapsed, onToggle, onNavigate }) {
  const { user } = useAuth();
  const [syncStatus, setSyncStatus] = useState(null);
  const visibleItems = items.filter((it) => !it.restricted || puedeVerCots(user?.uid));

  useEffect(() => {
    return subscribeToOrderSyncStatus(setSyncStatus);
  }, []);

  const hasErrors = (syncStatus?.errors?.length || 0) > 0;

  const Item = ({ to, label, icon, exact }) => {
    const Icon = icon;
    return (
      <NavLink
        exact={!!exact}
        to={to}
        onClick={onNavigate}
        title={collapsed ? label : undefined}
        className="group relative flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
        activeClassName="bg-white text-slate-900 shadow-lg shadow-sky-100 dark:bg-neutral-800 dark:text-white dark:shadow-none"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-slate-200 group-hover:text-slate-900 dark:bg-neutral-800 dark:text-neutral-400 dark:group-hover:bg-neutral-700 dark:group-hover:text-white">
          <Icon className="h-5 w-5" />
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
        <span className="pointer-events-none absolute inset-0 rounded-2xl border border-slate-200 opacity-0 transition group-hover:opacity-100 dark:border-neutral-700" />
      </NavLink>
    );
  };
  return (
    <div className="flex h-full flex-col px-4 py-6">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500" />
          {!collapsed && (
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Samurai Admin</p>
            </div>
          )}
        </div>
        <button
          onClick={onToggle}
          className="rounded-2xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-white"
          title={collapsed ? "Expandir" : "Colapsar"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="mt-6 space-y-2">
        {visibleItems.map((it) => (
          <Item key={it.to} {...it} />
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        {!collapsed ? (
          <>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${hasErrors ? "bg-rose-500" : "bg-emerald-400"}`} />
              <p className="font-semibold text-slate-900 dark:text-white">Sync con Contabilium</p>
            </div>
            <p className="mt-2 text-slate-500">Última corrida: {timeAgo(syncStatus?.lastSync)}</p>
            {hasErrors ? (
              <p className="text-rose-500">{syncStatus.errors.length} error(es)</p>
            ) : (
              <p className="text-slate-500">
                {syncStatus?.updated ?? 0} actualizada(s) de {syncStatus?.checked ?? 0} revisadas
              </p>
            )}
          </>
        ) : (
          <div className="flex justify-center">
            <span className={`h-2.5 w-2.5 rounded-full ${hasErrors ? "bg-rose-500" : "bg-emerald-400"}`} title="Sync con Contabilium" />
          </div>
        )}
      </div>
    </div>
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
