import { useEffect, useState } from "react";
import { getVendedorClienteDetalle } from "../../services/comprobantes";

const money = (n) =>
  n == null ? "—" : Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(s) {
  if (!s) return "-";
  const d = new Date(String(s).includes("T") ? s : `${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Los Timestamp de Firestore que vienen del backend por HTTP (no por el SDK
// en vivo) llegan serializados como { _seconds, _nanoseconds }, sin el
// método .toDate() — este helper los acepta en cualquiera de las dos formas.
function formatTimestamp(ts) {
  if (!ts) return "-";
  if (typeof ts.toDate === "function") return formatFecha(ts.toDate().toISOString());
  if (typeof ts._seconds === "number") return formatFecha(new Date(ts._seconds * 1000).toISOString());
  return formatFecha(ts);
}

function Seccion({ titulo, children }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400">{titulo}</p>
      {children}
    </div>
  );
}

// Detalle completo de solo lectura de uno de los clientes propios de un
// distribuidor con equipo (ej. Cuchi) — mismo nivel de información que
// Clientes 360 ve en el admin, pero sin tener que salir de su propia cuenta.
// Todo sale de un solo pedido (getVendedorClienteDetalle), que el backend
// ya valida que el cliente pedido esté en su propia cartera.
export default function ClienteDetalleCompletoModal({ clienteUid, nombre, onClose }) {
  const [detalle, setDetalle] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDetalle(null);
    setError("");
    getVendedorClienteDetalle(clienteUid)
      .then(setDetalle)
      .catch((e) => setError(e.message || "No se pudo cargar el detalle"));
  }, [clienteUid]);

  return (
    <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white"
        >
          ✕
        </button>
        <h2 className="pr-10 text-lg font-bold text-slate-900 dark:text-white">{nombre || "Cliente"}</h2>
        <p className="text-xs text-slate-400 dark:text-neutral-500">Detalle completo, solo lectura</p>

        {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!detalle && !error && <p className="mt-4 text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}

        {detalle && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-3 dark:border-neutral-700">
                <p className="text-[11px] text-slate-400 dark:text-neutral-500">Saldo</p>
                <p className={`text-base font-bold ${detalle.saldoTotal > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {money(detalle.saldoTotal)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 dark:border-neutral-700">
                <p className="text-[11px] text-slate-400 dark:text-neutral-500">Facturas</p>
                <p className="text-base font-bold text-slate-900 dark:text-white">{detalle.comprobantes.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 dark:border-neutral-700">
                <p className="text-[11px] text-slate-400 dark:text-neutral-500">Ítems en stock</p>
                <p className="text-base font-bold text-slate-900 dark:text-white">{detalle.stock.length}</p>
              </div>
            </div>

            {(detalle.telefono || detalle.celular || detalle.ciudad) && (
              <Seccion titulo="Contacto">
                <p className="text-sm text-slate-700 dark:text-neutral-300">
                  {detalle.telefono && <>Tel: {detalle.telefono} · </>}
                  {detalle.celular && <>Cel: {detalle.celular} · </>}
                  {[detalle.ciudad, detalle.provincia].filter(Boolean).join(", ")}
                </p>
              </Seccion>
            )}

            <Seccion titulo={`Stock consignado (${detalle.stock.length})`}>
              {detalle.stock.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Sin stock.</p>
              ) : (
                <div className="space-y-1">
                  {detalle.stock.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-neutral-300">{s.name}</span>
                      <span className="shrink-0 font-semibold text-slate-900 dark:text-white">× {s.stockDisponible ?? s.stockActual}</span>
                    </div>
                  ))}
                </div>
              )}
            </Seccion>

            <Seccion titulo={`Facturas (${detalle.comprobantes.length})`}>
              {detalle.comprobantes.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Sin facturas.</p>
              ) : (
                <div className="space-y-1">
                  {detalle.comprobantes.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-slate-600 dark:text-neutral-300">
                        {c.Tipo} {c.Numero} · {formatFecha(c.Fecha)}
                      </span>
                      <span className="text-slate-700 dark:text-neutral-300">
                        {money(c.Total)}{" "}
                        <span className={Number(c.Saldo) > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}>
                          ({money(c.Saldo)})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Seccion>

            <Seccion titulo={`Cobranzas (${detalle.cobranzas.length})`}>
              {detalle.cobranzas.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Sin cobranzas.</p>
              ) : (
                <div className="space-y-1">
                  {detalle.cobranzas.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 dark:text-neutral-300">{formatFecha(c.fecha)}</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{money(c.importeReal ?? c.importeTotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Seccion>

            {detalle.ventasReportadas.length > 0 && (
              <Seccion titulo={`Ventas reportadas (${detalle.ventasReportadas.length})`}>
                <div className="space-y-1">
                  {detalle.ventasReportadas.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-neutral-300">{v.name || v.sku} × {v.quantity}</span>
                      <span className="text-slate-500 dark:text-neutral-400">{v.status}</span>
                    </div>
                  ))}
                </div>
              </Seccion>
            )}

            {detalle.pagosReportados.length > 0 && (
              <Seccion titulo={`Comprobantes de pago reportados (${detalle.pagosReportados.length})`}>
                <div className="space-y-1">
                  {detalle.pagosReportados.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-neutral-300">{formatFecha(p.fecha)}</span>
                      <span className="text-slate-900 dark:text-white">{money(p.monto)} · {p.estado}</span>
                    </div>
                  ))}
                </div>
              </Seccion>
            )}

            {detalle.audits.length > 0 && (
              <Seccion titulo={`Videos de auditoría (${detalle.audits.length})`}>
                <div className="space-y-1">
                  {detalle.audits.map((a) => (
                    <p key={a.id} className="text-sm text-slate-600 dark:text-neutral-300">
                      {formatTimestamp(a.createdAt)}
                    </p>
                  ))}
                </div>
              </Seccion>
            )}

            {detalle.notasEntrega.length > 0 && (
              <Seccion titulo={`Notas del chofer (${detalle.notasEntrega.length})`}>
                <div className="space-y-1">
                  {detalle.notasEntrega.map((n) => (
                    <p key={n.id} className="text-sm text-slate-600 dark:text-neutral-300">
                      {formatTimestamp(n.createdAt)} — {n.texto}
                    </p>
                  ))}
                </div>
              </Seccion>
            )}
          </>
        )}
      </div>
    </div>
  );
}
