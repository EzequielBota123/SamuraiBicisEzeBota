// src/services/logisticaTurnos.ts
// Grilla de logística: cuándo sale la camioneta y a qué hora se desocupa,
// por turno (mañana/tarde/noche) — la carga el chofer a medida que pasa el
// día, y el admin la puede ver/editar para planificar. Un doc por
// fecha+turno (`${fecha}_${turno}`), así todos ven y editan el mismo dato.
import { collection, doc, onSnapshot, query, setDoc, serverTimestamp, Timestamp, where } from "firebase/firestore";
import { db } from "../firebase";

export const TURNOS = ["mañana", "tarde", "noche"] as const;
export type Turno = (typeof TURNOS)[number];

export type TurnoLogistica = {
  id: string;
  fecha: string; // YYYY-MM-DD
  turno: Turno;
  horaSalida: string | null; // "HH:MM"
  horaLibre: string | null; // "HH:MM"
  notas: string;
  choferUid: string | null;
  choferNombre: string | null;
  updatedAt: Date | null;
};

function toTurno(id: string, data: any): TurnoLogistica {
  return {
    id,
    fecha: data?.fecha || "",
    turno: data?.turno || "mañana",
    horaSalida: data?.horaSalida ?? null,
    horaLibre: data?.horaLibre ?? null,
    notas: data?.notas || "",
    choferUid: data?.choferUid ?? null,
    choferNombre: data?.choferNombre ?? null,
    updatedAt: data?.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
  };
}

function idDeTurno(fecha: string, turno: Turno) {
  return `${fecha}_${turno}`;
}

export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// Próximos `dias` días (incluyendo hoy) en formato YYYY-MM-DD.
export function proximosDias(dias = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function guardarTurno({
  fecha,
  turno,
  horaSalida,
  horaLibre,
  notas,
  choferUid,
  choferNombre,
}: {
  fecha: string;
  turno: Turno;
  horaSalida?: string | null;
  horaLibre?: string | null;
  notas?: string;
  choferUid?: string | null;
  choferNombre?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = { fecha, turno, updatedAt: serverTimestamp() };
  if (horaSalida !== undefined) patch.horaSalida = horaSalida || null;
  if (horaLibre !== undefined) patch.horaLibre = horaLibre || null;
  if (notas !== undefined) patch.notas = notas.trim();
  if (choferUid !== undefined) patch.choferUid = choferUid;
  if (choferNombre !== undefined) patch.choferNombre = choferNombre;
  await setDoc(doc(db, "logisticaTurnos", idDeTurno(fecha, turno)), patch, { merge: true });
}

// Todos los turnos cargados entre fechaDesde y fechaHasta (inclusive).
export function subscribeTurnosRango(
  fechaDesde: string,
  fechaHasta: string,
  cb: (turnos: TurnoLogistica[]) => void
) {
  const q = query(collection(db, "logisticaTurnos"), where("fecha", ">=", fechaDesde), where("fecha", "<=", fechaHasta));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => toTurno(d.id, d.data()))));
}
