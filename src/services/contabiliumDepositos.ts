// src/services/contabiliumDepositos.ts
// Mapeo cliente -> depósito de Contabilium. Vive en Firestore (no en el
// bundle del sitio) porque son nombres reales de distribuidores; el acceso
// de lectura está restringido a usuarios staff en firestore.rules.
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export type ContabiliumDeposito = { id: number; nombre: string; codigo?: number };

let cache: ContabiliumDeposito[] | null = null;

export async function getContabiliumDepositos(): Promise<ContabiliumDeposito[]> {
  if (cache) return cache;
  const snap = await getDoc(doc(db, "internalData", "contabiliumDepositos"));
  const list = snap.exists() ? (snap.data().depositos as ContabiliumDeposito[]) : [];
  cache = list;
  return list;
}

// Etiqueta para mostrar en listas/selects: nuestro número propio (1-80,
// estable) + el nombre + el ID real que usa Contabilium por detrás, para
// poder ubicar el mismo depósito en los dos sistemas.
export function labelDeposito(d: ContabiliumDeposito): string {
  const prefijo = d.codigo != null ? `${d.codigo} · ` : "";
  return `${prefijo}${d.nombre} (Contabilium #${d.id})`;
}

export function matchDeposito(d: ContabiliumDeposito, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return d.nombre.toLowerCase().includes(query) || String(d.codigo ?? "") === query || String(d.id) === query;
}
