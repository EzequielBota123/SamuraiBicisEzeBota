import { useEffect, useState } from "react";
import { TURNOS } from "../../services/logisticaTurnos";
import { subscribeChoferes } from "../../services/choferes";

export function turnoActual() {
  const h = new Date().getHours();
  if (h < 13) return "mañana";
  if (h < 20) return "tarde";
  return "noche";
}

export function viajeCfgInicial() {
  return { cargar: true, fecha: new Date().toISOString().slice(0, 10), turno: turnoActual(), hora: "", choferUid: "", choferNombre: "" };
}

// Bloque que se agrega a cualquier pantalla que mueve mercadería: si está
// tildado, al confirmar se carga solo el viaje en la grilla de Julián.
export default function CargarViajeCampos({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const [choferes, setChoferes] = useState([]);
  useEffect(() => subscribeChoferes(setChoferes), []);
  // Por defecto se asigna al primer chofer de planta (Julián), pero se puede cambiar.
  useEffect(() => {
    if (!value.choferUid && choferes.length > 0) set({ choferUid: choferes[0].uid, choferNombre: choferes[0].nombre });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choferes]);
  return (
    <div className="mt-4 rounded-xl border border-sky-200 bg-white p-3 text-xs dark:border-sky-900/50 dark:bg-neutral-900">
      <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-neutral-200">
        <input type="checkbox" checked={value.cargar} onChange={(e) => set({ cargar: e.target.checked })} />
        🚚 Cargar el viaje en la grilla de Julián
      </label>
      {value.cargar && (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="text-slate-500 dark:text-neutral-400">
              Día
              <input type="date" value={value.fecha} onChange={(e) => set({ fecha: e.target.value })} className="ml-1 rounded-lg border border-slate-200 px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
            </label>
            <label className="text-slate-500 dark:text-neutral-400">
              Turno
              <select value={value.turno} onChange={(e) => set({ turno: e.target.value })} className="ml-1 rounded-lg border border-slate-200 px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">
                {TURNOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-slate-500 dark:text-neutral-400">
              Chofer
              <select
                value={value.choferUid}
                onChange={(e) => set({ choferUid: e.target.value, choferNombre: choferes.find((c) => c.uid === e.target.value)?.nombre || "" })}
                className="ml-1 rounded-lg border border-slate-200 px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
              >
                <option value="">Sin asignar</option>
                {choferes.map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-slate-500 dark:text-neutral-400">
              Sale a las
              <input type="time" value={value.hora} onChange={(e) => set({ hora: e.target.value })} className="ml-1 rounded-lg border border-slate-200 px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
            </label>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
            El mapa calcula solo cuánto tarda; el remito queda adjunto para que Julián lo vea desde su grilla.
          </p>
        </>
      )}
    </div>
  );
}
