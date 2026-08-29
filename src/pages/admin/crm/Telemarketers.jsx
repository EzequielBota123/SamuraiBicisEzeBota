import { useMemo, useState } from "react";
import { deleteAsignacion, updateAsignacion } from "./crmApi";
import { ESTADOS, fcSerializarVend, getEst } from "./notasCodec";
import { normTxt, waUrl } from "./utils";
import { useActiveVendor } from "./ActiveVendorContext";

export default function Telemarketers({ crm }) {
  const { vendedores, asignados, reload } = crm;
  const { activeVendedor: vendedorActivo, setActiveVendedor: setVendedorActivo } = useActiveVendor();
  const autor = vendedorActivo || "Admin";
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [selId, setSelId] = useState(null);
  const [nuevaNota, setNuevaNota] = useState("");
  const [pasandoAVendedor, setPasandoAVendedor] = useState(false);
  const [vendedorVenta, setVendedorVenta] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  function toast(text, ok = true) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }

  const todos = useMemo(() => asignados.filter((c) => c.vendedorId === vendedorActivo), [asignados, vendedorActivo]);

  const filtrados = useMemo(() => {
    const q = normTxt(busqueda);
    return todos.filter((c) => {
      const okEstado = filtroEstado === "todos" || c.estado === filtroEstado;
      const okBusq = !q || normTxt(c.nombre).includes(q) || normTxt(c.ciudad).includes(q) || normTxt(c.telefono).includes(q);
      return okEstado && okBusq;
    });
  }, [todos, filtroEstado, busqueda]);

  const seleccionado = todos.find((c) => String(c.id) === String(selId)) || null;

  async function cambiarEstado(estado, vendedorParam) {
    if (!seleccionado) return;
    setBusy(true);
    try {
      const dbEstado = estado === "En manos de vendedor" ? "Interesado" : estado;
      let fc = seleccionado.fecha_contacto;
      if (estado !== "Sin contactar" && !fc) fc = new Date().toISOString();
      let vv = "";
      if (estado === "En manos de vendedor") vv = vendedorParam || seleccionado.vendedorVenta || "";
      const notas = fcSerializarVend(fc, seleccionado.notasHistorial || [], vv, vv ? seleccionado.estadoVend : "");
      await updateAsignacion(seleccionado.id, { estado: dbEstado, notas });
      await reload();
      setPasandoAVendedor(false);
      toast(`Estado → ${estado}`);
    } catch (err) {
      toast(err.message || "Error cambiando estado", false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmarPasarAVendedor() {
    if (!vendedorVenta) {
      toast("Elegí un vendedor", false);
      return;
    }
    setFiltroEstado("En manos de vendedor");
    await cambiarEstado("En manos de vendedor", vendedorVenta);
    setVendedorVenta("");
  }

  async function guardarNota() {
    if (!seleccionado || !nuevaNota.trim()) return;
    setBusy(true);
    try {
      const nota = { t: nuevaNota.trim(), f: new Date().toISOString(), u: autor };
      const notas = [...(seleccionado.notasHistorial || []), nota];
      const notasStr = fcSerializarVend(seleccionado.fecha_contacto || null, notas, seleccionado.vendedorVenta || "", seleccionado.estadoVend || "");
      await updateAsignacion(seleccionado.id, { notas: notasStr });
      await reload();
      setNuevaNota("");
      toast("💾 Nota guardada");
    } catch (err) {
      toast(err.message || "Error guardando nota", false);
    } finally {
      setBusy(false);
    }
  }

  async function quitarDeCartera() {
    if (!seleccionado || !confirm("¿Quitar este cliente de la cartera?")) return;
    setBusy(true);
    try {
      await deleteAsignacion(seleccionado.id);
      setSelId(null);
      await reload();
      toast("🗑️ Cliente quitado de la cartera");
    } catch (err) {
      toast(err.message || "Error quitando cliente", false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <select
          value={vendedorActivo}
          onChange={(e) => {
            setVendedorActivo(e.target.value);
            setSelId(null);
          }}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:focus:border-sky-500"
        >
          <option value="">— Elegí un vendedor —</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.nombre}>
              {v.nombre}
            </option>
          ))}
        </select>
        <input
          placeholder="Buscar nombre, ciudad o teléfono…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 sm:w-64 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-sky-500"
        />
      </div>

      {!vendedorActivo ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500">
          Elegí un vendedor para ver su cartera de clientes.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatBox label="Total" value={todos.length} color="#0066cc" />
            <StatBox label="Credifin" value={todos.filter((c) => c.tipo === "Credifin").length} color="#16a34a" />
            <StatBox label="Sin Credifin" value={todos.filter((c) => c.tipo === "Sin Credifin").length} color="#d97706" />
            <StatBox label="Retail" value={todos.filter((c) => c.tipo === "Retail").length} color="#7c3aed" />
            <StatBox label="Cerrados" value={todos.filter((c) => c.estado === "Cerrado").length} color="#15803d" />
            <StatBox label="Con vendedor" value={todos.filter((c) => c.estado === "En manos de vendedor").length} color="#7c3aed" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill active={filtroEstado === "todos"} onClick={() => setFiltroEstado("todos")} label={`Todos ${todos.length}`} />
            {ESTADOS.filter((e) => e.key !== "No interesado").map((e) => (
              <Pill
                key={e.key}
                active={filtroEstado === e.key}
                onClick={() => setFiltroEstado(e.key)}
                label={`${e.icon} ${e.key} ${todos.filter((c) => c.estado === e.key).length}`}
                color={e.color}
                bg={e.bg}
              />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="max-h-[600px] overflow-y-auto rounded-3xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
              {filtrados.length === 0 && <p className="p-8 text-center text-sm text-slate-400 dark:text-neutral-500">Sin clientes.</p>}
              {filtrados.map((c) => {
                const est = getEst(c.estado);
                const sel = String(selId) === String(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelId(c.id)}
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition dark:border-neutral-800 ${sel ? "bg-sky-50 dark:bg-neutral-800" : "hover:bg-slate-50 dark:hover:bg-neutral-800/60"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-slate-800 dark:text-neutral-200">{c.nombre}</span>
                      <span className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold" style={{ color: est.color, background: est.bg }}>
                        {est.icon} {est.key}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400">
                      {c.ciudad}
                      {c.provincia ? ` — ${c.provincia}` : ""} · {c.telefono || "—"}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              {!seleccionado ? (
                <p className="py-16 text-center text-sm text-slate-400 dark:text-neutral-500">← Seleccioná un cliente de la lista</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{seleccionado.nombre}</h3>
                    <p className="text-xs text-slate-400 dark:text-neutral-500">{seleccionado.tipo}</p>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <Field label="Teléfono" value={seleccionado.telefono} wa={waUrl(seleccionado.telefono)} />
                    <Field label="Email" value={seleccionado.email} />
                    <Field label="Dirección" value={seleccionado.direccion} />
                    <Field label="Ciudad/Provincia" value={[seleccionado.ciudad, seleccionado.provincia].filter(Boolean).join(" — ")} />
                    <Field label="Rubro" value={seleccionado.rubro} />
                    <Field label="CUIT" value={seleccionado.cuit} />
                  </div>

                  {seleccionado.estado === "En manos de vendedor" ? (
                    <div className="space-y-2">
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                        <div className="font-bold text-amber-800 dark:text-amber-400">🤝 En manos de vendedor</div>
                        <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">👤 {seleccionado.vendedorVenta || "—"}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button disabled={busy} onClick={() => cambiarEstado("Cerrado")} className="rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600">
                          ✅ Cerrado
                        </button>
                        <button disabled={busy} onClick={() => cambiarEstado("Interesado")} className="rounded-xl bg-amber-500 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-500">
                          ⭐ Mantener Interesado
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-slate-400 dark:text-neutral-500">Cambiar estado</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {ESTADOS.filter((e) => e.key !== "En manos de vendedor").map((e) => (
                          <button
                            key={e.key}
                            disabled={busy}
                            onClick={() => cambiarEstado(e.key)}
                            className="rounded-lg border px-2 py-1.5 text-xs font-semibold transition disabled:opacity-60"
                            style={{
                              borderColor: seleccionado.estado === e.key ? e.color : "#e2e8f0",
                              color: e.color,
                              background: seleccionado.estado === e.key ? e.bg : "white",
                            }}
                          >
                            {e.icon} {e.key}
                          </button>
                        ))}
                      </div>
                      {seleccionado.estado === "Interesado" && (
                        <>
                          <button onClick={() => setPasandoAVendedor((v) => !v)} className="w-full rounded-xl bg-violet-600 py-2 text-xs font-semibold text-white hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600">
                            🤝 Pasar a vendedor
                          </button>
                          {pasandoAVendedor && (
                            <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/40">
                              <select value={vendedorVenta} onChange={(e) => setVendedorVenta(e.target.value)} className="w-full rounded-lg border border-violet-300 px-2 py-1.5 text-xs dark:border-violet-800 dark:bg-neutral-900 dark:text-white">
                                <option value="">— Elegí un vendedor —</option>
                                {vendedores.map((v) => (
                                  <option key={v.id} value={v.nombre}>
                                    {v.nombre}
                                  </option>
                                ))}
                              </select>
                              <div className="flex gap-2">
                                <button onClick={confirmarPasarAVendedor} className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600">
                                  ✅ Confirmar
                                </button>
                                <button onClick={() => setPasandoAVendedor(false)} className="flex-1 rounded-lg bg-slate-300 py-1.5 text-xs font-semibold text-slate-700 dark:bg-neutral-700 dark:text-neutral-200">
                                  ✖ Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase text-slate-400 dark:text-neutral-500">Notas</p>
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {(seleccionado.notasHistorial || []).length === 0 && <p className="text-xs text-slate-400 dark:text-neutral-500">Sin notas todavía.</p>}
                      {(seleccionado.notasHistorial || []).map((n, i) => (
                        <div key={i} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-neutral-800">
                          <p className="text-slate-700 dark:text-neutral-300">{n.t}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400 dark:text-neutral-500">
                            {n.u || "—"} · {n.f ? new Date(n.f).toLocaleString("es-AR") : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={nuevaNota}
                        onChange={(e) => setNuevaNota(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && guardarNota()}
                        placeholder="Escribir nota…"
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-sky-500"
                      />
                      <button onClick={guardarNota} disabled={busy} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-800 dark:hover:bg-neutral-700">
                        Guardar
                      </button>
                    </div>
                  </div>

                  <button onClick={quitarDeCartera} disabled={busy} className="w-full rounded-xl border border-rose-200 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40">
                    🗑️ Quitar de la cartera
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-xl font-bold" style={{ color }}>
        {value}
      </p>
      <p className="text-[11px] text-slate-500 dark:text-neutral-400">{label}</p>
    </div>
  );
}

function Pill({ active, onClick, label, color, bg }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-semibold transition"
      style={
        active
          ? { borderColor: color || "#0ea5e9", color: color || "#0369a1", background: bg || "#e0f2fe" }
          : { borderColor: "#e2e8f0", color: "#64748b", background: "white" }
      }
    >
      {label}
    </button>
  );
}

function Field({ label, value, wa }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 pb-1 dark:border-neutral-800">
      <span className="text-slate-400 dark:text-neutral-500">{label}</span>
      {wa ? (
        <a href={wa} target="_blank" rel="noreferrer" className="font-medium text-emerald-600 hover:underline dark:text-emerald-400">
          📱 {value}
        </a>
      ) : (
        <span className="font-medium text-slate-700 dark:text-neutral-200">{value}</span>
      )}
    </div>
  );
}
