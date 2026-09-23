// src/services/logisticaViajes.ts
// Viajes de la grilla de logística: cada viaje es un traslado origen →
// destino dentro de un turno (mañana/tarde/noche), con hora de salida,
// tiempo estimado (lo calcula el mapa) y un estado que va actualizando el
// chofer desde su grilla. El admin los carga y ve los cambios en vivo.
import { addDoc, collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { Turno } from "./logisticaTurnos";

export type Lugar = {
  tipo: "deposito" | "cliente" | "libre";
  id: string | null; // id del depósito propio, o contabiliumId del cliente
  nombre: string;
  direccion: string;
  lat: number | null;
  lon: number | null;
  horario?: string | null;
  telefono?: string | null;
};

// Depósitos/puntos propios de Samurai — las direcciones son las que pasó
// el equipo; el mapa las ubica con Google al cargar un viaje.
export const DEPOSITOS_PROPIOS: Array<Omit<Lugar, "tipo" | "lat" | "lon">> = [
  {
    id: "lavalle",
    nombre: "Lavalle (Temperley)",
    direccion: "Lavalle 105, B1834 Temperley, Provincia de Buenos Aires",
  },
  {
    id: "canuelas",
    nombre: "Depósito Cañuelas",
    direccion: "Highway Route 6 Km 96.7, Cañuelas, Provincia de Buenos Aires",
  },
  {
    id: "avellaneda",
    nombre: "Avellaneda (Larraburu)",
    direccion: "Avenida Teodoro Sánchez de Bustamante 880, Avellaneda, Provincia de Buenos Aires",
    horario: "Lunes a Viernes de 8 a 16:30",
    telefono: "11 2535-0039",
  },
];

export type EstadoViaje = "programado" | "en_camino" | "llego" | "entregado" | "cancelado";

export const ESTADO_INFO: Record<EstadoViaje, { label: string; icono: string; cls: string }> = {
  programado: { label: "Programado", icono: "🗓️", cls: "bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300" },
  en_camino: { label: "En camino", icono: "🚚", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400" },
  llego: { label: "Llegó al destino", icono: "📍", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" },
  entregado: { label: "Entregado", icono: "✅", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" },
  cancelado: { label: "Cancelado", icono: "✕", cls: "bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400" },
};

export type Viaje = {
  id: string;
  fecha: string; // YYYY-MM-DD
  turno: Turno;
  origen: Lugar;
  destino: Lugar;
  horaSalida: string | null; // "HH:MM"
  duracionMin: number | null; // estimado por el mapa
  distanciaKm: number | null;
  descargaMin: number; // tiempo estimado de carga/descarga en destino
  notas: string;
  estado: EstadoViaje;
  choferUid: string | null;
  choferNombre: string | null;
  saliAt: Date | null;
  llegoAt: Date | null;
  entregadoAt: Date | null;
  remito: { numero: string | null; id: number | null; tienePdf: boolean } | null;
  creadoPorNombre: string | null;
  updatedAt: Date | null;
};

const COL = "logisticaViajes";

function toDate(v: unknown): Date | null {
  return v instanceof Timestamp ? v.toDate() : null;
}

function toLugar(d: any): Lugar {
  return {
    tipo: d?.tipo || "libre",
    id: d?.id ?? null,
    nombre: d?.nombre || "",
    direccion: d?.direccion || "",
    lat: typeof d?.lat === "number" ? d.lat : null,
    lon: typeof d?.lon === "number" ? d.lon : null,
    horario: d?.horario ?? null,
    telefono: d?.telefono ?? null,
  };
}

function toViaje(id: string, d: any): Viaje {
  return {
    id,
    fecha: d?.fecha || "",
    turno: d?.turno || "mañana",
    origen: toLugar(d?.origen),
    destino: toLugar(d?.destino),
    horaSalida: d?.horaSalida ?? null,
    duracionMin: typeof d?.duracionMin === "number" ? d.duracionMin : null,
    distanciaKm: typeof d?.distanciaKm === "number" ? d.distanciaKm : null,
    descargaMin: typeof d?.descargaMin === "number" ? d.descargaMin : 20,
    notas: d?.notas || "",
    estado: (d?.estado as EstadoViaje) || "programado",
    choferUid: d?.choferUid ?? null,
    choferNombre: d?.choferNombre ?? null,
    saliAt: toDate(d?.saliAt),
    llegoAt: toDate(d?.llegoAt),
    entregadoAt: toDate(d?.entregadoAt),
    remito: d?.remito ? { numero: d.remito.numero ?? null, id: d.remito.id ?? null, tienePdf: !!d.remito.tienePdf } : null,
    creadoPorNombre: d?.creadoPorNombre ?? null,
    updatedAt: toDate(d?.updatedAt),
  };
}

// Fecha/hora de salida planificada como Date local.
export function salidaPlanificada(v: Pick<Viaje, "fecha" | "horaSalida">): Date | null {
  if (!v.fecha || !v.horaSalida) return null;
  const d = new Date(`${v.fecha}T${v.horaSalida}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Llegada estimada = salida + tiempo del mapa. Si ya salió de verdad, se
// cuenta desde la salida real (así una salida tarde corre la llegada).
export function llegadaEstimada(v: Viaje): Date | null {
  if (v.duracionMin == null) return null;
  const base = v.saliAt || salidaPlanificada(v);
  return base ? new Date(base.getTime() + v.duracionMin * 60000) : null;
}

// Cuándo queda libre la camioneta: llegada + tiempo de descarga.
export function libreEstimado(v: Viaje): Date | null {
  const llegada = v.llegoAt || llegadaEstimada(v);
  return llegada ? new Date(llegada.getTime() + v.descargaMin * 60000) : null;
}

export function subscribeViajesRango(desde: string, hasta: string, cb: (v: Viaje[]) => void, onError?: (e: Error) => void) {
  const q = query(collection(db, COL), where("fecha", ">=", desde), where("fecha", "<=", hasta));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => toViaje(d.id, d.data()))),
    (err) => onError?.(err)
  );
}

export type DatosViaje = {
  fecha: string;
  turno: Turno;
  origen: Lugar;
  destino: Lugar;
  horaSalida: string | null;
  duracionMin: number | null;
  distanciaKm: number | null;
  descargaMin: number;
  notas: string;
  remito?: { numero: string | null; id: number | null; tienePdf: boolean } | null;
  chofer?: { uid: string; nombre: string } | null; // a quién se le asigna el viaje
};

function lugarPlano(l: Lugar) {
  return {
    tipo: l.tipo,
    id: l.id ?? null,
    nombre: l.nombre,
    direccion: l.direccion,
    lat: l.lat ?? null,
    lon: l.lon ?? null,
    horario: l.horario ?? null,
    telefono: l.telefono ?? null,
  };
}

export async function crearViaje(datos: DatosViaje, actor: { uid: string; nombre: string | null }): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    fecha: datos.fecha,
    turno: datos.turno,
    origen: lugarPlano(datos.origen),
    destino: lugarPlano(datos.destino),
    horaSalida: datos.horaSalida || null,
    duracionMin: datos.duracionMin ?? null,
    distanciaKm: datos.distanciaKm ?? null,
    descargaMin: datos.descargaMin,
    notas: datos.notas.trim(),
    estado: "programado",
    choferUid: datos.chofer?.uid ?? null,
    choferNombre: datos.chofer?.nombre ?? null,
    saliAt: null,
    llegoAt: null,
    entregadoAt: null,
    remito: datos.remito ?? null,
    creadoPorUid: actor.uid,
    creadoPorNombre: actor.nombre,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function actualizarViaje(id: string, datos: DatosViaje): Promise<void> {
  await updateDoc(doc(db, COL, id), {
    fecha: datos.fecha,
    turno: datos.turno,
    origen: lugarPlano(datos.origen),
    destino: lugarPlano(datos.destino),
    horaSalida: datos.horaSalida || null,
    duracionMin: datos.duracionMin ?? null,
    distanciaKm: datos.distanciaKm ?? null,
    descargaMin: datos.descargaMin,
    notas: datos.notas.trim(),
    ...(datos.remito !== undefined ? { remito: datos.remito } : {}),
    ...(datos.chofer !== undefined ? { choferUid: datos.chofer?.uid ?? null, choferNombre: datos.chofer?.nombre ?? null } : {}),
    updatedAt: serverTimestamp(),
  });
}

// Avance de estado que hace el chofer desde su grilla — deja la hora real
// de cada paso (salió / llegó / entregó) y quién lo marcó.
export async function cambiarEstadoViaje(
  id: string,
  estado: EstadoViaje,
  actor: { uid: string; nombre: string | null }
): Promise<void> {
  const patch: Record<string, unknown> = {
    estado,
    choferUid: actor.uid,
    choferNombre: actor.nombre,
    updatedAt: serverTimestamp(),
  };
  if (estado === "en_camino") patch.saliAt = serverTimestamp();
  if (estado === "llego") patch.llegoAt = serverTimestamp();
  if (estado === "entregado") patch.entregadoAt = serverTimestamp();
  await updateDoc(doc(db, COL, id), patch);
}

export async function eliminarViaje(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

// El PDF del remito se guarda aparte del viaje (así la grilla en vivo no
// arrastra ~100 KB por viaje) y se baja solo cuando el chofer toca "Ver
// remito".
export async function guardarPdfRemitoViaje(viajeId: string, { archivo, pdfBase64 }: { archivo: string | null; pdfBase64: string }) {
  await setDoc(doc(db, "logisticaViajesRemitos", viajeId), { archivo, pdfBase64, updatedAt: serverTimestamp() });
}

export async function obtenerPdfRemitoViaje(viajeId: string): Promise<{ archivo: string | null; pdfBase64: string } | null> {
  const snap = await getDoc(doc(db, "logisticaViajesRemitos", viajeId));
  if (!snap.exists()) return null;
  const d = snap.data() as any;
  return { archivo: d.archivo ?? null, pdfBase64: d.pdfBase64 };
}

// Cuando después de mover el stock se genera el remito real (a nombre del
// cliente), el viaje pasa a mostrar ese remito en lugar del interno.
export async function actualizarRemitoViaje(
  viajeId: string,
  { numero, archivo, pdfBase64 }: { numero: string | null; archivo: string | null; pdfBase64: string | null }
): Promise<void> {
  await updateDoc(doc(db, COL, viajeId), {
    remito: { numero: numero ?? null, id: null, tienePdf: !!pdfBase64 },
    updatedAt: serverTimestamp(),
  });
  if (pdfBase64) await guardarPdfRemitoViaje(viajeId, { archivo, pdfBase64 });
}
