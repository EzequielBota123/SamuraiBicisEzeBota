// Service worker aparte del de la PWA (sw.js, autogenerado por
// vite-plugin-pwa) — Firebase Messaging necesita el suyo propio, con este
// nombre exacto, para poder mostrar notificaciones cuando la pestaña está
// cerrada o en segundo plano. Los valores de config son públicos (no son
// secretos, son los mismos que ya viajan al navegador en cualquier app
// Firebase), así que no hace falta generarlos desde variables de entorno acá.
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBYGT9Yvt6YtzhzMe7Br6GSyx_XMRuU4zE",
  authDomain: "bikeshop-ab2f0.firebaseapp.com",
  projectId: "bikeshop-ab2f0",
  storageBucket: "bikeshop-ab2f0.firebasestorage.app",
  appId: "1:171029178935:web:d3118e8ee5e57a8f8badb2",
  messagingSenderId: "171029178935",
});

const messaging = firebase.messaging();

// Notificación con sonido/ícono cuando llega en segundo plano (pestaña
// cerrada o minimizada) — en foreground la maneja onMessage() en la app.
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const link = payload.data?.link || "/";
  self.registration.showNotification(title || "Samurai", {
    body: body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { link },
  });
});

// Al tocar la notificación, enfoca una pestaña ya abierta de Samurai si hay
// una, o abre una nueva en el link indicado.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return clients.openWindow(link);
    })
  );
});
