import { useEffect, useRef } from "react";
import { useAuth } from "../../auth/AuthContext";
import { compartirUbicacion } from "../../services/ubicacionChofer";

const INTERVALO_MIN_MS = 20000; // no escribe más seguido que esto, aunque el GPS actualice más rápido

// Mientras el chofer tiene abierta cualquier pantalla de /chofer, pide
// permiso de ubicación y la va mandando cada tanto — así el admin puede ver
// dónde está sin que él tenga que hacer nada extra. Si no da el permiso,
// no rompe nada, simplemente no se comparte.
export default function ChoferUbicacionBroadcaster() {
  const { user, profile } = useAuth();
  const ultimoEnvioRef = useRef(0);
  const watchIdRef = useRef(null);

  useEffect(() => {
    if (!user || (profile?.role !== "chofer" && profile?.esChofer !== true)) return;
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const ahora = Date.now();
        if (ahora - ultimoEnvioRef.current < INTERVALO_MIN_MS) return;
        ultimoEnvioRef.current = ahora;
        compartirUbicacion({
          uid: user.uid,
          nombre: profile?.name || user.email || null,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }).catch(() => {
          // Si falla (offline, reglas, etc.) no interrumpe nada — se
          // reintenta solo en la próxima actualización del GPS.
        });
      },
      () => {
        // Permiso denegado o error de GPS — no se comparte, sin molestar.
      },
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
    );

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [user, profile]);

  return null;
}
