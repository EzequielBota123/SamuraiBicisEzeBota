import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeChoferes } from "../../services/choferes";
import { useAuth } from "../../auth/AuthContext";
import { cargarClientesUnaVez } from "../../utils/clientesUbicados";
import { DEPOSITOS_PROPIOS, actualizarViaje, crearViaje, eliminarViaje } from "../../services/logisticaViajes";
import { calcularDuracion, fmtDuracion, fmtHora, geocodificar } from "../../utils/rutaViaje";

const MODOS = [
  { id: "deposito", label: "Depósito propio" },
  { id: "cliente", label: "Cliente" },
  { id: "libre", label: "Otra dirección" },
];

function LugarPicker({ titulo, valor, onChange }) {
  const [modo, setModo] = useState(valor?.tipo || "deposito");
  const [busqueda, setBusqueda] = useState("");
  const [clientes, setClientes] = useState(null);
  const [errorClientes, setErrorClientes] = useState("");
  const [libre, setLibre] = useState(valor?.tipo === "libre" ? valor.direccion : "");

  useEffect(() => {
    if (modo !== "cliente" || clientes) return;
    let cancelado = false;
    cargarClientesUnaVez()
      .then((items) => !cancelado && setClientes(items))
      .catch((e) => !cancelado && setErrorClientes(e.message || "No se pudieron cargar los clientes"));
    return () => {
      cancelado = true;
    };
  }, [modo, clientes]);

  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2 || !clientes) return [];
    return clientes.filter((c) => (c.nombre || "").toLowerCase().includes(q)).slice(0, 8);
  }, [busqueda, clientes]);

  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400">{titulo}</p>
      <div className="mt-1 flex gap-1">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setModo(m.id)}
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
              modo === m.id ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {modo === "deposito" && (
        <select
          value={valor?.tipo === "deposito" ? valor.id : ""}
          onChange={(e) => {
            const d = DEPOSITOS_PROPIOS.find((x) => x.id === e.target.value);
            if (d) onChange({ tipo: "deposito", id: d.id, nombre: d.nombre, direccion: d.direccion, lat: null, lon: null, horario: d.horario || null, telefono: d.telefono || null });
          }}
          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        >
          <option value="">Elegí un depósito…</option>
          {DEPOSITOS_PROPIOS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}
            </option>
          ))}
        </select>
      )}

      {modo === "cliente" && (
        <div className="mt-1.5">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={clientes ? "Buscá el cliente por nombre…" : "Cargando clientes…"}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
          {errorClientes && <p className="mt-1 text-xs text-rose-500">{errorClientes}</p>}
          {resultados.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-neutral-700">
              {resultados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange({
                      tipo: "cliente",
                      id: String(c.contabiliumId),
                      nombre: c.nombre,
                      direccion: [c.direccion, c.ciudad, c.provincia].filter(Boolean).join(", "),
                      lat: c.lat ?? null,
                      lon: c.lon ?? null,
                      horario: null,
                      telefono: null,
                    });
                    setBusqueda("");
                  }}
                  className="block w-full px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-neutral-800"
                >
                  {c.nombre} <span className="text-slate-400">· {c.ciudad || "—"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {modo === "libre" && (
        <input
          type="text"
          value={libre}
          onChange={(e) => {
            setLibre(e.target.value);
            const t = e.target.value.trim();
            onChange(t ? { tipo: "libre", id: null, nombre: t, direccion: t, lat: null, lon: null, horario: null, telefono: null } : null);
          }}
          placeholder="Dirección completa (calle, número, localidad)"
          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
      )}

      {valor && (
        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
          ✓ {valor.nombre}
          {valor.tipo !== "libre" && valor.direccion ? <span className="text-slate-400"> · {valor.direccion}</span> : null}
        </p>
      )}
    </div>
  );
}

export default function ViajeModal({ fecha, turno, viaje, onClose }) {
  const { user, profile } = useAuth();
  const actor = { uid: user?.uid || "", nombre: profile?.name || user?.email || null };
  const [origen, setOrigen] = useState(viaje?.origen || null);
  const [destino, setDestino] = useState(viaje?.destino || null);
  const [horaSalida, setHoraSalida] = useState(viaje?.horaSalida || "");
  const [descargaMin, setDescargaMin] = useState(viaje?.descargaMin ?? 20);
  const [notas, setNotas] = useState(viaje?.notas || "");
  const [choferes, setChoferes] = useState([]);
  const [choferUid, setChoferUid] = useState(viaje?.choferUid || "");
  const [calculo, setCalculo] = useState(
    viaje?.duracionMin != null
      ? { estado: "ok", duracionMin: viaje.duracionMin, distanciaKm: viaje.distanciaKm, msg: "" }
      : { estado: "idle", duracionMin: null, distanciaKm: null, msg: "" }
  );
  const coordsRef = useRef({ origen: viaje?.origen || null, destino: viaje?.destino || null });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeChoferes(setChoferes), []);

  // Recalcula el tiempo cada vez que cambia origen, destino u hora de salida.
  useEffect(() => {
    if (!origen || !destino) {
      setCalculo({ estado: "idle", duracionMin: null, distanciaKm: null, msg: "" });
      return;
    }
    let cancelado = false;
    setCalculo((c) => ({ ...c, estado: "calculando", msg: "" }));
    const timer = setTimeout(async () => {
      try {
        async function resolver(lugar) {
          if (lugar.lat != null && lugar.lon != null) return lugar;
          const p = await geocodificar(lugar.direccion);
          return p ? { ...lugar, lat: p.lat, lon: p.lon } : null;
        }
        const [o, d] = await Promise.all([resolver(origen), resolver(destino)]);
        if (!o || !d) throw new Error(`Google no pudo ubicar ${!o ? origen.nombre : destino.nombre} — revisá la dirección`);
        coordsRef.current = { origen: o, destino: d };
        const salida = horaSalida ? new Date(`${fecha}T${horaSalida}:00`) : null;
        const r = await calcularDuracion(o, d, salida);
        if (!cancelado) setCalculo({ estado: "ok", ...r, msg: "" });
      } catch (e) {
        if (!cancelado) setCalculo({ estado: "error", duracionMin: null, distanciaKm: null, msg: e.message || "No se pudo calcular el tiempo" });
      }
    }, 500);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [origen, destino, horaSalida, fecha]);

  const llegada =
    calculo.estado === "ok" && horaSalida
      ? new Date(new Date(`${fecha}T${horaSalida}:00`).getTime() + calculo.duracionMin * 60000)
      : null;
  const libre = llegada ? new Date(llegada.getTime() + Number(descargaMin || 0) * 60000) : null;

  async function guardar() {
    if (!origen || !destino) {
      setError("Elegí el origen y el destino");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const datos = {
        fecha,
        turno,
        origen: coordsRef.current.origen || origen,
        destino: coordsRef.current.destino || destino,
        horaSalida: horaSalida || null,
        duracionMin: calculo.estado === "ok" ? calculo.duracionMin : null,
        distanciaKm: calculo.estado === "ok" ? calculo.distanciaKm : null,
        descargaMin: Number(descargaMin) || 0,
        notas,
        chofer: choferUid ? { uid: choferUid, nombre: choferes.find((c) => c.uid === choferUid)?.nombre || "" } : null,
      };
      if (viaje) await actualizarViaje(viaje.id, datos);
      else await crearViaje(datos, actor);
      onClose();
    } catch (e) {
      setError(e.message || "No se pudo guardar el viaje");
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!viaje || !confirm("¿Eliminar este viaje de la grilla? No se puede deshacer.")) return;
    setGuardando(true);
    try {
      await eliminarViaje(viaje.id);
      onClose();
    } catch (e) {
      setError(e.message || "No se pudo eliminar");
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{viaje ? "Editar viaje" : "Nuevo viaje"}</h2>
            <p className="text-xs text-slate-400 dark:text-neutral-500">
              {fecha} · turno {turno}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800">
            ✕
          </button>
        </div>

        <LugarPicker titulo="Sale de" valor={origen} onChange={setOrigen} />
        <LugarPicker titulo="Va a" valor={destino} onChange={setDestino} />

        <div className="flex gap-3">
          <label className="flex-1 text-xs text-slate-500 dark:text-neutral-400">
            Hora de salida
            <input
              type="time"
              value={horaSalida}
              onChange={(e) => setHoraSalida(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <label className="flex-1 text-xs text-slate-500 dark:text-neutral-400">
            Carga/descarga (min)
            <input
              type="number"
              min="0"
              value={descargaMin}
              onChange={(e) => setDescargaMin(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
          </label>
        </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/20">
          {calculo.estado === "idle" && <p className="text-slate-500 dark:text-neutral-400">Elegí origen y destino y el mapa calcula cuánto tarda.</p>}
          {calculo.estado === "calculando" && <p className="text-sky-700 dark:text-sky-400">Calculando el recorrido…</p>}
          {calculo.estado === "error" && <p className="text-rose-600 dark:text-rose-400">{calculo.msg}</p>}
          {calculo.estado === "ok" && (
            <>
              <p className="font-semibold text-sky-800 dark:text-sky-300">
                🗺️ {fmtDuracion(calculo.duracionMin)} · {calculo.distanciaKm} km
                <span className="ml-1 text-xs font-normal text-sky-700/70 dark:text-sky-400/70">(con tránsito)</span>
              </p>
              {llegada ? (
                <p className="mt-0.5 text-xs text-sky-700 dark:text-sky-400">
                  Llega ~{fmtHora(llegada)} · camioneta libre ~{fmtHora(libre)}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-sky-700/70 dark:text-sky-400/70">Poné la hora de salida para ver a qué hora llega.</p>
              )}
            </>
          )}
        </div>

        <label className="block text-xs text-slate-500 dark:text-neutral-400">
          Chofer
          <select
            value={choferUid}
            onChange={(e) => setChoferUid(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          >
            <option value="">Sin asignar (lo ve cualquier chofer)</option>
            {choferes.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-slate-500 dark:text-neutral-400">
          Notas para el chofer (opcional)
          <input
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="ej: retirar 15 bicis, avisar al llegar"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </label>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || calculo.estado === "calculando"}
            className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {guardando ? "Guardando…" : viaje ? "Guardar cambios" : "Cargar viaje"}
          </button>
          {viaje && (
            <button type="button" onClick={eliminar} disabled={guardando} className="rounded-xl border border-rose-200 px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/20">
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
