// src/components/remitos/SectorRemitosPersonalizados.jsx
// SECTOR 2 de "Remitos y Cobranza": a diferencia del Sector 1 (API de
// movimientos en vivo), esto lee los remitos REALES de Contabilium, con un
// cuidado clave — muchos envíos quedan documentados en DOS remitos (el
// interno "movimiento de depósito" FEPA→FEPA + el remito real a nombre del
// cliente, mismo cliente/fecha/cantidad de bicis) y hay que fusionarlos en
// UNA sola entrega para no contar la misma bici dos veces. También hay
// remitos FEPA→FEPA que en realidad eran para un cliente — se detectan
// leyendo el texto de la observación.
import { useEffect, useMemo, useState } from "react";
import {
  subscribeRemitosDespachosDetail,
  subscribeBusinessDashboardDetail,
  adminObtenerRemitoDetalle,
} from "../../services/comprobantes";
import { subscribeCobranzas } from "../../services/cobranzas";
import { detectarChoferesEnTexto } from "../../utils/movimientosChofer";

function normalizarNombre(s) {
  return (s || "").trim().toUpperCase();
}

// Mismo patrón que usa RemitosReporte.jsx para "adivinar" a qué cliente
// corresponde un remito interno FEPA→FEPA a partir del texto libre de la
// observación.
const DEPOSITO_O_LUGAR_AMBIGUO = /^(lavalle|fepa\s*top|ca[ñn]uelas|dep[oó]sito|temperley|credifin)\b/i;
function extraerClienteDeObservacion(obs) {
  if (!obs) return null;
  const texto = obs.trim();
  let m = /transferencia\s*:\s*.+?[→?>]\s*(.+)/i.exec(texto);
  if (!m) m = /\b(?:de|desde)\s+lavalle\s+a\s+(.+)/i.exec(texto);
  if (!m) m = /\bal\s+(?:dep[oó]sito\s+del\s+)?cliente\s+(.+)/i.exec(texto);
  if (!m) m = /\bpedido\s+de\s+(?:cliente\s+)?(.+)/i.exec(texto);
  if (!m) return null;
  const destino = m[1].split(",")[0].replace(/\s+con\s+remito\b.*$/i, "").trim().replace(/\.+$/, "");
  if (!destino) return null;
  if (DEPOSITO_O_LUGAR_AMBIGUO.test(destino)) return null;
  return destino;
}
const SECTORES_DEPOSITO = [
  { id: "lavalle", nombre: "Lavalle", regex: /lavalle|temperley/i },
  { id: "canuelas", nombre: "Cañuelas", regex: /ca[ñn]uelas/i },
  { id: "credifin", nombre: "Credifin", regex: /credifin/i },
];
function detectarDepositoOrigen(texto) {
  const t = String(texto || "");
  let mejor = null;
  for (const s of SECTORES_DEPOSITO) {
    const m = s.regex.exec(t);
    if (m && (mejor === null || m.index < mejor.index)) mejor = s.nombre;
  }
  return mejor;
}
function nombreMes(ym) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

const MES_INICIO = "2026-09";

