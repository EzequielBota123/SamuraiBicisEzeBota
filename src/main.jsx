// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { registerSW } from "virtual:pwa-register";

// Registra el service worker con auto-update: apenas hay una versión nueva
// disponible, se activa y recarga sola, sin avisar ni esperar que alguien
// toque un botón — pedido explícito (30/9/2026) para que el celular
// siempre tenga la última versión sin depender de que alguien note el
// cartel de "hay una versión nueva". Trade-off asumido: si justo hay un
// deploy mientras alguien está escribiendo algo, se puede cortar.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
});
window.__samuraiUpdateSW = async () => {
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