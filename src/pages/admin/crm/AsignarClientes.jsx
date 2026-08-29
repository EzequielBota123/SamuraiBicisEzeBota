import { useMemo, useState } from "react";
import { addVendedor, deleteVendedor, renameVendedor, upsertAsignaciones } from "./crmApi";
import { fcExtraer, fcSerializarVend } from "./notasCodec";
import { normTxt, soloDigitos, waUrl } from "./utils";
import { useActiveVendor } from "./ActiveVendorContext";

// Metadata conocida para los tipos "de siempre" — orden y color fijos.
// Cualquier tipo nuevo que aparezca en los datos (ej. una lista que se
// importe más adelante) se agrega solo al final, con un color genérico,
// sin tener que tocar este archivo.
const TIPOS_CONOCIDOS = [
  { tipo: "Credifin", label: "🟢 CREDIFIN", prefix: "cred", color: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400" },
  { tipo: "Sin Credifin", label: "🟡 SIN CREDIFIN", prefix: "sin", color: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400" },
  { tipo: "Retail", label: "🔵 RETAIL", prefix: "retail", color: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400" },
  { tipo: "Samurai", label: "🐯 SAMURAI (clientes propios)", prefix: "sam", color: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400" },
];
const COLOR_GENERICO = "border-slate-200 bg-slate-50 text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";

export default function AsignarClientes({ crm }) {
  const { vendedores, clientes, asignacionByCliente, reload } = crm;
  const { activeVendedor: vendedorActivo, setActiveVendedor: setVendedorActivo } = useActiveVendor();
  const [destino, setDestino] = useState("telemarketer");
  const [nuevoVendedor, setNuevoVendedor] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [selected, setSelected] = useState({}); // { [tipo]: Set(ids) }
  const [filters, setFilters] = useState({}); // { [tipo]: {nombre,cuit,telefono,provincia,ciudad,rubro} }
  const [asignando, setAsignando] = useState(false);
  const [msg, setMsg] = useState(null); // {text,color}
  const [listaFiltro, setListaFiltro] = useState("Todas");

  // Se recalcula cada vez que cambian los clientes (realtime) — si aparece
  // un tipo nuevo que no está en TIPOS_CONOCIDOS, se agrega solo.
  const TIPOS = useMemo(() => {
    const tiposEnDatos = Array.from(new Set(clientes.map((c) => c.tipo).filter(Boolean)));
    const conocidos = TIPOS_CONOCIDOS.filter((t) => tiposEnDatos.includes(t.tipo));
    const nuevos = tiposEnDatos
      .filter((tipo) => !TIPOS_CONOCIDOS.some((t) => t.tipo === tipo))
      .sort()
      .map((tipo) => ({ tipo, label: `⚪ ${tipo.toUpperCase()}`, prefix: tipo, color: COLOR_GENERICO }));
    return [...conocidos, ...nuevos];
  }, [clientes]);

  const TIPOS_VISIBLES = listaFiltro === "Todas" ? TIPOS : TIPOS.filter((t) => t.tipo === listaFiltro);

  function toast(text, ok = true) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  }

  function getFilter(tipo) {
    return filters[tipo] || { nombre: "", cuit: "", telefono: "", provincia: "", ciudad: "", rubro: "" };
  }
  function setFilter(tipo, patch) {
    setFilters((prev) => ({ ...prev, [tipo]: { ...getFilter(tipo), ...patch } }));
  }
  function getSelected(tipo) {
    return selected[tipo] || new Set();
  }
  function toggleSel(tipo, id) {
    setSelected((prev) => {
      const s = new Set(prev[tipo] || []);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return { ...prev, [tipo]: s };
    });
  }
  function selectAll(tipo, ids) {
    setSelected((prev) => ({ ...prev, [tipo]: new Set(ids) }));
  }
  function deselectAll(tipo) {
    setSelected((prev) => ({ ...prev, [tipo]: new Set() }));
  }

  const totalSeleccionados = TIPOS.reduce((acc, { tipo }) => acc + getSelected(tipo).size, 0);

  async function handleAgregarVendedor() {
    const nombre = nuevoVendedor.trim();
    if (!nombre) return;
    if (vendedores.some((v) => v.nombre === nombre)) {
      toast("Ya existe ese vendedor", false);
      return;
    }
    try {
      await addVendedor(nombre);
      setNuevoVendedor("");
      await reload();
    } catch (err) {
      toast(err.message || "Error agregando vendedor", false);
    }
  }

  async function handleRenameVendedor(id) {
    const nombre = editingName.trim();
    if (!nombre) return;
    try {
      await renameVendedor(id, nombre);
      setEditingId(null);
      await reload();
    } catch (err) {
      toast(err.message || "Error editando vendedor", false);
    }
  }

  async function handleDeleteVendedor(v) {
    if (!confirm(`¿Eliminar al vendedor "${v.nombre}"? No se borran sus clientes ya asignados.`)) return;
    try {
      await deleteVendedor(v.id);
      if (vendedorActivo === v.nombre) setVendedorActivo("");
      await reload();
    } catch (err) {
      toast(err.message || "Error eliminando vendedor", false);
    }
  }

  async function handleAsignar() {
    if (!vendedorActivo) {
      toast("Elegí un vendedor del selector o hacé clic en una tarjeta", false);
      return;
    }
    const seleccionados = [];
    TIPOS.forEach(({ tipo }) => {
      getSelected(tipo).forEach((id) => seleccionados.push(id));
    });
    if (seleccionados.length === 0) {
      toast("Marcá al menos un cliente con el checkbox", false);
      return;
    }
    setAsignando(true);
    try {
      const esVendedor = destino === "vendedor";
      const payload = seleccionados.map((id) => {
        const existente = asignacionByCliente[id];
        if (esVendedor) {
          const decoded = fcExtraer(existente?.notas || "");
          return {
            cliente_id: id,
            vendedor_nombre: vendedorActivo,
            estado: "Interesado",
            notas: fcSerializarVend(decoded.fecha || null, decoded.notas || [], vendedorActivo, decoded.estadoVend || ""),
          };
        }
        const estExistente = existente?.estado || "Sin contactar";
        return {
          cliente_id: id,
          vendedor_nombre: vendedorActivo,
          estado: estExistente,
          notas: existente?.notas || "",
        };
      });
      await upsertAsignaciones(payload);
      TIPOS.forEach(({ tipo }) => deselectAll(tipo));
      await reload();
      const destLabel = esVendedor ? "CRM Vendedores" : "CRM Telemarketers";
      toast(`${payload.length} cliente(s) asignados a ${vendedorActivo} (${destLabel})`);
    } catch (err) {
      toast(err.message || "Error al asignar", false);
    } finally {
      setAsignando(false);
    }
  }

  return (
    <div className="space-y-5">
      {msg && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"}`}>
          {msg.ok ? "✅ " : "⚠️ "}
          {msg.text}
        </div>
      )}

      <div className="rounded-3xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400">
        📌 <strong>Cómo asignar:</strong> 1) Hacé clic en una tarjeta de vendedor → 2) Marcá los clientes que quieras con los checkboxes → 3) Hacé clic en Asignar.
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* Vendedores */}
        <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">👤 Vendedores</h3>
          <div className="grid grid-cols-2 gap-2">
            {vendedores.length === 0 && (
              <p className="col-span-2 py-4 text-center text-xs text-slate-400 dark:text-neutral-500">Sin vendedores. Agregá uno abajo.</p>
            )}
            {vendedores.map((v) => (
              <div
                key={v.id}
                onClick={() => setVendedorActivo(v.nombre)}
                className={`cursor-pointer rounded-2xl border p-3 text-center transition ${
                  vendedorActivo === v.nombre ? "border-sky-500 bg-sky-50 dark:border-sky-500 dark:bg-sky-950/40" : "border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600"
                }`}
              >
                {editingId === v.id ? (
                  <input
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 px-1 py-0.5 text-center text-xs dark:border-neutral-600 dark:bg-neutral-900 dark:text-white"
                    value={editingName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRenameVendedor(v.id)}
                    onBlur={() => handleRenameVendedor(v.id)}
                  />
                ) : (
                  <div className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-200">{v.nombre}</div>
                )}
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {crm.asignaciones.filter((a) => a.vendedor_nombre === v.nombre).length}
                </div>
                <div className="mt-1 flex justify-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(v.id);
                      setEditingName(v.nombre);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-sky-500"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteVendedor(v);
                    }}
                    className="rounded-lg border border-rose-200 bg-white px-1.5 py-0.5 text-[10px] text-rose-500 hover:bg-rose-50 dark:border-rose-900 dark:bg-neutral-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <input
              value={nuevoVendedor}
              onChange={(e) => setNuevoVendedor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAgregarVendedor()}
              placeholder="Nombre del vendedor"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500"
            />
            <button onClick={handleAgregarVendedor} className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-neutral-800 dark:hover:bg-neutral-700">
              + Agregar
            </button>
          </div>
        </div>

        {/* Barra de asignación */}
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
              🔎 Lista
              <select
                value={listaFiltro}
                onChange={(e) => setListaFiltro(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              >
                <option value="Todas">Todas las listas</option>
                {TIPOS.map(({ tipo, label }) => (
                  <option key={tipo} value={tipo}>
                    {label} ({clientes.filter((c) => c.tipo === tipo).length})
                  </option>
                ))}
              </select>
            </label>
            <select
              value={vendedorActivo}
              onChange={(e) => setVendedorActivo(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            >
              <option value="">— Elegí un vendedor —</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.nombre}>
                  {v.nombre}
                </option>
              ))}
            </select>
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            >
              <option value="telemarketer">📞 A Telemarketer (Sin contactar)</option>
              <option value="vendedor">🤝 En manos de vendedor</option>
            </select>
            <span className="text-sm text-slate-500 dark:text-neutral-400">{totalSeleccionados} seleccionado(s)</span>
            <button
              onClick={handleAsignar}
              disabled={asignando}
              className="ml-auto rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {asignando ? "Guardando…" : "✅ Asignar"}
            </button>
          </div>

          {TIPOS_VISIBLES.map(({ tipo, label, prefix, color }) => (
            <TipoSection
              key={tipo}
              tipo={tipo}
              label={label}
              prefix={prefix}
              color={color}
              clientes={clientes}
              asignacionByCliente={asignacionByCliente}
              filter={getFilter(tipo)}
              setFilter={(patch) => setFilter(tipo, patch)}
              selected={getSelected(tipo)}
              toggleSel={(id) => toggleSel(tipo, id)}
              selectAll={(ids) => selectAll(tipo, ids)}
              deselectAll={() => deselectAll(tipo)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TipoSection({ tipo, label, prefix, color, clientes, asignacionByCliente, filter, setFilter, selected, toggleSel, selectAll, deselectAll }) {
  const todos = useMemo(() => clientes.filter((c) => c.tipo === tipo), [clientes, tipo]);

  const provincias = useMemo(() => {
    const set = new Set(todos.map((c) => c.provincia).filter(Boolean));
    return Array.from(set).sort();
  }, [todos]);

  const esSamurai = tipo === "Samurai";

  const filtrados = useMemo(() => {
    const cuitDig = soloDigitos(filter.cuit);
    const telDig = soloDigitos(filter.telefono);
    return todos.filter(
      (c) =>
        (!filter.nombre || normTxt(c.nombre).includes(normTxt(filter.nombre))) &&
        (!filter.cuit || (cuitDig ? soloDigitos(c.cuit).includes(cuitDig) : normTxt(c.cuit).includes(normTxt(filter.cuit)))) &&
        (!filter.telefono || !telDig || soloDigitos(c.telefono).includes(telDig) || soloDigitos(c.telefono2).includes(telDig)) &&
        (!filter.provincia || c.provincia === filter.provincia) &&
        (!filter.ciudad || normTxt(c.ciudad).includes(normTxt(filter.ciudad))) &&
        (!filter.rubro || normTxt(c.rubro).includes(normTxt(filter.rubro))) &&
        (!esSamurai || !filter.contactadoVideo || filter.contactadoVideo === "todos" ||
          (filter.contactadoVideo === "contactado" ? !!c.contactado : !c.contactado)) &&
        (!esSamurai || !filter.videoEstado || filter.videoEstado === "todos" || c.videoEstado === filter.videoEstado)
    );
  }, [todos, filter, esSamurai]);

  const allChecked = filtrados.length > 0 && filtrados.every((c) => selected.has(c.id));

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <div className={`flex items-center justify-between border-b px-4 py-3 ${color}`}>
        <span className="text-sm font-bold">
          {label} — {todos.length} clientes
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-slate-100 p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-neutral-800">
        <input placeholder="Nombre" value={filter.nombre} onChange={(e) => setFilter({ nombre: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500" />
        <input placeholder="CUIT" value={filter.cuit} onChange={(e) => setFilter({ cuit: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500" />
        <input placeholder="Teléfono" value={filter.telefono} onChange={(e) => setFilter({ telefono: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500" />
        <select value={filter.provincia} onChange={(e) => setFilter({ provincia: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white">
          <option value="">Todas las provincias</option>
          {provincias.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input placeholder="Ciudad" value={filter.ciudad} onChange={(e) => setFilter({ ciudad: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500" />
        <input placeholder="Rubro" value={filter.rubro} onChange={(e) => setFilter({ rubro: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500" />
        {esSamurai && (
          <>
            <select
              value={filter.contactadoVideo || "todos"}
              onChange={(e) => setFilter({ contactadoVideo: e.target.value })}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            >
              <option value="todos">Contactado: todos</option>
              <option value="contactado">✓ Contactado</option>
              <option value="sin_contactar">Sin contactar</option>
            </select>
            <select
              value={filter.videoEstado || "todos"}
              onChange={(e) => setFilter({ videoEstado: e.target.value })}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            >
              <option value="todos">Video: todos</option>
              <option value="sin video">Sin video (nunca)</option>
              <option value="vencido">Vencido</option>
              <option value="por vencer">Por vencer</option>
              <option value="al dia">Al día</option>
              <option value="no aplica">No aplica (sin depósito)</option>
            </select>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 px-4 py-2 text-xs text-slate-500 dark:text-neutral-400">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={allChecked} onChange={(e) => (e.target.checked ? selectAll(filtrados.map((c) => c.id)) : deselectAll())} />
          Sel. todo
        </label>
        <button onClick={deselectAll} className="rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
          Deseleccionar
        </button>
        <span className="ml-auto">{filtrados.length} resultado(s)</span>
      </div>

      <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">CUIT</th>
              <th className="px-3 py-2">Rubro</th>
              <th className="px-3 py-2">Provincia</th>
              <th className="px-3 py-2">Ciudad</th>
              <th className="px-3 py-2">Teléfono</th>
              {esSamurai && <th className="px-3 py-2">Video</th>}
              {esSamurai && <th className="px-3 py-2">Contactado</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
            {filtrados.map((c) => {
              const asig = asignacionByCliente[c.id];
              const wa = waUrl(c.telefono);
              return (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/60">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-neutral-200">
                    {c.nombre}
                    {asig?.vendedor_nombre && <span className="ml-1.5 text-[10px] font-bold text-violet-600 dark:text-violet-400">→{asig.vendedor_nombre}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{c.cuit || "-"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{c.rubro || "-"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{c.provincia || "-"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{c.ciudad || "-"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">
                    {wa ? (
                      <a href={wa} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline dark:text-emerald-400">
                        📱 {c.telefono}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  {esSamurai && (
                    <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">
                      {c.videoEstado ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            c.videoEstado === "vencido"
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400"
                              : c.videoEstado === "por vencer"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                              : c.videoEstado === "al dia"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                              : "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"
                          }`}
                        >
                          {c.videoEstado}
                          {c.videoUltimaFecha ? ` · ${c.videoUltimaFecha.toLocaleDateString("es-AR")}` : ""}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  )}
                  {esSamurai && (
                    <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">
                      {c.contactado ? (
                        <span className="inline-flex flex-col text-[11px]">
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">✓ Contactado</span>
                          {c.contactadoFecha && (
                            <span className="text-slate-400 dark:text-neutral-500">
                              {c.contactadoFecha.toLocaleDateString("es-AR")}{" "}
                              {c.contactadoFecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} hs
                            </span>
                          )}
                          {c.contactadoPor && <span className="text-slate-400 dark:text-neutral-500">{c.contactadoPor}</span>}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-neutral-500">Sin contactar</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={esSamurai ? 9 : 7} className="px-3 py-8 text-center text-slate-400 dark:text-neutral-500">
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
