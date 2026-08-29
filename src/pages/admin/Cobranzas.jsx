import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { subscribeCobranzas, subscribeCobranzasSyncStatus, triggerCobranzasSync } from "../../services/cobranzas";
import { nombreBanco } from "../../services/bancos";
import { adminGetComprobanteDetail } from "../../services/comprobantes";
import { subirImagenesNota } from "../../utils/notaImagenes";
import ConciliacionBancaria from "./cobranzas/ConciliacionBancaria";
import ChequesSection from "./cobranzas/ChequesSection";
import ChequesContabiliumSection from "./cobranzas/ChequesContabiliumSection";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function parseFecha(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatFecha(fecha) {
  const d = parseFecha(fecha);
  return d ? d.toLocaleDateString("es-AR") : "-";
}

function timeAgo(date) {
  if (!date) return "nunca";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return date.toLocaleDateString("es-AR");
}

// Una cobranza está "imputada" si tiene detalle (se aplicó a al menos una
// factura) o si es 100% "Saldo a favor" (esas ya se excluyen del cálculo de
// saldo de cuenta corriente, no son un pago nuevo sin aplicar).
function esCobranzaImputada(c) {
  const detalle = c.detalle || [];
  if (detalle.length > 0) return true;
  const formas = c.formasDePago || [];
  return formas.length > 0 && formas.every((f) => f.FormaDePago === "Saldo a favor");
}

export default function Cobranzas() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [search, setSearch] = useState("");
  const [soloSinImputar, setSoloSinImputar] = useState(false);
  const [mostrarExtracto, setMostrarExtracto] = useState(false);
  const [mostrarCheques, setMostrarCheques] = useState(false);
  const [mostrarChequesContabilium, setMostrarChequesContabilium] = useState(false);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    const unsub = subscribeCobranzas(setItems, (e) => setError(e.message || "No se pudo cargar"));
    const unsubStatus = subscribeCobranzasSyncStatus((s) =>
      setSyncStatus(s ? { ...s, lastSync: s.lastSync?.toDate?.() || null } : null)
    );
    return () => {
      unsub();
      unsubStatus();
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await triggerCobranzasSync();
      setSyncMsg(`Listo: ${r.synced} de ${r.total} sincronizadas${r.errors.length ? ` (${r.errors.length} con error)` : ""}.`);
    } catch (e) {
      setSyncMsg(e.message || "No se pudo sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  const porCliente = useMemo(() => {
    const map = new Map();
    for (const c of items || []) {
      const key = c.idPersona ?? `sin-vinculo-${c.nroDocumento || c.razonSocial}`;
      if (!map.has(key)) map.set(key, { idPersona: c.idPersona, razonSocial: c.razonSocial, nroDocumento: c.nroDocumento, cobranzas: [] });
      map.get(key).cobranzas.push(c);
    }
    return Array.from(map.values())
      .map((g) => {
        const sinImputar = g.cobranzas.filter((c) => !esCobranzaImputada(c));
        const totalGeneral = g.cobranzas.reduce((acc, c) => acc + Number(c.importeReal ?? c.importeTotal ?? 0), 0);
        const totalSinImputar = sinImputar.reduce((acc, c) => acc + Number(c.importeReal ?? c.importeTotal ?? 0), 0);
        return { ...g, sinImputar, totalGeneral, totalSinImputar, cantidad: g.cobranzas.length };
      })
      .sort((a, b) => b.totalSinImputar - a.totalSinImputar || (a.razonSocial || "").localeCompare(b.razonSocial || ""));
  }, [items]);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return porCliente.filter((g) => {
      if (soloSinImputar && g.sinImputar.length === 0) return false;
      if (q && !`${g.razonSocial || ""} ${g.nroDocumento || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [porCliente, search, soloSinImputar]);

  const totalSinImputarGeneral = porCliente.reduce((acc, g) => acc + g.totalSinImputar, 0);
  const clientesConSinImputar = porCliente.filter((g) => g.sinImputar.length > 0).length;
  const totalCobranzas = items?.length ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Cobranzas</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          {items === null ? "Cargando…" : `${totalCobranzas} cobranzas de Contabilium · ${porCliente.length} clientes`}
        </p>
        {error && <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${(syncStatus?.errors?.length || 0) > 0 ? "bg-rose-500" : "bg-emerald-400"}`} />
          <span className="text-sm text-slate-600 dark:text-neutral-300">
            Última sync: {timeAgo(syncStatus?.lastSync)}
            {syncStatus?.total != null ? ` · ${syncStatus.synced}/${syncStatus.total}` : ""}
          </span>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="ml-auto rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          {syncing ? "Sincronizando…" : "Sincronizar con Contabilium"}
        </button>
        {syncMsg && <span className="w-full text-xs text-slate-500 dark:text-neutral-400 sm:w-auto">{syncMsg}</span>}
      </div>

      {/* Extracto bancario / movimientos sin identificar — siempre en esta
          misma pantalla, se despliega sin cambiar de sección. */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <button
          onClick={() => setMostrarExtracto((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            🏦 Subir extracto bancario / identificar pagos sueltos
          </span>
          <span className="text-slate-400">{mostrarExtracto ? "▲" : "▼"}</span>
        </button>
        {mostrarExtracto && (
          <div className="border-t border-slate-100 p-4 dark:border-neutral-800">
            <ConciliacionBancaria cobranzas={items || []} />
          </div>
        )}
      </div>

      {/* Cheques registrados — cartera global de cheques a favor, para
          imputarlos contra cualquier factura desde la misma pantalla de
          Cobranzas en vez de una sección aparte. */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <button
          onClick={() => setMostrarCheques((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-white">🏦 Cheques registrados</span>
          <span className="text-slate-400">{mostrarCheques ? "▲" : "▼"}</span>
        </button>
        {mostrarCheques && (
          <div className="border-t border-slate-100 p-4 dark:border-neutral-800">
            <ChequesSection />
          </div>
        )}
      </div>

      {/* Cheques tal cual figuran en Contabilium (dentro de las cobranzas ya
          sincronizadas), agrupados por cliente con desplegable — para
          cruzar contra la cartera física de arriba. */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <button
          onClick={() => setMostrarChequesContabilium((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-white">🏦 Cheques de Contabilium (por cliente)</span>
          <span className="text-slate-400">{mostrarChequesContabilium ? "▲" : "▼"}</span>
        </button>
        {mostrarChequesContabilium && (
          <div className="border-t border-slate-100 p-4 dark:border-neutral-800">
            <ChequesContabiliumSection cobranzas={items || []} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente o CUIT"
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
        <button
          onClick={() => setSoloSinImputar((v) => !v)}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
            soloSinImputar
              ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-400"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
        >
          {soloSinImputar ? "✓ Solo con sin imputar" : "Solo con sin imputar"}
        </button>
        <span className="ml-auto text-sm text-slate-500 dark:text-neutral-400">
          {clientesConSinImputar} cliente(s) con algo sin imputar · {money(totalSinImputarGeneral)} en total
        </span>
      </div>

      <div className="space-y-2">
        {filtrados.map((g) => {
          const key = g.idPersona ?? g.razonSocial;
          const isOpen = abierto === key;
          return (
            <div key={key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <button
                onClick={() => setAbierto(isOpen ? null : key)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  {g.idPersona ? (
                    <Link
                      to={`/admin/clientes-360?buscar=${encodeURIComponent(g.razonSocial || "")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-sky-700 hover:underline dark:text-sky-400"
                    >
                      {g.razonSocial || "(sin nombre)"}
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-700 dark:text-neutral-300">{g.razonSocial || "(sin nombre)"}</span>
                  )}
                  <span className="ml-2 text-xs text-slate-400 dark:text-neutral-500">
                    {g.nroDocumento} · {g.cantidad} cobranza(s)
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{money(g.totalGeneral)}</span>
                  {g.sinImputar.length > 0 ? (
                    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
                      🟠 {g.sinImputar.length} sin imputar · {money(g.totalSinImputar)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      🟢 Todo imputado
                    </span>
                  )}
                  <span className="text-slate-400">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>
              {isOpen && (
                <div className="space-y-2 border-t border-slate-100 px-4 py-3 dark:border-neutral-800">
                  {g.cobranzas
                    .slice()
                    .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
                    .map((c) => (
                      <CobranzaRow key={c.contabiliumId || c.id} c={c} />
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {items !== null && filtrados.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-neutral-500">Sin resultados.</p>
        )}
      </div>
    </div>
  );
}

// Una cobranza individual: sus formas de pago, a qué factura(s) se aplicó
// (resuelto al toque, no de entrada, para no pegarle a la API de más), y el
// botón para subir el comprobante de pago de esa cobranza puntual.
function CobranzaRow({ c }) {
  const imputada = esCobranzaImputada(c);
  const detalle = c.detalle || [];
  const [facturas, setFacturas] = useState(null); // null = no consultado, "loading", o array
  const [subiendo, setSubiendo] = useState(false);
  const [comprobanteUrl, setComprobanteUrl] = useState(c.comprobantePagoUrl || null);

  async function handleVerFacturas() {
    if (facturas) { setFacturas(null); return; }
    setFacturas("loading");
    try {
      const resultados = await Promise.all(
        detalle.map(async (d) => {
          if (!d.IDComprobante) return { ...d, numero: null, tipo: null };
          try {
            const comp = await adminGetComprobanteDetail(d.IDComprobante);
            return { ...d, numero: comp.Numero, tipo: comp.Tipo };
          } catch {
            return { ...d, numero: null, tipo: null };
          }
        })
      );
      setFacturas(resultados);
    } catch {
      setFacturas([]);
    }
  }

  async function handleSubirComprobante(e) {
    const file = e.target.files?.[0];
    if (!file || !c.contabiliumId) return;
    setSubiendo(true);
    try {
      const [url] = await subirImagenesNota(`cobranzas/${c.contabiliumId}`, [file]);
      await updateDoc(doc(db, "cobranzas", String(c.contabiliumId)), { comprobantePagoUrl: url });
      setComprobanteUrl(url);
    } catch (err) {
      alert(err.message || "No se pudo subir el comprobante.");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className={`rounded-xl px-3 py-2.5 text-xs ${imputada ? "bg-slate-50 dark:bg-neutral-800/50" : "bg-orange-50 dark:bg-orange-950/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-slate-500 dark:text-neutral-400">
          Nº {c.numero} · {formatFecha(c.fecha)}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900 dark:text-white">{money(c.importeReal ?? c.importeTotal)}</span>
          <span className={imputada ? "text-emerald-600 dark:text-emerald-400" : "font-semibold text-orange-600 dark:text-orange-400"}>
            {imputada ? "Imputada" : "Sin imputar"}
          </span>
        </div>
      </div>

      {(c.formasDePago || []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.formasDePago.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {f.FormaDePago}{nombreBanco(f.IdBanco) ? ` (${nombreBanco(f.IdBanco)})` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {detalle.length > 0 && (
          <button
            onClick={handleVerFacturas}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {facturas ? "Ocultar facturas" : `Ver ${detalle.length} factura(s) aplicada(s)`}
          </button>
        )}

        {comprobanteUrl ? (
          <a
            href={comprobanteUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
          >
            📎 Ver comprobante
          </a>
        ) : (
          <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            {subiendo ? "Subiendo…" : "📎 Subir comprobante de pago"}
            <input type="file" accept="image/*,application/pdf" onChange={handleSubirComprobante} disabled={subiendo} className="hidden" />
          </label>
        )}
      </div>

      {facturas === "loading" && <p className="mt-1.5 text-[11px] text-slate-400">Consultando…</p>}
      {Array.isArray(facturas) && (
        <div className="mt-1.5 space-y-1">
          {facturas.map((f, i) => (
            <p key={i} className="text-[11px] text-slate-500 dark:text-neutral-400">
              {f.numero ? `${f.tipo || "Comprobante"} ${f.numero}` : f.IDComprobante ? "Comprobante no encontrado" : "Ajuste sin comprobante asociado"} — {money(f.Importe)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
