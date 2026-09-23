import { NavLink, Route, Switch, Redirect } from "react-router-dom";
import AsignarClientes from "./AsignarClientes";
import Telemarketers from "./Telemarketers";
import VendedoresTab from "./VendedoresTab";
import Exportar from "./Exportar";
import Calendario from "./Calendario";
import Scripts from "./Scripts";
import PanelAdmin from "./PanelAdmin";
import ContactarVideos from "./ContactarVideos";
import MapaClientes from "./MapaClientes";
import useCrmData from "./useCrmData";
import { ActiveVendorProvider, useActiveVendor } from "./ActiveVendorContext";

const TABS = [
  { to: "/admin/crm/scripts", label: "📋 Scripts" },
  { to: "/admin/crm/videos", label: "📹 Videos de auditoría" },
  { to: "/admin/crm/mapa", label: "🗺️ Mapa de clientes" },
  { to: "/admin/crm/asignar", label: "🎯 Asignar Clientes" },
  { to: "/admin/crm/telemarketers", label: "📊 CRM Telemarketers" },
  { to: "/admin/crm/vendedores", label: "🤝 CRM Vendedores" },
  { to: "/admin/crm/exportar", label: "📥 Exportar" },
  { to: "/admin/crm/calendario", label: "📅 Calendario" },
  { to: "/admin/crm/admin", label: "📊 Panel Admin" },
];

export default function CrmLayout() {
  const crm = useCrmData();

  return (
    <ActiveVendorProvider>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">CRM Samurai &amp; Bowie</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            {crm.loading
              ? "Cargando datos…"
              : `${crm.clientes.length} clientes · ${crm.vendedores.length} vendedores`}
          </p>
          {crm.error && <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">{crm.error}</p>}
        </div>

        <ActiveVendorBanner vendedores={crm.vendedores} />

        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-neutral-700">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-sky-500 dark:hover:text-white"
              activeClassName="!border-sky-500 !bg-sky-50 !text-sky-700 dark:!border-sky-500 dark:!bg-sky-950/40 dark:!text-sky-400"
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        <Switch>
          <Route exact path="/admin/crm">
            <Redirect to="/admin/crm/asignar" />
          </Route>
          <Route path="/admin/crm/scripts" render={() => <Scripts />} />
          <Route path="/admin/crm/videos" render={() => <ContactarVideos />} />
          <Route path="/admin/crm/mapa" render={() => <MapaClientes crm={crm} />} />
          <Route path="/admin/crm/asignar" render={() => <AsignarClientes crm={crm} />} />
          <Route path="/admin/crm/telemarketers" render={() => <Telemarketers crm={crm} />} />
          <Route path="/admin/crm/vendedores" render={() => <VendedoresTab crm={crm} />} />
          <Route path="/admin/crm/exportar" render={() => <Exportar crm={crm} />} />
          <Route path="/admin/crm/calendario" render={() => <Calendario crm={crm} />} />
          <Route path="/admin/crm/admin" render={() => <PanelAdmin crm={crm} />} />
        </Switch>
      </div>
    </ActiveVendorProvider>
  );
}

function ActiveVendorBanner({ vendedores }) {
  const { activeVendedor, setActiveVendedor } = useActiveVendor();

  if (!activeVendedor) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
        <span>👤 No elegiste vendedor todavía — elegí uno para que las asignaciones, estados y notas queden a su nombre.</span>
        <select
          value=""
          onChange={(e) => e.target.value && setActiveVendedor(e.target.value)}
          className="ml-auto rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs dark:border-amber-800 dark:bg-neutral-900 dark:text-white"
        >
          <option value="">— Elegir vendedor —</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.nombre}>
              {v.nombre}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400">
      <span>
        🔒 Actuando como <strong>{activeVendedor}</strong> — todas las asignaciones, cambios de estado y notas que hagas de ahora en más quedan a su nombre.
      </span>
      <button onClick={() => setActiveVendedor("")} className="ml-auto rounded-lg border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-400 dark:hover:bg-sky-950/60">
        Cambiar vendedor
      </button>
    </div>
  );
}
