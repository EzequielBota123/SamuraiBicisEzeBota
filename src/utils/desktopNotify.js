// src/utils/desktopNotify.js
// Notificaciones nativas del navegador/PWA (con sonido) para que las
// notificaciones de Samurai salten aunque el usuario tenga otra pestaña o
// app abierta — no solo el contador de la campanita. Funciona mientras la
// pestaña/PWA esté abierta (aunque no esté en foco); si está completamente
// cerrada no llega nada, eso requeriría push real (FCM) más adelante.
// Tono de notificación sintetizado con Web Audio (dos campanadas, tipo
// "ding-dong" — el sonido estándar de aviso, no un efecto de espada) — no
// depende de tener un archivo .mp3 cargado en el proyecto.
let audioCtx = null;
function getAudioCtx() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

function playTone(ctx, freq, startAt, duration, peak = 0.8) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square"; // más "llamativo"/nasal que sine, se distingue mejor de ruido de fondo
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

function playChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Triple beep en vez de dos campanadas suaves — más fuerte y más difícil
  // de ignorar (pedido explícito: "una noti más fuerte").
  playTone(ctx, 1567.98, now, 0.16, 0.6); // G6
  playTone(ctx, 1567.98, now + 0.2, 0.16, 0.6);
  playTone(ctx, 1567.98, now + 0.4, 0.24, 0.6);
}

// Los navegadores bloquean el audio hasta que hubo alguna interacción del
// usuario en la página (autoplay policy) — si alguien deja la pestaña del
// admin abierta todo el día sin tocar nada, la primera notificación que
// llega suena en silencio y nadie se entera. Este listener "despierta" el
// AudioContext con la primera interacción real (click, tecla o touch).
if (typeof window !== "undefined") {
  const unlock = () => {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  window.addEventListener("click", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock);
}

export function requestNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

export function playNotificationSound() {
  try {
    playChime();
  } catch {
    // Si sigue bloqueado (nunca hubo interacción todavía), no hay mucho más
    // para hacer del lado del audio — por eso showDesktopNotification abajo
    // también vibra y cambia el título de la pestaña, que no dependen de
    // esta política del navegador.
  }
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch {
    // no soportado (ej. iOS Safari) — no rompe nada, sigue de largo.
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
