import { useEffect, useMemo, useState } from "react";
import { getMiDepositoPropio, getMyDepositoStock, getMisVendedores, transferirStockManual, generarRemitoRealManual } from "../../services/comprobantes";
import { extraerModelo } from "../../utils/bikeName";

// Pantalla simple para mover stock — pensada para usarse sin ayuda, con
// pasos grandes y pocas decisiones por vez: primero elegís QUÉ hacer
// (recibir de Lavalle / mandarle a un cliente), después A QUIÉN (si
// corresponde), después QUÉ productos y cuántos (se pueden ir sumando
// varias bicis a la misma lista), y listo.
export default function TransferirStockPage() {
  const [modo, setModo] = useState(null); // "recibir" | "enviar"
  const [miDeposito, setMiDeposito] = useState(null); // { id, nombre }
  const [lavalle, setLavalle] = useState(null); // { id, nombre }
  const [clientes, setClientes] = useState([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [errorBase, setErrorBase] = useState("");

  useEffect(() => {
    setLoadingBase(true);
    setErrorBase("");
    // getMisVendedores() solo sirve (y solo funciona) para quien tiene
    // equipo propio a cargo — un distribuidor sin equipo (ej. Julián) no
    // tiene a quién "mandarle stock", pero igual puede "recibir de
    // Lavalle" — así que si falla, no tiramos abajo toda la pantalla, solo
    // dejamos la lista de clientes vacía (el modo "enviar" ya maneja ese
    // caso mostrando "no tenés clientes con depósito cargado").
    Promise.all([
      getMyDepositoStock(),
      getMiDepositoPropio(),
      getMisVendedores().catch(() => ({ vendedores: [] })),
    ])
      .then(([mio, lav, { vendedores }]) => {
        setMiDeposito({ id: mio.depositoId, nombre: mio.depositoNombre || "Mi depósito" });
        setLavalle({ id: lav.depositoId, nombre: lav.depositoNombre || "Lavalle" });
        setClientes(vendedores.filter((v) => v.depositoId));
      })
      .catch((e) => setErrorBase(e.message || "No se pudo cargar la información"))
      .finally(() => setLoadingBase(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">🔁 Mover stock</h1>
      <p className="mt-2 text-base text-slate-500 dark:text-neutral-400">
        Usá esta pantalla para recibir bicicletas de Lavalle o mandarle stock a uno de tus clientes.
      </p>

      {loadingBase && <p className="mt-8 text-center text-slate-400">Cargando…</p>}
      {errorBase && (
        <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {errorBase}
        </div>
      )}

      {!loadingBase && !errorBase && miDeposito && lavalle && (
        <>
          {!modo && (
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setModo("recibir")}
                className="rounded-3xl border-2 border-emerald-300 bg-emerald-50 p-8 text-left transition hover:-translate-y-1 hover:shadow-xl dark:border-emerald-800 dark:bg-emerald-950/20"
              >
                <span className="text-4xl">📥</span>
                <p className="mt-3 text-xl font-bold text-slate-900 dark:text-white">Recibir stock de Lavalle</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">Traé bicicletas del depósito de Samurai a tu propio stock.</p>
              </button>
              <button
                type="button"
                onClick={() => setModo("enviar")}
                className="rounded-3xl border-2 border-sky-300 bg-sky-50 p-8 text-left transition hover:-translate-y-1 hover:shadow-xl dark:border-sky-800 dark:bg-sky-950/20"
              >
                <span className="text-4xl">📤</span>
                <p className="mt-3 text-xl font-bold text-slate-900 dark:text-white">Mandarle a un cliente</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">Repartí bicicletas de tu stock a uno de tus clientes.</p>
              </button>
            </div>
          )}

          {modo === "recibir" && (
            <PasoTransferencia
              titulo={`📥 Recibiendo de ${lavalle.nombre}`}
              origenId={lavalle.id}
              origenNombre={lavalle.nombre}
              destinoId={miDeposito.id}
              destinoNombre={miDeposito.nombre}
              cargarStock={() => getMiDepositoPropio().then((r) => r.items)}
              onVolver={() => setModo(null)}
            />
          )}

          {modo === "enviar" && (
            <PasoElegirCliente
              clientes={clientes}
              miDeposito={miDeposito}
              onVolver={() => setModo(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function PasoElegirCliente({ clientes, miDeposito, onVolver }) {
  const [clienteElegido, setClienteElegido] = useState(null);

  if (clientes.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-slate-500 dark:text-neutral-400">No tenés clientes con depósito cargado todavía.</p>
        <BotonVolver onClick={onVolver} />
      </div>
    );
  }

  if (!clienteElegido) {
    return (
      <div className="mt-8">
        <p className="text-lg font-semibold text-slate-900 dark:text-white">¿A qué cliente le mandás stock?</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {clientes.map((c) => (
            <button
              key={c.uid}
              type="button"
              onClick={() => setClienteElegido(c)}
              className="rounded-2xl border border-sky-200 bg-white p-5 text-left text-lg font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-lg dark:border-sky-900/50 dark:bg-neutral-900 dark:text-white"
            >
              {c.name || c.depositoNombre}
            </button>
          ))}
        </div>
        <BotonVolver onClick={onVolver} />
      </div>
    );
  }

  return (
    <PasoTransferencia
      titulo={`📤 Enviando a ${clienteElegido.name || clienteElegido.depositoNombre}`}
      origenId={miDeposito.id}
      origenNombre={miDeposito.nombre}
      destinoId={clienteElegido.depositoId}
      destinoNombre={clienteElegido.depositoNombre || clienteElegido.name}
      cargarStock={() => getMyDepositoStock().then((r) => r.items)}
      onVolver={() => setClienteElegido(null)}
      clienteDestino={clienteElegido}
      clientesDisponibles={clientes}
    />
  );
}

export function BotonVolver({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="mt-6 text-base font-medium text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-white">
      ← Volver
    </button>
  );
}

// Último paso, compartido por los dos modos: ir agregando bicis a una lista
// (con el botón "+"), poner una observación, elegir con o sin remito y
// confirmar el movimiento. Recién DESPUÉS de que el movimiento ya se hizo
// (y ya generó su propio remito interno, a nombre de FEPA TOP) aparece la
// opción aparte "Hacer remito real", donde ahí sí se elige a nombre de qué
// cliente va y se puede tocar la observación — mismo patrón de dos pasos
// que usa el panel de admin.
export function PasoTransferencia({ titulo, origenId, origenNombre, destinoId, destinoNombre, cargarStock, onVolver, clienteDestino, clientesDisponibles }) {
  const [items, setItems] = useState(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [errorItems, setErrorItems] = useState("");
  const [query, setQuery] = useState("");
  const [modeloElegido, setModeloElegido] = useState(null);
  const [carrito, setCarrito] = useState([]); // [{sku, name, cantidad, stockActual}]
  const [nota, setNota] = useState("");
  const [conRemito, setConRemito] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [remitoArchivo, setRemitoArchivo] = useState(null);
  const [remitoPdfBase64, setRemitoPdfBase64] = useState(null);

  // Remito "real" — paso aparte, después de que el movimiento ya se hizo.
  const [remitoRealAbierto, setRemitoRealAbierto] = useState(false);
  const [proveedorId, setProveedorId] = useState(clienteDestino?.contabiliumId || null);
  const [notaRemitoReal, setNotaRemitoReal] = useState("");
  const [generandoRemitoReal, setGenerandoRemitoReal] = useState(false);
  const [remitoRealError, setRemitoRealError] = useState("");
  const [remitoRealNumero, setRemitoRealNumero] = useState(null);
  const [remitoRealArchivo, setRemitoRealArchivo] = useState(null);
  const [remitoRealPdfBase64, setRemitoRealPdfBase64] = useState(null);

  const puedeHacerRemitoReal = Array.isArray(clientesDisponibles) && clientesDisponibles.length > 0;

  useEffect(() => {
    setLoadingItems(true);
    cargarStock()
      .then(setItems)
      .catch((e) => setErrorItems(e.message || "No se pudo cargar el stock"))
      .finally(() => setLoadingItems(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sin buscador escrito se listan TODAS las bicis con stock — antes se
  // cortaba a las primeras 8 y, si tenías más de 8 modelos distintos, los de
  // más abajo quedaban invisibles a menos que supieras exactamente qué
  // escribir para encontrarlos (bug real: a Alfredo no le aparecía stock
  // que sí tenía cargado, sept 2026).
  const modelosDisponibles = useMemo(() => {
    const conStock = (items || []).filter((it) => Number(it.stockActual || 0) > 0);
    return [...new Set(conStock.map((it) => extraerModelo(it.name)).filter(Boolean))].sort();
  }, [items]);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    let conStock = (items || []).filter((it) => Number(it.stockActual || 0) > 0 && !carrito.some((c) => c.sku === it.sku));
    if (modeloElegido) conStock = conStock.filter((it) => extraerModelo(it.name) === modeloElegido);
    if (!q) return conStock;
    return conStock.filter(
      (it) => (it.name || "").toLowerCase().includes(q) || (it.sku || "").toLowerCase().includes(q)
    );
  }, [items, query, carrito, modeloElegido]);

  function agregarUnaUnidad(item) {
    setCarrito((prev) => {
      const existente = prev.find((c) => c.sku === item.sku);
      if (existente) {
        return prev.map((c) =>
          c.sku === item.sku ? { ...c, cantidad: Math.min(c.cantidad + 1, Number(item.stockActual || c.cantidad + 1)) } : c
        );
      }
      return [...prev, { sku: item.sku, name: item.name, cantidad: 1, stockActual: item.stockActual }];
    });
  }

  function cambiarCantidad(sku, delta) {
    setCarrito((prev) =>
      prev.map((c) => {
        if (c.sku !== sku) return c;
        const nueva = Math.max(1, Math.min(c.cantidad + delta, Number(c.stockActual || c.cantidad + delta)));
        return { ...c, cantidad: nueva };
      })
    );
  }

  function quitarDelCarrito(sku) {
    setCarrito((prev) => prev.filter((c) => c.sku !== sku));
  }

  async function confirmar() {
    if (carrito.length === 0) return;
    setEnviando(true);
    setError("");
    try {
      const itemsPayload = carrito.map((c) => ({ sku: c.sku, cantidad: c.cantidad, name: c.name }));
      const result = await transferirStockManual({
        depositoOrigenId: origenId,
        depositoDestinoId: destinoId,
        items: itemsPayload,
        observaciones: nota.trim() || undefined,
        depositoOrigenNombre: origenNombre,
        depositoDestinoNombre: destinoNombre,
        sinRemito: !conRemito,
      });
      setRemitoArchivo(result.remitoArchivo || null);
      setRemitoPdfBase64(result.remitoPdfBase64 || null);
      setNotaRemitoReal(nota);
      setOk(true);
    } catch (e) {
      setError(e.message || "No se pudo hacer la transferencia");
    } finally {
      setEnviando(false);
    }
  }

  // Paso aparte: toma el remito interno que ya generó el movimiento y le
  // reasigna el cliente + observación elegidos acá — no crea un comprobante
  // nuevo (eso quedaba sin numerar de verdad y no se podía descargar).
  async function generarRemitoReal() {
    if (!proveedorId) {
      setRemitoRealError("Elegí a nombre de quién va el remito.");
      return;
    }
    if (!remitoArchivo) {
      setRemitoRealError("Todavía no hay un remito interno generado para reasignar.");
      return;
    }
    setGenerandoRemitoReal(true);
    setRemitoRealError("");
    try {
      const remito = await generarRemitoRealManual({
        remitoArchivo,
        proveedorContabiliumId: proveedorId,
        observaciones: notaRemitoReal.trim() || undefined,
      });
      setRemitoRealNumero(remito.numero);
      setRemitoRealArchivo(remito.remitoArchivo);
      setRemitoRealPdfBase64(remito.remitoPdfBase64);
    } catch (e) {
      setRemitoRealError(e.message || "No se pudo generar el remito real");
    } finally {
      setGenerandoRemitoReal(false);
    }
  }

  function descargarPdf() {
    if (!remitoPdfBase64) return;
    const bytes = atob(remitoPdfBase64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = remitoArchivo || "remito.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  function descargarPdfReal() {
    if (!remitoRealPdfBase64) return;
    const bytes = atob(remitoRealPdfBase64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = remitoRealArchivo || "remito-real.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (ok) {
    return (
      <div className="mt-8 rounded-3xl border-2 border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950/20">
        <p className="text-5xl">✅</p>
        <p className="mt-3 text-xl font-bold text-slate-900 dark:text-white">¡Listo, se movió el stock!</p>
        <p className="mt-1 text-slate-600 dark:text-neutral-400">
          {carrito.reduce((acc, c) => acc + c.cantidad, 0)} bici(s) — {origenNombre} → {destinoNombre}
        </p>

        <ul className="mt-4 space-y-1.5 text-left">
          {carrito.map((c) => (
            <li key={c.sku} className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm dark:border-emerald-900/50 dark:bg-neutral-900">
              <span className="min-w-0 truncate font-medium text-slate-900 dark:text-white">{c.name}</span>
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                x{c.cantidad}
              </span>
            </li>
          ))}
        </ul>

        {nota.trim() && (
          <p className="mt-3 text-left text-sm text-slate-600 dark:text-neutral-400">
            <span className="font-semibold">Observación:</span> {nota.trim()}
          </p>
        )}
        <p className="mt-2 text-left text-xs text-slate-500 dark:text-neutral-400">{conRemito ? "📄 Con remito" : "🚫 Sin remito"}</p>

        {remitoArchivo && <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">📄 Remito interno: {remitoArchivo}</p>}
        {remitoPdfBase64 ? (
          <button
            type="button"
            onClick={descargarPdf}
            className="mt-4 rounded-2xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-700"
          >
            ⬇️ Descargar remito interno (PDF)
          </button>
        ) : conRemito && remitoArchivo ? (
          <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">
            (No se pudo traer el PDF automático — buscalo en Contabilium, en "Remitos y Cobranza")
          </p>
        ) : null}

        {puedeHacerRemitoReal && remitoArchivo && (
          <div className="mt-6 text-left">
            {remitoRealNumero ? (
              <div className="rounded-2xl border border-sky-300 bg-white p-4 dark:border-sky-800 dark:bg-neutral-900">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">📄 Remito real: {remitoRealNumero}</p>
                {remitoRealPdfBase64 ? (
                  <button
                    type="button"
                    onClick={descargarPdfReal}
                    className="mt-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                  >
                    ⬇️ Descargar remito real (PDF)
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                    (No se pudo traer el PDF automático — buscalo en Contabilium, en "Remitos y Cobranza")
                  </p>
                )}
              </div>
            ) : !remitoRealAbierto ? (
              <button
                type="button"
                onClick={() => setRemitoRealAbierto(true)}
                className="w-full rounded-2xl border-2 border-sky-300 bg-white px-4 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-400"
              >
                📄 Hacer remito real (para circular en la calle)
              </button>
            ) : (
              <div className="rounded-2xl border border-sky-200 bg-white p-4 dark:border-sky-900/50 dark:bg-neutral-900">
                <p className="text-sm font-medium text-slate-700 dark:text-neutral-300">¿A nombre de quién va el remito?</p>
                <select
                  value={proveedorId || ""}
                  onChange={(e) => setProveedorId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                >
                  <option value="">Elegí un cliente…</option>
                  {clientesDisponibles
                    .filter((c) => c.contabiliumId)
                    .map((c) => (
                      <option key={c.uid} value={c.contabiliumId}>
                        {c.name || c.depositoNombre}
                      </option>
                    ))}
                </select>

                <p className="mt-3 text-sm font-medium text-slate-700 dark:text-neutral-300">Observación</p>
                <input
                  type="text"
                  value={notaRemitoReal}
                  onChange={(e) => setNotaRemitoReal(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />

                <button
                  type="button"
                  disabled={generandoRemitoReal}
                  onClick={generarRemitoReal}
                  className="mt-3 w-full rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {generandoRemitoReal ? "Generando…" : "✓ Generar remito real"}
                </button>
                {remitoRealError && <p className="mt-2 text-sm text-rose-600">{remitoRealError}</p>}
              </div>
            )}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={onVolver}
            className="mt-6 rounded-2xl bg-emerald-600 px-6 py-3 text-lg font-semibold text-white hover:bg-emerald-700"
          >
            Hacer otra transferencia
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <p className="text-lg font-semibold text-slate-900 dark:text-white">{titulo}</p>

      {loadingItems && <p className="mt-4 text-slate-400">Buscando stock disponible…</p>}
      {errorItems && <p className="mt-4 text-rose-600">{errorItems}</p>}

      {carrito.length > 0 && (
        <ul className="mt-4 space-y-2">
          {carrito.map((c) => (
            <li key={c.sku} className="flex items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
              <span className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white">{c.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => cambiarCantidad(c.sku, -1)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-base font-bold text-slate-700 hover:bg-slate-200 dark:bg-neutral-800 dark:text-white"
                >
                  −
                </button>
                <span className="w-6 text-center font-bold text-slate-900 dark:text-white">{c.cantidad}</span>
                <button
                  type="button"
                  onClick={() => cambiarCantidad(c.sku, 1)}
                  disabled={c.cantidad >= Number(c.stockActual || 0)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-base font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:bg-neutral-800 dark:text-white"
                >
                  +
                </button>
                <button type="button" onClick={() => quitarDelCarrito(c.sku)} className="ml-1 text-xs text-slate-400 hover:text-rose-600 dark:text-neutral-500">
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loadingItems && !errorItems && (
        <div className="relative mt-4">
          <span className="pointer-events-none absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-sky-600 text-lg font-bold text-white">
            +
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={carrito.length > 0 ? "Agregar otra bici a la lista…" : "Buscar bicicleta por nombre o código…"}
            className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-14 pr-4 text-lg text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
          {modelosDisponibles.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {modelosDisponibles.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModeloElegido((prev) => (prev === m ? null : m))}
                  className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                    modeloElegido === m
                      ? "bg-slate-900 text-white dark:bg-neutral-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-2">
            {resultados.length === 0 && (
              <p className="text-slate-400">{carrito.length > 0 ? "No hay más unidades disponibles ahí." : "No hay unidades disponibles ahí."}</p>
            )}
            {resultados.map((it) => (
              <button
                key={it.id || it.sku}
                type="button"
                onClick={() => agregarUnaUnidad(it)}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-400 hover:shadow dark:border-neutral-700 dark:bg-neutral-900"
              >
                <span className="font-semibold text-slate-900 dark:text-white">{it.name}</span>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  {Number(it.stockActual || 0)} disponibles
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {carrito.length > 0 && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-base font-medium text-slate-700 dark:text-neutral-300">Observación (opcional)</p>
          <input
            type="text"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="ej: entrega en el local, cambio de talle, etc."
            className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />

          <p className="mt-5 text-base font-medium text-slate-700 dark:text-neutral-300">¿Con remito o sin remito?</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setConRemito(true)}
              className={`rounded-2xl border-2 p-3 text-left text-sm font-semibold transition ${
                conRemito
                  ? "border-sky-500 bg-sky-50 text-sky-900 dark:border-sky-500 dark:bg-sky-950/30 dark:text-sky-200"
                  : "border-slate-200 bg-white text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              📄 Con remito
              <span className="mt-0.5 block text-xs font-normal opacity-80">Para que la bici pueda circular en la calle</span>
            </button>
            <button
              type="button"
              onClick={() => setConRemito(false)}
              className={`rounded-2xl border-2 p-3 text-left text-sm font-semibold transition ${
                !conRemito
                  ? "border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-200"
                  : "border-slate-200 bg-white text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              🚫 Sin remito
              <span className="mt-0.5 block text-xs font-normal opacity-80">Solo movimiento de stock, sin papel de traslado</span>
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={enviando}
              onClick={confirmar}
              className="rounded-2xl bg-sky-600 px-6 py-3 text-lg font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sky-700 disabled:opacity-60"
            >
              {enviando
                ? "Moviendo stock…"
                : (() => {
                    const totalUnidades = carrito.reduce((acc, c) => acc + c.cantidad, 0);
                    return `✓ Confirmar (${totalUnidades} bici${totalUnidades === 1 ? "" : "s"})`;
                  })()}
            </button>
          </div>
          {error && <p className="mt-3 text-rose-600">{error}</p>}
        </div>
      )}

      <BotonVolver onClick={onVolver} />
    </div>
  );
}
