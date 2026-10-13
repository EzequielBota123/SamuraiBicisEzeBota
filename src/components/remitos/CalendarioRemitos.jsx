import { useMemo, useState } from "react";
import { adminGetComprobanteDetail, adminDescargarPdfComprobante, adminObtenerRemitoDetalle } from "../../services/comprobantes";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

function money(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

function descargarBase64Pdf(base64, nombre) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

// Calendario año → mes → día para auditar movimientos puntuales: parado en
// un día concreto, qué facturas y qué remitos hubo, con descarga de PDF
// real. Reutiliza los datos que ya trae esta pantalla (porFactura/
// porRemito, cargados una sola vez por los subscribe de arriba) para no
// pegarle de nuevo a Contabilium solo por armar el calendario — el detalle
// puntual de cada factura/remito (número real, PDF) se trae recién al
// abrir un día concreto, que es poca data por vez.
export default function CalendarioRemitos({ facturas, remitos }) {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [mesAbierto, setMesAbierto] = useState(null); // 0-11 o null
  const [diaAbierto, setDiaAbierto] = useState(null); // "YYYY-MM-DD" o null

  // Un solo índice fecha -> { facturas: [...], remitos: [...] } para todo
  // lo cargado (no solo el rango del filtro de arriba) — el calendario
  // necesita ver cualquier año/mes, no solo el rango elegido ahí.
  const porFecha = useMemo(() => {
    const map = new Map();
    const get = (f) => {
      if (!map.has(f)) map.set(f, { facturas: [], remitos: [] });
      return map.get(f);
    };
    for (const f of facturas || []) {
      if (!f.fecha) continue;
      get(f.fecha).facturas.push(f);
    }
    for (const r of remitos || []) {
      if (!r.fecha) continue;
      get(r.fecha).remitos.push(r);
    }
    return map;
  }, [facturas, remitos]);

  const aniosDisponibles = useMemo(() => {
    const set = new Set([anioActual]);
    for (const fecha of porFecha.keys()) {
      const y = Number(fecha.slice(0, 4));
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [porFecha, anioActual]);

  function datosDelMes(mes) {
    let facturasN = 0;
    let remitosN = 0;
    let bicis = 0;
    for (const [fecha, d] of porFecha) {
      if (!fecha.startsWith(`${anio}-${String(mes + 1).padStart(2, "0")}`)) continue;
      facturasN += d.facturas.length;
      remitosN += d.remitos.length;
      bicis += d.facturas.reduce((acc, f) => acc + Number(f.bicis || 0), 0) + d.remitos.reduce((acc, r) => acc + Number(r.bicis || 0), 0);
    }
    return { facturasN, remitosN, bicis };
  }

  if (mesAbierto == null) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
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
            const { facturasN, remitosN, bicis } = datosDelMes(i);
            const sinDatos = facturasN === 0 && remitosN === 0;
            return (
              <button
                key={nombre}
                onClick={() => setMesAbierto(i)}
                disabled={sinDatos}
                className={`rounded-xl border p-3 text-left transition ${
                  sinDatos
                    ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-700"
                    : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow dark:border-neutral-700 dark:bg-neutral-900"
                }`}
              >
                <p className={`text-sm font-bold ${sinDatos ? "" : "text-slate-900 dark:text-white"}`}>{nombre}</p>
                {!sinDatos && (
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">
                    {facturasN} fact · {remitosN} rem · {bicis} bici{bicis === 1 ? "" : "s"}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <VistaMes
      anio={anio}
      mes={mesAbierto}
      porFecha={porFecha}
      onVolverAnio={() => setMesAbierto(null)}
      diaAbierto={diaAbierto}
      onAbrirDia={setDiaAbierto}
    />
  );
}

function VistaMes({ anio, mes, porFecha, onVolverAnio, diaAbierto, onAbrirDia }) {
  const primerDiaSemana = useMemo(() => {
    const d = new Date(anio, mes, 1).getDay(); // 0=domingo
    return d === 0 ? 6 : d - 1; // llevar a lunes=0
  }, [anio, mes]);
  const diasEnMes = new Date(anio, mes + 1, 0).getDate();
  const celdas = [...Array(primerDiaSemana).fill(null), ...Array.from({ length: diasEnMes }, (_, i) => i + 1)];

  function fechaISO(dia) {
    return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <button onClick={onVolverAnio} className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-white">
          ← {anio}
        </button>
        <p className="text-sm font-bold text-slate-900 dark:text-white">
          {MESES[mes]} {anio}
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
          const d = porFecha.get(fecha);
          const n = (d?.facturas.length || 0) + (d?.remitos.length || 0);
          return (
            <button
              key={fecha}
              onClick={() => n > 0 && onAbrirDia(fecha)}
              disabled={n === 0}
              className={`aspect-square rounded-lg border p-1 text-xs transition ${
                n === 0
                  ? "cursor-default border-slate-100 text-slate-300 dark:border-neutral-800 dark:text-neutral-700"
                  : "border-indigo-200 bg-indigo-50 font-semibold text-indigo-700 hover:border-indigo-400 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-400"
              }`}
            >
              {dia}
              {n > 0 && <span className="mt-0.5 block text-[9px] font-bold">{n}</span>}
            </button>
          );
        })}
      </div>

      {diaAbierto && (
        <div className="mt-4">
          <DetalleDia fecha={diaAbierto} datos={porFecha.get(diaAbierto)} onClose={() => onAbrirDia(null)} />
        </div>
      )}
    </div>
  );
}

function DetalleDia({ fecha, datos, onClose }) {
  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/10">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-900 dark:text-white">
          📆 {new Date(fecha + "T00:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        </p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-500">
          ✕
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            🧾 Facturas ({datos?.facturas.length || 0})
          </p>
          <div className="space-y-1.5">
            {(datos?.facturas || []).length === 0 && <p className="text-xs text-slate-400">Ninguna este día.</p>}
            {(datos?.facturas || []).map((f) => (
              <FilaFactura key={f.id} factura={f} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            📦 Remitos ({datos?.remitos.length || 0})
          </p>
          <div className="space-y-1.5">
            {(datos?.remitos || []).length === 0 && <p className="text-xs text-slate-400">Ninguno este día.</p>}
            {(datos?.remitos || []).map((r) => (
              <FilaRemito key={r.id} remito={r} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilaFactura({ factura }) {
  const [detalle, setDetalle] = useState(null); // null=no pedido, "cargando", {Numero,Total,...} o "error"
  const [descargando, setDescargando] = useState(false);
  const [descargaError, setDescargaError] = useState(false);

  async function cargarDetalle() {
    if (detalle) return;
    setDetalle("cargando");
    try {
      const d = await adminGetComprobanteDetail(factura.id);
      setDetalle(d);
    } catch {
      setDetalle("error");
    }
  }

  async function descargar() {
    setDescargando(true);
    setDescargaError(false);
    try {
      const r = await adminDescargarPdfComprobante(factura.id);
      if (r.ok && r.pdfBase64) {
        descargarBase64Pdf(r.pdfBase64, r.archivo || `factura-${factura.id}.pdf`);
      } else {
        setDescargaError(true);
      }
    } catch {
      setDescargaError(true);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900 dark:text-white">{factura.cliente || "Sin nombre"}</p>
          <p className="text-slate-400 dark:text-neutral-500">
            {factura.bicis} bici{factura.bicis === 1 ? "" : "s"} · {money(factura.facturado)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={cargarDetalle} className="rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300">
            Ver
          </button>
          <button
            onClick={descargar}
            disabled={descargando}
            className="rounded-lg bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {descargando ? "…" : "⬇️"}
          </button>
        </div>
      </div>
      {detalle === "cargando" && <p className="mt-1 text-slate-400">Cargando número…</p>}
      {detalle === "error" && (
        <p className="mt-1 font-semibold text-amber-600 dark:text-amber-400">⚠️ A verificar — no se pudo traer el detalle de Contabilium.</p>
      )}
      {detalle && detalle !== "cargando" && detalle !== "error" && (
        <p className="mt-1 text-slate-500 dark:text-neutral-400">N° {detalle.Numero} · {detalle.Tipo}</p>
      )}
      {descargaError && (
        <p className="mt-1 font-semibold text-amber-600 dark:text-amber-400">⚠️ A verificar — no se pudo descargar el PDF real, buscala a mano en Contabilium.</p>
      )}
    </div>
  );
}

function FilaRemito({ remito }) {
  const [descargando, setDescargando] = useState(false);
  const [descargaError, setDescargaError] = useState(false);
  const [viendo, setViendo] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [detalleError, setDetalleError] = useState(false);

  async function ver() {
    setViendo(true);
    if (detalle) return;
    try {
      const d = await adminObtenerRemitoDetalle(remito.id);
      setDetalle(d);
    } catch {
      setDetalleError(true);
    }
  }

  async function descargar() {
    setDescargando(true);
    setDescargaError(false);
    try {
      const r = await adminDescargarPdfComprobante(remito.id);
      if (r.ok && r.pdfBase64) {
        descargarBase64Pdf(r.pdfBase64, r.archivo || `remito-${remito.id}.pdf`);
      } else {
        setDescargaError(true);
      }
    } catch {
      setDescargaError(true);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900 dark:text-white">
            {remito.cliente || "Sin nombre"} {remito.esInterno && <span className="text-slate-400">(interno)</span>}
          </p>
          <p className="text-slate-400 dark:text-neutral-500">
            {remito.bicis} bici{remito.bicis === 1 ? "" : "s"} · N° {remito.numero || `#${remito.id}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={ver} className="rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300">
            Ver
          </button>
          <button
            onClick={descargar}
            disabled={descargando}
            className="rounded-lg bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {descargando ? "…" : "⬇️"}
          </button>
        </div>
      </div>
      {!remito.numero && (
        <p className="mt-1 font-semibold text-amber-600 dark:text-amber-400">⚠️ A verificar — este remito no tiene número cargado.</p>
      )}
      {viendo && detalleError && (
        <p className="mt-1 font-semibold text-amber-600 dark:text-amber-400">⚠️ A verificar — no se pudo traer el detalle de Contabilium.</p>
      )}
      {viendo && detalle && (
        <p className="mt-1 text-slate-500 dark:text-neutral-400">{detalle.observaciones || "Sin observaciones."}</p>
      )}
      {descargaError && (
        <p className="mt-1 font-semibold text-amber-600 dark:text-amber-400">⚠️ A verificar — no se pudo descargar el PDF real, buscalo a mano en Contabilium.</p>
      )}
    </div>
  );
}
