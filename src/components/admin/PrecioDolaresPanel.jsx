// src/components/admin/PrecioDolaresPanel.jsx
// Precio en dólares (dólar oficial, en vivo) de cada bici del catálogo —
// se recalcula con el precio en pesos ya cargado, no toca Contabilium para
// esto. Incluye una calculadora tipo carrito y el valor total del stock
// (propios + consignado) a dólar de hoy. Se usa tanto en Contador diario
// como en el panel de Productos.
import { useEffect, useMemo, useState } from "react";
import { subscribeStockPorDepositoDetail } from "../../services/comprobantes";
import { subscribeProducts } from "../../services/products";
import { getDolarOficial } from "../../services/dolar";
import { extraerModelo, extraerTalle } from "../../utils/bikeName";

const ORDEN_MODELO_USD = ["BOWIE", "SHONEN", "GOZEN", "3.0", "2.0"];
const ORDEN_TALLE_USD = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];
function ordenarPorModeloYTalleUsd(items) {
  return [...items].sort((a, b) => {
    const ma = extraerModelo(a.name);
    const mb = extraerModelo(b.name);
    const ia = ma ? ORDEN_MODELO_USD.indexOf(ma) : 99;
    const ib = mb ? ORDEN_MODELO_USD.indexOf(mb) : 99;
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    const ta = extraerTalle(a.name);
    const tb = extraerTalle(b.name);
    const ja = ta ? ORDEN_TALLE_USD.indexOf(ta) : 99;
    const jb = tb ? ORDEN_TALLE_USD.indexOf(tb) : 99;
    if (ja !== jb) return (ja === -1 ? 99 : ja) - (jb === -1 ? 99 : jb);
    return (a.name || "").localeCompare(b.name || "", "es");
  });
}
function moneyArs(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}
function moneyUsd(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function PrecioDolaresPanel() {
  const [productos, setProductos] = useState([]);
  const [dolar, setDolar] = useState(null);
  const [dolarError, setDolarError] = useState("");
  const [dolarCargando, setDolarCargando] = useState(true);
  const [stockDetail, setStockDetail] = useState(null);

  const [calcSkuId, setCalcSkuId] = useState("");
  const [calcCantidad, setCalcCantidad] = useState(1);
  const [carrito, setCarrito] = useState([]); // [{ id, cantidad }]

  function agregarAlCarrito() {
    if (!calcSkuId) return;
    const cantidad = Number(calcCantidad) || 0;
    if (cantidad <= 0) return;
    setCarrito((prev) => {
      const existe = prev.find((it) => it.id === calcSkuId);
      if (existe) return prev.map((it) => (it.id === calcSkuId ? { ...it, cantidad: it.cantidad + cantidad } : it));
      return [...prev, { id: calcSkuId, cantidad }];
    });
    setCalcSkuId("");
    setCalcCantidad(1);
  }
  function quitarDelCarrito(id) {
    setCarrito((prev) => prev.filter((it) => it.id !== id));
  }

  function cargarDolar() {
    setDolarCargando(true);
    setDolarError("");
    getDolarOficial()
      .then(setDolar)
      .catch((e) => setDolarError(e.message || "No se pudo traer la cotización del dólar"))
      .finally(() => setDolarCargando(false));
  }

  useEffect(() => {
    cargarDolar();
    const unsub = subscribeProducts({ q: "", onlyActive: "true", category: "all", pageSize: 200 }, setProductos, () => {});
    const unsubStock = subscribeStockPorDepositoDetail(setStockDetail);
    return () => {
      unsub?.();
      unsubStock?.();
    };
  }, []);

  const bicisConPrecio = useMemo(() => {
    const bicis = (productos || []).filter(
      (p) => (p.productTypeTitle || p.category || "").toString().toUpperCase() === "BICICLETAS" && p.priceArs != null
    );
    return ordenarPorModeloYTalleUsd(bicis);
  }, [productos]);

  const valorStock = useMemo(() => {
    const precioPorSku = new Map(bicisConPrecio.map((p) => [p.sku, p.priceArs]));
    let propiosArs = 0;
    let consignadoArs = 0;
    for (const s of stockDetail?.porSku || []) {
      const precio = precioPorSku.get(s.sku);
      if (precio == null) continue;
      propiosArs += (s.propiosTotal || 0) * precio;
      consignadoArs += (s.consignadoTotal || 0) * precio;
    }
    return { propiosArs, consignadoArs, totalArs: propiosArs + consignadoArs };
  }, [stockDetail, bicisConPrecio]);

  const calcProducto = bicisConPrecio.find((p) => p.id === calcSkuId) || null;

  const carritoDetalle = useMemo(() => {
    return carrito
      .map((it) => {
        const p = bicisConPrecio.find((prod) => prod.id === it.id);
        if (!p) return null;
        return { ...it, nombre: p.name, precioArs: p.priceArs || 0, subtotalArs: (p.priceArs || 0) * it.cantidad };
      })
      .filter(Boolean);
  }, [carrito, bicisConPrecio]);
  const carritoTotalArs = carritoDetalle.reduce((a, it) => a + it.subtotalArs, 0);
  const carritoTotalBicis = carritoDetalle.reduce((a, it) => a + it.cantidad, 0);

  return (
    <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm dark:border-emerald-900 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">💵 Precio en dólares (dólar oficial)</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
            {dolarCargando
              ? "Consultando cotización…"
              : dolar
              ? `Dólar oficial venta: ${moneyArs(dolar.venta)} · compra: ${moneyArs(dolar.compra)}${
                  dolar.fechaActualizacion ? ` · actualizado ${dolar.fechaActualizacion.toLocaleString("es-AR")}` : ""
                }`
              : "Sin cotización"}
          </p>
          {dolarError && <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{dolarError}</p>}
        </div>
        <button
          onClick={cargarDolar}
          disabled={dolarCargando}
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
        >
          🔄 Actualizar cotización
        </button>
      </div>

      {dolar && bicisConPrecio.length > 0 && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/10">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">🧮 Calculadora</p>

          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Bici</label>
              <select
                value={calcSkuId}
                onChange={(e) => setCalcSkuId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              >
                <option value="">Elegí una bici…</option>
                {bicisConPrecio.map((p) => (
                  <option key={p.id} value={p.id}>
                    {extraerModelo(p.name) || ""} {extraerTalle(p.name) ? `· T.${extraerTalle(p.name)}` : ""} · {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Cantidad</label>
              <input
                type="number"
                min="1"
                value={calcCantidad}
                onChange={(e) => setCalcCantidad(e.target.value)}
                className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              />
            </div>
            <button
              onClick={agregarAlCarrito}
              disabled={!calcSkuId}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ➕ Agregar
            </button>
            {calcProducto && (
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                {calcCantidad} × {moneyArs(calcProducto.priceArs)} = {moneyArs((calcProducto.priceArs || 0) * (Number(calcCantidad) || 0))}
              </p>
            )}
          </div>

          {carritoDetalle.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-emerald-200 dark:border-emerald-900">
              <table className="w-full text-left text-xs">
                <thead className="bg-white text-slate-400 dark:bg-neutral-900 dark:text-neutral-500">
                  <tr>
                    <th className="px-3 py-1.5">Bici</th>
                    <th className="px-3 py-1.5 text-right">Cantidad</th>
                    <th className="px-3 py-1.5 text-right">Subtotal</th>
                    <th className="px-3 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100 bg-white dark:divide-emerald-900/40 dark:bg-neutral-900">
                  {carritoDetalle.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-1.5 text-slate-800 dark:text-white">{it.nombre}</td>
                      <td className="px-3 py-1.5 text-right text-slate-600 dark:text-neutral-300">{it.cantidad}</td>
                      <td className="px-3 py-1.5 text-right font-semibold text-slate-700 dark:text-neutral-200">{moneyArs(it.subtotalArs)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => quitarDelCarrito(it.id)}
                          className="text-slate-400 hover:text-rose-600 dark:text-neutral-500 dark:hover:text-rose-400"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between bg-emerald-100/60 px-3 py-2 dark:bg-emerald-950/30">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">{carritoTotalBicis} bici(s) en total</span>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{moneyArs(carritoTotalArs)}</p>
                  <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400">{moneyUsd(carritoTotalArs / dolar.venta)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {dolar && stockDetail && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-center dark:border-indigo-900 dark:bg-indigo-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-400">Depósitos propios (valor)</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{moneyArs(valorStock.propiosArs)}</p>
            <p className="text-2xl font-extrabold text-indigo-800 dark:text-indigo-300">{moneyUsd(valorStock.propiosArs / dolar.venta)}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Consignado (valor)</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{moneyArs(valorStock.consignadoArs)}</p>
            <p className="text-2xl font-extrabold text-amber-800 dark:text-amber-300">{moneyUsd(valorStock.consignadoArs / dolar.venta)}</p>
          </div>
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center dark:border-emerald-800 dark:bg-emerald-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Total general (valor)</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{moneyArs(valorStock.totalArs)}</p>
            <p className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-300">{moneyUsd(valorStock.totalArs / dolar.venta)}</p>
          </div>
        </div>
      )}

      {dolar && bicisConPrecio.length > 0 && (
        <div className="mt-4 max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-neutral-800">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2">Modelo</th>
                <th className="px-3 py-2">Talle</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2 text-right">Precio (ARS)</th>
                <th className="px-3 py-2 text-right">Precio (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
              {bicisConPrecio.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-1.5 text-slate-600 dark:text-neutral-300">{extraerModelo(p.name) || "—"}</td>
                  <td className="px-3 py-1.5 text-slate-600 dark:text-neutral-300">{extraerTalle(p.name) || "—"}</td>
                  <td className="px-3 py-1.5 text-slate-800 dark:text-white">{p.name}</td>
                  <td className="px-3 py-1.5 text-right text-slate-700 dark:text-neutral-300">{moneyArs(p.priceArs)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                    {moneyUsd(p.priceArs / dolar.venta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dolar && bicisConPrecio.length === 0 && (
        <p className="mt-4 text-center text-xs text-slate-400 dark:text-neutral-500">No hay bicis activas con precio cargado todavía.</p>
      )}
    </div>
  );
}
