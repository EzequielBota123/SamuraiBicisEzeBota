// src/services/situacionClientes.ts
// Situación comercial de cada cliente (color + nota), marcada a mano desde
// el mapa mientras se los va llamando — vive aparte de seguimiento.historial
// porque es un estado puntual (A/B/C/D), no un log de notas.
import { collection, doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export type SituacionColor = "verde" | "amarillo" | "naranja" | "rojo" | "vencido";

export type SituacionCliente = {
  color: SituacionColor;
  etiqueta: string;
  nota: string;
  llamado: boolean;
  updatedByNombre: string;
  updatedAt: Date | null;
};

export const SITUACION_OPCIONES: { color: SituacionColor; emoji: string; label: string; hex: string }[] = [
  { color: "verde", emoji: "🟢", label: "OK — al día", hex: "#22c55e" },
  { color: "amarillo", emoji: "🟡", label: "En gestión / seguimiento", hex: "#eab308" },
  { color: "naranja", emoji: "🟠", label: "Irregular", hex: "#f97316" },
  { color: "rojo", emoji: "🔴", label: "Irregular grave / no responde", hex: "#ef4444" },
  { color: "vencido", emoji: "🟣", label: "Vencido", hex: "#a855f7" },
];

export function subscribeSituacionesClientes(
  onData: (map: Map<string, SituacionCliente>) => void
): () => void {
  return onSnapshot(collection(db, "situacionClientes"), (snap) => {
    const map = new Map<string, SituacionCliente>();
    snap.docs.forEach((d) => {
      const data = d.data();
      map.set(d.id, {
        color: data.color,
        etiqueta: data.etiqueta || "",
        nota: data.nota || "",
        llamado: !!data.llamado,
        updatedByNombre: data.updatedByNombre || "",
        updatedAt: data.updatedAt?.toDate?.() || null,
      });
    });
    onData(map);
  });
}

export async function setSituacionCliente(
  contabiliumId: number | string,
  {
    color,
    etiqueta,
    nota,
    llamado,
    updatedByNombre,
  }: { color: SituacionColor; etiqueta?: string; nota?: string; llamado?: boolean; updatedByNombre: string }
): Promise<void> {
  await setDoc(
    doc(db, "situacionClientes", String(contabiliumId)),
    {
      color,
      etiqueta: etiqueta || "",
      nota: nota || "",
      llamado: !!llamado,
      updatedByNombre,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
