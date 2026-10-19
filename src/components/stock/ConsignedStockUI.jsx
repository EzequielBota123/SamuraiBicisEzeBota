import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { limpiarNombreBici, extraerTalle } from "../../utils/bikeName";

// Elige un tamaño de fuente en base al largo del texto, en vez de vw
// (vw se mide contra toda la ventana, no contra el ancho real de la columna,
// así que con paneles angostos un número largo igual se salía del cuadro).
function fitTextClass(text, size = "lg") {
  const len = String(text).length;
  const scale = size === "sm"
    ? ["text-sm", "text-base sm:text-lg", "text-lg sm:text-xl", "text-xl sm:text-2xl", "text-2xl sm:text-3xl"]
    : ["text-base sm:text-lg", "text-lg sm:text-xl", "text-xl sm:text-2xl", "text-2xl sm:text-3xl", "text-3xl sm:text-4xl"];
  if (len > 15) return scale[0];
  if (len > 12) return scale[1];
  if (len > 9) return scale[2];
  if (len > 6) return scale[3];
  return scale[4];
}

export function StatsBanner({ title, totalBicicletas, totalDebido, money, cuentaCorrienteHref = "/mis-pedidos" }) {
  const totalLabel = money(totalDebido);
  return (
    <div className="mb-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none sm:mb-7">
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-800/40 sm:px-7">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-neutral-700">
          <BikeGlyph className="h-4 w-4" />
        </span>
        <h3 className="text-base font-bold text-slate-900 dark:text-white sm:text-lg">{title}</h3>
      </div>
      <div className="grid grid-cols-1 divide-y divide-slate-100 dark:divide-neutral-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="min-w-0 overflow-hidden p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">Consignadas</p>
          <p className={`mt-1.5 truncate font-black leading-tight text-sky-600 dark:text-sky-400 ${fitTextClass(totalBicicletas)}`}>
            {totalBicicletas}
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400 sm:text-sm">
            unidad{totalBicicletas === 1 ? "" : "es"} disponible{totalBicicletas === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 overflow-hidden p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Total a pagar</p>
            <p className={`mt-1.5 truncate font-black leading-tight text-emerald-600 dark:text-emerald-400 ${fitTextClass(totalLabel)}`} title={totalLabel}>
              {totalLabel}
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400 sm:text-sm">precio × stock disponible</p>
          </div>
          <Link
            to={cuentaCorrienteHref}
            className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 sm:py-1.5"
          >
            Ver cuenta corriente →
          </Link>
        </div>
      </div>
    </div>
  );
}

export function BikeCard({ item, onSelect, money }) {
  const subtotal = Number(item.priceArs || 0) * Number(item.stockDisponible || 0);
  const subtotalLabel = money(subtotal);
  const nombreLimpio = limpiarNombreBici(item.name);
  const talle = extraerTalle(item.name);
  return (
    <button
      onClick={onSelect}
      className="group relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-left shadow-sm shadow-slate-200/60 transition hover:-translate-y-1 hover:border-sky-300 hover:shadow-xl hover:shadow-slate-200"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-50">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-contain p-4 transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">Sin imagen</div>
        )}
        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur">
          SKU {item.sku}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
        <div>
          <p className="line-clamp-2 text-lg font-bold leading-snug text-slate-900 sm:text-xl">{nombreLimpio}</p>
          {talle && (
            <span className="mt-1.5 inline-flex items-center rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-700">
              Talle {talle}
            </span>
          )}
        </div>
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Disponibles</p>
            <div className="flex items-baseline gap-2">
              <p className={`truncate font-black text-emerald-600 ${fitTextClass(item.stockDisponible)}`}>{item.stockDisponible}</p>
              {item.pendienteVenta > 0 && (
                <span
                  title={`${item.pendienteVenta} unidad(es) reportada(s) como vendida(s), esperando que Samurai las facture`}
                  className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500"
                >
                  +{item.pendienteVenta} vendida{item.pendienteVenta === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          {item.priceArs != null && (
            <div className="min-w-0 overflow-hidden text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Subtotal</p>
              <p className={`truncate font-bold text-slate-900 ${fitTextClass(subtotalLabel, "sm")}`} title={subtotalLabel}>{subtotalLabel}</p>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export function ItemModal({ item, onClose, money, onReportSale, onRequestMore, distributorName, depositoNombre, onAjustarStock }) {
  const [qty, setQty] = useState(1);
  const [tipoDocumento, setTipoDocumento] = useState("FCA");
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState(false);
  const [reportedTipo, setReportedTipo] = useState("FCA");

  const [moreQty, setMoreQty] = useState(1);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requested, setRequested] = useState(false);

  const [ajusteCantidad, setAjusteCantidad] = useState(1);
  const [ajusteTipo, setAjusteTipo] = useState("M");
  const [ajustando, setAjustando] = useState(false);
  const [ajusteError, setAjusteError] = useState("");
  const [ajusteOk, setAjusteOk] = useState(false);

  useEffect(() => {
    setQty(1);
    setTipoDocumento("FCA");
    setReporting(false);
    setReportError("");
    setReported(false);
    setMoreQty(1);
    setRequesting(false);
    setRequestError("");
    setRequested(false);
  }, [item?.id, item?.sku]);

  if (!item) return null;
  const subtotal = Number(item.priceArs || 0) * Number(item.stockDisponible || 0);

  async function handleReportSale() {
    setReporting(true);
    setReportError("");
    try {
      const result = await onReportSale({
        sku: item.sku,
        name: item.name,
        category: item.category,
        imageUrl: item.imageUrl,
        quantity: qty,
        unitPrice: item.priceArs,
        tipoDocumento,
      });
      setReportedTipo(result?.tipoDocumentoEmitido || null);
      setReported(true);
    } catch (e) {
      setReportError(e.message || "No se pudo registrar la venta");
    } finally {
      setReporting(false);
    }
  }

  async function handleAjustarStock() {
    setAjustando(true);
    setAjusteError("");
    try {
      await onAjustarStock({ sku: item.sku, cantidad: ajusteCantidad, tipoModificacion: ajusteTipo });
      setAjusteOk(true);
    } catch (e) {
      setAjusteError(e.message || "No se pudo ajustar el stock");
    } finally {
      setAjustando(false);
    }
  }

  async function handleRequestMore() {
    setRequesting(true);
    setRequestError("");
    try {
      await onRequestMore({
        id: item.id,
        sku: item.sku,
        name: item.name,
        priceArs: item.priceArs,
        quantity: moreQty,
      });
      setRequested(true);
    } catch (e) {
      setRequestError(e.message || "No se pudo enviar el pedido");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="sticky top-4 float-right mr-4 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-200"
          onClick={onClose}
        >
          Cerrar
        </button>
        <div className="flex flex-col gap-6 p-6">
          <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-50">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">Sin imagen</div>
            )}
          </div>
          <div className="space-y-3">
            <h3 className="text-2xl font-semibold text-slate-900">{item.name}</h3>
            <div className="flex flex-wrap gap-3 text-xs text-slate-600">
              <span className="rounded-full bg-slate-50 px-3 py-1.5 font-medium">SKU: {item.sku}</span>
              {item.category && (
                <span className="rounded-full bg-slate-50 px-3 py-1.5 font-medium">Categoría: {item.category}</span>
              )}
            </div>
            {item.description && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{item.description}</p>
            )}
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs text-slate-500">Disponibles</p>
                <p className={`truncate font-bold text-emerald-600 ${fitTextClass(item.stockDisponible, "sm")}`}>{item.stockDisponible}</p>
                {item.pendienteVenta > 0 && (
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                    +{item.pendienteVenta} vendida{item.pendienteVenta === 1 ? "" : "s"} (sin facturar)
                  </p>
                )}
              </div>
              {item.priceArs != null && (
                <>
                  <div className="min-w-0 overflow-hidden">
                    <p className="text-xs text-slate-500">Precio unitario</p>
                    <p className={`truncate font-bold text-slate-900 ${fitTextClass(money(item.priceArs), "sm")}`} title={money(item.priceArs)}>{money(item.priceArs)}</p>
                  </div>
                  <div className="min-w-0 overflow-hidden">
                    <p className="text-xs text-slate-500">Subtotal</p>
                    <p className={`truncate font-bold text-slate-900 ${fitTextClass(money(subtotal), "sm")}`} title={money(subtotal)}>{money(subtotal)}</p>
                  </div>
                </>
              )}
            </div>

            {onReportSale && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {reported ? (
                  <div className="rounded-xl bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-600">
                      {reportedTipo ? `✓ Venta registrada y facturada (${reportedTipo === "COT" ? "COT" : "Factura"})` : "✓ Venta registrada"}
                    </p>
                    <p className="mt-1 text-xs text-emerald-700">
                      {reportedTipo
                        ? "Ya le emitimos el comprobante a Samurai en Contabilium, no hace falta que hagas nada más."
                        : "Ya le avisamos a Samurai, pero no pudimos facturarla sola en el momento — la van a facturar ellos a mano en breve."}
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="mb-1 text-sm font-semibold text-slate-900">¿Vendiste esta unidad?</p>
                    <p className="mb-3 text-xs text-slate-500">
                      Al confirmar, se factura sola en el momento. Reportala <strong>una sola vez por unidad vendida</strong>.
                    </p>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setTipoDocumento("FCA")}
                        className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                          tipoDocumento === "FCA" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <span className="block font-semibold">Factura</span>
                        <span className="block opacity-80">Genera cuenta corriente</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTipoDocumento("COT")}
                        className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                          tipoDocumento === "COT" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <span className="block font-semibold">COT</span>
                        <span className="block opacity-80">Solo mueve la bici, sin cuenta corriente</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs font-medium text-slate-500">Cantidad</label>
                      <input
                        type="number"
                        min={1}
                        max={item.stockDisponible}
                        value={qty}
                        onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                      />
                      <button
                        type="button"
                        disabled={reporting || qty > item.stockDisponible}
                        onClick={handleReportSale}
                        className="ml-auto rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-60"
                      >
                        {reporting ? "Registrando…" : "Marqué como vendida"}
                      </button>
                    </div>
                    {reportError && <p className="mt-2 text-xs text-rose-500">{reportError}</p>}
                  </>
                )}
              </div>
            )}

            {onRequestMore && (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                {requested ? (
                  <p className="text-sm font-semibold text-sky-700">
                    ✓ Pedido enviado a Samurai.
                  </p>
                ) : (
                  <>
                    <p className="mb-3 text-sm font-semibold text-slate-900">¿Necesitás pedir más?</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs font-medium text-slate-500">Cantidad</label>
                      <input
                        type="number"
                        min={1}
                        value={moreQty}
                        onChange={(e) => setMoreQty(Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                      />
                      <button
                        type="button"
                        disabled={requesting}
                        onClick={handleRequestMore}
                        className="ml-auto rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-60"
                      >
                        {requesting ? "Enviando…" : "Pedir más stock"}
                      </button>
                    </div>
                    {requestError && <p className="mt-2 text-xs text-rose-500">{requestError}</p>}
                    <p className="mt-2 text-[11px] text-slate-500">
                      Genera un pedido de reposición a Samurai.
                    </p>
                  </>
                )}
              </div>
            )}

            {onAjustarStock && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="mb-1 text-sm font-semibold text-slate-900">⚙️ Ajustar stock (Contabilium)</p>
                <p className="mb-3 text-xs text-slate-500">
                  Corrige la cantidad real en este depósito directo en Contabilium. Tarda unos segundos más de lo normal.
                </p>
                {ajusteOk ? (
                  <p className="text-sm font-semibold text-emerald-600">✓ Ajuste aplicado.</p>
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setAjusteTipo("M")}
                        className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                          ajusteTipo === "M" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <span className="block font-semibold">Modificar</span>
                        <span className="block opacity-80">Suma o resta (negativo)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAjusteTipo("R")}
                        className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                          ajusteTipo === "R" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <span className="block font-semibold">Reemplazar</span>
                        <span className="block opacity-80">Fija el stock en este valor</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs font-medium text-slate-500">
                        {ajusteTipo === "R" ? "Nuevo stock" : "Cantidad (± )"}
                      </label>
                      <input
                        type="number"
                        value={ajusteCantidad}
                        onChange={(e) => setAjusteCantidad(Number(e.target.value) || 0)}
                        className="w-24 rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
                      />
                      <button
                        type="button"
                        disabled={ajustando}
                        onClick={handleAjustarStock}
                        className="ml-auto rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-60"
                      >
                        {ajustando ? "Ajustando…" : "Confirmar ajuste"}
                      </button>
                    </div>
                    {ajusteError && <p className="mt-2 text-xs text-rose-500">{ajusteError}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BikeGlyph(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </svg>
  );
}
