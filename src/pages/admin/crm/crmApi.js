import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";

const vendedoresCol = collection(db, "crmVendedores");
const clientesCol = collection(db, "crmClientes");
const asignacionesCol = collection(db, "crmAsignaciones");

export async function fetchVendedores() {
  const snap = await getDocs(query(vendedoresCol, orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchClientes() {
  const snap = await getDocs(query(clientesCol, orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchAsignaciones() {
  const snap = await getDocs(asignacionesCol);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addVendedor(nombre) {
  await addDoc(vendedoresCol, { nombre });
}

export async function renameVendedor(id, nombre) {
  await updateDoc(doc(db, "crmVendedores", id), { nombre });
}

export async function deleteVendedor(id) {
  await deleteDoc(doc(db, "crmVendedores", id));
}

// payload: [{ cliente_id, vendedor_nombre, estado, notas }]
// El doc de asignación se guarda con id = cliente_id (fuerza unicidad, igual
// que el UNIQUE(cliente_id) que tenía la tabla en Supabase).
export async function upsertAsignaciones(payload) {
  const batch = writeBatch(db);
  payload.forEach((row) => {
    const ref = doc(db, "crmAsignaciones", String(row.cliente_id));
    batch.set(
      ref,
      {
        cliente_id: row.cliente_id,
        vendedor_nombre: row.vendedor_nombre,
        estado: row.estado,
        notas: row.notas || "",
        fecha_asignacion: serverTimestamp(),
      },
      { merge: true }
    );
  });
  await batch.commit();
}

export async function updateAsignacion(clienteId, patch) {
  await updateDoc(doc(db, "crmAsignaciones", String(clienteId)), patch);
}

export async function deleteAsignacion(clienteId) {
  await deleteDoc(doc(db, "crmAsignaciones", String(clienteId)));
}

export async function addCliente(cliente) {
  await addDoc(clientesCol, cliente);
}

export async function updateCliente(id, patch) {
  await updateDoc(doc(db, "crmClientes", id), patch);
}

export async function deleteCliente(id) {
  await deleteDoc(doc(db, "crmClientes", id));
}

export function subscribeCrmRealtime(onChange) {
  const unsub1 = onSnapshot(vendedoresCol, onChange, console.error);
  const unsub2 = onSnapshot(clientesCol, onChange, console.error);
  const unsub3 = onSnapshot(asignacionesCol, onChange, console.error);
  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}
