// src/pages/admin/Vendedores.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeClients } from "../../services/accounts";
import { subscribeClientesReportDetail, adminAsignarVendedor } from "../../services/comprobantes";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export const VENDEDORES = ["Federico", "Leo", "Emanuel", "Alfredo"];

export default function Vendedores() {
  const [clientes, setClientes] = useState(null);
  const [reporteDetail, setReporteDetail] = useState(null);
  const [filtro, setFiltro] = useState("todos"); // "todos" | vendedor | "sin-asignar"
  const [search, setSearch] = useState("");
  const [guardandoId, setGuardandoId] = useState(null);

  useEffect(() => {
    const u1 = subscribeClients("activo", setClientes, () => setClientes([]));
    const u2 = subscribeClientesReportDetail(setReporteDetail);
    return () => {
      u1();
      u2();
    };
  }, []);

  const reportePorUid = useMemo(() => {
    const map = new Map();
    for (const r of reporteDetail?.rows || []) map.set(r.uid, r);
    return map;
  }, [reporteDetail]);

  async function handleAsignar(uid, vendedor) {
    setGuardandoId(uid);
    try {
      await adminAsignarVendedor(uid, vendedor || null);
    } catch (e) {
      alert(e.message || "No se pudo guardar");
    } finally {
      setGuardandoId(null);
    }
  }

  const porVendedor = useMemo(() => {
    const map = new Map(VENDEDORES.map((v) => [v, []]));
    map.set("Sin asignar", []);
    for (const c of clientes || []) {
      const key = c.vendedor && VENDEDORES.includes(c.vendedor) ? c.vendedor : "Sin asignar";
      map.get(key).push(c);
    }
    return map;
  }, [clientes]);

  const rows = useMemo(() => {
    let list = clientes || [];
    if (filtro === "sin-asignar") {
      list = list.filter((c) => !c.vendedor || !VENDEDORES.includes(c.vendedor));
    } else if (filtro !== "todos") {
      list = list.filter((c) => c.vendedor === filtro);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => (c.name || "").toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [clientes, filtro, search]);

  const loading = clientes === null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Vendedores</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">Asigná un vendedor a cada cliente y filtrá su cartera.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          onClick={() => setFiltro("todos")}
          className={`rounded-2xl border p-3 text-left transition ${
            filtro === "todos" ? "border-slate-900 bg-slate-900 text-white dark:border-neutral-500" : "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          }`}
        >
          <p className={`text-[11px] ${filtro === "todos" ? "text-slate-300" : "text-slate-500 dark:text-neutral-400"}`}>Todos</p>
          <p className="mt-1 text-lg font-bold">{(clientes || []).length}</p>
        </button>
        {VENDEDORES.map((v) => (
          <button
            key={v}
            onClick={() => setFiltro(v)}
            className={`rounded-2xl border p-3 text-left transition ${
              filtro === v ? "border-slate-900 bg-slate-900 text-white dark:border-neutral-500" : "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            }`}
          >
            <p className={`text-[11px] ${filtro === v ? "text-slate-300" : "text-slate-500 dark:text-neutral-400"}`}>{v}</p>
            <p className="mt-1 text-lg font-bold">{(porVendedor.get(v) || []).length}</p>
          </button>
        ))}
        <button
          onClick={() => setFiltro("sin-asignar")}
          className={`rounded-2xl border p-3 text-left transition ${
            filtro === "sin-asignar" ? "border-amber-500 bg-amber-500 text-white" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
          }`}
        >
          <p className={`text-[11px] ${filtro === "sin-asignar" ? "text-amber-100" : "text-amber-700 dark:text-amber-400"}`}>Sin asignar</p>
          <p className="mt-1 text-lg font-bold">{(porVendedor.get("Sin asignar") || []).length}</p>
        </button>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar cliente…"
        className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
      />

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-neutral-800">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Deuda</th>
                <th className="px-3 py-2 text-right">A favor</th>
                <th className="px-3 py-2">Vendedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
              {rows.map((c) => {
                const r = reportePorUid.get(c.id);
                return (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-neutral-900/50">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                      <Link to={`/admin/clientes-360?buscar=${encodeURIComponent(c.name || "")}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className={`px-3 py-2 text-right ${r?.saldoDeudor > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
                      {r?.saldoDeudor ? money(r.saldoDeudor) : "-"}
                    </td>
                    <td className={`px-3 py-2 text-right ${r?.saldoAFavor > 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}`}>
                      {r?.saldoAFavor ? money(r.saldoAFavor) : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={c.vendedor && VENDEDORES.includes(c.vendedor) ? c.vendedor : ""}
                        onChange={(e) => handleAsignar(c.id, e.target.value)}
                        disabled={guardandoId === c.id}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                      >
                        <option value="">Sin asignar</option>
                        {VENDEDORES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-400 dark:text-neutral-500">
                    Sin clientes en este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
