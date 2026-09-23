import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import ChoferUbicacionBroadcaster from "../logistica/ChoferUbicacionBroadcaster";

const TABS = [
  { to: "/chofer/chequeo-vehiculo", label: "🚐 Chequeo vehículo" },
  { to: "/chofer/grilla", label: "📅 Grilla" },
  { to: "/chofer/mapa", label: "🗺️ Mapa" },
  { to: "/chofer/stock-consignado", label: "📦 Stock consignado" },
  { to: "/chofer/notas", label: "📝 Notas de entrega" },
];

// Quien solo tiene la marca esChofer (ej. un distribuidor que también
// reparte) ve únicamente lo que necesita para manejar: chequeo y viajes.
const TABS_SOLO_MARCA = ["/chofer/chequeo-vehiculo", "/chofer/grilla"];

export default function ChoferLayout({ children }) {
  const { profile, user, logout } = useAuth();
  const soloMarca = profile?.role !== "chofer" && profile?.role !== "admin";
  const tabs = soloMarca ? TABS.filter((t) => TABS_SOLO_MARCA.includes(t.to)) : TABS;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-black dark:text-white">
      <ChoferUbicacionBroadcaster />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">🚚 Sector Chofer</p>
            <p className="text-xs text-slate-500 dark:text-neutral-400">{profile?.name || user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Salir
          </button>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className="whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              activeClassName="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400"
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
