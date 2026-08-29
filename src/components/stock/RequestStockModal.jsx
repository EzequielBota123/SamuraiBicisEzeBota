import { useEffect, useMemo, useState } from "react";
import { subscribeProducts } from "../../services/products";
import { filterBySearch } from "../../utils/colorSearch";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function RequestStockModal({ open, onClose, onSubmit }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState({}); // { productId: qty }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);
  const [stage, setStage] = useState("browse"); // "browse" | "cart" | "confirm"

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const unsub = subscribeProducts(
      { onlyActive: "true", pageSize: 500 },
      (items) => { setProducts(items); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub && unsub();
  }, [open]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setCat("all");
      setCart({});
      setSubmitError("");
      setDone(false);
      setStage("browse");
    }
  }, [open]);

  const filtered = useMemo(() => {
    let list = products;
    if (cat !== "all") list = list.filter((p) => (p.category || "").toUpperCase() === cat);
    return filterBySearch(list, search);
  }, [products, cat, search]);

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => {
          const product = products.find((p) => p.id === id);
          return product ? { product, qty } : null;
        })
        .filter(Boolean),
    [cart, products]
  );

  const cartTotal = cartItems.reduce(
    (acc, { product, qty }) => acc + Number(product.priceArs ?? product.price ?? 0) * qty,
    0
  );

  function setQty(id, qty, max) {
    const clamped = max != null ? Math.min(Math.max(0, qty), max) : Math.max(0, qty);
    setCart((prev) => ({ ...prev, [id]: clamped }));
  }

  async function handleSubmit() {
    if (!cartItems.length) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onSubmit(
        cartItems.map(({ product, qty }) => ({
          id: product.id,
          sku: product.sku || "",
          name: product.name,
          priceArs: Number(product.priceArs ?? product.price ?? 0),
          quantity: qty,
        }))
      );
      setDone(true);
    } catch (e) {
      setSubmitError(e.message || "No se pudo enviar el pedido");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Pedir stock</h2>
        <button
          onClick={onClose}
          className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          Cerrar
        </button>
      </div>

      {done ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-2xl">✓</p>
          <p className="text-lg font-semibold text-slate-900">Pedido enviado a Samurai</p>
          <p className="max-w-sm text-sm text-slate-500">
            Te abrimos WhatsApp para confirmarlo con el vendedor. Podés cerrar esta ventana.
          </p>
          <button
            onClick={onClose}
            className="mt-3 rounded-2xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
          >
            Cerrar
          </button>
        </div>
      ) : stage === "cart" ? (
        <CartDetail
          cartItems={cartItems}
          cartTotal={cartTotal}
          money={money}
          setQty={setQty}
          onBack={() => setStage("browse")}
          onConfirm={() => setStage("confirm")}
        />
      ) : stage === "confirm" ? (
        <ConfirmStep
          cartItems={cartItems}
          cartTotal={cartTotal}
          money={money}
          submitting={submitting}
          submitError={submitError}
          onBack={() => setStage("cart")}
          onConfirm={handleSubmit}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
            <input
              type="search"
              autoFocus
              placeholder="Buscar por bicicleta, accesorio, color o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 sm:max-w-md"
            />
            <div className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
              {[
                { id: "all", label: "Todos" },
                { id: "BICICLETAS", label: "Bicicletas" },
                { id: "ACCESORIOS", label: "Accesorios" },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    cat === c.id ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {loading && <p className="py-10 text-center text-sm text-slate-500">Cargando catálogo…</p>}
            {!loading && filtered.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-500">No encontramos resultados para "{search}".</p>
            )}
            {!loading && filtered.length > 0 && (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                {filtered.map((p) => {
                  const qty = cart[p.id] || 0;
                  const price = Number(p.priceArs ?? p.price ?? 0);
                  const stock = Number(p.stock ?? 0);
                  const noStock = stock <= 0;
                  return (
                    <li key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60">
                      <div className="aspect-square w-full overflow-hidden bg-slate-50">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-slate-400">Sin imagen</div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-3">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-400">SKU: {p.sku || "-"}</p>
                        <p
                          className={`text-xs font-medium ${
                            noStock ? "text-rose-600" : stock <= 3 ? "text-amber-600" : "text-emerald-600"
                          }`}
                        >
                          {noStock ? "Sin stock disponible" : `${stock} disponible${stock === 1 ? "" : "s"}`}
                        </p>
                        <p className="mt-auto text-sm font-bold text-slate-900">{money(price)}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setQty(p.id, qty - 1, stock)}
                            disabled={qty <= 0}
                            className="h-8 w-8 shrink-0 rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={stock}
                            value={qty}
                            disabled={noStock}
                            onChange={(e) => setQty(p.id, Number(e.target.value) || 0, stock)}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm outline-none focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                          <button
                            type="button"
                            onClick={() => setQty(p.id, qty + 1, stock)}
                            disabled={noStock || qty >= stock}
                            className="h-8 w-8 shrink-0 rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
            {submitError && <p className="mb-2 text-sm text-rose-600">{submitError}</p>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                {cartItems.length === 0
                  ? "Elegí las bicicletas o accesorios que necesitás."
                  : `${cartItems.reduce((a, i) => a + i.qty, 0)} unidad${cartItems.reduce((a, i) => a + i.qty, 0) === 1 ? "" : "es"} seleccionadas — ${money(cartTotal)}`}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={!cartItems.length}
                  onClick={() => setStage("cart")}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-sky-400 disabled:opacity-60"
                >
                  Ver mi pedido
                </button>
                <button
                  disabled={!cartItems.length}
                  onClick={() => setStage("confirm")}
                  className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 disabled:opacity-60"
                >
                  Enviar pedido
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CartDetail({ cartItems, cartTotal, money, setQty, onBack, onConfirm }) {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
        <button
          onClick={onBack}
          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          ← Seguir agregando
        </button>
        <h2 className="text-lg font-bold text-slate-900">Mi pedido</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {cartItems.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">Todavía no elegiste nada.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {cartItems.map(({ product, qty }) => (
              <li key={product.id} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[9px] text-slate-400">Sin imagen</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                  <p className="text-xs text-slate-400">SKU: {product.sku || "-"}</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-700">
                    {money(Number(product.priceArs ?? product.price ?? 0))} c/u
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQty(product.id, qty - 1, product.stock)}
                    className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(product.id, qty + 1, product.stock)}
                    disabled={qty >= Number(product.stock ?? 0)}
                    className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setQty(product.id, 0)}
                  className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-slate-700">
            Total: {money(cartTotal)}
          </p>
          <button
            disabled={!cartItems.length}
            onClick={onConfirm}
            className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            Enviar pedido
          </button>
        </div>
      </div>
    </>
  );
}

function ConfirmStep({ cartItems, cartTotal, money, submitting, submitError, onBack, onConfirm }) {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
        <button
          onClick={onBack}
          disabled={submitting}
          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
        >
          ← Volver
        </button>
        <h2 className="text-lg font-bold text-slate-900">Confirmá tu pedido</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <p className="mb-4 text-sm text-slate-600">
          Revisá que esté todo bien antes de enviar. Esto le llega a Samurai y te abre WhatsApp para confirmarlo.
        </p>
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {cartItems.map(({ product, qty }) => (
            <li key={product.id} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[9px] text-slate-400">Sin imagen</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                <p className="text-xs text-slate-500">
                  {qty} unidad{qty === 1 ? "" : "es"} · {money(Number(product.priceArs ?? product.price ?? 0) * qty)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {submitError && <p className="mt-3 text-sm text-rose-600">{submitError}</p>}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-slate-700">Total: {money(cartTotal)}</p>
          <div className="flex gap-2">
            <button
              onClick={onBack}
              disabled={submitting}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60"
            >
              Editar
            </button>
            <button
              onClick={onConfirm}
              disabled={submitting}
              className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 disabled:opacity-60"
            >
              {submitting ? "Enviando…" : "Sí, enviar pedido"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
