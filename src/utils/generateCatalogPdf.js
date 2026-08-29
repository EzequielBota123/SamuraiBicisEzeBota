// src/utils/generateCatalogPdf.js
import { jsPDF } from "jspdf";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

// Normaliza cualquier formato de imagen (PNG/WEBP/JPEG) a un JPEG vía canvas,
// para que jsPDF siempre reciba el formato que declaramos al insertarla —
// si se pasa el formato equivocado, addImage falla en silencio y queda en blanco.
async function imageUrlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

// Precio de lista, sin aplicar ningún descuento particular — el mismo para
// cualquier prospecto al que se le mande este PDF.
function listPriceArs(product, exchangeRate) {
  const contabiliumArs = product.priceArs != null ? Number(product.priceArs) : null;
  if (Number.isFinite(contabiliumArs) && contabiliumArs > 0) return contabiliumArs;
  const rate = Number(exchangeRate);
  const usd = Number(product.price || 0);
  if (Number.isFinite(rate) && rate > 0 && Number.isFinite(usd)) return usd * rate;
  return null;
}

// Genera y descarga un PDF con foto + nombre + precio de lista de todos los
// productos pasados, para que un distribuidor logueado se lo mande a un
// prospecto por WhatsApp sin exponer el catálogo online con precios.
export async function generateCatalogPdf(products, { exchangeRate, fileName = "catalogo-samurai.pdf" } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 24;
  const cols = 2;
  const cellW = (pageWidth - margin * 2) / cols;
  const cellH = 190;
  const imgSize = 120;

  doc.setFontSize(16);
  doc.text("Catálogo Samurai", margin, margin + 14);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Precios de lista · ${new Date().toLocaleDateString("es-AR")}`, margin, margin + 30);
  doc.setTextColor(0);

  let x = margin;
  let y = margin + 48;
  let col = 0;

  for (const p of products) {
    if (y + cellH > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    x = margin + col * cellW;

    const dataUrl = await imageUrlToDataUrl(p.imageUrl);
    if (dataUrl) {
      try {
        doc.addImage(dataUrl, "JPEG", x, y, imgSize, imgSize, undefined, "FAST");
      } catch {
        // imagen inválida/corrupta: seguimos sin ella
      }
    } else {
      doc.setDrawColor(220);
      doc.rect(x, y, imgSize, imgSize);
    }

    doc.setFontSize(10);
    doc.setTextColor(20);
    const nameLines = doc.splitTextToSize(p.name || "", cellW - imgSize - 16);
    doc.text(nameLines.slice(0, 4), x + imgSize + 10, y + 16);

    const priceArs = listPriceArs(p, exchangeRate);
    doc.setFontSize(12);
    doc.setTextColor(0, 100, 60);
    doc.text(
      priceArs != null ? money(priceArs) : `USD ${Number(p.price || 0).toFixed(2)}`,
      x + imgSize + 10,
      y + imgSize - 10
    );
    doc.setTextColor(0);

    col++;
    if (col >= cols) {
      col = 0;
      y += cellH;
    }
  }

  doc.save(fileName);
}
