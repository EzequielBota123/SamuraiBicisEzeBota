import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getContabiliumDepositos } from "../../services/contabiliumDepositos";
import { getDepositoStockAdmin } from "../../services/comprobantes";
import { LoadingOverlay } from "../../components/ui/LoadingIndicators";
import { filterBySearch } from "../../utils/colorSearch";
import { StatsBanner, BikeCard, ItemModal } from "../../components/stock/ConsignedStockUI";
import { listAuditsByDeposito, deleteAudit, uploadAudit, nextAuditDate, isAuditOverdue, getAuditProgramStart } from "../../services/stockAudits";
import AuditVideoPlayer from "../../components/stock/AuditVideoPlayer";
import AuditRecorderModal from "../../components/stock/AuditRecorderModal";
import { useAuth } from "../../auth/AuthContext";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function isBici(item) {
  return (item.category || "").toUpperCase() === "BICICLETAS";
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

  useEffect(() => {
    getContabiliumDepositos()
      .then(setDepositos)
      .catch((e) => console.error("Error cargando depósitos:", e))
      .finally(() => setLoadingDepositos(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return depositos;
    return depositos.filter((d) => d.nombre.toLowerCase().includes(q));
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

  const filteredItems = useMemo(() => {
    if (!items) return null;
    return filterBySearch(items, itemSearch);
  }, [items, itemSearch]);

  const bicis = useMemo(() => (filteredItems || []).filter(isBici), [filteredItems]);
  const accesorios = useMemo(() => (filteredItems || []).filter((it) => !isBici(it)), [filteredItems]);

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
    setError("");
    setSelectedItem(null);
    setLoadingItems(true);
    setAudits([]);
    setAuditIntervalDays(undefined);
    setDistributorUid(null);
    setDistributorName(null);
    setLoadingAudits(true);
    try {
      const result = await getDepositoStockAdmin(d.id);
      setItems(result.items);
    } catch (e) {
      setError(e.message || "Error al consultar el stock");
    } finally {
      setLoadingItems(false);
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
      const usersSnap = await getDocs(query(collection(db, "users"), where("contabiliumDepositoId", "==", d.id)));
      const userDoc = usersSnap.docs[0];
      const u = userDoc?.data();
      setAuditIntervalDays(u?.auditIntervalDays);
      setDistributorUid(userDoc?.id || null);
      setDistributorName(u?.contabiliumDepositoNombre || u?.name || d.nombre);
    } catch (e) {
      console.error("Error consultando intervalo de auditoría:", e);
    }
  }

  async function handleSubmitAudit(blob, recordedAt) {
    if (!selected) return;
    await uploadAudit({
      depositoId: selected.id,
      depositoNombre: selected.nombre,
      distributorUid: distributorUid || user.uid,
      distributorName: distributorName || profile?.name || "Samurai (staff)",
      blob,
      recordedAt,
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
            placeholder="Buscar distribuidor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 sm:py-2.5"
          />
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
                {d.nombre}
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
                <input
                  type="search"
                  placeholder="Buscar por bicicleta, color o SKU..."
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500 sm:py-2.5"
                />
              )}

              {!loadingItems && !error && items && items.length === 0 && (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400 sm:p-10">
                  Este distribuidor no tiene stock disponible ahora mismo.
                </div>
              )}

              {!loadingItems && !error && items && items.length > 0 && filteredItems.length === 0 && (
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

      <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} money={money} />
      <AuditRecorderModal open={recorderOpen} onClose={() => setRecorderOpen(false)} onSubmit={handleSubmitAudit} />
    </div>
  );
}
