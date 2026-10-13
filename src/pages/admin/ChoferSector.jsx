import { useEffect, useMemo, useState } from "react";
import { NavLink, Redirect, Route, Switch } from "react-router-dom";
import GrillaLogisticaPage from "./GrillaLogisticaPage";
import UbicacionChoferes from "./UbicacionChoferes";
import ChequeosVehiculo from "./ChequeosVehiculo";
import { subscribeViajesRango } from "../../services/logisticaViajes";
import { subscribeUbicacionesChoferes } from "../../services/ubicacionChofer";
import { hoyISO, subscribeChequeosRecientes } from "../../services/chequeosVehiculo";
import { subscribeChoferes } from "../../services/choferes";
import { subscribeRemitosDespachosDetail } from "../../services/comprobantes";
import { movimientosPorChofer } from "../../utils/movimientosChofer";

const TABS = [
  { to: "/admin/chofer/grilla", label: "📅 Grilla y viajes" },
  { to: "/admin/chofer/ubicacion", label: "📍 Dónde está" },
  { to: "/admin/chofer/chequeos", label: "🚐 Chequeo de vehículo" },
];

function haceCuanto(fecha) {
  if (!fecha) return "sin datos";
  const diff = Math.floor((Date.now() - fecha.getTime()) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  return `hace ${Math.floor(diff / 3600)} h`;
}

function Tarjeta({ titulo, valor, detalle, tono = "neutral" }) {
  const tonos = {
    neutral: "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
    ok: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20",
    warn: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20",
    bad: "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/20",
  };
  return (
    <div className={`rounded-2xl border p-3 ${tonos[tono]}`}>
      <p className="text-[11px] font-medium text-slate-500 dark:text-neutral-400">{titulo}</p>
      <p className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">{valor}</p>
      {detalle && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">{detalle}</p>}
    </div>
  );
}

// Un solo lugar para todo lo de Julián: resumen del día arriba y, abajo, la
// grilla con sus viajes, dónde está y el chequeo del vehículo.
function ResumenChofer({ chofer, viajes, ubicacion, chequeo }) {
  const propios = viajes.filter((v) => v.choferUid === chofer.uid && v.estado !== "cancelado");
  const entregados = propios.filter((v) => v.estado === "entregado").length;
  const enCurso = propios.find((v) => v.estado === "en_camino" || v.estado === "llego");
  const minSin = ubicacion?.updatedAt ? (Date.now() - ubicacion.updatedAt.getTime()) / 60000 : null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-sm font-bold text-slate-900 dark:text-white">
        🚚 {chofer.nombre}
        {!chofer.rolChofer && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">también reparte</span>}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tarjeta
          titulo="Viajes de hoy"
          valor={`${entregados} de ${propios.length} entregados`}
          detalle={enCurso ? `Ahora: ${enCurso.origen.nombre} → ${enCurso.destino.nombre}` : propios.length ? "Ninguno en curso" : "Sin viajes asignados"}
          tono={enCurso ? "ok" : "neutral"}
        />
        <Tarjeta
          titulo="Ubicación"
          valor={ubicacion ? `Última señal ${haceCuanto(ubicacion.updatedAt)}` : "No compartió su ubicación"}
          detalle={ubicacion ? null : "Tiene que abrir su sector chofer y aceptar el permiso"}
          tono={!ubicacion ? "bad" : minSin != null && minSin > 30 ? "warn" : "ok"}
        />
        <Tarjeta
          titulo="Chequeo de la camioneta"
          valor={chequeo ? (chequeo.estado === "aprobado" ? "Aprobado" : chequeo.estado === "rechazado" ? "Rechazado" : "Pendiente de revisar") : "No lo hizo hoy"}
          tono={!chequeo ? "warn" : chequeo.estado === "aprobado" ? "ok" : chequeo.estado === "rechazado" ? "bad" : "warn"}
        />
      </div>
    </div>
  );
}

// Un solo lugar para todo lo de los choferes: resumen del día por chofer
// arriba y, abajo, la grilla con sus viajes, dónde están y el chequeo.
export default function ChoferSector() {
  const hoy = useMemo(() => hoyISO(), []);
  const [viajesHoy, setViajesHoy] = useState(null);
  const [ubicaciones, setUbicaciones] = useState(null);
  const [chequeos, setChequeos] = useState(null);
  const [choferes, setChoferes] = useState(null);
  const [remitosDetail, setRemitosDetail] = useState(null);

  useEffect(() => subscribeViajesRango(hoy, hoy, setViajesHoy), [hoy]);
  useEffect(() => subscribeUbicacionesChoferes(setUbicaciones), []);
  useEffect(() => subscribeChequeosRecientes(setChequeos, 30), []);
  useEffect(() => subscribeChoferes(setChoferes), []);
  useEffect(() => subscribeRemitosDespachosDetail(setRemitosDetail), []);

  const sinAsignar = (viajesHoy || []).filter((v) => !v.choferUid && v.estado !== "cancelado").length;

  // Movimientos reales del mes (de los remitos, cruzando la observación) —
  // esto sí trae historial completo, a diferencia de los viajes de la
  // grilla que recién se empezaron a cargar y hoy tienen pocos registros.
  const mesActual = hoy.slice(0, 7);
  const movimientosDelMes = useMemo(
    () => movimientosPorChofer(remitosDetail?.porRemito || [], `${mesActual}-01`, `${mesActual}-31`),
    [remitosDetail, mesActual]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">🚚 Choferes</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Todo en un solo lugar: los viajes que les cargás, dónde está cada uno y el chequeo de la camioneta. Para sumar un chofer,
          marcalo en Usuarios como chofer (o tildá "También es chofer").
        </p>
      </div>

      <div className="space-y-2">
        {choferes === null && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}
        {choferes && choferes.length === 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">Todavía no hay ningún chofer cargado.</p>
        )}
        {(choferes || []).map((c) => (
          <ResumenChofer
            key={c.uid}
            chofer={c}
            viajes={viajesHoy || []}
            ubicacion={(ubicaciones || []).find((u) => u.uid === c.uid)}
            chequeo={(chequeos || []).find((x) => x.choferUid === c.uid && x.fecha === hoy)}
          />
        ))}
        {sinAsignar > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠️ Hay {sinAsignar} viaje(s) de hoy sin chofer asignado — los ve cualquier chofer.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-bold text-slate-900 dark:text-white">📦 Movimientos reales del mes ({mesActual})</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">
          De los remitos reales de Contabilium, no de esta grilla — así se ve lo que movió cada uno aunque no haya
          cargado el viaje acá.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {movimientosDelMes.map((c) => (
            <Tarjeta
              key={c.id}
              titulo={c.nombre}
              valor={`${c.totalBicis} bici(s)`}
              detalle={`${c.movimientos.length} movimiento(s) este mes`}
              tono={c.movimientos.length > 0 ? "ok" : "neutral"}
            />
          ))}
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-neutral-800">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className="whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-white"
            activeClassName="border-b-2 border-sky-600 text-sky-700 dark:text-sky-400"
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Switch>
        <Route path="/admin/chofer/grilla" component={GrillaLogisticaPage} />
        <Route path="/admin/chofer/ubicacion" component={UbicacionChoferes} />
        <Route path="/admin/chofer/chequeos" component={ChequeosVehiculo} />
        <Redirect to="/admin/chofer/grilla" />
      </Switch>
    </div>
  );
}
