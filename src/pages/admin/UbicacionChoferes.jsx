import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../../utils/loadGoogleMaps";
import { subscribeUbicacionesChoferes } from "../../services/ubicacionChofer";

function haceCuanto(fecha) {
  if (!fecha) return "nunca";
  const diff = Math.floor((Date.now() - fecha.getTime()) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  return `hace ${Math.floor(diff / 3600)} h`;
}

// Mapa en vivo con dónde está cada chofer — se actualiza solo cuando el
// chofer tiene la app abierta y dio permiso de ubicación (no es tracking
// en segundo plano ni GPS permanente, solo mientras usa Samurai).
export default function UbicacionChoferes() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef(new Map()); // uid -> marker
  const [choferes, setChoferes] = useState(null);
  const [mapaListo, setMapaListo] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadGoogleMaps()
      .then((gmaps) => {
        mapInstanceRef.current = new gmaps.Map(mapRef.current, {
          center: { lat: -34.6, lng: -58.4 }, // AMBA por defecto hasta que llegue una ubicación real
          zoom: 10,
        });
        setMapaListo(true);
      })
      .catch((e) => setError(e.message || "No se pudo cargar el mapa"));
  }, []);

  useEffect(() => subscribeUbicacionesChoferes(setChoferes), []);

  useEffect(() => {
    if (!mapaListo || !choferes || !window.google?.maps) return;
    const gmaps = window.google.maps;
    let primero = true;
    for (const c of choferes) {
      if (c.lat == null || c.lon == null) continue;
      const pos = { lat: c.lat, lng: c.lon };
      let marker = markersRef.current.get(c.uid);
      if (!marker) {
        marker = new gmaps.Marker({
          map: mapInstanceRef.current,
          label: { text: "🚐", fontSize: "18px" },
        });
        markersRef.current.set(c.uid, marker);
      }
      marker.setPosition(pos);
      marker.setTitle(`${c.nombre || "Chofer"} — ${haceCuanto(c.updatedAt)}`);
      if (primero) {
        mapInstanceRef.current.setCenter(pos);
        mapInstanceRef.current.setZoom(13);
        primero = false;
      }
    }
  }, [mapaListo, choferes]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">📍 Dónde está cada chofer</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Se actualiza mientras el chofer tiene la app abierta y dio permiso de ubicación.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(choferes || []).map((c) => (
          <div key={c.uid} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">🚐 {c.nombre || c.uid}</p>
            <p className="text-xs text-slate-400 dark:text-neutral-500">Actualizado {haceCuanto(c.updatedAt)}</p>
          </div>
        ))}
        {choferes && choferes.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-neutral-500">Todavía ningún chofer compartió su ubicación.</p>
        )}
      </div>

      <div ref={mapRef} className="h-[420px] w-full rounded-2xl border border-slate-200 dark:border-neutral-800" />
    </div>
  );
}
