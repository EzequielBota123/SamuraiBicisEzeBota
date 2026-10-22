import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
// "query" se importa como fsQuery porque el componente ya usa una variable
// de estado local llamada `query` (el texto de búsqueda de bicis) — con el
// mismo nombre, esa variable tapa la función de Firestore adentro de ese
// componente y rompe en tiempo de ejecución ("query is not a function").
import { collection, getDocs, query as fsQuery, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getContabiliumDepositos, labelDeposito, matchDeposito } from "../../services/contabiliumDepositos";
import { getDepositoStockAdmin, ajustarStockManual, transferirStockManual, generarRemitoRealManual, debugProbeIdCC, searchContabiliumClientes, crearDepositoManual, pedirProvinciaYCiudad, getStockRodadosPorSector } from "../../services/comprobantes";
import { LoadingOverlay } from "../../components/ui/LoadingIndicators";
import { filterBySearch } from "../../utils/colorSearch";
import { StatsBanner, BikeCard, ItemModal } from "../../components/stock/ConsignedStockUI";
import { listAuditsByDeposito, deleteAudit, uploadAudit, nextAuditDate, isAuditOverdue, getAuditProgramStart } from "../../services/stockAudits";
import AuditVideoPlayer from "../../components/stock/AuditVideoPlayer";
import AuditRecorderModal from "../../components/stock/AuditRecorderModal";
import { useAuth } from "../../auth/AuthContext";
import CargarViajeCampos, { viajeCfgInicial } from "../../components/logistica/CargarViajeCampos";
import { crearViajeDesdeTransferencia, numeroDeRemito } from "../../utils/viajeDesdeTransferencia";
import { actualizarRemitoViaje } from "../../services/logisticaViajes";
import DepositosFepaPanel from "../../components/stock/DepositosFepaPanel";
import { extraerModelo, extraerTalle } from "../../utils/bikeName";

const MODELOS_FILTRO = [
  { id: "todos", label: "Todos" },
  { id: "BOWIE", label: "Bowie" },
  { id: "SHONEN", label: "Shonen" },
  { id: "GOZEN", label: "Gozen" },
  { id: "3.0", label: "Samurai 3.0" },
  { id: "2.0", label: "Samurai 2.0" },
];
const ORDEN_MODELO_FILTRO = ["BOWIE", "SHONEN", "GOZEN", "3.0", "2.0"];
const ORDEN_TALLE_FILTRO = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];
function ordenarPorModeloYTalle(items) {
  return [...items].sort((a, b) => {
    const ma = extraerModelo(a.name);
    const mb = extraerModelo(b.name);
    const ia = ma ? ORDEN_MODELO_FILTRO.indexOf(ma) : 99;
    const ib = mb ? ORDEN_MODELO_FILTRO.indexOf(mb) : 99;
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    const ta = extraerTalle(a.name);
    const tb = extraerTalle(b.name);
    const ja = ta ? ORDEN_TALLE_FILTRO.indexOf(ta) : 99;
    const jb = tb ? ORDEN_TALLE_FILTRO.indexOf(tb) : 99;
    if (ja !== jb) return (ja === -1 ? 99 : ja) - (jb === -1 ? 99 : jb);
    return (a.name || "").localeCompare(b.name || "", "es");
  });
}

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function isBici(item) {
  return (item.category || "").toUpperCase() === "BICICLETAS";
}

const RODADOS_ARGENTINOS_DEPOSITO_ID = 134795;
function esRodadosArgentinos(d) {
  return d?.id === RODADOS_ARGENTINOS_DEPOSITO_ID || /rodados argentinos/i.test(d?.nombre || "");
}

