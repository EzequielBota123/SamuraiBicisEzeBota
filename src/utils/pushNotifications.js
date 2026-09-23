// Notificaciones push (FCM) — para que a admins y clientes les suene el
// celular con los mismos eventos que hoy solo se ven en la campanita
// dentro de la app. Requiere permiso explícito del navegador/celular
// (nunca se pide solo, hay que llamarlo desde un click real del usuario).
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { app, db } from "../firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let messagingInstance = null;
async function getMessagingInstance() {
  if (messagingInstance) return messagingInstance;
  if (!(await isSupported())) return null; // Safari viejo, navegadores sin push, etc.
  messagingInstance = getMessaging(app);
  return messagingInstance;
}

export async function permisoNotificacionesEstado() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
}

// Pide el permiso, registra el service worker de mensajería, y guarda el
// token en el propio usuario (users/{uid}.fcmTokens, es un array porque
// puede tener la cuenta abierta en varios dispositivos a la vez).
export async function activarNotificacionesPush(uid) {
  if (!uid) throw new Error("Necesitás estar logueado.");
  const messaging = await getMessagingInstance();
  if (!messaging) throw new Error("Este navegador no soporta notificaciones push.");
  if (!VAPID_KEY) throw new Error("Falta configurar la clave VAPID.");

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    throw new Error(permiso === "denied" ? "Bloqueaste las notificaciones para este sitio." : "No se otorgó el permiso.");
  }

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error("No se pudo obtener el token de notificaciones.");

  await updateDoc(doc(db, "users", uid), { fcmTokens: arrayUnion(token) });
  return token;
}

export async function desactivarNotificacionesPush(uid, token) {
  if (!uid || !token) return;
  await updateDoc(doc(db, "users", uid), { fcmTokens: arrayRemove(token) });
}

// Mientras la app está abierta y en foco, FCM no dispara la notificación
// del sistema operativo sola — hay que escucharla acá y mostrarla a mano
// (si no, en foreground no sonaría nada).
export async function suscribirseAMensajesEnPrimerPlano(onMensaje) {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title || "Samurai", { body: body || "", icon: "/icons/icon-192.png" });
      const link = payload.data?.link;
      if (link) n.onclick = () => { window.focus(); window.location.href = link; };
    }
    onMensaje?.(payload);
  });
}
