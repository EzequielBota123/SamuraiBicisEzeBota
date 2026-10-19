import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { subscribeReporteSemana, agregarEntradaReporte, eliminarEntradaReporte } from "../../services/reporteSemanal";
import { generateReporteSemanalPdf } from "../../utils/generateReporteSemanalPdf";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Lunes de la semana que contiene `d`.
function lunesDeLaSemana(d) {
  const date = new Date(d);
  const dia = date.getDay(); // 0 = domingo
  const diff = dia === 0 ? -6 : 1 - dia;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function nombreDiaCorto(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DIAS[date.getDay()]} ${d}/${m}`;
}

// Bitácora de trabajo: anotás en el momento lo que vas haciendo durante el
// día, se agrupa solo por semana (lunes a domingo), y al cerrar la semana se
// baja todo junto en PDF — mismo formato que se venía armando a mano.
export default function ReporteSemanal() {
  const { user, profile } = useAuth();
  const [inicioSemana, setInicioSemana] = useState(() => lunesDeLaSemana(new Date()));
  const [dias, setDias] = useState(null);
  const [error, setError] = useState("");
  const [texto, setTexto] = useState("");
  const [fechaEntrada, setFechaEntrada] = useState(() => toISO(new Date()));
  const [guardando, setGuardando] = useState(false);

  const finSemana = useMemo(() => {
    const d = new Date(inicioSemana);
    d.setDate(d.getDate() + 6);
    return d;
  }, [inicioSemana]);

  const desdeISO = toISO(inicioSemana);
  const hastaISO = toISO(finSemana);

  const fechasSemana = useMemo(() => {
    const arr = [];
    const d = new Date(inicioSemana);
    for (let i = 0; i < 7; i++) {
      arr.push(toISO(d));
      d.setDate(d.getDate() + 1);
    }
    return arr;
  }, [inicioSemana]);

  useEffect(() => {
    return subscribeReporteSemana(desdeISO, hastaISO, setDias, (e) => setError(e.message || String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desdeISO, hastaISO]);

  // La fecha para cargar una entrada nueva siempre arranca en "hoy" si hoy
  // cae dentro de la semana que se está viendo; si no, en el lunes de esa
  // semana — así no hace falta tocar el selector la mayoría de las veces.
  useEffect(() => {
    const hoy = toISO(new Date());
    setFechaEntrada(fechasSemana.includes(hoy) ? hoy : fechasSemana[0]);
  }, [fechasSemana]);

  const diasPorFecha = useMemo(() => {
    const map = new Map((dias || []).map((d) => [d.fecha, d.items]));
    return fechasSemana.map((fecha) => ({ fecha, items: map.get(fecha) || [] }));
  }, [dias, fechasSemana]);

  async function handleAgregar(e) {
    e.preventDefault();
    if (!texto.trim()) return;
    setGuardando(true);
    setError("");
    try {
      await agregarEntradaReporte(fechaEntrada, texto, profile?.name || user?.email || "Admin");
      setTexto("");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setGuardando(false);
    }
  }

  async function handleEliminar(fecha, item) {
    try {
      await eliminarEntradaReporte(fecha, item);
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  function handleDescargar() {
    generateReporteSemanalPdf(diasPorFecha, {
      desde: desdeISO,
      hasta: hastaISO,
      fileName: `Reporte semanal ${desdeISO} a ${hastaISO}.pdf`,
    });
  }

  function cambiarSemana(delta) {
    const d = new Date(inicioSemana);
    d.setDate(d.getDate() + delta * 7);
    setInicioSemana(d);
  }

  const hoyISO = toISO(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">📝 Reporte semanal</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Anotá lo que vas haciendo cada día. Cuando cierra la semana, descargala en PDF.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => cambiarSemana(-1)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:text-neutral-300"
          >
            ← Semana anterior
          </button>
          <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
            {desdeISO} al {hastaISO}
          </span>
          <button
            onClick={() => cambiarSemana(1)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:text-neutral-300"
          >
            Semana siguiente →
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Form de carga rápida */}
      <form onSubmit={handleAgregar} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            Día
            <select
              value={fechaEntrada}
              onChange={(e) => setFechaEntrada(e.target.value)}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal normal-case dark:border-neutral-700 dark:bg-neutral-800"
            >
              {fechasSemana.map((f) => (
                <option key={f} value={f}>
                  {nombreDiaCorto(f)}
                  {f === hoyISO ? " (hoy)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="¿Qué hiciste? Ej: corrección de stock a Saladillo, llamada con Leonor por despachos…"
          rows={2}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={guardando || !texto.trim()}
          className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {guardando ? "Guardando…" : "+ Agregar al día"}
        </button>
      </form>

      {/* Lista de la semana, día por día */}
      <div className="space-y-4">
        {dias === null && <p className="text-sm text-slate-400">Cargando…</p>}
        {dias !== null &&
          diasPorFecha.map((d) => (
            <div key={d.fecha} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <p className="mb-2 text-sm font-bold text-slate-900 dark:text-white">
                {nombreDiaCorto(d.fecha)}
                {d.fecha === hoyISO && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">HOY</span>}
              </p>
              {d.items.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-neutral-500">Sin novedades.</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.items.map((item, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 text-sm text-slate-700 dark:text-neutral-300">
                      <span>
                        <span className="mr-1.5 font-mono text-xs text-slate-400 dark:text-neutral-500">{item.hora}</span>
                        {item.texto}
                        <span className="ml-1.5 text-xs text-slate-400 dark:text-neutral-500">— {item.autor}</span>
                      </span>
                      <button
                        onClick={() => handleEliminar(d.fecha, item)}
                        className="shrink-0 text-xs text-slate-400 hover:text-rose-500"
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
      </div>

      <button
        onClick={handleDescargar}
        className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-600 transition hover:border-sky-400 hover:text-sky-700 dark:border-neutral-700 dark:text-neutral-300"
      >
        ⬇️ Descargar PDF de esta semana ({desdeISO} al {hastaISO})
      </button>
    </div>
  );
}
