// src/utils/desktopNotify.js
// Notificaciones nativas del navegador/PWA (con sonido) para que las
// notificaciones de Samurai salten aunque el usuario tenga otra pestaña o
// app abierta — no solo el contador de la campanita. Funciona mientras la
// pestaña/PWA esté abierta (aunque no esté en foco); si está completamente
// cerrada no llega nada, eso requeriría push real (FCM) más adelante.
let audio = null;
function getAudio() {
  if (!audio) audio = new Audio("/audio/espada.mp3");
  return audio;
}

export function requestNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

export function playNotificationSound() {
  try {
    const a = getAudio();
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch {
    // Los navegadores bloquean el audio si todavía no hubo ninguna
    // interacción del usuario en la página — no hay mucho para hacer ahí,
    // simplemente no suena esta vez.
  }
}

export function showDesktopNotification(title, body) {
  playNotificationSound();
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "/icons/icon-192.png",
      tag: "samurai-notification",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Si falla la creación (ej. contexto no seguro), no rompemos el flujo.
  }
}
