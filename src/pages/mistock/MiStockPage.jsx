import { useState, useEffect, useMemo, useCallback } from "react";
import { useHistory, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { getMyDepositoStock, reportSale, listMySaleRequests, uploadComprobantePago } from "../../services/comprobantes";
import { createOrder, listCustomerOrders, updateMyOrderItems } from "../../services/orders";
import { filterBySearch } from "../../utils/colorSearch";
import { StatsBanner, BikeCard, ItemModal } from "../../components/stock/ConsignedStockUI";
import RequestStockModal from "../../components/stock/RequestStockModal";
import AuditRecorderModal from "../../components/stock/AuditRecorderModal";
import SkuScannerModal from "../../components/stock/SkuScannerModal";
import QrLabelsModal from "../../components/stock/QrLabelsModal";
import { listAuditsByDeposito, uploadAudit, nextAuditDate, isAuditOverdue, isAuditDueSoon, getAuditProgramStart } from "../../services/stockAudits";

const WHATSAPP_NUMBER = "5491149166234";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function isBici(item) {
  return (item.category || "").toUpperCase() === "BICICLETAS";
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20 text-slate-400 dark:text-neutral-500">
      <svg className="mr-3 h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      Cargando tu stock...
    </div>
  );
}

export default function MiStockPage() {
  const { user, profile } = useAuth();
  const history = useHistory();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [mySales, setMySales] = useState([]);
  const [mySalesLoading, setMySalesLoading] = useState(true);
  const [myStockOrders, setMyStockOrders] = useState([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(true);
  const [removingKey, setRemovingKey] = useState(null);
  const [lastAudit, setLastAudit] = useState(undefined); // undefined=cargando, null=nunca
  const [auditProgramStart, setAuditProgramStart] = useState(undefined); // undefined=cargando
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [uploadingReceiptId, setUploadingReceiptId] = useState(null);
  const [receiptError, setReceiptError] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [labelsOpen, setLabelsOpen] = useState(false);

  useEffect(() => {
    getAuditProgramStart().then(setAuditProgramStart).catch(() => {});
  }, []);

  const loadStock = useCallback(() => {
    setLoading(true);
    setError(null);
    return getMyDepositoStock()
      .then((result) => setData(result))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const loadMySales = useCallback(() => {
    setMySalesLoading(true);
    return listMySaleRequests()
      .then((result) => setMySales(result.items || []))
      .catch(() => {})
      .finally(() => setMySalesLoading(false));
  }, []);

  const loadMyStockOrders = useCallback(() => {
    if (!user) return Promise.resolve();
    setMyOrdersLoading(true);
    return listCustomerOrders(user.uid)
      .then((orders) => {
        const stockOrders = orders.filter(
          (o) => o.status === "pendiente" && (o.customer?.notes || "").includes("Pedido de reposición desde Mi Stock")
        );
        setMyStockOrders(stockOrders);
      })
      .catch(() => {})
      .finally(() => setMyOrdersLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user) { history.push("/login"); return; }
    loadStock();
    loadMySales();
    loadMyStockOrders();
  }, [user, history, loadStock, loadMySales, loadMyStockOrders]);

  const loadAudit = useCallback(async (depositoId) => {
    if (!depositoId) return;
    try {
      const audits = await listAuditsByDeposito(depositoId, 1);
      setLastAudit(audits[0] || null);
    } catch (err) {
      console.error("Error cargando auditorías:", err);
      setLastAudit(null);
    }
  }, []);

  useEffect(() => {
    if (data?.depositoId) loadAudit(data.depositoId);
  }, [data?.depositoId, loadAudit]);

  async function handleSubmitAudit(blob, recordedAt) {
    const distributorName = profile?.name || user.displayName || user.email || "Distribuidor";
    await uploadAudit({
      depositoId: data.depositoId,
      depositoNombre: data.depositoNombre || "",
      distributorUid: user.uid,
      distributorName,
      blob,
      recordedAt,
    });
    await loadAudit(data.depositoId);
  }

  async function handleRemoveOrderItem(orderId, items, itemId) {
    setRemovingKey(`${orderId}:${itemId}`);
    try {
      const nextItems = items.filter((it) => it.id !== itemId);
      await updateMyOrderItems(orderId, nextItems);
      await loadMyStockOrders();
    } finally {
      setRemovingKey(null);
    }
  }

  async function handleUploadReceipt(saleRequestId, file) {
    if (!file) return;
    setReceiptError(null);
    setUploadingReceiptId(saleRequestId);
    try {
      await uploadComprobantePago(saleRequestId, file);
      await loadMySales();
    } catch (err) {
      setReceiptError(err.message || "No se pudo subir el comprobante");
    } finally {
      setUploadingReceiptId(null);
    }
  }

  function handleScanDetected(code) {
    setScannerOpen(false);
    const clean = String(code || "").trim();
    const match = (data?.items || []).find(
      (it) => String(it.sku || "").trim().toUpperCase() === clean.toUpperCase()
    );
    if (match) {
      setScanError(null);
      setSelectedItem(match);
    } else {
      setScanError(`No encontramos ninguna bici con el código "${clean}" en tu stock.`);
    }
  }

  async function handleReportSale(saleItem) {
    const result = await reportSale(saleItem);
    await loadStock();
    await loadMySales();
    return result;
  }

  async function handleRequestMore(reqItem) {
    await submitStockRequest([reqItem]);
  }

  async function submitStockRequest(reqItems) {
    const requestTotal = reqItems.reduce(
      (acc, it) => acc + Number(it.priceArs || 0) * Number(it.quantity || 0),
      0
    );
    const creditLimit = profile?.creditLimit;
    if (creditLimit != null && totalDebido + requestTotal > creditLimit) {
      const disponible = Math.max(0, creditLimit - totalDebido);
      throw new Error(
        `Superás tu límite de crédito (${money(creditLimit)}). Disponible: ${money(disponible)}. Este pedido es de ${money(requestTotal)}.`
      );
    }

    const customerName = profile?.name || user.displayName || user.email || "Distribuidor";
    const orderId = await createOrder({
      customer: {
        name: customerName,
        email: user.email || "",
        phone: profile?.phone || "",
        notes: `Pedido de reposición desde Mi Stock (${data?.depositoNombre || "depósito consignado"})`,
      },
      items: reqItems.map((it) => ({ id: it.id, name: it.name, price: Number(it.priceArs || 0), qty: it.quantity })),
    });

    const lines = [
      "Hola Samurai Bicis, quiero pedir stock para mi depósito:",
      "",
      `Distribuidor: ${customerName}`,
      data?.depositoNombre ? `Depósito: ${data.depositoNombre}` : null,
      "",
      ...reqItems.map((it) => `• ${it.name} x${it.quantity}${it.sku ? ` — SKU ${it.sku}` : ""}`),
      "",
      orderId ? `ID de pedido: ${orderId}` : null,
    ].filter(Boolean);
    const whatsappMessage = encodeURIComponent(lines.join("\n"));
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMessage}`, "_blank");
    await loadMyStockOrders();
  }

  const totalBicicletas = useMemo(() => {
    if (!data?.items) return 0;
    return data.items.filter(isBici).reduce((acc, it) => acc + Number(it.stockDisponible || 0), 0);
  }, [data]);

  const totalDebido = useMemo(() => {
    if (!data?.items) return 0;
    return data.items
      .filter(isBici)
      .reduce((acc, it) => acc + Number(it.priceArs || 0) * Number(it.stockDisponible || 0), 0);
  }, [data]);

  const filteredItems = useMemo(() => {
    if (!data?.items) return null;
    return filterBySearch(data.items, itemSearch);
  }, [data, itemSearch]);

  const bicis = useMemo(() => (filteredItems || []).filter(isBici), [filteredItems]);
  const accesorios = useMemo(() => (filteredItems || []).filter((it) => !isBici(it)), [filteredItems]);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">Mi stock</h1>
          <Link
            to="/mis-pedidos"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white"
          >
            Ver mis facturas y comprobantes →
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
          {data?.depositoNombre
            ? `Stock consignado en tu depósito: ${data.depositoNombre}`
            : "Stock consignado en Contabilium."}
        </p>
      </div>

      {loading && <Spinner />}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error.includes("sin depósito")
            ? "Todavía no tenés un depósito consignado asignado. Escribinos si creés que esto es un error."
            : `No pudimos cargar tu stock: ${error}`}
        </div>
      )}

      {!loading && !error && (
        <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center">
          {data && data.items.length > 0 && (
            <input
              type="search"
              placeholder="Buscar en tu stock por bicicleta, color o SKU..."
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 sm:max-w-md sm:py-2.5"
            />
          )}
          <button
            onClick={() => { setScanError(null); setScannerOpen(true); }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white sm:py-2.5"
          >
            📷 Escanear
          </button>
          <button
            onClick={() => setLabelsOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white sm:py-2.5"
          >
            🏷️ Etiquetas
          </button>
          <button
            onClick={() => setRequestOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 sm:py-2.5"
          >
            + Pedir stock
          </button>
        </div>
      )}

      {scanError && (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {scanError}
        </div>
      )}

      {!loading && !error && data && data.items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 sm:p-12">
          No tenés stock consignado disponible en este momento.
        </div>
      )}

      {!loading && !error && data && data.items.length > 0 && filteredItems.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 sm:p-12">
          No encontramos resultados para "{itemSearch}".
        </div>
      )}

      {!loading && !error && bicis.length > 0 && (
        <div className="mb-10 sm:mb-14">
          <StatsBanner title="Bicicletas consignadas" totalBicicletas={totalBicicletas} totalDebido={totalDebido} money={money} />
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
            {bicis.map((item) => (
              <li key={item.id || item.sku}>
                <BikeCard item={item} onSelect={() => setSelectedItem(item)} money={money} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && accesorios.length > 0 && (
        <div className="mb-10 sm:mb-14">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Accesorios</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {accesorios.map((item) => (
              <li
                key={item.id || item.sku}
                onClick={() => setSelectedItem(item)}
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none sm:gap-4 sm:p-4"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50 dark:bg-neutral-800 sm:h-16 sm:w-16">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="h-full w-full object-contain p-1.5" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[9px] text-slate-400 dark:text-neutral-500">Sin imagen</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 dark:text-white">{item.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">SKU: {item.sku}</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-600">
                    {item.stockDisponible} disponible{item.stockDisponible === 1 ? "" : "s"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && data && (
        <div className="mb-5 overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 shadow-lg shadow-slate-300/40 dark:border-neutral-800 dark:shadow-none sm:mb-6">
          <div className="grid gap-0 sm:grid-cols-[280px_1fr]">
            <div className="flex items-center justify-center bg-black/20 p-6 sm:p-7">
              <div className="relative w-full max-w-[220px] overflow-hidden rounded-[1.75rem] border-[3px] border-neutral-700/80 bg-black shadow-2xl ring-1 ring-white/10">
                <video
                  src="/videos/auditoria-tutorial.mp4"
                  controls
                  playsInline
                  className="aspect-[9/16] w-full bg-black"
                />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-300">
                🎬 Tutorial · 57 seg
              </span>
              <h3 className="text-lg font-bold text-white sm:text-xl">Cómo grabar tu auditoría de stock</h3>
              <p className="text-sm leading-relaxed text-slate-300">
                Mirá este video corto y hacé la tuya en menos de un minuto.
              </p>
              <ul className="mt-1 space-y-2 text-sm text-slate-200">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[11px] font-bold text-sky-300">1</span>
                  Tocá "🎥 Grabar video" en el cartel de abajo
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[11px] font-bold text-sky-300">2</span>
                  Filmá las bicis de tu depósito
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[11px] font-bold text-sky-300">3</span>
                  Confirmá y enviala
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && data && lastAudit !== undefined && auditProgramStart !== undefined && (() => {
        const lastAuditAt = lastAudit?.createdAt || null;
        const overdue = isAuditOverdue(lastAuditAt, auditProgramStart, profile?.auditIntervalDays);
        const dueSoon = !overdue && isAuditDueSoon(lastAuditAt, auditProgramStart, profile?.auditIntervalDays);
        const isNuevo = !lastAudit; // todavía no grabó ninguna, pero ya tiene fecha de arranque del programa
        const tone = overdue
          ? "border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
          : dueSoon
          ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
          : isNuevo
          ? "border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10"
          : "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900";
        return (
          <div className={`mb-5 flex flex-col gap-3 rounded-3xl border p-5 shadow-sm shadow-slate-200/60 dark:shadow-none sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${tone}`}>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">🎥 Auditoría de stock</p>
              {overdue && !isNuevo && (
                <p className="mt-1 text-sm font-semibold text-rose-700">
                  🚨 Tu auditoría de stock está vencida. Ocupate de hacerla cuanto antes, por favor.
                </p>
              )}
              {dueSoon && (
                <p className="mt-1 text-sm font-semibold text-amber-700">
                  ⚠️ Dentro de 2 días se vence tu nueva auditoría. Por favor, tenelo en cuenta y grabá el video.
                </p>
              )}
              {!overdue && !dueSoon && lastAudit && (
                <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                  Última auditoría: {lastAudit.createdAt?.toLocaleDateString("es-AR")} · Próxima:{" "}
                  <span className="font-semibold text-slate-700 dark:text-neutral-300">{nextAuditDate(lastAuditAt, auditProgramStart, profile?.auditIntervalDays)?.toLocaleDateString("es-AR")}</span>
                </p>
              )}
              {isNuevo && !overdue && !dueSoon && (
                <p className="mt-1 text-xs text-sky-700">
                  🎉 Implementamos la auditoría de stock. Tu primera auditoría vence el{" "}
                  <span className="font-semibold">{nextAuditDate(lastAuditAt, auditProgramStart, profile?.auditIntervalDays)?.toLocaleDateString("es-AR")}</span>.
                </p>
              )}
              {isNuevo && overdue && (
                <p className="mt-1 text-sm font-semibold text-rose-700">
                  🚨 Implementamos la auditoría de stock y ya se venció el primer plazo. Grabá el video cuanto antes.
                </p>
              )}
            </div>
            <button
              onClick={() => setRecorderOpen(true)}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-700"
            >
              🎥 Grabar video
            </button>
          </div>
        );
      })()}

      {!loading && !error && (
        <div className="mb-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none sm:mb-6 sm:p-6">
          <p className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Límite de crédito</p>
          {profile?.creditLimit != null ? (
            <div className="grid grid-cols-3 gap-3 text-center sm:gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Límite</p>
                <p className="mt-1 truncate text-base font-bold text-slate-900 dark:text-white sm:text-xl" title={money(profile.creditLimit)}>
                  {money(profile.creditLimit)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Usado</p>
                <p className="mt-1 truncate text-base font-bold text-amber-600 sm:text-xl" title={money(totalDebido)}>
                  {money(totalDebido)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Disponible</p>
                <p className="mt-1 truncate text-base font-bold text-emerald-600 sm:text-xl" title={money(Math.max(0, profile.creditLimit - totalDebido))}>
                  {money(Math.max(0, profile.creditLimit - totalDebido))}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-neutral-400">Límite todavía no asignado.</p>
          )}
        </div>
      )}

      {!myOrdersLoading && myStockOrders.length > 0 && (
        <div className="mt-12 sm:mt-16">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Mis pedidos de stock</h2>
          <p className="mb-4 text-xs text-slate-500 dark:text-neutral-400">
            Pedidos que enviaste y todavía no procesamos. Podés sacar productos si te arrepentiste.
          </p>
          <ul className="space-y-4">
            {myStockOrders.map((order) => (
              <li key={order.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 text-xs text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                  <span>Pedido #{order.id}</span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                    Pendiente
                  </span>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-neutral-800">
                  {(order.items || []).map((it) => (
                    <li key={it.id} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{it.name}</p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400">
                          {it.qty} unidad{it.qty === 1 ? "" : "es"} · {money(it.price * it.qty)}
                        </p>
                      </div>
                      <button
                        disabled={removingKey === `${order.id}:${it.id}`}
                        onClick={() => handleRemoveOrderItem(order.id, order.items, it.id)}
                        className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                      >
                        {removingKey === `${order.id}:${it.id}` ? "Quitando…" : "Quitar"}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-neutral-800 sm:px-6">
                  <span className="text-xs text-slate-500 dark:text-neutral-400">Total</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{money(order.total)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!mySalesLoading && mySales.length > 0 && (
        <div className="mt-12 sm:mt-16">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Mis ventas reportadas</h2>
          <p className="mb-4 text-xs text-slate-500 dark:text-neutral-400">
            Lo que fuiste marcando como vendido. "Pendiente" significa que Samurai todavía no lo facturó — es normal
            que tarde, y no hace falta que lo vuelvas a reportar.
          </p>
          {receiptError && (
            <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              {receiptError}
            </p>
          )}
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {mySales.map((s) => {
              const estado = s.comprobantePagoEstado;
              const uploading = uploadingReceiptId === s.id;
              return (
                <li key={s.id} className="flex flex-col gap-3 p-3 sm:p-4">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-50 dark:bg-neutral-800">
                      {s.imageUrl ? (
                        <img src={s.imageUrl} alt={s.name} className="h-full w-full object-contain p-1" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[9px] text-slate-400 dark:text-neutral-500">Sin imagen</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{s.name || `SKU ${s.sku}`}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                        {s.quantity} unidad{s.quantity === 1 ? "" : "es"}
                        {s.unitPrice != null ? ` · ${money(s.unitPrice * s.quantity)}` : ""}
                        {s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString("es-AR")}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                        s.status === "facturado"
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                      }`}
                    >
                      {s.status === "facturado" ? "Facturado" : "Pendiente"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[4.5rem]">
                    {estado === "aprobado" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                        ✓ Comprobante de pago aprobado
                      </span>
                    )}
                    {estado === "pendiente" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400">
                        🕓 Comprobante en revisión
                      </span>
                    )}
                    {estado === "rechazado" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                        ✕ Comprobante rechazado{s.comprobantePagoNota ? `: ${s.comprobantePagoNota}` : ""}
                      </span>
                    )}
                    {s.comprobantePagoUrl && (
                      <a
                        href={s.comprobantePagoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-sky-600 underline hover:text-sky-700 dark:text-sky-400"
                      >
                        Ver comprobante
                      </a>
                    )}
                    {(!estado || estado === "rechazado") && (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white">
                        {uploading ? "Subiendo…" : estado === "rechazado" ? "Volver a adjuntar" : "📎 Adjuntar comprobante de pago"}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            handleUploadReceipt(s.id, file);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ItemModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        money={money}
        onReportSale={handleReportSale}
        onRequestMore={handleRequestMore}
        distributorName={profile?.name || user.displayName || user.email || "Distribuidor"}
        depositoNombre={data?.depositoNombre}
        whatsappNumber={WHATSAPP_NUMBER}
      />

      <RequestStockModal open={requestOpen} onClose={() => setRequestOpen(false)} onSubmit={submitStockRequest} />

      <AuditRecorderModal open={recorderOpen} onClose={() => setRecorderOpen(false)} onSubmit={handleSubmitAudit} />

      <SkuScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleScanDetected} />

      <QrLabelsModal open={labelsOpen} onClose={() => setLabelsOpen(false)} items={bicis} />
    </div>
  );
}
