// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { registerSW } from "virtual:pwa-register";

// Registra el service worker y fuerza la actualización automática apenas
// hay una versión nueva — sin esto, la app instalada en el celular a veces
// mostraba una versión vieja cacheada hasta que el usuario la cerraba y
// volvía a abrir varias veces.
registerSW({ immediate: true });

// Si el service worker cambia mientras la app ya está abierta, recarga una
// sola vez para que se vea la versión nueva en el momento (no solo la
// próxima vez que se abra la app).
if ("serviceWorker" in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

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