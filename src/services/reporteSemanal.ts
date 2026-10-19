// src/services/reporteSemanal.ts
// Bitácora de trabajo: un doc por día (id = fecha ISO), con una lista de
// renglones que se van agregando durante el día — pensado para anotar en el
// momento lo que se va haciendo, y al cerrar la semana bajar todo junto en
// PDF (ver generateReporteSemanalPdf).
import { arrayRemove, arrayUnion, collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";

export type ItemReporte = {
  texto: string;
  hora: string; // "HH:MM"
  autor: string;
};

export type DiaReporte = {
  fecha: string; // YYYY-MM-DD
  items: ItemReporte[];
};

const COL = "reporteSemanal";

export function subscribeReporteSemana(
  desde: string,
  hasta: string,
  cb: (dias: DiaReporte[]) => void,
  onError?: (e: Error) => void
) {
  const q = query(collection(db, COL), where("fecha", ">=", desde), where("fecha", "<=", hasta));
  return onSnapshot(
    q,
    (snap) => {
      const dias = snap.docs.map((d) => ({ fecha: d.id, items: (d.data().items as ItemReporte[]) || [] }));
      dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
      cb(dias);
    },
    (err) => onError?.(err)
  );
}

export async function agregarEntradaReporte(fecha: string, texto: string, autor: string) {
  const item: ItemReporte = {
    texto: texto.trim(),
    hora: new Date().toTimeString().slice(0, 5),
    autor,
  };
  await setDoc(
    doc(db, COL, fecha),
    { fecha, items: arrayUnion(item), updatedAt: serverTimestamp() },
    { merge: true }
  );
  return item;
}

export async function eliminarEntradaReporte(fecha: string, item: ItemReporte) {
  await setDoc(doc(db, COL, fecha), { items: arrayRemove(item), updatedAt: serverTimestamp() }, { merge: true });
}
