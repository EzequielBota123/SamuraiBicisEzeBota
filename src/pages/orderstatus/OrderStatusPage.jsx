import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { listCustomerOrders } from "../../services/orders";
import { LoadingSpinner } from "../../components/ui/LoadingIndicators";

const statusLabels = {
  solicitud: "Solicitud recibida",
  pendiente: "En preparación",
  pagada: "Pedido completado",
  cancelada: "Pedido cancelado",
};

const statusStyles = {
  solicitud: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
  pendiente: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  pagada: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  cancelada: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
};

const baseSteps = [
  {
    id: "solicitud",
    title: "Solicitud recibida",
    description:
      "Registramos tu pedido y lo vinculamos con tu cuenta para que puedas seguirlo cuando quieras.",
  },
  {
    id: "pendiente",
    title: "Preparando tu pedido",
    description:
      "Nuestro equipo revisa el stock, coordina la logística y te contacta si surge alguna novedad.",
  },
  {
    id: "pagada",
    title: "Pedido completado",
    description:
      "Confirmamos el pago, cerramos el pedido y coordinamos la entrega o retiro.",
  },
];

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeStyle: "short",
});

const moneyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function formatDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateTimeFormatter.format(date);
}

function formatMoney(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return moneyFormatter.format(value);
}

function buildSteps(status) {
  const steps = baseSteps.map((step) => ({ ...step, state: "upcoming" }));
  if (status === "cancelada") {
    return steps
      .map((step, index) => {
        if (index === 0) return { ...step, state: "complete" };
        if (index === 1) return { ...step, state: "cancelled" };
        return step;
      })
      .concat({
        id: "cancelada",
        title: "Pedido cancelado",
        description:
          "Cancelamos el pedido. Si necesitás retomarlo o volver a generarlo, escribinos y te ayudamos al instante.",
        state: "cancelled",
      });
  }

  const currentIndex = Math.max(
    steps.findIndex((step) => step.id === status),
    0,
  );

  return steps.map((step, index) => {
    if (index < currentIndex) return { ...step, state: "complete" };
    if (index === currentIndex) return { ...step, state: "current" };
    return step;
  });
}

