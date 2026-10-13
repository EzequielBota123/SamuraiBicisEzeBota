import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  subscribePedidosPendientes,
  crearPedidoPendiente,
  actualizarEstadoPedidoPendiente,
  confirmarPedidoPendiente,
  eliminarPedidoPendiente,
} from "../../services/pedidosPendientes";
import { searchContabiliumClientes, getDepositoStockAdmin } from "../../services/comprobantes";
import { crearViaje, DEPOSITOS_PROPIOS } from "../../services/logisticaViajes";
import { TURNOS } from "../../services/logisticaTurnos";

// Los 3 depósitos propios de FEPA — mismos ids que usa el resto del sistema
// (reporte de remitos, sector de chofer) para reconocerlos en Contabilium.
const DEPOSITOS = [
  { id: 135151, nombre: "Lavalle" },
  { id: 133531, nombre: "Cañuelas" },
  { id: 131151, nombre: "Credifin" },
];

const ESTADO_CLS = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  confirmado: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  cancelado: "border-slate-300 bg-slate-100 text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400",
};

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Arma el "Lugar" (origen) para la grilla logística a partir del depósito
// elegido en el pedido — dos de los tres (Lavalle, Cañuelas) ya están
// cargados con dirección en logisticaViajes.DEPOSITOS_PROPIOS; Credifin no
// tiene un punto de ruta cargado ahí, así que queda sin dirección (se
// puede completar después, editando el viaje desde la grilla).
function lugarDeposito(nombreDeposito) {
  const match = DEPOSITOS_PROPIOS.find((d) => nombreDeposito.toLowerCase().includes(d.id) || d.nombre.toLowerCase().includes(nombreDeposito.toLowerCase()));
  if (match) return { tipo: "deposito", ...match, lat: null, lon: null };
  return { tipo: "deposito", id: null, nombre: nombreDeposito, direccion: "", lat: null, lon: null, horario: null, telefono: null };
}

