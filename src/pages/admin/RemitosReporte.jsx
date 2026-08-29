// src/pages/admin/RemitosReporte.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeBusinessDashboardDetail, subscribeRemitosDespachosDetail, importarRemitos } from "../../services/comprobantes";
import { subscribeCobranzas } from "../../services/cobranzas";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function hoy() {
  return new Date().toISOString().slice(0, 10);
}
function haceNDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function weekStart(fechaISO) {
  const d = new Date(fechaISO + "T00:00:00");
  const day = d.getDay(); // 0=domingo
  const diff = day === 0 ? -6 : 1 - day; // llevar al lunes
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function periodo(fechaISO, modo) {
  if (!fechaISO) return "sin-fecha";
  return modo === "semana" ? weekStart(fechaISO) : fechaISO.slice(0, 7);
}

function labelPeriodo(p, modo) {
  if (p === "sin-fecha") return "Sin fecha";
  if (modo === "mes") {
    const [y, m] = p.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", { month: "short", year: "numeric" });
  }
  const start = new Date(p + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)}–${fmt(end)}`;
}

function normalizarNombre(s) {
  return (s || "").trim().toUpperCase();
}

export default function RemitosReporte() {
  const [remitosDetail, setRemitosDetail] = useState(null);
  const [businessDetail, setBusinessDetail] = useState(null);
  const [cobranzas, setCobranzas] = useState(null);
  const [desde, setDesde] = useState(haceNDias(90));
  const [hasta, setHasta] = useState(hoy());
  const [modo, setModo] = useState("mes"); // "mes" | "semana"
  const [search, setSearch] = useState("");
  const [importando, setImportando] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  async function handleImportarArchivos(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImportando(true);
    setImportError("");
    setImportResult(null);
    try {
      const arrays = await Promise.all(
        files.map(
          (f) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const parsed = JSON.parse(reader.result);
                  resolve(Array.isArray(parsed) ? parsed : []);
                } catch (err) {
                  reject(new Error(`"${f.name}" no es un JSON válido`));
                }
              };
              reader.onerror = () => reject(new Error(`No se pudo leer "${f.name}"`));
              reader.readAsText(f);
            })
        )
      );
      const remitos = arrays.flat();
      if (remitos.length === 0) throw new Error("Los archivos no tienen remitos (¿son el JSON de detalle, no el de listado?)");
      const result = await importarRemitos(remitos);
      setImportResult(result);
    } catch (err) {
      setImportError(err.message || "No se pudo importar");
    } finally {
      setImportando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    const u1 = subscribeRemitosDespachosDetail(setRemitosDetail);
    const u2 = subscribeBusinessDashboardDetail(setBusinessDetail);
    const u3 = subscribeCobranzas(setCobranzas, () => setCobranzas([]));
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const loading = remitosDetail === null || businessDetail === null || cobranzas === null;

  const dentroDeRango = (fecha) => fecha && fecha >= desde && fecha <= hasta;

  const remitosFiltrados = useMemo(
    () => (remitosDetail?.porRemito || []).filter((r) => !r.esInterno && dentroDeRango(r.fecha)),
    [remitosDetail, desde, hasta]
  );
  const facturasFiltradas = useMemo(
    () => (businessDetail?.porFactura || []).filter((f) => dentroDeRango(f.fecha)),
    [businessDetail, desde, hasta]
  );
  const cobranzasFiltradas = useMemo(
    () => (cobranzas || []).filter((c) => dentroDeRango((c.fecha || "").slice(0, 10))),
    [cobranzas, desde, hasta]
  );

  const totales = useMemo(() => {
    const bicisConsignadas = remitosFiltrados.reduce((a, r) => a + r.bicis, 0);
    const bicisFacturadas = facturasFiltradas.reduce((a, f) => a + f.bicis, 0);
    const facturado = facturasFiltradas.reduce((a, f) => a + f.facturado, 0);
    const cobrado = cobranzasFiltradas.reduce((a, c) => a + Number(c.importeReal ?? c.importeTotal ?? 0), 0);
    return { bicisConsignadas, bicisFacturadas, facturado, cobrado };
  }, [remitosFiltrados, facturasFiltradas, cobranzasFiltradas]);

  const porPeriodo = useMemo(() => {
    const map = new Map();
    function get(p) {
      if (!map.has(p)) map.set(p, { periodo: p, bicisConsignadas: 0, bicisFacturadas: 0, facturado: 0, cobrado: 0 });
      return map.get(p);
    }
    remitosFiltrados.forEach((r) => (get(periodo(r.fecha, modo)).bicisConsignadas += r.bicis));
    facturasFiltradas.forEach((f) => {
      const row = get(periodo(f.fecha, modo));
      row.bicisFacturadas += f.bicis;
      row.facturado += f.facturado;
    });
    cobranzasFiltradas.forEach((c) => {
      const row = get(periodo((c.fecha || "").slice(0, 10), modo));
      row.cobrado += Number(c.importeReal ?? c.importeTotal ?? 0);
    });
    return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  }, [remitosFiltrados, facturasFiltradas, cobranzasFiltradas, modo]);

  const porCliente = useMemo(() => {
    const map = new Map();
    function get(nombre) {
      const key = normalizarNombre(nombre);
      if (!map.has(key)) map.set(key, { nombre: nombre || "(sin nombre)", bicisConsignadas: 0, bicisFacturadas: 0, facturado: 0, cobrado: 0 });
      return map.get(key);
    }
    remitosFiltrados.forEach((r) => (get(r.cliente).bicisConsignadas += r.bicis));
    facturasFiltradas.forEach((f) => {
      const row = get(f.cliente);
      row.bicisFacturadas += f.bicis;
      row.facturado += f.facturado;
    });
    cobranzasFiltradas.forEach((c) => {
      const row = get(c.razonSocial);
      row.cobrado += Number(c.importeReal ?? c.importeTotal ?? 0);
    });
    let rows = [...map.values()].sort((a, b) => b.facturado - a.facturado);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.nombre.toLowerCase().includes(q));
    }
    return rows;
  }, [remitosFiltrados, facturasFiltradas, cobranzasFiltradas, search]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Remitos, Facturación y Cobranza</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Cruce por fecha de lo entregado en consigna, lo facturado y lo cobrado. Remitos internos (FEPA→FEPA) excluidos.
        </p>
      </div>

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">📤 Importar remitos</h2>
        <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
          Subí el/los archivo(s) <code>.json</code> que descarga el script de consola en Contabilium. Identifica cada remito por su ID — si
          subís uno que ya estaba, lo actualiza en vez de duplicarlo. Podés subir varios archivos juntos.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            multiple
            onChange={handleImportarArchivos}
            disabled={importando}
            className="text-xs text-indigo-900 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-700 dark:text-indigo-300"
          />
          {importando && <span className="text-xs text-indigo-700 dark:text-indigo-400">Procesando…</span>}
        </div>
        {importResult && (
          <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            ✅ {importResult.nuevos} remito(s) nuevo(s), {importResult.actualizados} actualizado(s) — total en el registro:{" "}
            {importResult.total}.
          </p>
        )}
        {importError && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{importError}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 p-1 dark:border-neutral-700">
          {[
            { id: "semana", label: "Por semana" },
            { id: "mes", label: "Por mes" },
          ].map((op) => (
            <button
              key={op.id}
              onClick={() => setModo(op.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                modo === op.id ? "bg-slate-900 text-white dark:bg-neutral-700" : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {op.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[7, 30, 90, 365].map((n) => (
            <button
              key={n}
              onClick={() => {
                setDesde(haceNDias(n));
                setHasta(hoy());
              }}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-xs text-amber-700 dark:text-amber-400">Bicis entregadas en consigna</p>
              <p className="mt-1 text-xl font-bold text-amber-900 dark:text-amber-300">{totales.bicisConsignadas.toLocaleString("es-AR")}</p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
              <p className="text-xs text-sky-700 dark:text-sky-400">Bicis facturadas</p>
              <p className="mt-1 text-xl font-bold text-sky-900 dark:text-sky-300">{totales.bicisFacturadas.toLocaleString("es-AR")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-slate-500 dark:text-neutral-400">Facturado</p>
              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{money(totales.facturado)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Cobrado</p>
              <p className="mt-1 text-xl font-bold text-emerald-800 dark:text-emerald-300">{money(totales.cobrado)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              {modo === "semana" ? "Por semana" : "Por mes"}
            </h2>
            {porPeriodo.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500">Sin datos en este rango.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500 dark:text-neutral-400">
                    <tr>
                      <th className="py-1.5 pr-3">Período</th>
                      <th className="py-1.5 pr-3 text-right">Consignadas</th>
                      <th className="py-1.5 pr-3 text-right">Facturadas</th>
                      <th className="py-1.5 pr-3 text-right">Facturado</th>
                      <th className="py-1.5 text-right">Cobrado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                    {porPeriodo.map((row) => (
                      <tr key={row.periodo}>
                        <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-neutral-300">{labelPeriodo(row.periodo, modo)}</td>
                        <td className="py-1.5 pr-3 text-right">{row.bicisConsignadas || "-"}</td>
                        <td className="py-1.5 pr-3 text-right">{row.bicisFacturadas || "-"}</td>
                        <td className="py-1.5 pr-3 text-right">{row.facturado ? money(row.facturado) : "-"}</td>
                        <td className="py-1.5 text-right">{row.cobrado ? money(row.cobrado) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Totales por cliente ({porCliente.length})</h2>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente…"
                className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              />
            </div>
            {porCliente.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500">Sin datos en este rango.</p>
            ) : (
              <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
                    <tr>
                      <th className="py-1.5 pr-3">Cliente</th>
                      <th className="py-1.5 pr-3 text-right">Consignadas</th>
                      <th className="py-1.5 pr-3 text-right">Facturadas</th>
                      <th className="py-1.5 pr-3 text-right">Facturado</th>
                      <th className="py-1.5 text-right">Cobrado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                    {porCliente.map((row) => (
                      <tr key={row.nombre}>
                        <td className="py-1.5 pr-3 text-slate-700 dark:text-neutral-300">{row.nombre}</td>
                        <td className="py-1.5 pr-3 text-right">{row.bicisConsignadas || "-"}</td>
                        <td className="py-1.5 pr-3 text-right">{row.bicisFacturadas || "-"}</td>
                        <td className="py-1.5 pr-3 text-right">{row.facturado ? money(row.facturado) : "-"}</td>
                        <td className="py-1.5 text-right">{row.cobrado ? money(row.cobrado) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