export default function StockConsignado() {
  const { user, profile } = useAuth();
  const [depositos, setDepositos] = useState([]);
  const [loadingDepositos, setLoadingDepositos] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const [items, setItems] = useState(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [filtroModeloGrilla, setFiltroModeloGrilla] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [audits, setAudits] = useState([]);
  const [auditIntervalDays, setAuditIntervalDays] = useState(undefined);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [deletingAuditId, setDeletingAuditId] = useState(null);
  const [auditProgramStart, setAuditProgramStart] = useState(null);
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [announcementResult, setAnnouncementResult] = useState(null);
  const [distributorUid, setDistributorUid] = useState(null);
  const [distributorName, setDistributorName] = useState(null);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [creandoDeposito, setCreandoDeposito] = useState(false);
  const [rodadosSectores, setRodadosSectores] = useState(null);
  const [loadingRodados, setLoadingRodados] = useState(false);
  const [errorRodados, setErrorRodados] = useState("");

  async function handleCrearDeposito() {
    const nombre = prompt("Nombre del depósito nuevo (ej. el nombre del cliente/distribuidor):");
    if (!nombre || !nombre.trim()) return;
    const direccion = prompt("Dirección (opcional, dejalo vacío si no hace falta):") || "";
    const telefono = prompt("Teléfono (opcional):") || "";
    setCreandoDeposito(true);
    try {
      const ubicacion = await pedirProvinciaYCiudad();
      const result = await crearDepositoManual({ nombre: nombre.trim(), direccion, telefono, ...(ubicacion || {}) });
      alert(result.aviso || "Depósito creado en Contabilium.");
    } catch (e) {
      alert(e.message || "No se pudo crear el depósito");
    } finally {
      setCreandoDeposito(false);
    }
  }

  useEffect(() => {
    getAuditProgramStart().then(setAuditProgramStart).catch(() => {});
  }, []);

  async function handleSendAnnouncement() {
    if (!confirm("¿Mandar el mail de aviso de auditoría a todos los distribuidores con email cargado?")) return;
    setSendingAnnouncement(true);
    setAnnouncementResult(null);
    try {
      const result = await sendAuditAnnouncementEmail();
      setAnnouncementResult(result);
    } catch (e) {
      setAnnouncementResult({ error: e.message || "Error enviando los mails." });
    } finally {
      setSendingAnnouncement(false);
    }
  }

  const [fepaPanelAbierto, setFepaPanelAbierto] = useState(false);

  const location = useLocation();

  useEffect(() => {
    getContabiliumDepositos()
      .then(setDepositos)
      .catch((e) => console.error("Error cargando depósitos:", e))
      .finally(() => setLoadingDepositos(false));
  }, []);

  // Si llegamos acá desde una notificación (ej. "subió el video de
  // auditoría", que trae ?depositoId=X), abrimos directo el depósito de ese
  // distribuidor en vez de dejar la pantalla vacía esperando que alguien lo
  // busque a mano en la lista.
  useEffect(() => {
    if (!depositos.length) return;
    const params = new URLSearchParams(location.search);
    const depositoIdParam = params.get("depositoId");
    if (!depositoIdParam) return;
    const match = depositos.find((d) => String(d.id) === depositoIdParam);
    if (match) selectDeposito(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositos, location.search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return depositos;
    return depositos.filter((d) => matchDeposito(d, q));
  }, [depositos, search]);

  const totalBicicletas = useMemo(() => {
    if (!items) return 0;
    return items.filter(isBici).reduce((acc, it) => acc + Number(it.stockDisponible || 0), 0);
  }, [items]);

  const totalDebido = useMemo(() => {
    if (!items) return 0;
    return items
      .filter(isBici)
      .reduce((acc, it) => acc + Number(it.priceArs || 0) * Number(it.stockDisponible || 0), 0);
  }, [items]);

  const modelosGrilla = useMemo(() => {
    if (!items) return [];
    return [...new Set(items.map((it) => extraerModelo(it.name)).filter(Boolean))].sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!items) return null;
    const base = filtroModeloGrilla ? items.filter((it) => extraerModelo(it.name) === filtroModeloGrilla) : items;
    return filterBySearch(base, itemSearch);
  }, [items, itemSearch, filtroModeloGrilla]);

  // La grilla principal solo muestra lo que hay disponible ahora — los
  // productos en 0 se buscan aparte, en el panel de ajuste de stock.
  const conStock = useMemo(() => (filteredItems || []).filter((it) => Number(it.stockDisponible || 0) > 0), [filteredItems]);
  const bicis = useMemo(() => conStock.filter(isBici), [conStock]);
  const accesorios = useMemo(() => conStock.filter((it) => !isBici(it)), [conStock]);

  async function handleDeleteAudit(a) {
    if (!confirm("¿Eliminar este video de auditoría? No se puede deshacer.")) return;
    setDeletingAuditId(a.id);
    try {
      await deleteAudit(a.id, a.videoUrl);
      setAudits((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      alert(e.message || "No se pudo eliminar el video.");
    } finally {
      setDeletingAuditId(null);
    }
  }

  async function selectDeposito(d) {
    setSelected(d);
    setItems(null);
    setItemSearch("");
    setFiltroModeloGrilla(null);
    setError("");
    setSelectedItem(null);
    setLoadingItems(true);
    setAudits([]);
    setAuditIntervalDays(undefined);
    setDistributorUid(null);
    setDistributorName(null);
    setLoadingAudits(true);
    setRodadosSectores(null);
    setErrorRodados("");
    try {
      const result = await getDepositoStockAdmin(d.id);
      setItems(result.items);
    } catch (e) {
      setError(e.message || "Error al consultar el stock");
    } finally {
      setLoadingItems(false);
    }
    if (esRodadosArgentinos(d)) {
      setLoadingRodados(true);
      try {
        const r = await getStockRodadosPorSector();
        setRodadosSectores(r);
      } catch (e) {
        setErrorRodados(e.message || "No se pudo separar el stock por sector");
      } finally {
        setLoadingRodados(false);
      }
    }
    try {
      const list = await listAuditsByDeposito(d.id);
      setAudits(list);
    } catch (e) {
      console.error("Error cargando auditorías:", e);
    } finally {
      setLoadingAudits(false);
    }
    try {
      const usersSnap = await getDocs(fsQuery(collection(db, "users"), where("contabiliumDepositoId", "==", d.id)));
      const userDoc = usersSnap.docs[0];
      const u = userDoc?.data();
      setAuditIntervalDays(u?.auditIntervalDays);
      setDistributorUid(userDoc?.id || null);
      setDistributorName(u?.contabiliumDepositoNombre || u?.name || d.nombre);
    } catch (e) {
      console.error("Error consultando intervalo de auditoría:", e);
    }
  }

  async function reloadItems() {
    if (!selected) return;
    try {
      const result = await getDepositoStockAdmin(selected.id);
      setItems(result.items);
    } catch (e) {
      console.error("Error recargando stock:", e);
    }
  }

  async function handleSubmitAudit(blob, recordedAt, nota) {
    if (!selected) return;
    await uploadAudit({
      depositoId: selected.id,
      depositoNombre: selected.nombre,
      distributorUid: distributorUid || user.uid,
      distributorName: distributorName || profile?.name || "Samurai (staff)",
      blob,
      recordedAt,
      nota,
    });
    const list = await listAuditsByDeposito(selected.id);
    setAudits(list);
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">Stock consignado</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Elegí un distribuidor para ver su stock real (bicicletas y accesorios) en Contabilium.
        </p>
      </div>

      <div>
        <button
          onClick={() => setFepaPanelAbierto((v) => !v)}
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-400"
        >
          🏢 Depósitos propios de Fepa {fepaPanelAbierto ? "▲" : "▼"}
        </button>
        {fepaPanelAbierto && (
          <div className="mt-3">
            <DepositosFepaPanel />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <p className="text-sm font-bold text-amber-800 dark:text-amber-300">[Uso único] Aviso de auditoría por mail</p>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Manda el mail de "se implementó la auditoría de stock" a todos los distribuidores con email cargado.</p>
        <button
          onClick={handleSendAnnouncement}
          disabled={sendingAnnouncement}
          className="mt-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {sendingAnnouncement ? "Enviando…" : "Enviar mail a todos"}
        </button>
        {announcementResult && (
          <div className="mt-2 text-xs text-amber-900 dark:text-amber-200">
            <p>
              {announcementResult.error
                ? `❌ ${announcementResult.error}`
                : `✅ Enviados: ${announcementResult.sent} · Sin email: ${announcementResult.skipped} · Errores: ${announcementResult.errors.length}`}
            </p>
            {announcementResult.errors?.length > 0 && (
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded-lg bg-white/60 p-2 font-mono dark:bg-black/30">
                {announcementResult.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    {e.email}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-[320px_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none">
          <input
            type="search"
            placeholder="Buscar distribuidor por nombre, número o ID de Contabilium..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 sm:py-2.5"
          />
          <button
            onClick={handleCrearDeposito}
            disabled={creandoDeposito}
            className="mt-2 w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
          >
            {creandoDeposito ? "Creando…" : "+ Crear depósito nuevo"}
          </button>
          <div className="relative mt-3 max-h-[40vh] space-y-1 overflow-y-auto lg:max-h-[65vh]">
            {loadingDepositos && (
              <p className="px-2 py-4 text-xs text-slate-500 dark:text-neutral-400">Cargando depósitos…</p>
            )}
            {!loadingDepositos && filtered.length === 0 && (
              <p className="px-2 py-4 text-xs text-slate-500 dark:text-neutral-400">Sin resultados.</p>
            )}
            {filtered.map((d) => (
              <button
                key={d.id}
                onClick={() => selectDeposito(d)}
                className={`w-full rounded-2xl px-3 py-2.5 text-left text-sm transition sm:py-2 ${
                  selected?.id === d.id
                    ? "bg-sky-500 text-white shadow-md shadow-sky-200/60"
                    : "text-slate-700 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {labelDeposito(d)}
              </button>
            ))}
          </div>
        </div>

        <div className="relative min-h-[300px] rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none sm:p-6">
          {!selected && (
            <div className="flex h-full min-h-[260px] items-center justify-center text-center text-sm text-slate-500 dark:text-neutral-400">
              Elegí un distribuidor de la lista para ver su stock.
            </div>
          )}

          {selected && (
            <>
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white sm:text-lg">{selected.nombre}</h2>
                {!loadingItems && items && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-sm font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
                    🚲 {totalBicicletas} consignada{totalBicicletas === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {esRodadosArgentinos(selected) && (
                <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/10">
                  <p className="text-sm font-bold text-indigo-800 dark:text-indigo-400">📍 Separado por sector (Adrogué / Temperley)</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">
                    Rodados Argentinos es un solo depósito en Contabilium — esto clasifica cada movimiento histórico según si su observación menciona "Adrogué" o "Temperley". Lo que no lo menciona queda sin clasificar.
                  </p>
                  {loadingRodados && <p className="mt-2 text-xs text-indigo-700/70 dark:text-indigo-400/60">Leyendo el historial de movimientos (puede tardar)…</p>}
                  {errorRodados && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{errorRodados}</p>}
                  {rodadosSectores && !loadingRodados && (
                    <>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {[
                          { key: "adrogue", label: "🏠 Rodados Adrogué" },
                          { key: "temperley", label: "🏠 Rodados Temperley" },
                          { key: "sinClasificar", label: "❓ Sin clasificar" },
                        ].map(({ key, label }) => {
                          const sector = rodadosSectores.sectores?.[key];
                          return (
                            <div key={key} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-800">
                              <p className="text-xs font-bold text-slate-700 dark:text-neutral-300">{label}</p>
                              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{sector?.total ?? 0}</p>
                              {(sector?.items || []).length > 0 && (
                                <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500 dark:text-neutral-400">
                                  {sector.items.map((it) => (
                                    <li key={it.sku}>{it.name}: {it.stockActual}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {rodadosSectores.stockTotalReal != null && (
                        <p className="mt-2 text-[11px] text-slate-500 dark:text-neutral-400">
                          Stock real en Contabilium: {rodadosSectores.stockTotalReal} · leído de {rodadosSectores.totalFilasLeidas} movimientos históricos.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">🎥 Auditoría de stock</p>
                  <button
                    onClick={() => setRecorderOpen(true)}
                    className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                  >
                    🎥 Grabar / subir video
                  </button>
                </div>
                {loadingAudits ? (
                  <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">Consultando…</p>
                ) : audits.length === 0 ? (
                  <p className={`mt-1 text-xs font-semibold ${isAuditOverdue(null, auditProgramStart, auditIntervalDays) ? "text-rose-600" : "text-sky-700"}`}>
                    {isAuditOverdue(null, auditProgramStart, auditIntervalDays)
                      ? "Nunca se grabó una auditoría para este depósito y ya se venció el primer plazo."
                      : `Todavía no grabó ninguna auditoría. Primer plazo: ${nextAuditDate(null, auditProgramStart, auditIntervalDays)?.toLocaleDateString("es-AR") || "—"}.`}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                      Última auditoría: {audits[0].createdAt?.toLocaleString("es-AR")} · Próxima:{" "}
                      <span className={isAuditOverdue(audits[0].createdAt, auditProgramStart, auditIntervalDays) ? "font-semibold text-rose-600" : "font-semibold text-slate-700 dark:text-neutral-300"}>
                        {nextAuditDate(audits[0].createdAt, auditProgramStart, auditIntervalDays)?.toLocaleDateString("es-AR")}
                        {isAuditOverdue(audits[0].createdAt, auditProgramStart) ? " (vencida)" : ""}
                      </span>
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {audits.map((a) => (
                        <div key={a.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-800">
                          <button
                            onClick={() => handleDeleteAudit(a)}
                            disabled={deletingAuditId === a.id}
                            title="Eliminar video"
                            className="absolute right-1.5 top-1.5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-rose-600 disabled:opacity-50"
                          >
                            {deletingAuditId === a.id ? "…" : "🗑️"}
                          </button>
                          <AuditVideoPlayer audit={a} videoClassName="aspect-[3/4] w-full bg-black object-cover" className="px-2 pt-1" />
                          <p className="px-2 py-1 text-[11px] text-slate-500 dark:text-neutral-400">
                            {a.createdAt?.toLocaleString("es-AR")}
                            {a.distributorName ? ` · ${a.distributorName}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {!loadingItems && !error && items && (
                <>
                  <AjusteStockPanel depositoId={selected.id} items={items} onAjustado={reloadItems} />
                  <TransferirStockPanel
                    depositoOrigenId={selected.id}
                    depositoOrigenNombre={selected.nombre}
                    items={items}
                    depositos={depositos}
                    onTransferido={reloadItems}
                  />
                </>
              )}

              {loadingItems && (
                <LoadingOverlay
                  label="Consultando Contabilium…"
                  className="rounded-[inherit] border border-slate-200 bg-white/90 text-slate-600"
                  labelClassName="text-slate-500"
                />
              )}

              {!loadingItems && error && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                  {error}
                </div>
              )}

              {!loadingItems && !error && items && items.length > 0 && (
                <>
                  <input
                    type="search"
                    placeholder="Buscar por bicicleta, color o SKU..."
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500 sm:py-2.5"
                  />
                  {modelosGrilla.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {modelosGrilla.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setFiltroModeloGrilla((prev) => (prev === m ? null : m))}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                            filtroModeloGrilla === m
                              ? "bg-slate-900 text-white dark:bg-neutral-700"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {!loadingItems && !error && items && conStock.length === 0 && !itemSearch && (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400 sm:p-10">
                  Este distribuidor no tiene stock disponible ahora mismo.
                </div>
              )}

              {!loadingItems && !error && items && items.length > 0 && itemSearch && filteredItems.length === 0 && (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400 sm:p-10">
                  No encontramos resultados para "{itemSearch}".
                </div>
              )}

              {!loadingItems && !error && bicis.length > 0 && (
                <div className="mt-6">
                  <StatsBanner
                    title="Bicicletas consignadas"
                    totalBicicletas={totalBicicletas}
                    totalDebido={totalDebido}
                    money={money}
                    cuentaCorrienteHref={`/admin/clientes-360?buscar=${encodeURIComponent(selected?.nombre || "")}`}
                  />
                  <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                    {bicis.map((item) => (
                      <li key={item.id || item.sku}>
                        <BikeCard item={item} onSelect={() => setSelectedItem(item)} money={money} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!loadingItems && !error && accesorios.length > 0 && (
                <div className="mt-10">
                  <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Accesorios</h3>
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {accesorios.map((item) => (
                      <li
                        key={item.id || item.sku}
                        onClick={() => setSelectedItem(item)}
                        className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none"
                      >
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50 dark:bg-neutral-800">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} className="h-full w-full object-contain p-1.5" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[9px] text-slate-400 dark:text-neutral-500">Sin imagen</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 dark:text-white">{item.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">SKU: {item.sku}</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-600">
                            {item.stockDisponible} disponible{item.stockDisponible === 1 ? "" : "s"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ItemModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        money={money}
        onAjustarStock={
          selected
            ? ({ sku, cantidad, tipoModificacion }) =>
                ajustarStockManual({ depositoId: selected.id, sku, cantidad, tipoModificacion })
            : undefined
        }
      />
      <AuditRecorderModal open={recorderOpen} onClose={() => setRecorderOpen(false)} onSubmit={handleSubmitAudit} />
    </div>
  );
}

// Panel siempre visible (no hay que entrar a cada bici) para ajustar stock
// en Contabilium — incluye productos en 0 unidades, que no aparecen en la
// grilla principal (esa solo muestra lo disponible).
function AjusteStockPanel({ depositoId, items, onAjustado }) {
  const [query, setQuery] = useState("");
  const [filtroModeloBusqueda, setFiltroModeloBusqueda] = useState("todos");
  const [producto, setProducto] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [tipo, setTipo] = useState("M");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [idCC, setIdCC] = useState("");
  const [pideIdCC, setPideIdCC] = useState(false);
  const [observacion, setObservacion] = useState("");
  const [probando, setProbando] = useState(false);
  const [resultadosProbe, setResultadosProbe] = useState(null);

  async function probarIdCC() {
    setProbando(true);
    setResultadosProbe(null);
    try {
      const { resultados } = await debugProbeIdCC(depositoId);
      setResultadosProbe(resultados);
    } catch (e) {
      setResultadosProbe([{ error: e.message }]);
    } finally {
      setProbando(false);
    }
  }

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Con un modelo elegido (Bowie/Shonen/Gozen/3.0/2.0) se muestran TODAS
    // sus variantes (talle/color) ordenadas por talle, sin el tope de 8 — es
    // justo lo que hace falta para elegir rápido una talla puntual sin tener
    // que escribir nada. El texto libre, si hay, sigue acotando adentro de
    // ese modelo.
    if (filtroModeloBusqueda !== "todos") {
      const delModelo = items.filter((it) => extraerModelo(it.name) === filtroModeloBusqueda);
      const filtradas = q
        ? delModelo.filter((it) => (it.name || "").toLowerCase().includes(q) || (it.sku || "").toLowerCase().includes(q))
        : delModelo;
      return ordenarPorModeloYTalle(filtradas);
    }
    if (!q) return [];
    return items
      .filter((it) => (it.name || "").toLowerCase().includes(q) || (it.sku || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, query, filtroModeloBusqueda]);

  function elegir(item) {
    setProducto(item);
    setQuery("");
    setFiltroModeloBusqueda("todos");
    setCantidad(1);
    setTipo("M");
    setObservacion("");
    setOk(false);
    setError("");
    setPideIdCC(false);
    setIdCC("");
  }

  async function confirmar() {
    setEnviando(true);
    setError("");
    try {
      await ajustarStockManual({
        depositoId,
        sku: producto.sku,
        cantidad,
        tipoModificacion: tipo,
        idCC: idCC.trim() ? Number(idCC.trim()) : null,
        observaciones: observacion.trim() || undefined,
      });
      setOk(true);
      onAjustado?.();
    } catch (e) {
      const msg = e.message || "No se pudo ajustar el stock";
      // El backend pide el idCC solo la primera vez por depósito — después
      // queda recordado en Firestore y no vuelve a hacer falta.
      if (/idCC/i.test(msg)) setPideIdCC(true);
      setError(msg);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
      <p className="text-base font-bold text-slate-900 dark:text-white">⚙️ Corregir stock</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
        Usalo cuando el stock real no coincide con Contabilium (una unidad rota, una que apareció, un recuento).
      </p>

      {!producto ? (
        <div className="relative mt-4">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Paso 1 · Buscá la bici</p>

          {/* Filtro por modelo — elegir uno (ej. "Samurai 2.0") muestra todas
              sus variantes ordenadas por talle, sin tener que escribir nada. */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {MODELOS_FILTRO.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFiltroModeloBusqueda(m.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  filtroModeloBusqueda === m.id
                    ? "bg-amber-600 text-white"
                    : "border border-amber-200 bg-white text-amber-700 hover:border-amber-400 dark:border-amber-900/50 dark:bg-neutral-900 dark:text-amber-300"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={filtroModeloBusqueda === "todos" ? "Escribí el nombre o el código…" : "Filtrar adentro de este modelo (opcional)…"}
            className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-base text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40 dark:border-amber-900/50 dark:bg-neutral-900 dark:text-white"
          />
          {resultados.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-amber-200 bg-white shadow-lg dark:border-amber-900/50 dark:bg-neutral-900">
              {resultados.map((it) => (
                <li key={it.id || it.sku}>
                  <button
                    type="button"
                    onClick={() => elegir(it)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  >
                    <span className="text-slate-700 dark:text-neutral-200">
                      {filtroModeloBusqueda !== "todos" && (
                        <span className="mr-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          {extraerTalle(it.name) || "—"}
                        </span>
                      )}
                      {it.name} <span className="text-slate-400">· SKU {it.sku}</span>
                    </span>
                    <span className={Number(it.stockActual || 0) > 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-500"}>
                      {Number(it.stockActual || 0)} u.
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white p-3 dark:border-amber-900/50 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{producto.name}</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                SKU {producto.sku} · Stock actual: {Number(producto.stockActual || 0)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setProducto(null)}
              className="shrink-0 text-xs text-slate-400 hover:text-amber-600 dark:text-neutral-500"
            >
              Cambiar
            </button>
          </div>

          {ok ? (
            <div className="mt-3 rounded-xl bg-emerald-50 p-4 text-center dark:bg-emerald-950/20">
              <p className="text-2xl">✅</p>
              <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">¡Listo! El stock ya quedó corregido.</p>
            </div>
          ) : (
            <>
              <p className="mt-4 mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Paso 2 · ¿Qué pasó?</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setTipo("M")}
                  className={`flex-1 rounded-xl border-2 px-4 py-3 text-left text-sm transition ${
                    tipo === "M" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span className="block text-base font-bold">➕➖ Sumar o restar unidades</span>
                  <span className="mt-0.5 block text-xs opacity-80">Ej: llegó 1 unidad más → poné 1. Se rompió 1 → poné -1.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTipo("R")}
                  className={`flex-1 rounded-xl border-2 px-4 py-3 text-left text-sm transition ${
                    tipo === "R" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span className="block text-base font-bold">🎯 Poner el número exacto</span>
                  <span className="mt-0.5 block text-xs opacity-80">Ej: contaste 5 bicis reales → poné 5, sin importar cuánto decía antes.</span>
                </button>
              </div>

              <p className="mt-4 mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Paso 3 · {tipo === "R" ? "¿En cuánto lo dejamos?" : "¿Cuántas unidades?"}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCantidad((c) => c - 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-xl font-bold text-slate-700 hover:bg-slate-200 dark:bg-neutral-800 dark:text-white"
                >
                  −
                </button>
                <input
                  type="number"
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value) || 0)}
                  className="w-20 rounded-xl border border-amber-200 bg-white px-2 py-2 text-center text-xl font-bold text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40 dark:border-amber-900/50 dark:bg-neutral-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setCantidad((c) => c + 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-xl font-bold text-slate-700 hover:bg-slate-200 dark:bg-neutral-800 dark:text-white"
                >
                  +
                </button>
                {tipo === "M" && (
                  <span className="text-xs text-slate-400 dark:text-neutral-500">(número negativo = resta)</span>
                )}
              </div>

              {pideIdCC && (
                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-100/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Primera vez que ajustás este depósito — hace falta un código único (se guarda solo, no lo vas a tener que poner de nuevo).
                  </p>
                  <input
                    type="text"
                    value={idCC}
                    onChange={(e) => setIdCC(e.target.value)}
                    placeholder="ej: 1135354"
                    className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40 dark:border-amber-800 dark:bg-neutral-900 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={probando}
                    onClick={probarIdCC}
                    className="mt-2 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {probando ? "Buscando…" : "🔍 Buscar automático (avanzado)"}
                  </button>
                  {resultadosProbe && (
                    <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-slate-900 p-2 text-[10px] text-slate-100">
                      {JSON.stringify(resultadosProbe, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              <div className="mt-4">
                <label className="text-xs font-medium text-slate-500">Nota (opcional — queda anotada en Contabilium)</label>
                <input
                  type="text"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="ej: unidad rota, recuento físico, etc."
                  className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40 dark:border-amber-900/50 dark:bg-neutral-900 dark:text-white"
                />
              </div>

              <button
                type="button"
                disabled={enviando}
                onClick={confirmar}
                className="mt-4 w-full rounded-xl bg-amber-600 py-3 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-amber-700 disabled:opacity-60"
              >
                {enviando ? "Ajustando…" : "✓ Confirmar"}
              </button>
              {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Transferencia real de stock entre depósitos — no pide idCC, es automática
// desde la primera vez.
function TransferirStockPanel({ depositoOrigenId, depositoOrigenNombre, items, depositos, onTransferido }) {
  const { user: authUser, profile: authProfile } = useAuth();
  const [destinoId, setDestinoId] = useState("");
  // Viaje que se carga solo en la grilla de logística de Julián al mover
  // la mercadería (se puede destildar si el movimiento no lleva chofer).
  const [viajeCfg, setViajeCfg] = useState(viajeCfgInicial);
  const [viajeId, setViajeId] = useState(null);
  const [viajeError, setViajeError] = useState("");
  const [query, setQuery] = useState("");
  const [productoElegido, setProductoElegido] = useState(null); // producto seleccionado, antes de agregar al carrito
  const [cantidadElegida, setCantidadElegida] = useState(1);
  const [carrito, setCarrito] = useState([]); // [{sku, name, cantidad, stockActual}]
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [remitoArchivo, setRemitoArchivo] = useState(null);
  const [remitoPdfBase64, setRemitoPdfBase64] = useState(null);

  // Remito "real" (a nombre de un proveedor elegido, para circular en la
  // calle) — paso aparte y explícito, después de que el movimiento ya se
  // confirmó, porque necesita un cliente real (no funciona con FEPA TOP).
  const [remitoRealAbierto, setRemitoRealAbierto] = useState(false);
  const [generandoRemitoReal, setGenerandoRemitoReal] = useState(false);
  const [remitoRealError, setRemitoRealError] = useState("");
  const [remitoRealNumero, setRemitoRealNumero] = useState(null);
  const [remitoRealArchivo, setRemitoRealArchivo] = useState(null);
  const [remitoRealPdfBase64, setRemitoRealPdfBase64] = useState(null);
  const [incluirMercaderiaConsig, setIncluirMercaderiaConsig] = useState(false);

  // Proveedor del remito: por defecto se detecta solo (el cliente
  // vinculado al depósito destino), pero se puede buscar y elegir otro a
  // mano — para los casos donde el depósito no tiene cliente vinculado, o
  // vino vinculado mal.
  const [proveedorAutoDetectado, setProveedorAutoDetectado] = useState(undefined); // undefined = sin buscar, null = buscó y no encontró
  const [proveedorElegido, setProveedorElegido] = useState(null); // override manual — null = usar el auto-detectado
  const [proveedorQuery, setProveedorQuery] = useState("");
  const [proveedorResultados, setProveedorResultados] = useState([]);
  const [proveedorBuscando, setProveedorBuscando] = useState(false);
  const [mostrarBuscadorProveedor, setMostrarBuscadorProveedor] = useState(false);

  useEffect(() => {
    setProveedorElegido(null);
    setMostrarBuscadorProveedor(false);
    if (!destinoId) {
      setProveedorAutoDetectado(undefined);
      return;
    }
    let cancelled = false;
    setProveedorAutoDetectado(undefined);

    // FEPA TOP es la propia empresa (el emisor), no está cargada como
    // "cliente" en Contabilium — no se puede buscar/elegir como tal. Si el
    // depósito destino no tiene un cliente vinculado, no dejamos el campo
    // en blanco: mostramos FEPA TOP como default (sin contabiliumId, así
    // el backend no fuerza ningún cliente y cae solo al remito estándar,
    // que en Contabilium ya queda a nombre de la empresa) y se puede
    // cambiar a mano con "Cambiar" igual que un proveedor detectado.
    const FEPA_TOP_DEFAULT = { contabiliumId: null, razonSocial: "FEPA TOP (remito estándar, sin cliente)" };

    getDocs(fsQuery(collection(db, "users"), where("contabiliumDepositoId", "==", Number(destinoId))))
      .then((snap) => {
        if (cancelled) return;
        if (snap.empty) {
          setProveedorAutoDetectado(FEPA_TOP_DEFAULT);
          return;
        }
        const u = snap.docs[0].data();
        if (!u.contabiliumId) {
          setProveedorAutoDetectado(FEPA_TOP_DEFAULT);
          return;
        }
        setProveedorAutoDetectado({ contabiliumId: u.contabiliumId, razonSocial: u.contabiliumDepositoNombre || u.name || "" });
      })
      .catch(() => {
        if (!cancelled) setProveedorAutoDetectado(FEPA_TOP_DEFAULT);
      });
    return () => {
      cancelled = true;
    };
  }, [destinoId]);

  useEffect(() => {
    const q = proveedorQuery.trim();
    if (q.length < 3) {
      setProveedorResultados([]);
      return;
    }
    let cancelled = false;
    setProveedorBuscando(true);
    const timer = setTimeout(() => {
      searchContabiliumClientes(q)
        .then((r) => {
          if (!cancelled) setProveedorResultados(r.resultados || []);
        })
        .catch(() => {
          if (!cancelled) setProveedorResultados([]);
        })
        .finally(() => {
          if (!cancelled) setProveedorBuscando(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [proveedorQuery]);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((it) => Number(it.stockActual || 0) > 0)
      .filter((it) => !carrito.some((c) => c.sku === it.sku))
      .filter((it) => (it.name || "").toLowerCase().includes(q) || (it.sku || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, query, carrito]);

  const destinosDisponibles = useMemo(
    () => depositos.filter((d) => d.id !== depositoOrigenId),
    [depositos, depositoOrigenId]
  );

  function elegirProducto(item) {
    setProductoElegido(item);
    setCantidadElegida(1);
    setQuery("");
  }

  // Suma 1 unidad directo a la lista sin pasar por la pantalla de elegir
  // cantidad — para el caso común de agregar de a una bici por vez rápido.
  // Si ya está en la lista, le suma 1 a la cantidad existente en vez de
  // duplicar la fila.
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

  function agregarAlCarrito() {
    if (!productoElegido) return;
    setCarrito((prev) => [
      ...prev,
      { sku: productoElegido.sku, name: productoElegido.name, cantidad: cantidadElegida, stockActual: productoElegido.stockActual },
    ]);
    setProductoElegido(null);
    setCantidadElegida(1);
  }

  function quitarDelCarrito(sku) {
    setCarrito((prev) => prev.filter((c) => c.sku !== sku));
  }

  function cambiarCantidadCarrito(sku, delta) {
    setCarrito((prev) =>
      prev.map((c) => {
        if (c.sku !== sku) return c;
        const nueva = Math.max(1, Math.min(c.cantidad + delta, Number(c.stockActual || c.cantidad + delta)));
        return { ...c, cantidad: nueva };
      })
    );
  }

  function reiniciar() {
    setDestinoId("");
    setCarrito([]);
    setProductoElegido(null);
    setObservacion("");
    setOk(false);
    setRemitoArchivo(null);
    setRemitoPdfBase64(null);
    setRemitoRealAbierto(false);
    setRemitoRealError("");
    setRemitoRealNumero(null);
    setRemitoRealArchivo(null);
    setRemitoRealPdfBase64(null);
    setProveedorElegido(null);
    setProveedorQuery("");
    setProveedorResultados([]);
    setViajeCfg(viajeCfgInicial());
    setViajeId(null);
    setViajeError("");
    setError("");
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

  async function confirmar() {
    setEnviando(true);
    setError("");
    try {
      const result = await transferirStockManual({
        depositoOrigenId,
        depositoDestinoId: Number(destinoId),
        items: carrito.map((c) => ({ sku: c.sku, cantidad: c.cantidad, name: c.name })),
        observaciones: observacion.trim() || undefined,
        depositoOrigenNombre,
        depositoDestinoNombre: destinosDisponibles.find((d) => d.id === Number(destinoId))?.nombre,
      });
      setRemitoArchivo(result.remitoArchivo || null);
      setRemitoPdfBase64(result.remitoPdfBase64 || null);
      setOk(true);
      onTransferido?.();
      if (viajeCfg.cargar) {
        // El stock ya se movió — si el viaje falla no se deshace nada, solo
        // se avisa para cargarlo a mano desde la grilla.
        try {
          const id = await crearViajeDesdeTransferencia({
            origen: { id: depositoOrigenId, nombre: depositoOrigenNombre },
            destino: {
              id: Number(destinoId),
              nombre: destinosDisponibles.find((d) => d.id === Number(destinoId))?.nombre,
            },
            fecha: viajeCfg.fecha,
            turno: viajeCfg.turno,
            horaSalida: viajeCfg.hora,
            remitoArchivo: result.remitoArchivo,
            pdfBase64: result.remitoPdfBase64,
            notas: observacion.trim(),
            chofer: viajeCfg.choferUid ? { uid: viajeCfg.choferUid, nombre: viajeCfg.choferNombre } : null,
            actor: { uid: authUser?.uid || "", nombre: authProfile?.name || authUser?.email || null },
          });
          setViajeId(id);
        } catch (errViaje) {
          setViajeError(errViaje.message || "No se pudo cargar el viaje en la grilla");
        }
      }
    } catch (e) {
      setError(e.message || "No se pudo transferir el stock");
    } finally {
      setEnviando(false);
    }
  }

  async function generarRemitoReal(archivoOverride) {
    // El remito real se arma reasignando el cliente al remito interno que ya
    // generó el movimiento — no crea un comprobante nuevo (eso rompía la
    // numeración). Se pasa `archivoOverride` desde confirmarSoloRemito
    // porque justo ahí el estado `remitoArchivo` todavía no se actualizó
    // (setState es async) cuando se llama en la misma función.
    const archivo = archivoOverride || remitoArchivo;
    const proveedor = proveedorElegido || proveedorAutoDetectado;
    if (!proveedor?.contabiliumId) {
      setRemitoRealError("Elegí un cliente real (no FEPA TOP) para poder generar este remito.");
      return false;
    }
    if (!archivo) {
      setRemitoRealError("Todavía no hay un remito interno generado para reasignar.");
      return false;
    }
    setGenerandoRemitoReal(true);
    setRemitoRealError("");
    try {
      const result = await generarRemitoRealManual({
        remitoArchivo: archivo,
        proveedorContabiliumId: proveedor.contabiliumId,
        observaciones: observacion.trim() || undefined,
        incluirMercaderiaConsignacion: incluirMercaderiaConsig,
      });
      setRemitoRealNumero(result.numero);
      setRemitoRealArchivo(result.remitoArchivo);
      setRemitoRealPdfBase64(result.remitoPdfBase64);
      if (viajeId) {
        // El viaje pasa a mostrar el remito real (a nombre del cliente).
        actualizarRemitoViaje(viajeId, {
          numero: result.numero || numeroDeRemito(result.remitoArchivo),
          archivo: result.remitoArchivo || null,
          pdfBase64: result.remitoPdfBase64 || null,
        }).catch(() => {});
      }
      return true;
    } catch (e) {
      setRemitoRealError(e.message || "No se pudo generar el remito real");
      return false;
    } finally {
      setGenerandoRemitoReal(false);
    }
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
      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
        <div className="rounded-xl bg-emerald-50 p-4 text-center dark:bg-emerald-950/20">
          <p className="text-2xl">✅</p>
          <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">¡Listo! Ya se movió el stock.</p>
          {remitoArchivo && (
            <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
              📄 Remito interno: <span className="font-medium">{remitoArchivo}</span>
            </p>
          )}
          {remitoPdfBase64 ? (
            <button
              type="button"
              onClick={descargarPdf}
              className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              ⬇️ Descargar remito interno (PDF)
            </button>
          ) : remitoArchivo ? (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
              (No se pudo traer el PDF automático — buscalo en Contabilium, en "Remitos y Cobranza")
            </p>
          ) : null}

          {viajeId && (
            <p className="mt-2 text-xs font-medium text-sky-700 dark:text-sky-400">🚚 Viaje cargado en la grilla de Julián</p>
          )}
          {viajeError && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">⚠️ {viajeError} — cargalo a mano desde la grilla de logística.</p>}

          <div>
            <button type="button" onClick={reiniciar} className="mt-4 text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
              Hacer otra transferencia
            </button>
          </div>
        </div>

        {remitoRealNumero ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">
              📄 Remito real: <span className="font-medium">{remitoRealNumero}</span>
            </p>
            {remitoRealPdfBase64 ? (
              <button
                type="button"
                onClick={descargarPdfReal}
                className="mt-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                ⬇️ Descargar remito real (PDF)
              </button>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
                (No se pudo traer el PDF automático — buscalo en Contabilium, en "Remitos y Cobranza")
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3">
            {!remitoRealAbierto ? (
              <button
                type="button"
                onClick={() => setRemitoRealAbierto(true)}
                className="w-full rounded-xl border border-sky-300 bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-400"
              >
                📄 Hacer remito real (para circular en la calle)
              </button>
            ) : (
              <div className="rounded-xl border border-sky-200 bg-white p-3 text-left text-xs dark:border-sky-900/50 dark:bg-neutral-900">
                <p className="font-semibold text-slate-700 dark:text-neutral-300">
                  Con las mismas {carrito.reduce((acc, c) => acc + c.cantidad, 0)} bici(s) de esta transferencia, a nombre de:
                </p>
                {proveedorElegido ? (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-slate-600 dark:text-neutral-400">{proveedorElegido.razonSocial}</span>
                    <button
                      type="button"
                      onClick={() => setProveedorElegido(null)}
                      className="whitespace-nowrap font-medium text-sky-600 hover:underline dark:text-sky-400"
                    >
                      Usar el detectado solo
                    </button>
                  </div>
                ) : proveedorAutoDetectado?.contabiliumId ? (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-slate-600 dark:text-neutral-400">
                      ✓ {proveedorAutoDetectado.razonSocial} <span className="text-slate-400">(detectado solo)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setMostrarBuscadorProveedor((v) => !v)}
                      className="whitespace-nowrap font-medium text-sky-600 hover:underline dark:text-sky-400"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-amber-600 dark:text-amber-400">
                    ⚠️ Este depósito no tiene un cliente vinculado — buscá uno real abajo (el remito real necesita un cliente,
                    no puede ser a nombre de FEPA TOP).
                  </p>
                )}
                {(mostrarBuscadorProveedor || (!proveedorAutoDetectado?.contabiliumId && !proveedorElegido)) && (
                  <>
                    <input
                      type="text"
                      placeholder="Buscar cliente por nombre o CUIT…"
                      value={proveedorQuery}
                      onChange={(e) => setProveedorQuery(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                    />
                    {proveedorBuscando && <p className="mt-1 text-slate-400 dark:text-neutral-500">Buscando…</p>}
                    {proveedorResultados.length > 0 && (
                      <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-100 dark:border-neutral-800">
                        {proveedorResultados.map((r) => (
                          <button
                            key={r.contabiliumId}
                            type="button"
                            onClick={() => {
                              setProveedorElegido({ contabiliumId: r.contabiliumId, razonSocial: r.razonSocial });
                              setProveedorQuery("");
                              setProveedorResultados([]);
                              setMostrarBuscadorProveedor(false);
                            }}
                            className="block w-full px-2.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-neutral-800"
                          >
                            {r.razonSocial} {r.cuit ? `— CUIT ${r.cuit}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <label className="mt-3 block text-slate-500 dark:text-neutral-400">Observaciones (opcional)</label>
                <input
                  type="text"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />

                <label className="mt-3 flex items-center gap-2 text-slate-600 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={incluirMercaderiaConsig}
                    onChange={(e) => setIncluirMercaderiaConsig(e.target.checked)}
                  />
                  Incluir "MERCADERÍA EN CONSIGNACIÓN" en la observación
                </label>

                <button
                  type="button"
                  disabled={generandoRemitoReal}
                  onClick={() => generarRemitoReal()}
                  className="mt-3 w-full rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {generandoRemitoReal ? "Generando…" : "✓ Generar remito real"}
                </button>
                {remitoRealError && <p className="mt-2 text-rose-500">{remitoRealError}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <p className="text-base font-bold text-slate-900 dark:text-white">🔁 Mandar stock a otro depósito</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
        Mueve bicicletas de <strong>{depositoOrigenNombre}</strong> hacia otro distribuidor o depósito. Se genera el remito solo.
      </p>

      <p className="mt-4 mb-1.5 text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Paso 1 · ¿A qué depósito va?</p>
      <select
        value={destinoId}
        onChange={(e) => setDestinoId(e.target.value)}
        className="w-full rounded-xl border border-sky-200 bg-white px-4 py-3 text-base text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-sky-900/50 dark:bg-neutral-900 dark:text-white"
      >
        <option value="">Elegí un depósito…</option>
        {destinosDisponibles.map((d) => (
          <option key={d.id} value={d.id}>
            {labelDeposito(d)}
          </option>
        ))}
      </select>

      <p className="mt-3 text-[11px] text-slate-400 dark:text-neutral-500">
        El cliente para el remito "real" (para circular en la calle) se elige después, una vez que el movimiento ya se
        confirmó.
      </p>

      <p className="mt-4 mb-1.5 text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Paso 2 · Agregá las bicis</p>

      {carrito.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {carrito.map((c) => (
            <li key={c.sku} className="flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm dark:border-sky-900/50 dark:bg-neutral-900">
              <span className="min-w-0 truncate text-slate-700 dark:text-neutral-200">{c.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => cambiarCantidadCarrito(c.sku, -1)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-neutral-800 dark:text-white"
                >
                  −
                </button>
                <span className="w-5 text-center font-bold">{c.cantidad}</span>
                <button
                  type="button"
                  onClick={() => cambiarCantidadCarrito(c.sku, 1)}
                  disabled={c.cantidad >= Number(c.stockActual || 0)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:bg-neutral-800 dark:text-white"
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

      {!productoElegido ? (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-sky-600 text-base font-bold text-white">
            +
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={carrito.length > 0 ? "Agregar otra bici a la lista…" : "Buscá una bici para agregar…"}
            className="w-full rounded-xl border border-sky-200 bg-white py-3 pl-12 pr-4 text-base text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-sky-900/50 dark:bg-neutral-900 dark:text-white"
          />
          {resultados.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-sky-200 bg-white shadow-lg dark:border-sky-900/50 dark:bg-neutral-900">
              {resultados.map((it) => (
                <li key={it.id || it.sku} className="flex items-center gap-1 px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => elegirProducto(it)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs hover:bg-sky-50 dark:hover:bg-sky-950/30"
                  >
                    <span className="min-w-0 truncate text-slate-700 dark:text-neutral-200">
                      {it.name} <span className="text-slate-400">· SKU {it.sku}</span>
                    </span>
                    <span className="shrink-0 font-semibold text-emerald-600">{Number(it.stockActual || 0)} u.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => agregarUnaUnidad(it)}
                    title="Agregar 1 unidad directo a la lista"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white hover:bg-sky-700"
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-sky-200 bg-white p-3 dark:border-sky-900/50 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{productoElegido.name}</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400">Hay {Number(productoElegido.stockActual || 0)} disponibles</p>
            </div>
            <button type="button" onClick={() => setProductoElegido(null)} className="shrink-0 text-xs text-slate-400 hover:text-sky-600 dark:text-neutral-500">
              Cancelar
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCantidadElegida((c) => Math.max(1, c - 1))}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-700 hover:bg-slate-200 dark:bg-neutral-800 dark:text-white"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={Number(productoElegido.stockActual || 0)}
              value={cantidadElegida}
              onChange={(e) => setCantidadElegida(Number(e.target.value) || 0)}
              className="w-16 rounded-xl border border-sky-200 bg-white px-2 py-1.5 text-center text-lg font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-sky-900/50 dark:bg-neutral-900 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setCantidadElegida((c) => Math.min(Number(productoElegido.stockActual || 1), c + 1))}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-700 hover:bg-slate-200 dark:bg-neutral-800 dark:text-white"
            >
              +
            </button>
            <button
              type="button"
              disabled={cantidadElegida < 1 || cantidadElegida > Number(productoElegido.stockActual || 0)}
              onClick={agregarAlCarrito}
              className="ml-auto rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              + Agregar a la lista
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <label className="text-xs font-medium text-slate-500">Nota (opcional)</label>
        <input
          type="text"
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
          placeholder="ej: redistribución entre distribuidores"
          className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-sky-900/50 dark:bg-neutral-900 dark:text-white"
        />
        <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
          Al confirmar se genera el remito solo, con todas las bicis de la lista, y esta nota queda anotada ahí automáticamente.
        </p>
      </div>

      <CargarViajeCampos value={viajeCfg} onChange={setViajeCfg} />

      <button
        type="button"
        disabled={enviando || !destinoId || carrito.length === 0}
        onClick={confirmar}
        className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-sky-700 disabled:opacity-60"
      >
        {enviando ? "Transfiriendo…" : `✓ Confirmar transferencia${carrito.length ? ` (${carrito.length} producto${carrito.length === 1 ? "" : "s"})` : ""}`}
      </button>
      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
    </div>
  );
}
