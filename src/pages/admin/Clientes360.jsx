import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import * as XLSX from "xlsx";
import { addDoc, arrayUnion, collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import { reviewPagoReportado } from "../../services/comprobantes";
import { puedeEditarNotas as puedeEditarNotasCheck } from "../../utils/permisosNotas";
import { subirImagenesNota } from "../../utils/notaImagenes";
import HistorialSeguimiento from "../../components/crm/HistorialSeguimiento";
import ChequeRow from "../../components/crm/ChequeRow";
import { db, auth } from "../../firebase";
import { useAuth } from "../../auth/AuthContext";
import { subscribeCobranzas } from "../../services/cobranzas";
import { nombreBanco, listaBancos } from "../../services/bancos";
import { listAuditsByDeposito, getAuditProgramStart, nextAuditDate, isAuditOverdue, isAuditDueSoon, contarVistas } from "../../services/stockAudits";
import AuditVideoPlayer from "../../components/stock/AuditVideoPlayer";
import { adminGetClientComprobantes, adminGetClientPhone, adminGetComprobanteDetail, getDepositoStockAdmin, adminLinkClientesByCuit, emitirFacturaManual, cobrarComprobante, verificarCondicionAfip, subscribeClientesReportDetail, adminAsignarVendedor } from "../../services/comprobantes";
import { limpiarNombreBici, extraerTalle, extraerModelo } from "../../utils/bikeName";
import { VENDEDORES } from "./Vendedores";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

function formatFecha(s) {
  if (!s) return "-";
  const d = new Date(s.includes("T") ? s : s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("es-AR");
}

function formatFechaHora(s) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  const fecha = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${fecha} · ${hora} hs`;
}


const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function diaKey(d) {
  return d.toISOString().slice(0, 10);
}

// Calendario de notas de seguimiento: agrupa por día todas las entradas del
// historial de todos los clientes (en vivo, viene de `rows` que ya está
// suscripto con onSnapshot) y permite exportar el resumen de un día a Excel.
function CalendarioNotas({ rows, onVerCliente }) {
  const hoy = new Date();
  const [mesVisible, setMesVisible] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [diaSeleccionado, setDiaSeleccionado] = useState(diaKey(hoy));
  const [depositosConVideo, setDepositosConVideo] = useState(null); // Set en vivo, se actualiza solo

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "stockAudits"), (snap) => {
      setDepositosConVideo(new Set(snap.docs.map((d) => String(d.data().depositoId))));
    });
    return unsub;
  }, []);

  // Clientes con depósito consignado que nunca subieron ningún video —
  // en vivo, junto con su estado de seguimiento/CRM actual.
  const sinVideoRows = useMemo(() => {
    if (!depositosConVideo) return [];
    return rows.filter((u) => u.contabiliumDepositoId != null && !depositosConVideo.has(String(u.contabiliumDepositoId)));
  }, [rows, depositosConVideo]);

  const notasPorDia = useMemo(() => {
    const map = new Map();
    for (const u of rows) {
      const historial = u.seguimiento?.historial || [];
      for (const h of historial) {
        const fecha = h.fecha?.toDate?.();
        if (!fecha) continue;
        const key = diaKey(fecha);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ ...h, clienteId: u.id, clienteNombre: u.name || "(sin nombre)", contabiliumId: u.contabiliumId || null });
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.fecha?.toMillis?.() || 0) - (b.fecha?.toMillis?.() || 0));
    return map;
  }, [rows]);

  const primerDiaSemana = new Date(mesVisible.getFullYear(), mesVisible.getMonth(), 1).getDay();
  const diasEnMes = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + 1, 0).getDate();
  const celdas = [];
  for (let i = 0; i < primerDiaSemana; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(new Date(mesVisible.getFullYear(), mesVisible.getMonth(), d));

  const notasDelDia = diaSeleccionado ? notasPorDia.get(diaSeleccionado) || [] : [];
  const [exportando, setExportando] = useState(false);

  async function exportarExcel() {
    setExportando(true);
    try {
      // Trae el saldo real (en vivo, de Contabilium) de cada cliente distinto
      // que aparece ese día — uno por uno, no todos de golpe.
      const idsUnicos = [...new Set(notasDelDia.map((n) => n.contabiliumId).filter(Boolean))];
      const saldoPorId = {};
      for (const id of idsUnicos) {
        try {
          const r = await adminGetClientComprobantes(id);
          saldoPorId[id] = r.saldoTotal ?? null;
        } catch {
          saldoPorId[id] = null;
        }
      }

      const filas = notasDelDia.map((n) => {
        const saldo = n.contabiliumId != null ? saldoPorId[n.contabiliumId] : null;
        return {
          Cliente: n.clienteNombre,
          Hora: n.fecha?.toDate ? n.fecha.toDate().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "",
          "Saldo actual": saldo == null ? "s/dato" : money(saldo),
          Situación: saldo == null ? "" : saldo > 0 ? "Debe" : saldo < 0 ? "A favor" : "Al día",
          Contactado: n.contactado ? "Sí" : "No",
          "Cuenta coincide": n.cuentaCoincide === true ? "Sí" : n.cuentaCoincide === false ? "No" : "",
          Nota: n.notas || "",
          "Tarea pendiente": n.tareaPendiente || "",
          "Cargado por": n.contactadoPor || "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(filas);
      ws["!cols"] = [{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 50 }, { wch: 35 }, { wch: 28 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Notas del día");

      // Segunda hoja: clientes que nunca subieron video, con su estado de CRM
      // (en vivo — refleja lo que hay en Firestore en el momento de exportar).
      const filasSinVideo = sinVideoRows
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .map((u) => {
          const seg = u.seguimiento || {};
          return {
            Cliente: u.contabiliumDepositoNombre || u.name || "(sin nombre)",
            CUIT: u.cuit || "",
            Contactado: seg.contactado ? "Sí" : "No",
            "Cuenta coincide": seg.cuentaCoincide === true ? "Sí" : seg.cuentaCoincide === false ? "No" : "",
            "Última nota": seg.notas || "",
            "Tarea pendiente": seg.tareaPendiente || "",
            "Cargado por": seg.contactadoPor || "",
            "Últ. actualización": seg.fecha?.toDate ? formatFechaHora(seg.fecha.toDate().toISOString()) : "",
            "Cant. notas": (seg.historial || []).length,
          };
        });
      const wsSinVideo = XLSX.utils.json_to_sheet(filasSinVideo);
      wsSinVideo["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 50 }, { wch: 35 }, { wch: 28 }, { wch: 20 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, wsSinVideo, "Sin video");

      XLSX.writeFile(wb, `Notas_Samurai_${diaSeleccionado}.xlsx`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMesVisible(new Date(mesVisible.getFullYear(), mesVisible.getMonth() - 1, 1))}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:border-sky-400 dark:border-neutral-700 dark:text-neutral-400"
          >
            ‹
          </button>
          <p className="w-40 text-center text-sm font-semibold text-slate-900 dark:text-white">
            {MESES[mesVisible.getMonth()]} {mesVisible.getFullYear()}
          </p>
          <button
            onClick={() => setMesVisible(new Date(mesVisible.getFullYear(), mesVisible.getMonth() + 1, 1))}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:border-sky-400 dark:border-neutral-700 dark:text-neutral-400"
          >
            ›
          </button>
        </div>
        <p className="text-xs text-slate-400 dark:text-neutral-500">Se actualiza solo — datos en vivo</p>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="py-1 text-[11px] font-semibold uppercase text-slate-400 dark:text-neutral-500">
            {d}
          </div>
        ))}
        {celdas.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = diaKey(d);
          const notas = notasPorDia.get(key) || [];
          const esHoy = key === diaKey(hoy);
          const esSeleccionado = key === diaSeleccionado;
          return (
            <button
              key={i}
              onClick={() => setDiaSeleccionado(key)}
              className={`relative flex flex-col items-center justify-center rounded-xl border py-2 text-sm transition ${
                esSeleccionado
                  ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                  : esHoy
                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                  : "border-slate-100 text-slate-600 hover:border-slate-300 dark:border-neutral-800 dark:text-neutral-300"
              }`}
            >
              {d.getDate()}
              {notas.length > 0 && (
                <span className="mt-0.5 rounded-full bg-slate-900 px-1.5 text-[10px] font-bold text-white dark:bg-neutral-600">
                  {notas.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {diaSeleccionado && (
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-neutral-700">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {formatFecha(diaSeleccionado)} — {notasDelDia.length} nota(s)
            </p>
            {notasDelDia.length > 0 && (
              <button
                onClick={exportarExcel}
                disabled={exportando}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {exportando ? "Consultando saldos…" : "📊 Exportar a Excel"}
              </button>
            )}
          </div>
          {notasDelDia.length > 0 && (
            <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">
              El Excel incluye una segunda hoja "Sin video" con los {sinVideoRows.length} clientes que nunca subieron ninguno, en vivo.
            </p>
          )}

          {notasDelDia.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-neutral-500">Sin notas ese día.</p>
          ) : (
            <div className="space-y-2">
              {notasDelDia.map((n, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-800/50">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onVerCliente(n.clienteId)}
                      className="font-semibold text-sky-700 hover:underline dark:text-sky-400"
                    >
                      {n.clienteNombre}
                    </button>
                    <span className="text-xs text-slate-400 dark:text-neutral-500">
                      {n.fecha?.toDate ? n.fecha.toDate().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : ""} hs
                    </span>
                  </div>
                  {n.notas && <p className="mt-1 text-slate-700 dark:text-neutral-300">{n.notas}</p>}
                  {n.tareaPendiente && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">📌 {n.tareaPendiente}</p>
                  )}
                  {(n.imagenes || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {n.imagenes.map((url, j) => (
                        <a key={j} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt="Adjunto" className="h-10 w-10 rounded-lg border border-slate-200 object-cover dark:border-neutral-700" />
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-neutral-500">
                    {n.contactado ? "✓ Contactado" : "Sin contactar"}{n.contactadoPor ? ` · ${n.contactadoPor}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Clientes360() {
  const location = useLocation();
  const [users, setUsers] = useState(null);
  const [cobranzas, setCobranzas] = useState(null);
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get("buscar") || "");
  const [selected, setSelected] = useState(null);
  const [vista, setVista] = useState("lista"); // "lista" | "calendario"
  const [autoOpenIntentado, setAutoOpenIntentado] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkPreview, setLinkPreview] = useState(null);
  const [applying, setApplying] = useState(false);
  const [onlySinContactar, setOnlySinContactar] = useState(false);
  const [onlyDeudores, setOnlyDeudores] = useState(false);
  const [reporteDetail, setReporteDetail] = useState(null);

  async function handlePreviewLinkByCuit() {
    setLinking(true);
    setLinkPreview(null);
    try {
      const preview = await adminLinkClientesByCuit(false);
      setLinkPreview(preview);
    } catch (e) {
      alert(e.message || "No se pudo consultar Contabilium.");
    } finally {
      setLinking(false);
    }
  }

  async function handleApplyLinkByCuit() {
    if (!confirm(`¿Vincular los ${linkPreview.matchedCount} cliente(s) encontrados por CUIT?`)) return;
    setApplying(true);
    try {
      const result = await adminLinkClientesByCuit(true);
      setLinkPreview(null);
      alert(`Listo: ${result.matchedCount} cliente(s) vinculado(s).`);
    } catch (e) {
      alert(e.message || "No se pudo vincular.");
    } finally {
      setApplying(false);
    }
  }

  useEffect(() => {
    const q = query(collection(db, "users"), where("kind", "==", "client"));
    const unsub = onSnapshot(q, (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubCobranzas = subscribeCobranzas(setCobranzas, () => setCobranzas([]));
    const unsubReporte = subscribeClientesReportDetail(setReporteDetail);
    return () => {
      unsub();
      unsubCobranzas();
      unsubReporte();
    };
  }, []);

  // uid -> fila del reporte de clientes (deuda/a favor reales, calculados
  // contra facturas+cobranzas de Contabilium, no solo cobranzas por CUIT).
  const reportePorUid = useMemo(() => {
    const map = new Map();
    for (const r of reporteDetail?.rows || []) map.set(r.uid, r);
    return map;
  }, [reporteDetail]);

  // Total pagado por cliente, cruzando cobranzas (Contabilium) por CUIT.
  // Usa importeReal (excluye reimputaciones de "Saldo a favor", que
  // reasignan plata ya contada en otra cobranza y duplicarían el total).
  const pagadoPorCuit = useMemo(() => {
    const map = new Map();
    for (const c of cobranzas || []) {
      const doc = onlyDigits(c.nroDocumento);
      if (!doc) continue;
      map.set(doc, (map.get(doc) || 0) + Number(c.importeReal ?? c.importeTotal ?? 0));
    }
    return map;
  }, [cobranzas]);

  const cobranzasPorCuit = useMemo(() => {
    const map = new Map();
    for (const c of cobranzas || []) {
      const doc = onlyDigits(c.nroDocumento);
      if (!doc) continue;
      if (!map.has(doc)) map.set(doc, []);
      map.get(doc).push(c);
    }
    for (const list of map.values()) list.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    return map;
  }, [cobranzas]);

  const rows = useMemo(() => {
    if (!users) return [];
    return users
      .map((u) => ({
        ...u,
        pagado: pagadoPorCuit.get(onlyDigits(u.cuit)) || 0,
        cobranzasList: cobranzasPorCuit.get(onlyDigits(u.cuit)) || [],
        linked: !!u.contabiliumId,
        saldoDeudor: reportePorUid.get(u.id)?.saldoDeudor || 0,
        saldoAFavor: reportePorUid.get(u.id)?.saldoAFavor || 0,
      }))
      .filter((u) => {
        if (onlySinContactar && u.seguimiento?.contactado) return false;
        if (onlyDeudores && !(u.saldoDeudor > 0)) return false;
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return `${u.name || ""} ${u.contabiliumDepositoNombre || ""} ${u.cuit || ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => b.pagado - a.pagado || (a.name || "").localeCompare(b.name || ""));
  }, [users, pagadoPorCuit, cobranzasPorCuit, search, onlySinContactar, onlyDeudores, reportePorUid]);

  const contactadosCount = useMemo(() => (users || []).filter((u) => u.seguimiento?.contactado).length, [users]);

  // Al llegar desde otra pantalla (ej. "Ver cuenta corriente" en Stock
  // Consignado) con ?buscar=<nombre>, si hay un único match lo abrimos
  // directo — así el admin no tiene que buscarlo manualmente.
  useEffect(() => {
    if (autoOpenIntentado || !rows.length) return;
    const buscar = new URLSearchParams(location.search).get("buscar");
    if (!buscar) return;
    setAutoOpenIntentado(true);
    if (rows.length === 1) setSelected(rows[0].id);
  }, [rows, autoOpenIntentado, location.search]);

  const loading = users === null || cobranzas === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Clientes 360</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            {loading ? "Cargando…" : `${rows.length} de ${users.length} clientes`} · todo el dato es en vivo de Contabilium
            {!loading && ` · ${contactadosCount} de ${users.length} contactados`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-900">
            <button
              onClick={() => setVista("lista")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                vista === "lista" ? "bg-slate-900 text-white dark:bg-neutral-700" : "text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              📋 Lista
            </button>
            <button
              onClick={() => setVista("calendario")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                vista === "calendario" ? "bg-slate-900 text-white dark:bg-neutral-700" : "text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              📅 Calendario
            </button>
          </div>
          <button
            onClick={handlePreviewLinkByCuit}
            disabled={linking}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white"
          >
            {linking ? "Buscando en Contabilium…" : "Vincular por CUIT"}
          </button>
        </div>
      </div>

      {linkPreview && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-900 dark:bg-sky-950/40">
          <p className="font-semibold text-sky-900 dark:text-sky-300">
            Encontrados {linkPreview.matchedCount} para vincular · {linkPreview.unresolvedCount} sin encontrar en Contabilium ·{" "}
            {linkPreview.sinCuitCount} sin CUIT cargado
          </p>
          {linkPreview.matched.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-sky-800 dark:text-sky-400">
              {linkPreview.matched.map((m) => (
                <li key={m.uid}>{m.nombre} ({m.cuit}) → {m.razonSocial}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleApplyLinkByCuit}
              disabled={applying || linkPreview.matchedCount === 0}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {applying ? "Vinculando…" : `Vincular ${linkPreview.matchedCount} ahora`}
            </button>
            <button
              onClick={() => setLinkPreview(null)}
              className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-400"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {vista === "calendario" && <CalendarioNotas rows={rows} onVerCliente={setSelected} />}

      {vista === "lista" && (
      <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o CUIT"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 sm:max-w-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500"
        />
        <button
          onClick={() => setOnlySinContactar((v) => !v)}
          className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-medium transition ${
            onlySinContactar
              ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
        >
          {onlySinContactar ? "✓ Solo sin contactar" : "Solo sin contactar"}
        </button>
        <button
          onClick={() => setOnlyDeudores((v) => !v)}
          className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-medium transition ${
            onlyDeudores
              ? "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
        >
          {onlyDeudores ? "✓ Solo deudores" : "Solo deudores"}
        </button>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-2 md:hidden">
        {rows.map((u) => (
          <button
            key={u.id}
            onClick={() => setSelected(u.id)}
            className="block w-full rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-slate-900 dark:text-white">{u.name || "Sin nombre"}</p>
              {u.seguimiento?.contactado ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  Contactado
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                  Sin contactar
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 dark:text-neutral-500">{u.cuit || "sin CUIT"}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
              {u.linked ? "Vinculado a Contabilium" : "⚠️ Sin vincular"} · Cobranzas: {money(u.pagado)}
            </p>
          </button>
        ))}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">CUIT</th>
              <th className="px-4 py-3 font-medium">Vínculo Contabilium</th>
              <th className="px-4 py-3 font-medium">Seguimiento</th>
              <th className="px-4 py-3 text-right font-medium">Cobranzas</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 transition hover:bg-slate-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/40">
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{u.name || "Sin nombre"}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">{u.cuit || "-"}</td>
                <td className="px-4 py-3">
                  {u.linked ? (
                    <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Vinculado
                    </span>
                  ) : (
                    <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                      Sin vincular
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.seguimiento?.contactado ? (
                    <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Contactado
                    </span>
                  ) : (
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                      Sin contactar
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">{money(u.pagado)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setSelected(u.id)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}

      {selected && (() => {
        const clienteVivo = rows.find((r) => r.id === selected);
        return clienteVivo ? <ClienteDetalle cliente={clienteVivo} onClose={() => setSelected(null)} /> : null;
      })()}
    </div>
  );
}

function ClienteDetalle({ cliente, onClose }) {
  const { user } = useAuth();
  const puedeEditarNotas = puedeEditarNotasCheck(user?.email);
  const [comprobantes, setComprobantes] = useState(null);
  const [stock, setStock] = useState(null);
  const [filtroModelo, setFiltroModelo] = useState("todos");
  const [vendedorGuardando, setVendedorGuardando] = useState(false);
  const [saldoTotal, setSaldoTotal] = useState(0);
  const [error, setError] = useState("");
  const [showCobranzas, setShowCobranzas] = useState(false);
  const [telefono, setTelefono] = useState(undefined); // undefined=cargando, null=no tiene
  const [facturaAbierta, setFacturaAbierta] = useState(null); // id de la factura desplegada
  const [itemsPorFactura, setItemsPorFactura] = useState({}); // id -> items[] | "loading" | "error"
  const [audits, setAudits] = useState(null); // null=cargando, []=sin videos
  const [showAudits, setShowAudits] = useState(false);
  const [videoAbierto, setVideoAbierto] = useState(null); // id del audit con el player desplegado
  const [pagosReportados, setPagosReportados] = useState(null);
  const [cheques, setCheques] = useState(null);
  const [revisandoPagoId, setRevisandoPagoId] = useState(null);
  const [programStart, setProgramStart] = useState(null);
  const [reciboAbierto, setReciboAbierto] = useState(null); // id de la factura con el form de recibo abierto

  useEffect(() => {
    getAuditProgramStart().then(setProgramStart).catch(() => setProgramStart(null));
  }, []);

  async function recargarFacturas() {
    if (!cliente.contabiliumId) return;
    try {
      const r = await adminGetClientComprobantes(cliente.contabiliumId);
      setComprobantes(r.items);
      setSaldoTotal(r.saldoTotal ?? 0);
    } catch (e) {
      setError(e.message || "No se pudieron traer las facturas");
    }
  }

  async function recargarCheques() {
    if (!cliente.contabiliumId) return;
    try {
      const snap = await getDocs(query(collection(db, "chequesRegistrados"), where("contabiliumId", "==", cliente.contabiliumId)));
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setCheques(items);
    } catch {
      // no crítico, se puede reintentar cerrando y abriendo la ficha
    }
  }

  async function handleToggleFactura(id) {
    if (facturaAbierta === id) {
      setFacturaAbierta(null);
      return;
    }
    setFacturaAbierta(id);
    if (itemsPorFactura[id]) return;
    setItemsPorFactura((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const detalle = await adminGetComprobanteDetail(id);
      setItemsPorFactura((prev) => ({ ...prev, [id]: detalle.Items || [] }));
    } catch (err) {
      setItemsPorFactura((prev) => ({ ...prev, [id]: "error" }));
    }
  }

  const seg = cliente.seguimiento || {};
  const [contactado, setContactado] = useState(!!seg.contactado);
  const [cuentaCoincide, setCuentaCoincide] = useState(seg.cuentaCoincide ?? "");
  const [notas, setNotas] = useState(seg.notas || "");
  const [tareaPendiente, setTareaPendiente] = useState(seg.tareaPendiente || "");
  const [imagenesNota, setImagenesNota] = useState([]); // File[] a subir con la próxima nota
  const [subiendoImagenes, setSubiendoImagenes] = useState(false);
  const [savingSeg, setSavingSeg] = useState(false);
  const [savedSeg, setSavedSeg] = useState(false);
  const [facturarOpen, setFacturarOpen] = useState(false);
  const [reciboModalOpen, setReciboModalOpen] = useState(false);
  const [deletingNotaIdx, setDeletingNotaIdx] = useState(null);
  const [editandoEntry, setEditandoEntry] = useState(null); // entrada del historial que se está editando (null = nota nueva)
  const [mensajeGenerado, setMensajeGenerado] = useState(null);
  const [mensajeCopiado, setMensajeCopiado] = useState(false);

  // Arma un mensaje de WhatsApp listo para copiar, leyendo la situación real
  // del cliente: estado del video de auditoría (nunca grabó / vencido / por
  // vencer / al día), si ya se le había avisado antes sobre el video (busca
  // en el historial una nota previa que mencione "video"), si la cuenta
  // corriente quedó marcada con diferencias, y la tarea pendiente actual.
  function generarMensajeParaCliente() {
    const nombreCompleto = cliente.contabiliumDepositoNombre || cliente.name || "";
    const nombre = nombreCompleto.split(" ")[0] || nombreCompleto;
    const partes = [`Hola ${nombre}, buenos días! Soy Ezequiel de Samurai.`];

    if (cliente.contabiliumDepositoId != null && audits) {
      const yaAvisadoAntes = (seg.historial || []).some((h) =>
        (h.tareaPendiente || h.notas || "").toLowerCase().includes("video")
      );

      if (audits.length === 0) {
        partes.push(
          "Vimos que todavía no se registró ningún video de auditoría de stock de tu cuenta. Es un paso simple: entrás a tu cuenta de Samurai, vas a \"Mi Stock\" y tocás el botón \"🎥 Grabar video\". Ahí filmás pausado todas las bicicletas que tenés consignadas, tanto las que están en caja como las que están armadas o fuera de caja, marcándolas una por una a medida que filmás. Te pido que lo hagas a la brevedad, hoy o mañana si es posible."
        );
      } else {
        const ultima = audits[0];
        const vencido = isAuditOverdue(ultima.createdAt, programStart, cliente.auditIntervalDays);
        const porVencer = isAuditDueSoon(ultima.createdAt, programStart, cliente.auditIntervalDays);
        if (vencido && yaAvisadoAntes) {
          partes.push(
            "Te escribo nuevamente porque la auditoría de stock de tu cuenta sigue vencida y todavía no recibimos el video actualizado, a pesar del aviso anterior. Te pido por favor que lo resuelvas hoy mismo desde \"Mi Stock\" → \"🎥 Grabar video\", mostrando pausado y una por una todas las bicicletas, con o sin caja."
          );
        } else if (vencido || porVencer) {
          partes.push(
            "Les escribo para pedirles si por favor pueden revisar el vencimiento de los videos publicados para poder avanzar con el control de stock. También aprovecho para comentarles que es de suma importancia que graben los videos de forma que podamos visualizar y contabilizar las unidades ya sea con o sin caja, pausado y marcando una a una a medida que filman. De ser posible hoy y mañana aguardamos los nuevos videos."
          );
        }
      }
    }

    if (seg.cuentaCoincide === false && seg.notas) {
      partes.push(
        `Además, en la última revisión de tu cuenta corriente quedó registrado: "${seg.notas}". Te pedimos que nos confirmes esto a la brevedad para poder resolverlo.`
      );
    }

    if (seg.tareaPendiente) {
      partes.push(`Por otro lado, nos quedó pendiente: ${seg.tareaPendiente}.`);
    }

    if (partes.length === 1) {
      partes.push("Te escribo para hacer un seguimiento de tu cuenta — cualquier novedad o consulta, contame.");
    }

    partes.push("Quedo a disposición para cualquier consulta adicional. Saludos!!");
    return partes.join("\n\n");
  }

  async function handleAsignarVendedor(vendedor) {
    setVendedorGuardando(true);
    try {
      await adminAsignarVendedor(cliente.id, vendedor || null);
    } catch (e) {
      alert(e.message || "No se pudo guardar el vendedor");
    } finally {
      setVendedorGuardando(false);
    }
  }

  function handleGenerarMensaje() {
    setMensajeGenerado(generarMensajeParaCliente());
    setMensajeCopiado(false);
  }

  function handleCopiarMensaje() {
    navigator.clipboard.writeText(mensajeGenerado);
    setMensajeCopiado(true);
    setTimeout(() => setMensajeCopiado(false), 1800);
  }

  async function handleEliminarNota(entry) {
    if (!puedeEditarNotas) return;
    if (!confirm("¿Borrar esta nota del historial? No se puede deshacer.")) return;
    setDeletingNotaIdx(entry);
    try {
      const nuevoHistorial = (seg.historial || []).filter((h) => h !== entry);
      await updateDoc(doc(db, "users", cliente.id), { "seguimiento.historial": nuevoHistorial });
    } catch (e) {
      alert(e.message || "No se pudo borrar la nota.");
    } finally {
      setDeletingNotaIdx(null);
    }
  }

  function handleEditarNota(entry) {
    if (!puedeEditarNotas) return;
    setEditandoEntry(entry);
    setContactado(!!entry.contactado);
    setCuentaCoincide(entry.cuentaCoincide === true ? "si" : entry.cuentaCoincide === false ? "no" : "");
    setNotas(entry.notas || "");
    setTareaPendiente(entry.tareaPendiente || "");
  }

  function handleCancelarEdicion() {
    setEditandoEntry(null);
    setContactado(!!seg.contactado);
    setCuentaCoincide(seg.cuentaCoincide === true ? "si" : seg.cuentaCoincide === false ? "no" : "");
    setNotas(seg.notas || "");
    setTareaPendiente(seg.tareaPendiente || "");
    setImagenesNota([]);
  }

  async function handleGuardarSeguimiento() {
    if (!puedeEditarNotas) return;
    setSavingSeg(true);
    setSavedSeg(false);
    try {
      const cuentaCoincideBool = cuentaCoincide === "" ? null : cuentaCoincide === "si";

      let imagenes = [];
      if (imagenesNota.length > 0) {
        setSubiendoImagenes(true);
        imagenes = await subirImagenesNota(cliente.id, imagenesNota);
        setSubiendoImagenes(false);
      }

      if (editandoEntry) {
        // Edita una entrada existente in place — conserva su fecha y autor
        // original, pero marca quién y cuándo la modificó por última vez.
        const nuevoHistorial = (seg.historial || []).map((h) =>
          h === editandoEntry
            ? {
                ...h,
                contactado,
                cuentaCoincide: cuentaCoincideBool,
                notas,
                tareaPendiente,
                imagenes: imagenes.length > 0 ? [...(h.imagenes || []), ...imagenes] : h.imagenes || [],
                editadoPor: user?.email || null,
                editadoAt: Timestamp.now(),
              }
            : h
        );
        await updateDoc(doc(db, "users", cliente.id), { "seguimiento.historial": nuevoHistorial });
        setEditandoEntry(null);
      } else {
        // serverTimestamp() no está permitido dentro de arrayUnion — cada
        // entrada del historial usa la hora del cliente en su lugar.
        const entrada = {
          contactado,
          cuentaCoincide: cuentaCoincideBool,
          notas,
          tareaPendiente,
          imagenes,
          contactadoPor: user?.email || null,
          fecha: Timestamp.now(),
        };
        await updateDoc(doc(db, "users", cliente.id), {
          // Estado actual (para filtros/badges de la lista) + historial completo,
          // que se va acumulando en vez de pisarse en cada guardado.
          "seguimiento.contactado": contactado,
          "seguimiento.cuentaCoincide": entrada.cuentaCoincide,
          "seguimiento.notas": notas,
          "seguimiento.tareaPendiente": tareaPendiente,
          "seguimiento.contactadoPor": entrada.contactadoPor,
          "seguimiento.fecha": serverTimestamp(),
          "seguimiento.historial": arrayUnion(entrada),
        });
      }
      setImagenesNota([]);
      setSavedSeg(true);
      setTimeout(() => setSavedSeg(false), 2000);
    } catch (e) {
      alert(e.message || "No se pudo guardar el seguimiento.");
    } finally {
      setSubiendoImagenes(false);
      setSavingSeg(false);
    }
  }

  async function handleRevisarPago(pago, aprobado) {
    if (!confirm(aprobado ? "¿Confirmar este pago como válido?" : "¿Rechazar este comprobante?")) return;
    setRevisandoPagoId(pago.id);
    try {
      await reviewPagoReportado(pago.id, aprobado);
      setPagosReportados((prev) => prev.map((p) => (p.id === pago.id ? { ...p, estado: aprobado ? "confirmado_manual" : "rechazado" } : p)));
    } catch (e) {
      alert(e.message || "No se pudo revisar el pago.");
    } finally {
      setRevisandoPagoId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setComprobantes(null);
    setStock(null);
    setSaldoTotal(0);
    setError("");
    setMensajeGenerado(null);
    setMensajeCopiado(false);
    setEditandoEntry(null);
    setImagenesNota([]);

    if (cliente.contabiliumId) {
      adminGetClientComprobantes(cliente.contabiliumId)
        .then((r) => {
          if (cancelled) return;
          setComprobantes(r.items);
          setSaldoTotal(r.saldoTotal ?? 0);
        })
        .catch((e) => { if (!cancelled) setError(e.message || "No se pudieron traer las facturas"); });
    } else {
      setComprobantes([]);
    }

    setAudits(null);
    setShowAudits(false);
    if (cliente.contabiliumDepositoId != null) {
      getDepositoStockAdmin(cliente.contabiliumDepositoId)
        .then((r) => { if (!cancelled) setStock(r.items); })
        .catch(() => { if (!cancelled) setStock([]); });
      listAuditsByDeposito(cliente.contabiliumDepositoId)
        .then((r) => { if (!cancelled) setAudits(r); })
        .catch(() => { if (!cancelled) setAudits([]); });
    } else {
      setStock([]);
      setAudits([]);
    }

    setPagosReportados(null);
    if (cliente.contabiliumId) {
      getDocs(query(collection(db, "pagosReportados"), where("contabiliumId", "==", cliente.contabiliumId)))
        .then((snap) => {
          if (cancelled) return;
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setPagosReportados(items);
        })
        .catch(() => { if (!cancelled) setPagosReportados([]); });
    } else {
      setPagosReportados([]);
    }

    setCheques(null);
    if (cliente.contabiliumId) {
      getDocs(query(collection(db, "chequesRegistrados"), where("contabiliumId", "==", cliente.contabiliumId)))
        .then((snap) => {
          if (cancelled) return;
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setCheques(items);
        })
        .catch(() => { if (!cancelled) setCheques([]); });
    } else {
      setCheques([]);
    }

    setTelefono(undefined);
    if (cliente.contabiliumId) {
      adminGetClientPhone(cliente.contabiliumId)
        .then((r) => { if (!cancelled) setTelefono(r.telefono || null); })
        .catch(() => { if (!cancelled) setTelefono(null); });
    } else {
      setTelefono(null);
    }

    return () => { cancelled = true; };
  }, [cliente]);

  const loading = comprobantes === null || stock === null;
  const saldoPendiente = saldoTotal;
  const totalFacturado = (comprobantes || []).reduce((acc, c) => acc + Number(c.Total || 0), 0);
  const stockBicis = (stock || []).filter((s) => (s.category || "").toUpperCase() === "BICICLETAS");
  const totalBicis = stockBicis.reduce((acc, s) => acc + Number(s.stockActual ?? 0), 0);
  const valorConsignado = stockBicis.reduce((acc, s) => acc + Number(s.stockActual ?? 0) * Number(s.priceArs ?? 0), 0);

  return (
    <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{cliente.name || "Sin nombre"}</h2>
            <p className="text-sm text-slate-500 dark:text-neutral-400">{cliente.cuit || "sin CUIT"}</p>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">
              {telefono === undefined ? (
                "📞 cargando…"
              ) : telefono ? (
                <>
                  📞 {telefono}{" "}
                  <a
                    href={`https://wa.me/54${telefono.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-1 text-emerald-600 underline hover:text-emerald-700 dark:text-emerald-400"
                  >
                    WhatsApp →
                  </a>
                </>
              ) : (
                "📞 sin teléfono en Contabilium"
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={cliente.vendedor && VENDEDORES.includes(cliente.vendedor) ? cliente.vendedor : ""}
              onChange={(e) => handleAsignarVendedor(e.target.value)}
              disabled={vendedorGuardando}
              title="Vendedor asignado"
              className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              <option value="">Sin vendedor</option>
              {VENDEDORES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {cliente.contabiliumId && (
              <button
                onClick={() => setFacturarOpen(true)}
                className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
              >
                🧾 Facturar
              </button>
            )}
            {cliente.contabiliumId && (
              <button
                onClick={() => setReciboModalOpen(true)}
                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
              >
                💳 Comprobante
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              ✕
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        {loading ? (
          <p className="mt-6 text-center text-sm text-slate-400 dark:text-neutral-500">Cargando datos de Contabilium…</p>
        ) : (
          <>
            <p className="mt-4 text-xs text-slate-400 dark:text-neutral-500">
              Cada recuadro trae un dato distinto de Contabilium — no son el mismo número, no deberían coincidir entre sí.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SummaryTile
                label="Bicicletas consignadas"
                value={totalBicis}
                source="Stock del depósito consignado, hoy"
              />
              <SummaryTile
                label="Valor consignado"
                value={money(valorConsignado)}
                accent="amber"
                source="Bicis consignadas × precio de lista, hoy"
              />
              <SummaryTile
                label="Facturado total"
                value={money(totalFacturado)}
                source="Suma de facturas (Contabilium), historial completo"
              />
              <SummaryTile
                label={saldoPendiente > 0 ? "Debe" : saldoPendiente < 0 ? "Saldo a favor" : "Al día"}
                value={money(saldoPendiente)}
                accent={saldoPendiente > 0 ? "red" : "green"}
                source={
                  saldoPendiente > 0
                    ? "El cliente nos debe esto"
                    : saldoPendiente < 0
                    ? "Le debemos esto al cliente (pagó de más / tiene crédito)"
                    : "Sin saldo pendiente en ningún sentido"
                }
              />
              <SummaryTile label="Facturas" value={(comprobantes || []).length} source="Cantidad de facturas, historial completo" />
              <button onClick={() => setShowCobranzas((v) => !v)} className="w-full text-left">
                <SummaryTile
                  label={`Cobranzas ${showCobranzas ? "▲" : "▼"}`}
                  value={money(cliente.pagado || 0)}
                  accent="sky"
                  source="Tocá para ver cada cobranza — historial independiente, no descuenta contra las facturas de arriba"
                  clickable
                />
              </button>
              {cliente.contabiliumDepositoId == null ? (
                <SummaryTile
                  label="Video de auditoría"
                  value="No aplica"
                  source="Sin depósito consignado asignado"
                />
              ) : audits === null ? (
                <SummaryTile label="Video de auditoría" value="Cargando…" source="Consultando Samurai" />
              ) : audits.length === 0 ? (
                <SummaryTile
                  label="Video de auditoría"
                  value={isAuditOverdue(null, programStart, cliente.auditIntervalDays) ? "Sin video — vencido" : "Sin video"}
                  accent="red"
                  source={
                    programStart
                      ? `Todavía no grabó ninguna auditoría. Debía tener una desde el ${formatFecha(nextAuditDate(null, programStart, cliente.auditIntervalDays)?.toISOString())}`
                      : "Todavía no grabó ninguna auditoría de stock"
                  }
                />
              ) : (
                (() => {
                  const ultima = audits[0];
                  const vencido = isAuditOverdue(ultima.createdAt, programStart, cliente.auditIntervalDays);
                  const porVencer = isAuditDueSoon(ultima.createdAt, programStart, cliente.auditIntervalDays);
                  const proximo = nextAuditDate(ultima.createdAt, programStart, cliente.auditIntervalDays);
                  const estado = vencido ? "🔴 Vencido" : porVencer ? "🟡 Por vencer" : "🟢 Al día";
                  return (
                    <button onClick={() => setShowAudits((v) => !v)} className="w-full text-left">
                      <SummaryTile
                        label={`Video de auditoría ${showAudits ? "▲" : "▼"}`}
                        value={ultima.createdAt ? formatFecha(ultima.createdAt.toISOString()) : "Ver"}
                        accent={vencido ? "red" : porVencer ? "amber" : "green"}
                        source={`${estado} · Próximo vencimiento: ${proximo ? formatFecha(proximo.toISOString()) : "—"} · ${audits.length} video(s) — tocá para ver todos`}
                        clickable
                      />
                    </button>
                  );
                })()
              )}
            </div>

            {showAudits && audits && audits.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Videos de auditoría ({audits.length})</p>
                <div className="space-y-1.5">
                  {audits.map((a) => (
                    <div key={a.id} className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                      <button
                        onClick={() => setVideoAbierto((v) => (v === a.id ? null : a.id))}
                        className="flex w-full items-center justify-between text-sm"
                      >
                        <span className="text-slate-700 dark:text-neutral-300">
                          ▶ {a.createdAt ? formatFechaHora(a.createdAt.toISOString()) : "Fecha desconocida"}
                          {contarVistas(a) > 0 && (
                            <span className="ml-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                              👁 visto {contarVistas(a)}x
                            </span>
                          )}
                        </span>
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          {videoAbierto === a.id ? "Ocultar ▲" : "Ver video ▼"}
                        </span>
                      </button>
                      {videoAbierto === a.id && <AuditVideoPlayer audit={a} className="mt-2" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pagosReportados && pagosReportados.filter((p) => p.estado === "pendiente").length > 0 && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                <p className="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-300">
                  💳 Comprobantes de pago sin confirmar ({pagosReportados.filter((p) => p.estado === "pendiente").length})
                </p>
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
                  El cliente subió un comprobante, pero todavía no lo encontramos como cobranza real en Contabilium — revisá si hay que cargar el recibo ahí.
                </p>
                <div className="space-y-2">
                  {pagosReportados.filter((p) => p.estado === "pendiente").map((p) => (
                    <div key={p.id} className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm dark:border-amber-900/50 dark:bg-neutral-900">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 dark:text-white">{money(p.monto)}</span>
                        <span className="text-xs text-slate-400 dark:text-neutral-500">{formatFecha(p.fecha)}</span>
                      </div>
                      {p.nota && <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{p.nota}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <a href={p.comprobanteUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400">
                          Ver comprobante →
                        </a>
                        <div className="ml-auto flex gap-1.5">
                          <button
                            onClick={() => handleRevisarPago(p, true)}
                            disabled={revisandoPagoId === p.id}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                          >
                            ✓ Ya está en Contabilium
                          </button>
                          <button
                            onClick={() => handleRevisarPago(p, false)}
                            disabled={revisandoPagoId === p.id}
                            className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:hover:bg-rose-950/30"
                          >
                            Rechazar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showCobranzas && (
              <div className="mt-3">
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Cobranzas ({cliente.cobranzasList?.length || 0})</p>
                {(cliente.cobranzasList || []).length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-neutral-500">Sin cobranzas sincronizadas para este CUIT.</p>
                ) : (
                  <div className="space-y-1.5">
                    {cliente.cobranzasList.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-sm dark:border-sky-900/50 dark:bg-sky-950/20"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-slate-700 dark:text-neutral-300">Nº {c.numero}</span>
                          <span className="text-xs text-slate-400 dark:text-neutral-500">{formatFecha(c.fecha)}</span>
                          <span className="font-semibold text-slate-900 dark:text-white">{money(c.importeTotal)}</span>
                        </div>
                        {(c.formasDePago || []).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {c.formasDePago.map((f, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center rounded-lg border border-sky-200 bg-white px-2 py-0.5 text-[11px] text-sky-700 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-400"
                              >
                                {f.FormaDePago}{nombreBanco(f.IdBanco) ? ` (${nombreBanco(f.IdBanco)})` : ""}{f.NroReferencia ? ` #${f.NroReferencia}` : ""} — {money(f.Importe)}
                              </span>
                            ))}
                          </div>
                        )}
                        {c.esReimputacion && (
                          <div className="mt-1">
                            <span className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
                              ⚠️ Reimputación — no es un pago nuevo, aplica un saldo a favor ya existente contra una factura
                            </span>
                          </div>
                        )}
                        {(() => {
                          const detalle = (c.detalle || []).filter((d) => d.IDComprobante);
                          if (detalle.length === 0) {
                            return (
                              <p className="mt-1 text-[11px] font-medium text-orange-600 dark:text-orange-400">
                                🟠 Sin aplicar a ninguna factura (a cuenta)
                              </p>
                            );
                          }
                          return (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {detalle.map((d, i) => {
                                const factura = (comprobantes || []).find((f) => f.Id === d.IDComprobante);
                                return (
                                  <span
                                    key={i}
                                    className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400"
                                  >
                                    ✅ Paga {factura ? factura.Numero : `factura #${d.IDComprobante}`} — {money(d.Importe)}
                                  </span>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Facturas</p>
              {(comprobantes || []).length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Sin facturas en los últimos 2 años.</p>
              ) : (
                <div className="space-y-1.5">
                  {comprobantes.map((c) => {
                    const abierta = facturaAbierta === c.Id;
                    const items = itemsPorFactura[c.Id];
                    return (
                      <div key={c.Id} className="rounded-xl border border-slate-100 dark:border-neutral-800">
                        <button
                          onClick={() => handleToggleFactura(c.Id)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                        >
                          <div>
                            <span className="font-mono text-slate-700 dark:text-neutral-300">{c.Numero}</span>
                            {c.Tipo === "COT" && (
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                                Cotización
                              </span>
                            )}
                            <span className="ml-2 text-xs text-slate-400 dark:text-neutral-500">{formatFecha(c.Fecha)}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-600 dark:text-neutral-400">{money(c.Total)}</span>
                            <span className={c.Saldo > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}>
                              {money(c.Saldo)}
                            </span>
                            <span className="text-slate-400">{abierta ? "▲" : "▼"}</span>
                          </div>
                        </button>
                        {abierta && (
                          <div className="border-t border-slate-100 px-3 py-2 dark:border-neutral-800">
                            {items === "loading" && (
                              <p className="text-xs text-slate-400 dark:text-neutral-500">Cargando ítems…</p>
                            )}
                            {items === "error" && (
                              <p className="text-xs text-rose-500">No se pudo traer el detalle de esta factura.</p>
                            )}
                            {Array.isArray(items) && items.length === 0 && (
                              <p className="text-xs text-slate-400 dark:text-neutral-500">Sin ítems.</p>
                            )}
                            {Array.isArray(items) && items.length > 0 && (
                              <div className="space-y-1">
                                {items.map((it, i) => (
                                  <div key={i} className="flex items-center justify-between text-xs">
                                    <span className="text-slate-700 dark:text-neutral-300">
                                      {it.Concepto || it.Descripcion || "—"} <span className="text-slate-400">× {it.Cantidad ?? 0}</span>
                                    </span>
                                    <span className="text-slate-500 dark:text-neutral-400">
                                      {money((it.Total ?? (Number(it.PrecioUnitario) || 0) * (Number(it.Cantidad) || 0)))}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {c.Saldo > 0 && (
                              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-neutral-800">
                                <button
                                  onClick={() => setReciboAbierto(reciboAbierto === c.Id ? null : c.Id)}
                                  className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                                >
                                  {reciboAbierto === c.Id ? "Cancelar recibo" : "💳 Hacer un recibo (cobrar sin facturar)"}
                                </button>
                                {reciboAbierto === c.Id && (
                                  <ReciboForm
                                    factura={c}
                                    contabiliumId={cliente.contabiliumId}
                                    clienteName={cliente.name}
                                    onDone={() => { setReciboAbierto(null); recargarFacturas(); recargarCheques(); }}
                                  />
                                )}
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

            {cheques && cheques.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
                  🏦 Cheques registrados ({cheques.length})
                </p>
                <div className="space-y-2">
                  {cheques.map((ch) => (
                    <ChequeRow
                      key={ch.id}
                      cheque={ch}
                      facturasCliente={(comprobantes || []).filter((c) => Number(c.Saldo || 0) > 0)}
                      onChanged={() => { recargarCheques(); recargarFacturas(); }}
                    />
                  ))}
                </div>
              </div>
            )}

            {pagosReportados && pagosReportados.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
                  Comprobantes de pago reportados ({pagosReportados.length})
                </p>
                <div className="space-y-2">
                  {[...pagosReportados]
                    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
                    .map((p) => {
                      const badge =
                        p.estado === "confirmado_auto"
                          ? { text: "✓ Confirmado automático", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" }
                          : p.estado === "confirmado_manual"
                          ? { text: "✓ Confirmado a mano", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" }
                          : p.estado === "rechazado"
                          ? { text: "✕ Rechazado", cls: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400" }
                          : { text: "⏳ Pendiente de revisión", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" };
                      return (
                        <div key={p.id} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-neutral-800">
                          <div className="flex items-center justify-between gap-2">
                            <a href={p.comprobanteUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 hover:underline dark:text-sky-400">
                              {money(p.monto)}
                            </a>
                            <span className="text-xs text-slate-400 dark:text-neutral-500">{formatFecha(p.fecha)}</span>
                          </div>
                          {p.nota && <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{p.nota}</p>}
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.text}</span>
                            {p.estado === "pendiente" && (
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => handleRevisarPago(p, true)}
                                  disabled={revisandoPagoId === p.id}
                                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  Aprobar
                                </button>
                                <button
                                  onClick={() => handleRevisarPago(p, false)}
                                  disabled={revisandoPagoId === p.id}
                                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
                                >
                                  Rechazar
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {stock && stock.length > 0 && (() => {
              const bicis = stock.filter((s) => (s.category || "").toUpperCase() === "BICICLETAS" && Number(s.stockActual || 0) > 0);
              const modelos = [...new Set(bicis.map((s) => extraerModelo(s.name)).filter(Boolean))].sort();
              const bicisFiltradas = filtroModelo === "todos" ? bicis : bicis.filter((s) => extraerModelo(s.name) === filtroModelo);
              return (
                <div className="mt-5">
                  <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Bicicletas consignadas</p>
                  {modelos.length > 1 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      <button
                        onClick={() => setFiltroModelo("todos")}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                          filtroModelo === "todos"
                            ? "bg-slate-900 text-white dark:bg-neutral-700"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        }`}
                      >
                        Todos ({bicis.length})
                      </button>
                      {modelos.map((m) => {
                        const cantidad = bicis.filter((s) => extraerModelo(s.name) === m).length;
                        return (
                          <button
                            key={m}
                            onClick={() => setFiltroModelo(m)}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                              filtroModelo === m
                                ? "bg-slate-900 text-white dark:bg-neutral-700"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                            }`}
                          >
                            {m} ({cantidad})
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="space-y-1">
                    {bicisFiltradas.map((s) => {
                      const talle = extraerTalle(s.name);
                      const nombreLimpio = limpiarNombreBici(s.name);
                      return (
                        <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1 text-xs dark:border-neutral-800">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-slate-700 dark:text-neutral-300">
                            <span className="min-w-0 truncate">{nombreLimpio}</span>
                            {talle && (
                              <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
                                Talle {talle}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-semibold text-slate-900 dark:text-white">{s.stockActual}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">✉️ Mensaje para este cliente</p>
                <button
                  onClick={handleGenerarMensaje}
                  className="shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                >
                  {mensajeGenerado ? "🔄 Regenerar" : "Generar mensaje"}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                Arma el texto en base al estado del video de auditoría y a las últimas notas de seguimiento.
              </p>
              {mensajeGenerado && (
                <div className="mt-3">
                  <p className="whitespace-pre-line rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                    {mensajeGenerado}
                  </p>
                  <button
                    onClick={handleCopiarMensaje}
                    className="mt-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    {mensajeCopiado ? "✅ Copiado" : "📋 Copiar mensaje"}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-neutral-800 dark:bg-neutral-800/40">
              <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Seguimiento de contacto</p>

              {!puedeEditarNotas && (
                <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                  🔒 Solo Pablo y Marian pueden cargar o editar notas de seguimiento. Podés ver el historial abajo.
                </p>
              )}

              <label className={`flex items-center gap-2 text-sm text-slate-700 dark:text-neutral-300 ${!puedeEditarNotas ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  checked={contactado}
                  onChange={(e) => setContactado(e.target.checked)}
                  disabled={!puedeEditarNotas}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                Ya contactado
              </label>

              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-neutral-400">¿La cuenta corriente coincide con lo que dice el cliente?</p>
                <div className="flex gap-2">
                  {[
                    { v: "si", label: "Sí, coincide" },
                    { v: "no", label: "No, hay diferencias" },
                    { v: "", label: "Sin definir" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setCuentaCoincide(opt.v)}
                      disabled={!puedeEditarNotas}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                        cuentaCoincide === opt.v
                          ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
                  Notas / diferencias encontradas
                </label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={2}
                  disabled={!puedeEditarNotas}
                  placeholder="Ej: dice que tiene 5 bicis menos, falta confirmar color..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500"
                />
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Tarea pendiente</label>
                <input
                  type="text"
                  value={tareaPendiente}
                  onChange={(e) => setTareaPendiente(e.target.value)}
                  disabled={!puedeEditarNotas}
                  placeholder="Ej: reenviar tutorial de video, corregir stock en sistema..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500"
                />
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
                  Adjuntar imágenes (comprobantes, cheques, fotos…)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={!puedeEditarNotas}
                  onChange={(e) => setImagenesNota(Array.from(e.target.files || []))}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 disabled:opacity-50 dark:text-neutral-400 dark:file:bg-neutral-800 dark:file:text-neutral-300"
                />
                {imagenesNota.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{imagenesNota.length} imagen(es) lista(s) para subir</p>
                )}
              </div>

              {editandoEntry && (
                <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-400">
                  ✏️ Editando una nota guardada — al guardar se actualiza esa nota, no se crea una nueva.
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleGuardarSeguimiento}
                  disabled={savingSeg || !puedeEditarNotas}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                >
                  {subiendoImagenes ? "Subiendo imágenes…" : savingSeg ? "Guardando…" : editandoEntry ? "Guardar cambios" : "Guardar seguimiento"}
                </button>
                {editandoEntry && (
                  <button
                    onClick={handleCancelarEdicion}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Cancelar
                  </button>
                )}
                {savedSeg && <span className="text-sm text-emerald-600 dark:text-emerald-400">✓ Guardado</span>}
              </div>

              {(seg.historial || []).length > 0 && (
                <div className="mt-5 border-t border-slate-200 pt-4 dark:border-neutral-700">
                  <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                    Historial de seguimiento <span className="font-normal text-slate-400 dark:text-neutral-500">({seg.historial.length})</span>
                  </p>
                  <HistorialSeguimiento
                    historial={seg.historial}
                    puedeEditar={puedeEditarNotas}
                    onEditar={handleEditarNota}
                    onEliminar={handleEliminarNota}
                    deletingEntry={deletingNotaIdx}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {facturarOpen && (
        <FacturarModal
          contabiliumId={cliente.contabiliumId}
          depositoId={cliente.contabiliumDepositoId}
          clienteName={cliente.name}
          condicionIva={cliente.condicionIva}
          cuit={cliente.cuit}
          onClose={() => setFacturarOpen(false)}
        />
      )}

      {reciboModalOpen && (
        <ReciboModal
          contabiliumId={cliente.contabiliumId}
          clienteName={cliente.name}
          facturas={(comprobantes || []).filter((c) => Number(c.Saldo || 0) > 0)}
          onClose={() => setReciboModalOpen(false)}
          onDone={() => { setReciboModalOpen(false); recargarFacturas(); recargarCheques(); }}
        />
      )}
    </div>
  );
}

// Cheque, igual que Efectivo, no lleva banco/caja en Contabilium — solo el
// número de cheque como referencia (confirmado contra cobranzas reales).
const FORMAS_SIN_BANCO = ["Efectivo", "Cheque"];

// Qué letra corresponde según la condición de IVA del cliente (el emisor,
// Samurai, es Responsable Inscripto): a otro RI se le factura A, a
// Monotributo/Consumidor Final/Exento se le factura B. Es una sugerencia
// de partida, no una regla cerrada — el staff puede cambiarla a mano.
function sugerirTipoFc(condicionIva) {
  const c = (condicionIva || "").toUpperCase();
  if (c === "RI" || c.includes("INSCRIPTO")) return "FCA";
  return "FCB";
}

// Recibo de cobranza contra una factura puntual — no factura nada, solo
// registra que entró plata y descuenta el "Debe" en Contabilium. Para
// clientes de compra directa (sin depósito consignado, sin circuito de
// ventas reportadas) donde no hay otra forma de imputar un pago.
// Modal accesible desde el botón "💳 Comprobante" en el header del cliente
// — elegís a qué factura con saldo pendiente aplicarlo y después es el
// mismo formulario (ReciboForm) que ya existe desplegado dentro de cada
// factura, para no duplicar la lógica de cobrar contra Contabilium.
function ReciboModal({ contabiliumId, clienteName, facturas, onClose, onDone }) {
  const [facturaId, setFacturaId] = useState(facturas[0]?.Id ?? "");
  const facturaSeleccionada = facturas.find((f) => f.Id === Number(facturaId));

  return (
    <div className="fixed inset-0 z-[9100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">💳 Comprobante de pago para {clienteName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-500">
            ✕
          </button>
        </div>

        {facturas.length === 0 ? (
          <>
            <p className="rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
              Este cliente no tiene facturas con saldo pendiente ahora mismo — solo se puede cargar un <strong>cheque a cuenta</strong> (queda guardado como saldo a favor para imputar más adelante). El resto de las formas de pago necesitan una factura para aplicarse.
            </p>
            <div className="mt-3">
              <ReciboForm factura={null} contabiliumId={contabiliumId} clienteName={clienteName} onDone={onDone} soloCheque />
            </div>
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-slate-500 dark:text-neutral-400">
              Factura a la que se aplica
              <select
                value={facturaId}
                onChange={(e) => setFacturaId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              >
                {facturas.map((f) => (
                  <option key={f.Id} value={f.Id}>
                    {f.Numero} — debe {money(f.Saldo)} de {money(f.Total)}
                  </option>
                ))}
              </select>
            </label>

            {facturaSeleccionada && (
              <div className="mt-3">
                <ReciboForm factura={facturaSeleccionada} contabiliumId={contabiliumId} clienteName={clienteName} onDone={onDone} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReciboForm({ factura, contabiliumId, clienteName, onDone, soloCheque = false }) {
  const saldoActual = Number(factura?.Saldo || 0);
  // Líneas de pago ya agregadas al recibo (todo lo que NO sea Cheque). Van
  // todas juntas en un solo llamado a Contabilium porque su API reemplaza
  // el recibo entero del comprobante en cada llamada — no lo acumula — así
  // que cargar varias transferencias de a una pisaría a las anteriores.
  const [pagos, setPagos] = useState([]);
  const [monto, setMonto] = useState(soloCheque ? "" : "");
  const [formaDePago, setFormaDePago] = useState(soloCheque ? "Cheque" : "Transferencia");
  const [idBanco, setIdBanco] = useState(listaBancos()[0]?.id || "");
  const [nroReferencia, setNroReferencia] = useState("");
  const [fotoCheque, setFotoCheque] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [error, setError] = useState("");

  const totalPagos = pagos.reduce((acc, p) => acc + Number(p.monto || 0), 0);
  const restante = Math.max(0, saldoActual - totalPagos);

  function handleAgregarLinea() {
    setError("");
    if (!(Number(monto) > 0)) {
      setError("Ingresá un monto mayor a 0");
      return;
    }
    if (Number(monto) > restante) {
      setError(`El monto no puede superar lo que falta cubrir (${money(restante)})`);
      return;
    }
    if (!FORMAS_SIN_BANCO.includes(formaDePago) && !idBanco) {
      setError("Elegí un banco/cuenta");
      return;
    }
    setPagos((prev) => [...prev, { formaDePago, monto: Number(monto), idBanco: FORMAS_SIN_BANCO.includes(formaDePago) ? null : Number(idBanco), nroReferencia }]);
    setMonto("");
    setNroReferencia("");
  }

  function quitarLinea(idx) {
    setPagos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleGuardarCheque() {
    if (!(Number(monto) > 0)) {
      setError("Ingresá un monto mayor a 0");
      return;
    }
    if (!nroReferencia.trim()) {
      setError("Ingresá el número de cheque");
      return;
    }
    // Un cheque NO se imputa al momento ni queda atado a esta factura — se
    // guarda como un saldo "a favor" del cliente (puede valer más o menos
    // que esta factura puntual). Después, con el botón "Imputar", se elige
    // a qué factura aplicarlo — puede ser esta, otra futura, o repartirlo
    // entre varias.
    setGuardando(true);
    setError("");
    try {
      let fotoUrl = null;
      if (fotoCheque) {
        setSubiendoFoto(true);
        [fotoUrl] = await subirImagenesNota(`cheques/${contabiliumId}`, [fotoCheque]);
        setSubiendoFoto(false);
      }
      await addDoc(collection(db, "chequesRegistrados"), {
        contabiliumId: contabiliumId || null,
        clienteName: clienteName || null,
        nroCheque: nroReferencia,
        monto: Number(monto),
        montoImputado: 0,
        imputaciones: [],
        fotoUrl,
        cargadoPor: auth.currentUser?.email || null,
        createdAt: serverTimestamp(),
      });
      onDone();
    } catch (e) {
      setError(e.message || "No se pudo guardar el cheque");
    } finally {
      setSubiendoFoto(false);
      setGuardando(false);
    }
  }

  async function handleConfirmarRecibo() {
    if (pagos.length === 0) {
      setError("Agregá al menos una línea de pago");
      return;
    }
    const detalle = pagos
      .map((p) => `• ${p.formaDePago}${p.nroReferencia ? ` (${p.nroReferencia})` : ""} — ${money(p.monto)}`)
      .join("\n");
    const ok = confirm(
      `Vas a registrar un RECIBO REAL en Contabilium por ${money(totalPagos)} contra la factura ${factura.Numero}:\n\n${detalle}\n\n¿Confirmás?`
    );
    if (!ok) return;

    setGuardando(true);
    setError("");
    try {
      await cobrarComprobante({
        idComprobante: factura.Id,
        importeTotalNeto: Number(factura.Total),
        pagos: pagos.map((p) => ({ formaDePago: p.formaDePago, monto: p.monto, idBanco: p.idBanco, nroReferencia: p.nroReferencia })),
      });
      onDone();
    } catch (e) {
      setError(e.message || "No se pudo registrar el recibo");
    } finally {
      setGuardando(false);
    }
  }

  if (formaDePago === "Cheque" && soloCheque) {
    return (
      <div className="mt-2 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/10">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Monto
            <input
              type="number"
              min="1"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="ml-1.5 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            N° de cheque
            <input
              type="text"
              value={nroReferencia}
              onChange={(e) => setNroReferencia(e.target.value)}
              className="ml-1.5 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Foto del cheque (opcional)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFotoCheque(e.target.files?.[0] || null)}
              className="ml-1.5 text-xs text-slate-600 file:mr-1.5 file:rounded-lg file:border-0 file:bg-slate-200 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:text-neutral-400 dark:file:bg-neutral-700 dark:file:text-neutral-200"
            />
          </label>
        </div>
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        <button
          onClick={handleGuardarCheque}
          disabled={guardando}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {subiendoFoto ? "Subiendo foto…" : guardando ? "Guardando…" : "📥 Guardar cheque (sin imputar)"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/10">
      {pagos.length > 0 && (
        <div className="space-y-1">
          {pagos.map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-white px-2 py-1 text-xs dark:bg-neutral-900">
              <span>
                {p.formaDePago}{p.idBanco ? ` — ${nombreBanco(p.idBanco) || p.idBanco}` : ""}
                {p.nroReferencia ? ` (${p.nroReferencia})` : ""} — <b>{money(p.monto)}</b>
              </span>
              <button onClick={() => quitarLinea(i)} className="ml-2 text-rose-500 hover:text-rose-700">✕</button>
            </div>
          ))}
          <p className="text-xs font-semibold text-slate-700 dark:text-neutral-300">
            Total cargado: {money(totalPagos)} · Falta: {money(restante)}
          </p>
        </div>
      )}

      {formaDePago === "Cheque" ? (
        <p className="text-[11px] text-slate-500 dark:text-neutral-400">
          El cheque se guarda aparte (no se imputa al momento) — cambiá a otra forma de pago para armar este recibo, o guardalo como cheque a cuenta.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-600 dark:text-neutral-300">
          Monto
          <input
            type="number"
            min="1"
            max={formaDePago === "Cheque" ? undefined : restante}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="ml-1.5 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-neutral-300">
          Forma de pago
          <select
            value={formaDePago}
            onChange={(e) => setFormaDePago(e.target.value)}
            className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          >
            <option value="Transferencia">Transferencia</option>
            <option value="Depósito">Depósito</option>
            <option value="Débito">Débito</option>
            <option value="Cheque">Cheque</option>
            <option value="Efectivo">Efectivo</option>
          </select>
        </label>
        {!FORMAS_SIN_BANCO.includes(formaDePago) && (
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Banco
            <select
              value={idBanco}
              onChange={(e) => setIdBanco(e.target.value)}
              className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            >
              {listaBancos().map((b) => (
                <option key={b.id} value={b.id}>{b.nombre}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-slate-600 dark:text-neutral-300">
          {formaDePago === "Cheque" ? "N° de cheque" : "Referencia (opcional)"}
          <input
            type="text"
            value={nroReferencia}
            onChange={(e) => setNroReferencia(e.target.value)}
            className="ml-1.5 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </label>
        {formaDePago === "Cheque" && (
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Foto del cheque (opcional)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFotoCheque(e.target.files?.[0] || null)}
              className="ml-1.5 text-xs text-slate-600 file:mr-1.5 file:rounded-lg file:border-0 file:bg-slate-200 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:text-neutral-400 dark:file:bg-neutral-700 dark:file:text-neutral-200"
            />
          </label>
        )}
        <button
          onClick={formaDePago === "Cheque" ? handleGuardarCheque : handleAgregarLinea}
          disabled={guardando}
          className="rounded-lg border border-emerald-400 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:bg-neutral-900 dark:text-emerald-400"
        >
          {subiendoFoto ? "Subiendo foto…" : formaDePago === "Cheque" ? "📥 Guardar cheque (sin imputar)" : "+ Agregar línea"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {pagos.length > 0 && (
        <button
          onClick={handleConfirmarRecibo}
          disabled={guardando}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {guardando ? "Guardando…" : `💳 Confirmar recibo (${money(totalPagos)})`}
        </button>
      )}
    </div>
  );
}

function FacturarModal({ contabiliumId, depositoId, clienteName, condicionIva, cuit, onClose }) {
  const [products, setProducts] = useState(null);
  const [stockPorSku, setStockPorSku] = useState(null); // Map sku -> stockDisponible, null = no aplica (sin depósito)
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState([]);
  const [tipoFc, setTipoFc] = useState(() => sugerirTipoFc(condicionIva));
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [afipCheck, setAfipCheck] = useState(null); // null=no consultado, "loading", o { match, categoriaAfip }

  // Verifica automáticamente contra el padrón real de AFIP que la condición
  // IVA cargada en Contabilium sea la real, para no depender de que alguien
  // lo chequee a mano antes de cada factura (fuente del error "Condicion IVA
  // receptor no valido" cuando el dato local queda desactualizado).
  useEffect(() => {
    if (!cuit) return;
    setAfipCheck("loading");
    verificarCondicionAfip(cuit)
      .then((r) => {
        const categoriaAfip = r.categoriaImpositiva;
        setAfipCheck({
          match: !categoriaAfip || !condicionIva || categoriaAfip === condicionIva,
          categoriaAfip,
        });
      })
      .catch(() => setAfipCheck(null));
  }, [cuit, condicionIva]);

  useEffect(() => {
    (async () => {
      try {
        // Si el cliente tiene depósito consignado, mostramos solo lo que
        // realmente tiene ahí (con el stock real de Contabilium) — evita
        // facturar algo que no tiene o perder tiempo buscando en todo el
        // catálogo. Si no tiene depósito (cliente de mostrador/catálogo),
        // seguimos mostrando el catálogo completo como antes.
        if (depositoId) {
          const { items } = await getDepositoStockAdmin(depositoId);
          setProducts(items.map((it) => ({ id: it.id, name: it.name, sku: it.sku, priceArs: it.priceArs, imageUrl: it.imageUrl })));
          const mapa = new Map(items.map((it) => [it.sku, it.stockDisponible]));
          setStockPorSku(mapa);
        } else {
          const q = query(
            collection(db, "products"),
            where("active", "==", true),
            orderBy("nameLower"),
            limit(2000)
          );
          const snap = await getDocs(q);
          setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setStockPorSku(null);
        }
      } catch (e) {
        setError(e.message || "No se pudieron cargar los productos");
      }
    })();
  }, [depositoId]);

  const results = useMemo(() => {
    if (!products || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [products, search]);

  function addProduct(p) {
    setLines((prev) => {
      const existing = prev.find((l) => l.sku === p.sku);
      if (existing) {
        return prev.map((l) => (l.sku === p.sku ? { ...l, cantidad: l.cantidad + 1 } : l));
      }
      return [...prev, { sku: p.sku, descripcion: p.name, cantidad: 1, precioUnitario: Number(p.priceArs || 0) }];
    });
    setSearch("");
  }

  function addManualLine() {
    setLines((prev) => [...prev, { sku: null, descripcion: "", cantidad: 1, precioUnitario: 0 }]);
  }

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const total = lines.reduce((acc, l) => acc + Number(l.cantidad || 0) * Number(l.precioUnitario || 0), 0);

  async function handleEmitir() {
    if (lines.length === 0) return;
    const detalle = lines
      .map((l) => `• ${l.descripcion || "(sin descripción)"} x${l.cantidad} — ${money(Number(l.cantidad) * Number(l.precioUnitario))}`)
      .join("\n");
    const letra = tipoFc.slice(-1);
    const ok = confirm(
      `Vas a EMITIR UNA FACTURA ${letra} REAL en Contabilium (con CAE, irreversible) para ${clienteName}:\n\n${detalle}\n\nTotal: ${money(total)}\n\n¿Confirmás?`
    );
    if (!ok) return;

    setEmitting(true);
    setError("");
    try {
      const items = lines.map((l) => ({
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precioUnitario),
        sku: l.sku,
      }));
      const res = await emitirFacturaManual(contabiliumId, items, tipoFc);
      setResult(res.comprobante);
    } catch (e) {
      setError(e.message || "No se pudo emitir la factura");
    } finally {
      setEmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">🧾 Facturar a {clienteName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-500">
            ✕
          </button>
        </div>

        {result ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            <p className="font-semibold">✓ Factura emitida{result?.Numero ? `: ${result.Numero}` : ""}</p>
            <p className="mt-1 text-xs">Revisala en Contabilium para confirmar el CAE y el descuento de stock.</p>
            <button
              onClick={onClose}
              className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={depositoId ? "Buscar en el stock de este cliente…" : "Buscar bicicleta o producto por nombre o SKU…"}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                  {results.map((p) => {
                    const stock = stockPorSku ? stockPorSku.get(p.sku) : null;
                    return (
                      <li key={p.id}>
                        <button
                          onClick={() => addProduct(p)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800"
                        >
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-slate-50 dark:bg-neutral-800">
                            {p.imageUrl && <img src={p.imageUrl} alt="" className="h-full w-full object-contain" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-900 dark:text-white">{p.name}</p>
                            <p className="text-xs text-slate-400 dark:text-neutral-500">SKU {p.sku} · {money(p.priceArs)}</p>
                          </div>
                          {stockPorSku && (
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${stock > 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400"}`}>
                              stock: {stock ?? 0}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {depositoId && products?.length === 0 && (
                <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">Este cliente no tiene stock consignado cargado.</p>
              )}
            </div>

            <button
              onClick={addManualLine}
              className="mt-2 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
            >
              + Agregar línea manual (sin producto del catálogo)
            </button>

            <div className="mt-4 space-y-2">
              {lines.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-neutral-700">
                  Buscá arriba y agregá lo que vendió.
                </p>
              )}
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-neutral-700">
                  <div className="flex items-start gap-2">
                    <input
                      value={l.descripcion}
                      onChange={(e) => updateLine(i, { descripcion: e.target.value })}
                      placeholder="Descripción"
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                    />
                    <button onClick={() => removeLine(i)} className="shrink-0 text-rose-500 hover:text-rose-700">
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-slate-500 dark:text-neutral-400">
                      Cant.
                      <input
                        type="number"
                        min="1"
                        value={l.cantidad}
                        onChange={(e) => updateLine(i, { cantidad: Number(e.target.value) })}
                        className="ml-1 w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                      />
                    </label>
                    <label className="text-xs text-slate-500 dark:text-neutral-400">
                      Precio unit.
                      <input
                        type="number"
                        min="0"
                        value={l.precioUnitario}
                        onChange={(e) => updateLine(i, { precioUnitario: Number(e.target.value) })}
                        className="ml-1 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                      />
                    </label>
                    <span className="ml-auto text-xs font-semibold text-slate-700 dark:text-neutral-300">
                      {money(Number(l.cantidad || 0) * Number(l.precioUnitario || 0))}
                    </span>
                  </div>
                  {l.sku && (() => {
                    const stock = stockPorSku ? stockPorSku.get(l.sku) : null;
                    const excede = stockPorSku && stock != null && Number(l.cantidad) > stock;
                    return (
                      <p className={`mt-1 text-[11px] ${excede ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-neutral-500"}`}>
                        SKU {l.sku}{stockPorSku ? ` — stock disponible: ${stock ?? 0}` : " — descuenta stock del depósito consignado"}
                        {excede ? " · ¡supera el stock disponible!" : ""}
                      </p>
                    );
                  })()}
                </div>
              ))}
            </div>

            {lines.length > 0 && (
              <>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-neutral-800">
                  <span className="text-sm font-semibold text-slate-700 dark:text-neutral-300">Total</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">{money(total)}</span>
                </div>

                {afipCheck === "loading" && (
                  <p className="mt-3 text-xs text-slate-400 dark:text-neutral-500">Verificando condición IVA con AFIP…</p>
                )}
                {afipCheck && afipCheck !== "loading" && (
                  <p
                    className={`mt-3 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      afipCheck.match
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                        : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400"
                    }`}
                  >
                    {afipCheck.match
                      ? `✓ Verificado con AFIP: ${afipCheck.categoriaAfip || condicionIva || "condición sin categorizar"}`
                      : `⚠ AFIP dice "${afipCheck.categoriaAfip}" pero acá figura "${condicionIva}" — corregilo en Contabilium antes de facturar.`}
                  </p>
                )}

                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                    Tipo de comprobante {condicionIva ? `(cliente: ${condicionIva})` : ""}
                  </p>
                  <div className="flex gap-2">
                    {["FCA", "FCB", "FCC"].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTipoFc(t)}
                        className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          tipoFc === t
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-400"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                        }`}
                      >
                        Factura {t.slice(-1)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

            <button
              onClick={handleEmitir}
              disabled={emitting || lines.length === 0}
              className="mt-4 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {emitting ? "Emitiendo…" : `🧾 Emitir factura ${tipoFc.slice(-1)}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, accent = "neutral", source, clickable = false }) {
  const colors = {
    neutral: "text-slate-900 dark:text-white",
    red: "text-rose-600 dark:text-rose-400",
    green: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    sky: "text-sky-600 dark:text-sky-400",
  };
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 ${
        clickable ? "cursor-pointer transition hover:border-sky-400 dark:hover:border-sky-600" : ""
      }`}
    >
      <p className="text-xs text-slate-500 dark:text-neutral-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${colors[accent]}`}>{value}</p>
      {source && <p className="mt-1 text-[10px] leading-tight text-slate-400 dark:text-neutral-500">{source}</p>}
    </div>
  );
}
