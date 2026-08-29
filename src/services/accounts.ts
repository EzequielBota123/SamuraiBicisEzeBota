// src/services/accounts.ts
import {
  addDoc, collection, serverTimestamp, doc,
  onSnapshot, query, where, orderBy,
  updateDoc, deleteDoc
} from "firebase/firestore";
import { db } from "../firebase";
import { validateCuit } from "../utils/cuit";

export type Account = {
  id?: string;
  name: string;
  email: string;
  emailLower: string;
  phone?: string;
  company?: string;
  cuit?: string;
  province?: string;
  city?: string;
  vertical?: string;
  customerTypeId?: string | null;
  vendedor?: string | null;
  // Integración Contabilium
  contabiliumId?:   number | null;
  idListaPrecio?:   number | null;
  condicionIva?:    string | null;
  contabiliumSync?: any;
  // Depósito consignado (stock por distribuidor)
  contabiliumDepositoId?:      number | null;
  contabiliumDepositoNombre?:  string | null;
  kind: "client" | "staff";
  role: "client" | "viewer" | "manager" | "admin";
  status: "pending" | "activo" | "suspendido" | "rejected";
  approved?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

const col = collection(db, "users");

/** ===== Leads desde el formulario público ===== */
export async function createClientLead(form: {
  nombre: string; email: string; celular?: string; empresa?: string; cuit?: string;
  provincia?: string; localidad?: string; rubro?: string; mensaje?: string; acepta: boolean;
}) {
  if (!form.cuit) throw new Error("El CUIT es obligatorio.");
  if (!validateCuit(form.cuit)) throw new Error("El CUIT ingresado no es válido.");

  const ref = await addDoc(col, {
    name: form.nombre ?? "",
    email: form.email ?? "",
    emailLower: (form.email || "").trim().toLowerCase(),
    phone: form.celular ?? "",
    company: form.empresa ?? "",
    cuit: form.cuit ?? "",
    province: form.provincia ?? "",
    city: form.localidad ?? "",
    vertical: form.rubro ?? "",
    note: form.mensaje ?? "",
    kind: "client",
    role: "client",
    status: "pending",     // ⬅️ clave para tus filtros
    approved: false,       // opcional/legacy
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** ===== Listados (tiempo real) ===== */
export function subscribeClients(
  status: "pending" | "activo" | "suspendido" | "rejected" | "all",
  cb: (items: Account[]) => void,
  onError?: (e:any)=>void
) {
  const base = [where("kind", "==", "client"), orderBy("createdAt", "desc")];
  const q = status === "all"
    ? query(col, ...base)
    : query(col, where("status", "==", status), ...base);

  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Account[]),
    onError
  );
}

/** ===== Acciones admin ===== */
export async function approveClient(id: string) {
  await updateDoc(doc(db, "users", id), {
    status: "activo",
    approved: true,
    updatedAt: serverTimestamp(),
  });
}

export async function rejectClient(id: string, reason?: string) {
  await updateDoc(doc(db, "users", id), {
    status: "rejected",
    reviewReason: reason || null,
    updatedAt: serverTimestamp(),
  });
}

export async function updateAccount(id: string, patch: Partial<Account>) {
  const p: any = { ...patch, updatedAt: serverTimestamp() };
  if (p.email) p.emailLower = String(p.email).trim().toLowerCase();
  if (p.customerTypeId === "") p.customerTypeId = null;
  await updateDoc(doc(db, "users", id), p);
}

export async function toggleAccountStatus(id: string, next: "activo" | "suspendido") {
  await updateAccount(id, { status: next });
}

export async function removeAccount(id: string) {
  await deleteDoc(doc(db, "users", id));
}

/** ===== Aliases para NO tocar tu Users.jsx actual ===== */
export function subscribeUsers(cb: any, onError?: any) {
  // lista todos los clientes
  return subscribeClients("all", cb, onError);
}

export async function createUser(data: {
  name: string;
  email: string;
  role?: Account["role"];
  status?: Account["status"];
  kind?: Account["kind"];
  customerTypeId?: string | null;
}) {
  // alta manual desde admin
  const ref = await addDoc(col, {
    name: data.name?.trim() || "",
    email: data.email?.trim() || "",
    emailLower: (data.email || "").trim().toLowerCase(),
    role: data.role || "client",
    status: data.status || "activo",
    kind: data.kind || "client",
    customerTypeId: data.customerTypeId || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateUser(id: string, patch: Partial<Account>) {
  return updateAccount(id, patch);
}

export async function toggleUserStatus(id: string, next: "activo" | "suspendido") {
  return toggleAccountStatus(id, next);
}

export { removeAccount as removeUser };

// Por compatibilidad con tu nombre previo:
export const createAccount = approveClient;

const SYNC_CLIENT_URL = "https://us-central1-bikeshop-ab2f0.cloudfunctions.net/syncClientProfile";

export async function syncClientContabiliumProfile(uid: string): Promise<{
  contabiliumId: number;
  idListaPrecio: number | null;
}> {
  const res = await fetch(SYNC_CLIENT_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ uid }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sync Contabilium error ${res.status}: ${text}`);
  }
  return res.json();
}
