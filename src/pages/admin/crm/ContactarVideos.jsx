import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { arrayUnion, collection, doc, getDocs, query, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import { db, auth } from "../../../firebase";
import { useAuth } from "../../../auth/AuthContext";
import { adminGetClientPhone, getDepositoStockAdmin } from "../../../services/comprobantes";
import { puedeEditarNotas as puedeEditarNotasCheck } from "../../../utils/permisosNotas";
import { subirImagenesNota } from "../../../utils/notaImagenes";
import HistorialSeguimiento from "../../../components/crm/HistorialSeguimiento";
import AuditVideoPlayer from "../../../components/stock/AuditVideoPlayer";
import {
  toAudit,
  getAuditProgramStart,
  isAuditOverdue,
  isAuditDueSoon,
  contarVistas,
} from "../../../services/stockAudits";

function formatFechaHora(d) {
  if (!d) return "-";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) + " · " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) + " hs";
}

function normalizarTelefonoWhatsapp(raw) {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  d = d.replace(/^15/, "");
  if (!d.startsWith("54")) d = "549" + d;
  else if (!d.startsWith("549")) d = "549" + d.slice(2);
  return d;
}

function primerNombre(nombreCompleto) {
  const n = (nombreCompleto || "").trim();
  return n.split(" ")[0] || n;
}

function generarMensaje(cliente) {
  const nombre = primerNombre(cliente.nombre);
  const partes = [`Hola ${nombre}, buenos días! Soy Ezequiel de Samurai.`];

  if (!cliente.tieneVideo) {
    partes.push(
      "Vimos que todavía no se registró ningún video de auditoría de stock de tu cuenta. Es un paso simple: entrás a tu cuenta de Samurai, vas a \"Mi Stock\" y tocás el botón \"🎥 Grabar video\". Ahí filmás pausado todas las bicicletas que tenés consignadas, tanto las que están en caja como las que están armadas o fuera de caja, marcándolas una por una a medida que filmás. Te pido que lo hagas a la brevedad, hoy o mañana si es posible."
    );
  } else if (cliente.vencido) {
    partes.push(
      "Vimos que ya se venció el plazo del último video de auditoría de stock de tu cuenta. Te pedimos que grabes uno nuevo: entrás a tu cuenta de Samurai, vas a \"Mi Stock\" y tocás el botón \"🎥 Grabar video\", filmando pausado todas las bicicletas consignadas. Te pido que lo hagas a la brevedad, hoy o mañana si es posible."
    );
  }

  const seg = cliente.seguimiento || {};
  if (seg.cuentaCoincide === false && seg.notas) {
    partes.push(`Además, en la última revisión de tu cuenta corriente quedó registrado: "${seg.notas}". Te pedimos que nos confirmes esto a la brevedad.`);
  }
  if (seg.tareaPendiente) {
    partes.push(`Por otro lado, nos quedó pendiente: ${seg.tareaPendiente}.`);
  }

  partes.push("Quedo a disposición para cualquier consulta adicional. Saludos!!");
  return partes.join("\n\n");
}

