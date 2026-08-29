export function normTxt(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function soloDigitos(s) {
  return String(s || "").replace(/\D/g, "");
}

export function waUrl(numero) {
  const digits = soloDigitos(numero);
  if (!digits) return null;
  const conCodigo = digits.startsWith("54") ? digits : `54${digits}`;
  return `https://wa.me/${conCodigo}`;
}
