// src/services/ubicacionChofer.ts
// Ubicación en vivo del chofer — su navegador la manda cada tanto (con su
// permiso de GPS) y queda en un doc por chofer, así el admin puede ver
// dónde está en el momento sin que el chofer tenga que avisar por chat.
import { collection, doc, onSnapshot, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export type UbicacionChofer = {
  uid: string;
  nombre: string | null;
  lat: number;
  lon: number;
  accuracy: number | null;
  updatedAt: Date | null;
};

function toUbicacion(id: string, data: any): UbicacionChofer {
  return {
    uid: id,
    nombre: data?.nombre ?? null,
    lat: data?.lat,
    lon: data?.lon,
    accuracy: data?.accuracy ?? null,
    updatedAt: data?.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
  };
}

export async function compartirUbicacion({
  uid,
  nombre,
  lat,
  lon,
  accuracy,
}: {
  uid: string;
  nombre: string | null;
  lat: number;
  lon: number;
  accuracy: number | null;
}): Promise<void> {
  await setDoc(
    doc(db, "ubicacionesChofer", uid),
    { nombre, lat, lon, accuracy, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export function subscribeUbicacionChofer(uid: string, cb: (u: UbicacionChofer | null) => void) {
  return onSnapshot(doc(db, "ubicacionesChofer", uid), (snap) => {
    cb(snap.exists() ? toUbicacion(snap.id, snap.data()) : null);
  });
}

// Todos los choferes que alguna vez compartieron ubicación (para el panel
// de admin, que hoy es solo Julián pero puede sumar más).
export function subscribeUbicacionesChoferes(cb: (us: UbicacionChofer[]) => void) {
  return onSnapshot(collection(db, "ubicacionesChofer"), (snap) => {
    cb(snap.docs.map((d) => toUbicacion(d.id, d.data())));
  });
}
