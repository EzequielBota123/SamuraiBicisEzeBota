// src/services/notifications.ts
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase";

export type NotificationItem = {
  id: string;
  type: string;
  orderId: string;
  orderStatus: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCuit: string | null;
  customerNotes: string | null;
  total: number;
  itemsCount: number;
  items: Array<{ id: string | null; name: string; sku: string | number | null; qty: number; price: number }>;
  contabilium: {
    contabiliumId: number | null;
    idListaPrecio: number | null;
    condicionIva: number | string | null;
    cuit: string | null;
  } | null;
  read: boolean;
  attended: boolean;
  createdAt: Date | null;
  // Campos específicos de notificaciones type:"sale_reported" (venta
  // reportada por un distribuidor desde "Mi stock").
  distributorUid: string | null;
  distributorName: string | null;
  depositoNombre: string | null;
};

const NOTIFICATIONS = collection(db, "notifications");

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  return null;
}

function toNotification(id: string, data: any): NotificationItem {
  return {
    id,
    type: String(data?.type || "order"),
    orderId: String(data?.orderId || ""),
    orderStatus: String(data?.orderStatus || ""),
    customerName: String(data?.customerName || "Cliente sin nombre"),
    customerEmail: data?.customerEmail ?? null,
    customerPhone: data?.customerPhone ?? null,
    customerCuit: data?.customerCuit ?? null,
    customerNotes: data?.customerNotes ?? null,
    total: Number(data?.total ?? 0),
    itemsCount: Number(data?.itemsCount ?? 0),
    // Compat: notificaciones de venta viejas (antes de agrupar) guardaban un
    // solo sku/name/quantity/unitPrice suelto en vez de un array "items".
    items: Array.isArray(data?.items)
      ? data.items
      : data?.type === "sale_reported" && data?.sku
      ? [{ sku: data.sku, name: data.name, quantity: data.quantity, unitPrice: data.unitPrice }]
      : [],
    contabilium: data?.contabilium ?? null,
    read: Boolean(data?.read),
    attended: Boolean(data?.attended),
    createdAt: toDate(data?.createdAt),
    distributorUid: data?.distributorUid ?? null,
    distributorName: data?.distributorName ?? null,
    depositoNombre: data?.depositoNombre ?? null,
  };
}

// Suscripción en tiempo real a las últimas notificaciones (las más recientes primero).
export function subscribeNotifications(
  onData: (items: NotificationItem[]) => void,
  onError: (err: Error) => void = console.error,
  max = 30
): () => void {
  const q = query(NOTIFICATIONS, orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => toNotification(d.id, d.data()))),
    (err) => onError(err)
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, "notifications", id), {
    read: true,
    readAt: serverTimestamp(),
  });
}

export async function markNotificationAttended(id: string): Promise<void> {
  await updateDoc(doc(db, "notifications", id), {
    attended: true,
    read: true,
    attendedAt: serverTimestamp(),
  });
}

// Marca como leídas todas las notificaciones sin leer.
export async function markAllNotificationsRead(): Promise<void> {
  const snap = await getDocs(query(NOTIFICATIONS, where("read", "==", false), limit(200)));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { read: true, readAt: serverTimestamp() }));
  await batch.commit();
}

export async function deleteNotification(id: string): Promise<void> {
  await deleteDoc(doc(db, "notifications", id));
}

// Reemplaza la lista de items de una notificación agrupada (p.ej. al marcar
// facturada una de las ventas reportadas dentro del grupo).
export async function updateNotificationItems(id: string, items: unknown[]): Promise<void> {
  await updateDoc(doc(db, "notifications", id), { items });
}

// Borra todas las notificaciones actualmente cargadas (las últimas `max` del
// subscribeNotifications, que es lo que se ve en el panel de la campana).
export async function deleteAllNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(db, "notifications", id)));
  await batch.commit();
}
