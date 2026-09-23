import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { subscribeChequeosRecientes, responderChequeoVehiculo } from "../../services/chequeosVehiculo";

function fmtFechaHora(d) {
  if (!d) return "-";
  return (
    d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) +
    " · " +
    d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) +
    " hs"
  );
}

const ESTADO_BADGE = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400",
  aprobado: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
  rechazado: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400",
};

function FilaChequeo({ chequeo, onResponder }) {
  const { user } = useAuth();
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const itemsConProblema = chequeo.items.filter((it) => !it.ok);

  async function responder(aprobar) {
    setEnviando(true);
    try {
      await responderChequeoVehiculo({
        choferUid: chequeo.choferUid,
        fecha: chequeo.fecha,
        aprobar,
        comentarioAdmin: comentario,
        respondidoPor: user.uid,
      });
      onResponder?.();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{chequeo.choferNombre}</p>
          <p className="text-xs text-slate-400 dark:text-neutral-500">{chequeo.fecha} · enviado {fmtFechaHora(chequeo.createdAt)}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${ESTADO_BADGE[chequeo.estado]}`}>
          {chequeo.estado}
        </span>
      </div>

      {itemsConProblema.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 dark:border-rose-900 dark:bg-rose-950/20">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">⚠️ Marcado con problema:</p>
          <ul className="mt-1 list-inside list-disc text-xs text-rose-600 dark:text-rose-400">
            {itemsConProblema.map((it) => (
              <li key={it.label}>{it.label}</li>
            ))}
          </ul>
        </div>
      )}
      {chequeo.observacionChofer && (
        <p className="mt-2 text-xs text-slate-600 dark:text-neutral-300">💬 "{chequeo.observacionChofer}"</p>
      )}
      {chequeo.comentarioAdmin && chequeo.estado !== "pendiente" && (
        <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Respuesta: {chequeo.comentarioAdmin}</p>
      )}

      {chequeo.estado === "pendiente" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
          <input
            type="text"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Comentario (opcional para aprobar, recomendado para rechazar)"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />
          <button
            onClick={() => responder(true)}
            disabled={enviando}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            ✓ Dar OK
          </button>
          <button
            onClick={() => responder(false)}
            disabled={enviando}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            ✕ Rechazar
          </button>
        </div>
      )}
    </div>
  );
}

// Panel de admin para revisar el chequeo diario de vehículo de cada chofer
// y darle el OK (o rechazarlo con un comentario) antes de que salga a ruta.
export default function ChequeosVehiculo() {
  const [chequeos, setChequeos] = useState(null);
  const [soloPendientes, setSoloPendientes] = useState(true);

  useEffect(() => subscribeChequeosRecientes(setChequeos), []);

  const lista = (chequeos || []).filter((c) => !soloPendientes || c.estado === "pendiente");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">🚐 Chequeos de vehículo</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Dale el OK a cada chofer antes de que salga a ruta.</p>
        </div>
        <button
          onClick={() => setSoloPendientes((v) => !v)}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
            soloPendientes
              ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
        >
          {soloPendientes ? "✓ Solo pendientes" : "Solo pendientes"}
        </button>
      </div>

      {chequeos === null && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}
      {chequeos && lista.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
          {soloPendientes ? "No hay chequeos pendientes." : "Todavía no hay chequeos cargados."}
        </p>
      )}
      <div className="space-y-2">
        {lista.map((c) => (
          <FilaChequeo key={c.id} chequeo={c} />
        ))}
      </div>
    </div>
  );
}
