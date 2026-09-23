// src/services/choferes.ts
// Quiénes manejan: los usuarios con rol "chofer" (como Julián) y los que
// tienen la marca "esChofer" (usuarios con otro rol, ej. un distribuidor que
// también hace repartos, como Alfredo Bavcevich) — así no se les cambia el
// rol ni pierden lo que ya ven en la app.
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";

export type Chofer = { uid: string; nombre: string; rolChofer: boolean };

export function esUsuarioChofer(profile: { role?: string; esChofer?: boolean } | null | undefined): boolean {
  return profile?.role === "chofer" || profile?.esChofer === true;
}

export function subscribeChoferes(cb: (choferes: Chofer[]) => void) {
  const porRol = new Map<string, Chofer>();
  const porMarca = new Map<string, Chofer>();
  const emitir = () => {
    const todos = new Map<string, Chofer>([...porMarca, ...porRol]);
    cb([...todos.values()].sort((a, b) => Number(b.rolChofer) - Number(a.rolChofer) || a.nombre.localeCompare(b.nombre)));
  };
  const leer = (destino: Map<string, Chofer>, rolChofer: boolean) => (snap: any) => {
    destino.clear();
    snap.docs.forEach((d: any) => {
      const u = d.data();
      if (u.status && u.status !== "activo") return;
      destino.set(d.id, { uid: d.id, nombre: u.name || u.username || d.id, rolChofer });
    });
    emitir();
  };
  const u1 = onSnapshot(query(collection(db, "users"), where("role", "==", "chofer")), leer(porRol, true));
  const u2 = onSnapshot(query(collection(db, "users"), where("esChofer", "==", true)), leer(porMarca, false));
  return () => {
    u1();
    u2();
  };
}
