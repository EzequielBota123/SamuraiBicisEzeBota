import { useEffect, useRef, useState } from "react";
import { getUbicacionesMisVendedores } from "../../services/comprobantes";
import { loadGoogleMaps } from "../../utils/loadGoogleMaps";
import RutaPanel from "../../components/mapa/RutaPanel";

// Mapa de los clientes/vendedores a cargo de Alfredo — versión liviana del
// mapa del CRM (sin los filtros de consignados/video, que son cosas de
// staff), pero con el mismo registro de rutas colgado, para que el
// historial de rutas sea uno solo entre CRM, chofer y acá.
export default function MapaVendedoresPage() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapListo, setMapListo] = useState(false);
  const [mapError, setMapError] = useState("");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [seleccion, setSeleccion] = useState(null);

  useEffect(() => {
    getUbicacionesMisVendedores()
      .then(({ items }) => setItems(items))
      .catch((e) => setError(e.message || "No se pudieron cargar las ubicaciones"));
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    loadGoogleMaps()
      .then((gmaps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = new gmaps.Map(containerRef.current, {
          center: { lat: -38, lng: -64 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        mapRef.current = map;
        setMapListo(true);
      })
      .catch((e) => {
        console.error("[MapaVendedoresPage] error cargando Google Maps:", e);
        setMapError(e.message || "No se pudo cargar el mapa");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapListo || !mapRef.current || !window.google?.maps || !items) return;
    const gmaps = window.google.maps;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = items.map((it) => {
      const marker = new gmaps.Marker({ position: { lat: it.lat, lng: it.lon }, map: mapRef.current, title: it.nombre });
      marker.addListener("click", () => setSeleccion(it));
      return marker;
    });

    if (items.length > 0) {
      const bounds = new gmaps.LatLngBounds();
      for (const it of items) bounds.extend({ lat: it.lat, lng: it.lon });
      mapRef.current.fitBounds(bounds, 60);
    }
  }, [items, mapListo]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">Mapa</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
          Ubicación de tus clientes.
        </p>
      </div>

      <RutaPanel />

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {mapError && <p className="text-sm text-rose-600 dark:text-rose-400">{mapError}</p>}
      {!items && !error && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando ubicaciones…</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-neutral-800 lg:col-span-2">
          <div ref={containerRef} className="h-[560px] w-full" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          {!seleccion ? (
            <p className="text-sm text-slate-400 dark:text-neutral-500">Tocá un punto del mapa para ver el detalle.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{seleccion.nombre}</p>
                <button
                  onClick={() => setSeleccion(null)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">
                📍 {seleccion.direccion ? `${seleccion.direccion}, ` : ""}
                {[seleccion.ciudad, seleccion.provincia].filter(Boolean).join(", ")}
                {seleccion.cp ? ` (CP ${seleccion.cp})` : ""}
              </p>
              <p
                className={
                  seleccion.ubicacionPrecisa
                    ? "mt-1 text-xs text-emerald-600 dark:text-emerald-400"
                    : "mt-1 text-xs text-amber-600 dark:text-amber-400"
                }
              >
                {seleccion.ubicacionPrecisa ? "✓ Pin en la dirección exacta" : "⚠️ Pin aproximado — solo se ubicó el centro de la localidad"}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
