// El nombre del producto en Contabilium no tiene talle ni marca como campos
// aparte — vienen todos metidos en el texto (ej: "BIC MTB SAMURAI 2.0 21V
// SHIMANO T.S MATE BEIGE"). Estas funciones los separan para poder
// mostrarlos bien visibles en las tarjetas de bicicletas.

// Todo el catálogo es Samurai salvo cuando dice explícitamente "Bowie" — así
// que "Samurai" en el nombre ocupa mucho lugar para lo que aporta. Lo
// abreviamos a "SM" en vez de sacarlo del todo.
export function limpiarNombreBici(nombre) {
  if (!nombre) return "";
  return nombre
    .replace(/\bSAMURAI\b/gi, "SM")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Familia del modelo (ej: "2.0", "3.0", "GOZEN") — siempre viene justo
// después de "SAMURAI" en el nombre. Se usa para armar el mini filtro de
// bicis consignadas por modelo en Clientes 360.
export function extraerModelo(nombre) {
  if (!nombre) return null;
  const m = /\bSAMURAI\s+([A-Z0-9]+(?:\.[0-9]+)?)/i.exec(nombre);
  if (m) return m[1].toUpperCase();
  // SHONEN es el único modelo que no lleva "SAMURAI" en el nombre del
  // producto (ej: "BIC MTB SHONEN R24 COLOR CORAL").
  if (/\bSHONEN\b/i.test(nombre)) return "SHONEN";
  return null;
}

export function extraerTalle(nombre) {
  if (!nombre) return null;
  const m = /\bTALLE\s+(XXS|XS|S|M|L|XL|XXL)\b|\bT\.\s*(XXS|XS|S|M|L|XL|XXL)\b/i.exec(nombre);
  if (!m) return null;
  return (m[1] || m[2]).toUpperCase();
}
