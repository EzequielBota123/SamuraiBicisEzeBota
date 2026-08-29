// Sinónimos de colores (español/inglés) para que el buscador de stock
// encuentre resultados sin importar en qué idioma esté el nombre real
// del producto en Contabilium (ej. "BLUE" también matchea "azul").
const COLOR_SYNONYMS = [
  ["azul", "blue"],
  ["celeste", "sky", "light blue", "azul claro"],
  ["verde", "green"],
  ["negro", "black"],
  ["blanco", "white"],
  ["gris", "gray", "grey"],
  ["rosa", "rosado", "pink"],
  ["rojo", "red", "coral"],
  ["beige"],
  ["crema", "cream"],
  ["violeta", "morado", "purple", "violet"],
  ["dorado", "gold"],
  ["plateado", "silver"],
  ["mate", "matte"],
  ["brillante", "gloss", "glossy"],
  ["marron", "marrón", "brown"],
  ["amarillo", "yellow"],
  ["naranja", "orange"],
];

function expandSearchTerms(query) {
  const q = query.toLowerCase().trim();
  const terms = new Set([q]);
  for (const group of COLOR_SYNONYMS) {
    if (group.includes(q)) {
      group.forEach((t) => terms.add(t));
    }
  }
  return Array.from(terms);
}

// Filtra una lista de items { name, sku } por texto, incluyendo sinónimos de color.
export function filterBySearch(items, query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return items;
  const terms = expandSearchTerms(q);
  return items.filter((item) => {
    const haystack = `${item.name || ""} ${item.sku || ""}`.toLowerCase();
    return terms.some((t) => haystack.includes(t));
  });
}
