// src/pages/admin/Settings.jsx
import { useEffect, useState } from "react";
import { subscribeDollarConfig, saveDollarConfig } from "../../services/dollarConfig";

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [manualInput, setManualInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = subscribeDollarConfig((cfg) => {
      setConfig(cfg);
      if (cfg.mode === "manual") {
        setManualInput(cfg.manualValue > 0 ? String(cfg.manualValue) : "");
      }
    });
    return unsub;
  }, []);

  async function handleToggleEnabled() {
    if (!config) return;
    const newMode = config.mode === "disabled" ? "auto" : "disabled";
    setSaving(true);
    setError("");
    try {
      await saveDollarConfig({ mode: newMode });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!config) return;
    const newMode = config.mode === "auto" ? "manual" : "auto";
    setSaving(true);
    setError("");
    try {
      await saveDollarConfig({ mode: newMode });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveManual() {
    const val = parseFloat(manualInput);
    if (!Number.isFinite(val) || val <= 0) {
      setError("Ingresá un valor numérico válido mayor a 0.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveDollarConfig({ mode: "manual", manualValue: val });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("No se pudo guardar el valor.");
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </div>
    );
  }

  const isEnabled = config.mode !== "disabled";
  const isAuto = config.mode === "auto";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Configuración</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Ajustes del sistema para el panel de administración.</p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_40px_-25px_rgba(15,23,42,0.15)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white">
            <DollarIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Cotización del dólar</h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">Controlá si el dólar se actualiza automáticamente o usás un valor fijo.</p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {/* Toggle activar/desactivar */}
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-white">Mostrar precios en dólares</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                {isEnabled
                  ? "El catálogo muestra precios en ARS y USD."
                  : "El catálogo muestra solo precios en ARS sin conversión."}
              </p>
            </div>
            <button
              onClick={handleToggleEnabled}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-60 ${
                isEnabled ? "bg-sky-500" : "bg-slate-300 dark:bg-neutral-700"
              }`}
              role="switch"
              aria-checked={isEnabled}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Toggle auto/manual (solo cuando está activo) */}
          {isEnabled && (
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-white">Actualizar dólar automáticamente</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                {isAuto ? "Se obtiene de BCRA / Bluelytics en tiempo real." : "El valor manual que ingreses será el que se use."}
              </p>
            </div>
            <button
              onClick={handleToggle}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-60 ${
                isAuto ? "bg-sky-500" : "bg-slate-300 dark:bg-neutral-700"
              }`}
              role="switch"
              aria-checked={isAuto}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isAuto ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          )}

          {/* Current auto value (always visible) */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
            <p className="text-xs text-slate-500 dark:text-neutral-400">Último valor automático guardado</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
              {config.lastAutoValue > 0
                ? `$${Number(config.lastAutoValue).toLocaleString("es-AR", { minimumFractionDigits: 2 })} ARS/USD`
                : "Sin datos aún"}
            </p>
            {config.lastAutoDate && config.lastAutoDate !== "manual" && (
              <p className="text-xs text-slate-400 dark:text-neutral-500">
                Actualizado:{" "}
                {new Intl.DateTimeFormat("es-AR").format(new Date(config.lastAutoDate))}
              </p>
            )}
          </div>

          {/* Manual input (only when manual mode) */}
          {!isAuto && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Valor manual del dólar</p>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 dark:text-neutral-500">$</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={manualInput}
                    onChange={(e) => { setManualInput(e.target.value); setError(""); }}
                    placeholder="Ej: 1250.50"
                    className="w-full rounded-xl border border-amber-300 bg-white pl-7 pr-4 py-2.5 text-sm text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-400/40 dark:border-amber-500/40 dark:bg-neutral-900 dark:text-white"
                  />
                </div>
                <button
                  onClick={handleSaveManual}
                  disabled={saving}
                  className="inline-flex items-center rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Guardando
                    </span>
                  ) : "Guardar"}
                </button>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Este valor reemplaza completamente la cotización automática. El catálogo lo usará hasta que vuelvas al modo automático.
              </p>
            </div>
          )}

          {/* Feedback messages */}
          {saved && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
              Configuración guardada correctamente.
            </div>
          )}
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              {error}
            </div>
          )}

          {/* Current mode badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-neutral-400">Modo activo:</span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isAuto ? "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400" : "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
            }`}>
              {isAuto ? "AUTOMÁTICO" : "MANUAL"}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}

function DollarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