export default function SectorRemitosPersonalizados() {
  const [remitosDetail, setRemitosDetail] = useState(null);
  const [businessDetail, setBusinessDetail] = useState(null);
  const [cobranzas, setCobranzas] = useState(null);
  const [mesAbierto, setMesAbierto] = useState(null);
  const [clienteAbierto, setClienteAbierto] = useState(null); // clave del cliente abierto

  useEffect(() => {
    const u1 = subscribeRemitosDespachosDetail(setRemitosDetail);
    const u2 = subscribeBusinessDashboardDetail(setBusinessDetail);
    const u3 = subscribeCobranzas(setCobranzas, () => {});
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const nombresConocidos = useMemo(() => {
    const set = new Set();
    (businessDetail?.porFactura || []).forEach((f) => f.cliente && set.add(f.cliente));
    (cobranzas || []).forEach((c) => c.razonSocial && set.add(c.razonSocial));
    return [...set];
  }, [businessDetail, cobranzas]);

  const idPorNombreConocido = useMemo(() => {
    const map = new Map();
    (businessDetail?.porFactura || []).forEach((f) => {
      if (f.cliente && f.idCliente != null) map.set(normalizarNombre(f.cliente), f.idCliente);
    });
    (cobranzas || []).forEach((c) => {
      if (c.razonSocial && c.idPersona != null && !map.has(normalizarNombre(c.razonSocial))) {
        map.set(normalizarNombre(c.razonSocial), c.idPersona);
      }
    });
    return map;
  }, [businessDetail, cobranzas]);

  function matchNombreConocido(nombreDetectado) {
    const key = normalizarNombre(nombreDetectado);
    const exacto = nombresConocidos.find((n) => normalizarNombre(n) === key);
    if (exacto) return { nombre: exacto, confianza: "exacta" };
    const palabras = key.split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) {
      const multi = nombresConocidos.find((n) => {
        const palabrasN = normalizarNombre(n).split(/\s+/).filter(Boolean);
        return palabras.every((p) => palabrasN.includes(p));
      });
      if (multi) return { nombre: multi, confianza: "alta" };
    } else if (palabras.length === 1) {
      const single = nombresConocidos.find((n) => normalizarNombre(n).split(/\s+/)[0] === palabras[0]);
      if (single) return { nombre: single, confianza: "media" };
    }
    const palabraFuerte = palabras.find((p) => p.length >= 5);
    if (palabraFuerte) {
      const porPalabra = nombresConocidos.find((n) => normalizarNombre(n).split(/\s+/).includes(palabraFuerte));
      if (porPalabra) return { nombre: porPalabra, confianza: "dudosa" };
    }
    return null;
  }

  // El corazón de todo: arma la lista de ENTREGAS ÚNICAS, fusionando el
  // caso típico (interno FEPA→FEPA + remito real, mismo cliente/fecha/
  // bicis = un solo envío documentado dos veces).
  const { entregas, totalesPorMes } = useMemo(() => {
    const todos = (remitosDetail?.porRemito || []).filter((r) => r.fecha && r.fecha.slice(0, 7) >= MES_INICIO);
    const directos = todos.filter((r) => !r.esInterno);
    const internos = todos.filter((r) => r.esInterno);
    const directosUsados = new Set();

    const lista = [];
    for (const i of internos) {
      const detectado = extraerClienteDeObservacion(i.observaciones);
      const match = detectado ? matchNombreConocido(detectado) : null;
      if (!match || match.confianza === "dudosa") continue; // puro movimiento interno, no es entrega
      const idx = directos.findIndex(
        (d, k) =>
          !directosUsados.has(k) &&
          normalizarNombre(d.cliente) === normalizarNombre(match.nombre) &&
          d.fecha === i.fecha &&
          d.bicis === i.bicis
      );
      const depositoOrigen = detectarDepositoOrigen(i.observaciones);
      if (idx >= 0) {
        directosUsados.add(idx);
        const real = directos[idx];
        lista.push({
          id: real.id,
          idInterno: i.id,
          fecha: real.fecha,
          numero: real.numero,
          numeroInterno: i.numero,
          cliente: real.cliente,
          idPersona: real.idPersona,
          bicis: real.bicis,
          depositoOrigen,
          julian: detectarChoferesEnTexto(i.observaciones).includes("julian") || detectarChoferesEnTexto(real.observaciones).includes("julian"),
          fusionado: true,
          confianza: match.confianza,
        });
      } else {
        // Interno atribuido por observación, SIN remito real separado — el
        // movimiento interno ES la única constancia de esta entrega.
        lista.push({
          id: i.id,
          idInterno: i.id,
          fecha: i.fecha,
          numero: i.numero,
          numeroInterno: i.numero,
          cliente: match.nombre,
          idPersona: idPorNombreConocido.get(normalizarNombre(match.nombre)) ?? null,
          bicis: i.bicis,
          depositoOrigen,
          julian: detectarChoferesEnTexto(i.observaciones).includes("julian"),
          fusionado: false,
          confianza: match.confianza,
        });
      }
    }
    directos.forEach((d, k) => {
      if (directosUsados.has(k)) return;
      const depositoOrigen = detectarDepositoOrigen(d.observaciones);
      lista.push({
        id: d.id,
        idInterno: null,
        fecha: d.fecha,
        numero: d.numero,
        numeroInterno: null,
        cliente: d.cliente,
        idPersona: d.idPersona,
        bicis: d.bicis,
        depositoOrigen,
        julian: detectarChoferesEnTexto(d.observaciones).includes("julian"),
        fusionado: false,
        confianza: "directo",
      });
    });

    lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    const porMes = new Map();
    for (const e of lista) {
      const ym = e.fecha.slice(0, 7);
      if (!porMes.has(ym)) porMes.set(ym, { entregadoTotal: 0, depositoPropio: 0, julian: 0 });
      const m = porMes.get(ym);
      m.entregadoTotal += e.bicis;
      if (e.depositoOrigen) m.depositoPropio += e.bicis;
      if (e.julian) m.julian += e.bicis;
    }

    return { entregas: lista, totalesPorMes: porMes };
  }, [remitosDetail, nombresConocidos, idPorNombreConocido]);

  // Agrupa las entregas de un mes por cliente.
  function clientesDelMes(ym) {
    const map = new Map();
    for (const e of entregas) {
      if (e.fecha.slice(0, 7) !== ym) continue;
      const clave = e.idPersona != null ? `id:${e.idPersona}` : `nombre:${normalizarNombre(e.cliente)}`;
      if (!map.has(clave)) map.set(clave, { cliente: e.cliente, bicis: 0, entregas: [] });
      const c = map.get(clave);
      c.bicis += e.bicis;
      c.entregas.push(e);
      c.clave = clave;
    }
    return [...map.values()].sort((a, b) => b.bicis - a.bicis);
  }

  const meses = [...totalesPorMes.keys()].sort((a, b) => b.localeCompare(a));
  const cargando = remitosDetail === null || businessDetail === null || cobranzas === null;

  return (
    <div>
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">📋 Remitos personalizados (de verdad, de Contabilium)</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
        Desde {nombreMes(MES_INICIO)}. Cada envío cuenta <strong>una sola vez</strong> aunque esté documentado en dos remitos (el interno
        FEPA→FEPA de movimiento de depósito + el remito real a nombre del cliente) — se fusionan automáticamente cuando coincide
        cliente, fecha y cantidad de bicis.
      </p>

      {cargando && <p className="mt-4 text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}

      {!cargando && (
        <div className="mt-4 space-y-3">
          {meses.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-neutral-500">Sin entregas detectadas desde {nombreMes(MES_INICIO)}.</p>
          )}
          {meses.map((ym) => {
            const t = totalesPorMes.get(ym);
            const abierto = mesAbierto === ym;
            const clientes = abierto ? clientesDelMes(ym) : [];
            return (
              <div key={ym} className="overflow-hidden rounded-2xl border border-sky-200 dark:border-sky-900">
                <button
                  onClick={() => {
                    setMesAbierto(abierto ? null : ym);
                    setClienteAbierto(null);
                  }}
                  className="flex w-full flex-wrap items-center justify-between gap-3 bg-sky-50 px-4 py-3 text-left dark:bg-sky-950/20"
                >
                  <span className="text-sm font-bold capitalize text-slate-900 dark:text-white">
                    {nombreMes(ym)} <span className="text-slate-400">{abierto ? "▲" : "▼"}</span>
                  </span>
                  <span className="flex flex-wrap gap-4 text-xs">
                    <span className="text-slate-500 dark:text-neutral-400">
                      Entregado a clientes: <strong className="text-sky-700 dark:text-sky-300">{t.entregadoTotal} bicis</strong>
                    </span>
                    <span className="text-slate-500 dark:text-neutral-400">
                      Salió de depósito propio → cliente: <strong className="text-indigo-600 dark:text-indigo-400">{t.depositoPropio} bicis</strong>
                    </span>
                    <span className="text-slate-500 dark:text-neutral-400">
                      Entregó Julián: <strong className="text-amber-600 dark:text-amber-400">{t.julian} bicis</strong>
                    </span>
                  </span>
                </button>
                {abierto && (
                  <div className="divide-y divide-slate-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
                    {clientes.map((c) => (
                      <ClienteFila
                        key={c.clave}
                        cliente={c}
                        abierto={clienteAbierto === c.clave}
                        onToggle={() => setClienteAbierto(clienteAbierto === c.clave ? null : c.clave)}
                      />
                    ))}
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

function ClienteFila({ cliente, abierto, onToggle }) {
  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-neutral-800/60">
        <span className="text-sm font-semibold text-slate-800 dark:text-white">
          {cliente.cliente || "(sin nombre)"} <span className="text-slate-400">{abierto ? "▲" : "▼"}</span>
        </span>
        <span className="text-sm font-bold text-sky-700 dark:text-sky-400">{cliente.bicis} bicis</span>
      </button>
      {abierto && (
        <div className="space-y-2 bg-slate-50 px-4 py-3 dark:bg-neutral-800/40">
          {cliente.entregas.map((e, i) => (
            <EntregaDetalle key={i} entrega={e} />
          ))}
        </div>
      )}
    </div>
  );
}

// Detalle de UNA entrega — qué bici es cada una, traído en vivo recién al
// abrirla (el total de bicis ya lo sabemos del remito cacheado, pero el
// desglose por modelo/SKU no se guarda cacheado, hay que pedírselo a
// Contabilium puntual).
function EntregaDetalle({ entrega }) {
  const [detalle, setDetalle] = useState(null); // null=no pedido, "cargando", items[] o "error"

  function cargar() {
    if (detalle) return;
    setDetalle("cargando");
    adminObtenerRemitoDetalle(entrega.id)
      .then((d) => setDetalle(d.items || []))
      .catch(() => setDetalle("error"));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono text-sky-700 dark:text-sky-400">{entrega.numero}</span>{" "}
          <span className="text-slate-500 dark:text-neutral-400">{entrega.fecha}</span>{" "}
          {entrega.fusionado && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              fusionado con interno #{entrega.numeroInterno}
            </span>
          )}
          {entrega.depositoOrigen && (
            <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
              desde {entrega.depositoOrigen}
            </span>
          )}
          {entrega.julian && (
            <span className="ml-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
              llevó Julián
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-700 dark:text-neutral-200">{entrega.bicis} bici(s)</span>
          {!detalle && (
            <button onClick={cargar} className="rounded-lg border border-sky-300 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-400">
              Ver bicis
            </button>
          )}
        </div>
      </div>
      {detalle === "cargando" && <p className="mt-2 text-slate-400">Consultando Contabilium…</p>}
      {detalle === "error" && <p className="mt-2 text-rose-600 dark:text-rose-400">No se pudo traer el detalle de este remito.</p>}
      {Array.isArray(detalle) && (
        <ul className="mt-2 space-y-0.5">
          {detalle.map((it, i) => (
            <li key={i} className="flex items-center justify-between text-slate-600 dark:text-neutral-300">
              <span>
                {it.nombre || it.descripcion || it.codigoConcepto} <span className="text-slate-400">({it.codigoConcepto})</span>
              </span>
              <span className="font-semibold text-slate-800 dark:text-white">x{it.cantidad}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
