import { useEffect, useState } from "react";
import { ESTADO_INFO, llegadaEstimada, libreEstimado, salidaPlanificada, cambiarEstadoViaje, obtenerPdfRemitoViaje } from "../../services/logisticaViajes";
import { fmtDuracion, fmtHora, linkComoLlegar } from "../../utils/rutaViaje";

const SIGUIENTE = {
  programado: { estado: "en_camino", label: "🚚 Salí", cls: "bg-sky-600 hover:bg-sky-700" },
  en_camino: { estado: "llego", label: "📍 Llegué", cls: "bg-amber-500 hover:bg-amber-600" },
  llego: { estado: "entregado", label: "✅ Entregué", cls: "bg-emerald-600 hover:bg-emerald-700" },
};

function useAhora(intervaloMs = 60000) {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return ahora;
}

// Alerta de atraso: en camino y ya pasó la llegada estimada (con 10 min de
// margen), o programado y ya pasó la hora de salida (con 15 min de margen).
function calcularAlerta(v, ahora) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (v.fecha !== hoy) return null;
  if (v.estado === "en_camino") {
    const llegada = llegadaEstimada(v);
    if (llegada && ahora.getTime() > llegada.getTime() + 10 * 60000) {
      return `Demorado ${Math.round((ahora.getTime() - llegada.getTime()) / 60000)} min sobre lo estimado`;
    }
  }
  if (v.estado === "programado") {
    const salida = salidaPlanificada(v);
    if (salida && ahora.getTime() > salida.getTime() + 15 * 60000) {
      return `Debería haber salido a las ${fmtHora(salida)}`;
    }
  }
  return null;
}

export default function ViajeCard({ viaje, esChofer, actor, onEditar }) {
  const ahora = useAhora();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [cargandoPdf, setCargandoPdf] = useState(false);
  const info = ESTADO_INFO[viaje.estado];
  const siguiente = SIGUIENTE[viaje.estado];
  const llegada = llegadaEstimada(viaje);
  const libre = libreEstimado(viaje);
  const alerta = calcularAlerta(viaje, ahora);
  const cerrado = viaje.estado === "entregado" || viaje.estado === "cancelado";

  async function verRemito() {
    setError("");
    setCargandoPdf(true);
    try {
      const pdf = await obtenerPdfRemitoViaje(viaje.id);
      if (!pdf) throw new Error("El PDF de este remito no está disponible");
      const bytes = atob(pdf.pdfBase64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      window.open(url, "_blank");
    } catch (e) {
      setError(e.message || "No se pudo abrir el remito");
    } finally {
      setCargandoPdf(false);
    }
  }

  async function avanzar() {
    if (!siguiente) return;
    setGuardando(true);
    setError("");
    try {
      await cambiarEstadoViaje(viaje.id, siguiente.estado, actor);
    } catch (e) {
      setError(e.message || "No se pudo actualizar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className={`rounded-lg border p-2 text-xs ${
        alerta
          ? "border-rose-300 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20"
          : "border-slate-200 bg-slate-50/60 dark:border-neutral-700 dark:bg-neutral-800/40"
      } ${viaje.estado === "cancelado" ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-semibold text-slate-800 dark:text-neutral-100">
          {viaje.origen.nombre} <span className="text-slate-400">→</span> {viaje.destino.nombre}
        </p>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${info.cls}`}>
          {info.icono} {info.label}
        </span>
      </div>

      {viaje.destino.direccion && (
        <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-neutral-500">📍 {viaje.destino.direccion}</p>
      )}

      <p className="mt-1 text-slate-600 dark:text-neutral-400">
        Sale {viaje.horaSalida || "—"}
        {viaje.duracionMin != null && (
          <>
            {" "}
            · viaje {fmtDuracion(viaje.duracionMin)}
            {viaje.distanciaKm != null ? ` (${viaje.distanciaKm} km)` : ""} · llega ~{fmtHora(llegada)} · libre ~{fmtHora(libre)}
          </>
        )}
      </p>

      {(viaje.saliAt || viaje.llegoAt || viaje.entregadoAt) && (
        <p className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
          {viaje.saliAt && `Salió ${fmtHora(viaje.saliAt)}`}
          {viaje.llegoAt && ` · Llegó ${fmtHora(viaje.llegoAt)}`}
          {viaje.entregadoAt && ` · Entregó ${fmtHora(viaje.entregadoAt)}`}
          {viaje.choferNombre ? ` · ${viaje.choferNombre}` : ""}
        </p>
      )}

      {!esChofer && (
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">
          👤 {viaje.choferNombre ? viaje.choferNombre : <span className="text-amber-600 dark:text-amber-400">Sin chofer asignado</span>}
        </p>
      )}

      {viaje.remito?.numero && (
        <p className="mt-0.5 text-[11px] text-sky-700 dark:text-sky-400">📄 Remito {viaje.remito.numero}</p>
      )}
      {viaje.notas && <p className="mt-0.5 text-slate-500 dark:text-neutral-400">💬 {viaje.notas}</p>}
      {alerta && <p className="mt-1 font-semibold text-rose-600 dark:text-rose-400">⚠️ {alerta}</p>}
      {error && <p className="mt-1 text-rose-500">{error}</p>}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {esChofer && siguiente && (
          <button
            type="button"
            onClick={avanzar}
            disabled={guardando}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-60 ${siguiente.cls}`}
          >
            {guardando ? "…" : siguiente.label}
          </button>
        )}
        {viaje.remito?.tienePdf && (
          <button
            type="button"
            onClick={verRemito}
            disabled={cargandoPdf}
            className="rounded-lg border border-sky-200 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-white disabled:opacity-60 dark:border-sky-900 dark:text-sky-400 dark:hover:bg-neutral-800"
          >
            {cargandoPdf ? "Abriendo…" : "📄 Ver remito"}
          </button>
        )}
        {!cerrado && (
          <a
            href={linkComoLlegar(viaje.destino)}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-white dark:border-neutral-700 dark:text-sky-400 dark:hover:bg-neutral-800"
          >
            🧭 Cómo llegar
          </a>
        )}
        {!esChofer && onEditar && (
          <button
            type="button"
            onClick={() => onEditar(viaje)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            ✏️ Editar
          </button>
        )}
      </div>
    </div>
  );
}
