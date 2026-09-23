// Carga el script de Google Maps JavaScript API una sola vez (aunque se
// llame varias veces desde distintos componentes montados a la vez) y
// devuelve una promesa que resuelve cuando window.google.maps ya está
// disponible.
let loadPromise = null;

export function loadGoogleMaps() {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      reject(new Error("Falta VITE_GOOGLE_MAPS_API_KEY"));
      return;
    }
    const callbackName = "__samuraiGoogleMapsLoaded";
    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&callback=${callbackName}&v=weekly`;
    script.async = true;
    script.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