export default function PedidosPendientes() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const [pedidos, setPedidos] = useState(null);
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("pendiente");

  useEffect(() => subscribePedidosPendientes(setPedidos, (e) => setError(e.message || String(e))), []);

  // ---- Form de carga ----
  const [deposito, setDeposito] = useState(DEPOSITOS[0].nombre);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteContabiliumId, setClienteContabiliumId] = useState(null);
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [notas, setNotas] = useState("");
  const [items, setItems] = useState([{ sku: "", nombre: "", cantidad: 1 }]);
  const [guardando, setGuardando] = useState(false);
  const [busquedaSku, setBusquedaSku] = useState({});

  // Si se llega desde la ficha de un cliente en Clientes 360, viene con el
  // cliente ya elegido por querystring — se precarga una sola vez.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nombre = params.get("clienteNombre");
    const idStr = params.get("clienteContabiliumId");
    if (nombre) setClienteNombre(nombre);
    if (idStr) setClienteContabiliumId(Number(idStr));
    const tel = params.get("clienteTelefono");
    if (tel) setClienteTelefono(tel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Stock real por depósito (Contabilium), para elegir bicicleta por
  // bicicleta viendo cuánto hay disponible en el depósito seleccionado. Se
  // trae de a uno y se cachea — no hace falta repetir el pedido al tocar
  // entre depósitos ya consultados.
  const depositoActual = DEPOSITOS.find((d) => d.nombre === deposito) || DEPOSITOS[0];
  const [stockPorDeposito, setStockPorDeposito] = useState({});
  const [stockCargando, setStockCargando] = useState({});
  const [stockError, setStockError] = useState({});

  useEffect(() => {
    const d = depositoActual;
    if (stockPorDeposito[d.id] || stockCargando[d.id]) return;
    setStockCargando((s) => ({ ...s, [d.id]: true }));
    getDepositoStockAdmin(d.id)
      .then((r) => setStockPorDeposito((s) => ({ ...s, [d.id]: r.items || [] })))
      .catch((err) => setStockError((s) => ({ ...s, [d.id]: err.message || String(err) })))
      .finally(() => setStockCargando((s) => ({ ...s, [d.id]: false })));
  }, [depositoActual.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Buscador de cliente contra Contabilium/Samurai en vivo — nada de texto
  // libre: el pedido siempre queda atado a un cliente real (contabiliumId).
  const [clienteResultados, setClienteResultados] = useState([]);
  const [clienteBuscando, setClienteBuscando] = useState(false);
  const [clientePickerOpen, setClientePickerOpen] = useState(false);
  useEffect(() => {
    if (clienteContabiliumId || clienteNombre.trim().length < 3) {
      setClienteResultados([]);
      return;
    }
    let cancelado = false;
    setClienteBuscando(true);
    const timer = setTimeout(() => {
      searchContabiliumClientes(clienteNombre.trim())
        .then((r) => !cancelado && setClienteResultados(r.resultados || []))
        .catch(() => !cancelado && setClienteResultados([]))
        .finally(() => !cancelado && setClienteBuscando(false));
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [clienteNombre, clienteContabiliumId]);

  function actualizarItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function agregarItem() {
    setItems((prev) => [...prev, { sku: "", nombre: "", cantidad: 1 }]);
  }
  function quitarItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Busca solo entre lo que ese depósito tiene disponible de verdad — así se
  // puede corroborar en el momento si la bici se puede mandar o no.
  const stockDeposito = stockPorDeposito[depositoActual.id] || [];
  const stockItemsFiltrados = (texto) => {
    const q = (texto || "").trim().toLowerCase();
    const conStock = stockDeposito.filter((p) => p.stockDisponible > 0);
    if (!q) return conStock.slice(0, 8);
    return conStock.filter((p) => (p.name || "").toLowerCase().includes(q) || String(p.sku || "").includes(q)).slice(0, 8);
  };
  const stockDisponibleDeSku = (sku) => stockDeposito.find((p) => p.sku === sku)?.stockDisponible ?? null;

  async function handleCrearPedido(e) {
    e.preventDefault();
    const itemsValidos = items.filter((it) => it.sku && it.nombre.trim() && it.cantidad > 0);
    if (!clienteContabiliumId || itemsValidos.length === 0) return;
    setGuardando(true);
    try {
      await crearPedidoPendiente({
        deposito,
        clienteNombre,
        clienteContabiliumId,
        clienteTelefono,
        items: itemsValidos,
        notas,
        creadoPorNombre: profile?.name || user?.email || "",
      });
      setClienteNombre("");
      setClienteContabiliumId(null);
      setClienteTelefono("");
      setNotas("");
      setItems([{ sku: "", nombre: "", cantidad: 1 }]);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setGuardando(false);
    }
  }

  // ---- Confirmar (pide fecha/turno y crea el viaje en la grilla) ----
  const [confirmando, setConfirmando] = useState(null); // pedido en curso de confirmación
  const [fechaViaje, setFechaViaje] = useState(hoyISO());
  const [turnoViaje, setTurnoViaje] = useState("mañana");
  const [confirmLoading, setConfirmLoading] = useState(false);

  async function handleConfirmar() {
    if (!confirmando) return;
    setConfirmLoading(true);
    try {
      const resumenItems = confirmando.items.map((it) => `${it.cantidad}x ${it.nombre}${it.sku ? ` (SKU ${it.sku})` : ""}`).join(", ");
      const notasViaje = [resumenItems, confirmando.notas].filter(Boolean).join(" — ");
      const viajeId = await crearViaje(
        {
          fecha: fechaViaje,
          turno: turnoViaje,
          origen: lugarDeposito(confirmando.deposito),
          destino: {
            tipo: "cliente",
            id: confirmando.clienteContabiliumId ? String(confirmando.clienteContabiliumId) : null,
            nombre: confirmando.clienteNombre,
            direccion: "",
            lat: null,
            lon: null,
            telefono: confirmando.clienteTelefono || null,
          },
          horaSalida: null,
          duracionMin: null,
          distanciaKm: null,
          descargaMin: 20,
          notas: notasViaje,
          remito: null,
          pedidoPendienteId: confirmando.id,
        },
        { uid: user?.uid || "", nombre: profile?.name || user?.email || null }
      );
      await confirmarPedidoPendiente(confirmando.id, { fecha: fechaViaje, turno: turnoViaje, viajeId });
      setConfirmando(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setConfirmLoading(false);
    }
  }

  const pedidosFiltrados = useMemo(() => {
    if (!pedidos) return [];
    if (filtroEstado === "todos") return pedidos;
    return pedidos.filter((p) => p.estado === filtroEstado);
  }, [pedidos, filtroEstado]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">📋 Pedidos a confirmar</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Tablero visual: anotá acá lo que un cliente pidió de alguno de los 3 depósitos propios para no perderlo de vista. No mueve stock ni toca Contabilium. Al confirmar un pedido con fecha, se crea automáticamente el viaje en la{" "}
          <a href="/admin/chofer/grilla" className="underline">
            grilla logística del chofer
          </a>
          .
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Form de carga */}
      <form onSubmit={handleCrearPedido} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Depósito</label>
            <select
              value={deposito}
              onChange={(e) => setDeposito(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            >
              {DEPOSITOS.map((d) => (
                <option key={d.id} value={d.nombre}>
                  {d.nombre}
                </option>
              ))}
            </select>
            {stockCargando[depositoActual.id] && <p className="mt-1 text-[11px] text-slate-400">Consultando stock real en Contabilium…</p>}
            {stockError[depositoActual.id] && <p className="mt-1 text-[11px] text-rose-600">{stockError[depositoActual.id]}</p>}
          </div>
          <div className="relative">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Cliente</label>
            <input
              value={clienteNombre}
              onChange={(e) => {
                setClienteNombre(e.target.value);
                setClienteContabiliumId(null);
                setClientePickerOpen(true);
              }}
              onFocus={() => setClientePickerOpen(true)}
              onBlur={() => setTimeout(() => setClientePickerOpen(false), 150)}
              placeholder="Buscar cliente de Contabilium…"
              required
              className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm dark:bg-neutral-800 ${
                clienteContabiliumId ? "border-emerald-400 dark:border-emerald-600" : "border-slate-200 dark:border-neutral-700"
              }`}
            />
            {clienteContabiliumId && (
              <p className="mt-1 text-[11px] text-emerald-600">✓ Cliente real de Contabilium (#{clienteContabiliumId})</p>
            )}
            {!clienteContabiliumId && clienteNombre.trim().length >= 3 && !clienteBuscando && clienteResultados.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">Sin resultados — no se puede cargar un cliente que no existe en Contabilium.</p>
            )}
            {clientePickerOpen && (clienteBuscando || clienteResultados.length > 0) && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                {clienteBuscando && <div className="px-3 py-2 text-xs text-slate-400">Buscando…</div>}
                {clienteResultados.map((c) => (
                  <button
                    type="button"
                    key={c.contabiliumId}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setClienteNombre(c.razonSocial);
                      setClienteContabiliumId(c.contabiliumId);
                      if (c.telefono && !clienteTelefono) setClienteTelefono(c.telefono);
                      setClientePickerOpen(false);
                      setClienteResultados([]);
                    }}
                    className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-neutral-700"
                  >
                    {c.razonSocial} <span className="text-slate-400">{c.cuit ? `· CUIT ${c.cuit}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Teléfono (opcional)</label>
            <input
              value={clienteTelefono}
              onChange={(e) => setClienteTelefono(e.target.value)}
              placeholder="11 1234-5678"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            Items pedidos — stock real en {depositoActual.nombre}
          </label>
          {items.map((it, i) => {
            const stockDelItem = it.sku ? stockDisponibleDeSku(it.sku) : null;
            const excedeStock = stockDelItem != null && it.cantidad > stockDelItem;
            return (
              <div key={i} className="relative flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <input
                    value={it.nombre}
                    onChange={(e) => {
                      actualizarItem(i, { nombre: e.target.value, sku: "" });
                      setBusquedaSku((s) => ({ ...s, [i]: e.target.value }));
                    }}
                    placeholder={stockCargando[depositoActual.id] ? "Cargando stock del depósito…" : "Buscar bicicleta por nombre o SKU…"}
                    disabled={stockCargando[depositoActual.id]}
                    className={`w-full rounded-xl border bg-white px-3 py-2 text-sm dark:bg-neutral-800 ${
                      it.sku ? "border-emerald-400 dark:border-emerald-600" : "border-slate-200 dark:border-neutral-700"
                    }`}
                  />
                  {it.sku && (
                    <p className={`mt-1 text-[11px] ${excedeStock ? "text-rose-600" : "text-emerald-600"}`}>
                      {excedeStock ? "⚠" : "✓"} Stock disponible en {depositoActual.nombre}: {stockDelItem ?? "?"}
                      {excedeStock ? " — no alcanza para la cantidad pedida" : ""}
                    </p>
                  )}
                  {!it.sku && it.nombre.trim().length >= 2 && !stockCargando[depositoActual.id] && stockItemsFiltrados(it.nombre).length === 0 && (
                    <p className="mt-1 text-[11px] text-amber-600">Sin stock disponible de eso en {depositoActual.nombre}.</p>
                  )}
                  {busquedaSku[i] && stockItemsFiltrados(busquedaSku[i]).length > 0 && !it.sku && (
                    <div className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                      {stockItemsFiltrados(busquedaSku[i]).map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => {
                            actualizarItem(i, { nombre: p.name, sku: p.sku || "" });
                            setBusquedaSku((s) => ({ ...s, [i]: "" }));
                          }}
                          className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-neutral-700"
                        >
                          {p.sku} — {p.name} <span className="text-slate-400">(disponible {p.stockDisponible})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  min={1}
                  value={it.cantidad}
                  onChange={(e) => actualizarItem(i, { cantidad: Number(e.target.value) || 1 })}
                  className={`w-20 rounded-xl border bg-white px-3 py-2 text-sm dark:bg-neutral-800 ${
                    excedeStock ? "border-rose-400 dark:border-rose-600" : "border-slate-200 dark:border-neutral-700"
                  }`}
                />
                {items.length > 1 && (
                  <button type="button" onClick={() => quitarItem(i)} className="text-slate-400 hover:text-rose-500">
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" onClick={agregarItem} className="text-xs font-medium text-sky-600 hover:underline">
            + agregar item
          </button>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Notas (opcional)</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>

        <button
          type="submit"
          disabled={guardando || !clienteContabiliumId || !items.some((it) => it.sku)}
          className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {guardando ? "Guardando…" : "+ Cargar pedido pendiente"}
        </button>
      </form>

      {/* Filtro + lista */}
      <div className="flex gap-2">
        {["pendiente", "confirmado", "cancelado", "todos"].map((f) => (
          <button
            key={f}
            onClick={() => setFiltroEstado(f)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium capitalize transition ${
              filtroEstado === f
                ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {pedidos === null && <p className="text-sm text-slate-400">Cargando…</p>}
        {pedidos !== null && pedidosFiltrados.length === 0 && <p className="text-sm text-slate-400">Sin pedidos en este filtro.</p>}
        {pedidosFiltrados.map((p) => (
          <div key={p.id} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{p.clienteNombre}</p>
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  {p.deposito}
                  {p.clienteTelefono ? ` · ${p.clienteTelefono}` : ""}
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${ESTADO_CLS[p.estado]}`}>{p.estado}</span>
            </div>

            <ul className="space-y-1 text-sm text-slate-600 dark:text-neutral-300">
              {p.items.map((it, i) => (
                <li key={i}>
                  • {it.cantidad}x {it.nombre} {it.sku ? <span className="text-slate-400">(SKU {it.sku})</span> : null}
                </li>
              ))}
            </ul>

            {p.notas && <p className="rounded-xl bg-slate-50 p-2 text-xs text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">{p.notas}</p>}

            {p.estado === "confirmado" && p.fechaConfirmada && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                ✅ Viaje creado para el {p.fechaConfirmada} ({p.turnoConfirmado}) —{" "}
                <a href="/admin/chofer/grilla" className="underline">
                  ver en grilla
                </a>
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {p.estado === "pendiente" && (
                <>
                  <button
                    onClick={() => setConfirmando(p)}
                    className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    Confirmar con fecha →
                  </button>
                  <button
                    onClick={() => actualizarEstadoPedidoPendiente(p.id, "cancelado")}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-rose-300 hover:text-rose-600 dark:border-neutral-700"
                  >
                    Cancelar
                  </button>
                </>
              )}
              {p.estado !== "confirmado" && (
                <button
                  onClick={() => eliminarPedidoPendiente(p.id)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-rose-300 hover:text-rose-600 dark:border-neutral-700"
                >
                  Borrar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal de confirmación con fecha/turno */}
      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-xl dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Confirmar pedido de {confirmando.clienteNombre}</h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">Esto va a crear el viaje en la grilla logística del chofer, desde {confirmando.deposito} hasta {confirmando.clienteNombre}.</p>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Fecha</label>
              <input
                type="date"
                value={fechaViaje}
                onChange={(e) => setFechaViaje(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Turno</label>
              <select
                value={turnoViaje}
                onChange={(e) => setTurnoViaje(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm capitalize dark:border-neutral-700 dark:bg-neutral-800"
              >
                {TURNOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmando(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-500 dark:border-neutral-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmar}
                disabled={confirmLoading}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {confirmLoading ? "Creando viaje…" : "Confirmar y crear viaje"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
