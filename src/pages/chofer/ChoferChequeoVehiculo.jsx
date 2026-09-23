import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  ITEMS_CHECKLIST_DEFAULT,
  enviarChequeoVehiculo,
  subscribeChequeoDelDia,
  hoyISO,
} from "../../services/chequeosVehiculo";

function estadoBanner(estado, comentarioAdmin) {
  if (estado === "aprobado") {
    return { cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-400", texto: "✅ Aprobado por administración — podés arrancar." };
  }
  if (estado === "rechazado") {
    return {
      cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-400",
      texto: `⚠️ Rechazado${comentarioAdmin ? `: ${comentarioAdmin}` : ""} — corregí y volvé a enviar.`,
    };
  }
  return { cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400", texto: "⏳ Esperando que administración lo revise." };
}

// Chequeo diario del vehículo antes de salir a ruta — el chofer marca un
// checklist fijo, aclara lo que haga falta, y queda pendiente hasta que
// admin le da el OK (o lo rechaza, con un comentario, para corregir y
// reenviar el mismo día).
export default function ChoferChequeoVehiculo() {
  const { user, profile } = useAuth();
  const fecha = hoyISO();
  const [items, setItems] = useState(() => ITEMS_CHECKLIST_DEFAULT.map((label) => ({ label, ok: true })));
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [chequeo, setChequeo] = useState(undefined); // undefined = cargando, null = no hay todavía

  useEffect(() => {
    if (!user) return;
    return subscribeChequeoDelDia(user.uid, fecha, setChequeo);
  }, [user, fecha]);

  function toggleItem(i) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ok: !it.ok } : it)));
  }

  async function enviar() {
    setEnviando(true);
    setError("");
    try {
      await enviarChequeoVehiculo({
        choferUid: user.uid,
        choferNombre: profile?.name || user.email || "",
        fecha,
        items,
        observacionChofer: observacion,
      });
      setObservacion("");
    } catch (e) {
      setError(e.message || "No se pudo enviar");
    } finally {
      setEnviando(false);
    }
  }

  const yaEnviadoHoy = chequeo && chequeo.estado !== "rechazado";

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">🚐 Chequeo del vehículo</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">Antes de salir, revisá esto y mandalo para que te den el OK.</p>
      </div>

      {chequeo !== undefined && chequeo !== null && (
        <div className={`rounded-2xl border p-4 text-sm font-medium ${estadoBanner(chequeo.estado, chequeo.comentarioAdmin).cls}`}>
          {estadoBanner(chequeo.estado, chequeo.comentarioAdmin).texto}
        </div>
      )}

      {!yaEnviadoHoy && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-neutral-300">¿Está todo en condiciones?</p>
          <div className="space-y-2">
            {items.map((it, i) => (
              <button
                key={it.label}
                type="button"
                onClick={() => toggleItem(i)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  it.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300"
                    : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300"
                }`}
              >
                <span>{it.label}</span>
                <span className="font-bold">{it.ok ? "✓ OK" : "✕ Falta algo"}</span>
              </button>
            ))}
          </div>

          <label className="mt-4 block text-xs font-medium text-slate-500 dark:text-neutral-400">
            ¿Algo para aclarar? (opcional)
          </label>
          <textarea
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            placeholder="ej: la goma trasera izquierda está gastada, avisar para cambiarla"
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />

          <button
            type="button"
            disabled={enviando}
            onClick={enviar}
            className="mt-4 w-full rounded-2xl bg-sky-600 py-3 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sky-700 disabled:opacity-60"
          >
            {enviando ? "Enviando…" : "✓ Enviar para aprobar"}
          </button>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
