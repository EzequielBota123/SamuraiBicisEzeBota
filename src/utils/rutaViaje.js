// Cálculos de mapa para los viajes de logística: ubicar una dirección,
// estimar cuánto tarda de un punto a otro (con tránsito) y armar el link
// de "cómo llegar" para el chofer.
import { loadGoogleMaps } from "./loadGoogleMaps";

const cacheGeocode = new Map();

function leerCacheLocal(direccion) {
  try {
    const raw = window.localStorage.getItem(`geo:${direccion}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function guardarCacheLocal(direccion, punto) {
  try {
    window.localStorage.setItem(`geo:${direccion}`, JSON.stringify(punto));
  } catch {
    // sin storage: se sigue igual, solo no queda cacheado entre sesiones
  }
}

// Devuelve { lat, lon } de una dirección, o null si Google no la encuentra.
export async function geocodificar(direccion) {
  const clave = String(direccion || "").trim();
  if (!clave) return null;
  if (cacheGeocode.has(clave)) return cacheGeocode.get(clave);
  const local = leerCacheLocal(clave);
  if (local) {
    cacheGeocode.set(clave, local);
    return local;
  }
  const gmaps = await loadGoogleMaps();
  const geocoder = new gmaps.Geocoder();
  try {
    const { results } = await geocoder.geocode({ address: clave, region: "ar" });
    const loc = results?.[0]?.geometry?.location;
    if (!loc) return null;
    const punto = { lat: loc.lat(), lon: loc.lng() };
    cacheGeocode.set(clave, punto);
    guardarCacheLocal(clave, punto);
    return punto;
  } catch {
    return null;
  }
}

// Tiempo y distancia en auto entre dos puntos, considerando el tránsito a
// la hora de salida planificada (Google solo estima tránsito para "ahora"
// o el futuro, así que una salida pasada se calcula como si fuera ahora).
export async function calcularDuracion(origen, destino, salida) {
  const gmaps = await loadGoogleMaps();
  const service = new gmaps.DirectionsService();
  const partida = salida && salida.getTime() > Date.now() ? salida : new Date();
  const result = await service.route({
    origin: { lat: origen.lat, lng: origen.lon },
    destination: { lat: destino.lat, lng: destino.lon },
    travelMode: gmaps.TravelMode.DRIVING,
    drivingOptions: { departureTime: partida, trafficModel: gmaps.TrafficModel.BEST_GUESS },
  });
  const leg = result.routes?.[0]?.legs?.[0];
  if (!leg) throw new Error("Google no encontró una ruta entre esos dos puntos");
  const segundos = (leg.duration_in_traffic || leg.duration).value;
  return {
    duracionMin: Math.max(1, Math.round(segundos / 60)),
    distanciaKm: Math.round((leg.distance.value / 1000) * 10) / 10,
  };
}

// Link para abrir la navegación en Google Maps (celular o compu).
export function linkComoLlegar(lugar) {
  const destino =
    lugar?.lat != null && lugar?.lon != null ? `${lugar.lat},${lugar.lon}` : encodeURIComponent(lugar?.direccion || lugar?.nombre || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${destino}&travelmode=driving`;
}

export function fmtHora(date) {
  if (!date) return "—";
  return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDuracion(min) {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
