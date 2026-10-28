// src/pages/admin/movimientos/CredifinMovimientos.jsx
import { useEffect, useState } from "react";
import { credifinGetCtaCte, credifinGetComprobantePdf, credifinGetGuias, getResumenComisionVendedor } from "../../../services/comprobantes";

const money = (n) => Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

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
// "Venta ENVIOS DE ART. ESPECIFICOS"), alquiler del depósito + a veces
// logística de importación —ambas vienen con Concepto "Facturacion
// Industria..." indistinguibles sin abrir el PDF, así que se agrupan
// juntas como "Almacenamiento"—, y cobranzas/cheques rechazados
// (no son cargos nuevos de flete/depósito, informativo).
function categorizar(concepto) {
  const c = concepto || "";
  if (/remitos global|ENVIOS DE ART/i.test(c)) return "flete";
  if (/Industria/i.test(c)) return "deposito";
  if (/Rechazo/i.test(c)) return "rechazo";
  if (/Cobranza/i.test(c)) return "cobranza";
  return "otros";
}
const CATEGORIAS = {
  flete: { label: "🚚 Flete (viajes del mes)" },
  deposito: { label: "📦 Almacenamiento" },
  rechazo: { label: "❌ Cheques rechazados" },
  otros: { label: "❓ Otros" },
};

