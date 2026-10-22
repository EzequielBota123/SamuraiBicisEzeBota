import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import * as XLSX from "xlsx";
import { addDoc, arrayUnion, collection, doc, getDocs, increment, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import { reviewPagoReportado, confirmarPagoReportado, obtenerBancosYCajasPropios } from "../../services/comprobantes";
import { puedeEditarNotas as puedeEditarNotasCheck } from "../../utils/permisosNotas";
import { subirImagenesNota } from "../../utils/notaImagenes";
import HistorialSeguimiento from "../../components/crm/HistorialSeguimiento";
import ChequeRow from "../../components/crm/ChequeRow";
import { db, auth } from "../../firebase";
import { useAuth } from "../../auth/AuthContext";
import { subscribeCobranzas } from "../../services/cobranzas";
import { subscribeBusinessDashboardDetail } from "../../services/comprobantes";
import { nombreBanco, listaBancos } from "../../services/bancos";
import { listAuditsByDeposito, getAuditProgramStart, nextAuditDate, isAuditOverdue, isAuditDueSoon, contarVistas } from "../../services/stockAudits";
import AuditVideoPlayer from "../../components/stock/AuditVideoPlayer";
import { adminGetClientComprobantes, adminGetClientPhone, adminActualizarTelefonosCliente, adminGetComprobanteDetail, adminDescargarPdfComprobante, getDepositoStockAdmin, adminLinkClientesByCuit, emitirFacturaManual, emitirFacturaVenta, cobrarComprobante, verificarCondicionAfip, subscribeClientesReportDetail, adminAsignarVendedor, searchContabiliumClientes, leerComprobantePagoAdmin, adminListDistribuidoresConEquipo, adminAsignarClienteADistribuidor, adminBuscarClientePorTelefono, cargarCobranzaACuentaManual, listarChequesDisponiblesContabilium, deleteSaleRequest } from "../../services/comprobantes";
import { limpiarNombreBici, extraerTalle, extraerModelo } from "../../utils/bikeName";
import { getContabiliumDepositos, labelDeposito } from "../../services/contabiliumDepositos";
import { addNotaEntrega, subscribeNotasEntregaPorCliente } from "../../services/notasEntrega";
import { VENDEDORES } from "./Vendedores";
import { PasoTransferencia } from "../mistock/TransferirStockPage";
import { printComprobante } from "../../utils/printComprobante";
import {
  subscribeRedVendedores,
  guardarVendedorRed,
  eliminarVendedorRed,
  parsearItemsExcel,
  subscribeVentasAtribuidas,
  atribuirVentaAVendedor,
} from "../../services/redesVendedores";

// Distribuidores que reparten su stock entre un equipo propio de
// sub-vendedores (ej. Federico Stortini, con 5 vendedores) — se les muestra
// la sección "Red de vendedores" en su ficha. La cuenta es manual (Excel que
// manda el distribuidor), no está atada al stock real de Contabilium.
const CONTABILIUM_IDS_CON_RED_VENDEDORES = new Set([]); // vacío: nadie usa "Red de vendedores" por ahora

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

// Buscador puntual: "me llamó este número, ¿de quién es?" — no filtra la
// lista de abajo, es una consulta aparte contra Contabilium (matchea por
// los últimos 8 dígitos, sin importar el formato con el que esté cargado).
function BuscarPorTelefono() {
  const [abierto, setAbierto] = useState(false);
  const [telefono, setTelefono] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState(null);
  const [error, setError] = useState("");

  async function buscar() {
    if (!telefono.trim()) return;
    setBuscando(true);
    setError("");
    setResultados(null);
    try {
      const r = await adminBuscarClientePorTelefono(telefono.trim());
      setResultados(r.resultados);
    } catch (e) {
      setError(e.message || "No se pudo buscar");
    } finally {
      setBuscando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
      >
        🔍 ¿De quién es este teléfono?
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/10">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
          placeholder="+54 9 11 3060-0478"
          className="rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-sky-900 dark:bg-neutral-900 dark:text-white"
        />
        <button
          onClick={buscar}
          disabled={buscando}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {buscando ? "Buscando…" : "Buscar"}
        </button>
        <button onClick={() => setAbierto(false)} className="text-xs text-slate-400 hover:text-sky-600 dark:text-neutral-500">
          Cerrar
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {resultados && resultados.length === 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">No coincide con ningún cliente de Contabilium.</p>
      )}
      {resultados && resultados.length > 0 && (
        <div className="mt-2 space-y-1">
          {resultados.map((r) => (
            <div key={r.contabiliumId} className="rounded-lg border border-sky-100 bg-white px-2.5 py-1.5 text-xs dark:border-sky-900/50 dark:bg-neutral-900">
              <span className="font-semibold text-slate-800 dark:text-white">{r.razonSocial}</span>{" "}
              <span className="text-slate-400">— {r.telefono || r.celular} {r.cuit ? `· CUIT ${r.cuit}` : ""}</span>
            </div>
          ))}
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
      .sort((a, b) =>
        onlyDeudores
          ? b.saldoDeudor - a.saldoDeudor || (a.name || "").localeCompare(b.name || "")
          : b.pagado - a.pagado || (a.name || "").localeCompare(b.name || "")
      );
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
          <p className="text-xs text-slate-400 dark:text-neutral-500">
            La ficha completa de cada cliente: deuda, facturas, stock consignado y seguimiento, todo en un solo lugar.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
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
      <BuscarPorTelefono />
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
              <th className="px-4 py-3 text-right font-medium">{onlyDeudores ? "Debe" : "Cobranzas"}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr
                key={u.id}
                onClick={() => setSelected(u.id)}
                className="cursor-pointer border-b border-slate-50 transition hover:bg-slate-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/40"
              >
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
                <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">
                  {onlyDeudores ? money(u.saldoDeudor) : money(u.pagado)}
                </td>
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

// Panel manual de "quién tiene qué" para distribuidores que reparten su
// stock entre un equipo propio de sub-vendedores (ej. Stortini). No toca
// Contabilium ni mueve stock real — el staff carga la cuenta a partir del
// Excel que manda el distribuidor, y la actualiza a mano cuando cambia.
function VendedorRedForm({ inicial, onGuardar, onCancelar }) {
  const [nombre, setNombre] = useState(inicial?.nombre || "");
  const [texto, setTexto] = useState(
    inicial?.items?.map((it) => [it.sku, it.nombre, it.cantidad].filter(Boolean).join("\t")).join("\n") || ""
  );
  const [guardando, setGuardando] = useState(false);
  const [errorLocal, setErrorLocal] = useState("");

  const itemsPreview = useMemo(() => parsearItemsExcel(texto), [texto]);
  const totalPreview = itemsPreview.reduce((acc, it) => acc + it.cantidad, 0);

  async function handleGuardar() {
    if (!nombre.trim()) {
      setErrorLocal("Falta el nombre del vendedor");
      return;
    }
    if (itemsPreview.length === 0) {
      setErrorLocal("No se reconoció ningún ítem — pegá las filas del Excel (SKU, nombre, cantidad)");
      return;
    }
    setGuardando(true);
    setErrorLocal("");
    try {
      await onGuardar({ nombre: nombre.trim(), items: itemsPreview });
    } catch (e) {
      setErrorLocal(e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-sky-200 bg-white p-3 text-sm dark:border-sky-900/50 dark:bg-neutral-900">
      <label className="block text-xs font-medium text-slate-500 dark:text-neutral-400">
        Nombre del vendedor
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="ej: Storica"
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </label>
      <label className="mt-2 block text-xs font-medium text-slate-500 dark:text-neutral-400">
        Bicicletas (pegá directo las filas del Excel — SKU, nombre y cantidad)
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={8}
          placeholder={"200022\tBICI MTB BOWIE TALLE S 2026 AZUL-CELESTE\t3\n200021\tBICI MTB BOWIE TALLE L 2026 AZUL-CELESTE\t4"}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </label>
      <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
        {itemsPreview.length} ítem(s) reconocidos · {totalPreview} bici(s) en total
      </p>
      {errorLocal && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{errorLocal}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={guardando}
          onClick={handleGuardar}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {guardando ? "Guardando…" : "✓ Guardar"}
        </button>
        <button type="button" onClick={onCancelar} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-neutral-400">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function RedDeVendedores({ distribuidorContabiliumId, actualizadoPorNombre }) {
  const [vendedores, setVendedores] = useState(null);
  const [error, setError] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [expandidoId, setExpandidoId] = useState(null);

  useEffect(() => {
    const unsub = subscribeRedVendedores(
      distribuidorContabiliumId,
      setVendedores,
      (e) => setError(e.message || "No se pudo cargar la red de vendedores")
    );
    return unsub;
  }, [distribuidorContabiliumId]);

  const totalGeneral = (vendedores || []).reduce((acc, v) => acc + Number(v.totalBicis || 0), 0);

  async function handleGuardar(id, { nombre, items }) {
    await guardarVendedorRed({ id, distribuidorContabiliumId, nombre, items, actualizadoPorNombre });
    setAgregando(false);
    setEditandoId(null);
  }

  async function handleEliminar(v) {
    if (!confirm(`¿Eliminar a "${v.nombre}" de la red de vendedores? No se puede deshacer.`)) return;
    try {
      await eliminarVendedorRed(v.id);
    } catch (e) {
      setError(e.message || "No se pudo eliminar");
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/10">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-sky-800 dark:text-sky-400">
          👥 Red de vendedores {vendedores ? `· ${totalGeneral} bici(s) en total` : ""}
        </h3>
        {!agregando && (
          <button
            type="button"
            onClick={() => setAgregando(true)}
            className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700"
          >
            + Agregar vendedor
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
        Cuenta manual de qué bicis tiene cada vendedor del equipo — no mueve stock en Contabilium, solo lleva el registro.
      </p>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {vendedores === null && <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Cargando…</p>}
      {vendedores && vendedores.length === 0 && !agregando && (
        <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Todavía no hay ningún vendedor cargado.</p>
      )}

      {agregando && (
        <VendedorRedForm onGuardar={(v) => handleGuardar(null, v)} onCancelar={() => setAgregando(false)} />
      )}

      <div className="mt-2 space-y-2">
        {(vendedores || []).map((v) =>
          editandoId === v.id ? (
            <VendedorRedForm
              key={v.id}
              inicial={v}
              onGuardar={(datos) => handleGuardar(v.id, datos)}
              onCancelar={() => setEditandoId(null)}
            />
          ) : (
            <div key={v.id} className="rounded-xl border border-sky-200 bg-white dark:border-sky-900/50 dark:bg-neutral-900">
              <button
                type="button"
                onClick={() => setExpandidoId((cur) => (cur === v.id ? null : v.id))}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="text-sm font-semibold text-slate-800 dark:text-white">{v.nombre}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-neutral-400">
                  {v.totalBicis} bici(s) {expandidoId === v.id ? "▲" : "▼"}
                </span>
              </button>
              {expandidoId === v.id && (
                <div className="border-t border-sky-100 px-3 py-2 dark:border-sky-900/40">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400 dark:text-neutral-500">
                        <th className="pb-1 font-medium">SKU</th>
                        <th className="pb-1 font-medium">Bici</th>
                        <th className="pb-1 pr-1 text-right font-medium">Cant.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(v.items || []).map((it, i) => (
                        <tr key={i} className="border-t border-slate-50 dark:border-neutral-800/60">
                          <td className="py-1 text-slate-500 dark:text-neutral-400">{it.sku || "-"}</td>
                          <td className="py-1 text-slate-700 dark:text-neutral-200">{it.nombre}</td>
                          <td className="py-1 pr-1 text-right font-semibold text-slate-800 dark:text-white">{it.cantidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {v.updatedByNombre && (
                    <p className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
                      Actualizado por {v.updatedByNombre}
                    </p>
                  )}
                  <div className="mt-1.5 flex gap-3">
                    <button type="button" onClick={() => setEditandoId(v.id)} className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400">
                      Editar
                    </button>
                    <button type="button" onClick={() => handleEliminar(v)} className="text-xs font-medium text-rose-500 hover:underline">
                      Eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// Único uid para el que hoy existe la excepción de "Ocultar cuenta" — no es
// una función general para cualquier cliente, ver el comentario donde se usa.
const CELIA_UID_OCULTAR_CUENTA = "XPVE3KleRJhHY6OdLMssCKgJM0w2";

export function ClienteDetalle({ cliente, onClose, soloLectura = false }) {
  const { user, profile } = useAuth();
  const puedeEditarNotas = puedeEditarNotasCheck(user?.email);
  const [comprobantes, setComprobantes] = useState(null);
  const [stock, setStock] = useState(null);
  const [filtroModelo, setFiltroModelo] = useState("todos");
  const [vendedorGuardando, setVendedorGuardando] = useState(false);
  const [equiposDisponibles, setEquiposDisponibles] = useState(null); // distribuidores con equipo propio (flete/comisión), ej. Alfredo Bavcevich
  const [transferStockDesde, setTransferStockDesde] = useState(null); // distribuidor { uid, name, contabiliumDepositoId, contabiliumDepositoNombre } con el que se abrió "¿pasarle bicis?" después de sumarlo al equipo
  const [equipoGuardando, setEquipoGuardando] = useState(false);
  const [equipoMsg, setEquipoMsg] = useState("");
  const [vendedoresRedFactura, setVendedoresRedFactura] = useState(null); // red de sub-vendedores de este distribuidor (si aplica)
  const [ventasAtribuidas, setVentasAtribuidas] = useState(null); // qué línea de factura ya se le atribuyó a cuál vendedor
  const [atribuyendoKey, setAtribuyendoKey] = useState(null); // `${facturaId}_${sku}` en curso
  const [atribuirError, setAtribuirError] = useState("");
  const [saldoTotal, setSaldoTotal] = useState(0);
  // Ocultar saldo/facturas en Samurai mientras se corrige algo a mano en
  // Contabilium (ej. un crédito que ya se resolvió por fuera del sistema
  // pero todavía no se cargó ahí) — es solo una tapa visual en este panel,
  // no toca ni corrige Contabilium, que sigue siendo la fuente real.
  const [ocultarCuenta, setOcultarCuenta] = useState(null); // null=cargando, false=visible, {motivo,...}=oculto
  const [businessDetail, setBusinessDetail] = useState(null); // porFactura con bicis por factura, para el contador de "Bicis vendidas"
  const [error, setError] = useState("");
  const [showCobranzas, setShowCobranzas] = useState(false);
  const [depositos, setDepositos] = useState([]);
  const [telefono, setTelefono] = useState(undefined); // undefined=cargando, null=no tiene
  const [celular, setCelular] = useState(undefined); // undefined=cargando, null=no tiene
  const [editandoTelefono, setEditandoTelefono] = useState(false);
  const [telefonoInput, setTelefonoInput] = useState("");
  const [celularInput, setCelularInput] = useState("");
  const [guardandoTelefono, setGuardandoTelefono] = useState(false);
  const [ubicacion, setUbicacion] = useState(undefined); // undefined=cargando, null=no tiene
  const [instagramDetectado, setInstagramDetectado] = useState(null); // sugerido desde Observaciones de Contabilium
  const [editandoInstagram, setEditandoInstagram] = useState(false);
  const [instagramInput, setInstagramInput] = useState("");
  const [guardandoInstagram, setGuardandoInstagram] = useState(false);
  const [editandoBicicleteria, setEditandoBicicleteria] = useState(false);
  const [bicicleteriaInput, setBicicleteriaInput] = useState("");
  const [guardandoBicicleteria, setGuardandoBicicleteria] = useState(false);
  const [facturaAbierta, setFacturaAbierta] = useState(null); // id de la factura desplegada
  const [itemsPorFactura, setItemsPorFactura] = useState({}); // id -> items[] | "loading" | "error"
  const [audits, setAudits] = useState(null); // null=cargando, []=sin videos
  const [showAudits, setShowAudits] = useState(false);
  const [videoAbierto, setVideoAbierto] = useState(null); // id del audit con el player desplegado
  const [pagosReportados, setPagosReportados] = useState(null);
  const [cheques, setCheques] = useState(null);
  const [ventasReportadas, setVentasReportadas] = useState(null);
  const [revisandoPagoId, setRevisandoPagoId] = useState(null);
  const [pagoConfirmandoId, setPagoConfirmandoId] = useState(null); // id del pago reportado con el form de "cargar en Contabilium" abierto
  const [emitiendoVentaId, setEmitiendoVentaId] = useState(null); // id de la venta reportada que se está facturando
  const [ventasSeleccionadas, setVentasSeleccionadas] = useState(new Set());
  const [facturandoSeleccion, setFacturandoSeleccion] = useState(false);
  const [eliminandoVentaId, setEliminandoVentaId] = useState(null);
  const [programStart, setProgramStart] = useState(null);
  const [reciboAbierto, setReciboAbierto] = useState(null); // id de la factura con el form de recibo abierto
  const [cobranzaCuentaAbierta, setCobranzaCuentaAbierta] = useState(false);
  const [remitoDesdeFactura, setRemitoDesdeFactura] = useState(null); // { items } de la factura desde la que se pidió "Hacer un remito"
  const [soloImpagas, setSoloImpagas] = useState(false);
  const [notasEntrega, setNotasEntrega] = useState([]);
  const [nuevaNotaChofer, setNuevaNotaChofer] = useState("");
  const [guardandoNotaChofer, setGuardandoNotaChofer] = useState(false);

  useEffect(() => {
    getAuditProgramStart().then(setProgramStart).catch(() => setProgramStart(null));
  }, []);

  useEffect(() => {
    getContabiliumDepositos()
      .then(setDepositos)
      .catch((e) => console.error("Error cargando depósitos:", e));
  }, []);

  useEffect(() => {
    if (!cliente.id) {
      setOcultarCuenta(false);
      return;
    }
    const unsub = onSnapshot(doc(db, "users", cliente.id), (snap) => {
      setOcultarCuenta(snap.data()?.ocultarCuentaEnSamurai || false);
    });
    return unsub;
  }, [cliente.id]);

  useEffect(() => {
    return subscribeBusinessDashboardDetail(setBusinessDetail);
  }, []);

  const depositoDeCliente = useMemo(
    () => depositos.find((d) => d.id === cliente.contabiliumDepositoId) || null,
    [depositos, cliente.contabiliumDepositoId]
  );

  // Notas que el chofer va dejando por entrega — separadas de
  // seguimiento.historial, de solo lectura acá.
  useEffect(() => {
    if (!cliente.id) return;
    const unsub = subscribeNotasEntregaPorCliente(cliente.id, setNotasEntrega);
    return unsub;
  }, [cliente.id]);

  async function handleAgregarNotaChofer() {
    if (!nuevaNotaChofer.trim() || !user) return;
    setGuardandoNotaChofer(true);
    try {
      await addNotaEntrega({
        clienteUid: cliente.id,
        clienteNombre: cliente.name,
        clienteContabiliumId: cliente.contabiliumId,
        choferUid: user.uid,
        choferNombre: profile?.name ? `${profile.name} (admin)` : "Admin",
        texto: nuevaNotaChofer,
      });
      setNuevaNotaChofer("");
    } finally {
      setGuardandoNotaChofer(false);
    }
  }

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

  // Descarga el PDF de UNA factura ya emitida (no recién generada) —
  // primero el real de Contabilium, y si ningún endpoint candidato
  // funciona, cae al render propio de Samurai, igual que al emitir.
  const [descargandoFacturaId, setDescargandoFacturaId] = useState(null);
  const [descargandoTodas, setDescargandoTodas] = useState(false);
  // Diagnóstico visible en pantalla de qué endpoints candidatos se
  // probaron para el PDF real de Contabilium — así no hace falta abrir la
  // consola del navegador ni entrar a Contabilium, solo copiar esto.
  const [pdfDebugIntentos, setPdfDebugIntentos] = useState(null);
  async function descargarFacturaPdf(c) {
    try {
      const pdfResultado = await adminDescargarPdfComprobante(c.Id);
      if (pdfResultado.ok && pdfResultado.pdfBase64) {
        const bytes = atob(pdfResultado.pdfBase64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${c.Numero || c.Id}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      setPdfDebugIntentos({ factura: c.Numero, intentos: pdfResultado.intentos });
    } catch (e) {
      setPdfDebugIntentos({ factura: c.Numero, error: e.message });
    }
    const detalle = itemsPorFactura[c.Id] && Array.isArray(itemsPorFactura[c.Id]) ? { ...c, Items: itemsPorFactura[c.Id] } : await adminGetComprobanteDetail(c.Id);
    printComprobante(detalle);
  }

  async function handleDescargarUnaFactura(c) {
    setDescargandoFacturaId(c.Id);
    try {
      await descargarFacturaPdf(c);
    } catch (e) {
      setError(e.message || "No se pudo descargar esta factura");
    } finally {
      setDescargandoFacturaId(null);
    }
  }

  // Descarga todas las facturas que están listadas ahora mismo (respeta el
  // filtro "solo impagas" si está activo) — el navegador va a pedir
  // permiso para descargas múltiples la primera vez, es normal.
  async function handleDescargarTodasLasFacturas() {
    const lista = soloImpagas ? comprobantes.filter((c) => c.Saldo > 0) : comprobantes;
    if (!lista || lista.length === 0) return;
    setDescargandoTodas(true);
    try {
      for (const c of lista) {
        await descargarFacturaPdf(c);
        // Pausa corta entre cada descarga — si se disparan todas juntas el
        // navegador bloquea las descargas múltiples como si fuera spam.
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch (e) {
      setError(e.message || "No se pudieron descargar todas las facturas");
    } finally {
      setDescargandoTodas(false);
    }
  }

  const seg = cliente.seguimiento || {};
  const [contactado, setContactado] = useState(!!seg.contactado);
  const [cuentaCoincide, setCuentaCoincide] = useState(seg.cuentaCoincide ?? "");
  // Arranca vacío a propósito (no seg.notas) — cada nota nueva es una
  // entrada independiente del historial, no una edición de la anterior.
  const [notas, setNotas] = useState("");
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
    partes.push(
      "Te cuento que estamos con una administración nueva, poniéndonos al día con todas las cuentas — así que si ya venías hablando esto con alguien más, disculpá si repito algo. ¿Pudiste entrar a usar el sistema?"
    );
    let tieneContenidoEspecifico = false;

    if (cliente.contabiliumDepositoId != null && audits) {
      const yaAvisadoAntes = (seg.historial || []).some((h) =>
        (h.tareaPendiente || h.notas || "").toLowerCase().includes("video")
      );

      if (audits.length === 0) {
        partes.push(
          "Vimos que todavía no se registró ningún video de auditoría de stock de tu cuenta. Es un paso simple: entrás a tu cuenta de Samurai, vas a \"Mi Stock\" y tocás el botón \"🎥 Grabar video\". Ahí filmás pausado todas las bicicletas que tenés consignadas, tanto las que están en caja como las que están armadas o fuera de caja, marcándolas una por una a medida que filmás. Te pido que lo hagas a la brevedad, hoy o mañana si es posible."
        );
        tieneContenidoEspecifico = true;
      } else {
        const ultima = audits[0];
        const vencido = isAuditOverdue(ultima.createdAt, programStart, cliente.auditIntervalDays);
        const porVencer = isAuditDueSoon(ultima.createdAt, programStart, cliente.auditIntervalDays);
        if (vencido && yaAvisadoAntes) {
          partes.push(
            "Te escribo nuevamente porque la auditoría de stock de tu cuenta sigue vencida y todavía no recibimos el video actualizado, a pesar del aviso anterior. Te pido por favor que lo resuelvas hoy mismo desde \"Mi Stock\" → \"🎥 Grabar video\", mostrando pausado y una por una todas las bicicletas, con o sin caja."
          );
          tieneContenidoEspecifico = true;
        } else if (vencido || porVencer) {
          partes.push(
            "Les escribo para pedirles si por favor pueden revisar el vencimiento de los videos publicados para poder avanzar con el control de stock. También aprovecho para comentarles que es de suma importancia que graben los videos de forma que podamos visualizar y contabilizar las unidades ya sea con o sin caja, pausado y marcando una a una a medida que filman. De ser posible hoy y mañana aguardamos los nuevos videos."
          );
          tieneContenidoEspecifico = true;
        }
      }
    }

    if (seg.cuentaCoincide === false && seg.notas) {
      partes.push(
        `Además, en la última revisión de tu cuenta corriente quedó registrado: "${seg.notas}". Te pedimos que nos confirmes esto a la brevedad para poder resolverlo.`
      );
      tieneContenidoEspecifico = true;
    }

    if (seg.tareaPendiente) {
      partes.push(`Por otro lado, nos quedó pendiente: ${seg.tareaPendiente}.`);
      tieneContenidoEspecifico = true;
    }

    if (!tieneContenidoEspecifico) {
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

  useEffect(() => {
    adminListDistribuidoresConEquipo()
      .then((r) => setEquiposDisponibles(r.distribuidores || []))
      .catch(() => setEquiposDisponibles([]));
  }, []);

  // Para distribuidores con red de sub-vendedores (ej. Stortini): trae su
  // lista de vendedores y qué líneas de factura ya se les atribuyó, para
  // poder marcar "esto lo vendió Fulano" desde cada factura y descontarle
  // el stock que tiene cargado.
  useEffect(() => {
    if (!cliente.contabiliumId || !CONTABILIUM_IDS_CON_RED_VENDEDORES.has(cliente.contabiliumId)) {
      setVendedoresRedFactura(null);
      setVentasAtribuidas(null);
      return;
    }
    const u1 = subscribeRedVendedores(cliente.contabiliumId, setVendedoresRedFactura, () => setVendedoresRedFactura([]));
    const u2 = subscribeVentasAtribuidas(cliente.contabiliumId, setVentasAtribuidas, () => setVentasAtribuidas([]));
    return () => {
      u1();
      u2();
    };
  }, [cliente.contabiliumId]);

  async function handleAtribuirVenta(c, it, vendedor) {
    const sku = it.Codigo || it.Sku || "";
    const key = `${c.Id}_${sku}`;
    setAtribuyendoKey(key);
    setAtribuirError("");
    try {
      await atribuirVentaAVendedor({
        facturaId: c.Id,
        facturaNumero: c.Numero,
        sku,
        cantidad: Number(it.Cantidad) || 1,
        itemNombre: it.Concepto || it.Descripcion || "",
        vendedorId: vendedor.id,
        vendedorNombre: vendedor.nombre,
        distribuidorContabiliumId: cliente.contabiliumId,
      });
    } catch (e) {
      setAtribuirError(e.message || "No se pudo atribuir la venta");
    } finally {
      setAtribuyendoKey(null);
    }
  }

  // Suma este cliente al equipo (flete/comisión) de un distribuidor con
  // `vendedoresAsignados` — ej. Alfredo Bavcevich — directo desde la ficha,
  // sin depender del buscador de la pantalla Vendedores.
  async function handleAsignarAEquipo(distribuidorUid) {
    if (!distribuidorUid) return;
    setEquipoGuardando(true);
    setEquipoMsg("");
    try {
      await adminAsignarClienteADistribuidor(distribuidorUid, cliente.id, {});
      setEquipoMsg("✓ Agregado");
      // Si ese distribuidor tiene depósito propio, puede que ya tenga ahí
      // guardadas bicis destinadas a este cliente nuevo — ofrecemos pasarlas
      // al toque, con el mismo panel que usa el distribuidor para mandarle
      // stock a sus clientes (con o sin remito), en vez de que quede como un
      // paso suelto que alguien tiene que acordarse de hacer después.
      const distribuidor = (equiposDisponibles || []).find((d) => d.uid === distribuidorUid);
      if (distribuidor?.contabiliumDepositoId) {
        setTransferStockDesde(distribuidor);
      }
    } catch (e) {
      setEquipoMsg(e.message || "No se pudo agregar");
    } finally {
      setEquipoGuardando(false);
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
    setNotas("");
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
          vendedorAsignado: cliente.vendedor || null,
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
        registrarActividadCliente({
          clienteId: cliente.id,
          clienteNombre: cliente.name,
          vendedor: cliente.vendedor,
          tipo: "nota",
          detalle: notas || tareaPendiente || null,
          realizadoPor: user?.email,
        });
      }
      setImagenesNota([]);
      setNotas("");
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

  // Factura UNA venta reportada puntual (la misma automatización que usa
  // la pantalla "Ventas reportadas") directamente desde la ficha del
  // cliente — así no hace falta salir a buscarla en otro lado para
  // resolver la reserva de stock que genera mientras está pendiente.
  async function handleFacturarVentaReportada(venta) {
    if (
      !confirm(
        `Vas a EMITIR UNA FACTURA REAL en Contabilium (con CAE, irreversible) por:\n\n${venta.name || venta.sku} x${venta.quantity} — ${money(Number(venta.unitPrice || 0) * Number(venta.quantity || 0))}\n\n¿Confirmás?`
      )
    )
      return;
    setEmitiendoVentaId(venta.id);
    try {
      await emitirFacturaVenta([venta.id]);
      setVentasReportadas((prev) => prev.map((v) => (v.id === venta.id ? { ...v, status: "facturado" } : v)));
      recargarFacturas();
    } catch (e) {
      alert(e.message || "No se pudo facturar la venta reportada.");
    } finally {
      setEmitiendoVentaId(null);
    }
  }

  function toggleVentaSeleccionada(id) {
    setVentasSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFacturarSeleccionadas() {
    const ids = Array.from(ventasSeleccionadas);
    if (ids.length === 0) return;
    const seleccionadas = ventasReportadas.filter((v) => ids.includes(v.id));
    const totalMonto = seleccionadas.reduce((a, v) => a + Number(v.unitPrice || 0) * Number(v.quantity || 0), 0);
    if (
      !confirm(
        `Vas a EMITIR ${ids.length} FACTURA${ids.length === 1 ? "" : "S"} REAL${ids.length === 1 ? "" : "ES"} en Contabilium (con CAE, irreversible) por un total de ${money(totalMonto)}.\n\n¿Confirmás?`
      )
    )
      return;
    setFacturandoSeleccion(true);
    try {
      await emitirFacturaVenta(ids);
      setVentasReportadas((prev) => prev.map((v) => (ids.includes(v.id) ? { ...v, status: "facturado" } : v)));
      setVentasSeleccionadas(new Set());
      recargarFacturas();
    } catch (e) {
      alert(e.message || "No se pudieron facturar las ventas seleccionadas.");
    } finally {
      setFacturandoSeleccion(false);
    }
  }

  async function handleEliminarVentaReportada(venta) {
    if (
      !confirm(
        `Vas a eliminar este reporte de venta (no se factura, no queda registrado):\n\n${venta.name || venta.sku} x${venta.quantity} — ${money(Number(venta.unitPrice || 0) * Number(venta.quantity || 0))}\n\nUsalo si la vas a facturar directo desde el botón "Facturar" del catálogo en vez de desde acá. ¿Confirmás?`
      )
    )
      return;
    setEliminandoVentaId(venta.id);
    try {
      await deleteSaleRequest(venta.id);
      setVentasReportadas((prev) => prev.filter((v) => v.id !== venta.id));
      setVentasSeleccionadas((prev) => {
        const next = new Set(prev);
        next.delete(venta.id);
        return next;
      });
    } catch (e) {
      alert(e.message || "No se pudo eliminar el reporte de venta.");
    } finally {
      setEliminandoVentaId(null);
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

    // Ventas reportadas por el distribuidor que ya tienen factura/COT
    // generada automáticamente — para poder aclarar en el detalle de la
    // factura de dónde salió, en vez de que parezca una factura suelta
    // sin origen claro.
    setVentasReportadas(null);
    if (cliente.id) {
      getDocs(query(collection(db, "saleRequests"), where("distributorUid", "==", cliente.id)))
        .then((snap) => {
          if (cancelled) return;
          setVentasReportadas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        })
        .catch(() => { if (!cancelled) setVentasReportadas([]); });
    } else {
      setVentasReportadas([]);
    }

    setTelefono(undefined);
    setCelular(undefined);
    setUbicacion(undefined);
    setInstagramDetectado(null);
    if (cliente.contabiliumId) {
      adminGetClientPhone(cliente.contabiliumId)
        .then((r) => {
          if (cancelled) return;
          setTelefono(r.telefono || null);
          setCelular(r.celular || null);
          const partes = [r.ciudad, r.provincia].filter(Boolean);
          setUbicacion(partes.length ? partes.join(", ") : null);
          setInstagramDetectado(r.instagramDetectado || null);
        })
        .catch(() => {
          if (cancelled) return;
          setTelefono(null);
          setCelular(null);
          setUbicacion(null);
        });
    } else {
      setTelefono(null);
      setCelular(null);
      setUbicacion(null);
    }

    return () => { cancelled = true; };
  }, [cliente]);

  function abrirEdicionTelefono() {
    setTelefonoInput(telefono || "");
    setCelularInput(celular || "");
    setEditandoTelefono(true);
  }

  async function handleGuardarTelefonos() {
    setGuardandoTelefono(true);
    try {
      const r = await adminActualizarTelefonosCliente(cliente.contabiliumId, {
        telefono: telefonoInput.trim(),
        celular: celularInput.trim(),
      });
      setTelefono(r.telefono || null);
      setCelular(r.celular || null);
      setEditandoTelefono(false);
    } catch (e) {
      setError(e.message || "No se pudo guardar el teléfono");
    } finally {
      setGuardandoTelefono(false);
    }
  }

  async function handleGuardarInstagram() {
    setGuardandoInstagram(true);
    try {
      const limpio = instagramInput.trim().replace(/^@/, "");
      await updateDoc(doc(db, "users", cliente.id), { instagram: limpio || null });
      setEditandoInstagram(false);
    } catch (e) {
      setError(e.message || "No se pudo guardar el Instagram");
    } finally {
      setGuardandoInstagram(false);
    }
  }

  async function handleGuardarBicicleteria() {
    setGuardandoBicicleteria(true);
    try {
      const limpio = bicicleteriaInput.trim();
      await updateDoc(doc(db, "users", cliente.id), { bicicleteria: limpio || null });
      setEditandoBicicleteria(false);
    } catch (e) {
      setError(e.message || "No se pudo guardar la bicicletería");
    } finally {
      setGuardandoBicicleteria(false);
    }
  }

  const loading = comprobantes === null || stock === null;
  const saldoPendiente = ocultarCuenta?.activo ? 0 : saldoTotal;
  const totalFacturado = ocultarCuenta?.activo ? 0 : (comprobantes || []).reduce((acc, c) => acc + Number(c.Total || 0), 0);
  // Bicis vendidas: suma de la cantidad de bicis de cada factura real
  // (FCA/FCB/FCC) de este cliente — sale del mismo detalle que ya usan
  // Resumen Mensual y Contador Diario (meta/businessDashboardDetail,
  // sincronizado), no hay que pedirle de nuevo los ítems a Contabilium
  // factura por factura acá.
  const bicisVendidas = ocultarCuenta?.activo
    ? 0
    : (businessDetail?.porFactura || [])
        .filter((f) => f.idCliente === cliente.contabiliumId)
        .reduce((acc, f) => acc + Number(f.bicis || 0), 0);
  const cantidadFacturas = ocultarCuenta?.activo ? 0 : (comprobantes || []).length;
  const totalCobranzas = ocultarCuenta?.activo ? 0 : cliente.pagado || 0;
  const cobranzasListVisible = ocultarCuenta?.activo ? [] : cliente.cobranzasList || [];
  const stockBicis = (stock || []).filter((s) => (s.category || "").toUpperCase() === "BICICLETAS");
  // stockDisponible ya viene del backend restando las ventas reportadas
  // todavía no facturadas (getPendingSoldBySku) — usarlo acá evita que este
  // resumen quede desactualizado hasta que alguien facture y ajuste el
  // stock real en Contabilium a mano.
  const totalBicis = stockBicis.reduce((acc, s) => acc + Number(s.stockDisponible ?? s.stockActual ?? 0), 0);
  const valorConsignado = stockBicis.reduce((acc, s) => acc + Number(s.stockDisponible ?? s.stockActual ?? 0) * Number(s.priceArs ?? 0), 0);

  return (
    <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{cliente.name || "Sin nombre"}</h2>
            <p className="text-sm text-slate-500 dark:text-neutral-400">{cliente.cuit || "sin CUIT"}</p>
            {cliente.contabiliumDepositoId != null && (
              <p className="text-xs text-slate-400 dark:text-neutral-500">
                Su depósito es: {depositoDeCliente ? labelDeposito(depositoDeCliente) : `Contabilium #${cliente.contabiliumDepositoId}`}
              </p>
            )}
            {editandoTelefono ? (
              <div className="mt-1 space-y-1.5 rounded-lg border border-slate-200 p-2 text-xs dark:border-neutral-700" onClick={(e) => e.stopPropagation()}>
                <label className="block">
                  <span className="text-slate-400 dark:text-neutral-500">Teléfono</span>
                  <input
                    type="text"
                    value={telefonoInput}
                    onChange={(e) => setTelefonoInput(e.target.value)}
                    autoFocus
                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-400 dark:text-neutral-500">Celular (opcional, un segundo número)</span>
                  <input
                    type="text"
                    value={celularInput}
                    onChange={(e) => setCelularInput(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  />
                </label>
                <div className="flex gap-2 pt-0.5">
                  <button
                    onClick={handleGuardarTelefonos}
                    disabled={guardandoTelefono}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-60"
                  >
                    {guardandoTelefono ? "Guardando…" : "Guardar"}
                  </button>
                  <button onClick={() => setEditandoTelefono(false)} className="text-xs text-slate-400 hover:text-slate-600">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
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
                  {!soloLectura && cliente.contabiliumId && (
                    <button
                      onClick={(e) => { e.stopPropagation(); abrirEdicionTelefono(); }}
                      className="ml-1.5 text-xs text-slate-400 underline hover:text-slate-600"
                    >
                      editar
                    </button>
                  )}
                </p>
                {celular && (
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">
                    📱 {celular}{" "}
                    <a
                      href={`https://wa.me/54${celular.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ml-1 text-emerald-600 underline hover:text-emerald-700 dark:text-emerald-400"
                    >
                      WhatsApp →
                    </a>
                  </p>
                )}
              </>
            )}
            <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">
              {ubicacion === undefined ? "📍 cargando…" : ubicacion ? `📍 ${ubicacion}` : "📍 sin ubicación en Contabilium"}
            </p>
            <div className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">
              {editandoInstagram ? (
                <span className="inline-flex items-center gap-1.5">
                  📷
                  <input
                    type="text"
                    autoFocus
                    value={instagramInput}
                    onChange={(e) => setInstagramInput(e.target.value)}
                    placeholder="usuario (sin @)"
                    onClick={(e) => e.stopPropagation()}
                    className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGuardarInstagram(); }}
                    disabled={guardandoInstagram}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-60"
                  >
                    {guardandoInstagram ? "..." : "Guardar"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditandoInstagram(false); }}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Cancelar
                  </button>
                </span>
              ) : cliente.instagram ? (
                <>
                  📷{" "}
                  <a
                    href={`https://instagram.com/${cliente.instagram}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-sky-600 underline hover:text-sky-700 dark:text-sky-400"
                  >
                    @{cliente.instagram}
                  </a>{" "}
                  {!soloLectura && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInstagramInput(cliente.instagram); setEditandoInstagram(true); }}
                      className="text-xs text-slate-400 underline hover:text-slate-600"
                    >
                      editar
                    </button>
                  )}
                </>
              ) : (
                <>
                  📷 sin Instagram cargado
                  {instagramDetectado && (
                    <>
                      {" "}
                      — detectado en Contabilium:{" "}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setInstagramInput(instagramDetectado);
                          setEditandoInstagram(true);
                        }}
                        className="font-semibold text-sky-600 underline hover:text-sky-700 dark:text-sky-400"
                      >
                        @{instagramDetectado}
                      </button>
                    </>
                  )}
                  {!soloLectura && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInstagramInput(""); setEditandoInstagram(true); }}
                      className="ml-1 text-xs text-slate-400 underline hover:text-slate-600"
                    >
                      agregar
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">
              {editandoBicicleteria ? (
                <span className="inline-flex items-center gap-1.5">
                  🏪
                  <input
                    type="text"
                    autoFocus
                    value={bicicleteriaInput}
                    onChange={(e) => setBicicleteriaInput(e.target.value)}
                    placeholder="Nombre de la bicicletería / sucursal"
                    onClick={(e) => e.stopPropagation()}
                    className="w-56 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGuardarBicicleteria(); }}
                    disabled={guardandoBicicleteria}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-60"
                  >
                    {guardandoBicicleteria ? "..." : "Guardar"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditandoBicicleteria(false); }}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Cancelar
                  </button>
                </span>
              ) : cliente.bicicleteria ? (
                <>
                  🏪 {cliente.bicicleteria}{" "}
                  {!soloLectura && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setBicicleteriaInput(cliente.bicicleteria); setEditandoBicicleteria(true); }}
                      className="text-xs text-slate-400 underline hover:text-slate-600"
                    >
                      editar
                    </button>
                  )}
                </>
              ) : (
                <>
                  🏪 sin bicicletería cargada
                  {!soloLectura && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setBicicleteriaInput(""); setEditandoBicicleteria(true); }}
                      className="ml-1 text-xs text-slate-400 underline hover:text-slate-600"
                    >
                      agregar
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">
            {!soloLectura && (
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
            )}
            {!soloLectura && equiposDisponibles && equiposDisponibles.length > 0 && (
              <div className="flex items-center gap-1">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const uid = e.target.value;
                    e.target.value = "";
                    if (uid) handleAsignarAEquipo(uid);
                  }}
                  disabled={equipoGuardando}
                  title="Sumar a la cartera de flete/comisión de un distribuidor con equipo"
                  className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                >
                  <option value="" disabled>
                    + Sumar al equipo de…
                  </option>
                  {equiposDisponibles.map((d) => (
                    <option key={d.uid} value={d.uid}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {equipoMsg && <span className="text-[11px] text-slate-400">{equipoMsg}</span>}
              </div>
            )}
            {!soloLectura && cliente.contabiliumId && (
              <button
                onClick={() => setFacturarOpen(true)}
                className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
              >
                🧾 Facturar
              </button>
            )}
            {!soloLectura && cliente.contabiliumId && (
              <button
                onClick={() => setReciboModalOpen(true)}
                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
              >
                💳 Comprobante
              </button>
            )}
            {!soloLectura && cliente.contabiliumId && (
              <a
                href={`/admin/pedidos-pendientes?clienteNombre=${encodeURIComponent(
                  cliente.name || ""
                )}&clienteContabiliumId=${cliente.contabiliumId}${telefono ? `&clienteTelefono=${encodeURIComponent(telefono)}` : ""}`}
                title="Buscar stock en Lavalle/Cañuelas/Credifin para mandarle a este cliente"
                className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
              >
                📦 Pedir bici
              </a>
            )}
            {/* "Ocultar cuenta" no se muestra en todas las fichas — es una
                excepción puntual (hoy solo Celia Antonella Acosta, mientras
                se corrige su saldo en Contabilium), no un botón genérico
                para cualquier cliente. */}
            {!soloLectura && (cliente.id === CELIA_UID_OCULTAR_CUENTA || ocultarCuenta?.activo) && (
              <button
                onClick={async () => {
                  if (ocultarCuenta?.activo) {
                    await updateDoc(doc(db, "users", cliente.id), { ocultarCuentaEnSamurai: { activo: false } });
                    return;
                  }
                  const motivo = window.prompt(
                    "¿Por qué ocultás el saldo y las facturas de este cliente en Samurai? (queda registrado, Contabilium no se toca)"
                  );
                  if (motivo === null) return;
                  await updateDoc(doc(db, "users", cliente.id), {
                    ocultarCuentaEnSamurai: {
                      activo: true,
                      motivo: motivo.trim(),
                      creadoPorNombre: profile?.name || user?.email || "Admin",
                      createdAt: serverTimestamp(),
                    },
                  });
                }}
                title={ocultarCuenta?.activo ? `Oculto desde Samurai — motivo: ${ocultarCuenta.motivo || "(sin motivo)"}` : "Mostrar en Samurai saldo $0 y sin facturas, mientras se corrige en Contabilium"}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  ocultarCuenta?.activo
                    ? "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-500/10 dark:text-rose-400"
                    : "border border-slate-200 text-slate-500 hover:border-slate-300 dark:border-neutral-700 dark:text-neutral-400"
                }`}
              >
                {ocultarCuenta?.activo ? "👁️ Cuenta oculta" : "🙈 Ocultar cuenta"}
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

        {!soloLectura && cliente.contabiliumId && CONTABILIUM_IDS_CON_RED_VENDEDORES.has(cliente.contabiliumId) && (
          <RedDeVendedores
            distribuidorContabiliumId={cliente.contabiliumId}
            actualizadoPorNombre={profile?.name || user?.email || "Staff"}
          />
        )}

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
                label="Bicis vendidas"
                value={bicisVendidas}
                accent="sky"
                source="Suma de bicis en todas las facturas reales, historial completo"
              />
              <SummaryTile
                label={saldoPendiente > 0 ? "Debe" : saldoPendiente < 0 ? "Saldo" : "Al día"}
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
              <SummaryTile label="Facturas" value={cantidadFacturas} source="Cantidad de facturas, historial completo" />
              <button onClick={() => setShowCobranzas((v) => !v)} className="w-full text-left">
                <SummaryTile
                  label={`Cobranzas ${showCobranzas ? "▲" : "▼"}`}
                  value={money(totalCobranzas)}
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

            {ventasReportadas && ventasReportadas.filter((v) => v.status === "pendiente").length > 0 && (
              <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
                <p className="mb-2 text-sm font-semibold text-sky-900 dark:text-sky-300">
                  🚲 Ventas reportadas pendientes de facturar ({ventasReportadas.filter((v) => v.status === "pendiente").length})
                </p>
                <p className="mb-3 text-xs text-sky-700 dark:text-sky-400">
                  El cliente reportó que ya vendió esto — mientras no se facture, la unidad queda reservada (no cuenta como disponible en "Facturar"). Si vas a facturarla directo desde el botón "Facturar" del catálogo, eliminá el reporte con 🗑️ para liberar la unidad.
                </p>
                {!soloLectura && ventasSeleccionadas.size > 0 && (
                  <button
                    onClick={handleFacturarSeleccionadas}
                    disabled={facturandoSeleccion}
                    className="mb-3 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
                  >
                    {facturandoSeleccion ? "Facturando…" : `✓ Facturar seleccionadas (${ventasSeleccionadas.size})`}
                  </button>
                )}
                <div className="space-y-2">
                  {ventasReportadas.filter((v) => v.status === "pendiente").map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm dark:border-sky-900/50 dark:bg-neutral-900">
                      <div className="flex min-w-0 items-center gap-2">
                        {!soloLectura && (
                          <input
                            type="checkbox"
                            checked={ventasSeleccionadas.has(v.id)}
                            onChange={() => toggleVentaSeleccionada(v.id)}
                            className="h-4 w-4 shrink-0 accent-sky-600"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">{v.name || `SKU ${v.sku}`} x{v.quantity}</p>
                          <p className="text-xs text-slate-400 dark:text-neutral-500">
                            {money(Number(v.unitPrice || 0) * Number(v.quantity || 0))} · {v.createdAt?.toDate ? formatFecha(v.createdAt.toDate().toISOString().slice(0, 10)) : ""}
                          </p>
                        </div>
                      </div>
                      {!soloLectura && (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            onClick={() => handleFacturarVentaReportada(v)}
                            disabled={emitiendoVentaId === v.id}
                            className="rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
                          >
                            {emitiendoVentaId === v.id ? "Facturando…" : "✓ Facturar"}
                          </button>
                          <button
                            onClick={() => handleEliminarVentaReportada(v)}
                            disabled={eliminandoVentaId === v.id}
                            title="Eliminar reporte (para facturarla desde otro lado)"
                            className="rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/20"
                          >
                            {eliminandoVentaId === v.id ? "…" : "🗑️"}
                          </button>
                        </div>
                      )}
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
                        {!soloLectura && (
                          <div className="ml-auto flex gap-1.5">
                            <button
                              onClick={() => setPagoConfirmandoId(pagoConfirmandoId === p.id ? null : p.id)}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700"
                            >
                              {pagoConfirmandoId === p.id ? "✕ Cancelar" : "✓ Cargar en Contabilium"}
                            </button>
                            <button
                              onClick={() => handleRevisarPago(p, false)}
                              disabled={revisandoPagoId === p.id}
                              className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:hover:bg-rose-950/30"
                            >
                              Rechazar
                            </button>
                          </div>
                        )}
                      </div>
                      {pagoConfirmandoId === p.id && (
                        <ConfirmarPagoForm
                          pago={p}
                          contabiliumId={cliente.contabiliumId}
                          facturasAbiertas={(comprobantes || []).filter((c) => Number(c.Saldo || 0) > 0)}
                          onClose={() => setPagoConfirmandoId(null)}
                          onDone={(r) => {
                            setPagoConfirmandoId(null);
                            setPagosReportados((prev) =>
                              prev.map((x) => (x.id === p.id ? { ...x, estado: "confirmado_manual", nroComprobanteRecibo: r.nroComprobante } : x))
                            );
                            recargarFacturas();
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showCobranzas && (
              <div className="mt-3">
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Cobranzas ({cobranzasListVisible.length})</p>
                {cobranzasListVisible.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-neutral-500">Sin cobranzas sincronizadas para este CUIT.</p>
                ) : (
                  <div className="space-y-1.5">
                    {cobranzasListVisible.map((c) => (
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
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Facturas</p>
                <div className="flex items-center gap-2">
                  {!soloLectura && (
                    <button
                      onClick={() => setCobranzaCuentaAbierta((v) => !v)}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                    >
                      {cobranzaCuentaAbierta ? "✕ Cancelar" : "➕ Cobranza a cuenta"}
                    </button>
                  )}
                  {(comprobantes || []).length > 0 && (
                    <button
                      onClick={() => setSoloImpagas((v) => !v)}
                      className={`rounded-lg border px-2 py-1 text-xs font-medium transition ${
                        soloImpagas
                          ? "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500 dark:bg-rose-950/40 dark:text-rose-400"
                          : "border-slate-200 text-slate-500 hover:border-rose-300 dark:border-neutral-700 dark:text-neutral-400"
                      }`}
                    >
                      {soloImpagas ? "✓ " : ""}Solo impagas (sin recibo)
                    </button>
                  )}
                  {(comprobantes || []).length > 0 && (
                    <button
                      onClick={handleDescargarTodasLasFacturas}
                      disabled={descargandoTodas}
                      className="rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400"
                    >
                      {descargandoTodas ? "Descargando…" : "⬇️ Descargar todas"}
                    </button>
                  )}
                </div>
              </div>
              {pdfDebugIntentos && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-700 dark:bg-amber-950/30">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold text-amber-800 dark:text-amber-300">
                      PDF real de Contabilium no disponible para {pdfDebugIntentos.factura} — bajó el de respaldo. Copiá esto y pasáselo a Claude:
                    </span>
                    <button onClick={() => setPdfDebugIntentos(null)} className="text-amber-500 hover:text-amber-700">
                      ✕
                    </button>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-[10px] text-slate-700 dark:bg-neutral-950 dark:text-neutral-300">
                    {JSON.stringify(pdfDebugIntentos, null, 2)}
                  </pre>
                </div>
              )}
              {cobranzaCuentaAbierta && (
                <CobranzaACuentaForm
                  contabiliumId={cliente.contabiliumId}
                  onClose={() => setCobranzaCuentaAbierta(false)}
                  onDone={() => {
                    setCobranzaCuentaAbierta(false);
                    recargarFacturas();
                  }}
                />
              )}
              {ocultarCuenta?.activo ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Sin facturas.</p>
              ) : (comprobantes || []).length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Sin facturas en los últimos 2 años.</p>
              ) : (soloImpagas ? comprobantes.filter((c) => c.Saldo > 0) : comprobantes).length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">No hay facturas impagas.</p>
              ) : (
                <div className="space-y-1.5">
                  {(soloImpagas ? comprobantes.filter((c) => c.Saldo > 0) : comprobantes).map((c) => {
                    const abierta = facturaAbierta === c.Id;
                    const items = itemsPorFactura[c.Id];
                    return (
                      <div key={c.Id} className="rounded-xl border border-slate-100 dark:border-neutral-800">
                        <div className="flex w-full items-center gap-2 px-3 py-2">
                          <button
                            onClick={() => handleToggleFactura(c.Id)}
                            className="flex flex-1 items-center justify-between text-left text-sm"
                          >
                            <div>
                              <span className="font-mono text-slate-700 dark:text-neutral-300">{c.Numero}</span>
                              {c.Tipo === "COT" && (
                                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                                  Cotización
                                </span>
                              )}
                              {c.Tipo === "NCA" && (
                                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                                  Nota de crédito
                                  {c.IdComprobanteAsociado &&
                                    (() => {
                                      const asociada = comprobantes.find((x) => x.Id === c.IdComprobanteAsociado);
                                      return asociada ? ` → afecta a ${asociada.Numero}` : "";
                                    })()}
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
                          {c.Tipo !== "COT" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDescargarUnaFactura(c);
                              }}
                              disabled={descargandoFacturaId === c.Id}
                              title="Descargar PDF de esta factura"
                              className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-sky-300 hover:text-sky-600 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-400"
                            >
                              {descargandoFacturaId === c.Id ? "…" : "⬇️"}
                            </button>
                          )}
                        </div>
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
                              <div className="space-y-1.5">
                                {items.map((it, i) => {
                                  const sku = it.Codigo || it.Sku || "";
                                  const key = `${c.Id}_${sku}`;
                                  const atribucion = ventasAtribuidas?.find((v) => v.id === key);
                                  return (
                                    <div key={i} className="text-xs">
                                      <div className="flex items-center justify-between">
                                        <span className="text-slate-700 dark:text-neutral-300">
                                          {it.Concepto || it.Descripcion || "—"} <span className="text-slate-400">× {it.Cantidad ?? 0}</span>
                                        </span>
                                        <span className="text-slate-500 dark:text-neutral-400">
                                          {money((it.Total ?? (Number(it.PrecioUnitario) || 0) * (Number(it.Cantidad) || 0)))}
                                        </span>
                                      </div>
                                      {!soloLectura && vendedoresRedFactura && vendedoresRedFactura.length > 0 && (
                                        <div className="mt-0.5 flex items-center gap-1.5">
                                          {atribucion ? (
                                            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                              🏷️ Vendido por {atribucion.vendedorNombre}
                                            </span>
                                          ) : (
                                            <span className="text-[11px] text-slate-400 dark:text-neutral-500">🏷️ Vendido por:</span>
                                          )}
                                          <select
                                            value={atribucion?.vendedorId || ""}
                                            disabled={atribuyendoKey === key}
                                            onChange={(e) => {
                                              const v = vendedoresRedFactura.find((x) => x.id === e.target.value);
                                              if (v) handleAtribuirVenta(c, it, v);
                                            }}
                                            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                                          >
                                            <option value="" disabled>
                                              {atribuyendoKey === key ? "Guardando…" : atribucion ? "Cambiar…" : "Elegir…"}
                                            </option>
                                            {vendedoresRedFactura.map((v) => (
                                              <option key={v.id} value={v.id}>
                                                {v.nombre}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {atribuirError && <p className="text-[11px] text-rose-500">{atribuirError}</p>}
                              </div>
                            )}
                            {(() => {
                              const ventasQueLaGeneraron = (ventasReportadas || []).filter(
                                (v) => v.facturaContabilium?.Id === c.Id
                              );
                              if (ventasQueLaGeneraron.length === 0) return null;
                              return (
                                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-neutral-800">
                                  {ventasQueLaGeneraron.map((v) => (
                                    <p key={v.id} className="text-[11px] text-sky-700 dark:text-sky-400">
                                      📦 Se generó automáticamente al reportar esta venta — {v.quantity} × {v.name || `SKU ${v.sku}`}
                                      {v.createdAt?.toDate ? ` · ${formatFecha(v.createdAt.toDate().toISOString())}` : ""}
                                    </p>
                                  ))}
                                </div>
                              );
                            })()}
                            {(() => {
                              const cobranzasQuePagan = (cliente.cobranzasList || []).filter((cob) =>
                                (cob.detalle || []).some((d) => d.IDComprobante === c.Id)
                              );
                              if (cobranzasQuePagan.length === 0) return null;
                              return (
                                <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-neutral-800">
                                  <p className="text-[11px] font-semibold text-slate-500 dark:text-neutral-400">
                                    Recibos aplicados a esta factura:
                                  </p>
                                  {cobranzasQuePagan.map((cob) => {
                                    const linea = (cob.detalle || []).find((d) => d.IDComprobante === c.Id);
                                    return (
                                      <div key={cob.id} className="text-[11px] text-slate-600 dark:text-neutral-300">
                                        <span className="font-mono">Nº {cob.numero}</span> · {formatFecha(cob.fecha)} · aplicado {money(linea?.Importe)}
                                        {(cob.formasDePago || []).length > 0 && (
                                          <div className="mt-0.5 flex flex-wrap gap-1">
                                            {cob.formasDePago.map((f, i) => (
                                              <span
                                                key={i}
                                                className="inline-flex items-center rounded-lg border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400"
                                              >
                                                {f.FormaDePago}{nombreBanco(f.IdBanco) ? ` (${nombreBanco(f.IdBanco)})` : ""}{f.NroReferencia ? ` #${f.NroReferencia}` : ""} — {money(f.Importe)}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            {!soloLectura && (c.Saldo > 0 || Array.isArray(items)) && (
                              <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2 dark:border-neutral-800">
                                {c.Saldo > 0 && (
                                  <button
                                    onClick={() => setReciboAbierto(reciboAbierto === c.Id ? null : c.Id)}
                                    className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                                  >
                                    {reciboAbierto === c.Id ? "Cancelar recibo" : "💳 Hacer un recibo (cobrar sin facturar)"}
                                  </button>
                                )}
                                {Array.isArray(items) && items.length > 0 && (
                                  <button
                                    onClick={() =>
                                      setRemitoDesdeFactura({
                                        lines: items.map((it) => ({
                                          sku: it.Codigo || it.Sku || null,
                                          descripcion: it.Concepto || it.Descripcion || "",
                                          cantidad: Number(it.Cantidad) || 1,
                                          precioUnitario: Number(it.PrecioUnitario ?? (Number(it.Total || 0) / (Number(it.Cantidad) || 1))) || 0,
                                        })),
                                      })
                                    }
                                    className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
                                  >
                                    📦 Hacer un remito de esta factura
                                  </button>
                                )}
                              </div>
                            )}
                            {reciboAbierto === c.Id && (
                              <ReciboForm
                                factura={c}
                                contabiliumId={cliente.contabiliumId}
                                clienteName={cliente.name}
                                clienteId={cliente.id}
                                vendedor={cliente.vendedor}
                                realizadoPor={user?.email}
                                notasCredito={(comprobantes || []).filter((nc) => nc.Tipo === "NCA" && Number(nc.Saldo || 0) < 0)}
                                onDone={() => { setReciboAbierto(null); recargarFacturas(); recargarCheques(); }}
                              />
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
                      otrosChequesCliente={cheques}
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
                            {!soloLectura && p.estado === "pendiente" && (
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
                  accept="image/*,application/pdf"
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

              {(notasEntrega.length > 0 || !soloLectura) && (
                <div className="mt-5 border-t border-slate-200 pt-4 dark:border-neutral-700">
                  <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                    🚚 Notas de entrega (chofer) <span className="font-normal text-slate-400 dark:text-neutral-500">({notasEntrega.length})</span>
                  </p>
                  {!soloLectura && (
                    <div className="mb-3">
                      <textarea
                        value={nuevaNotaChofer}
                        onChange={(e) => setNuevaNotaChofer(e.target.value)}
                        placeholder="Dejale una nota al chofer para este cliente…"
                        rows={2}
                        className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                      />
                      <button
                        onClick={handleAgregarNotaChofer}
                        disabled={guardandoNotaChofer || !nuevaNotaChofer.trim()}
                        className="mt-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
                      >
                        {guardandoNotaChofer ? "Guardando…" : "Agregar nota"}
                      </button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {notasEntrega.map((n) => (
                      <div key={n.id} className="rounded-xl border border-slate-100 p-2.5 text-xs dark:border-neutral-800">
                        <p className="text-slate-700 dark:text-neutral-300">{n.texto}</p>
                        <p className="mt-1 text-slate-400 dark:text-neutral-500">
                          {n.choferNombre} · {formatFechaHora(n.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
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
          clienteId={cliente.id}
          vendedor={cliente.vendedor}
          realizadoPor={user?.email}
          onClose={() => setFacturarOpen(false)}
        />
      )}

      {remitoDesdeFactura && (
        <FacturarModal
          contabiliumId={cliente.contabiliumId}
          depositoId={cliente.contabiliumDepositoId}
          clienteName={cliente.name}
          condicionIva={cliente.condicionIva}
          cuit={cliente.cuit}
          clienteId={cliente.id}
          vendedor={cliente.vendedor}
          realizadoPor={user?.email}
          initialTipoFc="REM"
          initialLines={remitoDesdeFactura.lines}
          onClose={() => setRemitoDesdeFactura(null)}
        />
      )}

      {reciboModalOpen && (
        <ReciboModal
          contabiliumId={cliente.contabiliumId}
          clienteName={cliente.name}
          clienteId={cliente.id}
          vendedor={cliente.vendedor}
          realizadoPor={user?.email}
          facturas={(comprobantes || []).filter((c) => Number(c.Saldo || 0) > 0)}
          notasCredito={(comprobantes || []).filter((c) => c.Tipo === "NCA" && Number(c.Saldo || 0) < 0)}
          onClose={() => setReciboModalOpen(false)}
          onDone={() => { setReciboModalOpen(false); recargarFacturas(); recargarCheques(); }}
        />
      )}

      {transferStockDesde && (
        <TransferirStockDesdeAdminModal
          distribuidor={transferStockDesde}
          cliente={cliente}
          onClose={() => setTransferStockDesde(null)}
        />
      )}
    </div>
  );
}

// Después de sumar un cliente al equipo de un distribuidor con depósito
// propio (ej. Cuchi), ofrece pasarle bicis de ese depósito al depósito del
// cliente recién sumado — mismo panel (PasoTransferencia) que usa el
// distribuidor desde "Mover stock" para mandarle stock a SUS clientes, solo
// que acá el origen/destino ya vienen fijos (no hay que elegir a quién).
function TransferirStockDesdeAdminModal({ distribuidor, cliente, onClose }) {
  const [confirmado, setConfirmado] = useState(false);
  const nombreCliente = cliente.contabiliumDepositoNombre || cliente.name;

  return (
    <div className="fixed inset-0 z-[9200] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">🚲 Pasar bicis a {cliente.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-500">
            ✕
          </button>
        </div>

        {!confirmado ? (
          <>
            <p className="text-sm text-slate-600 dark:text-neutral-300">
              Sumaste a <strong>{cliente.name}</strong> al equipo de <strong>{distribuidor.name}</strong>. ¿Querés pasar bicicletas del depósito de {distribuidor.name} ({distribuidor.contabiliumDepositoNombre}) al depósito de {cliente.name} ahora?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirmado(true)}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
              >
                Sí, pasar bicis
              </button>
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300"
              >
                Ahora no
              </button>
            </div>
          </>
        ) : !cliente.contabiliumDepositoId ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
            {cliente.name} todavía no tiene depósito consignado propio en Contabilium — asignale uno primero (editándolo en "Usuarios") para poder pasarle stock.
          </p>
        ) : (
          <PasoTransferencia
            titulo={`📤 ${distribuidor.contabiliumDepositoNombre} → ${nombreCliente}`}
            origenId={distribuidor.contabiliumDepositoId}
            origenNombre={distribuidor.contabiliumDepositoNombre}
            destinoId={cliente.contabiliumDepositoId}
            destinoNombre={nombreCliente}
            cargarStock={() => getDepositoStockAdmin(distribuidor.contabiliumDepositoId).then((r) => r.items)}
            onVolver={onClose}
            clienteDestino={{ contabiliumId: cliente.contabiliumId, name: cliente.name }}
            clientesDisponibles={[{ uid: cliente.id, name: cliente.name, contabiliumId: cliente.contabiliumId }]}
          />
        )}
      </div>
    </div>
  );
}

// Registra cualquier movimiento hecho sobre la ficha de un cliente (nota,
// recibo, factura, remito) atribuido al vendedor que tenía asignado en ese
// momento — así queda trazado qué se hizo en la cartera de cada vendedor,
// sin importar quién del staff lo haya tipeado realmente.
async function registrarActividadCliente({ clienteId, clienteNombre, vendedor, tipo, detalle, realizadoPor }) {
  try {
    await addDoc(collection(db, "actividadCliente"), {
      clienteId: clienteId || null,
      clienteNombre: clienteNombre || null,
      vendedorAsignado: vendedor || null,
      tipo,
      detalle: detalle || null,
      realizadoPor: realizadoPor || null,
      fecha: serverTimestamp(),
    });
  } catch (e) {
    console.error("[actividadCliente] no se pudo registrar:", e);
  }
}

// Cheque, igual que Efectivo, no lleva banco/caja en Contabilium — solo el
// número de cheque como referencia (confirmado contra cobranzas reales).
// Nota de crédito tampoco lleva banco — lo que la identifica es a qué nota
// de crédito puntual se está aplicando (ver `idNotaCredito`).
const FORMAS_SIN_BANCO = ["Efectivo", "Cheque", "Nota de crédito"];

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
function ReciboModal({ contabiliumId, clienteName, clienteId, vendedor, realizadoPor, facturas, notasCredito, onClose, onDone }) {
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
              <ReciboForm factura={null} contabiliumId={contabiliumId} clienteName={clienteName} clienteId={clienteId} vendedor={vendedor} realizadoPor={realizadoPor} onDone={onDone} soloCheque />
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
                <ReciboForm factura={facturaSeleccionada} contabiliumId={contabiliumId} clienteName={clienteName} clienteId={clienteId} vendedor={vendedor} realizadoPor={realizadoPor} notasCredito={notasCredito} onDone={onDone} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Cache en memoria de la lista real de bancos/cajas propias de Contabilium
// — se usa en los 2 forms de cobranza (factura puntual y "a cuenta") para
// mostrar un <select> con las cuentas que de verdad existen en Contabilium
// en vez de un campo de texto libre que había que escribir a mano y
// confiar en que el backend lo matcheara bien. Se trae una sola vez por
// carga de página (la lista casi no cambia) y se comparte entre forms.
let _bancosYCajasPropiosPromise = null;
function useBancosYCajasPropios() {
  const [data, setData] = useState({ bancos: [], cajas: [], cargando: true });
  useEffect(() => {
    if (!_bancosYCajasPropiosPromise) _bancosYCajasPropiosPromise = obtenerBancosYCajasPropios();
    _bancosYCajasPropiosPromise
      .then((r) => setData({ bancos: r.bancos || [], cajas: r.cajas || [], cargando: false }))
      .catch(() => setData({ bancos: [], cajas: [], cargando: false }));
  }, []);
  return data;
}

// Carga una cobranza "a cuenta" (sin aplicar a ninguna factura) en
// Contabilium — automatización web, ver cargarCobranzaACuentaWeb. Útil
// cuando un pago recibido supera lo pendiente de la única factura del
// cliente, o cuando no hay ninguna factura abierta a la cual aplicarlo:
// el sobrante queda registrado "a cuenta" para aplicarlo a futuro, en vez
// de perderse sin ningún rastro.
// Confirma un comprobante que un cliente subió, cargando el recibo DE
// VERDAD en Contabilium (antes solo se marcaba un estado acá, sin tocar
// nada real — por eso nunca impactaba la cuenta). El staff elige a mano a
// qué factura se aplica (o "a cuenta" si no corresponde a ninguna
// puntual) y confirma/corrige la fecha — la IA la lee de la imagen pero el
// distribuidor puede haber tipeado otra al subir el comprobante, así que
// se muestran las dos.
function ConfirmarPagoForm({ pago, contabiliumId, facturasAbiertas, onClose, onDone }) {
  const [idComprobante, setIdComprobante] = useState("-1");
  const [importe, setImporte] = useState(pago.monto || "");
  const [fecha, setFecha] = useState(pago.lecturaIA?.fecha || pago.fecha || new Date().toISOString().slice(0, 10));
  const [forma, setForma] = useState("Transferencia");
  const { bancos, cajas, cargando: cargandoBancos } = useBancosYCajasPropios();
  const [idBanco, setIdBanco] = useState("");
  const [idCaja, setIdCaja] = useState("");
  const [nroRef, setNroRef] = useState(pago.lecturaIA?.referencia || "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  // Apenas llega la lista real, preseleccionamos lo que la IA leyó en la
  // imagen (si matchea algún nombre) y la primera caja como default — nunca
  // se manda vacío al backend una vez que la lista cargó.
  useEffect(() => {
    if (cargandoBancos) return;
    if (!idBanco && bancos.length) {
      const nombreLeido = (pago.lecturaIA?.banco || "").toLowerCase();
      const match = nombreLeido && bancos.find((b) => b.nombre.toLowerCase().includes(nombreLeido) || nombreLeido.includes(b.nombre.toLowerCase()));
      setIdBanco(String((match || bancos[0]).id));
    }
    if (!idCaja && cajas.length) setIdCaja(String(cajas[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargandoBancos, bancos, cajas]);

  const facturaElegida = facturasAbiertas.find((f) => String(f.Id) === idComprobante);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!importe || Number(importe) <= 0 || !fecha || (forma === "Efectivo" ? !idCaja : !idBanco)) {
      setError("Completá importe, fecha y banco/caja.");
      return;
    }
    setEnviando(true);
    try {
      const r = await confirmarPagoReportado({
        id: pago.id,
        idComprobante: idComprobante === "-1" ? "-1" : Number(idComprobante),
        comprobante: facturaElegida?.Numero,
        importe: Number(importe),
        saldoFactura: facturaElegida ? Number(facturaElegida.Saldo) : undefined,
        fecha,
        forma,
        idBanco: forma === "Efectivo" ? undefined : Number(idBanco),
        idCaja: forma === "Efectivo" ? Number(idCaja) : undefined,
        nroRef: nroRef.trim() || undefined,
      });
      onDone?.(r);
    } catch (err) {
      setError(err.message || "No se pudo cargar el recibo");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 grid gap-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/20">
      {pago.lecturaIA && (
        <p className="rounded-lg bg-white px-2 py-1.5 text-[11px] text-slate-600 dark:bg-neutral-900 dark:text-neutral-300">
          🤖 La IA leyó en la imagen: {pago.lecturaIA.fecha ? `fecha ${formatFecha(pago.lecturaIA.fecha)}` : "sin fecha clara"}
          {pago.lecturaIA.monto ? `, monto ${money(pago.lecturaIA.monto)}` : ""}
          {pago.lecturaIA.banco ? `, banco "${pago.lecturaIA.banco}"` : ""} (confianza: {pago.lecturaIA.confianza}).
          {pago.fecha && pago.lecturaIA.fecha && pago.fecha !== pago.lecturaIA.fecha && (
            <> El distribuidor había puesto {formatFecha(pago.fecha)} al subirlo — revisá cuál es la correcta.</>
          )}
        </p>
      )}
      <div>
        <label className="mb-1 block font-semibold text-slate-600 dark:text-neutral-300">
          Aplicar a * — elegí la factura, o "a cuenta" ({facturasAbiertas.length} factura{facturasAbiertas.length === 1 ? "" : "s"} abierta{facturasAbiertas.length === 1 ? "" : "s"})
        </label>
        <select value={idComprobante} onChange={(e) => setIdComprobante(e.target.value)} className="w-full rounded-lg border-2 border-amber-400 bg-white px-2 py-2 font-semibold outline-none focus:border-amber-500 dark:border-amber-700 dark:bg-neutral-800 dark:text-white">
          <option value="-1">⚠️ Cobranza a cuenta (sin factura puntual)</option>
          {facturasAbiertas.map((f) => (
            <option key={f.Id} value={f.Id}>
              📄 Factura {f.Numero} — saldo {money(f.Saldo)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-slate-500 dark:text-neutral-400">Importe *</label>
          <input type="number" value={importe} onChange={(e) => setImporte(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
        </div>
        <div>
          <label className="mb-1 block text-slate-500 dark:text-neutral-400">Fecha *</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-slate-500 dark:text-neutral-400">Forma de pago</label>
          <select value={forma} onChange={(e) => setForma(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">
            <option value="Transferencia">Transferencia</option>
            <option value="Efectivo">Efectivo</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-slate-500 dark:text-neutral-400">{forma === "Efectivo" ? "Caja *" : "Banco propio *"}</label>
          {forma === "Efectivo" ? (
            <select value={idCaja} onChange={(e) => setIdCaja(e.target.value)} disabled={cargandoBancos} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">
              {cargandoBancos && <option value="">Cargando…</option>}
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          ) : (
            <select value={idBanco} onChange={(e) => setIdBanco(e.target.value)} disabled={cargandoBancos} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">
              {cargandoBancos && <option value="">Cargando…</option>}
              {bancos.map((b) => (
                <option key={b.id} value={b.id}>{b.nombre}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-slate-500 dark:text-neutral-400">Referencia</label>
        <input type="text" value={nroRef} onChange={(e) => setNroRef(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
      </div>
      {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
          {enviando ? "Cargando…" : "✓ Confirmar y cargar en Contabilium"}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function CobranzaACuentaForm({ contabiliumId, onClose, onDone }) {
  const [importe, setImporte] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const { bancos, cajas, cargando: cargandoBancos } = useBancosYCajasPropios();
  // Misma distinción que tiene Contabilium en "Forma de cobro": si es
  // Efectivo pide una Caja propia, si es Transferencia (o cualquier otra
  // forma con cuenta) pide un Banco propio — antes esto solo tenía el
  // selector de banco, sin la opción de efectivo/caja.
  const [formaDeCobro, setFormaDeCobro] = useState("Transferencia");
  const [idBanco, setIdBanco] = useState("");
  const [idCaja, setIdCaja] = useState("");
  const [nroRef, setNroRef] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState(null);
  const [leyendoComprobante, setLeyendoComprobante] = useState(false);
  const [lecturaComprobante, setLecturaComprobante] = useState(null);
  const [chequesDisponibles, setChequesDisponibles] = useState(null);
  const [chequeRefId, setChequeRefId] = useState("");

  useEffect(() => {
    if (!cargandoBancos && !idBanco && bancos.length) setIdBanco(String(bancos[0].id));
    if (!cargandoBancos && !idCaja && cajas.length) setIdCaja(String(cajas[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargandoBancos, bancos, cajas]);

  useEffect(() => {
    listarChequesDisponiblesContabilium()
      .then((r) => setChequesDisponibles(r.cheques))
      .catch(() => setChequesDisponibles([]));
  }, []);

  // Subís la foto/captura de la transferencia y se lee sola para
  // precargar importe/fecha/banco/referencia — igual que en el recibo de
  // factura. Siempre queda editable antes de guardar, nunca se aplica solo.
  async function handleCargarComprobante(file) {
    if (!file) return;
    setError("");
    setLecturaComprobante(null);
    setLeyendoComprobante(true);
    try {
      const [url] = await subirImagenesNota(`comprobantesPago/${contabiliumId}`, [file]);
      const { lectura } = await leerComprobantePagoAdmin(url);
      if (!lectura) {
        setLecturaComprobante({ confianza: "baja", vacio: true });
        return;
      }
      if (lectura.monto) setImporte(String(lectura.monto));
      if (lectura.fecha) setFecha(lectura.fecha);
      if (lectura.banco && bancos.length) {
        const nombreLeido = lectura.banco.toLowerCase();
        const match = bancos.find((b) => b.nombre.toLowerCase().includes(nombreLeido) || nombreLeido.includes(b.nombre.toLowerCase()));
        if (match) setIdBanco(String(match.id));
      }
      if (lectura.referencia) setNroRef(lectura.referencia);
      setLecturaComprobante(lectura);
    } catch (e) {
      setError(e.message || "No se pudo leer el comprobante");
    } finally {
      setLeyendoComprobante(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!contabiliumId) {
      setError("Este cliente no está vinculado a Contabilium.");
      return;
    }
    const esEfectivo = formaDeCobro === "Efectivo";
    const esCheque = formaDeCobro === "Cheque";
    if (!importe || Number(importe) <= 0 || !fecha || (esEfectivo && !idCaja) || (!esEfectivo && !esCheque && !idBanco)) {
      setError(esEfectivo ? "Completá importe, fecha y caja propia." : esCheque ? "Completá importe, fecha y N° de cheque." : "Completá importe, fecha y banco propio.");
      return;
    }
    setEnviando(true);
    try {
      const r = await cargarCobranzaACuentaManual({
        idPersona: contabiliumId,
        importe: Number(importe),
        fecha,
        forma: formaDeCobro,
        idBanco: esEfectivo || esCheque ? undefined : Number(idBanco),
        idCaja: esEfectivo ? Number(idCaja) : undefined,
        nroRef: nroRef.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      setResultado(r);
      onDone?.();
    } catch (err) {
      setError(err.message || "No se pudo cargar la cobranza");
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
        <p className="font-semibold text-emerald-700 dark:text-emerald-400">
          ✅ Cobranza a cuenta Nº {resultado.nroComprobante} cargada ({resultado.bancoNombre || `banco #${resultado.idBanco}`}).
        </p>
        <button type="button" onClick={onClose} className="mt-2 rounded-lg border border-emerald-300 bg-white px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-neutral-900 dark:text-emerald-400">
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3 grid gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/10 sm:grid-cols-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-white/60 px-2.5 py-2 dark:border-emerald-800 dark:bg-neutral-900/40 sm:col-span-2">
        <label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          🤖{" "}
          <span className="cursor-pointer underline decoration-dotted">
            {leyendoComprobante ? "Leyendo comprobante…" : "Cargar comprobante"}
          </span>
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={leyendoComprobante}
            onChange={(e) => handleCargarComprobante(e.target.files?.[0] || null)}
            className="hidden"
          />
        </label>
        <span className="text-[11px] text-slate-500 dark:text-neutral-400">
          Subí la foto/captura y precarga importe/fecha/banco/referencia — revisá antes de guardar.
        </span>
        {lecturaComprobante && !lecturaComprobante.vacio && (
          <span
            className={`text-[11px] font-semibold ${
              lecturaComprobante.confianza === "alta" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {lecturaComprobante.confianza === "alta" ? "✓" : "⚠️"} Confianza {lecturaComprobante.confianza}
          </span>
        )}
        {lecturaComprobante?.vacio && (
          <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">No se pudo leer la imagen, cargá los datos a mano</span>
        )}
      </div>
      <div>
        <label className="mb-1 block text-slate-500 dark:text-neutral-400">Importe *</label>
        <input type="number" value={importe} onChange={(e) => setImporte(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
      </div>
      <div>
        <label className="mb-1 block text-slate-500 dark:text-neutral-400">Fecha *</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
      </div>
      <div>
        <label className="mb-1 block text-slate-500 dark:text-neutral-400">Forma de cobro *</label>
        <select value={formaDeCobro} onChange={(e) => setFormaDeCobro(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">
          <option value="Transferencia">Transferencia</option>
          <option value="Depósito">Depósito</option>
          <option value="Débito">Débito</option>
          <option value="Cheque">Cheque</option>
          <option value="Efectivo">Efectivo</option>
        </select>
      </div>
      {formaDeCobro === "Efectivo" && (
        <div>
          <label className="mb-1 block text-slate-500 dark:text-neutral-400">Caja propia *</label>
          <select value={idCaja} onChange={(e) => setIdCaja(e.target.value)} disabled={cargandoBancos} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">
            {cargandoBancos && <option value="">Cargando…</option>}
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>
      )}
      {formaDeCobro !== "Efectivo" && formaDeCobro !== "Cheque" && (
        <div>
          <label className="mb-1 block text-slate-500 dark:text-neutral-400">Banco propio *</label>
          <select value={idBanco} onChange={(e) => setIdBanco(e.target.value)} disabled={cargandoBancos} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">
            {cargandoBancos && <option value="">Cargando…</option>}
            {bancos.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </select>
        </div>
      )}
      {formaDeCobro === "Cheque" && chequesDisponibles && chequesDisponibles.length > 0 && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-slate-500 dark:text-neutral-400">
            Cheque real de Contabilium (opcional — solo para dejar la referencia, no lo aplica de verdad)
          </label>
          <select
            value={chequeRefId}
            onChange={(e) => {
              setChequeRefId(e.target.value);
              const ch = chequesDisponibles.find((c) => String(c.id) === e.target.value);
              if (ch) setNroRef(`Proviene del cheque ${ch.codigo} — ${ch.banco}`);
            }}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          >
            <option value="">Sin referenciar ningún cheque</option>
            {chequesDisponibles.map((c) => (
              <option key={c.id} value={c.id}>{c.banco} — Nro:{c.codigo} — {money(c.importe)}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="mb-1 block text-slate-500 dark:text-neutral-400">{formaDeCobro === "Cheque" ? "N° de cheque *" : "Referencia"}</label>
        <input type="text" value={nroRef} onChange={(e) => setNroRef(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-slate-500 dark:text-neutral-400">Observaciones</label>
        <input type="text" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white" />
      </div>
      {error && <p className="text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
          {enviando ? "Cargando…" : "✓ Cargar cobranza a cuenta"}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ReciboForm({ factura, contabiliumId, clienteName, clienteId, vendedor, realizadoPor, notasCredito, onDone, soloCheque = false }) {
  const saldoActual = Number(factura?.Saldo || 0);
  // Notas de crédito de este cliente todavía con saldo disponible (Saldo
  // negativo = crédito sin aplicar). Dejarlas imputables desde acá evita que
  // queden "flotando" sin descontar ninguna factura puntual — cosa que
  // infla el saldo agregado (Debe) mostrando un número raro cuando en
  // realidad hay facturas concretas sin cobrar.
  const disponiblesNotaCredito = notasCredito || [];
  // Líneas de pago ya agregadas al recibo (todo lo que NO sea Cheque). Van
  // todas juntas en un solo llamado a Contabilium porque su API reemplaza
  // el recibo entero del comprobante en cada llamada — no lo acumula — así
  // que cargar varias transferencias de a una pisaría a las anteriores.
  const [pagos, setPagos] = useState([]);
  // Fecha del recibo (una sola, no por línea de pago — así lo guarda
  // Contabilium: el campo "Fecha" vive en el recibo entero, no en cada
  // forma de pago). Por defecto hoy, pero se puede cambiar para asentar un
  // pago que en realidad se recibió otro día.
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState(soloCheque ? "" : "");
  const [formaDePago, setFormaDePago] = useState(soloCheque ? "Cheque" : "Transferencia");
  const [idBanco, setIdBanco] = useState(listaBancos()[0]?.id || "");
  const [nroReferencia, setNroReferencia] = useState("");
  const [idNotaCredito, setIdNotaCredito] = useState("");
  const [valorChequeTotal, setValorChequeTotal] = useState("");
  const [fotoCheque, setFotoCheque] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [error, setError] = useState("");
  // Cheques reales que ya están cargados en Contabilium (Tesorería) — solo
  // para referenciarlos en la observación ("Proviene del cheque X") cuando
  // una parte de un cheque grande se usa para pagarle a este cliente en
  // particular, sin aplicar el cheque de verdad (eso sigue siendo manual en
  // Contabilium — ver nota en index.js, 2/10/2026).
  const [chequesDisponibles, setChequesDisponibles] = useState(null);
  const [chequeRefId, setChequeRefId] = useState("");
  useEffect(() => {
    listarChequesDisponiblesContabilium()
      .then((r) => setChequesDisponibles(r.cheques))
      .catch(() => setChequesDisponibles([]));
  }, []);
  const [leyendoComprobante, setLeyendoComprobante] = useState(false);
  const [lecturaComprobante, setLecturaComprobante] = useState(null);
  const [arrastrandoComprobante, setArrastrandoComprobante] = useState(false);

  const totalPagos = pagos.reduce((acc, p) => acc + Number(p.monto || 0), 0);
  const restante = Math.max(0, saldoActual - totalPagos);

  // Sube la foto/captura de un comprobante de pago y le pide a Claude que
  // lea monto/banco/referencia para precargar el formulario — ahorra
  // tipeo, pero el staff siempre revisa el resultado antes de aplicar el
  // recibo real (nunca se aplica solo).
  async function handleCargarComprobante(file) {
    if (!file) return;
    setError("");
    setLecturaComprobante(null);
    setLeyendoComprobante(true);
    try {
      const [url] = await subirImagenesNota(`comprobantesPago/${contabiliumId}`, [file]);
      const { lectura } = await leerComprobantePagoAdmin(url);
      if (!lectura) {
        setLecturaComprobante({ confianza: "baja", vacio: true });
        return;
      }
      setFormaDePago("Transferencia");
      if (lectura.monto) setMonto(String(Math.min(lectura.monto, restante || lectura.monto)));
      if (lectura.idBanco) setIdBanco(String(lectura.idBanco));
      if (lectura.referencia) setNroReferencia(lectura.referencia);
      setLecturaComprobante(lectura);
    } catch (e) {
      setError(e.message || "No se pudo leer el comprobante");
    } finally {
      setLeyendoComprobante(false);
    }
  }

  async function handleAgregarLinea() {
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
    if (formaDePago === "Nota de crédito") {
      if (!idNotaCredito) {
        setError("Elegí qué nota de crédito estás aplicando");
        return;
      }
      const nc = disponiblesNotaCredito.find((x) => x.Id === Number(idNotaCredito));
      if (nc && Number(monto) > Math.abs(Number(nc.Saldo))) {
        setError(`Esa nota de crédito solo tiene ${money(Math.abs(Number(nc.Saldo)))} disponibles`);
        return;
      }
    }
    // Si el cheque vale más de lo que se está aplicando ahora, guardamos el
    // valor total para que, al confirmar, el sobrante quede como saldo a
    // favor disponible en "Cheques registrados" — así no se pierde de vista
    // (mismo caso que la factura 0001-00000130: cheque de $2.275.000 del que
    // solo se aplicaron $1.725.000).
    const valorTotal = formaDePago === "Cheque" && Number(valorChequeTotal) > Number(monto)
      ? Number(valorChequeTotal)
      : Number(monto);

    let fotoUrl = null;
    if (formaDePago === "Cheque" && fotoCheque) {
      setSubiendoFoto(true);
      try {
        [fotoUrl] = await subirImagenesNota(`cheques/${contabiliumId}`, [fotoCheque]);
      } catch {
        setError("No se pudo subir la foto del cheque, pero podés seguir sin ella");
      }
      setSubiendoFoto(false);
    }

    setPagos((prev) => [
      ...prev,
      {
        formaDePago,
        monto: Number(monto),
        idBanco: FORMAS_SIN_BANCO.includes(formaDePago) ? null : Number(idBanco),
        nroReferencia,
        ...(formaDePago === "Cheque" ? { valorTotal, fotoUrl } : {}),
        ...(formaDePago === "Nota de crédito" ? { idNotaCredito: Number(idNotaCredito) } : {}),
      },
    ]);
    setMonto("");
    setNroReferencia("");
    setValorChequeTotal("");
    setIdNotaCredito("");
    setFotoCheque(null);
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
      registrarActividadCliente({
        clienteId,
        clienteNombre: clienteName,
        vendedor,
        tipo: "cheque_sin_imputar",
        detalle: `${money(Number(monto))} — cheque N° ${nroReferencia}`,
        realizadoPor,
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
      `Vas a registrar un RECIBO REAL en Contabilium por ${money(totalPagos)} contra la factura ${factura.Numero}, con fecha ${fecha}:\n\n${detalle}\n\n¿Confirmás?`
    );
    if (!ok) return;

    setGuardando(true);
    setError("");
    try {
      await cobrarComprobante({
        idComprobante: factura.Id,
        importeTotalNeto: Number(factura.Total),
        fecha,
        pagos: pagos.map((p) => ({ formaDePago: p.formaDePago, monto: p.monto, idBanco: p.idBanco, nroReferencia: p.nroReferencia, idNotaCredito: p.idNotaCredito })),
      });

      // Deja registrado cada cheque usado en este recibo en "Cheques
      // registrados" — si se aplicó por menos de su valor total, el
      // remanente queda visible como saldo a favor disponible para imputar
      // después (en vez de perderse de vista, como pasaba antes cuando este
      // formulario mandaba el cheque a Contabilium sin dejar rastro acá).
      for (const p of pagos) {
        if (p.formaDePago !== "Cheque" || !p.nroReferencia) continue;
        try {
          const existente = await getDocs(
            query(
              collection(db, "chequesRegistrados"),
              where("contabiliumId", "==", contabiliumId),
              where("nroCheque", "==", p.nroReferencia)
            )
          );
          if (!existente.empty) {
            await updateDoc(existente.docs[0].ref, {
              montoImputado: increment(p.monto),
              imputaciones: arrayUnion({
                facturaId: factura.Id,
                facturaNumero: factura.Numero,
                monto: p.monto,
                por: auth.currentUser?.email || null,
                fecha: new Date().toISOString(),
              }),
            });
          } else {
            await addDoc(collection(db, "chequesRegistrados"), {
              contabiliumId: contabiliumId || null,
              clienteName: clienteName || null,
              nroCheque: p.nroReferencia,
              monto: p.valorTotal || p.monto,
              montoImputado: p.monto,
              imputaciones: [{
                facturaId: factura.Id,
                facturaNumero: factura.Numero,
                monto: p.monto,
                por: auth.currentUser?.email || null,
                fecha: new Date().toISOString(),
              }],
              fotoUrl: p.fotoUrl || null,
              cargadoPor: auth.currentUser?.email || null,
              createdAt: serverTimestamp(),
            });
          }
        } catch (chequeErr) {
          console.error("[recibo] no se pudo registrar el cheque en la cartera:", chequeErr);
        }
      }

      registrarActividadCliente({
        clienteId,
        clienteNombre: clienteName,
        vendedor,
        tipo: "recibo",
        detalle: `${money(totalPagos)} contra factura ${factura.Numero}`,
        realizadoPor,
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
              accept="image/*,application/pdf"
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
          {subiendoFoto ? "Subiendo foto…" : guardando ? "Guardando…" : "📥 Agregar cheque sin imputar"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/10">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!leyendoComprobante) setArrastrandoComprobante(true);
        }}
        onDragLeave={() => setArrastrandoComprobante(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrandoComprobante(false);
          if (leyendoComprobante) return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleCargarComprobante(file);
        }}
        className={`flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 transition ${
          arrastrandoComprobante
            ? "border-emerald-500 bg-emerald-100 dark:border-emerald-500 dark:bg-emerald-950/40"
            : "border-emerald-300 bg-white/60 dark:border-emerald-800 dark:bg-neutral-900/40"
        }`}
      >
        <label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          🤖{" "}
          <span className="cursor-pointer underline decoration-dotted">
            {leyendoComprobante ? "Leyendo comprobante…" : arrastrandoComprobante ? "Soltá la imagen acá" : "Cargar comprobante"}
          </span>
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={leyendoComprobante}
            onChange={(e) => handleCargarComprobante(e.target.files?.[0] || null)}
            className="hidden"
          />
        </label>
        <span className="text-[11px] text-slate-500 dark:text-neutral-400">
          Subí o arrastrá la foto y precarga monto/banco/referencia solo — revisá antes de aplicar.
        </span>
        {lecturaComprobante && !lecturaComprobante.vacio && (
          <span
            className={`text-[11px] font-semibold ${
              lecturaComprobante.confianza === "alta"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {lecturaComprobante.confianza === "alta" ? "✓" : "⚠️"} Confianza {lecturaComprobante.confianza}
            {lecturaComprobante.referencia ? ` · ref. ${lecturaComprobante.referencia}` : ""}
            {!lecturaComprobante.idBanco && lecturaComprobante.banco ? ` · banco "${lecturaComprobante.banco}" no reconocido, elegilo a mano` : ""}
          </span>
        )}
        {lecturaComprobante?.vacio && (
          <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
            No se pudo leer la imagen, cargá los datos a mano
          </span>
        )}
      </div>

      <label className="block text-xs text-slate-600 dark:text-neutral-300">
        Fecha del recibo
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
      </label>

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
          "Agregar cheque imputado" lo suma a este recibo (descuenta la factura de arriba). "Agregar cheque sin imputar" lo guarda aparte, sin aplicarlo a ninguna factura todavía.
        </p>
      ) : null}

      {chequesDisponibles && chequesDisponibles.length > 0 && (
        <label className="block text-xs text-slate-600 dark:text-neutral-300">
          Cheque real de Contabilium (opcional — solo para dejar la referencia, no lo aplica de verdad)
          <select
            value={chequeRefId}
            onChange={(e) => {
              setChequeRefId(e.target.value);
              const ch = chequesDisponibles.find((c) => String(c.id) === e.target.value);
              if (ch) {
                setNroReferencia(`Proviene del cheque ${ch.codigo} — ${ch.banco}`);
                if (formaDePago === "Cheque") setFormaDePago("Transferencia");
              }
            }}
            className="ml-1.5 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          >
            <option value="">Sin referenciar ningún cheque</option>
            {chequesDisponibles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.banco} — Nro:{c.codigo} — {money(c.importe)}
              </option>
            ))}
          </select>
        </label>
      )}

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
            {disponiblesNotaCredito.length > 0 && <option value="Nota de crédito">Nota de crédito</option>}
          </select>
        </label>
        {formaDePago === "Nota de crédito" && (
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Nota de crédito
            <select
              value={idNotaCredito}
              onChange={(e) => {
                setIdNotaCredito(e.target.value);
                const nc = disponiblesNotaCredito.find((x) => x.Id === Number(e.target.value));
                if (nc) setMonto(String(Math.min(Math.abs(Number(nc.Saldo)), restante)));
              }}
              className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            >
              <option value="">Elegir…</option>
              {disponiblesNotaCredito.map((nc) => (
                <option key={nc.Id} value={nc.Id}>{nc.Numero} — disponible {money(Math.abs(Number(nc.Saldo)))}</option>
              ))}
            </select>
          </label>
        )}
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
            Valor total del cheque (si es mayor a lo que aplicás)
            <input
              type="number"
              min="1"
              placeholder={monto || "="}
              value={valorChequeTotal}
              onChange={(e) => setValorChequeTotal(e.target.value)}
              className="ml-1.5 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
          </label>
        )}
        {formaDePago === "Cheque" && (
          <label className="text-xs text-slate-600 dark:text-neutral-300">
            Foto del cheque (opcional)
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFotoCheque(e.target.files?.[0] || null)}
              className="ml-1.5 text-xs text-slate-600 file:mr-1.5 file:rounded-lg file:border-0 file:bg-slate-200 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:text-neutral-400 dark:file:bg-neutral-700 dark:file:text-neutral-200"
            />
          </label>
        )}
        <button
          onClick={handleAgregarLinea}
          disabled={guardando}
          className="rounded-lg border border-emerald-400 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:bg-neutral-900 dark:text-emerald-400"
        >
          {subiendoFoto ? "Subiendo foto…" : formaDePago === "Cheque" ? "✅ Agregar cheque imputado" : "+ Agregar línea"}
        </button>
        {formaDePago === "Cheque" && (
          <button
            onClick={handleGuardarCheque}
            disabled={guardando}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {guardando ? "Guardando…" : "📥 Agregar cheque sin imputar"}
          </button>
        )}
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

const TIPO_LABELS = { FCA: "factura A", FCB: "factura B", FCC: "factura C", COT: "cotización", REM: "remito" };

function FacturarModal({ contabiliumId, depositoId, clienteName, condicionIva, cuit, clienteId, vendedor, realizadoPor, onClose, initialTipoFc, initialLines }) {
  const [products, setProducts] = useState(null);
  const [stockPorSku, setStockPorSku] = useState(null); // Map sku -> stockDisponible, null = no aplica (sin depósito)
  const [search, setSearch] = useState("");
  const [filtroModeloFacturar, setFiltroModeloFacturar] = useState(null);
  const [lines, setLines] = useState(() => initialLines || []);
  const [tipoFc, setTipoFc] = useState(() => initialTipoFc || sugerirTipoFc(condicionIva));
  const hoyISO = new Date().toISOString().slice(0, 10);
  const [fechaEmision, setFechaEmision] = useState(hoyISO);
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [afipCheck, setAfipCheck] = useState(null); // null=no consultado, "loading", o { match, categoriaAfip }
  const [descargando, setDescargando] = useState(false);
  const [facturaParaRecibo, setFacturaParaRecibo] = useState(null); // null=cerrado, "loading", o el comprobante fresco
  const [errorRecibo, setErrorRecibo] = useState("");
  // Para cuando la mercadería ya se descontó de otra forma (ej: la vendió
  // un revendedor de un distribuidor y ya se lo restaron a su propio
  // stock chico) — esta factura es solo para que el pago tenga su
  // comprobante, no debe volver a tocar el depósito consignado del cliente.
  const [sinDescontarStock, setSinDescontarStock] = useState(false);

  // Trae el comprobante recién emitido con Total/Saldo reales (el `result`
  // crudo de crearComprobante no siempre los trae completos) para poder
  // abrir el mismo ReciboForm que se usa desde la lista de facturas.
  async function handleAbrirRecibo() {
    if (!result?.Id) return;
    setErrorRecibo("");
    setFacturaParaRecibo("loading");
    try {
      const detalle = await adminGetComprobanteDetail(result.Id);
      setFacturaParaRecibo(detalle);
    } catch (e) {
      setErrorRecibo(e.message || "No se pudo traer la factura recién emitida");
      setFacturaParaRecibo(null);
    }
  }

  async function handleDescargarComprobante() {
    if (!result?.Id) return;
    setDescargando(true);
    try {
      // Primero intenta el PDF real de Contabilium (con CAE de AFIP) — si
      // ningún endpoint candidato funciona, cae al render propio de Samurai
      // como respaldo, para no dejar al usuario sin nada.
      try {
        const pdfResultado = await adminDescargarPdfComprobante(result.Id);
        if (pdfResultado.ok && pdfResultado.pdfBase64) {
          const bytes = atob(pdfResultado.pdfBase64);
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          const blob = new Blob([arr], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${result.Numero || result.Id}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
        console.warn("[handleDescargarComprobante] PDF real de Contabilium no disponible, intentos:", pdfResultado.intentos);
      } catch (e2) {
        console.warn("[handleDescargarComprobante] falló la descarga del PDF real, usando el propio de Samurai:", e2.message);
      }
      const detalle = await adminGetComprobanteDetail(result.Id);
      printComprobante(detalle);
    } catch (e) {
      setError(e.message || "No se pudo descargar el comprobante");
    } finally {
      setDescargando(false);
    }
  }

  // Destinatario del remito, cuando es distinto del cliente de la factura —
  // igual que en Contabilium: se puede remitir a una empresa intermedia (ej.
  // una empresa de flete/Credifin) y después otro remito de esa empresa al
  // cliente final, encadenando varios remitos de la misma venta.
  const [remitoDestinatario, setRemitoDestinatario] = useState(null); // null = mismo cliente de la factura
  const [destQuery, setDestQuery] = useState("");
  const [destResultados, setDestResultados] = useState([]);
  const [destSearching, setDestSearching] = useState(false);

  useEffect(() => {
    const q = destQuery.trim();
    if (q.length < 3) {
      setDestResultados([]);
      return;
    }
    let cancelled = false;
    setDestSearching(true);
    const timer = setTimeout(() => {
      searchContabiliumClientes(q)
        .then((r) => {
          if (!cancelled) setDestResultados(r.resultados || []);
        })
        .catch(() => {
          if (!cancelled) setDestResultados([]);
        })
        .finally(() => {
          if (!cancelled) setDestSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destQuery]);

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

  // Modelos disponibles para los chips de filtro rápido (2.0, 3.0, GOZEN,
  // BOWIE, SHONEN...) — se arman a partir de TODO el catálogo, no solo lo que
  // tiene stock, así se puede elegir un modelo y ver también lo que está en 0
  // (pedido explícito: "que aparezcan si no hay disponible con 0").
  const modelosFacturar = useMemo(() => {
    if (!products) return [];
    return [...new Set(products.map((p) => extraerModelo(p.name)).filter(Boolean))].sort();
  }, [products]);

  const results = useMemo(() => {
    if (!products) return [];
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 && !filtroModeloFacturar) return [];
    // Cada palabra escrita tiene que aparecer en alguna parte del nombre/SKU,
    // sin importar el orden — así "negro xl" encuentra "...T.XL...NEGRO..."
    // aunque en el nombre real el talle venga antes del color.
    let base = products;
    if (filtroModeloFacturar) base = base.filter((p) => extraerModelo(p.name) === filtroModeloFacturar);
    return base
      .filter((p) => {
        const haystack = `${p.name || ""} ${p.sku || ""}`.toLowerCase();
        return tokens.every((t) => haystack.includes(t));
      })
      .slice(0, filtroModeloFacturar && tokens.length === 0 ? 40 : 12);
  }, [products, search, filtroModeloFacturar]);

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
    const destinatarioId = remitoDestinatario ? remitoDestinatario.contabiliumId : contabiliumId;
    const destinatarioNombre = remitoDestinatario ? remitoDestinatario.razonSocial : clienteName;
    const detalle = lines
      .map((l) => `• ${l.descripcion || "(sin descripción)"} x${l.cantidad} — ${money(Number(l.cantidad) * Number(l.precioUnitario))}`)
      .join("\n");
    const esFiscal = tipoFc === "FCA" || tipoFc === "FCB" || tipoFc === "FCC";
    const tipoLabel = TIPO_LABELS[tipoFc] || tipoFc;
    const fechaLabel = fechaEmision !== hoyISO ? ` con fecha ${fechaEmision}` : "";
    const stockLabel = sinDescontarStock ? "\n\n⚠️ NO le va a descontar nada del depósito consignado." : "";
    const ok = confirm(
      esFiscal
        ? `Vas a EMITIR UNA ${tipoLabel.toUpperCase()} REAL en Contabilium (con CAE, irreversible) para ${destinatarioNombre}${fechaLabel}:\n\n${detalle}\n\nTotal: ${money(total)}${stockLabel}\n\n¿Confirmás?`
        : `Vas a generar un(a) ${tipoLabel} real en Contabilium (sin AFIP, no factura) para ${destinatarioNombre}${fechaLabel}:\n\n${detalle}\n\nTotal: ${money(total)}${stockLabel}\n\n¿Confirmás?`
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
      const res = await emitirFacturaManual(destinatarioId, items, tipoFc, fechaEmision !== hoyISO ? fechaEmision : undefined, sinDescontarStock);
      registrarActividadCliente({
        clienteId,
        clienteNombre: destinatarioNombre,
        vendedor,
        tipo: tipoFc === "REM" ? "remito" : "factura",
        detalle: `${tipoLabel} por ${money(total)}`,
        realizadoPor,
      });
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
            <p className="font-semibold">
              ✓ {TIPO_LABELS[result?.tipoDocumentoEmitido] || TIPO_LABELS[tipoFc] || tipoFc} emitida{result?.Numero ? `: ${result.Numero}` : ""}
            </p>
            {result?.avisoCambioTipo && (
              <p className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                ⚠️ {result.avisoCambioTipo}
              </p>
            )}
            <p className="mt-1 text-xs">Revisala en Contabilium para confirmar el CAE y el descuento de stock.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={onClose}
                className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:bg-transparent dark:text-emerald-400"
              >
                Cerrar
              </button>
              <button
                onClick={handleDescargarComprobante}
                disabled={descargando}
                className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/40 dark:bg-transparent dark:text-emerald-400"
              >
                {descargando ? "Generando…" : "📄 Descargar comprobante"}
              </button>
              <button
                onClick={() => {
                  setResult(null);
                  setError("");
                  setTipoFc("REM");
                  setRemitoDestinatario(null);
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                📦 {tipoFc === "REM" ? "Generar otro remito (otro destinatario)" : "Generar remito de esta venta"}
              </button>
              {tipoFc !== "REM" && !facturaParaRecibo && (
                <button
                  onClick={handleAbrirRecibo}
                  className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:bg-transparent dark:text-emerald-400"
                >
                  💳 Hacer un recibo
                </button>
              )}
            </div>

            {errorRecibo && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{errorRecibo}</p>}
            {facturaParaRecibo === "loading" && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Cargando factura…</p>
            )}
            {facturaParaRecibo && facturaParaRecibo !== "loading" && (
              <ReciboForm
                factura={facturaParaRecibo}
                contabiliumId={contabiliumId}
                clienteName={clienteName}
                clienteId={clienteId}
                vendedor={vendedor}
                realizadoPor={realizadoPor}
                onDone={onClose}
              />
            )}
          </div>
        ) : (
          <>
            {modelosFacturar.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {modelosFacturar.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFiltroModeloFacturar((prev) => (prev === m ? null : m))}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                      filtroModeloFacturar === m
                        ? "bg-slate-900 text-white dark:bg-neutral-700"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
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
                            <p className="break-words font-medium text-slate-900 dark:text-white">{p.name}</p>
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
                  <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-neutral-400">
                    Fecha de emisión
                  </label>
                  <input
                    type="date"
                    value={fechaEmision}
                    max={hoyISO}
                    onChange={(e) => setFechaEmision(e.target.value)}
                    className="mb-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  />
                  {fechaEmision !== hoyISO && (tipoFc === "FCA" || tipoFc === "FCB" || tipoFc === "FCC") && (
                    <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
                      ⚠ Para facturas con CAE, AFIP puede rechazar fechas muy atrasadas (unos pocos días). Si falla, Contabilium va a devolver el motivo.
                    </p>
                  )}
                </div>

                {depositoId != null && (
                  <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
                    <input
                      type="checkbox"
                      checked={sinDescontarStock}
                      onChange={(e) => setSinDescontarStock(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      No descontar del depósito consignado — usalo solo cuando la mercadería ya se descontó de otra
                      forma (ej: la vendió un revendedor y ya se restó de su propio sub-stock) y esta factura es nada
                      más para que el pago tenga comprobante.
                    </span>
                  </label>
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
                  <p className="mb-1.5 mt-2 text-xs font-medium text-slate-500 dark:text-neutral-400">
                    O sin AFIP (no llevan CAE, quedan igual con número real de Contabilium):
                  </p>
                  <div className="flex gap-2">
                    {[
                      { t: "COT", label: "Cotización" },
                      { t: "REM", label: "Remito" },
                    ].map(({ t, label }) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTipoFc(t)}
                        className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          tipoFc === t
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {tipoFc === "REM" && (
                  <div className="mt-3 rounded-xl border border-slate-200 p-3 text-xs dark:border-neutral-700">
                    <p className="font-semibold text-slate-700 dark:text-neutral-300">Destinatario del remito</p>
                    {remitoDestinatario ? (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-slate-600 dark:text-neutral-400">{remitoDestinatario.razonSocial}</span>
                        <button
                          type="button"
                          onClick={() => setRemitoDestinatario(null)}
                          className="whitespace-nowrap font-medium text-sky-600 hover:underline dark:text-sky-400"
                        >
                          Usar cliente de la factura
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 text-slate-400 dark:text-neutral-500">Por defecto: {clienteName} (el cliente de esta factura)</p>
                        <input
                          type="text"
                          placeholder="Buscar otro destinatario (ej: empresa de flete, Credifin)…"
                          value={destQuery}
                          onChange={(e) => setDestQuery(e.target.value)}
                          className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                        />
                        {destSearching && <p className="mt-1 text-slate-400 dark:text-neutral-500">Buscando…</p>}
                        {destResultados.length > 0 && (
                          <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-100 dark:border-neutral-800">
                            {destResultados.map((r) => (
                              <button
                                key={r.contabiliumId}
                                type="button"
                                onClick={() => {
                                  setRemitoDestinatario({ contabiliumId: r.contabiliumId, razonSocial: r.razonSocial });
                                  setDestQuery("");
                                  setDestResultados([]);
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
                  </div>
                )}
              </>
            )}

            {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

            <button
              onClick={handleEmitir}
              disabled={emitting || lines.length === 0}
              className="mt-4 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {emitting ? "Emitiendo…" : `🧾 Emitir ${TIPO_LABELS[tipoFc] || tipoFc}`}
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
