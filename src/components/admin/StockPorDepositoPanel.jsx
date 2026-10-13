// src/components/admin/StockPorDepositoPanel.jsx
// Vista "Stock por depósito" del panel de Productos — pensada para poder
// demostrarle a AFIP (o a cualquiera) cuántas bicicletas tiene la empresa
// hoy, diferenciado entre los 3 depósitos propios (Lavalle/Cañuelas/
// Credifin) y lo que está consignado en depósitos de clientes. Cada
// depósito y "Consignados" se puede abrir para ver el detalle modelo por
// modelo y talle por talle (nunca mezclado), y dentro de "Consignados" se
// puede abrir cada cliente para ver cuántas tiene de cada una (en vivo,
// contra Contabilium — ese dato no se guarda cacheado por cliente).
import { useEffect, useMemo, useState } from "react";
import { subscribeStockPorDepositoDetail, subscribeClientesReportDetail, getDepositoStockAdmin } from "../../services/comprobantes";
import { extraerModelo, extraerTalle } from "../../utils/bikeName";

const MODELOS = [
  { id: "todos", label: "Todos" },
  { id: "BOWIE", label: "Bowie" },
  { id: "SHONEN", label: "Shonen" },
  { id: "GOZEN", label: "Gozen" },
  { id: "3.0", label: "Samurai 3.0" },
  { id: "2.0", label: "Samurai 2.0" },
];
const ORDEN_MODELO = ["BOWIE", "SHONEN", "GOZEN", "3.0", "2.0"];
const ORDEN_TALLE = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];

function ordenarPorModeloYTalle(items, { nombreKey = "nombre" } = {}) {
  return [...items].sort((a, b) => {
    const ma = extraerModelo(a[nombreKey]);
    const mb = extraerModelo(b[nombreKey]);
    const ia = ma ? ORDEN_MODELO.indexOf(ma) : 99;
    const ib = mb ? ORDEN_MODELO.indexOf(mb) : 99;
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    const ta = extraerTalle(a[nombreKey]);
    const tb = extraerTalle(b[nombreKey]);
    const ja = ta ? ORDEN_TALLE.indexOf(ta) : 99;
    const jb = tb ? ORDEN_TALLE.indexOf(tb) : 99;
    if (ja !== jb) return (ja === -1 ? 99 : ja) - (jb === -1 ? 99 : jb);
    return (a[nombreKey] || "").localeCompare(b[nombreKey] || "", "es");
  });
}

function n(v) {
  return Number(v || 0).toLocaleString("es-AR");
}

