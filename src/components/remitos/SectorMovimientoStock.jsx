// src/components/remitos/SectorMovimientoStock.jsx
// SECTOR 1 de "Remitos y Cobranza": todo lo que sale de acá viene directo
// de la API real de Contabilium (movinventarios/GetPageWithFilters) — NO
// es texto de observación de remito adivinado, es el movimiento de stock
// tal cual quedó cargado.
import { Fragment, useEffect, useMemo, useState } from "react";
import { obtenerMovimientosStock, searchContabiliumClientes, adminGetClientPhone } from "../../services/comprobantes";
import { generateEtiquetasPdf } from "../../utils/generateEtiquetasPdf";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
const DEPOSITO_PROPIO_RE = /lavalle|temperley|ca[ñn]uelas|credifin/i;
const CUCHI_RE = /\bcuchi\b|bavcevich/i;
const JULIAN_RE = /\bjulian\b|\bjuli[aá]n\b/i;

function esBici(codigoNombre) {
  return /BIC\b/i.test(codigoNombre || "");
}
function esDepositoPropio(nombre) {
  return DEPOSITO_PROPIO_RE.test((nombre || "").trim());
}
function esCuchi(nombre) {
  return CUCHI_RE.test((nombre || "").trim());
}
// Categoriza un movimiento de bici: a dónde fue realmente esa unidad.
//  - "interno": el destino es otro de los 3 depósitos propios — todavía no
//    salió "de verdad" a nadie, es acomodo de stock entre Lavalle/Cañuelas/
//    Credifin.
//  - "cuchi": SALE del depósito de Cuchi hacia uno de SUS clientes — es
//    Cuchi repartiendo lo que ya tenía.
//  - "propio": sale de uno de nuestros 3 depósitos directo a un cliente
//    (el depósito de Cuchi cuenta como "cliente" en este caso — es la
//    entrega QUE LE HACEMOS a él, no la que él reparte después).
//  - "otro": ninguno de los anteriores (movimiento entre dos depósitos que
//    no son nuestros ni de Cuchi) — rarísimo, pero no se descarta.
function categoriaMovimiento(m) {
  const origenPropio = esDepositoPropio(m.origen);
  const destinoPropio = esDepositoPropio(m.destino);
  const origenCuchi = esCuchi(m.origen);
  if (destinoPropio) return "interno";
  if (origenCuchi) return "cuchi";
  if (origenPropio) return "propio";
  return "otro";
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function nombreMes(ym) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}
function money0(n) {
  return Number(n || 0).toLocaleString("es-AR");
}
function mesAnterior(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function SectorMovimientoStock() {
  // Arranca en septiembre 2026 — antes de eso no hay nada interesante que
  // mostrar acá (y así el resumen mensual, el calendario y "movimientos
  // entre depósito" quedan los 3 acotados juntos, vienen del mismo rango).
  const [desde, setDesde] = useState("2026-09-01");
  const [hasta, setHasta] = useState(() => hoyISO());
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mesAbiertoTabla, setMesAbiertoTabla] = useState(null);

  function cargar() {
    setLoading(true);
    setError("");
    obtenerMovimientosStock(desde, hasta)
      .then((r) => setItems(r.items || []))
      .catch((e) => setError(e.message || "No se pudo cargar"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bicis = useMemo(() => (items || []).filter((m) => esBici(m.codigoNombre)), [items]);

  // Resumen mensual: total movido, cuánto salió de un depósito propio
  // directo a un cliente, cuánto entregó Cuchi (desde su propio depósito a
  // los suyos), y cuánto llevó Julián (se busca su nombre en la
  // descripción del movimiento, cuando está cargada).
  const resumenMensual = useMemo(() => {
    const porMes = new Map();
    function getMes(ym) {
      if (!porMes.has(ym))
        porMes.set(ym, { totalMovidas: 0, depositoPropio: 0, entregoCuchi: 0, entregoJulian: 0, movimientos: [] });
      return porMes.get(ym);
    }
    for (const m of bicis) {
      const ym = (m.fecha || "").slice(0, 7);
      if (!ym) continue;
      const cantidad = Number(m.cantidad || 0);
      const mesObj = getMes(ym);
      mesObj.totalMovidas += cantidad;
      const cat = categoriaMovimiento(m);
      if (cat === "propio") mesObj.depositoPropio += cantidad;
      if (cat === "cuchi") mesObj.entregoCuchi += cantidad;
      if (JULIAN_RE.test(m.descripcion || "")) mesObj.entregoJulian += cantidad;
      mesObj.movimientos.push({ ...m, categoria: cat });
    }
    return [...porMes.entries()]
      .map(([ym, d]) => ({ ym, ...d, entregadasCliente: d.depositoPropio + d.entregoCuchi }))
      .sort((a, b) => b.ym.localeCompare(a.ym));
  }, [bicis]);

  const ymActual = hoyISO().slice(0, 7);
  const mesActualDatos = resumenMensual.find((m) => m.ym === ymActual) || null;
  const mesAnteriorDatos = resumenMensual.find((m) => m.ym === mesAnterior(ymActual)) || null;

  return (
    <div>
      <GeneradorEtiquetaRapido />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">🚚 Movimiento de stock (en vivo, directo de Contabilium)</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
            Todo acá sale de la API real de movimientos de Contabilium — nada de adivinar por texto de observación.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Desde</label>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Hasta</label>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
          </div>
          <button
            onClick={cargar}
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? "Actualizando…" : "🔄 Actualizar"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {items !== null && (
        <>
          <ComparativaMeses actual={mesActualDatos} anterior={mesAnteriorDatos} ymActual={ymActual} ymAnterior={mesAnterior(ymActual)} />

          <p className="mt-6 text-sm font-bold text-slate-900 dark:text-white">📆 Resumen mensual de movimientos</p>
          <ResumenMensual meses={resumenMensual} mesAbierto={mesAbiertoTabla} onToggleMes={setMesAbiertoTabla} />

          <p className="mt-6 text-sm font-bold text-slate-900 dark:text-white">📅 Calendario de movimientos</p>
          <CalendarioMovimientos bicis={bicis} />

          <p className="mt-6 text-sm font-bold text-slate-900 dark:text-white">🔁 Movimientos entre depósito (Lavalle / Cañuelas / Credifin)</p>
          <MovimientosEntreDeposito bicis={bicis} />
        </>
      )}
    </div>
  );
}

// Panel bien visible arriba de todo: tipear cliente + destino y bajar la
// hoja de etiquetas al toque, sin tener que ir a buscar el remito puntual
// en la lista de abajo (pedido explícito 21/10/2026 — antes solo se podía
// generar desde el botón al lado de cada remito).
function GeneradorEtiquetaRapido() {
  const [query, setQuery] = useState("");
  const [cliente, setCliente] = useState("");
  const [destino, setDestino] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [buscandoDireccion, setBuscandoDireccion] = useState(false);
  const [mostrarLista, setMostrarLista] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || q === cliente) {
      setResultados([]);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      searchContabiliumClientes(q)
        .then((r) => {
          if (!cancelado) setResultados(r.resultados || []);
        })
        .catch(() => {
          if (!cancelado) setResultados([]);
        })
        .finally(() => {
          if (!cancelado) setBuscando(false);
        });
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [query, cliente]);

  async function elegirCliente(r) {
    setCliente(r.razonSocial);
    setQuery(r.razonSocial);
    setMostrarLista(false);
    setResultados([]);
    setDestino("Buscando dirección…");
    setBuscandoDireccion(true);
    try {
      const d = await adminGetClientPhone(r.contabiliumId);
      const partes = [d.direccion, d.ciudad, d.provincia].filter(Boolean);
      setDestino(partes.join(", ") || "");
    } catch {
      setDestino("");
    } finally {
      setBuscandoDireccion(false);
    }
  }

  function generar() {
    if (!cliente.trim() || !destino.trim()) return;
    generateEtiquetasPdf(
      { cliente: cliente.trim(), destino: destino.trim() },
      { fileName: `Etiquetas ${cliente.trim()}.pdf` }
    );
  }

  return (
    <div className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/10">
      <h2 className="text-sm font-bold text-indigo-800 dark:text-indigo-400">🏷️ Generar etiqueta de envío</h2>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1">
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Cliente</label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCliente("");
              setMostrarLista(true);
            }}
            onFocus={() => setMostrarLista(true)}
            placeholder="Escribí para buscar…"
            className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-sm dark:border-indigo-900 dark:bg-neutral-900 dark:text-white"
          />
          {mostrarLista && (buscando || resultados.length > 0) && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-indigo-200 bg-white shadow-lg dark:border-indigo-900 dark:bg-neutral-900">
              {buscando && <p className="px-3 py-2 text-xs text-slate-400 dark:text-neutral-500">Buscando…</p>}
              {!buscando &&
                resultados.map((r) => (
                  <button
                    key={r.contabiliumId}
                    onClick={() => elegirCliente(r)}
                    className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-indigo-50 dark:text-neutral-200 dark:hover:bg-indigo-950/30"
                  >
                    {r.razonSocial}
                    {r.cuit && <span className="ml-1 text-slate-400 dark:text-neutral-500">({r.cuit})</span>}
                  </button>
                ))}
            </div>
          )}
        </div>
        <div className="min-w-[260px] flex-[2]">
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">
            Dirección de destino {buscandoDireccion && "(buscando…)"}
          </label>
          <input
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            placeholder="Calle, número, localidad, provincia"
            className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-sm dark:border-indigo-900 dark:bg-neutral-900 dark:text-white"
          />
        </div>
        <button
          onClick={generar}
          disabled={!cliente.trim() || !destino.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          📥 Generar PDF
        </button>
      </div>
    </div>
  );
}

