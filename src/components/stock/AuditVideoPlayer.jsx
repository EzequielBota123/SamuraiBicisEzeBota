import { useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { registrarVisto, contarVistas, ultimaVista, guardarRevisionManual, quitarRevisionManual, guardarDeteccionAuto } from "../../services/stockAudits";
import { detectBikesInVideo } from "../../utils/bikeDetection";

function formatFechaHora(d) {
  if (!d) return "-";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) + " · " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) + " hs";
}

const RESULTADO_LABEL = {
  coincide: "✓ Coincide",
  no_coincide: "✕ No coincide",
  otro: "✏️ Otro",
};
const RESULTADO_COLOR = {
  coincide: "text-emerald-600 dark:text-emerald-400",
  no_coincide: "text-rose-600 dark:text-rose-400",
  otro: "text-amber-600 dark:text-amber-400",
};

// Reproductor de video de auditoría que registra automáticamente cada
// reproducción (quién y cuándo) — usado en StockConsignado, Clientes 360 y
// el CRM, para que "visto" quede centralizado en un solo lugar sin repetir
// la lógica de tracking en cada pantalla.
export default function AuditVideoPlayer({ audit, className = "", videoClassName = "w-full max-w-md rounded-lg border border-slate-200 dark:border-neutral-700", onRevisadoChange }) {
  const { user, profile } = useAuth();
  const videoRef = useRef(null);
  const yaRegistroEstaSesion = useRef(false);
  const [revisadoManual, setRevisadoManual] = useState(audit?.revisadoManual || null);
  const [guardandoRevision, setGuardandoRevision] = useState(false);
  const [notaOtro, setNotaOtro] = useState(audit?.revisadoManual?.nota || "");
  const [deteccionAuto, setDeteccionAuto] = useState(audit?.deteccionAuto || null);
  const [detectando, setDetectando] = useState(false);
  const [progresoDeteccion, setProgresoDeteccion] = useState(null);
  const [errorDeteccion, setErrorDeteccion] = useState("");

  // Avisa al padre cada vez que cambia (chequear/destildar/elegir
  // resultado), para que las pestañas de filtro y los contadores se
  // actualicen al toque, sin esperar a recargar toda la lista.
  function updateRevisado(nuevo) {
    setRevisadoManual(nuevo);
    onRevisadoChange?.(nuevo);
  }

  function handlePlay() {
    if (yaRegistroEstaSesion.current || !user || !audit?.id) return;
    yaRegistroEstaSesion.current = true;
    const nombre = profile?.name || user.displayName || user.email || "Admin";
    registrarVisto(audit.id, user.uid, nombre).catch((err) => console.warn("No se pudo registrar la vista del video:", err));
  }

  async function handleToggleChequeado(e) {
    if (!user || !audit?.id) return;
    const marcado = e.target.checked;
    setGuardandoRevision(true);
    try {
      if (!marcado) {
        await quitarRevisionManual(audit.id);
        updateRevisado(null);
        setNotaOtro("");
      } else {
        const nombre = profile?.name || user.displayName || user.email || "Admin";
        // Al tildar sin elegir todavía resultado, queda "chequeado" igual —
        // eso ya lo cuenta como revisado; el resultado se puede elegir después.
        await guardarRevisionManual(audit.id, user.uid, nombre, null, "");
        updateRevisado({ uid: user.uid, nombre, fecha: new Date(), resultado: null, nota: "" });
      }
    } catch (err) {
      console.warn("No se pudo guardar el chequeo manual:", err);
    } finally {
      setGuardandoRevision(false);
    }
  }

  async function handleElegirResultado(resultado) {
    if (!user || !audit?.id) return;
    setGuardandoRevision(true);
    const nombre = profile?.name || user.displayName || user.email || "Admin";
    const nota = resultado === "otro" ? notaOtro : "";
    try {
      await guardarRevisionManual(audit.id, user.uid, nombre, resultado, nota);
      updateRevisado({ uid: user.uid, nombre, fecha: new Date(), resultado, nota });
    } catch (err) {
      console.warn("No se pudo guardar el resultado del chequeo:", err);
    } finally {
      setGuardandoRevision(false);
    }
  }

  async function handleGuardarNotaOtro() {
    if (!user || !audit?.id || !revisadoManual) return;
    setGuardandoRevision(true);
    try {
      await guardarRevisionManual(audit.id, revisadoManual.uid, revisadoManual.nombre, "otro", notaOtro);
      updateRevisado({ ...revisadoManual, resultado: "otro", nota: notaOtro });
    } catch (err) {
      console.warn("No se pudo guardar la nota:", err);
    } finally {
      setGuardandoRevision(false);
    }
  }

  async function handleDetectarBicis() {
    if (!videoRef.current || !audit?.id) return;
    setDetectando(true);
    setErrorDeteccion("");
    setProgresoDeteccion(null);
    try {
      const resultado = await detectBikesInVideo(videoRef.current, {
        onProgress: (actual, total) => setProgresoDeteccion({ actual, total }),
      });
      setDeteccionAuto({ ...resultado, computedAt: new Date() });
      await guardarDeteccionAuto(audit.id, resultado);
    } catch (err) {
      setErrorDeteccion(err.message || "No se pudo analizar el video");
    } finally {
      setDetectando(false);
      setProgresoDeteccion(null);
    }
  }

  if (!audit) return null;

  const vistas = contarVistas(audit);
  const ultima = ultimaVista(audit);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        src={audit.videoUrl}
        controls
        playsInline
        crossOrigin="anonymous"
        onPlay={handlePlay}
        className={videoClassName}
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={detectando}
          onClick={handleDetectarBicis}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        >
          {detectando
            ? `🔍 Analizando… ${progresoDeteccion ? `${progresoDeteccion.actual}/${progresoDeteccion.total}` : ""}`
            : "🔍 Detectar bicis (IA)"}
        </button>
        {deteccionAuto && (
          <div className="flex flex-col gap-0.5">
            {deteccionAuto.bicicletas > 0 ? (
              <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
                ≈ {deteccionAuto.bicicletas} bici{deteccionAuto.bicicletas === 1 ? "" : "s"} armada
                {deteccionAuto.bicicletas === 1 ? "" : "s"} detectada{deteccionAuto.bicicletas === 1 ? "" : "s"}
                <span className="ml-1 font-normal text-slate-400 dark:text-neutral-500">(máx. {deteccionAuto.maxSimultaneas} a la vez en cuadro)</span>
              </span>
            ) : (
              <span className="text-[11px] font-medium text-slate-400 dark:text-neutral-500">Sin bicis armadas detectadas</span>
            )}
            {deteccionAuto.cajas > 0 ? (
              <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                📦 ≈ {deteccionAuto.cajas} caja{deteccionAuto.cajas === 1 ? "" : "s"} detectada{deteccionAuto.cajas === 1 ? "" : "s"}
                <span className="ml-1 font-normal text-slate-400 dark:text-neutral-500">
                  (máx. {deteccionAuto.cajasMaxSimultaneas} a la vez — por color/forma, no por IA entrenada: puede confundir objetos marrones que no son cajas)
                </span>
              </span>
            ) : (
              <span className="text-[11px] font-normal text-slate-400 dark:text-neutral-500">
                Sin cajas detectadas por color/forma (estimación poco confiable)
              </span>
            )}
          </div>
        )}
      </div>
      {errorDeteccion && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{errorDeteccion}</p>}

      <p className={`mt-1 text-[11px] font-medium ${vistas > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-neutral-500"}`}>
        {vistas > 0
          ? `👁 Visto ${vistas}x · último: ${ultima?.nombre || "-"} el ${formatFechaHora(ultima?.fecha)}`
          : "👁 Sin revisar"}
      </p>

      <label className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-neutral-400">
        <input
          type="checkbox"
          checked={!!revisadoManual}
          disabled={guardandoRevision}
          onChange={handleToggleChequeado}
          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        {revisadoManual
          ? `✓ Chequeado por ${revisadoManual.nombre} el ${formatFechaHora(revisadoManual.fecha)}`
          : "Marcar como chequeado (doble control manual)"}
      </label>

      {revisadoManual && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={guardandoRevision}
            onClick={() => handleElegirResultado("coincide")}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
              revisadoManual.resultado === "coincide"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            Coincide
          </button>
          <button
            type="button"
            disabled={guardandoRevision}
            onClick={() => handleElegirResultado("no_coincide")}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
              revisadoManual.resultado === "no_coincide"
                ? "border-rose-500 bg-rose-50 text-rose-700 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-rose-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            No coincide
          </button>
          <button
            type="button"
            disabled={guardandoRevision}
            onClick={() => handleElegirResultado("otro")}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
              revisadoManual.resultado === "otro"
                ? "border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-amber-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            Otro
          </button>
          {revisadoManual.resultado && (
            <span className={`text-[11px] font-semibold ${RESULTADO_COLOR[revisadoManual.resultado]}`}>
              {RESULTADO_LABEL[revisadoManual.resultado]}
            </span>
          )}
        </div>
      )}

      {revisadoManual?.resultado === "otro" && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="text"
            value={notaOtro}
            onChange={(e) => setNotaOtro(e.target.value)}
            placeholder="Escribí qué encontraste…"
            className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
          <button
            type="button"
            disabled={guardandoRevision}
            onClick={handleGuardarNotaOtro}
            className="shrink-0 rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-700 dark:hover:bg-neutral-600"
          >
            Guardar
          </button>
        </div>
      )}
    </div>
  );
}
