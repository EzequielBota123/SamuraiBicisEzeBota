// src/pages/admin/movimientos/CredifinMovimientos.jsx
import { useState } from "react";
import { credifinGetCtaCte, credifinGetComprobantePdf, getResumenComisionVendedor } from "../../../services/comprobantes";

const money = (n) => Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}
function rangoDelMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  const desde = `${mes}-01`;
  const hasta = new Date(y, m, 0).toISOString().slice(0, 10); // último día del mes
  return { desde, hasta };
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

// Credifin factura 3 cosas bien distintas bajo el mismo "Concepto" (visto en
// vivo, 27/10/2026): entregas a clientes ("Venta Fact. de remitos global" /
// "Venta ENVIOS DE ART. ESPECIFICOS"), alquiler del depósito + logística de
// importación —ambas vienen con Concepto "Facturacion Industria..."
// indistinguibles sin abrir el PDF, así que se agrupan juntas—, y
// cobranzas/cheques rechazados (no son cargos nuevos, informativo).
function categorizar(concepto) {
  const c = concepto || "";
  if (/remitos global|ENVIOS DE ART/i.test(c)) return "flete";
  if (/Industria/i.test(c)) return "deposito";
  if (/Rechazo/i.test(c)) return "rechazo";
  if (/Cobranza/i.test(c)) return "cobranza";
  return "otros";
}
const CATEGORIAS = {
  flete: { label: "🚚 Flete (entregas a clientes)", color: "sky" },
  deposito: { label: "📦 Depósito + importación", color: "amber" },
  rechazo: { label: "❌ Cheques rechazados", color: "rose" },
  otros: { label: "❓ Otros", color: "slate" },
};

// Cuenta corriente real de FEPA TOP en Credifin (la logística que nos
// factura envíos, depósito e importación) — Credifin no tiene API pública,
// esto sale de reversar su portal de autogestión (ver
// credifinWebAutomation.js, 26-27/10/2026). Lee en vivo, categoriza
// automático por tipo de cargo, y cruza el total de flete contra lo que ya
// está cargado en Cuentas corrientes → Logística (mismos viajes de
// Contabilium) para avisar si falta cargar algo ahí.
export default function CredifinMovimientos() {
  const [mes, setMes] = useState(mesActual);
  const [reporte, setReporte] = useState(null);
  const [cargandoEnSistema, setCargandoEnSistema] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [descargandoId, setDescargandoId] = useState(null);

  async function buscar() {
    setCargando(true);
    setError("");
    const { desde, hasta } = rangoDelMes(mes);
    try {
      const [r, sistema] = await Promise.all([
        credifinGetCtaCte(desde, hasta),
        getResumenComisionVendedor(mes, "logistica-credifin").catch(() => null),
      ]);
      setReporte(r.reporte || []);
      setCargandoEnSistema(sistema);
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

  const facturas = (reporte || []).filter((f) => f.Comprobante && f.Comprobante.trim());
  const subtotales = { flete: 0, deposito: 0, rechazo: 0, otros: 0 };
  for (const f of facturas) {
    subtotales[categorizar(f.Concepto)] += f.Debitos || 0;
  }
  const totalFacturado = Object.values(subtotales).reduce((a, b) => a + b, 0);
  const ultimoSaldo = reporte && reporte.length > 0 ? reporte[reporte.length - 1].Saldo : null;

  const fleteCargadoEnSistema = cargandoEnSistema?.fleteTotal ?? null;
  const diferenciaFlete = fleteCargadoEnSistema != null ? subtotales.flete - fleteCargadoEnSistema : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="text-xs text-slate-600 dark:text-neutral-400">
          Mes
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
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
            <p className="text-[11px] text-slate-400 dark:text-neutral-500">Saldo de cuenta (histórico) al cierre del mes</p>
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
        <p className="text-sm text-slate-400 dark:text-neutral-500">Elegí un mes y tocá "Buscar".</p>
      )}

      {reporte && facturas.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-neutral-500">No hay facturas ese mes.</p>
      )}

      {reporte && facturas.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Object.entries(CATEGORIAS).map(([key, { label }]) => (
              <div key={key} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-[11px] text-slate-500 dark:text-neutral-400">{label}</p>
                <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{money(subtotales[key])}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total facturado este mes</p>
              <p className="mt-1 text-sm font-bold text-emerald-700 dark:text-emerald-400">{money(totalFacturado)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/10">
            <p className="text-xs font-bold text-sky-800 dark:text-sky-400">🔄 Cruce contra "Cuentas corrientes — Logística"</p>
            {fleteCargadoEnSistema == null ? (
              <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">No se pudo traer lo cargado en el sistema para este mes.</p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400">Flete facturado por Credifin</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{money(subtotales.flete)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400">
                    Flete cargado en el sistema ({cargandoEnSistema.viajesDetalle?.length ?? 0} viaje(s))
                  </p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{money(fleteCargadoEnSistema)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400">Diferencia</p>
                  <p className={`text-sm font-bold ${Math.abs(diferenciaFlete) < 1 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {money(diferenciaFlete)}
                    {Math.abs(diferenciaFlete) >= 1 && " — falta cargar"}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-neutral-800">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Comprobante</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Concepto</th>
                  <th className="px-3 py-2 text-right">Debe</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {facturas.map((f, i) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-neutral-900/50">
                    <td className="whitespace-nowrap px-3 py-2">{f.Fecha?.slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{f.Comprobante || "—"}</td>
                    <td className="px-3 py-2 text-xs">{CATEGORIAS[categorizar(f.Concepto)].label}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-neutral-400">{f.Concepto}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{f.Debitos ? money(f.Debitos) : "—"}</td>
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
        </>
      )}
    </div>
  );
}
