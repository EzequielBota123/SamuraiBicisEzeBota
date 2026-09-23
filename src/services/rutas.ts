// src/services/rutas.ts
// Registro de rutas (inicio/fin + anotaciones) colgado del mapa — lo usan
// admin, chofer y Alfredo Bavcevich (vía `vendedoresAsignados`) desde el
// mismo componente de mapa. El pedido fue que "todos" puedan ver el
// historial de rutas ya cerradas, no solo quien la hizo.
import { addDoc, collection, doc, onSnapshot, orderBy, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";

export type Ruta = {
  id: string;
  iniciadoPorUid: string;
  iniciadoPorNombre: string;
  inicioAt: Date | null;
  notaInicio: string;
  estado: "abierta" | "cerrada";
  finalizadoPorUid: string | null;
  finalizadoPorNombre: string | null;
  finAt: Date | null;
  notaFin: string;
};

function toRuta(id: string, data: any): Ruta {
  return {
    id,
    iniciadoPorUid: data?.iniciadoPorUid || "",
    iniciadoPorNombre: data?.iniciadoPorNombre || "",
    inicioAt: data?.inicioAt instanceof Timestamp ? data.inicioAt.toDate() : null,
    notaInicio: data?.notaInicio || "",
    estado: data?.estado === "cerrada" ? "cerrada" : "abierta",
    finalizadoPorUid: data?.finalizadoPorUid || null,
    finalizadoPorNombre: data?.finalizadoPorNombre || null,
    finAt: data?.finAt instanceof Timestamp ? data.finAt.toDate() : null,
    notaFin: data?.notaFin || "",
  };
}

export async function iniciarRuta({
  uid,
  nombre,
  notaInicio,
}: {
  uid: string;
  nombre: string;
  notaInicio: string;
}): Promise<void> {
  await addDoc(collection(db, "rutas"), {
    iniciadoPorUid: uid,
    iniciadoPorNombre: nombre || "",
    inicioAt: Timestamp.now(),
    notaInicio: (notaInicio || "").trim(),
    estado: "abierta",
    finalizadoPorUid: null,
    finalizadoPorNombre: null,
    finAt: null,
    notaFin: "",
  });
}

export async function finalizarRuta(
  id: string,
  { uid, nombre, notaFin }: { uid: string; nombre: string; notaFin: string }
): Promise<void> {
  await updateDoc(doc(db, "rutas", id), {
    estado: "cerrada",
    finalizadoPorUid: uid,
    finalizadoPorNombre: nombre || "",
    finAt: Timestamp.now(),
    notaFin: (notaFin || "").trim(),
  });
}

// La ruta abierta más reciente (debería haber a lo sumo una a la vez) — en
// vivo, para que si alguien la cierra desde otro dispositivo el banner se
// actualice solo.
export function subscribeRutaAbierta(onData: (ruta: Ruta | null) => void): () => void {
  const q = query(collection(db, "rutas"), where("estado", "==", "abierta"), orderBy("inicioAt", "desc"));
  return onSnapshot(
    q,
    (snap) => onData(snap.empty ? null : toRuta(snap.docs[0].id, snap.docs[0].data())),
    () => onData(null)
  );
}

// Historial de rutas ya cerradas, en vivo — visible para todos (admin,
// chofer y Alfredo) porque comparten el mismo componente de mapa.
export function subscribeRutasCerradas(onData: (rutas: Ruta[]) => void): () => void {
  const q = query(collection(db, "rutas"), where("estado", "==", "cerrada"), orderBy("finAt", "desc"));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => toRuta(d.id, d.data()))),
    () => onData([])
  );
}
