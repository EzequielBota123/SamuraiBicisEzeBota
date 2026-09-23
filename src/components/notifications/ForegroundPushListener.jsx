import { useEffect } from "react";
import { suscribirseAMensajesEnPrimerPlano } from "../../utils/pushNotifications";

// Mientras la pestaña está abierta y en foco, FCM no muestra la
// notificación del sistema operativo sola (a diferencia de cuando está en
// segundo plano, que la maneja firebase-messaging-sw.js) — hay que
// escucharla acá y mostrarla a mano con sonido.
export default function ForegroundPushListener() {
  useEffect(() => {
    let unsub = () => {};
    suscribirseAMensajesEnPrimerPlano().then((fn) => {
      unsub = fn;
    });
    return () => unsub();
  }, []);
  return null;
}
