import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";

// Tablero puramente visual: acá se anota a mano un pedido que un cliente
// pidió de alguno de los 3 depósitos propios, para no perderlo de vista
// hasta confirmarlo. No mueve stock ni toca Contabilium — es solo una lista
// compartida entre el equipo.
export type ItemPedidoPendiente = {
  sku: string;
  nombre: string;
  cantidad: number;
};

export type EstadoPedidoPendiente = "pendiente" | "confirmado" | "cancelado";

export type PedidoPendiente = {
  id?: string;
  deposito: string; // "Lavalle" | "Cañuelas" | "Credifin"
  clienteNombre: string;
  clienteContabiliumId?: number | null;
  clienteTelefono?: string;
  items: ItemPedidoPendiente[];
  notas?: string;
  estado: EstadoPedidoPendiente;
  creadoPorNombre?: string;
  // Se completan al confirmar — el viaje que se generó solo en la grilla
  // logística, para poder linkear desde acá.
  fechaConfirmada?: string | null;
  turnoConfirmado?: string | null;
  viajeId?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

const col = collection(db, "pedidosPendientes");

export function subscribePedidosPendientes(
  cb: (items: PedidoPendiente[]) => void,
  onError?: (error: unknown) => void
) {
  const q = query(col, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PedidoPendiente[]),
    onError
  );
}

export async function crearPedidoPendiente(data: {
  deposito: string;
  clienteNombre: string;
  clienteContabiliumId?: number | null;
  clienteTelefono?: string;
  items: ItemPedidoPendiente[];
  notas?: string;
  creadoPorNombre?: string;
}) {
  const ref = await addDoc(col, {
    deposito: data.deposito,
    clienteNombre: data.clienteNombre.trim(),
    clienteContabiliumId: data.clienteContabiliumId ?? null,
    clienteTelefono: data.clienteTelefono?.trim() || "",
    items: data.items,
    notas: data.notas?.trim() || "",
    estado: "pendiente" as EstadoPedidoPendiente,
    creadoPorNombre: data.creadoPorNombre || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function actualizarEstadoPedidoPendiente(id: string, estado: EstadoPedidoPendiente) {
  await updateDoc(doc(col, id), { estado, updatedAt: serverTimestamp() });
}

// Al confirmar un pedido se le pone fecha (y turno) y queda linkeado al
// viaje que se creó en la grilla logística del chofer.
export async function confirmarPedidoPendiente(
  id: string,
  data: { fecha: string; turno: string; viajeId: string }
) {
  await updateDoc(doc(col, id), {
    estado: "confirmado" as EstadoPedidoPendiente,
    fechaConfirmada: data.fecha,
    turnoConfirmado: data.turno,
    viajeId: data.viajeId,
    updatedAt: serverTimestamp(),
  });
}

export async function eliminarPedidoPendiente(id: string) {
  await deleteDoc(doc(col, id));
}

export async function obtenerPedidoPendiente(id: string): Promise<PedidoPendiente | null> {
  const snap = await getDoc(doc(col, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as any) } as PedidoPendiente;
}

// El depósito propio de un cliente en Contabilium (si tiene uno) — hace
// falta para saber a dónde mover el stock cuando se confirma un pedido; si
// no tiene, no se puede hacer un movimiento de stock (habría que facturarle
// directo en cambio).
export async function obtenerDepositoDeCliente(
  contabiliumId: number
): Promise<{ depositoId: number; depositoNombre: string | null } | null> {
  const snap = await getDocs(query(collection(db, "users"), where("contabiliumId", "==", contabiliumId)));
  const u = snap.docs[0]?.data() as any;
  if (!u?.contabiliumDepositoId) return null;
  return { depositoId: u.contabiliumDepositoId, depositoNombre: u.contabiliumDepositoNombre || null };
}
