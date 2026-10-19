// src/pages/admin/CuentasCorrientesLogistica.jsx
// Cuenta corriente mensual (flete + comisión) de los 3 que reparten stock
// desde depósitos que no son el suyo propio: Cuchi (su propio depósito),
// Jíbaro (sale de Cañuelas y Credifin) y Vito/Julián (maneja la camioneta
// de Rodados Argentinos). Mismo cálculo que "Mis clientes" de Cuchi —
// viajes contados en vivo desde los movimientos de stock de Contabilium —
// pero visto acá por el admin para los 3 juntos, con la tarifa/comisión de
// cada uno editable (todavía sin definir, arrancan en $0 y 0%).
import { useEffect, useState, useCallback } from "react";
import {
  getResumenComisionVendedor,
  descargarResumenVendedorExcel,
  adminSetTarifasVendedor,
} from "../../services/comprobantes";

const LOGISTICA = [
  { uid: "KGqXe3UmhqWU3AzNdZA6CobTTS33", nombre: "Cuchi" },
  { uid: "logistica-jibaro", nombre: "Jíbaro (Cañuelas / Credifin)" },
  { uid: "mzkIozuCTbg3K5tl0ft8jyQqLDx1", nombre: "Vito (Julián — camioneta de Rodados)" },
];

function descargarBase64Xlsx(base64, filename) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "resumen.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

const money = (n) =>
  n == null ? "—" : Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : `${s}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function TarjetaLogistica({ uid, nombre, mes }) {
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [comisionInput, setComisionInput] = useState("");
  const [tarifaInput, setTarifaInput] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    setError("");
    getResumenComisionVendedor(mes, uid)
      .then((r) => {
        setResumen(r);
        setComisionInput(String(r.comisionPorcentaje));
        setTarifaInput(String(r.tarifaFletePorViaje));
      })
      .catch((e) => setError(e.message || "No se pudo cargar el resumen"))
      .finally(() => setCargando(false));
  }, [uid, mes]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function descargarExcel() {
    if (!resumen) return;
    setDescargando(true);
    setError("");
    try {
      const r = await descargarResumenVendedorExcel(mes, uid);
      descargarBase64Xlsx(r.base64, r.filename);
    } catch (e) {
      setError(e.message || "No se pudo generar el Excel");
    } finally {
      setDescargando(false);
    }
  }

  async function guardarTarifas() {
    setGuardando(true);
    setError("");
    try {
      await adminSetTarifasVendedor(uid, {
        comisionPorcentaje: Number(comisionInput) || 0,
        tarifaFletePorViaje: Number(tarifaInput) || 0,
      });
      setEditando(false);
      cargar();
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-sky-800 dark:text-sky-400">🚚 {nombre}</h2>
        <div className="flex items-center gap-2">
          {resumen && !cargando && (
            <>
              <button
                onClick={() => setEditando((v) => !v)}
                className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 dark:border-sky-900 dark:bg-neutral-900 dark:text-sky-400"
              >
                {editando ? "Cancelar" : "⚙️ Tarifa/comisión"}
              </button>
              <button
                onClick={descargarExcel}
                disabled={descargando}
                className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-60 dark:border-sky-900 dark:bg-neutral-900 dark:text-sky-400"
              >
                {descargando ? "Generando…" : "⬇️ Excel"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {cargando && <p className="mt-2 text-xs text-sky-700/70 dark:text-sky-400/60">Cargando…</p>}

      {editando && resumen && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-sky-200 bg-white p-3 dark:border-sky-900 dark:bg-neutral-900">
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Comisión %
            <input
              type="number"
              min="0"
              step="0.5"
              value={comisionInput}
              onChange={(e) => setComisionInput(e.target.value)}
              className="ml-1.5 w-20 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-950 dark:text-white"
            />
          </label>
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Flete por viaje ($)
            <input
              type="number"
              min="0"
              step="500"
              value={tarifaInput}
              onChange={(e) => setTarifaInput(e.target.value)}
              className="ml-1.5 w-28 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-950 dark:text-white"
            />
          </label>
          <button
            onClick={guardarTarifas}
            disabled={guardando}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}

      {resumen && !cargando && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Flete ({resumen.viajes} viaje{resumen.viajes === 1 ? "" : "s"} × {money(resumen.tarifaFletePorViaje)})</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.fleteTotal)}</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Ventas de sus clientes</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.ventasTotal)}</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">Comisión ({resumen.comisionPorcentaje}%)</p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.comisionTotal)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total a pagar</p>
              <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{money(resumen.totalACobrar)}</p>
            </div>
          </div>

          {resumen.detalle.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold text-sky-800 dark:text-sky-400">
                🚲 Ventas de sus clientes este mes ({resumen.comisionPorcentaje}% de comisión cada una)
              </p>
              <div className="overflow-x-auto rounded-xl border border-sky-100 dark:border-sky-900/50">
                <table className="min-w-full divide-y divide-sky-100 text-xs dark:divide-sky-900/50">
                  <thead className="bg-sky-50/60 dark:bg-sky-950/20">
                    <tr className="text-left text-slate-500 dark:text-neutral-400">
                      <th className="px-3 py-2 font-semibold">Fecha</th>
                      <th className="px-3 py-2 font-semibold">Cliente</th>
                      <th className="px-3 py-2 font-semibold">Modelo</th>
                      <th className="px-3 py-2 font-semibold">Cant.</th>
                      <th className="px-3 py-2 font-semibold text-right">Monto</th>
                      <th className="px-3 py-2 font-semibold text-right">Comisión</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sky-50 bg-white dark:divide-sky-950/30 dark:bg-neutral-900">
                    {resumen.detalle.map((d, i) => (
                      <tr key={i} className={d.tipo === "NCA" ? "text-rose-600 dark:text-rose-400" : ""}>
                        <td className="whitespace-nowrap px-3 py-1.5">{formatFecha(d.fecha)}</td>
                        <td className="px-3 py-1.5">{d.cliente}</td>
                        <td className="px-3 py-1.5">
                          {d.modelo}
                          {d.tipo === "NCA" && <span className="ml-1 text-[10px] font-semibold">(N. Crédito)</span>}
                        </td>
                        <td className="px-3 py-1.5">{d.cantidad ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">{money(d.monto)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">{money(d.comision)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CuentasCorrientesLogistica() {
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Cuentas corrientes — Logística</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Flete y comisión de Cuchi, Jíbaro y Vito, calculado en vivo desde los movimientos de stock reales.
          </p>
        </div>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
      </div>

      {LOGISTICA.map((v) => (
        <TarjetaLogistica key={v.uid} uid={v.uid} nombre={v.nombre} mes={mes} />
      ))}
    </div>
  );
}