// Tabla modelo→talle→producto→cantidad, reutilizada para cada depósito y
// para consignados — siempre el mismo orden, nunca talles mezclados.
function TablaStock({ filas, campoCantidad }) {
  const conStock = filas.filter((f) => Number(f[campoCantidad] || 0) > 0);
  const ordenadas = ordenarPorModeloYTalle(conStock);
  if (ordenadas.length === 0) {
    return <p className="p-4 text-center text-xs text-slate-400 dark:text-neutral-500">Sin stock para este filtro.</p>;
  }
  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-neutral-800">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
          <tr>
            <th className="px-3 py-2">Modelo</th>
            <th className="px-3 py-2">Talle</th>
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2 text-right">Cantidad</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
          {ordenadas.map((f, i) => (
            <tr key={`${f.sku || f.nombre}-${i}`}>
              <td className="px-3 py-1.5 text-slate-600 dark:text-neutral-300">{extraerModelo(f.nombre) || "—"}</td>
              <td className="px-3 py-1.5 text-slate-600 dark:text-neutral-300">{extraerTalle(f.nombre) || "—"}</td>
              <td className="px-3 py-1.5 text-slate-800 dark:text-white">{f.nombre}</td>
              <td className="px-3 py-1.5 text-right font-semibold text-slate-900 dark:text-white">{n(f[campoCantidad])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardDeposito({ titulo, total, abierto, onToggle, children, color }) {
  return (
    <div className={`rounded-2xl border p-4 ${color}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{titulo}</div>
          <div className="mt-1 text-2xl font-bold">{n(total)} bicis</div>
        </div>
        <span className="text-lg">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && <div className="mt-3">{children}</div>}
    </div>
  );
}

// Detalle en vivo de UN cliente puntual (no se cachea por cliente: pedirlo
// para todos de una sería demasiado pedido a Contabilium). Se trae recién
// al abrirlo.
function ClienteDetalle({ cliente, filtroModelo }) {
  const [items, setItems] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let activo = true;
    setCargando(true);
    setError("");
    setItems(null);
    const depositoId = Number(cliente.depositoId);
    if (!depositoId) {
      setCargando(false);
      setError("Este cliente no tiene un depósito de Contabilium vinculado.");
      return;
    }
    getDepositoStockAdmin(depositoId)
      .then((r) => {
        if (!activo) return;
        setItems(r.items || []);
      })
      .catch((e) => {
        if (!activo) return;
        setError(e.message || "No se pudo traer el stock de este cliente.");
      })
      .finally(() => activo && setCargando(false));
    return () => {
      activo = false;
    };
  }, [cliente.depositoId]);

  if (cargando) return <p className="p-3 text-xs text-slate-400 dark:text-neutral-500">Consultando Contabilium…</p>;
  if (error) return <p className="p-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>;

  const bicis = (items || []).filter((it) => (it.category || "").toUpperCase() === "BICICLETAS" && it.stockActual > 0);
  const filtradas = filtroModelo === "todos" ? bicis : bicis.filter((it) => extraerModelo(it.name) === filtroModelo);

  return (
    <div className="mt-2">
      <TablaStock filas={filtradas.map((it) => ({ nombre: it.name, sku: it.sku, cantidad: it.stockActual }))} campoCantidad="cantidad" />
    </div>
  );
}

export default function StockPorDepositoPanel() {
  const [stockDetail, setStockDetail] = useState(null);
  const [clientesDetail, setClientesDetail] = useState(null);
  const [filtroModelo, setFiltroModelo] = useState("todos");
  const [abierto, setAbierto] = useState(null); // "lavalle" | "canuelas" | "credifin" | "consignados" | null
  const [verClientes, setVerClientes] = useState(false);
  const [clienteAbierto, setClienteAbierto] = useState(null); // ClienteReporteRow | null

  useEffect(() => {
    const u1 = subscribeStockPorDepositoDetail(setStockDetail);
    const u2 = subscribeClientesReportDetail(setClientesDetail);
    return () => {
      u1();
      u2();
    };
  }, []);

  const porSkuFiltrado = useMemo(() => {
    const porSku = stockDetail?.porSku || [];
    return filtroModelo === "todos" ? porSku : porSku.filter((s) => extraerModelo(s.nombre) === filtroModelo);
  }, [stockDetail, filtroModelo]);

  const totales = useMemo(() => {
    return porSkuFiltrado.reduce(
      (acc, s) => ({
        lavalle: acc.lavalle + (s.lavalle || 0),
        canuelas: acc.canuelas + (s.canuelas || 0),
        credifin: acc.credifin + (s.credifin || 0),
        propiosTotal: acc.propiosTotal + (s.propiosTotal || 0),
        consignadoTotal: acc.consignadoTotal + (s.consignadoTotal || 0),
      }),
      { lavalle: 0, canuelas: 0, credifin: 0, propiosTotal: 0, consignadoTotal: 0 }
    );
  }, [porSkuFiltrado]);

  const granTotal = totales.propiosTotal + totales.consignadoTotal;

  // Clientes con stock consignado > 0, ordenados de mayor a menor — el
  // total de cada uno es de TODOS los modelos (no se puede filtrar por
  // modelo sin pedirle a Contabilium cliente por cliente, por eso al
  // filtrar por modelo esta lista se desactiva y se avisa).
  const clientesConStock = useMemo(
    () => (clientesDetail?.rows || []).filter((r) => r.stockConsignado > 0).sort((a, b) => b.stockConsignado - a.stockConsignado),
    [clientesDetail]
  );

  function toggle(seccion) {
    setAbierto((prev) => (prev === seccion ? null : seccion));
    if (seccion !== "consignados") {
      setVerClientes(false);
      setClienteAbierto(null);
    }
  }

  if (!stockDetail) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        Cargando stock por depósito…
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_65px_-45px_rgba(15,23,42,0.18)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">📦 Stock por depósito</h2>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Bicicletas en los 3 depósitos propios (Lavalle, Cañuelas, Credifin) y en depósitos consignados de clientes.
          {stockDetail.updatedAt && (
            <span className="text-slate-400 dark:text-neutral-500"> · Actualizado {stockDetail.updatedAt.toLocaleString("es-AR")}</span>
          )}
        </p>
      </div>

      {/* Filtro de modelo */}
      <div className="mt-4 flex flex-wrap gap-2">
        {MODELOS.map((m) => (
          <button
            key={m.id}
            onClick={() => setFiltroModelo(m.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              filtroModelo === m.id
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "border border-slate-200 bg-white text-slate-600 hover:border-slate-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Totales grandes, arriba */}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-center dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Depósitos propios (3)</div>
          <div className="mt-1 text-4xl font-extrabold text-indigo-900 dark:text-white">{n(totales.propiosTotal)}</div>
          <div className="text-xs text-indigo-700/80 dark:text-indigo-300/70">Lavalle + Cañuelas + Credifin</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Consignados (clientes)</div>
          <div className="mt-1 text-4xl font-extrabold text-amber-900 dark:text-white">{n(totales.consignadoTotal)}</div>
          <div className="text-xs text-amber-700/80 dark:text-amber-300/70">En depósitos de distribuidores</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Total general</div>
          <div className="mt-1 text-4xl font-extrabold text-emerald-900 dark:text-white">{n(granTotal)}</div>
          <div className="text-xs text-emerald-700/80 dark:text-emerald-300/70">Bicicletas de la empresa, hoy</div>
        </div>
      </div>

      {/* Los 3 depósitos propios, cada uno desplegable */}
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <CardDeposito
          titulo="Lavalle"
          total={totales.lavalle}
          abierto={abierto === "lavalle"}
          onToggle={() => toggle("lavalle")}
          color="border-slate-200 bg-slate-50 text-slate-800 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-white"
        >
          <TablaStock filas={porSkuFiltrado} campoCantidad="lavalle" />
        </CardDeposito>
        <CardDeposito
          titulo="Cañuelas"
          total={totales.canuelas}
          abierto={abierto === "canuelas"}
          onToggle={() => toggle("canuelas")}
          color="border-slate-200 bg-slate-50 text-slate-800 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-white"
        >
          <TablaStock filas={porSkuFiltrado} campoCantidad="canuelas" />
        </CardDeposito>
        <CardDeposito
          titulo="Credifin"
          total={totales.credifin}
          abierto={abierto === "credifin"}
          onToggle={() => toggle("credifin")}
          color="border-slate-200 bg-slate-50 text-slate-800 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-white"
        >
          <TablaStock filas={porSkuFiltrado} campoCantidad="credifin" />
        </CardDeposito>
      </div>

      {/* Consignados: detalle modelo/talle + lista de clientes */}
      <div className="mt-4">
        <CardDeposito
          titulo="Consignados — total en clientes"
          total={totales.consignadoTotal}
          abierto={abierto === "consignados"}
          onToggle={() => toggle("consignados")}
          color="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-white"
        >
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide opacity-70">Cuántas de cada bici hay consignadas (todos los clientes sumados)</p>
              <TablaStock filas={porSkuFiltrado} campoCantidad="consignadoTotal" />
            </div>

            <div>
              <button
                onClick={() => setVerClientes((v) => !v)}
                className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800 hover:border-amber-500 dark:border-amber-700 dark:bg-neutral-900 dark:text-amber-300"
              >
                {verClientes ? "Ocultar clientes" : `Ver por cliente (${clientesConStock.length})`}
              </button>
              {verClientes && (
                <div className="mt-3 space-y-2">
                  {filtroModelo !== "todos" && (
                    <p className="text-xs text-amber-700 dark:text-amber-300/80">
                      ⚠️ El total de cada cliente de abajo es de TODOS los modelos (no se puede filtrar sin consultarlo en vivo) — al abrir un cliente puntual, ahí sí se filtra por "{MODELOS.find((m) => m.id === filtroModelo)?.label}".
                    </p>
                  )}
                  <div className="max-h-[28rem] overflow-auto rounded-xl border border-amber-200 dark:border-amber-800">
                    {clientesConStock.map((c) => (
                      <div key={c.uid} className="border-b border-amber-100 last:border-0 dark:border-amber-900">
                        <button
                          onClick={() => setClienteAbierto((prev) => (prev?.uid === c.uid ? null : c))}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-amber-100/60 dark:hover:bg-amber-500/10"
                        >
                          <span className="text-slate-700 dark:text-neutral-200">
                            {c.nombre} <span className="text-slate-400">({c.localidad || "sin localidad"})</span>
                          </span>
                          <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                            {n(c.stockConsignado)} bicis
                            <span className="text-slate-400">{clienteAbierto?.uid === c.uid ? "▲" : "▼"}</span>
                          </span>
                        </button>
                        {clienteAbierto?.uid === c.uid && (
                          <div className="px-3 pb-3">
                            <ClienteDetalle cliente={c} filtroModelo={filtroModelo} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardDeposito>
      </div>
    </div>
  );
}
