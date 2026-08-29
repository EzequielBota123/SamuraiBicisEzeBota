// src/services/stockAudits.ts
import { collection, addDoc, arrayUnion, deleteDoc, doc, getDoc, query, where, orderBy, limit, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../firebase";
import { authReady } from "../authReady";

export type AuditVista = {
  uid: string;
  nombre: string;
  fecha: Date;
};

export type ResultadoRevision = "coincide" | "no_coincide" | "otro";

export type RevisionManual = {
  uid: string;
  nombre: string;
  fecha: Date;
  resultado: ResultadoRevision | null;
  nota: string;
};

export type DeteccionAuto = {
  bicicletas: number;
  maxSimultaneas: number;
  cajas: number;
  cajasMaxSimultaneas: number;
  samplesAnalizados: number;
  confianzaPromedio: number;
  computedAt: Date;
};

export type StockAudit = {
  id: string;
  depositoId: string;
  depositoNombre: string;
  distributorUid: string;
  distributorName: string;
  videoUrl: string;
  createdAt: Date | null;
  vistoPor: AuditVista[];
  revisadoManual: RevisionManual | null;
  deteccionAuto: DeteccionAuto | null;
};

const AUDIT_INTERVAL_DAYS = 10;

export function toAudit(id: string, data: any): StockAudit {
  return {
    id,
    depositoId: String(data?.depositoId || ""),
    depositoNombre: data?.depositoNombre || "",
    distributorUid: data?.distributorUid || "",
    distributorName: data?.distributorName || "",
    videoUrl: data?.videoUrl || "",
    createdAt: data?.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
    vistoPor: Array.isArray(data?.vistoPor)
      ? data.vistoPor.map((v: any) => ({
          uid: v?.uid || "",
          nombre: v?.nombre || "",
          fecha: v?.fecha instanceof Timestamp ? v.fecha.toDate() : new Date(),
        }))
      : [],
    revisadoManual: data?.revisadoManual
      ? {
          uid: data.revisadoManual.uid || "",
          nombre: data.revisadoManual.nombre || "",
          fecha: data.revisadoManual.fecha instanceof Timestamp ? data.revisadoManual.fecha.toDate() : new Date(),
          resultado: data.revisadoManual.resultado || null,
          nota: data.revisadoManual.nota || "",
        }
      : null,
    deteccionAuto: data?.deteccionAuto
      ? {
          bicicletas: Number(data.deteccionAuto.bicicletas || 0),
          maxSimultaneas: Number(data.deteccionAuto.maxSimultaneas || 0),
          cajas: Number(data.deteccionAuto.cajas || 0),
          cajasMaxSimultaneas: Number(data.deteccionAuto.cajasMaxSimultaneas || 0),
          samplesAnalizados: Number(data.deteccionAuto.samplesAnalizados || 0),
          confianzaPromedio: Number(data.deteccionAuto.confianzaPromedio || 0),
          computedAt: data.deteccionAuto.computedAt instanceof Timestamp ? data.deteccionAuto.computedAt.toDate() : new Date(),
        }
      : null,
  };
}

// Registra una reproducción del video por un admin — se llama en cada play
// (no solo la primera vez), para poder mostrar cuántas veces se vio.
export async function registrarVisto(auditId: string, uid: string, nombre: string): Promise<void> {
  await updateDoc(doc(db, "stockAudits", auditId), {
    vistoPor: arrayUnion({ uid, nombre: nombre || "", fecha: Timestamp.now() }),
  });
}

// Doble chequeo manual, independiente del contador automático de
// reproducciones: alguien confirma a propósito "sí, ya lo revisé bien",
// dejando además si lo que muestra el video coincide o no con lo que hay
// cargado (o una nota libre para el caso "otro"). Contar como "revisado"
// (además del contador de reproducciones) se resuelve en cada pantalla
// chequeando si `revisadoManual` no es null.
export async function guardarRevisionManual(
  auditId: string,
  uid: string,
  nombre: string,
  resultado: ResultadoRevision | null,
  nota: string = ""
): Promise<void> {
  await updateDoc(doc(db, "stockAudits", auditId), {
    revisadoManual: { uid, nombre: nombre || "", fecha: Timestamp.now(), resultado, nota },
  });
}

export async function quitarRevisionManual(auditId: string): Promise<void> {
  await updateDoc(doc(db, "stockAudits", auditId), { revisadoManual: null });
}

// Guarda el resultado de la detección automática de bicis (TensorFlow.js
// coco-ssd, corrida en el browser del admin) para no tener que recalcularla
// cada vez que alguien abre el mismo video.
export async function guardarDeteccionAuto(
  auditId: string,
  deteccion: {
    bicicletas: number;
    maxSimultaneas: number;
    cajas: number;
    cajasMaxSimultaneas: number;
    samplesAnalizados: number;
    confianzaPromedio: number;
  }
): Promise<void> {
  await updateDoc(doc(db, "stockAudits", auditId), {
    deteccionAuto: { ...deteccion, computedAt: Timestamp.now() },
  });
}

export function contarVistas(audit: Pick<StockAudit, "vistoPor">): number {
  return audit.vistoPor?.length || 0;
}

export function ultimaVista(audit: Pick<StockAudit, "vistoPor">): AuditVista | null {
  const lista = audit.vistoPor || [];
  return lista.length > 0 ? lista[lista.length - 1] : null;
}

// Últimas auditorías (video) de un depósito, más reciente primero.
export async function listAuditsByDeposito(depositoId: string | number, max = 20): Promise<StockAudit[]> {
  const q = query(
    collection(db, "stockAudits"),
    where("depositoId", "==", String(depositoId)),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toAudit(d.id, d.data()));
}

export async function uploadAudit({
  depositoId,
  depositoNombre,
  distributorUid,
  distributorName,
  blob,
  recordedAt,
}: {
  depositoId: string | number;
  depositoNombre: string;
  distributorUid: string;
  distributorName: string;
  blob: Blob;
  // Momento real en que se grabó (reloj del celular), no cuando termina de
  // subirse — importante si la conexión es lenta y la subida tarda.
  recordedAt?: Date;
}): Promise<void> {
  const user = await authReady();
  if (!user) throw new Error("No hay sesión activa. Iniciá sesión y volvé a intentar.");
  await user.getIdToken(true);

  const fileRef = ref(storage, `stock-audits/${depositoId}/${Date.now()}.webm`);
  const snap = await uploadBytes(fileRef, blob, {
    contentType: "video/webm",
    customMetadata: { uploadedBy: user.uid },
  });
  const videoUrl = await getDownloadURL(snap.ref);

  await addDoc(collection(db, "stockAudits"), {
    depositoId: String(depositoId),
    depositoNombre: depositoNombre || "",
    distributorUid,
    distributorName: distributorName || "",
    videoUrl,
    createdAt: Timestamp.fromDate(recordedAt || new Date()),
  });
}

export async function deleteAudit(id: string, videoUrl?: string): Promise<void> {
  await deleteDoc(doc(db, "stockAudits", id));
  if (videoUrl) {
    try {
      const match = videoUrl.match(/\/o\/(.+?)(\?|$)/);
      if (match) {
        const path = decodeURIComponent(match[1]);
        await deleteObject(ref(storage, path));
      }
    } catch (err) {
      console.warn("No se pudo borrar el video de Storage:", err);
    }
  }
}

// Fecha de arranque del programa de auditorías (se usa como base para
// quienes todavía nunca grabaron ninguna, en vez de tratarlos como
// "vencidos" desde el día uno).
let _programStartCache: Date | null | undefined;
export async function getAuditProgramStart(): Promise<Date | null> {
  if (_programStartCache !== undefined) return _programStartCache;
  const snap = await getDoc(doc(db, "meta", "stockAuditProgram"));
  const startedAt = snap.exists() ? snap.data().startedAt : null;
  _programStartCache = startedAt instanceof Timestamp ? startedAt.toDate() : null;
  return _programStartCache;
}

// Base sobre la que se calcula el próximo vencimiento: el último video, o
// si nunca grabó ninguno, la fecha en que arrancó el programa.
function auditBaseDate(lastAuditAt: Date | null, programStart: Date | null): Date | null {
  return lastAuditAt || programStart || null;
}

// intervalDays: por defecto 10 para todos, pero algunos clientes puntuales
// tienen un ciclo distinto guardado en su propio usuario (users/{uid}.auditIntervalDays).
export function nextAuditDate(lastAuditAt: Date | null, programStart: Date | null = null, intervalDays: number = AUDIT_INTERVAL_DAYS): Date | null {
  const base = auditBaseDate(lastAuditAt, programStart);
  if (!base) return null;
  const next = new Date(base);
  next.setDate(next.getDate() + intervalDays);
  return next;
}

export function isAuditOverdue(lastAuditAt: Date | null, programStart: Date | null = null, intervalDays: number = AUDIT_INTERVAL_DAYS): boolean {
  const base = auditBaseDate(lastAuditAt, programStart);
  if (!base) return true; // ni video ni fecha de arranque conocida: no hay forma de saber, se marca para revisar
  const next = nextAuditDate(lastAuditAt, programStart, intervalDays);
  return !next || next.getTime() <= Date.now();
}

// true si faltan <= 2 días para que venza (y todavía no venció).
export function isAuditDueSoon(lastAuditAt: Date | null, programStart: Date | null = null, intervalDays: number = AUDIT_INTERVAL_DAYS): boolean {
  const base = auditBaseDate(lastAuditAt, programStart);
  if (!base) return false;
  const next = nextAuditDate(lastAuditAt, programStart, intervalDays);
  if (!next) return false;
  const msLeft = next.getTime() - Date.now();
  return msLeft > 0 && msLeft <= 2 * 24 * 60 * 60 * 1000;
}

export { AUDIT_INTERVAL_DAYS };
