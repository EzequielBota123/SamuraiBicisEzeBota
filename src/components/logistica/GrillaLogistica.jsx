import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { TURNOS, proximosDias, subscribeTurnosRango, guardarTurno } from "../../services/logisticaTurnos";
import { subscribeViajesRango } from "../../services/logisticaViajes";
import { fmtHora } from "../../utils/rutaViaje";
import ViajeCard from "./ViajeCard";
import ViajeModal from "./ViajeModal";

const TURNO_ICONO = { "mañana": "🌅", "tarde": "☀️", "noche": "🌙" };

function fmtDiaLabel(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00`);
  const hoy = new Date().toISOString().slice(0, 10);
  const esHoy = fechaISO === hoy;
  return `${esHoy ? "Hoy · " : ""}${d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })}`;
}

function ordenPorSalida(a, b) {
  return (a.horaSalida || "99:99").localeCompare(b.horaSalida || "99:99");
}

// Edición de las horas sueltas del turno (sale / se desocupa) — sigue
// existiendo para lo que no es un viaje puntual.
function HorasTurno({ fecha, turno, dato, onGuardar }) {
  const [editando, setEditando] = useState(false);
  const [horaSalida, setHoraSalida] = useState(dato?.horaSalida || "");
  const [horaLibre, setHoraLibre] = useState(dato?.horaLibre || "");
  const [notas, setNotas] = useState(dato?.notas || "");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!editando) {
      setHoraSalida(dato?.horaSalida || "");
      setHoraLibre(dato?.horaLibre || "");
      setNotas(dato?.notas || "");
    }
  }, [dato, editando]);

  async function guardar() {
    setGuardando(true);
    try {
      await onGuardar({ fecha, turno, horaSalida, horaLibre, notas });
      setEditando(false);
    } finally {
      setGuardando(false);
    }
  }

  if (!editando) {
    return (
      <div className="flex items-start justify-between gap-2 text-[11px] text-slate-500 dark:text-neutral-400">
        <span className="min-w-0">
          {dato?.horaSalida || dato?.horaLibre ? `Sale ${dato?.horaSalida || "—"} · Libre ${dato?.horaLibre || "—"}` : "Horas sin cargar"}
          {dato?.notas ? ` · 💬 ${dato.notas}` : ""}
        </span>
        <button type="button" onClick={() => setEditando(true)} className="shrink-0 text-sky-600 hover:underline dark:text-sky-400">
          editar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-xs dark:border-sky-800 dark:bg-sky-950/20">
      <div className="flex gap-1.5">
        <label className="flex-1">
          <span className="block text-[10px] text-sky-700 dark:text-sky-400">Sale</span>
          <input type="time" value={horaSalida} onChange={(e) => setHoraSalida(e.target.value)} className="w-full rounded-lg border border-sky-200 bg-white px-1.5 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white" />
        </label>
        <label className="flex-1">
          <span className="block text-[10px] text-sky-700 dark:text-sky-400">Libre</span>
          <input type="time" value={horaLibre} onChange={(e) => setHoraLibre(e.target.value)} className="w-full rounded-lg border border-sky-200 bg-white px-1.5 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white" />
        </label>
      </div>
      <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas (opcional)" className="mt-1.5 w-full rounded-lg border border-sky-200 bg-white px-1.5 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white" />
      <div className="mt-1.5 flex gap-1.5">
        <button onClick={guardar} disabled={guardando} className="flex-1 rounded-lg bg-sky-600 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
          {guardando ? "…" : "Guardar"}
        </button>
        <button onClick={() => setEditando(false)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function CeldaTurno({ fecha, turno, dato, viajes, esChofer, actor, onGuardarHoras, onNuevoViaje, onEditarViaje }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <p className="font-semibold text-slate-700 dark:text-neutral-300">
        {TURNO_ICONO[turno]} {turno}
      </p>
      <HorasTurno fecha={fecha} turno={turno} dato={dato} onGuardar={onGuardarHoras} />
      {viajes.length === 0 && <p className="text-slate-400 dark:text-neutral-500">Sin viajes</p>}
      {viajes.map((v) => (
        <ViajeCard key={v.id} viaje={v} esChofer={esChofer} actor={actor} onEditar={() => onEditarViaje(v)} />
      ))}
      {!esChofer && (
        <button
          type="button"
          onClick={() => onNuevoViaje(fecha, turno)}
          className="w-full rounded-lg border border-dashed border-sky-300 py-1.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-400 dark:hover:bg-sky-950/20"
        >
          + Viaje
        </button>
      )}
    </div>
  );
}

// Lo último que hizo el chofer hoy — para que el admin vea de un vistazo
// quién salió, llegó o entregó sin tener que buscar en la grilla.
function Novedades({ viajes }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const eventos = [];
  for (const v of viajes) {
    if (v.fecha !== hoy) continue;
    const ruta = `${v.origen.nombre} → ${v.destino.nombre}`;
    if (v.saliAt) eventos.push({ t: v.saliAt, texto: `🚚 Salió: ${ruta}`, quien: v.choferNombre });
    if (v.llegoAt) eventos.push({ t: v.llegoAt, texto: `📍 Llegó a ${v.destino.nombre}`, quien: v.choferNombre });
    if (v.entregadoAt) eventos.push({ t: v.entregadoAt, texto: `✅ Entregó en ${v.destino.nombre}`, quien: v.choferNombre });
  }
  eventos.sort((a, b) => b.t.getTime() - a.t.getTime());
  if (eventos.length === 0) return null;
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
      <p className="text-xs font-bold text-emerald-800 dark:text-emerald-400">🔔 Novedades de hoy</p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-emerald-900 dark:text-emerald-300">
        {eventos.slice(0, 6).map((e, i) => (
          <li key={i}>
            <span className="font-mono text-emerald-700/80 dark:text-emerald-400/80">{fmtHora(e.t)}</span> {e.texto}
            {e.quien ? <span className="text-emerald-700/70 dark:text-emerald-400/70"> — {e.quien}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Grilla de logística: 7 días × 3 turnos. Cada turno tiene sus viajes
// (origen → destino, con el tiempo calculado por el mapa y el estado que va
// marcando el chofer) y las horas sueltas de la camioneta. El admin carga los
// viajes; el chofer los ve servidos y va avisando salida/llegada/entrega.
export default function GrillaLogistica() {
  const { user, profile } = useAuth();
  const esChofer = profile?.role === "chofer" || (profile?.esChofer === true && profile?.role !== "admin");
  const actor = { uid: user?.uid || "", nombre: profile?.name || user?.email || null };
  const dias = useMemo(() => proximosDias(7), []);
  const [turnos, setTurnos] = useState(null);
  const [viajes, setViajes] = useState(null);
  const [errorViajes, setErrorViajes] = useState("");
  const [modal, setModal] = useState(null); // { fecha, turno, viaje? }

  useEffect(() => subscribeTurnosRango(dias[0], dias[dias.length - 1], setTurnos), [dias]);
  useEffect(
    () => subscribeViajesRango(dias[0], dias[dias.length - 1], setViajes, (e) => setErrorViajes(e.message || "No se pudieron cargar los viajes")),
    [dias]
  );

  const turnoPorClave = useMemo(() => {
    const map = new Map();
    for (const t of turnos || []) map.set(`${t.fecha}_${t.turno}`, t);
    return map;
  }, [turnos]);

  const viajesPorClave = useMemo(() => {
    const map = new Map();
    // Cada chofer ve sus viajes y los que todavía no tienen chofer asignado.
    const visibles = (viajes || []).filter((v) => !esChofer || !v.choferUid || v.choferUid === user?.uid);
    for (const v of visibles) {
      const k = `${v.fecha}_${v.turno}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(v);
    }
    for (const lista of map.values()) lista.sort(ordenPorSalida);
    return map;
  }, [viajes, esChofer, user?.uid]);

  async function handleGuardarHoras({ fecha, turno, horaSalida, horaLibre, notas }) {
    await guardarTurno({ fecha, turno, horaSalida, horaLibre, notas, choferUid: user?.uid || null, choferNombre: profile?.name || user?.email || null });
  }

  return (
    <div className="space-y-3">
      {!esChofer && <Novedades viajes={viajes || []} />}
      {(turnos === null || viajes === null) && !errorViajes && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}
      {errorViajes && <p className="text-sm text-rose-500">{errorViajes}</p>}
      {dias.map((fecha) => (
        <div key={fecha}>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400">{fmtDiaLabel(fecha)}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TURNOS.map((turno) => (
              <CeldaTurno
                key={turno}
                fecha={fecha}
                turno={turno}
                dato={turnoPorClave.get(`${fecha}_${turno}`)}
                viajes={viajesPorClave.get(`${fecha}_${turno}`) || []}
                esChofer={esChofer}
                actor={actor}
                onGuardarHoras={handleGuardarHoras}
                onNuevoViaje={(f, t) => setModal({ fecha: f, turno: t })}
                onEditarViaje={(v) => setModal({ fecha: v.fecha, turno: v.turno, viaje: v })}
              />
            ))}
          </div>
        </div>
      ))}
      {modal && <ViajeModal fecha={modal.fecha} turno={modal.turno} viaje={modal.viaje} onClose={() => setModal(null)} />}
    </div>
  );
}
