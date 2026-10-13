// src/components/admin/ResumenMensualPanel.jsx
// Resumen mes a mes (no día a día) — pensado para ver de un vistazo cuánto
// se facturó, cuánto se cobró, y con cuántas bicis consignadas arrancó cada
// mes, y poder abrir cualquier mes para ver qué cliente facturó/cobró qué.
import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeBusinessDashboardDetail, getDailyBikeStats } from "../../services/comprobantes";
import { subscribeCobranzas } from "../../services/cobranzas";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";

function normalizarNombre(s) {
  return (s || "").trim().toUpperCase();
}
function claveDeFactura(f) {
  return f.idCliente != null ? `id:${f.idCliente}` : `nombre:${normalizarNombre(f.cliente)}`;
}
function claveDeCobranza(c) {
  return c.idPersona != null ? `id:${c.idPersona}` : `nombre:${normalizarNombre(c.razonSocial)}`;
}
function money(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}
function nombreMes(ym) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

// Desde acá arranca la tabla — los meses anteriores se esconden (el
// contador diario de consignado recién arrancó el 1/10, así que no hay
// forma de mostrar meses mucho más viejos con un dato real confiable).
const MES_INICIO = "2026-09";

export default function ResumenMensualPanel() {
  const [businessDetail, setBusinessDetail] = useState(null);
  const [cobranzas, setCobranzas] = useState(null);
  const [dailyStats, setDailyStats] = useState(null);
  const [ventasReportadas, setVentasReportadas] = useState(null);
  const [error, setError] = useState("");
  const [mesAbierto, setMesAbierto] = useState(null);

  useEffect(() => {
    const u1 = subscribeBusinessDashboardDetail(setBusinessDetail);
    const u2 = subscribeCobranzas(setCobranzas, (e) => setError(e.message || "No se pudieron cargar las cobranzas"));
    // Rango grande (400 días ~ 13 meses) solo para poder sacar el stock
    // consignado con el que arrancó cada mes — no se muestra día por día acá.
    getDailyBikeStats(400)
      .then((r) => setDailyStats(r.items))
      .catch((e) => setError(e.message || "No se pudo cargar el histórico diario"));
    // "Vendidas" = lo que cada distribuidor avisó desde la app que vendió
    // (saleRequests), tenga o no factura real cargada todavía — mismo
    // criterio que usa "Reportadas" en la tabla día por día de más abajo.
    getDocs(collection(db, "saleRequests"))
      .then((snap) => setVentasReportadas(snap.docs.map((d) => d.data())))
      .catch((e) => setError(e.message || "No se pudieron cargar las ventas reportadas"));
    return () => {
      u1();
      u2();
    };
  }, []);

  const consignadoPorFecha = useMemo(() => {
    const map = new Map();
    for (const d of dailyStats || []) {
      if (d.consignadoBicis != null) map.set(d.fecha, d.consignadoBicis);
    }
    return map;
  }, [dailyStats]);


  // Para un mes "YYYY-MM", el stock consignado "con el que arrancó" es el
  // snapshot del día 1 si existe; si no (ej. el contador se activó a mitad
  // de mes), el snapshot más viejo disponible DENTRO de ese mes.
  const consignadoAlInicioDeMes = useCallback(
    (ym) => {
      const fechaUno = `${ym}-01`;
      if (consignadoPorFecha.has(fechaUno)) return { valor: consignadoPorFecha.get(fechaUno), exacto: true };
      const fechasDelMes = [...consignadoPorFecha.keys()].filter((f) => f.startsWith(ym)).sort();
      if (fechasDelMes.length > 0) return { valor: consignadoPorFecha.get(fechasDelMes[0]), exacto: false, fecha: fechasDelMes[0] };
      return { valor: null, exacto: false };
    },
    [consignadoPorFecha]
  );

  // Cuánto de cada factura ya se cobró de verdad (cruzado contra los
  // recibos/cobranzas reales de Contabilium, no contra lo que dice la
  // factura sola) — mismo criterio que ya usa el reporte de Remitos y
  // Cobranza para "impaga"/"sin recibo".
  const pagosPorFacturaId = useMemo(() => {
    const map = new Map();
    (cobranzas || []).forEach((c) => {
      (c.detalle || []).forEach((d) => {
        const idComp = String(d.IDComprobante);
        if (!idComp || idComp === "0") return;
        map.set(idComp, (map.get(idComp) || 0) + Number(d.Importe || 0));
      });
    });
    return map;
  }, [cobranzas]);

  const resumenPorMes = useMemo(() => {
    const porFactura = businessDetail?.porFactura || [];
    // "YYYY-MM" -> { facturadoTotal, bicisFacturadas, bicisSinRecibo, cobradoTotal, bicisVendidas, clientes: Map }
    const mapa = new Map();

    function getMes(ym) {
      if (!mapa.has(ym))
        mapa.set(ym, { facturadoTotal: 0, bicisFacturadas: 0, bicisSinRecibo: 0, cobradoTotal: 0, bicisVendidas: 0, clientes: new Map() });
      return mapa.get(ym);
    }
    function getCliente(mesObj, clave, nombreFallback) {
      if (!mesObj.clientes.has(clave))
        mesObj.clientes.set(clave, { nombre: nombreFallback, facturado: 0, bicis: 0, bicisSinRecibo: 0, cobrado: 0, vendidas: 0 });
      return mesObj.clientes.get(clave);
    }

    for (const f of porFactura) {
      if (!f.fecha) continue;
      const ym = f.fecha.slice(0, 7);
      const mesObj = getMes(ym);

      // Una COT (cotización) no es factura real — no tiene CAE, es una
      // venta documentada así (ej. venta en B) en vez de con factura. Esas
      // bicis cuentan como "Vendidas" más abajo, no acá en "Facturadas".
      if (f.tipoFc === "COT") {
        const cliCot = getCliente(mesObj, claveDeFactura(f), f.cliente);
        mesObj.bicisVendidas += f.bicis || 0;
        cliCot.vendidas += f.bicis || 0;
        if (f.cliente) cliCot.nombre = f.cliente;
        continue;
      }

      mesObj.facturadoTotal += f.facturado || 0;
      mesObj.bicisFacturadas += f.bicis || 0;
      const cli = getCliente(mesObj, claveDeFactura(f), f.cliente);
      cli.facturado += f.facturado || 0;
      cli.bicis += f.bicis || 0;
      if (f.cliente) cli.nombre = f.cliente;

      // Sin recibo: lo que esa factura debería tener cobrado contra lo que
      // de verdad tiene cobrado (cruzado con cobranzas reales) — si no
      // llegó al total, toda la factura cuenta como "sin recibo" todavía.
      const pagado = pagosPorFacturaId.get(String(f.id)) || 0;
      if (f.facturado > 0 && pagado < f.facturado - 1) {
        mesObj.bicisSinRecibo += f.bicis || 0;
        cli.bicisSinRecibo += f.bicis || 0;
      }
    }

    for (const c of cobranzas || []) {
      const fecha = (c.fecha || "").slice(0, 10);
      if (!fecha) continue;
      const ym = fecha.slice(0, 7);
      const mesObj = getMes(ym);
      const importe = Number(c.importeReal ?? c.importeTotal ?? 0);
      mesObj.cobradoTotal += importe;
      const cli = getCliente(mesObj, claveDeCobranza(c), c.razonSocial);
      cli.cobrado += importe;
      if (c.razonSocial) cli.nombre = c.razonSocial;
    }

    // Vendidas: lo que cada distribuidor reportó desde la app (saleRequests),
    // tenga o no factura real cargada todavía — por eso puede no coincidir
    // con "Facturadas" del mismo mes.
    for (const sr of ventasReportadas || []) {
      if ((sr.category || "").toUpperCase() !== "BICICLETAS") continue;
      const fecha = sr.createdAt?.toDate ? sr.createdAt.toDate().toISOString().slice(0, 10) : null;
      if (!fecha) continue;
      const ym = fecha.slice(0, 7);
      const mesObj = getMes(ym);
      const cantidad = Number(sr.quantity || 0);
      mesObj.bicisVendidas += cantidad;
      const cli = getCliente(mesObj, sr.distributorUid ? `uid:${sr.distributorUid}` : `nombre:${normalizarNombre(sr.distributorName)}`, sr.distributorName);
      cli.vendidas += cantidad;
      if (sr.distributorName) cli.nombre = sr.distributorName;
    }

    const mesesAsc = [...mapa.entries()]
      .map(([ym, datos]) => {
        const consignado = consignadoAlInicioDeMes(ym);
        const clientesArr = [...datos.clientes.values()].sort(
          (a, b) => b.facturado + b.cobrado + b.vendidas - (a.facturado + a.cobrado + a.vendidas)
        );
        return { ym, ...datos, clientes: clientesArr, consignadoInicio: consignado };
      })
      .sort((a, b) => a.ym.localeCompare(b.ym));

    // Encadenado hacia atrás: el único dato real que tenemos es el del
    // 1/10/2026 (3142) — para los meses sin snapshot propio (ej.
    // septiembre), se calcula a partir del mes siguiente YA resuelto.
    // Importante: NO se resta "entregado" acá — los 3 depósitos propios
    // (Lavalle/Cañuelas/Credifin) ya están adentro del total consignado
    // (el rollup suma los 84 depósitos sin filtrar), así que mandarle stock
    // a un cliente es un movimiento interno que no cambia el total general.
    // Lo único que de verdad saca una bici del total es facturarla (ahí sí
    // se descuenta stock real del depósito del cliente) — por eso yendo
    // hacia atrás en el tiempo, el mes anterior tenía el total del mes
    // siguiente MÁS lo que se facturó en el medio.
    let anchorInicioMesSiguiente = null;
    for (let i = mesesAsc.length - 1; i >= 0; i--) {
      const m = mesesAsc[i];
      if (m.consignadoInicio.valor != null && m.consignadoInicio.exacto) {
        anchorInicioMesSiguiente = m.consignadoInicio.valor;
      } else if (anchorInicioMesSiguiente != null) {
        const estimado = Math.max(0, Math.round(anchorInicioMesSiguiente + m.bicisFacturadas));
        m.consignadoInicio = { valor: estimado, exacto: false, estimado: true };
        anchorInicioMesSiguiente = estimado;
      } else {
        anchorInicioMesSiguiente = null;
      }
    }

    return mesesAsc.filter((m) => m.ym >= MES_INICIO).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [businessDetail, cobranzas, ventasReportadas, pagosPorFacturaId, consignadoAlInicioDeMes]);

  const cargando = businessDetail === null || cobranzas === null || dailyStats === null || ventasReportadas === null;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-base font-bold text-slate-900 dark:text-white">📅 Resumen por mes</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
        Vendidas, facturadas, sin recibo, cobrado y con cuántas bicis consignadas arrancó cada mes. Tocá un mes para ver qué cliente
        vendió/facturó/cobró qué.
      </p>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {cargando && <p className="mt-4 text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}

      {!cargando && resumenPorMes.length === 0 && (
        <p className="mt-4 text-sm text-slate-400 dark:text-neutral-500">Todavía no hay datos.</p>
      )}

      {!cargando && resumenPorMes.length > 0 && (
        <div className="mt-4 space-y-2">
          {resumenPorMes.map((mes) => {
            const abierto = mesAbierto === mes.ym;
            return (
              <div key={mes.ym} className="rounded-2xl border border-slate-200 dark:border-neutral-800">
                <button
                  onClick={() => setMesAbierto(abierto ? null : mes.ym)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="text-sm font-bold capitalize text-slate-900 dark:text-white">
                    {nombreMes(mes.ym)} <span className="text-slate-400">{abierto ? "▲" : "▼"}</span>
                  </span>
                  <span className="flex flex-wrap gap-4 text-xs">
                    <span className="text-slate-500 dark:text-neutral-400">
                      Consignado al inicio:{" "}
                      <strong className="text-slate-800 dark:text-white">
                        {mes.consignadoInicio.valor != null ? `${mes.consignadoInicio.valor} bicis` : "sin dato"}
                      </strong>
                      {mes.consignadoInicio.valor != null && mes.consignadoInicio.estimado && (
                        <span className="text-amber-600 dark:text-amber-400"> (calculado, no es snapshot real)</span>
                      )}
                      {mes.consignadoInicio.valor != null && !mes.consignadoInicio.exacto && !mes.consignadoInicio.estimado && (
                        <span className="text-amber-600 dark:text-amber-400"> (dato del {mes.consignadoInicio.fecha})</span>
                      )}
                    </span>
                    <span className="text-slate-500 dark:text-neutral-400">
                      Vendidas: <strong className="text-sky-600 dark:text-sky-400">{mes.bicisVendidas} bicis</strong>
                    </span>
                    <span className="text-slate-500 dark:text-neutral-400">
                      Facturadas: <strong className="text-indigo-600 dark:text-indigo-400">{mes.bicisFacturadas} bicis</strong> (
                      {money(mes.facturadoTotal)})
                    </span>
                    <span className="text-slate-500 dark:text-neutral-400">
                      Sin recibo:{" "}
                      <strong className={mes.bicisSinRecibo > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-white"}>
                        {mes.bicisSinRecibo} bicis
                      </strong>
                    </span>
                    <span className="text-slate-500 dark:text-neutral-400">
                      Cobrado: <strong className="text-emerald-600 dark:text-emerald-400">{money(mes.cobradoTotal)}</strong>
                    </span>
                  </span>
                </button>
                {abierto && (
                  <div className="border-t border-slate-100 px-4 py-3 dark:border-neutral-800">
                    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <div className="rounded-xl border border-slate-200 p-2.5 text-center dark:border-neutral-800">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                          Consignado al inicio
                        </p>
                        <p className="mt-0.5 text-lg font-bold text-slate-800 dark:text-white">
                          {mes.consignadoInicio.valor != null ? mes.consignadoInicio.valor : "—"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-sky-50 p-2.5 text-center dark:border-sky-900 dark:bg-sky-950/20">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">Vendidas</p>
                        <p className="mt-0.5 text-lg font-bold text-sky-700 dark:text-sky-300">{mes.bicisVendidas}</p>
                      </div>
                      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-2.5 text-center dark:border-indigo-900 dark:bg-indigo-950/20">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Facturadas</p>
                        <p className="mt-0.5 text-lg font-bold text-indigo-700 dark:text-indigo-300">{mes.bicisFacturadas}</p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-center dark:border-emerald-900 dark:bg-emerald-950/20">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Con recibo</p>
                        <p className="mt-0.5 text-lg font-bold text-emerald-700 dark:text-emerald-300">
                          {mes.bicisFacturadas - mes.bicisSinRecibo}
                        </p>
                      </div>
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-center dark:border-rose-900 dark:bg-rose-950/20">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">Sin recibo</p>
                        <p className="mt-0.5 text-lg font-bold text-rose-700 dark:text-rose-300">{mes.bicisSinRecibo}</p>
                      </div>
                    </div>
                    <p className="mb-3 text-[11px] text-slate-400 dark:text-neutral-500">
                      "Con recibo" es Facturadas menos Sin recibo (facturas ya cobradas del todo, cruzado contra los recibos reales).
                      "Vendidas" y "Facturadas" no tienen por qué coincidir en el mismo mes — una venta reportada puede facturarse recién
                      el mes que viene.
                    </p>
                    {mes.clientes.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-neutral-500">Sin movimientos de clientes este mes.</p>
                    ) : (
                      <div className="max-h-80 overflow-auto rounded-xl border border-slate-100 dark:border-neutral-800">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                            <tr>
                              <th className="px-3 py-2">Cliente</th>
                              <th className="px-3 py-2 text-right">Vendidas</th>
                              <th className="px-3 py-2 text-right">Facturado</th>
                              <th className="px-3 py-2 text-right">Bicis fact.</th>
                              <th className="px-3 py-2 text-right">Con recibo</th>
                              <th className="px-3 py-2 text-right">Sin recibo</th>
                              <th className="px-3 py-2 text-right">Cobrado</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                            {mes.clientes.map((c, i) => (
                              <tr key={i}>
                                <td className="px-3 py-1.5 text-slate-800 dark:text-white">{c.nombre || "(sin nombre)"}</td>
                                <td className="px-3 py-1.5 text-right text-sky-600 dark:text-sky-400">{c.vendidas || "—"}</td>
                                <td className="px-3 py-1.5 text-right text-indigo-600 dark:text-indigo-400">
                                  {c.facturado > 0 ? money(c.facturado) : "—"}
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-600 dark:text-neutral-300">{c.bicis || "—"}</td>
                                <td className="px-3 py-1.5 text-right text-emerald-600 dark:text-emerald-400">
                                  {c.bicis - c.bicisSinRecibo || "—"}
                                </td>
                                <td className="px-3 py-1.5 text-right text-rose-600 dark:text-rose-400">{c.bicisSinRecibo || "—"}</td>
                                <td className="px-3 py-1.5 text-right text-emerald-600 dark:text-emerald-400">
                                  {c.cobrado > 0 ? money(c.cobrado) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
