import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/AuthContext";

// Registra cada vez que un usuario logueado entra a una pantalla distinta
// (no cada clic — solo cambios de ruta) para poder ver después "a dónde
// accedió" cada usuario. Un doc por visita en la colección "accesos".
export default function AccessTracker() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const ultimaRuta = useRef(null);

  useEffect(() => {
    if (!user) return;
    if (ultimaRuta.current === location.pathname) return;
    ultimaRuta.current = location.pathname;

    addDoc(collection(db, "accesos"), {
      uid: user.uid,
      email: user.email || null,
      nombre: profile?.name || null,
      role: profile?.role || null,
      ruta: location.pathname,
      fecha: serverTimestamp(),
    }).catch(() => {
      // Si falla (ej. reglas, offline), no interrumpe la navegación del usuario.
    });
  }, [location.pathname, user, profile]);

  return null;
}
