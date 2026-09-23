// src/services/redesVendedores.ts
// Stock manual por sub-vendedor de una red de distribución (ej. los 5
// vendedores de Federico Stortini) — no está atado a un depósito real de
// Contabilium, es cuenta que el staff carga/actualiza a mano: quién tiene
// qué bicis, para saber cuánto le queda a cada uno y quién vendió qué.
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../firebase";

export type ItemRedVendedor = { sku: string; nombre: string; cantidad: number };

export type RedVendedor = {
  id: string;
  distribuidorContabiliumId: number;
  nombre: string;
  items: ItemRedVendedor[];
  totalBicis: number;
  updatedAt?: any;
  updatedByNombre?: string;
};

const col = collection(db, "redesVendedores");

// Pega filas copiadas de un Excel (SKU, Nombre, Cantidad separados por tab
// o por 2+ espacios) y devuelve la lista de items + el total. Tolera líneas
// vacías, encabezados de sección (una sola celda, ej. "BOWIE") y espacios
// de más.
export function parsearItemsExcel(texto: string): ItemRedVendedor[] {
  const items: ItemRedVendedor[] = [];
  for (const lineaCruda of texto.split("\n")) {
    const linea = lineaCruda.trim();
    if (!linea) continue;
    const partes = linea.split(/\t+/).map((p) => p.trim()).filter(Boolean);
    const celdas = partes.length >= 2 ? partes : linea.split(/ {2,}/).map((p) => p.trim()).filter(Boolean);
    if (celdas.length < 2) continue; // encabezado de sección, sin cantidad
    const cantidad = Number(celdas[celdas.length - 1].replace(/\D/g, ""));
    if (!Number.isFinite(cantidad)) continue;
    const sku = /^\d+$/.test(celdas[0]) ? celdas[0] : "";
    const nombre = celdas.slice(sku ? 1 : 0, -1).join(" ").trim();
    if (!nombre) continue;
    items.push({ sku, nombre, cantidad });
  }
  return items;
}

export function subscribeRedVendedores(
  distribuidorContabiliumId: number,
  cb: (items: RedVendedor[]) => void,
  onError?: (e: any) => void
) {
  const q = query(
    col,
    where("distribuidorContabiliumId", "==", distribuidorContabiliumId),
    orderBy("nombre")
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as RedVendedor[]),
    onError
  );
}

export async function guardarVendedorRed(params: {
  id?: string | null;
  distribuidorContabiliumId: number;
  nombre: string;
  items: ItemRedVendedor[];
  actualizadoPorNombre: string;
}) {
  const totalBicis = params.items.reduce((acc, it) => acc + Number(it.cantidad || 0), 0);
  const data = {
    distribuidorContabiliumId: params.distribuidorContabiliumId,
    nombre: params.nombre.trim(),
    items: params.items,
    totalBicis,
    updatedAt: serverTimestamp(),
    updatedByNombre: params.actualizadoPorNombre,
  };
  if (params.id) {
    await updateDoc(doc(db, "redesVendedores", params.id), data);
    return params.id;
  }
  const ref = await addDoc(col, data);
  return ref.id;
}

export async function eliminarVendedorRed(id: string) {
  await deleteDoc(doc(db, "redesVendedores", id));
}

// Atribución de una venta (factura real de Contabilium) a un vendedor de la
// red — deja registro de quién la vendió y le descuenta esa cantidad del
// stock que tiene cargado. Clave del registro: factura + SKU, así volver a
// atribuir la misma línea (por error, o a otro vendedor) actualiza en vez
// de duplicar.
export type VentaAtribuida = {
  id: string;
  facturaId: number;
  facturaNumero?: string;
  sku: string;
  cantidad: number;
  itemNombre?: string;
  vendedorId: string;
  vendedorNombre: string;
  distribuidorContabiliumId: number;
  updatedAt?: any;
};

const colVentas = collection(db, "redesVendedoresVentas");

export function subscribeVentasAtribuidas(
  distribuidorContabiliumId: number,
  cb: (items: VentaAtribuida[]) => void,
  onError?: (e: any) => void
) {
  const q = query(colVentas, where("distribuidorContabiliumId", "==", distribuidorContabiliumId));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as VentaAtribuida[]),
    onError
  );
}

// Suma (o resta, con delta negativo) una cantidad al item de ese SKU en el
// stock cargado del vendedor. Devuelve false si el vendedor ya no existe o
// no tiene ese SKU cargado (no rompe el flujo — la atribución igual queda
// registrada, solo no hay de dónde descontar).
async function ajustarCantidadItemVendedor(vendedorId: string, sku: string, delta: number): Promise<boolean> {
  if (!sku) return false;
  const ref = doc(db, "redesVendedores", vendedorId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data() as any;
  const items: ItemRedVendedor[] = data.items || [];
  const idx = items.findIndex((it) => it.sku === sku);
  if (idx === -1) return false;
  const nuevos = items.map((it, i) =>
    i === idx ? { ...it, cantidad: Math.max(0, Number(it.cantidad || 0) + delta) } : it
  );
  const totalBicis = nuevos.reduce((acc, it) => acc + Number(it.cantidad || 0), 0);
  await updateDoc(ref, { items: nuevos, totalBicis });
  return true;
}

export async function atribuirVentaAVendedor(params: {
  facturaId: number;
  facturaNumero?: string;
  sku: string;
  cantidad: number;
  itemNombre?: string;
  vendedorId: string;
  vendedorNombre: string;
  distribuidorContabiliumId: number;
}): Promise<{ ok: true; descontado: boolean }> {
  const ventaId = `${params.facturaId}_${params.sku || "sin-sku"}`;
  const ventaRef = doc(db, "redesVendedoresVentas", ventaId);
  const ventaSnap = await getDoc(ventaRef);
  const anterior = ventaSnap.exists() ? (ventaSnap.data() as VentaAtribuida) : null;

  let descontado: boolean;
  if (anterior && anterior.vendedorId === params.vendedorId) {
    descontado = true; // ya estaba descontado a este mismo vendedor, no se toca de nuevo
  } else {
    if (anterior) {
      // Estaba atribuida a otro vendedor — le devolvemos esa cantidad
      // antes de sacársela al nuevo.
      await ajustarCantidadItemVendedor(anterior.vendedorId, anterior.sku, anterior.cantidad);
    }
    descontado = await ajustarCantidadItemVendedor(params.vendedorId, params.sku, -params.cantidad);
  }

  await setDoc(ventaRef, {
    facturaId: params.facturaId,
    facturaNumero: params.facturaNumero || "",
    sku: params.sku || "",
    cantidad: params.cantidad,
    itemNombre: params.itemNombre || "",
    vendedorId: params.vendedorId,
    vendedorNombre: params.vendedorNombre,
    distribuidorContabiliumId: params.distribuidorContabiliumId,
    updatedAt: serverTimestamp(),
  });

  return { ok: true, descontado };
}