function FormNota({ cliente, editandoEntry, onGuardado, onCancelar }) {
  const seg = cliente.seguimiento || {};
  const [contactado, setContactado] = useState(editandoEntry ? !!editandoEntry.contactado : !!seg.contactado);
  const [notas, setNotas] = useState(editandoEntry ? editandoEntry.notas || "" : "");
  const [imagenes, setImagenes] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      let urls = [];
      if (imagenes.length > 0) {
        setSubiendo(true);
        urls = await subirImagenesNota(cliente.uid, imagenes);
        setSubiendo(false);
      }

      if (editandoEntry) {
        const nuevoHistorial = (seg.historial || []).map((h) =>
          h === editandoEntry
            ? {
                ...h,
                contactado,
                notas,
                imagenes: urls.length > 0 ? [...(h.imagenes || []), ...urls] : h.imagenes || [],
                editadoPor: auth.currentUser?.email || null,
                editadoAt: Timestamp.now(),
              }
            : h
        );
        const historialOriginal = seg.historial || [];
        const esLaMasReciente = editandoEntry === historialOriginal[historialOriginal.length - 1];
        await updateDoc(doc(db, "users", cliente.uid), {
          "seguimiento.historial": nuevoHistorial,
          ...(esLaMasReciente ? { "seguimiento.contactado": contactado, "seguimiento.notas": notas } : {}),
        });
        onGuardado({ ...seg, ...(esLaMasReciente ? { contactado, notas } : {}), historial: nuevoHistorial });
      } else {
        const entrada = {
          contactado,
          cuentaCoincide: seg.cuentaCoincide ?? null,
          notas,
          tareaPendiente: seg.tareaPendiente || "",
          imagenes: urls,
          contactadoPor: auth.currentUser?.email || null,
          fecha: Timestamp.now(),
        };
        await updateDoc(doc(db, "users", cliente.uid), {
          "seguimiento.contactado": contactado,
          "seguimiento.notas": notas,
          "seguimiento.contactadoPor": entrada.contactadoPor,
          "seguimiento.fecha": serverTimestamp(),
          "seguimiento.historial": arrayUnion(entrada),
        });
        onGuardado({ ...seg, contactado, notas, contactadoPor: entrada.contactadoPor, historial: [...(seg.historial || []), entrada] });
      }
      setNotas("");
      setImagenes([]);
    } catch (e) {
      alert(e.message || "No se pudo guardar la nota.");
    } finally {
      setSubiendo(false);
      setGuardando(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
      {editandoEntry && (
        <p className="mb-2 text-[11px] font-semibold text-sky-600 dark:text-sky-400">✏️ Editando nota existente</p>
      )}
      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={contactado}
          onChange={(e) => setContactado(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        Ya contactado
      </label>
      <textarea
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        rows={2}
        placeholder="Nota — ej: le mandé el mensaje, dice que graba mañana..."
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
      />
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => setImagenes(Array.from(e.target.files || []))}
        className="mt-2 block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-200 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-slate-700 dark:text-neutral-400 dark:file:bg-neutral-700 dark:file:text-neutral-200"
      />
      {imagenes.length > 0 && <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{imagenes.length} imagen(es) lista(s)</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-700 dark:hover:bg-neutral-600"
        >
          {subiendo ? "Subiendo imágenes…" : guardando ? "Guardando…" : editandoEntry ? "💾 Guardar cambios" : "💾 Guardar nota"}
        </button>
        {editandoEntry && (
          <button
            onClick={onCancelar}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-white dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

const FILTROS = [
  { key: "sinVideoSinContactar", label: "Sin video · sin contactar" },
  { key: "sinVideoContactado", label: "Sin video · contactado" },
  { key: "conVideoSinRevisar", label: "Con video · sin revisar" },
  { key: "conVideoRevisado", label: "Con video · revisado" },
  { key: "vencidoConVideo", label: "🔴 Vencida · con video subido" },
  { key: "vencidoSinVideo", label: "🔴 Vencida · sin video subido" },
  { key: "noCoincide", label: "✕ No coincide" },
];

export default function ContactarVideos() {
  const { user } = useAuth();
  const puedeEditar = puedeEditarNotasCheck(user?.email);
  const [clientes, setClientes] = useState(null); // null = cargando lista
  const [telefonos, setTelefonos] = useState({});
  const [progreso, setProgreso] = useState({ hecho: 0, total: 0 });
  const [copiadoId, setCopiadoId] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("sinVideoSinContactar");
  const [stockPorUid, setStockPorUid] = useState({});
  const [ordenStock, setOrdenStock] = useState("none"); // "none" | "asc" | "desc"
  const [ordenChequeo, setOrdenChequeo] = useState("none"); // "none" | "recent" | "old"
  const [notaAbierta, setNotaAbierta] = useState(null);
  const [historialAbierto, setHistorialAbierto] = useState(null);
  const [editandoEntry, setEditandoEntry] = useState(null);
  const [deletingEntry, setDeletingEntry] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function cargar() {
      const [usersSnap, auditsSnap, programStart] = await Promise.all([
        getDocs(query(collection(db, "users"), where("kind", "==", "client"))),
        getDocs(collection(db, "stockAudits")),
        getAuditProgramStart(),
      ]);

      const conDeposito = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => u.contabiliumDepositoId != null);

      // Último video (más reciente) por depósito.
      const ultimoPorDeposito = new Map();
      for (const d of auditsSnap.docs) {
        const audit = toAudit(d.id, d.data());
        const key = String(audit.depositoId);
        const actual = ultimoPorDeposito.get(key);
        if (!actual || (audit.createdAt && (!actual.createdAt || audit.createdAt > actual.createdAt))) {
          ultimoPorDeposito.set(key, audit);
        }
      }

      const lista = conDeposito
        .map((u) => {
          const ultimoAudit = ultimoPorDeposito.get(String(u.contabiliumDepositoId)) || null;
          const tieneVideo = !!ultimoAudit;
          const vencido = isAuditOverdue(ultimoAudit?.createdAt || null, programStart, u.auditIntervalDays);
          const porVencer = isAuditDueSoon(ultimoAudit?.createdAt || null, programStart, u.auditIntervalDays);
          const visto = tieneVideo && (contarVistas(ultimoAudit) > 0 || !!ultimoAudit.revisadoManual);
          const noCoincide = tieneVideo && ultimoAudit?.revisadoManual?.resultado === "no_coincide";
          return {
            uid: u.id,
            nombre: u.contabiliumDepositoNombre || u.name || "(sin nombre)",
            cuit: u.cuit || "",
            contabiliumId: u.contabiliumId,
            depositoId: u.contabiliumDepositoId,
            seguimiento: u.seguimiento || null,
            ultimoAudit,
            tieneVideo,
            vencido,
            porVencer,
            visto,
            noCoincide,
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

      if (cancelled) return;
      setClientes(lista);
      setProgreso({ hecho: 0, total: lista.length });

      // Trae los teléfonos uno por uno (Contabilium rate-limita fuerte si se
      // pide todo de golpe) — con una pausa chica entre cada pedido.
      for (const c of lista) {
        if (cancelled) return;
        if (!c.contabiliumId) {
          setTelefonos((prev) => ({ ...prev, [c.uid]: null }));
          setProgreso((p) => ({ ...p, hecho: p.hecho + 1 }));
          continue;
        }
        try {
          const r = await adminGetClientPhone(c.contabiliumId);
          if (cancelled) return;
          setTelefonos((prev) => ({ ...prev, [c.uid]: r.telefono || null }));
        } catch {
          if (cancelled) return;
          setTelefonos((prev) => ({ ...prev, [c.uid]: "error" }));
        }
        setProgreso((p) => ({ ...p, hecho: p.hecho + 1 }));
        await new Promise((res) => setTimeout(res, 450));
      }

      // Trae el stock consignado (cantidad de bicis) por cliente, también
      // uno por uno para no pegarle de golpe a Contabilium.
      for (const c of lista) {
        if (cancelled) return;
        if (!c.depositoId) {
          setStockPorUid((prev) => ({ ...prev, [c.uid]: null }));
          continue;
        }
        try {
          const { items } = await getDepositoStockAdmin(Number(c.depositoId));
          const total = items
            .filter((it) => (it.category || "").toUpperCase() === "BICICLETAS")
            .reduce((acc, it) => acc + Number(it.stockActual || 0), 0);
          setStockPorUid((prev) => ({ ...prev, [c.uid]: total }));
        } catch {
          setStockPorUid((prev) => ({ ...prev, [c.uid]: null }));
        }
        await new Promise((res) => setTimeout(res, 450));
      }
    }

    cargar();
    return () => { cancelled = true; };
  }, []);

  const contadores = useMemo(() => {
    const base = {
      sinVideoSinContactar: 0,
      sinVideoContactado: 0,
      conVideoSinRevisar: 0,
      conVideoRevisado: 0,
      vencidoConVideo: 0,
      vencidoSinVideo: 0,
      noCoincide: 0,
    };
    for (const c of clientes || []) {
      const contactado = !!c.seguimiento?.contactado;
      if (!c.tieneVideo) base[contactado ? "sinVideoContactado" : "sinVideoSinContactar"]++;
      else base[c.visto ? "conVideoRevisado" : "conVideoSinRevisar"]++;
      if (c.vencido) base[c.tieneVideo ? "vencidoConVideo" : "vencidoSinVideo"]++;
      if (c.noCoincide) base.noCoincide++;
    }
    return base;
  }, [clientes]);

  const filtrados = useMemo(() => {
    if (!clientes) return [];
    let base = clientes.filter((c) => {
      const contactado = !!c.seguimiento?.contactado;
      switch (filtro) {
        case "sinVideoSinContactar": return !c.tieneVideo && !contactado;
        case "sinVideoContactado": return !c.tieneVideo && contactado;
        case "conVideoSinRevisar": return c.tieneVideo && !c.visto;
        case "conVideoRevisado": return c.tieneVideo && c.visto;
        case "vencidoConVideo": return c.vencido && c.tieneVideo;
        case "vencidoSinVideo": return c.vencido && !c.tieneVideo;
        case "noCoincide": return c.noCoincide;
        default: return true;
      }
    });
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase();
      base = base.filter((c) => `${c.nombre} ${c.cuit}`.toLowerCase().includes(q));
    }
    if (ordenChequeo !== "none") {
      base = [...base].sort((a, b) => {
        const fa = a.ultimoAudit?.revisadoManual?.fecha?.getTime?.() ?? null;
        const fb = b.ultimoAudit?.revisadoManual?.fecha?.getTime?.() ?? null;
        if (fa == null && fb == null) return 0;
        if (fa == null) return 1; // nunca chequeados van al final
        if (fb == null) return -1;
        return ordenChequeo === "recent" ? fb - fa : fa - fb;
      });
    } else if (ordenStock !== "none") {
      base = [...base].sort((a, b) => {
        const sa = stockPorUid[a.uid];
        const sb = stockPorUid[b.uid];
        if (sa == null && sb == null) return 0;
        if (sa == null) return 1; // los que todavía no cargaron/fallaron van al final
        if (sb == null) return -1;
        return ordenStock === "asc" ? sa - sb : sb - sa;
      });
    }
    return base;
  }, [clientes, busqueda, filtro, ordenStock, ordenChequeo, stockPorUid]);

  // Exporta a Excel exactamente lo que se está viendo — la pestaña activa,
  // ya filtrada por búsqueda y orden, no toda la lista completa.
  function descargarExcel() {
    const filaLabel = FILTROS.find((f) => f.key === filtro)?.label || filtro;
    const filas = filtrados.map((c) => {
      const seg = c.seguimiento || {};
      const tel = telefonos[c.uid];
      return {
        Nombre: c.nombre,
        CUIT: c.cuit || "",
        Teléfono: tel && tel !== "error" ? tel : "",
        Contactado: seg.contactado ? "Sí" : "No",
        "Contactado por": seg.contactadoPor || "",
        "Tiene video": c.tieneVideo ? "Sí" : "No",
        "Estado video": !c.tieneVideo ? "" : c.vencido ? "Vencido" : c.porVencer ? "Por vencer" : "Al día",
        "Último video": c.ultimoAudit?.createdAt ? formatFechaHora(c.ultimoAudit.createdAt) : "",
        "Bicis consignadas": stockPorUid[c.uid] ?? "",
        Notas: seg.notas || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Videos auditoría");
    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `videos-auditoria_${filaLabel.replace(/[^a-zA-Z0-9]+/g, "-")}_${fecha}.xlsx`);
  }

  function copiar(uid, texto) {
    navigator.clipboard.writeText(texto);
    setCopiadoId(uid);
    setTimeout(() => setCopiadoId(null), 1800);
  }

  function actualizarSeguimientoLocal(uid, nuevoSeg) {
    setClientes((prev) => prev.map((c) => (c.uid === uid ? { ...c, seguimiento: nuevoSeg } : c)));
    setNotaAbierta(null);
    setEditandoEntry(null);
  }

  // El chequeo manual del video se guarda desde adentro de AuditVideoPlayer
  // directo en Firestore — acá solo reflejamos ese cambio en la lista local
  // (que se cargó una sola vez con getDocs, no en vivo) para que la pestaña
  // y los contadores se actualicen al toque, sin recargar la página.
  function actualizarRevisionLocal(uid, revisadoManual) {
    setClientes((prev) =>
      prev.map((c) => {
        if (c.uid !== uid || !c.ultimoAudit) return c;
        const ultimoAudit = { ...c.ultimoAudit, revisadoManual };
        const visto = c.tieneVideo && (contarVistas(ultimoAudit) > 0 || !!revisadoManual);
        const noCoincide = c.tieneVideo && revisadoManual?.resultado === "no_coincide";
        return { ...c, ultimoAudit, visto, noCoincide };
      })
    );
  }

  async function handleEliminarNota(uid, seg, entry) {
    if (!puedeEditar) return;
    if (!confirm("¿Borrar esta nota del historial? No se puede deshacer.")) return;
    setDeletingEntry(entry);
    try {
      const nuevoHistorial = (seg.historial || []).filter((h) => h !== entry);
      await updateDoc(doc(db, "users", uid), { "seguimiento.historial": nuevoHistorial });
      setClientes((prev) => prev.map((c) => (c.uid === uid ? { ...c, seguimiento: { ...seg, historial: nuevoHistorial } } : c)));
    } catch (e) {
      alert(e.message || "No se pudo borrar la nota.");
    } finally {
      setDeletingEntry(null);
    }
  }

  const cargandoTelefonos = clientes && progreso.hecho < progreso.total;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">📹 Videos de auditoría</h2>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          {clientes === null ? "Cargando lista…" : `${clientes.length} clientes con depósito consignado`}
          {cargandoTelefonos && ` · Consultando teléfonos en Contabilium: ${progreso.hecho}/${progreso.total}…`}
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
          Las notas y el estado de "contactado" que cargues acá son los mismos que ves en Clientes 360 — quedan sincronizados.
        </p>
      </div>

      {!puedeEditar && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
          🔒 Solo Pablo y Marian pueden cargar notas o marcar contactado acá. Podés ver el estado de cada uno igual.
        </p>
      )}

      {clientes !== null && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {FILTROS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFiltro(f.key)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    filtro === f.key
                      ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                      : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                  }`}
                >
                  {f.label} ({contadores[f.key]})
                </button>
              ))}
            </div>
            <button
              onClick={descargarExcel}
              disabled={filtrados.length === 0}
              className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
            >
              📥 Descargar Excel ({filtrados.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o CUIT"
              className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-neutral-400">Ordenar por bicis consignadas:</span>
              <button
                onClick={() => setOrdenStock(ordenStock === "asc" ? "none" : "asc")}
                className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                  ordenStock === "asc"
                    ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                    : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                Menor a mayor ↑
              </button>
              <button
                onClick={() => setOrdenStock(ordenStock === "desc" ? "none" : "desc")}
                className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                  ordenStock === "desc"
                    ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                    : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                Mayor a menor ↓
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-neutral-400">Ordenar por chequeado:</span>
              <button
                onClick={() => setOrdenChequeo(ordenChequeo === "recent" ? "none" : "recent")}
                className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                  ordenChequeo === "recent"
                    ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                    : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                Más reciente
              </button>
              <button
                onClick={() => setOrdenChequeo(ordenChequeo === "old" ? "none" : "old")}
                className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                  ordenChequeo === "old"
                    ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                    : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                Más antiguo
              </button>
            </div>
          </div>
        </>
      )}

      {clientes === null && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}

      {clientes !== null && (
        <div className="space-y-3">
          {filtrados.map((c) => {
            const tel = telefonos[c.uid];
            const mensaje = generarMensaje(c);
            const telNormalizado = tel && tel !== "error" ? normalizarTelefonoWhatsapp(tel) : null;
            const seg = c.seguimiento || {};
            const contactado = !!seg.contactado;
            const estadoVideo = !c.tieneVideo ? null : c.vencido ? "🔴 Vencido" : c.porVencer ? "🟡 Por vencer" : "🟢 Al día";
            return (
              <div
                key={c.uid}
                className={`rounded-2xl border p-4 ${
                  contactado
                    ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/10"
                    : "border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{c.nombre}</p>
                    <p className="text-xs text-slate-400 dark:text-neutral-500">
                      CUIT {c.cuit || "—"} ·{" "}
                      {tel === undefined ? "buscando teléfono…" : tel === "error" ? "error al buscar teléfono" : tel === null ? "sin teléfono cargado" : tel}
                    </p>
                    <p className={`mt-0.5 text-xs font-medium ${contactado ? "text-emerald-700 dark:text-emerald-400" : "text-slate-400 dark:text-neutral-500"}`}>
                      {contactado ? "✓ Contactado" : "Sin contactar"}
                      {seg.contactadoPor ? ` · ${seg.contactadoPor}` : ""}
                      {seg.fecha?.toDate ? ` · ${formatFechaHora(seg.fecha.toDate())}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                      {c.tieneVideo
                        ? `${estadoVideo} · último video: ${formatFechaHora(c.ultimoAudit.createdAt)}`
                        : "Nunca subió un video"}
                    </p>
                    {seg.notas && (
                      <p className="mt-1 max-w-md text-xs italic text-slate-500 dark:text-neutral-400">"{seg.notas}"</p>
                    )}
                    {(seg.historial || []).length > 0 && (
                      <button
                        onClick={() => setHistorialAbierto((v) => (v === c.uid ? null : c.uid))}
                        className="mt-1 text-[11px] font-semibold text-sky-600 underline decoration-dotted hover:text-sky-700 dark:text-sky-400"
                      >
                        {historialAbierto === c.uid ? "Ocultar historial" : `📜 Ver historial completo (${seg.historial.length})`}
                      </button>
                    )}
                    {(() => {
                      const ultimasImagenes = seg.historial?.[seg.historial.length - 1]?.imagenes || [];
                      return ultimasImagenes.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {ultimasImagenes.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="Adjunto" className="h-10 w-10 rounded-lg border border-slate-200 object-cover dark:border-neutral-700" />
                            </a>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>

                  <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-5 py-2.5 text-center dark:border-neutral-700 dark:bg-neutral-800/60">
                    {stockPorUid[c.uid] === undefined ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-neutral-600" />
                    ) : stockPorUid[c.uid] === null ? (
                      <span className="text-xs font-medium text-slate-400 dark:text-neutral-500">Sin datos</span>
                    ) : (
                      <span className="text-3xl font-extrabold leading-none text-slate-900 dark:text-white">{stockPorUid[c.uid]}</span>
                    )}
                    <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                      🚲 consignadas
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => copiar(c.uid, mensaje)}
                      className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                    >
                      {copiadoId === c.uid ? "✅ Copiado" : "📋 Copiar mensaje"}
                    </button>
                    {telNormalizado ? (
                      <a
                        href={`https://wa.me/${telNormalizado}?text=${encodeURIComponent(mensaje)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                      >
                        💬 Abrir WhatsApp
                      </a>
                    ) : (
                      <span className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400 dark:border-neutral-700 dark:text-neutral-500">
                        Sin teléfono
                      </span>
                    )}
                    {puedeEditar && (
                      <button
                        onClick={() => setNotaAbierta((v) => (v === c.uid ? null : c.uid))}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {notaAbierta === c.uid ? "Cerrar" : "✏️ Nota / Contactado"}
                      </button>
                    )}
                  </div>
                </div>

                {c.tieneVideo && (
                  <AuditVideoPlayer
                    audit={c.ultimoAudit}
                    className="mt-3"
                    onRevisadoChange={(revisadoManual) => actualizarRevisionLocal(c.uid, revisadoManual)}
                  />
                )}

                {puedeEditar && notaAbierta === c.uid && (
                  <FormNota
                    cliente={c}
                    editandoEntry={editandoEntry}
                    onGuardado={(nuevoSeg) => actualizarSeguimientoLocal(c.uid, nuevoSeg)}
                    onCancelar={() => setEditandoEntry(null)}
                  />
                )}

                {historialAbierto === c.uid && (
                  <div className="mt-3 border-t border-slate-200 pt-3 dark:border-neutral-700">
                    <HistorialSeguimiento
                      historial={seg.historial}
                      puedeEditar={puedeEditar}
                      onEditar={(entry) => {
                        setNotaAbierta(c.uid);
                        setEditandoEntry(entry);
                      }}
                      onEliminar={(entry) => handleEliminarNota(c.uid, seg, entry)}
                      deletingEntry={deletingEntry}
                    />
                  </div>
                )}

                {(!c.tieneVideo || c.vencido) && (
                  <p className="mt-3 whitespace-pre-line rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-400">
                    {mensaje}
                  </p>
                )}
              </div>
            );
          })}
          {filtrados.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-neutral-500">Sin resultados.</p>
          )}
        </div>
      )}
    </div>
  );
}
