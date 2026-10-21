import { useEffect, useMemo, useState } from "react";
import { getContabiliumDepositos } from "../../services/contabiliumDepositos";
import { getDepositoStockAdmin } from "../../services/comprobantes";
import { filterBySearch } from "../../utils/colorSearch";
import { extraerModelo } from "../../utils/bikeName";

function isBici(item) {
  return (item.category || "").toUpperCase() === "BICICLETAS";
}

// Los 3 depósitos PROPIOS de Fepa (no de un distribuidor) — Lavalle,
// Depósito Cañuelas y Credifin — son siempre los de número propio 1, 2 y 3
// en el mapeo de internalData/contabiliumDepositos (ver labelDeposito).
// Se identifican por `codigo` en vez de hardcodear sus IDs de Contabilium
// para no romper si algún día cambian.
const CODIGOS_FEPA = [1, 2, 3];

// Panel aparte de "Stock consignado" (que es por distribuidor) — junta el
// stock de los 3 depósitos propios de Fepa para buscar una bici sin tener
// que saber de antemano en cuál de los 3 está. Dos vistas: todo junto (un
// buscador, te dice de qué depósito sale cada resultado) o separado por
// depósito (un buscador por depósito, y si no está ahí te avisa si está en
// otro de los 3 o en ninguno).
export default function DepositosFepaPanel() {
  const [deposits, setDeposits] = useState(null); // null=cargando, [] = no se encontraron
  const [itemsByDeposito, setItemsByDeposito] = useState({});
  const [loadingItems, setLoadingItems] = useState(true);
  const [error, setError] = useState("");
  const [modo, setModo] = useState("combinado"); // "combinado" | "separado"
  const [queryCombinado, setQueryCombinado] = useState("");
  const [modeloCombinado, setModeloCombinado] = useState(null);
  const [queriesPorDeposito, setQueriesPorDeposito] = useState({});

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const todos = await getContabiliumDepositos();
        const fepa = todos
          .filter((d) => CODIGOS_FEPA.includes(d.codigo))
          .sort((a, b) => a.codigo - b.codigo);
        if (cancelado) return;
        setDeposits(fepa);
        setLoadingItems(true);
        const resultados = await Promise.all(
          fepa.map((d) =>
            getDepositoStockAdmin(d.id)
              .then((r) => ({ id: d.id, items: r.items || [] }))
              .catch((e) => ({ id: d.id, items: [], error: e.message }))
          )
        );
        if (cancelado) return;
        const map = {};
        for (const r of resultados) map[r.id] = r.items;
        setItemsByDeposito(map);
      } catch (e) {
        if (!cancelado) setError(e.message || "No se pudieron cargar los depósitos de Fepa");
      } finally {
        if (!cancelado) setLoadingItems(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  // Todo junto, cada item con el depósito de origen pegado — para el modo
  // "combinado" y para buscar cruzado en el modo "separado".
  const itemsConOrigen = useMemo(() => {
    if (!deposits) return [];
    const out = [];
    for (const d of deposits) {
      for (const it of itemsByDeposito[d.id] || []) {
        if (Number(it.stockDisponible || 0) <= 0) continue;
        out.push({ ...it, depositoId: d.id, depositoNombre: d.nombre });
      }
    }
    return out;
  }, [deposits, itemsByDeposito]);

  const totalUnidades = useMemo(
    () => itemsConOrigen.filter(isBici).reduce((acc, it) => acc + Number(it.stockDisponible || 0), 0),
    [itemsConOrigen]
  );

  const modelosCombinado = useMemo(
    () => [...new Set(itemsConOrigen.filter(isBici).map((it) => extraerModelo(it.name)).filter(Boolean))].sort(),
    [itemsConOrigen]
  );

  const resultadosCombinado = useMemo(() => {
    const base = modeloCombinado ? itemsConOrigen.filter((it) => extraerModelo(it.name) === modeloCombinado) : itemsConOrigen;
    return filterBySearch(base, queryCombinado);
  }, [itemsConOrigen, queryCombinado, modeloCombinado]);

  if (loadingItems && !deposits) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-900">
        Cargando depósitos de Fepa…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-400">
        {error}
      </div>
    );
  }

  if (!deposits || deposits.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-400 dark:border-neutral-700">
        No se encontraron los depósitos propios de Fepa (códigos 1, 2 y 3).
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/10 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-bold text-slate-900 dark:text-white">🏢 Depósitos propios de Fepa</p>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            {deposits.map((d) => d.nombre).join(" · ")} — {totalUnidades} bici{totalUnidades === 1 ? "" : "s"} en total
            {loadingItems ? " (actualizando…)" : ""}
          </p>
        </div>
        <div className="flex rounded-xl border border-indigo-200 bg-white p-0.5 dark:border-indigo-900/50 dark:bg-neutral-900">
          <button
            onClick={() => setModo("combinado")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              modo === "combinado" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800 dark:text-neutral-400"
            }`}
          >
            Todo junto
          </button>
          <button
            onClick={() => setModo("separado")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              modo === "separado" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800 dark:text-neutral-400"
            }`}
          >
            Por depósito
          </button>
        </div>
      </div>

      {modo === "combinado" ? (
        <div className="mt-4">
          <input
            type="search"
            value={queryCombinado}
            onChange={(e) => setQueryCombinado(e.target.value)}
            placeholder="Buscar bicicleta por nombre, SKU o color…"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
          {modelosCombinado.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {modelosCombinado.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModeloCombinado((prev) => (prev === m ? null : m))}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    modeloCombinado === m
                      ? "bg-indigo-600 text-white"
                      : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1.5">
            {resultadosCombinado.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400 dark:border-neutral-700">
                {queryCombinado.trim()
                  ? "No hay stock de esa bici en ningún depósito de Fepa."
                  : "Sin unidades disponibles."}
              </p>
            )}
            {resultadosCombinado.map((it) => (
              <div
                key={`${it.depositoId}-${it.sku}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900 dark:text-white">{it.name}</p>
                  <p className="text-xs text-slate-400 dark:text-neutral-500">SKU {it.sku}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
                    {it.depositoNombre}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    {Number(it.stockDisponible || 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {deposits.map((d) => (
            <ColumnaDeposito
              key={d.id}
              deposito={d}
              items={(itemsByDeposito[d.id] || []).filter((it) => Number(it.stockDisponible || 0) > 0)}
              otrosItems={itemsConOrigen.filter((it) => it.depositoId !== d.id)}
              query={queriesPorDeposito[d.id] || ""}
              onQueryChange={(v) => setQueriesPorDeposito((prev) => ({ ...prev, [d.id]: v }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnaDeposito({ deposito, items, otrosItems, query, onQueryChange }) {
  const resultados = useMemo(() => filterBySearch(items, query), [items, query]);
  const totalLocal = useMemo(() => items.filter(isBici).reduce((acc, it) => acc + Number(it.stockDisponible || 0), 0), [items]);
  const enOtrosDepositos = useMemo(() => {
    if (!query.trim() || resultados.length > 0) return [];
    return filterBySearch(otrosItems, query);
  }, [query, resultados, otrosItems]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-sm font-bold text-slate-900 dark:text-white">{deposito.nombre}</p>
      <p className="text-[11px] text-slate-400 dark:text-neutral-500">{totalLocal} bici{totalLocal === 1 ? "" : "s"} acá</p>
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Buscar en este depósito…"
        className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
      />
      <div className="mt-2 space-y-1.5">
        {query.trim() && resultados.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-2 text-center text-[11px] text-slate-400 dark:border-neutral-700">
            {enOtrosDepositos.length > 0 ? (
              <>
                No está acá. Sí hay en:{" "}
                {[...new Map(enOtrosDepositos.map((it) => [it.depositoId, it])).values()]
                  .map((it) => it.depositoNombre)
                  .join(", ")}
              </>
            ) : (
              "No hay stock de esa bici en ningún depósito de Fepa."
            )}
          </div>
        )}
        {resultados.map((it) => (
          <div key={it.sku} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1.5 text-xs dark:border-neutral-800">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900 dark:text-white">{it.name}</p>
              <p className="text-[10px] text-slate-400 dark:text-neutral-500">SKU {it.sku}</p>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              {Number(it.stockDisponible || 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
