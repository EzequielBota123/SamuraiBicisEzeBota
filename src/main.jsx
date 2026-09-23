// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { registerSW } from "virtual:pwa-register";

// Registra el service worker. A diferencia de antes, ya NO recarga la
// página sola cuando hay una versión nueva (eso cortaba lo que el usuario
// estuviera haciendo cada vez que había un deploy) — en cambio avisa vía
// un evento que escucha <UpdateToast/>, y el usuario decide cuándo
// actualizar tocando el botón.
const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("samurai:sw-need-refresh"));
  },
});

// Desde vite-plugin-pwa 0.13+, el parámetro `reloadPage` de updateSW() ya no
// hace nada por sí solo (queda documentado, pero ignorado) — hay que
// recargar a mano cuando el nuevo service worker toma control. Solo lo
// hacemos si el usuario efectivamente tocó "Actualizar" (via el flag),
// nunca automático.
let recargarAlActivarse = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recargarAlActivarse) window.location.reload();
  });
}
window.__samuraiUpdateSW = async () => {
  recargarAlActivarse = true;
  await updateSW();
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)