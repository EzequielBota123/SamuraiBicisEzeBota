import { useState } from "react";
import { ensureSheetJs } from "../../../utils/sheetjs";

function fmtNotas(notas) {
  return (notas || [])
    .map((n) => {
      const d = n.f ? new Date(n.f) : null;
      const p = (x) => String(x).padStart(2, "0");
      const fecha = d ? `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}` : "—";
      return `[${fecha}] ${n.t}`;
    })
    .join("\n");
}

function filasClientes(datos) {
  return datos.map((c) => ({
    Nombre: c.nombre,
    CUIT: c.cuit || "",
    Tel1: c.telefono || "",
    Tel2: c.telefono2 || "",
    Email: c.email || "",
    Ciudad: c.ciudad || "",
    Provincia: c.provincia || "",
    Rubro: c.rubro || "",
    Tipo: c.tipo,
    Vendedor: c.vendedorId,
    Estado: c.estado,
    VendedorCierre: c.vendedorVenta || "",
    Notas: fmtNotas(c.notasHistorial) || c.notas || "",
    Asignado: c.fechaAsignacion || "",
  }));
}

async function exportarExcel(filas, sheetName, nombreArchivo) {
  const XLSX = await ensureSheetJs();
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
}

export default function Exportar({ crm }) {
  const { vendedores, asignados, clientes } = crm;
  const [vendedorSel, setVendedorSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run(fn) {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg("✅ Descarga lista.");
    } catch (err) {
      setMsg(err.message || "Error exportando.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {msg && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{msg}</div>}

      <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">📥 Exportar cartera de un vendedor</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Descarga en Excel todos los clientes asignados a un telemarketer puntual.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select value={vendedorSel} onChange={(e) => setVendedorSel(e.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:focus:border-sky-500">
            <option value="">— Elegí un vendedor —</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.nombre}>
                {v.nombre}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !vendedorSel}
            onClick={() =>
              run(() => {
                const datos = asignados.filter((c) => c.vendedorId === vendedorSel);
                if (!datos.length) throw new Error("No hay clientes para ese vendedor.");
                return exportarExcel(filasClientes(datos), "Clientes", `crm_${vendedorSel}`);
              })
            }
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            Descargar
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">📥 Exportar todos los clientes asignados</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Descarga en Excel la cartera completa de todos los vendedores/telemarketers.</p>
        <button
          disabled={busy}
          onClick={() =>
            run(() => {
              if (!asignados.length) throw new Error("No hay clientes asignados.");
              return exportarExcel(filasClientes(asignados), "Clientes", "todos_asignados");
            })
          }
          className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Descargar
        </button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">📥 Resumen por vendedor</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Una fila por vendedor, con totales y desglose por estado/tipo.</p>
        <button
          disabled={busy}
          onClick={() =>
            run(() => {
              const filas = vendedores.map((v) => ({
                Vendedor: v.nombre,
                Total: asignados.filter((c) => c.vendedorId === v.nombre).length,
                Credifin: asignados.filter((c) => c.vendedorId === v.nombre && c.tipo === "Credifin").length,
                SinCredifin: asignados.filter((c) => c.vendedorId === v.nombre && c.tipo === "Sin Credifin").length,
                Cerrados: asignados.filter((c) => c.vendedorId === v.nombre && c.estado === "Cerrado").length,
                EnManosDeVendedor: asignados.filter((c) => c.vendedorId === v.nombre && c.estado === "En manos de vendedor").length,
                Interesados: asignados.filter((c) => c.vendedorId === v.nombre && c.estado === "Interesado").length,
              }));
              return exportarExcel(filas, "Vendedores", "resumen_vendedores");
            })
          }
          className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Descargar
        </button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">📥 Base de clientes cargados (sin filtrar)</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Todos los {clientes.length} clientes cargados en la base, estén o no asignados.</p>
        <button
          disabled={busy}
          onClick={() =>
            run(() =>
              exportarExcel(
                clientes.map((c) => ({ Nombre: c.nombre, CUIT: c.cuit || "", Tel: c.telefono || "", Ciudad: c.ciudad || "", Provincia: c.provincia || "", Rubro: c.rubro || "", Tipo: c.tipo })),
                "Clientes",
                "base_clientes_completa"
              )
            )
          }
          className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Descargar
        </button>
      </div>
    </div>
  );
}
