import { useMemo } from "react";
import { ESTADOS_VEND } from "./notasCodec";

const TM_COLORS = ["#0066cc", "#16a34a", "#e94560", "#0891b2", "#d97706", "#6366f1"];

export default function PanelAdmin({ crm }) {
  const { asignados } = crm;

  const telemarketers = useMemo(() => Array.from(new Set(asignados.map((c) => c.vendedorId).filter(Boolean))).sort(), [asignados]);
  const vendedoresVenta = useMemo(() => Array.from(new Set(asignados.map((c) => c.vendedorVenta).filter(Boolean))).sort(), [asignados]);

  const tot = asignados.length;
  const globalStats = [
    { l: "Total clientes", v: tot, c: "#0066cc" },
    { l: "Sin contactar 📵", v: asignados.filter((c) => c.estado === "Sin contactar").length, c: "#991b1b" },
    { l: "Contactados 📞", v: asignados.filter((c) => c.estado === "Contactado").length, c: "#1d4ed8" },
    { l: "Interesados ⭐", v: asignados.filter((c) => c.estado === "Interesado").length, c: "#d97706" },
    { l: "En manos vendedor 🤝", v: asignados.filter((c) => c.estado === "En manos de vendedor").length, c: "#7c3aed" },
    { l: "Cerrados ✅", v: asignados.filter((c) => c.estado === "Cerrado").length, c: "#15803d" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {globalStats.map((s) => (
          <div key={s.l} className="rounded-2xl border border-slate-200 bg-white p-4 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-2xl font-bold" style={{ color: s.c }}>
              {s.v}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{s.l}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Telemarketers</h3>
        {telemarketers.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500">Sin clientes asignados todavía</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {telemarketers.map((tm, i) => (
              <TelemarketerCard key={tm} nombre={tm} asignados={asignados} color={TM_COLORS[i % TM_COLORS.length]} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Vendedores</h3>
        {vendedoresVenta.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500">Sin vendedores con clientes asignados todavía</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {vendedoresVenta.map((vv) => (
              <VendedorCard key={vv} nombre={vv} asignados={asignados} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ label, value, total, color }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-neutral-400">
        <span>{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function TelemarketerCard({ nombre, asignados, color }) {
  const cl = asignados.filter((c) => c.vendedorId === nombre);
  const tot = cl.length;
  const sinC = cl.filter((c) => c.estado === "Sin contactar").length;
  const cont = cl.filter((c) => c.estado === "Contactado").length;
  const inter = cl.filter((c) => c.estado === "Interesado").length;
  const manos = cl.filter((c) => c.estado === "En manos de vendedor").length;
  const cerr = cl.filter((c) => c.estado === "Cerrado").length;
  const cred = cl.filter((c) => c.tipo === "Credifin").length;
  const sinCr = cl.filter((c) => c.tipo === "Sin Credifin").length;
  const ret = cl.filter((c) => c.tipo === "Retail").length;

  const pasMap = {};
  cl.filter((c) => c.vendedorVenta).forEach((c) => {
    pasMap[c.vendedorVenta] = (pasMap[c.vendedorVenta] || 0) + 1;
  });
  const pasEntries = Object.entries(pasMap).sort((a, b) => b[1] - a[1]);

  const provMap = {};
  cl.forEach((c) => {
    if (c.provincia) provMap[c.provincia] = (provMap[c.provincia] || 0) + 1;
  });
  const topProvs = Object.entries(provMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${color}bb)` }}>
        <div>
          <div className="font-bold">👤 {nombre}</div>
          <div className="text-xs opacity-80">Telemarketer</div>
        </div>
        <div className="text-2xl font-bold">{tot}</div>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-slate-400 dark:text-neutral-500">Estado de los clientes</p>
          <Bar label="📵 Sin contactar" value={sinC} total={tot} color="#991b1b" />
          <Bar label="📞 Contactado" value={cont} total={tot} color="#1d4ed8" />
          <Bar label="⭐ Interesado" value={inter} total={tot} color="#d97706" />
          <Bar label="🤝 En manos de vendedor" value={manos} total={tot} color="#7c3aed" />
          <Bar label="✅ Cerrado" value={cerr} total={tot} color="#15803d" />
        </div>
        <hr className="border-slate-100 dark:border-neutral-800" />
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-slate-400 dark:text-neutral-500">Categorías</p>
          <div className="flex flex-wrap gap-1.5">
            {cred > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">🟢 Credifin: {cred}</span>}
            {sinCr > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">🟡 Sin Credifin: {sinCr}</span>}
            {ret > 0 && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">🟣 Retail: {ret}</span>}
            {tot === 0 && <span className="text-xs text-slate-400 dark:text-neutral-500">—</span>}
          </div>
        </div>
        <hr className="border-slate-100 dark:border-neutral-800" />
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-slate-400 dark:text-neutral-500">Interesados pasados a vendedor</p>
          {pasEntries.length === 0 ? (
            <p className="text-xs italic text-slate-400 dark:text-neutral-500">Sin interesados pasados aún</p>
          ) : (
            pasEntries.map(([v, n]) => (
              <div key={v} className="flex items-center justify-between text-xs">
                <span className="font-semibold dark:text-neutral-300">🤝 {v}</span>
                <span className="font-bold text-violet-600 dark:text-violet-400">{n}</span>
              </div>
            ))
          )}
        </div>
        <hr className="border-slate-100 dark:border-neutral-800" />
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-slate-400 dark:text-neutral-500">Por provincia (top {topProvs.length})</p>
          {topProvs.length === 0 ? (
            <p className="text-xs italic text-slate-400 dark:text-neutral-500">Sin datos de provincia</p>
          ) : (
            <div className="grid grid-cols-2 gap-1 text-xs text-slate-600 dark:text-neutral-400">
              {topProvs.map(([p, n]) => (
                <div key={p}>
                  {p}: <strong>{n}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VendedorCard({ nombre, asignados }) {
  const recib = asignados.filter((c) => c.vendedorVenta === nombre);
  const tot = recib.length;
  const cred = recib.filter((c) => c.tipo === "Credifin").length;
  const sinCr = recib.filter((c) => c.tipo === "Sin Credifin").length;
  const ret = recib.filter((c) => c.tipo === "Retail").length;

  const evMap = {};
  recib.forEach((c) => {
    const e = c.estadoVend || "En proceso";
    evMap[e] = (evMap[e] || 0) + 1;
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between bg-gradient-to-br from-violet-600 to-violet-500 px-4 py-3 text-white">
        <div>
          <div className="font-bold">🤝 {nombre}</div>
          <div className="text-xs opacity-80">Vendedor</div>
        </div>
        <div className="text-2xl font-bold">{tot}</div>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-slate-400 dark:text-neutral-500">Estado de la cartera</p>
          {ESTADOS_VEND.map((e) => (
            <Bar key={e.key} label={`${e.icon} ${e.key}`} value={evMap[e.key] || 0} total={tot} color={e.color} />
          ))}
        </div>
        <hr className="border-slate-100 dark:border-neutral-800" />
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-slate-400 dark:text-neutral-500">Categorías</p>
          <div className="flex flex-wrap gap-1.5">
            {cred > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">🟢 Credifin: {cred}</span>}
            {sinCr > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">🟡 Sin Credifin: {sinCr}</span>}
            {ret > 0 && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">🟣 Retail: {ret}</span>}
            {tot === 0 && <span className="text-xs text-slate-400 dark:text-neutral-500">—</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
