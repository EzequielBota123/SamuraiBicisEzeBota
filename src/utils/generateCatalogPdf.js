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
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

// Genera y descarga un PDF con foto + nombre + precio de lista de cada
// MODELO (un color/talle por fila, no una fila por cada variante — para eso
// está el link a samurai.ar/catalogo, que se comparte aparte del PDF), para
// que un distribuidor logueado se lo mande a un prospecto por WhatsApp sin
// exponer el catálogo online con precios. Sin links sueltos adentro del PDF:
// tarjetas limpias, prolijas, agrupadas por categoría — como en la web.
//
// `items`: [{ id, name, category, imageUrl, priceArs, priceUsd, desde }]
export async function generateCatalogPdf(items, { fileName = "catalogo-samurai.pdf" } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 28;
  const gap = 12;
  const cols = 2;
  const cellW = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
  const cardPad = 12;
  const imgSize = cellW - cardPad * 2;
  const cardH = imgSize + 78;

  const ACCENT = [217, 47, 62]; // rose-600, mismo tono que los botones del sitio
  const INK = [15, 23, 42]; // slate-900
  const MUTED = [100, 116, 139]; // slate-500
  const BORDER = [226, 232, 240]; // slate-200
  const IMG_BG = [248, 250, 252]; // slate-50

  function drawHeader() {
    doc.setFillColor(...INK);
    doc.rect(0, 0, pageWidth, 64, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text("Catálogo Samurai", margin, 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(`Precios de lista · ${new Date().toLocaleDateString("es-AR")}`, margin, 48);
    doc.setTextColor(0, 0, 0);
  }

  function drawSectionLabel(label, count, y) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(label, margin, y);
    const labelW = doc.getTextWidth(label);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(1);
    doc.line(margin + labelW + 8, y - 4, pageWidth - margin - 60, y - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`${count} producto${count === 1 ? "" : "s"}`, pageWidth - margin, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }

  drawHeader();
  let x = margin;
  let y = 64 + 30;
  let col = 0;
  let currentCategory = null;

  for (const it of items) {
    const isNewCategory = it.category !== currentCategory;
    const sectionHeaderH = isNewCategory ? 26 : 0;

    // Si cambia de categoría a mitad de fila, cierra la fila actual primero.
    if (isNewCategory && col !== 0) {
      col = 0;
      y += cardH + gap;
    }

    if (y + sectionHeaderH + cardH > pageHeight - margin) {
      doc.addPage();
      drawHeader();
      y = 64 + 30;
      col = 0;
    }

    if (isNewCategory) {
      const countInCategory = items.filter((p) => p.category === it.category).length;
      drawSectionLabel(it.category || "Otros", countInCategory, y);
      currentCategory = it.category;
      y += 18;
    }

    x = margin + col * (cellW + gap);

    // Tarjeta: borde redondeado prolijo, igual espíritu que las cards del sitio.
    doc.setDrawColor(...BORDER);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cellW, cardH, 8, 8, "FD");

    doc.setFillColor(...IMG_BG);
    doc.roundedRect(x + cardPad, y + cardPad, imgSize, imgSize, 6, 6, "F");

    const img = await imageUrlToDataUrl(it.imageUrl);
    if (img) {
      try {
        // Encaja la imagen dentro del cuadro SIN deformarla (equivalente a
        // object-fit: contain), centrada — antes se forzaba a imgSize x
        // imgSize y las fotos no cuadradas quedaban estiradas.
        const pad = 6;
        const boxSize = imgSize - pad * 2;
        const scale = Math.min(boxSize / img.width, boxSize / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const drawX = x + cardPad + pad + (boxSize - drawW) / 2;
        const drawY = y + cardPad + pad + (boxSize - drawH) / 2;
        doc.addImage(img.dataUrl, "JPEG", drawX, drawY, drawW, drawH, undefined, "FAST");
      } catch {
        // imagen inválida/corrupta: seguimos sin ella
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text("Sin imagen", x + cellW / 2, y + cardPad + imgSize / 2, { align: "center" });
      doc.setTextColor(0, 0, 0);
    }

    const textY = y + cardPad + imgSize + 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const nameLines = doc.splitTextToSize(it.name || "", cellW - cardPad * 2);
    doc.text(nameLines.slice(0, 2), x + cardPad, textY);

    const priceY = textY + 15 * Math.min(nameLines.length, 2) + 4;
    if (it.desde) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text("DESDE", x + cardPad, priceY);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...ACCENT);
    const priceLabel = it.priceArs != null ? money(it.priceArs) : it.priceUsd != null ? `USD ${Number(it.priceUsd).toFixed(2)}` : "Consultar";
    doc.text(priceLabel, x + cardPad, priceY + (it.desde ? 14 : 0));
    doc.setTextColor(0, 0, 0);

    col++;
    if (col >= cols) {
      col = 0;
      y += cardH + gap;
    }
  }

  doc.save(fileName);
}
