import { useMemo, useState } from "react";
import { updateAsignacion } from "./crmApi";
import { ESTADOS_VEND, fcSerializarVend, getEstVend } from "./notasCodec";
import { normTxt, waUrl } from "./utils";
import { useActiveVendor } from "./ActiveVendorContext";

export default function VendedoresTab({ crm }) {
  const { vendedores, asignados, reload } = crm;
  const { activeVendedor: vendActivo, setActiveVendedor: setVendActivo } = useActiveVendor();
  const autor = vendActivo || "Vendedor";
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [selId, setSelId] = useState(null);
  const [nuevaNota, setNuevaNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  function toast(text, ok = true) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }

  const todos = useMemo(
    () =>
      asignados.filter(
        (c) => c.vendedorVenta === vendActivo && (c.estado === "En manos de vendedor" || (c.estado === "Cerrado" && c.estadoVend === "Cerrado"))
      ),
    [asignados, vendActivo]
  );

  const filtrados = useMemo(() => {
    const q = normTxt(busqueda);
    return todos.filter((c) => {
      const okEstado = filtroEstado === "todos" || (c.estadoVend || "En proceso") === filtroEstado;
      const okBusq = !q || normTxt(c.nombre).includes(q) || normTxt(c.ciudad).includes(q) || normTxt(c.telefono).includes(q);
      return okEstado && okBusq;
    });
  }, [todos, filtroEstado, busqueda]);

  const seleccionado = todos.find((c) => String(c.id) === String(selId)) || null;

  async function cambiarEstadoVend(estadoVend) {
    if (!seleccionado) return;
    const anterior = seleccionado.estadoVend || "En proceso";
    if (anterior === estadoVend) return;
    setBusy(true);
    try {
      const notaAuto = { t: `Estado cambiado: ${anterior} → ${estadoVend}`, f: new Date().toISOString(), u: autor };
      const notas = [...(seleccionado.notasHistorial || []), notaAuto];
      const notasStr = fcSerializarVend(seleccionado.fecha_contacto || null, notas, seleccionado.vendedorVenta || "", estadoVend);
      await updateAsignacion(seleccionado.id, { notas: notasStr });
      await reload();
      toast(`Estado → ${estadoVend}`);
    } catch (err) {
      toast(err.message || "Error cambiando estado", false);
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <select
          value={vendActivo}
          onChange={(e) => {
            setVendActivo(e.target.value);
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

      {!vendActivo ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500">
          Elegí un vendedor para ver los clientes que le pasaron.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <StatBox label="Total" value={todos.length} color="#0066cc" />
            {ESTADOS_VEND.map((e) => (
              <StatBox key={e.key} label={`${e.icon} ${e.key}`} value={todos.filter((c) => (c.estadoVend || "En proceso") === e.key).length} color={e.color} />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill active={filtroEstado === "todos"} onClick={() => setFiltroEstado("todos")} label={`Todos ${todos.length}`} />
            {ESTADOS_VEND.map((e) => (
              <Pill
                key={e.key}
                active={filtroEstado === e.key}
                onClick={() => setFiltroEstado(e.key)}
                label={`${e.icon} ${e.key} ${todos.filter((c) => (c.estadoVend || "En proceso") === e.key).length}`}
                color={e.color}
                bg={e.bg}
              />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="max-h-[600px] overflow-y-auto rounded-3xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
              {filtrados.length === 0 && <p className="p-8 text-center text-sm text-slate-400 dark:text-neutral-500">Sin clientes.</p>}
              {filtrados.map((c) => {
                const ev = getEstVend(c.estadoVend || "En proceso");
                const sel = String(selId) === String(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelId(c.id)}
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition dark:border-neutral-800 ${sel ? "bg-sky-50 dark:bg-neutral-800" : "hover:bg-slate-50 dark:hover:bg-neutral-800/60"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-slate-800 dark:text-neutral-200">{c.nombre}</span>
                      <span className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold" style={{ color: ev.color, background: ev.bg }}>
                        {ev.icon} {ev.key}
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
                    {(() => {
                      const ev = getEstVend(seleccionado.estadoVend || "En proceso");
                      return (
                        <span className="mt-1 inline-block rounded-lg px-2 py-0.5 text-xs font-bold" style={{ color: ev.color, background: ev.bg }}>
                          {ev.icon} {ev.key}
                        </span>
                      );
                    })()}
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <Field label="CUIT" value={seleccionado.cuit} />
                    <Field label="Teléfono" value={seleccionado.telefono} wa={waUrl(seleccionado.telefono)} />
                    <Field label="Teléfono 2" value={seleccionado.telefono2} wa={waUrl(seleccionado.telefono2)} />
                    <Field label="Email" value={seleccionado.email} />
                    <Field label="Ciudad" value={seleccionado.ciudad} />
                    <Field label="Provincia" value={seleccionado.provincia} />
                    <Field label="Rubro" value={seleccionado.rubro} />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase text-slate-400 dark:text-neutral-500">Cambiar estado</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ESTADOS_VEND.map((e) => {
                        const isActive = (seleccionado.estadoVend || "En proceso") === e.key;
                        return (
                          <button
                            key={e.key}
                            disabled={busy}
                            onClick={() => cambiarEstadoVend(e.key)}
                            className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${isActive ? "" : "border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"}`}
                            style={isActive ? { borderColor: e.color, color: e.color, background: e.bg } : { color: e.color }}
                          >
                            {e.icon} {e.key}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase text-slate-400 dark:text-neutral-500">Historial de mensajes</p>
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {(seleccionado.notasHistorial || []).length === 0 && <p className="text-xs text-slate-400 dark:text-neutral-500">Sin mensajes aún.</p>}
                      {(seleccionado.notasHistorial || []).map((n, i) => (
                        <div key={i} className="border-l-2 border-emerald-500 rounded bg-slate-50 p-2 text-xs dark:border-emerald-600 dark:bg-neutral-800">
                          <p className="whitespace-pre-line text-slate-700 dark:text-neutral-300">{n.t}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400 dark:text-neutral-500">
                            {n.u || "—"} · {n.f ? new Date(n.f).toLocaleString("es-AR") : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                    <textarea
                      value={nuevaNota}
                      onChange={(e) => setNuevaNota(e.target.value)}
                      placeholder="Escribí tu observación…"
                      className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-sky-500"
                      rows={3}
                    />
                    <button onClick={guardarNota} disabled={busy} className="mt-1.5 w-full rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600">
                      💾 Guardar nota
                    </button>
                  </div>
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
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${active ? "" : "border-slate-200 bg-white text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"}`}
      style={active ? { borderColor: color || "#0ea5e9", color: color || "#0369a1", background: bg || "#e0f2fe" } : undefined}
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
        <span className="font-medium text-slate-700 dark:text-neutral-300">{value}</span>
      )}
    </div>
  );
}
