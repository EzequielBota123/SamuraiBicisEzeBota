// src/pages/admin/movimientos/CredifinMovimientos.jsx
import { useState } from "react";
import { credifinGetCtaCte, credifinGetComprobantePdf } from "../../../services/comprobantes";

const money = (n) => Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

function primerDiaDelMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function descargarBase64Pdf(base64, filename) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Cuenta corriente real de FEPA TOP en Credifin (la logística que nos
// factura los envíos) — Credifin no tiene API pública para partners, esto
// sale de reversar su portal de autogestión (ver credifinWebAutomation.js
// en functions/, 26/10/2026). El PDF de cada comprobante se trae aparte,
// por NroAuxiliar — funciona aunque la sección "Comprobantes" de la cuenta
// esté bloqueada (son permisos separados en Credifin).
export default function CredifinMovimientos() {
  const [desde, setDesde] = useState(primerDiaDelMes);
  const [hasta, setHasta] = useState(hoyISO);
  const [reporte, setReporte] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [descargandoId, setDescargandoId] = useState(null);

  async function buscar() {
    setCargando(true);
    setError("");
    try {
      const r = await credifinGetCtaCte(desde, hasta);
      setReporte(r.reporte || []);
    } catch (e) {
      setError(e.message || "No se pudo traer la cuenta corriente de Credifin");
    } finally {
      setCargando(false);
    }
  }

  async function descargarPdf(fila) {
    if (!fila.NroAuxiliar) return;
    setDescargandoId(fila.NroAuxiliar);
    try {
      const r = await credifinGetComprobantePdf(fila.NroAuxiliar);
      descargarBase64Pdf(r.pdfBase64, `Credifin ${fila.Comprobante || fila.NroAuxiliar}.pdf`);
    } catch (e) {
      setError(e.message || "No se pudo descargar el PDF del comprobante");
    } finally {
      setDescargandoId(null);
    }
  }

  const ultimoSaldo = reporte && reporte.length > 0 ? reporte[reporte.length - 1].Saldo : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="text-xs text-slate-600 dark:text-neutral-400">
          Desde
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-neutral-400">
          Hasta
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />
        </label>
        <button
          onClick={buscar}
          disabled={cargando}
          className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {cargando ? "Buscando…" : "Buscar"}
        </button>
        {ultimoSaldo != null && (
          <div className="ml-auto text-right">
            <p className="text-[11px] text-slate-400 dark:text-neutral-500">Saldo al {hasta}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{money(ultimoSaldo)}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </div>
      )}

      {reporte === null && !cargando && (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Elegí un rango de fechas y tocá "Buscar".</p>
      )}

      {reporte && reporte.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-neutral-500">No hay movimientos en ese rango.</p>
      )}

      {reporte && reporte.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-neutral-800">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Comprobante</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2 text-right">Debe</th>
                <th className="px-3 py-2 text-right">Haber</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
              {reporte.map((f, i) => (
                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-neutral-900/50">
                  <td className="whitespace-nowrap px-3 py-2">{f.Fecha?.slice(0, 10)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{f.Comprobante || "—"}</td>
                  <td className="px-3 py-2">{f.Filial_Origen || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{f.Debitos ? money(f.Debitos) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{f.Creditos ? money(f.Creditos) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{money(f.Saldo)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {f.NroAuxiliar ? (
                      <button
                        onClick={() => descargarPdf(f)}
                        disabled={descargandoId === f.NroAuxiliar}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-sky-300 hover:text-sky-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
                      >
                        {descargandoId === f.NroAuxiliar ? "…" : "📄 PDF"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
