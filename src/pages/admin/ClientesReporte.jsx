// src/pages/admin/ClientesReporte.jsx
import { useMemo, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { Link } from "react-router-dom";
import { subscribeClientesReportDetail, triggerClientesReportSync } from "../../services/comprobantes";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ORDENES = {
  deuda: (a, b) => b.saldoDeudor - a.saldoDeudor,
  favor: (a, b) => b.saldoAFavor - a.saldoAFavor,
  facturado: (a, b) => b.facturadoTotal - a.facturadoTotal,
  cobrado: (a, b) => b.cobradoTotal - a.cobradoTotal,
  stock: (a, b) => b.stockConsignado - a.stockConsignado,
  nombre: (a, b) => (a.nombre || "").localeCompare(b.nombre || ""),
};

export default function ClientesReporte() {
  const [data, setData] = useState(null);
  const [orden, setOrden] = useState("deuda");
  const [search, setSearch] = useState("");
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeClientesReportDetail(setData), []);

  async function handleRefrescar() {
    setRefrescando(true);
    setError("");
    try {
      await triggerClientesReportSync();
    } catch (e) {
      setError(e.message || "No se pudo actualizar el reporte");
    } finally {
      setRefrescando(false);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) => (r.nombre || "").toLowerCase().includes(q) || (r.localidad || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort(ORDENES[orden] || ORDENES.deuda);
  }, [data, orden, search]);

  const totales = useMemo(() => {
    if (!data) return null;
    return data.rows.reduce(
      (acc, r) => ({
        stockConsignado: acc.stockConsignado + r.stockConsignado,
        valorConsignado: acc.valorConsignado + r.valorConsignado,
        facturadoTotal: acc.facturadoTotal + r.facturadoTotal,
        cobradoTotal: acc.cobradoTotal + r.cobradoTotal,
        saldoDeudor: acc.saldoDeudor + r.saldoDeudor,
        saldoAFavor: acc.saldoAFavor + r.saldoAFavor,
      }),
      { stockConsignado: 0, valorConsignado: 0, facturadoTotal: 0, cobradoTotal: 0, saldoDeudor: 0, saldoAFavor: 0 }
    );
  }, [data]);

  function descargarExcel() {
    const wsRows = rows.map((r) => ({
      Nombre: r.nombre,
      Localidad: r.localidad || "",
      "Stock consignado": r.stockConsignado,
      "Valor consignado": r.valorConsignado,
      "Facturado total": r.facturadoTotal,
      "Cantidad de facturas": r.cantidadFacturas,
      "Fecha primera factura": formatFecha(r.fechaPrimeraFactura),
      "Fecha última factura": formatFecha(r.fechaUltimaFactura),
      "Cobrado total": r.cobradoTotal,
      "Fecha última cobranza": formatFecha(r.fechaUltimaCobranza),
      "Deuda": r.saldoDeudor,
      "A favor": r.saldoAFavor,
    }));
    const ws = XLSX.utils.json_to_sheet(wsRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte clientes");
    XLSX.writeFile(wb, `reporte-clientes_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const loading = data === null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reporte de Clientes</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Stock consignado, facturación y cobranza por cliente
            {data?.updatedAt ? ` · actualizado ${data.updatedAt.toLocaleString("es-AR")}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={descargarExcel}
            disabled={rows.length === 0}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            📥 Descargar Excel
          </button>
          <button
            onClick={handleRefrescar}
            disabled={refrescando}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            {refrescando ? "Actualizando… (puede tardar unos minutos)" : "🔄 Refrescar"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {totales && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-[11px] text-slate-500 dark:text-neutral-400">Stock consignado</p>
            <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{totales.stockConsignado.toLocaleString("es-AR")}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-[11px] text-slate-500 dark:text-neutral-400">Valor consignado</p>
            <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(totales.valorConsignado)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-[11px] text-slate-500 dark:text-neutral-400">Facturado total</p>
            <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(totales.facturadoTotal)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-[11px] text-slate-500 dark:text-neutral-400">Cobrado total</p>
            <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(totales.cobradoTotal)}</p>
          </div>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
            <p className="text-[11px] text-rose-600 dark:text-rose-400">Deuda total</p>
            <p className="mt-1 text-base font-bold text-rose-700 dark:text-rose-300">{money(totales.saldoDeudor)}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">A favor total</p>
            <p className="mt-1 text-base font-bold text-emerald-800 dark:text-emerald-300">{money(totales.saldoAFavor)}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente…"
          className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
        <select
          value={orden}
          onChange={(e) => setOrden(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        >
          <option value="deuda">Ordenar: mayor deuda</option>
          <option value="favor">Ordenar: mayor a favor</option>
          <option value="facturado">Ordenar: mayor facturado</option>
          <option value="cobrado">Ordenar: mayor cobrado</option>
          <option value="stock">Ordenar: mayor stock consignado</option>
          <option value="nombre">Ordenar: nombre (A-Z)</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-neutral-800">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Localidad</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Valor consignado</th>
                <th className="px-3 py-2 text-right">Facturado</th>
                <th className="px-3 py-2">1ª factura</th>
                <th className="px-3 py-2">Última factura</th>
                <th className="px-3 py-2 text-right">Cobrado</th>
                <th className="px-3 py-2">Última cobranza</th>
                <th className="px-3 py-2 text-right">Deuda</th>
                <th className="px-3 py-2 text-right">A favor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
              {rows.map((r) => (
                <tr key={r.uid} className="hover:bg-slate-50 dark:hover:bg-neutral-900/50">
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                    <Link to={`/admin/clientes-360?buscar=${encodeURIComponent(r.nombre)}`} className="hover:underline">
                      {r.nombre}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{r.localidad || "-"}</td>
                  <td className="px-3 py-2 text-right">{r.stockConsignado || "-"}</td>
                  <td className="px-3 py-2 text-right">{r.valorConsignado ? money(r.valorConsignado) : "-"}</td>
                  <td className="px-3 py-2 text-right">{r.facturadoTotal ? money(r.facturadoTotal) : "-"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{formatFecha(r.fechaPrimeraFactura)}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{formatFecha(r.fechaUltimaFactura)}</td>
                  <td className="px-3 py-2 text-right">{r.cobradoTotal ? money(r.cobradoTotal) : "-"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{formatFecha(r.fechaUltimaCobranza)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.saldoDeudor > 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
                    {r.saldoDeudor ? money(r.saldoDeudor) : "-"}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.saldoAFavor > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                    {r.saldoAFavor ? money(r.saldoAFavor) : "-"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400 dark:text-neutral-500">
                    Sin datos todavía — tocá "Refrescar" para generar el reporte.
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
