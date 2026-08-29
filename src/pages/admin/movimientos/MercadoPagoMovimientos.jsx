// src/pages/admin/movimientos/MercadoPagoMovimientos.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getMercadoPagoMovimientos } from "../../../services/comprobantes";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

const RANGOS = [
  { id: 7, label: "7 días" },
  { id: 15, label: "15 días" },
  { id: 30, label: "30 días" },
  { id: 90, label: "90 días" },
];

function fechaISO(diasAtras) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10);
}

// A diferencia de los otros bancos, acá no hace falta subir ningún extracto:
// se trae en vivo de la API de Mercado Pago (cuenta Fepa Top SAS). El
// matching contra clientes es más débil que en los extractos bancarios
// (Mercado Pago no siempre manda el CUIT del pagador, a veces solo el mail).
export default function MercadoPagoMovimientos({ clientesPorCuit, clientesPorEmail }) {
  const [movimientos, setMovimientos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [rangoDias, setRangoDias] = useState(30);

  async function cargar(dias = rangoDias) {
    setCargando(true);
    setError("");
    try {
      const { movimientos } = await getMercadoPagoMovimientos(fechaISO(dias), fechaISO(0));
      setMovimientos(movimientos);
    } catch (e) {
      setError(e.message || "No se pudieron traer los movimientos de Mercado Pago");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar(rangoDias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangoDias]);

  const rows = useMemo(() => {
    if (!movimientos) return [];
    return movimientos.map((m) => {
      const digitos = onlyDigits(m.pagador);
      const porCuit = digitos.length >= 10 ? clientesPorCuit?.get(digitos) : null;
      const porEmail = m.pagador && m.pagador.includes("@") ? clientesPorEmail?.get(m.pagador.toLowerCase()) : null;
      const cliente = porCuit || porEmail || null;
      return { ...m, cliente };
    });
  }, [movimientos, clientesPorCuit, clientesPorEmail]);

  const dashboard = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + Number(r.monto || 0), 0);
    const identificados = rows.filter((r) => r.cliente);
    const totalIdentificado = identificados.reduce((acc, r) => acc + Number(r.monto || 0), 0);
    const hoy = new Date().toDateString();
    const totalHoy = rows.filter((r) => new Date(r.fecha).toDateString() === hoy).reduce((acc, r) => acc + Number(r.monto || 0), 0);
    const promedio = rows.length ? total / rows.length : 0;
    return {
      total,
      cantidad: rows.length,
      totalIdentificado,
      cantidadIdentificada: identificados.length,
      totalHoy,
      promedio,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">💳 Mercado Pago</p>
          <p className="text-xs text-slate-500 dark:text-neutral-400">Conectado en vivo vía API — cuenta Fepa Top SAS.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-xl border border-slate-200 p-1 dark:border-neutral-700">
            {RANGOS.map((r) => (
              <button
                key={r.id}
                onClick={() => setRangoDias(r.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  rangoDias === r.id
                    ? "bg-slate-900 text-white dark:bg-neutral-700"
                    : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => cargar(rangoDias)}
            disabled={cargando}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            {cargando ? "Actualizando…" : "🔄 Actualizar"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {movimientos && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-slate-500 dark:text-neutral-400">Total recaudado ({rangoDias}d)</p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{money(dashboard.total)}</p>
            <p className="text-[11px] text-slate-400 dark:text-neutral-500">{dashboard.cantidad} movimiento(s)</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="text-xs text-emerald-700 dark:text-emerald-400">Identificado por cliente</p>
            <p className="mt-1 text-lg font-bold text-emerald-900 dark:text-emerald-300">{money(dashboard.totalIdentificado)}</p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-500">
              {dashboard.cantidadIdentificada} de {dashboard.cantidad}
            </p>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
            <p className="text-xs text-sky-700 dark:text-sky-400">Cobrado hoy</p>
            <p className="mt-1 text-lg font-bold text-sky-900 dark:text-sky-300">{money(dashboard.totalHoy)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-slate-500 dark:text-neutral-400">Ticket promedio</p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{money(dashboard.promedio)}</p>
          </div>
        </div>
      )}

      {cargando && !movimientos && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}

      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className={`rounded-2xl border p-3 ${
              r.cliente
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{r.descripcion || "Cobro Mercado Pago"}</p>
                <p className="truncate text-xs text-slate-500 dark:text-neutral-400">{r.pagador || "(sin identificar remitente)"}</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                  {new Date(r.fecha).toLocaleString("es-AR")} · {r.metodo}
                  {r.tipoOperacion === "money_transfer" && " · 📤 transferencia saliente"}
                  {r.tipoOperacion === "regular_payment" && " · 🛒 venta"}
                </p>
              </div>
              <p className="shrink-0 font-semibold text-slate-900 dark:text-white">{money(r.monto)}</p>
            </div>
            <p
              className={`mt-2 text-xs font-medium ${
                r.cliente ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
              }`}
            >
              {r.cliente ? (
                <>
                  ✅ Identificado:{" "}
                  <Link to={`/admin/clientes-360?buscar=${encodeURIComponent(r.cliente.name)}`} className="underline">
                    {r.cliente.name}
                  </Link>
                </>
              ) : (
                "⚠️ No se pudo identificar por CUIT ni mail — revisar a mano"
              )}
            </p>
          </div>
        ))}
        {movimientos && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-neutral-500">Sin movimientos en este período.</p>
        )}
      </div>
    </div>
  );
}
