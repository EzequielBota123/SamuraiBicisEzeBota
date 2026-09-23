import { useState } from "react";
import { doc, updateDoc, arrayUnion, increment, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebase";
import { cobrarComprobante, adminGetClientComprobantes } from "../../services/comprobantes";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFechaHora(s) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  const fecha = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${fecha} · ${hora} hs`;
}

// Un cheque es un saldo "a favor" del cliente, no algo atado a una factura
// puntual — puede valer más o menos que lo que debe hoy, y se va imputando
// de a partes contra la/las facturas que corresponda, cuando corresponda
// (incluso facturas que todavía no existían cuando se cargó el cheque).
export function calcularEstadoCheque(ch) {
  if (ch.estado === "entregado") return "entregado";
  if (ch.estado === "rechazado") return "rechazado";
  const disponible = Number(ch.monto || 0) - Number(ch.montoImputado || 0);
  return disponible <= 0 ? "imputado" : "pendiente";
}

const ESTADO_BADGE = {
  pendiente: { text: "🕓 Con saldo a favor", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
  imputado: { text: "✓ Imputado por completo", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" },
  entregado: { text: "📤 Entregado a un tercero", cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400" },
  rechazado: { text: "✕ Rechazado / rebotó", cls: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400" },
};
export const CHEQUE_ESTADO_BADGE = ESTADO_BADGE;

// Compartido entre Clientes 360 (por cliente, puede pasar `facturasCliente`
// ya cargadas para no repetir el pedido) y la pantalla global de Cheques
// (sin ese contexto — ChequeRow trae las facturas del cliente al vuelo
// recién cuando aprietan "Imputar").
export default function ChequeRow({ cheque: ch, facturasCliente, otrosChequesCliente, onChanged, mostrarCliente = false }) {
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [imputando, setImputando] = useState(false);
  // Si el padre todavía no terminó de cargar sus facturas puede mandar un
  // array vacío de arranque — solo lo tomamos como "ya sé que no tiene" si
  // realmente trae algo; si no, se pide de nuevo al abrir "Imputar".
  const [facturas, setFacturas] = useState(facturasCliente?.length ? facturasCliente : null);
  const [facturaId, setFacturaId] = useState("");
  const [montoImputar, setMontoImputar] = useState("");
  // IDs de otros cheques pendientes del mismo cliente que el usuario eligió
  // sumar a ESTE MISMO recibo. Es necesario porque la API de Contabilium
  // reemplaza el recibo entero del comprobante en cada llamada a
  // /comprobantes/cobrar (no lo acumula) — si imputáramos dos cheques con
  // dos llamadas separadas, la segunda pisaría a la primera y solo quedaría
  // registrado el último cheque. Por eso hay que mandarlos juntos, en un
  // solo llamado, igual que hace el selector nativo de Contabilium.
  const [otrosSeleccionados, setOtrosSeleccionados] = useState(new Set());

  const estado = calcularEstadoCheque(ch);
  const badge = ESTADO_BADGE[estado];
  const disponible = Number(ch.monto || 0) - Number(ch.montoImputado || 0);

  const otrosPendientes = (otrosChequesCliente || []).filter(
    (o) => o.id !== ch.id && calcularEstadoCheque(o) === "pendiente"
  );

  async function abrirImputar() {
    setImputando(true);
    setError("");
    if (!facturas) {
      try {
        const r = await adminGetClientComprobantes(ch.contabiliumId);
        const conSaldo = (r.items || []).filter((f) => Number(f.Saldo || 0) > 0);
        setFacturas(conSaldo);
        setFacturaId(conSaldo[0]?.Id ? String(conSaldo[0].Id) : "");
        setMontoImputar(String(Math.min(disponible, Number(conSaldo[0]?.Saldo || 0)) || disponible));
      } catch (e) {
        setError("No se pudieron traer las facturas de este cliente");
        setFacturas([]);
      }
    } else {
      setFacturaId(facturas[0]?.Id ? String(facturas[0].Id) : "");
      setMontoImputar(String(Math.min(disponible, Number(facturas[0]?.Saldo || 0)) || disponible));
    }
  }

  function toggleOtroSeleccionado(id) {
    setOtrosSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirmarImputacion() {
    const factura = (facturas || []).find((f) => String(f.Id) === String(facturaId));
    if (!factura) {
      setError("Elegí una factura");
      return;
    }
    const monto = Number(montoImputar);
    if (!(monto > 0)) {
      setError("Ingresá un monto mayor a 0");
      return;
    }
    if (monto > disponible) {
      setError("No podés imputar más de lo que queda disponible del cheque");
      return;
    }
    if (monto > Number(factura.Saldo)) {
      setError("No podés imputar más de lo que debe esa factura");
      return;
    }

    // Arma las líneas de este cheque + los otros cheques que el usuario
    // sumó al mismo recibo, sin pasarse del saldo que le queda a la factura.
    const lineas = [{ cheque: ch, monto }];
    let restanteFactura = Number(factura.Saldo) - monto;
    for (const other of otrosPendientes) {
      if (!otrosSeleccionados.has(other.id) || restanteFactura <= 0) continue;
      const dispOther = Number(other.monto || 0) - Number(other.montoImputado || 0);
      const montoOther = Math.min(dispOther, restanteFactura);
      if (montoOther > 0) {
        lineas.push({ cheque: other, monto: montoOther });
        restanteFactura -= montoOther;
      }
    }

    const detalle = lineas.map((l) => `• Cheque N° ${l.cheque.nroCheque} — ${money(l.monto)}`).join("\n");
    const ok = confirm(
      `Vas a registrar un RECIBO REAL en Contabilium contra la factura ${factura.Numero}:\n\n${detalle}\n\n¿Confirmás?`
    );
    if (!ok) return;

    setProcesando(true);
    setError("");
    try {
      await cobrarComprobante({
        idComprobante: factura.Id,
        importeTotalNeto: Number(factura.Total),
        pagos: lineas.map((l) => ({
          formaDePago: "Cheque",
          monto: l.monto,
          idBanco: null,
          nroReferencia: l.cheque.nroCheque,
        })),
      });
      await Promise.all(
        lineas.map((l) =>
          updateDoc(doc(db, "chequesRegistrados", l.cheque.id), {
            montoImputado: increment(l.monto),
            imputaciones: arrayUnion({
              facturaId: factura.Id,
              facturaNumero: factura.Numero,
              monto: l.monto,
              por: auth.currentUser?.email || null,
              fecha: new Date().toISOString(),
            }),
          })
        )
      );
      setImputando(false);
      setOtrosSeleccionados(new Set());
      onChanged?.();
    } catch (e) {
      setError(e.message || "No se pudo imputar el cheque");
    } finally {
      setProcesando(false);
    }
  }

  async function handleEntregar() {
    const entregadoA = prompt("¿A quién le diste este cheque? (proveedor, persona, etc.)");
    if (!entregadoA || !entregadoA.trim()) return;
    setProcesando(true);
    setError("");
    try {
      await updateDoc(doc(db, "chequesRegistrados", ch.id), {
        estado: "entregado",
        entregadoA: entregadoA.trim(),
        entregadoPor: auth.currentUser?.email || null,
        entregadoAt: serverTimestamp(),
      });
      onChanged?.();
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setProcesando(false);
    }
  }

  async function handleRechazar() {
    if (!confirm("¿Marcar este cheque como rechazado (rebotó)? No se puede deshacer.")) return;
    setProcesando(true);
    setError("");
    try {
      await updateDoc(doc(db, "chequesRegistrados", ch.id), {
        estado: "rechazado",
        rechazadoPor: auth.currentUser?.email || null,
        rechazadoAt: serverTimestamp(),
      });
      onChanged?.();
    } catch (e) {
      setError(e.message || "No se pudo guardar");
    } finally {
      setProcesando(false);
    }
  }

  const puedeOperar = estado === "pendiente";

  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-neutral-800">
      <div className="flex items-center gap-3">
        {ch.fotoUrl && (
          <a href={ch.fotoUrl} target="_blank" rel="noreferrer" className="shrink-0">
            <img src={ch.fotoUrl} alt="Cheque" className="h-14 w-14 rounded-lg border border-slate-200 object-cover transition hover:opacity-80 dark:border-neutral-700" />
          </a>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white">
            {mostrarCliente && ch.clienteName ? `${ch.clienteName} — ` : ""}
            N° {ch.nroCheque || "—"} · {money(ch.monto)}
            {Number(ch.montoImputado || 0) > 0 && estado !== "entregado" && (
              <span className="ml-1.5 font-normal text-slate-400 dark:text-neutral-500">
                (disponible: {money(disponible)})
              </span>
            )}
          </p>
          <p className="text-xs text-slate-400 dark:text-neutral-500">
            {ch.cargadoPor ? `Cargado por ${ch.cargadoPor}` : ""}
            {ch.createdAt?.toDate ? ` · ${formatFechaHora(ch.createdAt.toDate().toISOString())}` : ""}
          </p>
          {estado === "entregado" && ch.entregadoA && (
            <p className="text-xs font-medium text-sky-600 dark:text-sky-400">→ Se lo dieron a: {ch.entregadoA}</p>
          )}
          {(ch.imputaciones || []).length > 0 && (
            <div className="mt-1 space-y-0.5">
              {ch.imputaciones.map((imp, i) => (
                <p key={i} className="text-[11px] text-slate-400 dark:text-neutral-500">
                  ✓ {money(imp.monto)} → factura {imp.facturaNumero}{imp.por ? ` · ${imp.por}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
        {!ch.fotoUrl && (
          <span className="shrink-0 text-xs italic text-slate-400 dark:text-neutral-500">Sin foto</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
          {badge.text}
        </span>
        {puedeOperar && !imputando && (
          <>
            <button
              onClick={abrirImputar}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700"
            >
              ✓ Imputar
            </button>
            <button
              onClick={handleEntregar}
              disabled={procesando}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              📤 Marcar entregado a un tercero
            </button>
            <button
              onClick={handleRechazar}
              disabled={procesando}
              className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
            >
              ✕ Rechazado
            </button>
          </>
        )}
      </div>

      {imputando && (
        <div className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/10">
          {facturas === null ? (
            <p className="text-xs text-slate-400">Buscando facturas del cliente…</p>
          ) : facturas.length === 0 ? (
            <p className="text-xs text-slate-400">Este cliente no tiene facturas con saldo pendiente ahora mismo.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-neutral-300">
                Factura
                <select
                  value={facturaId}
                  onChange={(e) => {
                    setFacturaId(e.target.value);
                    const f = facturas.find((x) => String(x.Id) === e.target.value);
                    setMontoImputar(String(Math.min(disponible, Number(f?.Saldo || 0))));
                  }}
                  className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                >
                  {facturas.map((f) => (
                    <option key={f.Id} value={f.Id}>{f.Numero} — debe {money(f.Saldo)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 dark:text-neutral-300">
                Monto
                <input
                  type="number"
                  min="1"
                  value={montoImputar}
                  onChange={(e) => setMontoImputar(e.target.value)}
                  className="ml-1.5 w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                />
              </label>
              <button
                onClick={handleConfirmarImputacion}
                disabled={procesando}
                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {procesando ? "Imputando…" : "Confirmar"}
              </button>
              <button
                onClick={() => setImputando(false)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:border-neutral-700"
              >
                Cancelar
              </button>
            </div>
          )}
          {facturas && facturas.length > 0 && otrosPendientes.length > 0 && (
            <div className="mt-1.5 space-y-1 border-t border-emerald-200/60 pt-1.5 dark:border-emerald-900/60">
              <p className="text-[11px] text-slate-500 dark:text-neutral-400">
                Sumar también otros cheques pendientes a este mismo recibo (para que no se pisen entre sí):
              </p>
              {otrosPendientes.map((other) => {
                const dispOther = Number(other.monto || 0) - Number(other.montoImputado || 0);
                return (
                  <label key={other.id} className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={otrosSeleccionados.has(other.id)}
                      onChange={() => toggleOtroSeleccionado(other.id)}
                    />
                    N° {other.nroCheque || "—"} — disponible {money(dispOther)}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
