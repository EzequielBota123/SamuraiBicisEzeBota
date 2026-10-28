// src/components/layout/ImpersonandoBanner.jsx
import { useEffect, useState } from "react";

// Barra fija para que el staff nunca se olvide de que está dentro de la
// cuenta de otro usuario (ver ImpersonarPage.jsx) y no la confunda con la
// propia — se marca al entrar vía sessionStorage, así que vive y muere con
// la pestaña.
export default function ImpersonandoBanner() {
  const [nombre, setNombre] = useState(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("impersonando") === "1") {
        setNombre(sessionStorage.getItem("impersonandoNombre") || "este usuario");
      }
    } catch {
      // no crítico
    }
  }, []);

  if (!nombre) return null;

  return (
    <div className="sticky top-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950">
      🔧 Estás gestionando como <strong>{nombre}</strong> (modo admin) — cerrá esta pestaña para salir
    </div>
  );
}
