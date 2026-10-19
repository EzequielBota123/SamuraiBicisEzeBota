// src/services/orders.ts
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
  runTransaction,
  DocumentSnapshot,
} from "firebase/firestore";
import { auth } from "../firebase";
import { db } from "../firebase";
import { authReady } from "../authReady";

export type OrderItem = { id: string; name: string; price: number; qty: number; sku?: string; };
export type Customer = { name: string; email?: string; phone?: string; notes?: string; };

const ORDERS = collection(db, "orders");
const FUNCTIONS_BASE_URL = "https://us-central1-bikeshop-ab2f0.cloudfunctions.net";

export type StockShortage = { id: string; name: string; available: number; requested: number };

// Valida en vivo contra Contabilium (no contra el campo "stock" cacheado)
// justo antes de confirmar el pedido, para achicar la ventana en la que el
// catálogo muestra stock que ya no está disponible de verdad.
export async function checkStockEnVivo(
  items: Array<{ id: string; name: string; sku?: string; qty: number }>
): Promise<{ ok: boolean; shortages: StockShortage[] }> {
  const itemsConSku = items.filter((it) => it.sku);
  if (itemsConSku.length === 0) return { ok: true, shortages: [] };

  const user = auth.currentUser ?? (await authReady());
  if (!user) throw new Error("Necesitás una cuenta de distribuidor para hacer un pedido.");
  const token = await user.getIdToken();

  const res = await fetch(`${FUNCTIONS_BASE_URL}/checkStockEnVivo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items: itemsConSku }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

function sum(items: OrderItem[]) {
  return items.reduce((acc, it) => acc + Number(it.price || 0) * Number(it.qty || 0), 0);
}

export type OrderStatus = "solicitud" | "pendiente" | "facturado" | "pagada" | "cancelada";

export type OrderRecord = {
  id: string;
  status: OrderStatus;
  total?: number;
  customer?: (Customer & { uid?: string | null }) | null;
  items?: OrderItem[];
  createdAt?: Date | null;
  updatedAt?: Date | null;
  facturadoAt?: Date | null;
  paidAt?: Date | null;
  contabiliumComprobanteId?: number | null;
  contabiliumComprobanteNumero?: string | null;
};

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  return null;
}

const allowedStatuses: OrderStatus[] = ["solicitud", "pendiente", "facturado", "pagada", "cancelada"];

function normalizeStatus(value: unknown): OrderStatus {
  const raw = String(value || "");
  return (allowedStatuses.includes(raw as OrderStatus) ? raw : "solicitud") as OrderStatus;
}

function normalizeItems(rawItems: unknown): OrderItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item: any) => ({
      id: String(item?.id || ""),
      name: String(item?.name || ""),
      price: Number(item?.price ?? 0),
      qty: Number(item?.qty ?? 0),
      sku: item?.sku ? String(item.sku) : undefined,
    }))
    .filter((it) => it.id && it.name);
}

function toOrderRecord(id: string, snap: DocumentSnapshot<DocumentData>): OrderRecord {
  const data = snap.data() as any;

  return {
    id,
    status: normalizeStatus(data?.status),
    total: Number(data?.total ?? 0) || undefined,
    customer: data?.customer ?? null,
    items: normalizeItems(data?.items),
    createdAt: toDate(data?.createdAt),
    updatedAt: toDate(data?.updatedAt),
    facturadoAt: toDate(data?.facturadoAt),
    paidAt: toDate(data?.paidAt),
    contabiliumComprobanteId: data?.contabiliumComprobanteId ?? null,
    contabiliumComprobanteNumero: data?.contabiliumComprobanteNumero ?? null,
  };
}

export async function createOrder({
  customer, items,
}: { customer: Customer; items: OrderItem[]; }): Promise<string> {
  const user = auth.currentUser ?? await authReady();
  // Pedir sin cuenta genera confusión (pedidos de gente sin vínculo real con
  // Samurai, ej. el caso "Saul") — solo un distribuidor logueado puede
  // pedir; a cualquier otro se lo redirige a "Quiero ser distribuidor"
  // antes de siquiera llegar acá (ver OrderModal en CatalogPage). Esto es
  // el resguardo real del lado del cliente: aunque alguien saltee la
  // pantalla, este chequeo (más la regla de Firestore) lo frena igual.
  if (!user) throw new Error("Necesitás una cuenta de distribuidor para hacer un pedido.");

  const cleanItems = items.map(it => ({
    id: String(it.id),
    name: String(it.name || "").trim(),
    price: Number(it.price || 0),
    qty: Math.max(1, Math.min(999, Number(it.qty || 1))),
    ...(it.sku ? { sku: String(it.sku) } : {}),
  })).filter(it => it.id && it.name && it.qty > 0);

  if (!cleanItems.length) throw new Error("Carrito vacío.");

  const now = serverTimestamp();

  const payload: any = {
    status: "pendiente",
    currency: "ARS",
    createdAt: now,
    updatedAt: now,
    customer: {
      uid: user.uid,
      name: String(customer.name || "").trim(),
      email: customer.email || null,
      phone: customer.phone || null,
      notes: customer.notes || null,
    },
    customerNameLower: String(customer.name || "").trim().toLowerCase(),
    items: cleanItems,
    total: sum(cleanItems),
  };

  const orderId = await runTransaction(db, async (tx) => {
    const counterRef = doc(db, "meta", "orderCounter");
    const counterSnap = await tx.get(counterRef);
    const lastOrderNumber = Number(counterSnap.data()?.lastOrderNumber ?? 0);
    const nextOrderNumber = lastOrderNumber + 1;

    const orderRef = doc(ORDERS, String(nextOrderNumber));
    const productSnapshots: Array<{
      ref: ReturnType<typeof doc>;
      currentStock: number;
      item: typeof cleanItems[number];
    }> = [];

    for (const item of cleanItems) {
      const productRef = doc(db, "products", item.id);
      const snap = await tx.get(productRef);
      if (!snap.exists()) {
        throw new Error(`El producto "${item.name}" ya no está disponible.`);
      }
      const data = snap.data();
      const currentStock = Number(data?.stock ?? 0);
      if (currentStock < item.qty) {
        throw new Error(`No hay stock suficiente para "${item.name}".`);
      }
      productSnapshots.push({ ref: productRef, currentStock, item });
    }

    tx.set(counterRef, { lastOrderNumber: nextOrderNumber }, { merge: true });

    for (const { ref, currentStock, item } of productSnapshots) {
      tx.update(ref, {
        stock: currentStock - item.qty,
        updatedAt: serverTimestamp(),
      });
    }

    tx.set(orderRef, payload);
    return String(nextOrderNumber);
  });

  return orderId;
}

export type ListOrdersParams = {
  status?: "all" | "pendiente" | "pagada" | "cancelada" | "solicitud";
  from?: Date | null;
  to?: Date | null;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
};
// Devuelve las más recientes; filtra por status y rango de fechas en el servidor.
// La búsqueda por texto (q) la hacemos cliente para simplicidad.
export async function listOrders(params: ListOrdersParams = {}) {
  const {
    status = "all",
    from = null,
    to = null,
    pageSize = 50,
    cursor = null
  } = params;

  const clauses: any[] = [];
  if (status !== "all") clauses.push(where("status", "==", status));
  if (from) clauses.push(where("createdAt", ">=", Timestamp.fromDate(from)));
  if (to)   clauses.push(where("createdAt", "<=", Timestamp.fromDate(to)));

  let q = query(ORDERS, ...clauses, orderBy("createdAt", "desc"), limit(pageSize));
  if (cursor) q = query(q, startAfter(cursor));

  const snap = await getDocs(q);
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
  return { items, nextCursor };
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: "pendiente" | "facturado" | "pagada" | "cancelada" | "hecho"
) {
  const patch: any = { status: newStatus, updatedAt: serverTimestamp() };
  if (newStatus === "facturado") patch.facturadoAt = serverTimestamp();
  if (newStatus === "pagada") patch.paidAt = serverTimestamp();
  await updateDoc(doc(db, "orders", orderId), patch);
}

// Actualiza los items de un pedido propio (para sacar productos si el
// cliente se arrepiente antes de que Samurai lo procese). Si queda sin
// items, cancela el pedido directamente.
export async function updateMyOrderItems(orderId: string, items: OrderItem[]) {
  const total = items.reduce((acc, it) => acc + Number(it.price || 0) * Number(it.qty || 0), 0);
  const patch: any = { items, total, updatedAt: serverTimestamp() };
  if (items.length === 0) patch.status = "cancelada";
  await updateDoc(doc(db, "orders", orderId), patch);
}

// Vincula manualmente una orden con el número de comprobante de Contabilium.
// La sincronización (M6) resuelve el saldo y actualiza el estado en la próxima corrida.
export async function linkOrderComprobante(orderId: string, numero: string) {
  const value = String(numero || "").trim();
  await updateDoc(doc(db, "orders", orderId), {
    contabiliumComprobanteNumero: value || null,
    updatedAt: serverTimestamp(),
  });
}

export async function getOrderStatus(orderId: string, opts: { email?: string } = {}): Promise<OrderRecord> {
  const trimmedId = String(orderId || "").trim();
  if (!trimmedId) {
    throw new Error("Ingresá un número de pedido válido.");
  }

  const snap = await getDoc(doc(ORDERS, trimmedId));
  if (!snap.exists()) {
    throw new Error("No encontramos un pedido con ese código.");
  }

  const data = snap.data() as any;
  const inputEmail = String(opts.email || "").trim().toLowerCase();
  const orderEmail = String(data?.customer?.email || "").trim().toLowerCase();
  if (inputEmail && orderEmail && inputEmail !== orderEmail) {
    throw new Error("El correo electrónico no coincide con la orden.");
  }

  return toOrderRecord(snap.id, snap);
}

export async function deleteOrder(orderId: string): Promise<void> {
  await deleteDoc(doc(db, "orders", orderId));
}

export async function listCustomerOrders(uid: string): Promise<OrderRecord[]> {
  const trimmedUid = String(uid || "").trim();
  if (!trimmedUid) {
    throw new Error("No encontramos la cuenta del cliente para consultar los pedidos.");
  }

  const q = query(
    ORDERS,
    where("customer.uid", "==", trimmedUid),
    orderBy("createdAt", "desc"),
    limit(50),
  );

  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => toOrderRecord(docSnap.id, docSnap));
}

