import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { listOrders } from "../../services/orders";
import { listProducts } from "../../services/products";
import { subscribeClients } from "../../services/accounts";
import { triggerConsignedRollupSync, triggerDepositosSync } from "../../services/comprobantes";
import { LoadingOverlay } from "../../components/ui/LoadingIndicators";
import { StatsBanner } from "../../components/stock/ConsignedStockUI";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const numberFormatter = new Intl.NumberFormat("es-AR");
const currencyFormatter = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

const statusClasses = {
  pagada: "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  facturado: "border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-400",
  pendiente: "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  cancelada: "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
  solicitud: "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
};

const statusLabels = {
  pagada: "Pagada",
  facturado: "Facturado",
  pendiente: "Pendiente",
  cancelada: "Cancelada",
  solicitud: "Solicitud",
};

function isNil(value) {
  return value === null || value === undefined;
}

function formatNumber(value) {
  return numberFormatter.format(Number(value || 0));
}

function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const date = toDate(value);
  return date ? date.toLocaleString("es-AR") : "";
}


export default function AdminDashboard() {
  const [metrics, setMetrics] = useState({
    users: null,
    products: null,
    ordersToday: null,
    revenue: null,
  });
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [distributors, setDistributors] = useState([]);
  const [ordersLast30, setOrdersLast30] = useState([]);
  const [rollup, setRollup] = useState(null);
  const [rollupRefreshing, setRollupRefreshing] = useState(false);
  const [rollupError, setRollupError] = useState("");
  const [rollupProgress, setRollupProgress] = useState(null);
  const [activityPanel, setActivityPanel] = useState(null); // "active" | "inactive" | null
  const [depositosMeta, setDepositosMeta] = useState(null);
  const [depositosRefreshing, setDepositosRefreshing] = useState(false);
  const [depositosError, setDepositosError] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeClients(
      "all",
      (items) => {
        setMetrics((prev) => ({ ...prev, users: items.length }));
        setDistributors(items.filter((u) => u.contabiliumDepositoId));
      },
      (err) => {
        console.error(err);
        setError((prev) => prev || "No se pudieron cargar los usuarios.");
      }
    );

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "meta", "consignedRollup"), (snap) => {
      setRollup(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "meta", "consignedRollupProgress"), (snap) => {
      setRollupProgress(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "internalData", "contabiliumDepositos"), (snap) => {
      setDepositosMeta(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, []);

  async function handleRefreshDepositos() {
    setDepositosRefreshing(true);
    setDepositosError("");
    try {
      await triggerDepositosSync();
    } catch (e) {
      setDepositosError(e.message || "No se pudo actualizar");
    } finally {
      setDepositosRefreshing(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function fetchOrdersLast30() {
      const start = new Date(Date.now() - THIRTY_DAYS_MS);
      let cursor = null;
      let all = [];
      const pageSize = 100;

      for (let page = 0; page < 20; page += 1) {
        const { items, nextCursor } = await listOrders({ from: start, pageSize, cursor });
        if (!items.length) break;
        all = all.concat(items);
        cursor = nextCursor;
        if (!cursor) break;
      }
      if (active) setOrdersLast30(all);
    }

    fetchOrdersLast30();
    return () => { active = false; };
  }, []);

  async function handleRefreshRollup() {
    setRollupRefreshing(true);
    setRollupError("");
    try {
      await triggerConsignedRollupSync();
    } catch (e) {
      setRollupError(e.message || "No se pudo actualizar");
    } finally {
      setRollupRefreshing(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function fetchOrdersForToday() {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      let cursor = null;
      let all = [];
      const pageSize = 50;

      for (let page = 0; page < 20; page += 1) {
        const { items, nextCursor } = await listOrders({ from: start, to: end, pageSize, cursor });
        if (!items.length) break;
        all = all.concat(items);
        cursor = nextCursor;
        if (!cursor) break;
      }

      const revenue = all.reduce(
        (acc, order) => (order.status === "pagada" ? acc + Number(order.total || 0) : acc),
        0
      );

      return { count: all.length, revenue };
    }

    async function countAllProducts() {
      let cursor = null;
      let total = 0;
      const pageSize = 100;

      for (let page = 0; page < 50; page += 1) {
        const { items, nextCursor } = await listProducts({ pageSize, cursor });
        total += items.length;
        cursor = nextCursor;
        if (!cursor || items.length === 0) break;
      }

      return total;
    }

    async function loadDashboard() {
      setLoading(true);
      setError(null);

      try {
        const [recent, today, productsTotal] = await Promise.all([
          listOrders({ pageSize: 5 }),
          fetchOrdersForToday(),
          countAllProducts(),
        ]);

        if (!active) return;

        setRecentOrders(recent.items);
        setMetrics((prev) => ({
          ...prev,
          products: productsTotal,
          ordersToday: today.count,
          revenue: today.revenue,
        }));
      } catch (err) {
        if (!active) return;
        console.error(err);
        setError("No se pudieron cargar los datos del dashboard.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  const activity = useMemo(() => {
    if (!recentOrders.length) return [];
    return recentOrders.slice(0, 5).map((order) => {
      const customerName = order.customer?.name?.trim() || "Cliente sin nombre";
      const statusLabel = statusLabels[order.status] || order.status || "Sin estado";
      const timestamp = formatDateTime(order.createdAt);
      const subtitleParts = [`Orden #${order.id}`, statusLabel];
      if (timestamp) subtitleParts.push(timestamp);
      return {
        id: order.id,
        title: customerName,
        subtitle: subtitleParts.join(" · "),
      };
    });
  }, [recentOrders]);

  const activeInactive = useMemo(() => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const lastOrderByUid = {};
    ordersLast30.forEach((o) => {
      const uid = o.customer?.uid;
      if (!uid) return;
      const date = toDate(o.createdAt);
      if (!date) return;
      if (!lastOrderByUid[uid] || date > lastOrderByUid[uid]) lastOrderByUid[uid] = date;
    });

    const active = [];
    const inactive = [];
    distributors.forEach((u) => {
      const lastLogin = toDate(u.lastLoginAt);
      const lastOrder = lastOrderByUid[u.id] || null;
      const loggedInRecently = lastLogin && lastLogin.getTime() >= cutoff;
      const orderedRecently = lastOrder && lastOrder.getTime() >= cutoff;
      const entry = {
        id: u.id,
        name: u.name || u.email || "Sin nombre",
        deposito: u.contabiliumDepositoNombre || "",
        lastLogin,
        lastOrder,
      };
      (loggedInRecently || orderedRecently ? active : inactive).push(entry);
    });

    const sortByRecent = (list) =>
      [...list].sort((a, b) => {
        const da = Math.max(a.lastLogin?.getTime() || 0, a.lastOrder?.getTime() || 0);
        const db_ = Math.max(b.lastLogin?.getTime() || 0, b.lastOrder?.getTime() || 0);
        return db_ - da;
      });

    return { active: sortByRecent(active), inactive: sortByRecent(inactive) };
  }, [distributors, ordersLast30]);

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_45px_85px_-55px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="absolute -right-32 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-sky-200/60 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
              Panel Samurai
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white sm:text-4xl">
                Métricas
              </h1>
              <p className="mt-2 max-w-xl text-sm text-slate-500 dark:text-neutral-400">
                Pantallazo general del negocio hoy: cuántos usuarios, productos y ventas hay, y cómo viene el día comparado con lo de siempre.
              </p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Usuarios", value: isNil(metrics.users) ? "…" : formatNumber(metrics.users) },
                { label: "Productos", value: isNil(metrics.products) ? "…" : formatNumber(metrics.products) },
                { label: "Órdenes hoy", value: isNil(metrics.ordersToday) ? "…" : formatNumber(metrics.ordersToday) },
                { label: "Ingresos hoy", value: isNil(metrics.revenue) ? "…" : formatCurrency(metrics.revenue) },
              ].map((item) => (
                <div key={item.label} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-neutral-400">{item.label}</dt>
                  <dd className="mt-2 truncate text-lg font-semibold text-slate-900 dark:text-white" title={item.value}>{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-6 dark:border-neutral-700 dark:bg-neutral-800/60">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Rendimiento de la jornada</p>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Actualizamos estas métricas cada vez que se procesa una orden o se sincroniza el catálogo.
            </p>
            <div className="grid gap-3 text-sm text-slate-600 dark:text-neutral-300">
              <div className="flex items-center justify-between">
                <span>Inventario total</span>
                <span className="font-semibold text-slate-900 dark:text-white">{isNil(metrics.products) ? "…" : formatNumber(metrics.products)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Promedio ticket</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {isNil(metrics.revenue) || isNil(metrics.ordersToday) || metrics.ordersToday === 0
                    ? "…"
                    : formatCurrency(metrics.revenue / metrics.ordersToday)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Estado de carga</span>
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                    loading
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${loading ? "bg-amber-400" : "bg-emerald-500"}`}
                  />
                  {loading ? "Sincronizando" : "Al día"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_40px_80px_-60px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Stock consignado total</h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              {rollup?.updatedAt
                ? `Actualizado: ${formatDateTime(rollup.updatedAt)}${rollup.depositosCount ? ` · ${rollup.depositosCount} depósitos` : ""}`
                : "Todavía no se calculó — apretá actualizar."}
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
              Conteo real, leído directo del stock de cada depósito en Contabilium — distinto del saldo contable
              "Entregado − Facturado" de Remitos y Cobranza, que puede tener huecos si falta cargar algún remito viejo.
            </p>
          </div>
          <button
            onClick={handleRefreshRollup}
            disabled={rollupRefreshing}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
          >
            {rollupRefreshing
              ? rollupProgress?.total
                ? `Actualizando… ${rollupProgress.processed || 0}/${rollupProgress.total} depósitos`
                : "Actualizando… (puede tardar unos minutos)"
              : "Actualizar ahora"}
          </button>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-800/40">
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            Lista de depósitos (desde Contabilium):{" "}
            {depositosMeta?.updatedAt
              ? `${depositosMeta.depositos?.length ?? 0} depósitos · actualizado ${formatDateTime(depositosMeta.updatedAt)}`
              : "todavía no se sincronizó"}
            {" "}· se actualiza sola cada 24hs.
          </p>
          <button
            onClick={handleRefreshDepositos}
            disabled={depositosRefreshing}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
          >
            {depositosRefreshing ? "Actualizando…" : "Actualizar depósitos ahora"}
          </button>
        </div>
        {depositosError && <p className="mb-3 text-sm text-rose-600">{depositosError}</p>}
        {rollupError && <p className="mb-3 text-sm text-rose-600">{rollupError}</p>}
        {rollup?.errors?.length > 0 && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <p className="font-semibold">
              {rollup.errors.length} depósito{rollup.errors.length === 1 ? "" : "s"} falló al consultar (no se sumaron al total):
            </p>
            <ul className="mt-1 space-y-0.5">
              {rollup.errors.map((e) => (
                <li key={e.depositoId}>
                  {e.nombre || `#${e.depositoId}`} — {e.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        <StatsBanner
          title="Bicicletas consignadas (todos los distribuidores)"
          totalBicicletas={rollup?.totalBicicletas ?? 0}
          totalDebido={rollup?.totalValor ?? 0}
          money={formatCurrency}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={() => setActivityPanel(activityPanel === "active" ? null : "active")}
          className={`rounded-3xl border p-5 text-left shadow-[0_20px_45px_-25px_rgba(15,23,42,0.3)] transition hover:-translate-y-0.5 ${
            activityPanel === "active" ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/10" : "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-emerald-600">Clientes activos (30 días)</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{activeInactive.active.length}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Pidieron stock o se conectaron en los últimos 30 días. Click para ver quiénes.</p>
        </button>
        <button
          onClick={() => setActivityPanel(activityPanel === "inactive" ? null : "inactive")}
          className={`rounded-3xl border p-5 text-left shadow-[0_20px_45px_-25px_rgba(15,23,42,0.3)] transition hover:-translate-y-0.5 ${
            activityPanel === "inactive" ? "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10" : "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-amber-600">Clientes inactivos (30 días)</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{activeInactive.inactive.length}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Sin pedidos ni conexión en los últimos 30 días. Click para ver quiénes.</p>
        </button>
      </div>

      {activityPanel && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_40px_80px_-60px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {activityPanel === "active" ? "Clientes activos — últimos 30 días" : "Clientes inactivos — últimos 30 días"}
            </h3>
            <button onClick={() => setActivityPanel(null)} className="text-xs text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white">
              Cerrar
            </button>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-neutral-800">
            {activeInactive[activityPanel].length === 0 ? (
              <li className="py-8 text-center text-sm text-slate-500 dark:text-neutral-400">No hay clientes en esta lista.</li>
            ) : (
              activeInactive[activityPanel].map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{c.name}</p>
                    <p className="text-xs text-slate-500 dark:text-neutral-400">{c.deposito}</p>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-neutral-400">
                    {c.lastOrder && <span>Último pedido: {c.lastOrder.toLocaleDateString("es-AR")}</span>}
                    {c.lastOrder && c.lastLogin && <span> · </span>}
                    {c.lastLogin && <span>Última conexión: {c.lastLogin.toLocaleDateString("es-AR")}</span>}
                    {!c.lastOrder && !c.lastLogin && <span>Sin actividad registrada</span>}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_40px_80px_-60px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5 xl:col-span-2">
          {loading && (
            <LoadingOverlay
              label="Actualizando órdenes…"
              className="rounded-[inherit] border border-slate-200 bg-white/80 text-slate-600"
              labelClassName="text-slate-600"
            />
          )}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Órdenes recientes</h2>
              <p className="text-xs text-slate-500 dark:text-neutral-400">Las últimas 5 compras que entraron, de cualquier cliente.</p>
            </div>
            <span className="text-xs text-slate-500 dark:text-neutral-400">Refrescamos cada 60 segundos</span>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              {error}
            </div>
          )}

          <ul className="mt-4 divide-y divide-slate-200 text-sm text-slate-600 dark:divide-neutral-800 dark:text-neutral-300">
            {recentOrders.length === 0 ? (
              <li className="py-10 text-center text-slate-500 dark:text-neutral-400">
                {loading ? "Cargando órdenes…" : "No hay órdenes recientes."}
              </li>
            ) : (
              recentOrders.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-3">
                    <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">#{order.id}</span>
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{order.customer?.name || "Cliente sin nombre"}</div>
                      <div className="text-xs text-slate-500 dark:text-neutral-400">{formatDateTime(order.createdAt)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
                        statusClasses[order.status] || "border border-slate-200 bg-slate-50 text-slate-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full bg-current/80" />
                      {statusLabels[order.status] || order.status || "Sin estado"}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(order.total)}</span>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_40px_80px_-60px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
          {loading && (
            <LoadingOverlay
              label="Cargando actividad…"
              className="rounded-[inherit] border border-slate-200 bg-white/80 text-slate-600"
              labelClassName="text-slate-600"
            />
          )}
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Actividad</h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400">Quién compró último, para saber si hay que hacer seguimiento.</p>
          <ol className="mt-4 space-y-4 text-sm text-slate-600 dark:text-neutral-300">
            {activity.length === 0 ? (
              <li className="text-slate-500 dark:text-neutral-400">
                {loading ? "Cargando actividad…" : "Sin actividad reciente."}
              </li>
            ) : (
              activity.map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                  <div className="font-semibold text-slate-900 dark:text-white">{item.title}</div>
                  <div className="text-xs text-slate-500 dark:text-neutral-400">{item.subtitle}</div>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
