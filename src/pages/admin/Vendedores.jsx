// src/pages/admin/Vendedores.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeClients } from "../../services/accounts";
import ClientesDeDistribuidorPanel from "../../components/admin/ClientesDeDistribuidorPanel";
import {
  subscribeClientesReportDetail,
  adminAsignarVendedor,
  adminListDistribuidoresConEquipo,
  getResumenComisionVendedor,
  setViajesVendedorMes,
  adminSetTarifasVendedor,
  adminAsignarClienteADistribuidor,
  createUserWithPassword,
} from "../../services/comprobantes";

function generarPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : `${s}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}

export const VENDEDORES = ["Federico", "Leo", "Emanuel", "Alfredo", "Pablo"];

// Cuenta corriente de distribuidores con equipo propio (campo
// `vendedoresAsignados`, ej. Alfredo Bavcevich) — cobran flete por viaje de
// Lavalle a su depósito + comisión sobre lo que facturan sus clientes. Acá
// el admin elige a quién ver, ajusta la tarifa/% de cada uno, y carga los
// viajes del mes (Contabilium no los registra).
function ResumenDistribuidoresConEquipo({ clientes }) {
  const [distribuidores, setDistribuidores] = useState(null);
  const [error, setError] = useState("");
  const [seleccionado, setSeleccionado] = useState("");
  const [mes, setMes] = useState(mesActual);
  const [resumen, setResumen] = useState(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [viajesInput, setViajesInput] = useState("");
  const [comisionInput, setComisionInput] = useState("");
  const [fleteInput, setFleteInput] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [buscarCliente, setBuscarCliente] = useState("");
  const [depositoAAsignar, setDepositoAAsignar] = useState("");
  const [agregandoUid, setAgregandoUid] = useState(null);
  const [modoAgregar, setModoAgregar] = useState("nuevo"); // "nuevo" | "existente"
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoPassword, setNuevoPassword] = useState("");
  const [nuevoCuit, setNuevoCuit] = useState("");
  const [nuevoDepositoId, setNuevoDepositoId] = useState("");
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [nuevoError, setNuevoError] = useState("");
  const [nuevoOk, setNuevoOk] = useState("");

  useEffect(() => {
    adminListDistribuidoresConEquipo()
      .then((r) => {
        setDistribuidores(r.distribuidores);
        if (r.distribuidores.length > 0) setSeleccionado(r.distribuidores[0].uid);
      })
      .catch((e) => setError(e.message || "No se pudo cargar"));
  }, []);

  const distActual = useMemo(() => distribuidores?.find((d) => d.uid === seleccionado) || null, [distribuidores, seleccionado]);

  const cargarResumen = useCallback((uid, m) => {
    if (!uid) return;
    setCargandoResumen(true);
    setError("");
    getResumenComisionVendedor(m, uid)
      .then((r) => {
        setResumen(r);
        setViajesInput(String(r.viajes));
      })
      .catch((e) => setError(e.message || "No se pudo cargar el resumen"))
      .finally(() => setCargandoResumen(false));
  }, []);

  useEffect(() => {
    if (seleccionado) cargarResumen(seleccionado, mes);
  }, [seleccionado, mes, cargarResumen]);

  useEffect(() => {
    if (distActual) {
      setComisionInput(String(distActual.comisionPorcentaje));
      setFleteInput(String(distActual.tarifaFletePorViaje));
    }
  }, [distActual]);

  async function guardarViajes() {
    setGuardando(true);
    try {
      await setViajesVendedorMes(mes, Number(viajesInput) || 0, seleccionado);
      cargarResumen(seleccionado, mes);
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarTarifas() {
    setGuardando(true);
    try {
      await adminSetTarifasVendedor(seleccionado, {
        comisionPorcentaje: Number(comisionInput),
        tarifaFletePorViaje: Number(fleteInput),
      });
      setDistribuidores((prev) =>
        prev.map((d) =>
          d.uid === seleccionado ? { ...d, comisionPorcentaje: Number(comisionInput), tarifaFletePorViaje: Number(fleteInput) } : d
        )
      );
      cargarResumen(seleccionado, mes);
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const resultadosBusqueda = useMemo(() => {
    const q = buscarCliente.trim().toLowerCase();
    if (q.length < 3) return [];
    return (clientes || []).filter((c) => (c.name || "").toLowerCase().includes(q)).slice(0, 8);
  }, [clientes, buscarCliente]);

  async function agregarCliente(clienteUid) {
    setAgregandoUid(clienteUid);
    try {
      await adminAsignarClienteADistribuidor(seleccionado, clienteUid, {
        contabiliumDepositoId: depositoAAsignar.trim() ? Number(depositoAAsignar.trim()) : undefined,
      });
      setBuscarCliente("");
      setDepositoAAsignar("");
      setDistribuidores((prev) =>
        prev.map((d) => (d.uid === seleccionado ? { ...d, cantidadClientesAsignados: d.cantidadClientesAsignados + 1 } : d))
      );
    } catch (e) {
      setError(e.message || "No se pudo agregar el cliente");
    } finally {
      setAgregandoUid(null);
    }
  }

  // Todo en un paso: crea la cuenta del cliente, la vincula a su depósito de
  // Contabilium (si se pasó) y lo suma a la cartera del distribuidor elegido
  // — antes eran 3 pasos sueltos en 2 pantallas distintas.
  async function crearYAgregarCliente() {
    if (!nuevoNombre.trim()) {
      setNuevoError("Falta el nombre del cliente");
      return;
    }
    if (!nuevoPassword || nuevoPassword.length < 6) {
      setNuevoError("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    setCreandoNuevo(true);
    setNuevoError("");
    setNuevoOk("");
    try {
      const { uid } = await createUserWithPassword(nuevoNombre.trim(), nuevoPassword, {
        cuit: nuevoCuit.trim() || undefined,
      });
      await adminAsignarClienteADistribuidor(seleccionado, uid, {
        contabiliumDepositoId: nuevoDepositoId.trim() ? Number(nuevoDepositoId.trim()) : undefined,
      });
      setDistribuidores((prev) =>
        prev.map((d) => (d.uid === seleccionado ? { ...d, cantidadClientesAsignados: d.cantidadClientesAsignados + 1 } : d))
      );
      setNuevoOk(`✓ "${nuevoNombre.trim()}" creado, con contraseña "${nuevoPassword}", y ya está en la cartera.`);
      setNuevoNombre("");
      setNuevoPassword("");
      setNuevoCuit("");
      setNuevoDepositoId("");
    } catch (e) {
      setNuevoError(e.message || "No se pudo crear el cliente");
    } finally {
      setCreandoNuevo(false);
    }
  }

  if (distribuidores !== null && distribuidores.length === 0) return null;

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/10">
      <h2 className="text-sm font-bold text-sky-800 dark:text-sky-400">💰 Cuenta corriente — distribuidores con equipo (flete + comisión)</h2>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {distribuidores === null && <p className="mt-2 text-xs text-sky-700/70 dark:text-sky-400/60">Cargando…</p>}

      {distribuidores && distribuidores.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-sky-800 dark:text-sky-300">
              Distribuidor
              <select
                value={seleccionado}
                onChange={(e) => setSeleccionado(e.target.value)}
                className="ml-1.5 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
              >
                {distribuidores.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.name || d.uid} ({d.cantidadClientesAsignados} clientes)
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-sky-800 dark:text-sky-300">
              Mes
              <input
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                className="ml-1.5 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
          </div>

          {seleccionado && (
            <div className="mt-3 border-t border-sky-100 pt-3 dark:border-sky-900/40">
              <p className="mb-2 text-xs font-bold text-sky-800 dark:text-sky-300">
                👥 Sus clientes (stock consignado, deuda y últimas facturas) — misma vista que ve {distActual?.name || "el distribuidor"} en "Mis clientes"
              </p>
              <ClientesDeDistribuidorPanel key={seleccionado} distribuidorUid={seleccionado} />
            </div>
          )}

          <div className="mt-3 border-t border-sky-100 pt-3 dark:border-sky-900/40">
            <p className="text-xs font-bold text-sky-800 dark:text-sky-300">+ Sumar un cliente a esta cartera</p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => setModoAgregar("nuevo")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  modoAgregar === "nuevo"
                    ? "bg-sky-600 text-white"
                    : "bg-white text-sky-700 hover:bg-sky-100 dark:bg-neutral-900 dark:text-sky-400"
                }`}
              >
                Cliente nuevo
              </button>
              <button
                type="button"
                onClick={() => setModoAgregar("existente")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  modoAgregar === "existente"
                    ? "bg-sky-600 text-white"
                    : "bg-white text-sky-700 hover:bg-sky-100 dark:bg-neutral-900 dark:text-sky-400"
                }`}
              >
                Ya tiene cuenta
              </button>
            </div>

            {modoAgregar === "nuevo" ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs text-sky-800 dark:text-sky-300">
                  Nombre
                  <input
                    type="text"
                    value={nuevoNombre}
                    onChange={(e) => setNuevoNombre(e.target.value)}
                    placeholder="ej: Compakjet"
                    className="ml-1.5 w-40 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-sky-800 dark:text-sky-300">
                  Contraseña
                  <span className="ml-1.5 inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={nuevoPassword}
                      onChange={(e) => setNuevoPassword(e.target.value)}
                      placeholder="mín. 6 caracteres"
                      className="w-28 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setNuevoPassword(generarPassword())}
                      title="Generar contraseña"
                      className="rounded-lg bg-sky-100 px-1.5 py-1 text-xs hover:bg-sky-200 dark:bg-sky-900/40"
                    >
                      🎲
                    </button>
                  </span>
                </label>
                <label className="text-xs text-sky-800 dark:text-sky-300">
                  CUIT (opcional)
                  <input
                    type="text"
                    value={nuevoCuit}
                    onChange={(e) => setNuevoCuit(e.target.value)}
                    placeholder="20-12345678-9"
                    className="ml-1.5 w-28 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-sky-800 dark:text-sky-300">
                  Depósito Contabilium (opcional)
                  <input
                    type="text"
                    value={nuevoDepositoId}
                    onChange={(e) => setNuevoDepositoId(e.target.value)}
                    placeholder="ej: 138727"
                    className="ml-1.5 w-24 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
                  />
                </label>
                <button
                  type="button"
                  disabled={creandoNuevo}
                  onClick={crearYAgregarCliente}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {creandoNuevo ? "Creando…" : "✓ Crear y sumar a la cartera"}
                </button>
                <p className="w-full text-[11px] text-slate-400 dark:text-neutral-500">
                  Si más adelante hay que vincular el depósito de Contabilium (porque todavía no existía), se puede hacer
                  después desde "Ya tiene cuenta" con el ID.
                </p>
                {nuevoError && <p className="w-full text-xs text-rose-600 dark:text-rose-400">{nuevoError}</p>}
                {nuevoOk && <p className="w-full text-xs font-medium text-emerald-600 dark:text-emerald-400">{nuevoOk}</p>}
              </div>
            ) : (
              <div className="relative mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs text-sky-800 dark:text-sky-300">
                  Buscar cliente
                  <input
                    type="text"
                    value={buscarCliente}
                    onChange={(e) => setBuscarCliente(e.target.value)}
                    placeholder="Escribí el nombre…"
                    className="ml-1.5 w-64 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-sky-800 dark:text-sky-300">
                  Depósito ID (opcional)
                  <input
                    type="text"
                    value={depositoAAsignar}
                    onChange={(e) => setDepositoAAsignar(e.target.value)}
                    placeholder="ej: 138727"
                    className="ml-1.5 w-24 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
                  />
                </label>
                {resultadosBusqueda.length > 0 && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-sky-200 bg-white shadow-lg dark:border-sky-900 dark:bg-neutral-900">
                    {resultadosBusqueda.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={agregandoUid === c.id}
                        onClick={() => agregarCliente(c.id)}
                        className="block w-full px-2.5 py-1.5 text-left text-xs hover:bg-sky-50 disabled:opacity-60 dark:hover:bg-sky-950/30"
                      >
                        {agregandoUid === c.id ? "Agregando…" : c.name}
                      </button>
                    ))}
                  </div>
                )}
                {buscarCliente.trim().length >= 3 && resultadosBusqueda.length === 0 && (
                  <p className="w-full text-[11px] text-amber-600 dark:text-amber-400">
                    No se encontró ningún cliente con ese nombre — si todavía no tiene cuenta, usá "Cliente nuevo".
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-sky-100 pt-3 dark:border-sky-900/40">
            <label className="text-xs text-sky-800 dark:text-sky-300">
              % comisión
              <input
                type="number"
                min="0"
                step="0.1"
                value={comisionInput}
                onChange={(e) => setComisionInput(e.target.value)}
                className="ml-1.5 w-16 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
            <label className="text-xs text-sky-800 dark:text-sky-300">
              Flete por viaje ($)
              <input
                type="number"
                min="0"
                value={fleteInput}
                onChange={(e) => setFleteInput(e.target.value)}
                className="ml-1.5 w-24 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
            <label className="text-xs text-sky-800 dark:text-sky-300">
              Viajes este mes
              <input
                type="number"
                min="0"
                value={viajesInput}
                onChange={(e) => setViajesInput(e.target.value)}
                className="ml-1.5 w-16 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
              />
            </label>
            <button
              onClick={guardarTarifas}
              disabled={guardando}
              className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-60 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-400"
            >
              Guardar tarifas
            </button>
            <button
              onClick={guardarViajes}
              disabled={guardando}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {guardando ? "Guardando…" : "Guardar viajes"}
            </button>
          </div>

          {cargandoResumen && <p className="mt-3 text-xs text-sky-700/70 dark:text-sky-400/60">Cargando resumen…</p>}
          {resumen && !cargandoResumen && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
                <p className="text-[11px] text-slate-500 dark:text-neutral-400">Flete ({resumen.viajes} viaje{resumen.viajes === 1 ? "" : "s"})</p>
                <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.fleteTotal)}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
                <p className="text-[11px] text-slate-500 dark:text-neutral-400">Ventas de sus clientes</p>
                <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.ventasTotal)}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
                <p className="text-[11px] text-slate-500 dark:text-neutral-400">Comisión ({resumen.comisionPorcentaje}%)</p>
                <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{money(resumen.comisionTotal)}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Total a cobrar</p>
                <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">{money(resumen.totalACobrar)}</p>
              </div>
            </div>
          )}

          {resumen && !cargandoResumen && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold text-sky-800 dark:text-sky-400">
                🚲 Bicis vendidas por sus clientes este mes ({resumen.comisionPorcentaje}% de comisión cada una)
              </p>
              {resumen.detalle.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-neutral-500">Sin ventas registradas este mes.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-sky-100 dark:border-sky-900/50">
                  <table className="min-w-full divide-y divide-sky-100 text-xs dark:divide-sky-900/50">
                    <thead className="bg-sky-50/60 dark:bg-sky-950/20">
                      <tr className="text-left text-slate-500 dark:text-neutral-400">
                        <th className="px-3 py-2 font-semibold">Fecha</th>
                        <th className="px-3 py-2 font-semibold">Cliente</th>
                        <th className="px-3 py-2 font-semibold">Modelo</th>
                        <th className="px-3 py-2 font-semibold">Cant.</th>
                        <th className="px-3 py-2 font-semibold text-right">Monto</th>
                        <th className="px-3 py-2 font-semibold text-right">Comisión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sky-50 bg-white dark:divide-sky-950/30 dark:bg-neutral-900">
                      {resumen.detalle.map((d, i) => (
                        <tr key={i} className={d.tipo === "NCA" ? "text-rose-600 dark:text-rose-400" : ""}>
                          <td className="whitespace-nowrap px-3 py-1.5">{formatFecha(d.fecha)}</td>
                          <td className="px-3 py-1.5">{d.cliente}</td>
                          <td className="px-3 py-1.5">
                            {d.modelo}
                            {d.tipo === "NCA" && <span className="ml-1 text-[10px] font-semibold">(N. Crédito)</span>}
                          </td>
                          <td className="px-3 py-1.5">{d.cantidad ?? "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right">{money(d.monto)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">{money(d.comision)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-sky-200 bg-sky-50/80 font-bold text-slate-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-white">
                        <td className="px-3 py-2" colSpan={4}>
                          Total
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{money(resumen.ventasTotal)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{money(resumen.comisionTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Vendedores() {
  const [clientes, setClientes] = useState(null);
  const [reporteDetail, setReporteDetail] = useState(null);
  const [filtro, setFiltro] = useState("todos"); // "todos" | vendedor | "sin-asignar"
  const [search, setSearch] = useState("");
  const [guardandoId, setGuardandoId] = useState(null);

  useEffect(() => {
    const u1 = subscribeClients("activo", setClientes, () => setClientes([]));
    const u2 = subscribeClientesReportDetail(setReporteDetail);
    return () => {
      u1();
      u2();
    };
  }, []);

  const reportePorUid = useMemo(() => {
    const map = new Map();
    for (const r of reporteDetail?.rows || []) map.set(r.uid, r);
    return map;
  }, [reporteDetail]);

  async function handleAsignar(uid, vendedor) {
    setGuardandoId(uid);
    try {
      await adminAsignarVendedor(uid, vendedor || null);
    } catch (e) {
      alert(e.message || "No se pudo guardar");
    } finally {
      setGuardandoId(null);
    }
  }

  const porVendedor = useMemo(() => {
    const map = new Map(VENDEDORES.map((v) => [v, []]));
    map.set("Sin asignar", []);
    for (const c of clientes || []) {
      const key = c.vendedor && VENDEDORES.includes(c.vendedor) ? c.vendedor : "Sin asignar";
      map.get(key).push(c);
    }
    return map;
  }, [clientes]);

  const rows = useMemo(() => {
    let list = clientes || [];
    if (filtro === "sin-asignar") {
      list = list.filter((c) => !c.vendedor || !VENDEDORES.includes(c.vendedor));
    } else if (filtro !== "todos") {
      list = list.filter((c) => c.vendedor === filtro);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => (c.name || "").toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [clientes, filtro, search]);

  const loading = clientes === null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Vendedores</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">Asigná un vendedor a cada cliente y filtrá su cartera.</p>
      </div>

      <ResumenDistribuidoresConEquipo clientes={clientes} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          onClick={() => setFiltro("todos")}
          className={`rounded-2xl border p-3 text-left transition ${
            filtro === "todos" ? "border-slate-900 bg-slate-900 text-white dark:border-neutral-500" : "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          }`}
        >
          <p className={`text-[11px] ${filtro === "todos" ? "text-slate-300" : "text-slate-500 dark:text-neutral-400"}`}>Todos</p>
          <p className="mt-1 text-lg font-bold">{(clientes || []).length}</p>
        </button>
        {VENDEDORES.map((v) => (
          <button
            key={v}
            onClick={() => setFiltro(v)}
            className={`rounded-2xl border p-3 text-left transition ${
              filtro === v ? "border-slate-900 bg-slate-900 text-white dark:border-neutral-500" : "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            }`}
          >
            <p className={`text-[11px] ${filtro === v ? "text-slate-300" : "text-slate-500 dark:text-neutral-400"}`}>{v}</p>
            <p className="mt-1 text-lg font-bold">{(porVendedor.get(v) || []).length}</p>
          </button>
        ))}
        <button
          onClick={() => setFiltro("sin-asignar")}
          className={`rounded-2xl border p-3 text-left transition ${
            filtro === "sin-asignar" ? "border-amber-500 bg-amber-500 text-white" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
          }`}
        >
          <p className={`text-[11px] ${filtro === "sin-asignar" ? "text-amber-100" : "text-amber-700 dark:text-amber-400"}`}>Sin asignar</p>
          <p className="mt-1 text-lg font-bold">{(porVendedor.get("Sin asignar") || []).length}</p>
        </button>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar cliente…"
        className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
      />

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-neutral-800">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Deuda</th>
                <th className="px-3 py-2 text-right">A favor</th>
                <th className="px-3 py-2">Vendedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
              {rows.map((c) => {
                const r = reportePorUid.get(c.id);
                return (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-neutral-900/50">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                      <Link to={`/admin/clientes-360?buscar=${encodeURIComponent(c.name || "")}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className={`px-3 py-2 text-right ${r?.saldoDeudor > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
                      {r?.saldoDeudor ? money(r.saldoDeudor) : "-"}
                    </td>
                    <td className={`px-3 py-2 text-right ${r?.saldoAFavor > 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}`}>
                      {r?.saldoAFavor ? money(r.saldoAFavor) : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={c.vendedor && VENDEDORES.includes(c.vendedor) ? c.vendedor : ""}
                        onChange={(e) => handleAsignar(c.id, e.target.value)}
                        disabled={guardandoId === c.id}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                      >
                        <option value="">Sin asignar</option>
                        {VENDEDORES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-400 dark:text-neutral-500">
                    Sin clientes en este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
