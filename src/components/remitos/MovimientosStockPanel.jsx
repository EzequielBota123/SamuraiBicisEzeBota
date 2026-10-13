import { useEffect, useMemo, useState } from "react";
import { obtenerMovimientosStock } from "../../services/comprobantes";

function haceNMeses(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
const MESES_LABEL = {};

function mesLabel(ym) {
  if (!MESES_LABEL[ym]) {
    const [y, m] = ym.split("-");
    MESES_LABEL[ym] = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", { month: "short", year: "2-digit" });
  }
  return MESES_LABEL[ym];
}

function esBici(codigoNombre) {
  return /BIC\b/i.test(codigoNombre || "");
}

// Panel "Movimientos" — lee directo de la API real de Contabilium
// (movinventarios/GetPageWithFilters, api.contabilium.com/v2) los
// movimientos entre depósitos, con la observación de cada uno. A
// diferencia de Remitos y Cobranza (que solo ve remitos "reales"), esto
// también captura transferencias internas (ej. Lavalle → Cuchi → su
// cliente), así que es la única fuente que distingue bien cuánto salió de
// nuestros depósitos propios vs. cuánto repartió cada distribuidor con
// equipo entre sus propios clientes.
export default function MovimientosStockPanel() {
  const [desde, setDesde] = useState(() => haceNMeses(3));
  const [hasta, setHasta] = useState(() => hoyISO());
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [vista, setVista] = useState("recibido"); // "recibido" | "enviado" | "detalle"
  const [filtroCliente, setFiltroCliente] = useState("");

  function cargar() {
    setLoading(true);
    setError("");
    obtenerMovimientosStock(desde, hasta)
      .then((r) => setItems(r.items || []))
      .catch((e) => setError(e.message || "No se pudo cargar"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bicis = useMemo(() => (items || []).filter((m) => esBici(m.codigoNombre)), [items]);

  const meses = useMemo(() => {
    const set = new Set(bicis.map((m) => (m.fecha || "").slice(0, 7)).filter(Boolean));
    return [...set].sort();
  }, [bicis]);

  // Pivot: quién (destino) recibió cuántas bicis cada mes.
  const pivotRecibido = useMemo(() => {
    const map = new Map();
    for (const m of bicis) {
      const mes = (m.fecha || "").slice(0, 7);
      if (!mes) continue;
      const destino = (m.destino || "").trim() || "?";
      if (!map.has(destino)) map.set(destino, {});
      const fila = map.get(destino);
      fila[mes] = (fila[mes] || 0) + Number(m.cantidad || 0);
    }
    return map;
  }, [bicis]);

  // Pivot: quién (origen) entregó/mandó cuántas bicis cada mes — útil para
  // ver cuánto repartió Cuchi (u otro distribuidor con equipo) a sus
  // propios clientes, no solo lo que él mismo recibió de Lavalle.
  const pivotEnviado = useMemo(() => {
    const map = new Map();
    for (const m of bicis) {
      const mes = (m.fecha || "").slice(0, 7);
      if (!mes) continue;
      const origen = (m.origen || "").trim() || "?";
      if (!map.has(origen)) map.set(origen, {});
      const fila = map.get(origen);
      fila[mes] = (fila[mes] || 0) + Number(m.cantidad || 0);
    }
    return map;
  }, [bicis]);

  function filasPivot(map) {
    const filas = [...map.entries()].map(([nombre, porMes]) => ({
      nombre,
      porMes,
      total: Object.values(porMes).reduce((a, b) => a + b, 0),
    }));
    filas.sort((a, b) => b.total - a.total);
    if (!filtroCliente.trim()) return filas;
    const q = filtroCliente.trim().toLowerCase();
    return filas.filter((f) => f.nombre.toLowerCase().includes(q));
  }

  const detalleFiltrado = useMemo(() => {
    const ordenado = [...bicis].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    if (!filtroCliente.trim()) return ordenado;
    const q = filtroCliente.trim().toLowerCase();
    return ordenado.filter(
      (m) => (m.origen || "").toLowerCase().includes(q) || (m.destino || "").toLowerCase().includes(q) || (m.descripcion || "").toLowerCase().includes(q)
    );
  }, [bicis, filtroCliente]);

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">🔀 Movimientos entre depósitos (en vivo)</p>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            Directo de Contabilium — incluye transferencias internas (ej. a través de Cuchi), no solo remitos.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white" />
          </div>
          <button onClick={cargar} disabled={loading} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {loading ? "Actualizando…" : "🔄 Actualizar"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {items !== null && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-emerald-200 bg-white p-0.5 dark:border-emerald-900/50 dark:bg-neutral-900">
              {[
                { id: "recibido", label: "Quién recibió" },
                { id: "enviado", label: "Quién entregó" },
                { id: "detalle", label: "Detalle" },
              ].map((op) => (
                <button
                  key={op.id}
                  onClick={() => setVista(op.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    vista === op.id ? "bg-emerald-600 text-white" : "text-slate-500 hover:text-slate-800 dark:text-neutral-400"
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value)}
              placeholder="Filtrar por cliente/distribuidor…"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
            <span className="text-xs text-slate-400 dark:text-neutral-500">{bicis.length} movimientos de bicis en el rango</span>
          </div>

          {(vista === "recibido" || vista === "enviado") && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-xs dark:divide-neutral-800">
                <thead>
                  <tr className="text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    <th className="py-1.5 pr-3">{vista === "recibido" ? "Recibió" : "Entregó"}</th>
                    {meses.map((m) => (
                      <th key={m} className="py-1.5 px-2 text-right">{mesLabel(m)}</th>
                    ))}
                    <th className="py-1.5 pl-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                  {filasPivot(vista === "recibido" ? pivotRecibido : pivotEnviado).map((f) => (
                    <tr key={f.nombre}>
                      <td className="py-1.5 pr-3 font-medium text-slate-900 dark:text-white">{f.nombre}</td>
                      {meses.map((m) => (
                        <td key={m} className="py-1.5 px-2 text-right text-slate-600 dark:text-neutral-300">
                          {f.porMes[m] || <span className="text-slate-300 dark:text-neutral-700">—</span>}
                        </td>
                      ))}
                      <td className="py-1.5 pl-2 text-right font-bold text-emerald-700 dark:text-emerald-400">{f.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {vista === "detalle" && (
            <div className="mt-3 max-h-96 space-y-1 overflow-y-auto">
              {detalleFiltrado.map((m, i) => (
                <div key={`${m.id}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-white">{m.origen?.trim()} → {m.destino?.trim()}</p>
                    <p className="truncate text-slate-400 dark:text-neutral-500">{m.codigoNombre}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-slate-700 dark:text-neutral-300">x{Number(m.cantidad)}</p>
                    <p className="text-slate-400 dark:text-neutral-500">{(m.fecha || "").slice(0, 10)}</p>
                  </div>
                </div>
              ))}
              {detalleFiltrado.length === 0 && <p className="text-center text-slate-400">Sin movimientos en este rango.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
