// src/services/chequeosVehiculo.ts
// Chequeo de vehículo antes de salir a ruta — el chofer marca un checklist
// fijo + aclaraciones, queda "pendiente" hasta que un admin (o chofer con
// permiso) le da el OK o lo rechaza con un comentario. Uno por chofer por
// día (doc id `${choferUid}_${fecha}`), así reintentar el mismo día
// actualiza el mismo registro en vez de crear uno nuevo.
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp, Timestamp, collection, query, orderBy, limit as fbLimit } from "firebase/firestore";
import { db } from "../firebase";

export type ItemChequeo = { label: string; ok: boolean };

export type EstadoChequeo = "pendiente" | "aprobado" | "rechazado";

export type ChequeoVehiculo = {
  id: string;
  choferUid: string;
  choferNombre: string;
  fecha: string; // YYYY-MM-DD
  items: ItemChequeo[];
  observacionChofer: string;
  estado: EstadoChequeo;
  comentarioAdmin: string | null;
  respondidoPor: string | null;
  createdAt: Date | null;
  respondidoAt: Date | null;
};

// Checklist fijo — si hace falta un ítem más específico por vehículo más
// adelante, se puede volver configurable, pero esto cubre lo esencial.
export const ITEMS_CHECKLIST_DEFAULT = [
  "Frenos",
  "Luces",
  "Neumáticos",
  "Nivel de aceite",
  "Nivel de combustible",
  "Documentación al día (cédula, seguro, VTV)",
];

function toChequeo(id: string, data: any): ChequeoVehiculo {
  return {
    id,
    choferUid: data?.choferUid || "",
    choferNombre: data?.choferNombre || "",
    fecha: data?.fecha || "",
    items: Array.isArray(data?.items) ? data.items : [],
    observacionChofer: data?.observacionChofer || "",
    estado: data?.estado || "pendiente",
    comentarioAdmin: data?.comentarioAdmin ?? null,
    respondidoPor: data?.respondidoPor ?? null,
    createdAt: data?.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
    respondidoAt: data?.respondidoAt instanceof Timestamp ? data.respondidoAt.toDate() : null,
  };
}

function idDelDia(choferUid: string, fecha: string) {
  return `${choferUid}_${fecha}`;
}

export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// El chofer envía (o reenvía, si lo rechazaron) su chequeo del día.
export async function enviarChequeoVehiculo({
  choferUid,
  choferNombre,
  fecha,
  items,
  observacionChofer,
}: {
  choferUid: string;
  choferNombre: string;
  fecha: string;
  items: ItemChequeo[];
  observacionChofer: string;
}): Promise<void> {
  await setDoc(doc(db, "chequeosVehiculo", idDelDia(choferUid, fecha)), {
    choferUid,
    choferNombre,
    fecha,
    items,
    observacionChofer: observacionChofer.trim() || null,
    estado: "pendiente",
    comentarioAdmin: null,
    respondidoPor: null,
    createdAt: serverTimestamp(),
    respondidoAt: null,
  });
}

// Admin (o chofer con permiso) aprueba o rechaza el chequeo del día de un chofer.
export async function responderChequeoVehiculo({
  choferUid,
  fecha,
  aprobar,
  comentarioAdmin,
  respondidoPor,
}: {
  choferUid: string;
  fecha: string;
  aprobar: boolean;
  comentarioAdmin?: string;
  respondidoPor: string;
}): Promise<void> {
  await setDoc(
    doc(db, "chequeosVehiculo", idDelDia(choferUid, fecha)),
    {
      estado: aprobar ? "aprobado" : "rechazado",
      comentarioAdmin: comentarioAdmin?.trim() || null,
      respondidoPor,
      respondidoAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function subscribeChequeoDelDia(
  choferUid: string,
  fecha: string,
  cb: (chequeo: ChequeoVehiculo | null) => void
) {
  return onSnapshot(doc(db, "chequeosVehiculo", idDelDia(choferUid, fecha)), (snap) => {
    cb(snap.exists() ? toChequeo(snap.id, snap.data()) : null);
  });
}

export async function getChequeoDelDia(choferUid: string, fecha: string): Promise<ChequeoVehiculo | null> {
  const snap = await getDoc(doc(db, "chequeosVehiculo", idDelDia(choferUid, fecha)));
  return snap.exists() ? toChequeo(snap.id, snap.data()) : null;
}

// Últimos N chequeos de todos los choferes (para el panel de admin).
export function subscribeChequeosRecientes(cb: (chequeos: ChequeoVehiculo[]) => void, max = 50) {
  const q = query(collection(db, "chequeosVehiculo"), orderBy("createdAt", "desc"), fbLimit(max));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => toChequeo(d.id, d.data()))));
}