// Reemplaza la carga manual viaje por viaje para Credifin: lee su cuenta
// corriente en vivo (Credifin no tiene API pública, esto sale de reversar
// su portal de autogestión, ver credifinWebAutomation.js, 26-27/10/2026),
// categoriza cada factura automático, y tira directo cuánto hay que
// pagarle — separado en flete (viajes del mes) y almacenamiento, que son
// los 2 cargos reales — más un cruce contra lo que ya está cargado en
// Cuentas corrientes → Logística para detectar si falta algo.
export default function CredifinMovimientos({ mes }) {
  const [reporte, setReporte] = useState(null);
  const [resumenSistema, setResumenSistema] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [descargandoId, setDescargandoId] = useState(null);

  const [mostrarEnvios, setMostrarEnvios] = useState(false);
  const [guias, setGuias] = useState(null);
  const [totalGuias, setTotalGuias] = useState(null);
  const [paginaGuias, setPaginaGuias] = useState(1);
  const [cargandoGuias, setCargandoGuias] = useState(false);
  const [errorGuias, setErrorGuias] = useState("");

  async function buscar() {
    if (!mes) return;
    setCargando(true);
    setError("");
    const { desde, hasta } = rangoDelMes(mes);
    try {
      const [r, sistema] = await Promise.all([
        credifinGetCtaCte(desde, hasta),
        getResumenComisionVendedor(mes, "logistica-credifin").catch(() => null),
      ]);
      setReporte(r.reporte || []);
      setResumenSistema(sistema);
    } catch (e) {
      setError(e.message || "No se pudo traer la cuenta corriente de Credifin");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

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

  const LIMIT_GUIAS = 50;
  async function buscarGuias(pagina) {
    setCargandoGuias(true);
    setErrorGuias("");
    try {
      const r = await credifinGetGuias({ page: pagina, limit: LIMIT_GUIAS });
      setGuias((prev) => (pagina === 1 ? r.guias : [...(prev || []), ...r.guias]));
      setTotalGuias(r.totalDataSize);
      setPaginaGuias(pagina);
    } catch (e) {
      setErrorGuias(e.message || "No se pudieron traer los envíos de Credifin");
    } finally {
      setCargandoGuias(false);
    }
  }

  function toggleEnvios() {
    const next = !mostrarEnvios;
    setMostrarEnvios(next);
    if (next && guias === null) buscarGuias(1);
  }

  async function descargarPdfPorComprobante(comprobantesId, label) {
    setDescargandoId(comprobantesId);
    try {
      const r = await credifinGetComprobantePdf(comprobantesId);
      descargarBase64Pdf(r.pdfBase64, `Credifin ${label || comprobantesId}.pdf`);
    } catch (e) {
      setErrorGuias(e.message || "No se pudo descargar el PDF del comprobante");
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

  const fleteCargadoEnSistema = resumenSistema?.fleteTotal ?? null;
  const diferenciaFlete = fleteCargadoEnSistema != null ? subtotales.flete - fleteCargadoEnSistema : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-sky-800 dark:text-sky-400">🧾 Facturación real de Credifin (en vivo)</p>
        <button
          onClick={buscar}
          disabled={cargando}
          className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-60 dark:border-sky-900 dark:bg-neutral-900 dark:text-sky-400"
        >
          {cargando ? "Actualizando…" : "🔄 Actualizar"}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </div>
      )}

      {cargando && reporte === null && <p className="text-sm text-slate-400 dark:text-neutral-500">Leyendo Credifin…</p>}

      {reporte && facturas.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-neutral-500">No hay facturas ese mes.</p>
      )}

      {reporte && facturas.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">{CATEGORIAS.flete.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{money(subtotales.flete)}</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">{CATEGORIAS.deposito.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{money(subtotales.deposito)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total a pagar este mes</p>
              <p className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">{money(totalFacturado)}</p>
            </div>
          </div>

          {(subtotales.rechazo > 0 || subtotales.otros > 0) && (
            <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-neutral-400">
              {subtotales.rechazo > 0 && (
                <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-400">
                  {CATEGORIAS.rechazo.label}: {money(subtotales.rechazo)}
                </span>
              )}
              {subtotales.otros > 0 && (
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-neutral-700 dark:bg-neutral-900">
                  {CATEGORIAS.otros.label}: {money(subtotales.otros)}
                </span>
              )}
            </div>
          )}

          {ultimoSaldo != null && (
            <p className="text-[11px] text-slate-400 dark:text-neutral-500">
              Saldo histórico de cuenta al cierre del mes: {money(ultimoSaldo)}
            </p>
          )}

          <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/10">
            <p className="text-xs font-bold text-sky-800 dark:text-sky-400">🔄 Cruce contra lo ya cargado en el sistema</p>
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
                    Flete ya cargado en el sistema ({resumenSistema.viajesDetalle?.length ?? 0} viaje(s))
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

      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800">
        <button
          onClick={toggleEnvios}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-bold text-sky-800 dark:text-sky-400"
        >
          <span>📦 Envíos de Credifin{totalGuias != null ? ` (${totalGuias})` : ""}</span>
          <span className="text-slate-400">{mostrarEnvios ? "▲" : "▼"}</span>
        </button>

        {mostrarEnvios && (
          <div className="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-neutral-800">
            <p className="text-[11px] text-slate-400 dark:text-neutral-500">
              Código de seguimiento real de cada envío, con link a la factura asociada cuando ya está facturado. Credifin no
              expone estado de entrega en vivo por esta vía — su buscador "Seguí tu envío" está confirmado roto en el portal.
            </p>

            {errorGuias && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                {errorGuias}
              </div>
            )}

            {cargandoGuias && guias === null && <p className="text-xs text-slate-400 dark:text-neutral-500">Leyendo envíos…</p>}

            {guias && guias.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-800">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
                      <tr>
                        <th className="px-3 py-2">Fecha</th>
                        <th className="px-3 py-2">Código</th>
                        <th className="px-3 py-2">Remito</th>
                        <th className="px-3 py-2">Destinatario</th>
                        <th className="px-3 py-2">Destino</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                      {guias.map((g) => {
                        const idFactura = g.relacion_guia_comprobantes?.comprobantes_ventas_id;
                        return (
                          <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-neutral-900/50">
                            <td className="whitespace-nowrap px-3 py-2">{g.fecha?.slice(0, 10)}</td>
                            <td className="px-3 py-2 font-mono text-xs">{g.codigo_seguimiento}</td>
                            <td className="px-3 py-2 text-xs">{g.guias_comprobantes?.map((c) => c.valor).join(", ") || "—"}</td>
                            <td className="px-3 py-2 text-xs">{g.dnombre}</td>
                            <td className="px-3 py-2 text-xs text-slate-500 dark:text-neutral-400">{g.dlocalidad}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              {idFactura ? (
                                <button
                                  onClick={() => descargarPdfPorComprobante(idFactura, g.codigo_seguimiento)}
                                  disabled={descargandoId === idFactura}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-sky-300 hover:text-sky-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
                                >
                                  {descargandoId === idFactura ? "…" : "📄 Factura"}
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400 dark:text-neutral-500">Sin facturar</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalGuias != null && guias.length < totalGuias && (
                  <button
                    onClick={() => buscarGuias(paginaGuias + 1)}
                    disabled={cargandoGuias}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-sky-300 hover:text-sky-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
                  >
                    {cargandoGuias ? "Cargando…" : `Cargar más (${guias.length} de ${totalGuias})`}
                  </button>
                )}
              </>
            )}

            {guias && guias.length === 0 && <p className="text-xs text-slate-400 dark:text-neutral-500">No hay envíos registrados.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
