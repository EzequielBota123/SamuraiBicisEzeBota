// src/pages/admin/CuentasCorrientesLogistica.jsx
// Cuenta corriente mensual de los que reparten stock desde depósitos que no
// son el suyo propio: Cuchi cobra flete por viaje + comisión sobre lo que
// facturan sus clientes asignados (tiene cartera propia). Jíbaro, Credifin
// y Vito/Julián son solo logística — cobran flete por viaje, sin comisión
// (no tienen clientes propios asignados). Viajes contados en vivo desde los
// movimientos de stock de Contabilium, igual mecanismo para los 4.
import { useEffect, useState, useCallback } from "react";
import {
  getResumenComisionVendedor,
  descargarResumenVendedorExcel,
  adminSetTarifasVendedor,
  adminGuardarMontoViajeLogistica,
} from "../../services/comprobantes";
import InformeCompletoVendedorPanel from "../../components/admin/InformeCompletoVendedorPanel";
import CredifinMovimientos from "./movimientos/CredifinMovimientos";

const LOGISTICA = [
  { uid: "KGqXe3UmhqWU3AzNdZA6CobTTS33", nombre: "Cuchi", soloFlete: false },
  { uid: "logistica-jibaro", nombre: "Jíbaro (Cañuelas)", soloFlete: true },
  { uid: "logistica-credifin", nombre: "Credifin", soloFlete: true },
  { uid: "mzkIozuCTbg3K5tl0ft8jyQqLDx1", nombre: "Vito (Julián — camioneta de Rodados)", soloFlete: true },
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

// Jíbaro: cobra 3.5% de la carga pero el monto puntual hay que
// consultárselo viaje por viaje — una fila editable por cada viaje
// detectado, en vez de una tarifa fija.
function FilaViajeManual({ uid, viaje, onGuardado }) {
  const [monto, setMonto] = useState(viaje.monto != null ? String(viaje.monto) : "");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await adminGuardarMontoViajeLogistica(uid, viaje.id, Number(monto) || 0);
      onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <tr className={viaje.monto == null ? "bg-amber-50 dark:bg-amber-950/10" : ""}>
      <td className="whitespace-nowrap px-3 py-1.5">{formatFecha(viaje.fecha)}</td>
      <td className="px-3 py-1.5">{viaje.destino}</td>
      <td className="px-3 py-1.5 text-right">{viaje.bicis}</td>
      <td className="px-3 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <input
            type="number"
            min="0"
            step="100"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="Monto real"
            className="w-28 rounded-lg border border-sky-200 bg-white px-2 py-1 text-right text-xs dark:border-sky-900 dark:bg-neutral-950 dark:text-white"
          />
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {guardando ? "…" : "✓"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function TarjetaLogistica({ uid, nombre, mes, soloFlete }) {
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [comisionInput, setComisionInput] = useState("");
  const [tarifaInput, setTarifaInput] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verInformeCompleto, setVerInformeCompleto] = useState(false);
  const esCredifin = uid === "logistica-credifin";

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
                {descargando ? "Generando…" : "⬇️ Excel (mes)"}
              </button>
              <button
                onClick={() => setVerInformeCompleto((v) => !v)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  verInformeCompleto
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:bg-neutral-900 dark:text-indigo-400"
                }`}
              >
                {verInformeCompleto ? "✕ Cerrar informe completo" : "📦 Informe completo (todo)"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {cargando && <p className="mt-2 text-xs text-sky-700/70 dark:text-sky-400/60">Cargando…</p>}

      {editando && resumen && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-sky-200 bg-white p-3 dark:border-sky-900 dark:bg-neutral-900">
          {!soloFlete && (
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
          )}
          {!resumen.modoFleteManual && (
            <label className="text-xs text-slate-600 dark:text-neutral-300">
              Flete por unidad ($)
              <input
                type="number"
                min="0"
                step="500"
                value={tarifaInput}
                onChange={(e) => setTarifaInput(e.target.value)}
                className="ml-1.5 w-28 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-950 dark:text-white"
              />
            </label>
          )}
          <button
            onClick={guardarTarifas}
            disabled={guardando}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}

      {esCredifin && !cargando && (
        <div className="mt-4">
          <CredifinMovimientos mes={mes} />
        </div>
      )}

      {resumen && !cargando && !esCredifin && (
        <>
          <div className={`mt-4 grid grid-cols-2 gap-3 ${soloFlete ? "" : "sm:grid-cols-4"}`}>
            <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">
                {resumen.modoFleteManual
                  ? `Flete (${resumen.viajesDetalle.length} viaje${resumen.viajesDetalle.length === 1 ? "" : "s"}, cargado a mano)`
                  : `Flete (${resumen.unidadesEntregadas ?? 0} bici${(resumen.unidadesEntregadas ?? 0) === 1 ? "" : "s"} × ${money(resumen.tarifaFletePorViaje)})`}
              </p>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.fleteTotal)}</p>
            </div>
            {!soloFlete && (
              <>
                <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400">Ventas de sus clientes</p>
                  <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.ventasTotal)}</p>
                  <p className="text-[11px] text-slate-400 dark:text-neutral-500">De eso, cobrado: {money(resumen.ventasCobradas)}</p>
                </div>
                <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400">Comisión ({resumen.comisionPorcentaje}%)</p>
                  <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.comisionTotal)}</p>
                </div>
              </>
            )}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total a pagar</p>
              <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{money(resumen.totalACobrar)}</p>
            </div>
          </div>

          {resumen.modoFleteManual && resumen.viajesDetalle.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold text-sky-800 dark:text-sky-400">
                🚚 Viajes de este mes — cargá lo que {nombre} cobró por cada uno según su factura real
              </p>
              <div className="overflow-x-auto rounded-xl border border-sky-100 dark:border-sky-900/50">
                <table className="min-w-full divide-y divide-sky-100 text-xs dark:divide-sky-900/50">
                  <thead className="bg-sky-50/60 dark:bg-sky-950/20">
                    <tr className="text-left text-slate-500 dark:text-neutral-400">
                      <th className="px-3 py-2 font-semibold">Fecha</th>
                      <th className="px-3 py-2 font-semibold">Destino</th>
                      <th className="px-3 py-2 font-semibold text-right">Bicis</th>
                      <th className="px-3 py-2 font-semibold text-right">Monto cobrado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sky-50 bg-white dark:divide-sky-950/30 dark:bg-neutral-900">
                    {resumen.viajesDetalle.map((v) => (
                      <FilaViajeManual key={v.id} uid={uid} viaje={v} onGuardado={cargar} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!soloFlete && resumen.detalle.length > 0 && (
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
                      <th className="px-3 py-2 font-semibold text-center">Cobrada</th>
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
                        <td className="whitespace-nowrap px-3 py-1.5 text-center">
                          {d.pagada ? (
                            <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">sin cobrar</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">
                          {money(d.comision)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {verInformeCompleto && (
        <div className="mt-4">
          <InformeCompletoVendedorPanel vendedorUid={uid} />
        </div>
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
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </div>
      </div>

      {LOGISTICA.map((v) => (
        <TarjetaLogistica key={v.uid} uid={v.uid} nombre={v.nombre} mes={mes} soloFlete={v.soloFlete} />
      ))}
    </div>
  );
}
