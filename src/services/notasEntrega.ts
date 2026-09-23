// src/services/notasEntrega.ts
// Notas del chofer ligadas a un cliente/entrega — separadas de
// seguimiento.historial (Clientes 360), que solo pueden editar Pablo y
// Marian. Cualquier staff (admin o chofer) las lee; el chofer que las creó
// (o un admin) puede editarlas/borrarlas.
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";

export type NotaEntrega = {
  id: string;
  clienteUid: string;
  clienteNombre: string;
  clienteContabiliumId: number | null;
  choferUid: string;
  choferNombre: string;
  texto: string;
  createdAt: Date | null;
};

function toNotaEntrega(id: string, data: any): NotaEntrega {
  return {
    id,
    clienteUid: data?.clienteUid || "",
    clienteNombre: data?.clienteNombre || "",
    clienteContabiliumId: data?.clienteContabiliumId ?? null,
    choferUid: data?.choferUid || "",
    choferNombre: data?.choferNombre || "",
    texto: data?.texto || "",
    createdAt: data?.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
  };
}

export async function addNotaEntrega({
  clienteUid,
  clienteNombre,
  clienteContabiliumId,
  choferUid,
  choferNombre,
  texto,
}: {
  clienteUid: string;
  clienteNombre: string;
  clienteContabiliumId?: number | null;
  choferUid: string;
  choferNombre: string;
  texto: string;
}): Promise<void> {
  const limpio = texto.trim();
  if (!limpio) return;
  await addDoc(collection(db, "notasEntrega"), {
    clienteUid,
    clienteNombre: clienteNombre || "",
    clienteContabiliumId: clienteContabiliumId ?? null,
    choferUid,
    choferNombre: choferNombre || "",
    texto: limpio,
    createdAt: Timestamp.now(),
  });
}

// Todas las notas de un cliente puntual, en vivo — para Clientes 360 (admin)
// y el detalle del chofer.
export function subscribeNotasEntregaPorCliente(
  clienteUid: string,
  onData: (notas: NotaEntrega[]) => void
): () => void {
  const q = query(collection(db, "notasEntrega"), where("clienteUid", "==", clienteUid), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => toNotaEntrega(d.id, d.data()))));
}

// Últimas notas de TODOS los clientes, en vivo — para el feed del chofer.
export function subscribeNotasEntregaRecientes(onData: (notas: NotaEntrega[]) => void): () => void {
  const q = query(collection(db, "notasEntrega"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => toNotaEntrega(d.id, d.data()))));
}

export async function updateNotaEntrega(id: string, texto: string): Promise<void> {
  const limpio = texto.trim();
  if (!limpio) return;
  await updateDoc(doc(db, "notasEntrega", id), { texto: limpio });
}

export async function deleteNotaEntrega(id: string): Promise<void> {
  await deleteDoc(doc(db, "notasEntrega", id));
}