// Comparativa simple arriba de todo: mes actual vs. mes anterior, mismos 4
// números, para ver de un vistazo si vamos mejor o peor que el mes pasado.
function ComparativaMeses({ actual, anterior, ymActual, ymAnterior }) {
  const vacio = { totalMovidas: 0, depositoPropio: 0, entregoCuchi: 0, entregoJulian: 0 };
  const a = actual || vacio;
  const b = anterior || vacio;
  const filas = [
    { label: "Total movidas", a: a.totalMovidas, b: b.totalMovidas, color: "text-slate-800 dark:text-white" },
    { label: "Depósito propio → cliente", a: a.depositoPropio, b: b.depositoPropio, color: "text-indigo-600 dark:text-indigo-400" },
    { label: "Entregó Cuchi", a: a.entregoCuchi, b: b.entregoCuchi, color: "text-fuchsia-600 dark:text-fuchsia-400" },
    { label: "Entregó Julián", a: a.entregoJulian, b: b.entregoJulian, color: "text-amber-600 dark:text-amber-400" },
  ];
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 capitalize">
          Mes actual · {nombreMes(ymActual)}
        </p>
        <div className="mt-2 space-y-1">
          {filas.map((f) => (
            <div key={f.label} className="flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-neutral-400">{f.label}</span>
              <span className={`font-bold ${f.color}`}>{money0(f.a)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400 capitalize">
          Mes anterior · {nombreMes(ymAnterior)}
        </p>
        <div className="mt-2 space-y-1">
          {filas.map((f) => (
            <div key={f.label} className="flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-neutral-400">{f.label}</span>
              <span className="font-bold text-slate-700 dark:text-neutral-300">{money0(f.b)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ETIQUETA_CATEGORIA = {
  propio: { texto: "Depósito propio → cliente", clase: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  cuchi: { texto: "Entregó Cuchi", clase: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300" },
  interno: { texto: "Interno (entre depósitos propios)", clase: "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400" },
  otro: { texto: "Otro", clase: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
};

function ResumenMensual({ meses, mesAbierto, onToggleMes }) {
  if (meses.length === 0) {
    return <p className="mt-4 text-center text-xs text-slate-400 dark:text-neutral-500">Sin movimientos de bicis en este rango.</p>;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-neutral-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-2.5">Mes</th>
            <th className="px-4 py-2.5 text-right">Total movidas (con internos)</th>
            <th className="px-4 py-2.5 text-right">Depósito propio → cliente</th>
            <th className="px-4 py-2.5 text-right">Entregó Cuchi</th>
            <th className="px-4 py-2.5 text-right">Entregó Julián</th>
            <th className="px-4 py-2.5 text-right">Total de esos 3</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
          {meses.map((m) => {
            const abierto = mesAbierto === m.ym;
            return (
              <Fragment key={m.ym}>
                <tr onClick={() => onToggleMes(abierto ? null : m.ym)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800/60">
                  <td className="px-4 py-2 font-semibold capitalize text-slate-900 dark:text-white">
                    {nombreMes(m.ym)} <span className="text-slate-400">{abierto ? "▲" : "▼"}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-neutral-300">{money0(m.totalMovidas)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-indigo-600 dark:text-indigo-400">{money0(m.depositoPropio)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-fuchsia-600 dark:text-fuchsia-400">{money0(m.entregoCuchi)}</td>
                  <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">{money0(m.entregoJulian)}</td>
                  <td className="px-4 py-2 text-right font-bold text-emerald-700 dark:text-emerald-400">
                    {money0(m.depositoPropio + m.entregoCuchi + m.entregoJulian)}
                  </td>
                </tr>
                {abierto && (
                  <tr>
                    <td colSpan={6} className="bg-slate-50 px-4 py-3 dark:bg-neutral-800/40">
                      <div className="max-h-96 space-y-1.5 overflow-y-auto">
                        {[...m.movimientos]
                          .sort((x, y) => (y.fecha || "").localeCompare(x.fecha || ""))
                          .map((mov, i) => {
                            const et = ETIQUETA_CATEGORIA[mov.categoria];
                            return (
                              <div key={i} className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    {(mov.fecha || "").slice(0, 10)} · {mov.origen?.trim() || "?"} → {mov.destino?.trim() || "?"}
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${et.clase}`}>{et.texto}</span>
                                    <span className="font-bold text-slate-700 dark:text-neutral-300">x{Number(mov.cantidad)}</span>
                                  </span>
                                </div>
                                <p className="mt-0.5 text-slate-500 dark:text-neutral-400">{mov.codigoNombre}</p>
                                {mov.descripcion && <p className="mt-0.5 text-slate-400 dark:text-neutral-500">💬 {mov.descripcion}</p>}
                              </div>
                            );
                          })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="bg-slate-50 px-4 py-2 text-[11px] text-slate-400 dark:bg-neutral-900 dark:text-neutral-500">
        <strong>Total movidas (con internos)</strong>: TODO lo que salió de un depósito propio, incluye también los movimientos entre
        depósitos propios (Lavalle/Cañuelas/Credifin) que todavía no son una entrega real a nadie — por eso siempre es el número más
        alto de la fila. <strong>Depósito propio → cliente</strong>: sale de Lavalle/Cañuelas/Credifin directo a un cliente (el depósito
        de Cuchi cuenta como "cliente" acá — es la entrega que LE hacemos a él). <strong>Entregó Cuchi</strong>: sale del depósito de
        Cuchi hacia uno de SUS clientes — es él repartiendo lo que ya tenía. <strong>Entregó Julián</strong>: busca su nombre en la
        descripción del movimiento, cuando está cargada — ojo, esto NO es una categoría aparte, es quién manejó la entrega, así que
        puede repetir bicis que ya están contadas en "Depósito propio → cliente" o en "Entregó Cuchi". <strong>Total de esos 3</strong>:
        la suma simple de esas tres columnas — por lo mismo (Julián puede solaparse con las otras dos) no es necesariamente "bicis
        únicas", es la suma cruda. Tocá un mes para ver fecha y cliente de cada movimiento.
      </p>
    </div>
  );
}

function CalendarioMovimientos({ bicis }) {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [mesAbierto, setMesAbierto] = useState(null);
  const [diaAbierto, setDiaAbierto] = useState(null);

  const porFecha = useMemo(() => {
    const map = new Map();
    for (const m of bicis) {
      const fecha = (m.fecha || "").slice(0, 10);
      if (!fecha) continue;
      if (!map.has(fecha)) map.set(fecha, []);
      map.get(fecha).push(m);
    }
    return map;
  }, [bicis]);

  const aniosDisponibles = useMemo(() => {
    const set = new Set([anioActual]);
    for (const fecha of porFecha.keys()) {
      const y = Number(fecha.slice(0, 4));
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [porFecha, anioActual]);

  function datosDelMes(mes) {
    let movimientos = 0;
    let cantidad = 0;
    for (const [fecha, lista] of porFecha) {
      if (!fecha.startsWith(`${anio}-${String(mes + 1).padStart(2, "0")}`)) continue;
      movimientos += lista.length;
      cantidad += lista.reduce((a, m) => a + Number(m.cantidad || 0), 0);
    }
    return { movimientos, cantidad };
  }

  if (mesAbierto == null) {
    return (
      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white">📅 {anio}</p>
          <div className="flex gap-1">
            {aniosDisponibles.map((a) => (
              <button
                key={a}
                onClick={() => setAnio(a)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  a === anio ? "bg-slate-900 text-white dark:bg-neutral-700" : "border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {MESES.map((nombre, i) => {
            const { movimientos, cantidad } = datosDelMes(i);
            const sinDatos = movimientos === 0;
            return (
              <button
                key={nombre}
                onClick={() => setMesAbierto(i)}
                disabled={sinDatos}
                className={`rounded-xl border p-3 text-left transition ${
                  sinDatos
                    ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-700"
                    : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow dark:border-neutral-700 dark:bg-neutral-900"
                }`}
              >
                <p className={`text-sm font-bold ${sinDatos ? "" : "text-slate-900 dark:text-white"}`}>{nombre}</p>
                {!sinDatos && (
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">
                    {movimientos} mov · {cantidad} bici{cantidad === 1 ? "" : "s"}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const primerDiaSemana = (() => {
    const d = new Date(anio, mesAbierto, 1).getDay();
    return d === 0 ? 6 : d - 1;
  })();
  const diasEnMes = new Date(anio, mesAbierto + 1, 0).getDate();
  const celdas = [...Array(primerDiaSemana).fill(null), ...Array.from({ length: diasEnMes }, (_, i) => i + 1)];
  function fechaISO(dia) {
    return `${anio}-${String(mesAbierto + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            setMesAbierto(null);
            setDiaAbierto(null);
          }}
          className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-white"
        >
          ← {anio}
        </button>
        <p className="text-sm font-bold text-slate-900 dark:text-white">
          {MESES[mesAbierto]} {anio}
        </p>
        <span className="w-10" />
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400 dark:text-neutral-500">
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {celdas.map((dia, idx) => {
          if (dia == null) return <span key={`vacio-${idx}`} />;
          const fecha = fechaISO(dia);
          const lista = porFecha.get(fecha) || [];
          const n = lista.reduce((a, m) => a + Number(m.cantidad || 0), 0);
          return (
            <button
              key={fecha}
              onClick={() => lista.length > 0 && setDiaAbierto(fecha)}
              disabled={lista.length === 0}
              className={`aspect-square rounded-lg border p-1 text-xs transition ${
                lista.length === 0
                  ? "cursor-default border-slate-100 text-slate-300 dark:border-neutral-800 dark:text-neutral-700"
                  : "border-emerald-200 bg-emerald-50 font-semibold text-emerald-700 hover:border-emerald-400 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400"
              }`}
            >
              {dia}
              {lista.length > 0 && <span className="mt-0.5 block text-[9px] font-bold">{n}</span>}
            </button>
          );
        })}
      </div>

      {diaAbierto && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/10">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              📆 {new Date(diaAbierto + "T00:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </p>
            <button onClick={() => setDiaAbierto(null)} className="text-slate-400 hover:text-slate-600 dark:text-neutral-500">
              ✕
            </button>
          </div>
          <div className="mt-2 space-y-1.5">
            {(porFecha.get(diaAbierto) || []).map((m, i) => {
              const et = ETIQUETA_CATEGORIA[categoriaMovimiento(m)];
              return (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {m.origen?.trim() || "?"} → {m.destino?.trim() || "?"}
                    </p>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${et.clase}`}>{et.texto}</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">x{Number(m.cantidad)}</span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-500 dark:text-neutral-400">{m.codigoNombre}</p>
                  {m.descripcion && <p className="mt-0.5 text-slate-400 dark:text-neutral-500">💬 {m.descripcion}</p>}
                  {m.usuarioAlta && <p className="mt-0.5 text-slate-300 dark:text-neutral-600">Cargado por: {m.usuarioAlta}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Movimientos exclusivamente entre nuestros 3 depósitos propios (Lavalle /
// Cañuelas / Credifin), depósito a depósito — no cuenta nada que vaya a un
// cliente ni a Cuchi, es puro acomodo de stock interno.
function MovimientosEntreDeposito({ bicis }) {
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");

  const todos = useMemo(() => {
    return bicis
      .filter((m) => esDepositoPropio(m.origen) && esDepositoPropio(m.destino))
      .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  }, [bicis]);

  const movimientos = useMemo(() => {
    return todos.filter((m) => {
      const f = (m.fecha || "").slice(0, 10);
      if (filtroDesde && f < filtroDesde) return false;
      if (filtroHasta && f > filtroHasta) return false;
      return true;
    });
  }, [todos, filtroDesde, filtroHasta]);

  const totalBicis = movimientos.reduce((a, m) => a + Number(m.cantidad || 0), 0);

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Desde</label>
          <input
            type="date"
            value={filtroDesde}
            onChange={(e) => setFiltroDesde(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">Hasta</label>
          <input
            type="date"
            value={filtroHasta}
            onChange={(e) => setFiltroHasta(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </div>
        {(filtroDesde || filtroHasta) && (
          <button
            onClick={() => {
              setFiltroDesde("");
              setFiltroHasta("");
            }}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400"
          >
            ✕ Limpiar
          </button>
        )}
        <p className="ml-auto text-[11px] text-slate-400 dark:text-neutral-500">
          Filtra dentro de lo ya traído (Desde/Hasta de arriba de todo). Para ver otro período, cambiá esos y tocá "Actualizar".
        </p>
      </div>

      {movimientos.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
          Sin movimientos entre depósitos propios en este rango.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-neutral-800">
      <div className="flex items-center justify-between bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
        <span>{movimientos.length} movimiento(s)</span>
        <span>{money0(totalBicis)} bici(s) en total</span>
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-slate-400 dark:bg-neutral-900 dark:text-neutral-500">
            <tr>
              <th className="px-4 py-1.5">Fecha</th>
              <th className="px-4 py-1.5">Origen</th>
              <th className="px-4 py-1.5">Destino</th>
              <th className="px-4 py-1.5 text-right">Cantidad</th>
              <th className="px-4 py-1.5">Descripción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
            {movimientos.map((m, i) => (
              <tr key={i}>
                <td className="px-4 py-1.5 text-slate-500 dark:text-neutral-400">{(m.fecha || "").slice(0, 10)}</td>
                <td className="px-4 py-1.5 font-medium text-slate-800 dark:text-white">{m.origen?.trim()}</td>
                <td className="px-4 py-1.5 font-medium text-slate-800 dark:text-white">{m.destino?.trim()}</td>
                <td className="px-4 py-1.5 text-right font-bold text-emerald-700 dark:text-emerald-400">{Number(m.cantidad)}</td>
                <td className="px-4 py-1.5 text-slate-400 dark:text-neutral-500">{m.descripcion || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        </div>
      )}
    </div>
  );
}
