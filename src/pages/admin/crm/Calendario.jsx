import { useMemo, useState } from "react";
import { getEst } from "./notasCodec";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DIAS_CORTO = ["L", "M", "X", "J", "V", "S", "D"];

function claveDia(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function Calendario({ crm }) {
  const { vendedores, asignados } = crm;
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [filtroVendedor, setFiltroVendedor] = useState("");
  const [diaSel, setDiaSel] = useState(null);

  const porDia = useMemo(() => {
    const map = {};
    asignados
      .filter((c) => c.fecha_contacto && (!filtroVendedor || c.vendedorId === filtroVendedor))
      .forEach((c) => {
        const d = new Date(c.fecha_contacto);
        const k = claveDia(d);
        (map[k] = map[k] || []).push({ tipo: "telemarketer", c });
      });
    asignados.forEach((c) => {
      if (!c.notasHistorial) return;
      if (filtroVendedor && c.vendedorId !== filtroVendedor && c.vendedorVenta !== filtroVendedor) return;
      c.notasHistorial.forEach((nota) => {
        if (!nota.f) return;
        const d = new Date(nota.f);
        const k = claveDia(d);
        (map[k] = map[k] || []).push({ tipo: "vendedor", c, nota });
      });
    });
    return map;
  }, [asignados, filtroVendedor]);

  const dias = useMemo(() => {
    const primerDia = new Date(anio, mes, 1);
    const ultimoDia = new Date(anio, mes + 1, 0);
    let iniCol = primerDia.getDay();
    iniCol = iniCol === 0 ? 6 : iniCol - 1;
    const arr = [];
    for (let i = iniCol; i > 0; i--) arr.push({ fecha: new Date(anio, mes, 1 - i), otro: true });
    for (let i = 1; i <= ultimoDia.getDate(); i++) arr.push({ fecha: new Date(anio, mes, i), otro: false });
    const resto = (7 - (arr.length % 7)) % 7;
    for (let i = 1; i <= resto; i++) arr.push({ fecha: new Date(anio, mes + 1, i), otro: true });
    return arr;
  }, [mes, anio]);

  function cambiarMes(delta) {
    let m = mes + delta;
    let a = anio;
    if (m < 0) {
      m = 11;
      a--;
    } else if (m > 11) {
      m = 0;
      a++;
    }
    setMes(m);
    setAnio(a);
  }

  const eventosDia = diaSel ? porDia[claveDia(diaSel)] || [] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <select value={filtroVendedor} onChange={(e) => setFiltroVendedor(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:focus:border-sky-500">
          <option value="">Todos los vendedores</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.nombre}>
              {v.nombre}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => cambiarMes(-1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-800">
            ←
          </button>
          <span className="w-40 text-center text-sm font-semibold text-slate-800 dark:text-white">
            {MESES[mes]} {anio}
          </span>
          <button onClick={() => cambiarMes(1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-800">
            →
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-400 dark:text-neutral-500">
            {DIAS_CORTO.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {dias.map(({ fecha, otro }, i) => {
              const k = claveDia(fecha);
              const eventos = porDia[k] || [];
              const esHoy = fecha.toDateString() === hoy.toDateString();
              const esSel = diaSel && fecha.toDateString() === diaSel.toDateString();
              return (
                <button
                  key={i}
                  onClick={() => setDiaSel(fecha)}
                  className={`flex min-h-[56px] flex-col rounded-lg border p-1.5 text-left transition sm:min-h-[64px] ${
                    esSel
                      ? "border-sky-500 bg-sky-50 dark:border-sky-500 dark:bg-sky-950/40"
                      : esHoy
                      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
                      : "border-slate-100 hover:bg-slate-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                  } ${otro ? "opacity-40" : ""}`}
                >
                  <span className="text-xs font-semibold text-slate-700 dark:text-neutral-200">{fecha.getDate()}</span>
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {eventos.slice(0, 8).map((ev, j) => (
                      <span
                        key={j}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: ev.tipo === "vendedor" ? "#ea580c" : getEst(ev.c.estado).color }}
                      />
                    ))}
                  </div>
                  {eventos.length > 0 && <span className="mt-auto text-[10px] text-slate-400 dark:text-neutral-500">{eventos.length} evento(s)</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          {!diaSel ? (
            <p className="py-16 text-center text-sm text-slate-400 dark:text-neutral-500">📅 Hacé clic en un día para ver los contactos</p>
          ) : (
            <div>
              <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-white">
                {DIAS_LARGO[diaSel.getDay()]} {diaSel.getDate()} de {MESES[diaSel.getMonth()].toLowerCase()}
              </h3>
              {eventosDia.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Sin eventos este día.</p>
              ) : (
                <div className="space-y-2">
                  {eventosDia.map((ev, i) => (
                    <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-800">
                      <p className="font-semibold text-slate-800 dark:text-white">{ev.c.nombre}</p>
                      {ev.tipo === "vendedor" ? (
                        <p className="mt-0.5 text-orange-600 dark:text-orange-400">🤝 {ev.nota.u || ev.c.vendedorVenta || "Vendedor"} — {ev.nota.t}</p>
                      ) : (
                        <p className="mt-0.5" style={{ color: getEst(ev.c.estado).color }}>
                          {getEst(ev.c.estado).icon} {ev.c.estado} · {ev.c.vendedorId}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
