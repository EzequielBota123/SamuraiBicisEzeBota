// src/utils/permisosCots.js
// La pantalla de COTs (cotizaciones viejas usadas como venta, con datos
// sensibles de deuda histórica) solo la pueden ver estas dos personas —
// a diferencia del resto del panel admin, que es igual para todos los
// admins. Restringido por UID (no por email) para que sobreviva un cambio
// de email de alguno de los dos.
const COTS_ALLOWED_UIDS = [
  "4LUcT3hf5yVBjPdv9UqKgfBuz2O2", // Marian
  "PbUNbL066URwzH66aGqoONoiDGW2", // pablorodados (antes pablo@estrellastore.com.ar, mismo UID)
];

export function puedeVerCots(uid) {
  return !!uid && COTS_ALLOWED_UIDS.includes(uid);
}
