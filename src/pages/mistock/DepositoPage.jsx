import { useEffect, useMemo, useState } from "react";
import { getMiDepositoPropio } from "../../services/comprobantes";
import { filterBySearch } from "../../utils/colorSearch";
import { StatsBanner, BikeCard } from "../../components/stock/ConsignedStockUI";
import { extraerModelo, extraerTalle } from "../../utils/bikeName";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function isBici(item) {
  return (item.category || "").toUpperCase() === "BICICLETAS";
}

const MODELOS = ["3.0", "2.0", "GOZEN", "SHONEN"];
const ORDEN_TALLES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];

// Detalle del depósito propio de Samurai en Lavalle (no es stock consignado
// de un distribuidor, es el depósito de la empresa) — modelos, colores y
// cantidades, para quien coordina un grupo de vendedores.
export default function DepositoPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filtroModelo, setFiltroModelo] = useState("todos");

  useEffect(() => {
    setLoading(true);
    setError(null);
    getMiDepositoPropio()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // El backend ahora trae también los talles sin stock (para poder avisar
  // "no disponible"), así que acá filtramos siempre por stock > 0: las
  // grillas de tarjetas nunca deben mostrar algo que no hay.
  const conStock = useMemo(() => (data?.items || []).filter((it) => Number(it.stockActual || 0) > 0), [data]);

  const filteredItems = useMemo(() => {
    return filterBySearch(conStock, search);
  }, [conStock, search]);

  const modelosDisponibles = useMemo(() => {
    const enStock = new Set((data?.items || []).filter(isBici).map((it) => extraerModelo(it.name)).filter(Boolean));
    return MODELOS.filter((m) => enStock.has(m));
  }, [data]);

  const bicisFiltradas = useMemo(() => {
    const bicis = (filteredItems || []).filter(isBici);
    if (filtroModelo === "todos") return bicis;
    return bicis.filter((it) => extraerModelo(it.name) === filtroModelo);
  }, [filteredItems, filtroModelo]);

  const accesorios = useMemo(() => (filteredItems || []).filter((it) => !isBici(it)), [filteredItems]);

  // Talles del modelo elegido, con o sin stock — para poder marcar "no
  // disponible" en vez de simplemente omitirlo. Se calcula sobre TODO el
  // catálogo del modelo (no sobre lo buscado), es una vista aparte.
  const talleGroups = useMemo(() => {
    if (filtroModelo === "todos") return null;
    const delModelo = (data?.items || []).filter((it) => isBici(it) && extraerModelo(it.name) === filtroModelo);
    const porTalle = new Map();
    let sinTalle = 0;
    for (const it of delModelo) {
      const talle = extraerTalle(it.name);
      if (!talle) {
        sinTalle += Number(it.stockActual || 0);
        continue;
      }
      porTalle.set(talle, (porTalle.get(talle) || 0) + Number(it.stockActual || 0));
    }
    if (porTalle.size === 0) return { talles: [], sinTalles: true, stockSinTalle: sinTalle };
    const talles = [...porTalle.entries()]
      .sort((a, b) => {
        const ia = ORDEN_TALLES.indexOf(a[0]);
        const ib = ORDEN_TALLES.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([talle, stock]) => ({ talle, stock }));
    return { talles, sinTalles: false, stockSinTalle: sinTalle };
  }, [data, filtroModelo]);

  const totalBicicletas = useMemo(() => {
    return conStock.filter(isBici).reduce((acc, it) => acc + Number(it.stockActual || 0), 0);
  }, [conStock]);

  const totalValor = useMemo(() => {
    return conStock
      .filter(isBici)
      .reduce((acc, it) => acc + Number(it.priceArs || 0) * Number(it.stockActual || 0), 0);
  }, [conStock]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">
          Depósito{data?.depositoNombre ? ` — ${data.depositoNombre}` : ""}
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
          Stock del depósito propio de Samurai, por modelo y color.
        </p>
      </div>

      {loading && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          No pudimos cargar el depósito: {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <input
            type="search"
            placeholder="Buscar por modelo, color, talle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-5 w-full max-w-md rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />

          {conStock.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
              No hay stock en este depósito.
            </div>
          )}

          {conStock.length > 0 && filteredItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
              No encontramos resultados para "{search}".
            </div>
          )}

          {modelosDisponibles.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                onClick={() => setFiltroModelo("todos")}
                className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                  filtroModelo === "todos"
                    ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                    : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                Todos
              </button>
              {modelosDisponibles.map((m) => (
                <button
                  key={m}
                  onClick={() => setFiltroModelo(m)}
                  className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                    filtroModelo === m
                      ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                      : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {talleGroups && !talleGroups.sinTalles && (
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Talles — {filtroModelo}</p>
              <div className="flex flex-wrap gap-2">
                {talleGroups.talles.map(({ talle, stock }) => (
                  <span
                    key={talle}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                      stock > 0
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500"
                    }`}
                  >
                    Talle {talle} {stock > 0 ? `— ${stock}` : "— No disponible"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {talleGroups?.sinTalles && (
            <div className="mb-6 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
              {filtroModelo} no maneja talles — es de talle único.
            </div>
          )}

          {bicisFiltradas.length > 0 && (
            <div className="mb-10 sm:mb-14">
              <StatsBanner title="Bicicletas en Lavalle" totalBicicletas={totalBicicletas} totalDebido={totalValor} money={money} />
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                {bicisFiltradas.map((item) => (
                  <li key={item.id || item.sku}>
                    <BikeCard item={item} onSelect={() => {}} money={money} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filtroModelo !== "todos" && bicisFiltradas.length === 0 && (
            <div className="mb-10 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
              No hay unidades con stock de {filtroModelo} ahora mismo.
            </div>
          )}

          {accesorios.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-bold text-slate-900 dark:text-white">Otros productos</h2>
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                {accesorios.map((item) => (
                  <li key={item.id || item.sku}>
                    <BikeCard item={item} onSelect={() => {}} money={money} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
