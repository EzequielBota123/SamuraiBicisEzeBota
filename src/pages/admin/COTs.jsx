import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { listCotizaciones } from "../../services/comprobantes";
import { db, auth } from "../../firebase";
import { useAuth } from "../../auth/AuthContext";
import { puedeVerCots } from "../../utils/permisosCots";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function fmtFecha(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : `${s}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Historial manual de COTs cobrados en efectivo — a diferencia del resto de
// esta pantalla (que viene en vivo de Contabilium), esto vive en Firestore
// porque no hay forma de distinguir "efectivo" de forma confiable desde la
// API: hay que cargarlo a mano cada vez que se cobra un COT así. Arranca
// con el historial existente (ej. Julian Brauer Larraburu) y de ahí en más
// se va sumando cada cobro nuevo en efectivo.
//
// Además de los ingresos (COTs cobrados en efectivo) también se cargan acá
// los egresos — plata que sale de esa misma caja para pagar algo puntual
// (ej. nafta, un service, un adelanto) — para que el total muestre lo que
// realmente queda disponible, no solo lo que entró.
function CajaEfectivoCot() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [tipo, setTipo] = useState("ingreso"); // "ingreso" | "egreso"
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [clienteNombre, setClienteNombre] = useState("");
  const [numeroCot, setNumeroCot] = useState("");
  const [concepto, setConcepto] = useState("");
  const [origenIngresoId, setOrigenIngresoId] = useState("");
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "cajaEfectivoCots"), orderBy("fecha", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => setError(e.message || "No se pudo cargar la caja de efectivo")
    );
    return unsub;
  }, []);

  // Los registros viejos no tienen "tipo" — son todos ingresos (así
  // arrancó esta caja, antes de que existieran los egresos).
  const { totalIngresos, totalEgresos, disponible, ingresos, saldoPorIngreso } = useMemo(() => {
    let tIngresos = 0;
    let tEgresos = 0;
    const porIngreso = new Map(); // ingresoId -> gastado
    const listaIngresos = [];
    for (const it of items || []) {
      if (it.tipo === "egreso") {
        tEgresos += Number(it.monto || 0);
        if (it.origenIngresoId) {
          porIngreso.set(it.origenIngresoId, (porIngreso.get(it.origenIngresoId) || 0) + Number(it.monto || 0));
        }
      } else {
        tIngresos += Number(it.monto || 0);
        listaIngresos.push(it);
      }
    }
    return { totalIngresos: tIngresos, totalEgresos: tEgresos, disponible: tIngresos - tEgresos, ingresos: listaIngresos, saldoPorIngreso: porIngreso };
  }, [items]);

  async function handleAgregar() {
    setError("");
    if (tipo === "ingreso" && !clienteNombre.trim()) {
      setError("Ingresá el cliente");
      return;
    }
    if (tipo === "egreso" && !concepto.trim()) {
      setError("Ingresá el concepto del gasto");
      return;
    }
    if (tipo === "egreso" && !origenIngresoId) {
      setError("Elegí de qué pago sale este gasto");
      return;
    }
    if (!(Number(monto) > 0)) {
      setError("Ingresá un monto mayor a 0");
      return;
    }
    setGuardando(true);
    try {
      const origen = tipo === "egreso" ? ingresos.find((i) => i.id === origenIngresoId) : null;
      await addDoc(collection(db, "cajaEfectivoCots"), {
        tipo,
        fecha,
        clienteNombre: tipo === "ingreso" ? clienteNombre.trim() : concepto.trim(),
        numeroCot: tipo === "ingreso" ? numeroCot.trim() || null : null,
        origenIngresoId: tipo === "egreso" ? origenIngresoId : null,
        origenIngresoCliente: origen ? origen.clienteNombre : null,
        monto: Number(monto),
        nota: nota.trim() || null,
        cargadoPor: auth.currentUser?.email || null,
        createdAt: serverTimestamp(),
      });
      setClienteNombre("");
      setNumeroCot("");
      setConcepto("");
      setOrigenIngresoId("");
      setMonto("");
      setNota("");
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function handleBorrar(id) {
    if (!confirm("¿Borrar esta línea de la caja de efectivo?")) return;
    try {
      await deleteDoc(doc(db, "cajaEfectivoCots", id));
    } catch (e) {
      setError(e.message || "No se pudo borrar");
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-emerald-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-emerald-800 dark:text-emerald-400">💵 Caja Efectivo (COTs)</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-emerald-700 dark:text-emerald-400">Ingresos: {money(totalIngresos)}</span>
          <span className="text-rose-600 dark:text-rose-400">Egresos: {money(totalEgresos)}</span>
          <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            Disponible: {money(disponible)}
          </span>
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-emerald-700/70 dark:text-emerald-400/60">
        Historial cargado a mano de COTs cobrados en efectivo (y lo que sale de esa misma caja, ej. nafta, un
        service) — no viene de Contabilium, hay que agregarlo acá cada vez.
      </p>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTipo("ingreso")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            tipo === "ingreso"
              ? "bg-emerald-600 text-white"
              : "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-neutral-900 dark:text-emerald-400"
          }`}
        >
          + Ingreso (COT cobrado)
        </button>
        <button
          type="button"
          onClick={() => setTipo("egreso")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            tipo === "egreso"
              ? "bg-rose-600 text-white"
              : "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:bg-neutral-900 dark:text-rose-400"
          }`}
        >
          − Egreso (gasto pagado con esta caja)
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-emerald-800 dark:text-emerald-300">
          Fecha
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="ml-1.5 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs dark:border-emerald-900 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        {tipo === "ingreso" ? (
          <>
            <label className="text-xs text-emerald-800 dark:text-emerald-300">
              Cliente
              <input
                type="text"
                value={clienteNombre}
                onChange={(e) => setClienteNombre(e.target.value)}
                placeholder="Nombre del cliente"
                className="ml-1.5 w-40 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs dark:border-emerald-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
            <label className="text-xs text-emerald-800 dark:text-emerald-300">
              N° COT
              <input
                type="text"
                value={numeroCot}
                onChange={(e) => setNumeroCot(e.target.value)}
                placeholder="0001-00000000"
                className="ml-1.5 w-32 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs dark:border-emerald-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
          </>
        ) : (
          <>
            <label className="text-xs text-emerald-800 dark:text-emerald-300">
              De qué pago sale
              <select
                value={origenIngresoId}
                onChange={(e) => setOrigenIngresoId(e.target.value)}
                className="ml-1.5 w-52 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs dark:border-emerald-900 dark:bg-neutral-900 dark:text-white"
              >
                <option value="">Elegí un ingreso…</option>
                {ingresos.map((ing) => {
                  const gastado = saldoPorIngreso.get(ing.id) || 0;
                  const restante = Number(ing.monto || 0) - gastado;
                  return (
                    <option key={ing.id} value={ing.id}>
                      {ing.clienteNombre} — quedan {money(restante)} ({fmtFecha(ing.fecha)})
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-xs text-emerald-800 dark:text-emerald-300">
              Concepto
              <input
                type="text"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="ej: nafta, service para Julian…"
                className="ml-1.5 w-44 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs dark:border-emerald-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
          </>
        )}
        <label className="text-xs text-emerald-800 dark:text-emerald-300">
          Monto
          <input
            type="number"
            min="1"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="ml-1.5 w-28 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs dark:border-emerald-900 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        <label className="text-xs text-emerald-800 dark:text-emerald-300">
          Nota (opcional)
          <input
            type="text"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            className="ml-1.5 w-40 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs dark:border-emerald-900 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        <button
          onClick={handleAgregar}
          disabled={guardando}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-60 ${
            tipo === "egreso" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {guardando ? "Guardando…" : "+ Agregar"}
        </button>
      </div>

      <div className="mt-3 space-y-1">
        {items === null && <p className="text-xs text-emerald-700/70 dark:text-emerald-400/60">Cargando…</p>}
        {items && items.length === 0 && (
          <p className="text-xs text-emerald-700/70 dark:text-emerald-400/60">Todavía no hay nada cargado.</p>
        )}
        {items && items.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-emerald-100 bg-white dark:border-emerald-900/50 dark:bg-neutral-900">
            <table className="min-w-full divide-y divide-emerald-50 text-xs dark:divide-emerald-900/40">
              <thead>
                <tr className="bg-emerald-50/60 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Cliente / Concepto</th>
                  <th className="px-3 py-2 text-left">N° COT</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2 text-left">Nota</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-50 dark:divide-emerald-900/40">
                {items.map((it) => {
                  const esEgreso = it.tipo === "egreso";
                  const gastado = !esEgreso ? saldoPorIngreso.get(it.id) || 0 : 0;
                  const restante = Number(it.monto || 0) - gastado;
                  return (
                    <tr key={it.id}>
                      <td className="px-3 py-1.5 text-slate-600 dark:text-neutral-300">{fmtFecha(it.fecha)}</td>
                      <td className="px-3 py-1.5 text-slate-800 dark:text-neutral-200">
                        {esEgreso ? (
                          <>
                            <span className="mr-1 text-rose-500" title="Egreso">−</span>
                            {it.clienteNombre}
                            {it.origenIngresoCliente && (
                              <span className="block text-[10px] text-slate-400 dark:text-neutral-500">
                                de: {it.origenIngresoCliente}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {it.clienteNombre}
                            {gastado > 0 && (
                              <span className="block text-[10px] text-slate-400 dark:text-neutral-500">
                                quedan {money(restante)}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-600 dark:text-neutral-300">{it.numeroCot || "-"}</td>
                      <td
                        className={`px-3 py-1.5 text-right font-semibold ${
                          esEgreso ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {esEgreso ? "-" : ""}
                        {money(it.monto)}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 dark:text-neutral-400">{it.nota || ""}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button onClick={() => handleBorrar(it.id)} className="text-rose-500 hover:text-rose-700">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Todas las Cotizaciones (COT) de Contabilium en un solo lugar — muchos
// clientes viejos usaron COT como "venta" antes de tener facturación
// electrónica, y siguen contando como deuda real de cuenta corriente
// aunque no tengan CAE. Esta pantalla permite verlas todas, a quién
// corresponde cada una, y filtrarlas por nombre/CUIT.
export default function COTs() {
  const { user } = useAuth();
  const permitido = puedeVerCots(user?.uid);
  const [cots, setCots] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [soloConSaldo, setSoloConSaldo] = useState(false);

  useEffect(() => {
    if (!permitido) return;
    setLoading(true);
    setError("");
    listCotizaciones()
      .then((r) => setCots(r.items))
      .catch((e) => setError(e.message || "No se pudieron cargar las cotizaciones"))
      .finally(() => setLoading(false));
  }, [permitido]);

  const filtradas = useMemo(() => {
    if (!cots) return [];
    let base = cots;
    if (soloConSaldo) base = base.filter((c) => Number(c.saldo) > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      base = base.filter((c) => `${c.clienteNombre || ""} ${c.cuit || ""} ${c.numero || ""}`.toLowerCase().includes(q));
    }
    return base;
  }, [cots, search, soloConSaldo]);

  const totales = useMemo(() => {
    const total = filtradas.reduce((acc, c) => acc + Number(c.total || 0), 0);
    const saldo = filtradas.reduce((acc, c) => acc + Number(c.saldo || 0), 0);
    return { total, saldo, cantidad: filtradas.length };
  }, [filtradas]);

  // Agrupadas por cliente (clienteId), ordenadas por saldo pendiente
  // descendente — así arriba de todo aparece a quién más se le debe cobrar.
  const grupos = useMemo(() => {
    const map = new Map();
    for (const c of filtradas) {
      const key = c.clienteId ?? "sin-cliente";
      if (!map.has(key)) {
        map.set(key, { clienteId: c.clienteId, clienteNombre: c.clienteNombre, cuit: c.cuit, items: [], total: 0, saldo: 0 });
      }
      const g = map.get(key);
      g.items.push(c);
      g.total += Number(c.total || 0);
      g.saldo += Number(c.saldo || 0);
    }
    return [...map.values()].sort((a, b) => b.saldo - a.saldo || b.total - a.total);
  }, [filtradas]);

  const [abiertos, setAbiertos] = useState(() => new Set());
  function toggleAbierto(clienteId) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(clienteId)) next.delete(clienteId);
      else next.add(clienteId);
      return next;
    });
  }

  if (!permitido) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-slate-500 dark:text-neutral-400">No tenés acceso a esta sección.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">🧾 Cotizaciones (COT)</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Todas las cotizaciones cargadas en Contabilium, con el cliente al que corresponden — muchas se usaron
          como registro de venta antes de tener facturación electrónica y siguen contando como deuda real.
        </p>
      </div>

      <CajaEfectivoCot />

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}

      {cots && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Buscar por cliente, CUIT o número…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
            <button
              onClick={() => setSoloConSaldo((v) => !v)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                soloConSaldo
                  ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              {soloConSaldo ? "✓ Solo con saldo pendiente" : "Solo con saldo pendiente"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-slate-500 dark:text-neutral-400">Cantidad</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{totales.cantidad}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-slate-500 dark:text-neutral-400">Total facturado en COT</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{money(totales.total)}</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/20">
              <p className="text-xs text-rose-700 dark:text-rose-400">Saldo pendiente</p>
              <p className="mt-1 text-lg font-bold text-rose-700 dark:text-rose-400">{money(totales.saldo)}</p>
            </div>
          </div>

          <div className="space-y-2">
            {grupos.map((g) => {
              const abierto = abiertos.has(g.clienteId);
              return (
                <div key={g.clienteId ?? "sin-cliente"} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                  <button
                    onClick={() => toggleAbierto(g.clienteId)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-neutral-800/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {abierto ? "▾" : "▸"} {g.clienteNombre || "(sin cliente)"}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-neutral-500">
                        {g.cuit || "sin CUIT"} · {g.items.length} COT{g.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 text-right">
                      <div>
                        <p className="text-[11px] text-slate-400 dark:text-neutral-500">Total</p>
                        <p className="text-sm font-semibold text-slate-700 dark:text-neutral-300">{money(g.total)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-400 dark:text-neutral-500">Saldo</p>
                        <p className={`text-sm font-bold ${g.saldo > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {money(g.saldo)}
                        </p>
                      </div>
                    </div>
                  </button>

                  {abierto && (
                    <div className="border-t border-slate-100 dark:border-neutral-800">
                      <table className="min-w-full divide-y divide-slate-50 text-sm dark:divide-neutral-800">
                        <thead>
                          <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-neutral-800/60 dark:text-neutral-400">
                            <th className="px-4 py-2 text-left">N°</th>
                            <th className="px-4 py-2 text-left">Fecha</th>
                            <th className="px-4 py-2 text-right">Total</th>
                            <th className="px-4 py-2 text-right">Saldo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-neutral-800">
                          {g.items
                            .slice()
                            .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
                            .map((c) => (
                              <tr key={c.id}>
                                <td className="px-4 py-2 font-mono text-xs text-slate-600 dark:text-neutral-300">{c.numero}</td>
                                <td className="px-4 py-2 text-slate-600 dark:text-neutral-300">{fmtFecha(c.fecha)}</td>
                                <td className="px-4 py-2 text-right text-slate-900 dark:text-white">{money(c.total)}</td>
                                <td className={`px-4 py-2 text-right font-semibold ${Number(c.saldo) > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                  {money(c.saldo)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {grupos.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400 dark:text-neutral-500">No hay cotizaciones para mostrar.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