function StatusBadge({ status }) {
  const label = statusLabels[status] || status;
  const style = statusStyles[status] || "border-slate-200 bg-slate-100 text-slate-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${style}`}>
      <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

function StepIcon({ state, index }) {
  const base = "flex h-12 w-12 items-center justify-center rounded-full border-2 text-base font-semibold";
  if (state === "complete") {
    return (
      <span className={`${base} border-emerald-400 bg-emerald-50 text-emerald-600 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-400`}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          className="h-6 w-6"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (state === "cancelled") {
    return (
      <span className={`${base} border-rose-400 bg-rose-50 text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-400`}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          className="h-6 w-6"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 18 12-12M6 6l12 12" />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className={`${base} border-sky-400 bg-sky-50 text-sky-600 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-400`}>
        {index + 1}
      </span>
    );
  }
  return (
    <span className={`${base} border-slate-200 bg-white text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500`}>
      {index + 1}
    </span>
  );
}

function StatusTimeline({ status }) {
  const steps = useMemo(() => buildSteps(status), [status]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_70px_-55px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Seguimiento paso a paso</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Visualizá en qué instancia está tu pedido y qué acciones siguen a continuación.
          </p>
        </div>
      </div>
      <ol className="space-y-6 md:grid md:grid-cols-2 md:gap-6 md:space-y-0 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/40 p-4 text-sm text-slate-600 shadow-inner dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-300"
          >
            <StepIcon state={step.state} index={index} />
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-white">{step.title}</p>
              <p className="mt-2 leading-relaxed text-slate-500 dark:text-neutral-400">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ItemsTable({ items, total }) {
  if (!items?.length) return null;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_70px_-55px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Detalle de artículos</h3>
        {typeof total === "number" && total > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            Total estimado: {formatMoney(total)}
          </div>
        ) : null}
      </div>
      <div className="mt-6 divide-y divide-slate-200 text-sm text-slate-600 dark:divide-neutral-800 dark:text-neutral-300">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
            <div>
              <p className="font-medium text-slate-900 dark:text-white">{item.name}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-neutral-500">
                Cantidad: {item.qty}
              </p>
            </div>
            <div className="text-right text-sm font-semibold text-slate-700 dark:text-neutral-300">
              {item.price ? formatMoney(item.price * item.qty) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderSummary({ order }) {
  const lastUpdate = formatDate(order.updatedAt || order.createdAt);
  const createdAt = formatDate(order.createdAt);
  const paidAt = formatDate(order.paidAt);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_45px_90px_-60px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
        <div className="absolute -right-28 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-sky-200/40 blur-3xl dark:bg-white/[0.03]" />
        <div className="absolute -left-32 top-0 h-72 w-72 rounded-full bg-indigo-200/30 blur-3xl dark:bg-white/[0.03]" />
        <div className="relative grid gap-6 lg:grid-cols-[2fr_1fr] lg:items-start">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
              Pedido #{order.id}
            </div>
            <div>
              <h2 className="text-3xl font-semibold text-slate-900 dark:text-white">Estado del pedido</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
                Actualizamos el estado de tu pedido en tiempo real y te avisamos cuando haya novedades.
              </p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                <dt className="text-xs uppercase tracking-[0.28em] text-slate-400 dark:text-neutral-500">Cliente</dt>
                <dd className="mt-2 text-sm font-medium text-slate-800 dark:text-white">
                  {order.customer?.name || "Sin nombre"}
                </dd>
                <dd className="text-xs text-slate-500 dark:text-neutral-400">{order.customer?.email || "Sin correo registrado"}</dd>
                {order.customer?.phone ? (
                  <dd className="text-xs text-slate-500 dark:text-neutral-400">Tel: {order.customer.phone}</dd>
                ) : null}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                <dt className="text-xs uppercase tracking-[0.28em] text-slate-400 dark:text-neutral-500">Fechas clave</dt>
                <dd className="mt-2 text-sm font-medium text-slate-800 dark:text-white">
                  Creado: {createdAt || "—"}
                </dd>
                <dd className="text-xs text-slate-500 dark:text-neutral-400">Última edición: {lastUpdate || "—"}</dd>
                {paidAt ? (
                  <dd className="text-xs text-emerald-600">Pago acreditado: {paidAt}</dd>
                ) : null}
              </div>
            </dl>
          </div>
          <div className="flex flex-col items-start gap-4 lg:items-end">
            <StatusBadge status={order.status} />
            {typeof order.total === "number" && order.total > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/40">
                Total declarado: {formatMoney(order.total)}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <StatusTimeline status={order.status} />

      <ItemsTable items={order.items} total={order.total} />
    </div>
  );
}

function OrdersList({ orders = [], selectedOrderId, onSelect = () => {}, onReload = () => {}, loading }) {
  const hasOrders = orders.length > 0;
  const showLoadingPlaceholder = loading && !hasOrders;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_70px_-55px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Mis pedidos</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Tenés acceso a todos los pedidos vinculados a tu cuenta.
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>Actualizando…</span>
            </>
          ) : (
            <span>Actualizar</span>
          )}
        </button>
      </div>
      <div className="mt-6 space-y-3">
        {showLoadingPlaceholder ? (
          <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/80 py-10 dark:border-neutral-800 dark:bg-neutral-800/40">
            <LoadingSpinner label="Cargando tus pedidos…" size="sm" />
          </div>
        ) : null}

        {orders.map((order) => {
          const isSelected = selectedOrderId ? order.id === selectedOrderId : false;
          const lastUpdate = formatDate(order.updatedAt || order.createdAt);
          const itemsCount = Array.isArray(order.items) ? order.items.length : 0;
          const itemsSummary = itemsCount
            ? itemsCount === 1
              ? "1 artículo"
              : `${itemsCount} artículos`
            : "Sin artículos registrados";
          const totalLabel = typeof order.total === "number" && order.total > 0
            ? formatMoney(order.total)
            : null;

          return (
            <button
              key={order.id}
              type="button"
              onClick={() => onSelect(order.id)}
              className={`w-full rounded-2xl border px-4 py-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${
                isSelected
                  ? "border-sky-300 bg-sky-50 shadow-lg shadow-sky-200/40 dark:border-sky-500/40 dark:bg-sky-500/10 dark:shadow-none"
                  : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-sky-500/30 dark:hover:bg-sky-500/5"
              }`}
              aria-pressed={isSelected}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Pedido #{order.id}</p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    Actualizado {lastUpdate || "recientemente"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">{itemsSummary}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={order.status} />
                  {totalLabel ? (
                    <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-white dark:text-slate-900">
                      {totalLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}

        {!showLoadingPlaceholder && !hasOrders ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-800/40 dark:text-neutral-400">
            Todavía no generaste pedidos. Explorá el catálogo y creá tu primera orden.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptySelectionState() {
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-10 py-12 text-center text-sm text-slate-600 shadow-[0_35px_70px_-55px_rgba(15,23,42,0.45)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:shadow-none">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Seleccioná un pedido para ver el detalle</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
        Tus pedidos aparecerán en la columna izquierda. Una vez que generes uno, vas a poder seguir cada paso desde aquí.
      </p>
    </div>
  );
}

function LoginPrompt() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-[0_45px_90px_-60px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
      <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Iniciá sesión para ver tus pedidos</h2>
      <p className="mt-3 text-sm text-slate-600 dark:text-neutral-400">
        Asociamos tus pedidos a tu cuenta para que puedas consultarlos en cualquier momento.
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          to="/login"
          className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/40 transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/50 dark:bg-white dark:text-slate-900 dark:hover:bg-neutral-200"
        >
          Iniciar sesión
        </Link>
        <Link
          to="/catalogo"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Ver catálogo
        </Link>
      </div>
    </div>
  );
}

function ErrorCallout({ message, onRetry, loading }) {
  return (
    <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700 shadow-[0_20px_40px_-35px_rgba(225,29,72,0.45)] dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 dark:shadow-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium">{message}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-neutral-900 dark:text-rose-400 dark:hover:bg-rose-500/10"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span>Reintentando…</span>
              </>
            ) : (
              <span>Intentar nuevamente</span>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SupportCard() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-[0_35px_70px_-55px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:shadow-none">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">¿No encontrás alguno de tus pedidos?</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>Verificá si generaste la orden con otro correo electrónico o usuario.</li>
        <li>Los pedidos creados como invitado no aparecen aquí hasta que los asociemos a tu cuenta.</li>
        <li>
          Escribinos a <a className="text-sky-600 underline dark:text-sky-400" href="mailto:medinaleoariel@hotmail.com">medinaleoariel@hotmail.com</a> y te ayudamos al instante.
        </li>
      </ul>
    </div>
  );
}

export default function OrderStatusPage() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const uid = user?.uid ?? null;

  useEffect(() => {
    let active = true;

    if (authLoading) {
      return () => {
        active = false;
      };
    }

    if (!uid) {
      setOrders([]);
      setSelectedOrderId(null);
      setError("");
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError("");

    listCustomerOrders(uid)
      .then((results) => {
        if (!active) return;
        setOrders(results);
        setSelectedOrderId((current) => {
          if (current && results.some((order) => order.id === current)) {
            return current;
          }
          return results.length ? results[0].id : null;
        });
      })
      .catch((err) => {
        console.error(err);
        if (!active) return;
        setOrders([]);
        setSelectedOrderId(null);
        setError(err?.message || "No pudimos recuperar tus pedidos.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, uid, reloadKey]);

  const selectedOrder = useMemo(() => {
    if (!orders.length) return null;
    if (selectedOrderId) {
      const found = orders.find((order) => order.id === selectedOrderId);
      if (found) return found;
    }
    return orders[0] || null;
  }, [orders, selectedOrderId]);

  const hasOrders = orders.length > 0;

  const handleRetry = () => {
    if (!loading) {
      setReloadKey((value) => value + 1);
    }
  };

  return (
    <div className="bg-slate-50 pb-20 pt-16 dark:bg-black">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-10 shadow-[0_45px_90px_-60px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
          <div className="absolute -left-32 bottom-0 h-64 w-64 rounded-full bg-slate-200/60 blur-3xl dark:bg-white/[0.03]" />
          <div className="absolute -right-40 top-0 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl dark:bg-white/[0.03]" />
          <div className="relative space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
              Seguimiento de pedidos
            </div>
            <div className="max-w-3xl space-y-3">
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Mis pedidos</h1>
              <p className="text-sm text-slate-600 dark:text-neutral-400">
                Consultá el estado de cada pedido que generaste con tu cuenta. Podés actualizar la información cuando quieras.
              </p>
            </div>
          </div>
        </section>

        <section className="relative mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_45px_90px_-65px_rgba(15,23,42,0.45)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
          {authLoading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <LoadingSpinner label="Preparando tu espacio de pedidos…" />
            </div>
          ) : uid ? (
            <div className="space-y-8">
              {error ? (
                <ErrorCallout message={error} onRetry={handleRetry} loading={loading} />
              ) : null}
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)]">
                <OrdersList
                  orders={orders}
                  selectedOrderId={selectedOrder?.id || selectedOrderId}
                  onSelect={setSelectedOrderId}
                  onReload={handleRetry}
                  loading={loading}
                />
                <div>
                  {selectedOrder ? <OrderSummary order={selectedOrder} /> : <EmptySelectionState />}
                </div>
              </div>
              {!hasOrders ? <SupportCard /> : null}
            </div>
          ) : (
            <LoginPrompt />
          )}
        </section>
      </div>
    </div>
  );
}
