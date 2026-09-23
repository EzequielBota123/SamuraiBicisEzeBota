import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { finalizarRuta, iniciarRuta, subscribeRutaAbierta, subscribeRutasCerradas } from "../../services/rutas";

function fmtFechaHora(d) {
  if (!d) return "—";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Registro de rutas: inicio/fin con anotaciones de lo que se hizo, colgado
// del mapa (CRM admin, chofer, y el mapa de Alfredo) — mismo componente en
// los tres lugares para que el historial sea uno solo y todos lo vean.
export default function RutaPanel() {
  const { user, profile } = useAuth();
  const nombre = profile?.name || profile?.username || user?.email || "";

  const [rutaAbierta, setRutaAbierta] = useState(undefined); // undefined = cargando
  const [historial, setHistorial] = useState([]);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [notaInicio, setNotaInicio] = useState("");
  const [notaFin, setNotaFin] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = subscribeRutaAbierta(setRutaAbierta);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeRutasCerradas(setHistorial);
    return unsub;
  }, []);

  async function handleIniciar() {
    if (!user) return;
    setGuardando(true);
    setError("");
    try {
      await iniciarRuta({ uid: user.uid, nombre, notaInicio });
      setNotaInicio("");
    } catch (e) {
      console.error("[RutaPanel] error iniciando ruta:", e);
      setError("No se pudo iniciar la ruta.");
    } finally {
      setGuardando(false);
    }
  }

  async function handleFinalizar() {
    if (!user || !rutaAbierta) return;
    setGuardando(true);
    setError("");
    try {
      await finalizarRuta(rutaAbierta.id, { uid: user.uid, nombre, notaFin });
      setNotaFin("");
    } catch (e) {
      console.error("[RutaPanel] error finalizando ruta:", e);
      setError("No se pudo finalizar la ruta.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">🧭 Registro de ruta</p>
        <button
          onClick={() => setMostrarHistorial((v) => !v)}
          className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
        >
          {mostrarHistorial ? "Ocultar historial" : `Ver historial (${historial.length})`}
        </button>
      </div>

      {rutaAbierta === undefined && (
        <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Cargando…</p>
      )}

      {rutaAbierta === null && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-500 dark:text-neutral-400">No hay ninguna ruta en curso.</p>
          <textarea
            value={notaInicio}
            onChange={(e) => setNotaInicio(e.target.value)}
            placeholder="Anotación al arrancar (opcional): a qué salís, qué zona, etc."
            rows={2}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
          />
          <button
            onClick={handleIniciar}
            disabled={guardando}
            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {guardando ? "Iniciando…" : "▶️ Iniciar ruta"}
          </button>
        </div>
      )}

      {rutaAbierta && (
        <div className="mt-2 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            🟢 Ruta en curso — iniciada por <span className="font-semibold">{rutaAbierta.iniciadoPorNombre}</span> el{" "}
            {fmtFechaHora(rutaAbierta.inicioAt)}
          </p>
          {rutaAbierta.notaInicio && (
            <p className="text-xs text-slate-600 dark:text-neutral-300">📝 {rutaAbierta.notaInicio}</p>
          )}
          <textarea
            value={notaFin}
            onChange={(e) => setNotaFin(e.target.value)}
            placeholder="Anotación de lo que se hizo en esta ruta (opcional)"
            rows={2}
            className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-emerald-900/50 dark:bg-neutral-950 dark:text-white"
          />
          <button
            onClick={handleFinalizar}
            disabled={guardando}
            className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {guardando ? "Finalizando…" : "⏹️ Finalizar ruta"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {mostrarHistorial && (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto border-t border-slate-100 pt-3 dark:border-neutral-800">
          {historial.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-neutral-500">Todavía no hay rutas cerradas.</p>
          )}
          {historial.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-100 p-2 text-xs dark:border-neutral-800">
              <p className="text-slate-600 dark:text-neutral-300">
                <span className="font-semibold">{r.iniciadoPorNombre}</span> · {fmtFechaHora(r.inicioAt)} →{" "}
                <span className="font-semibold">{r.finalizadoPorNombre}</span> · {fmtFechaHora(r.finAt)}
              </p>
              {r.notaInicio && <p className="mt-0.5 text-slate-500 dark:text-neutral-400">📝 Inicio: {r.notaInicio}</p>}
              {r.notaFin && <p className="mt-0.5 text-slate-500 dark:text-neutral-400">✅ Fin: {r.notaFin}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
