// Quiénes pueden escribir/editar/borrar notas de seguimiento de clientes
// (Clientes 360 y CRM → Contactar). El resto del staff las ve, de solo lectura.
export const EMAILS_EDITAN_NOTAS = ["pablo@estrellastore.com.ar", "marian@samurai.internal"];

export function puedeEditarNotas(email) {
  return EMAILS_EDITAN_NOTAS.includes((email || "").toLowerCase());
}
