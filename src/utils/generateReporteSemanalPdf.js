// src/utils/generateReporteSemanalPdf.js
import { jsPDF } from "jspdf";

const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const HEADER_BG = [30, 41, 59];
const BORDER = [203, 213, 225];
const LOGO_URL = "/img/samurai-favicon-round.png";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function nombreDia(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DIAS[date.getDay()]} ${d} de ${date.toLocaleDateString("es-AR", { month: "long" })}`;
}

// Mismo truco que generateCatalogPdf.js: normaliza a JPEG vía canvas, así
// jsPDF no falla en silencio por un formato mal declarado.
async function imageUrlToDataUrl(url) {
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
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}

// Encabezado común (logo + título + subtítulo + línea) — devuelve el `y`
// desde donde seguir escribiendo contenido.
function dibujarEncabezado(doc, { titulo, subtitulo, logoDataUrl, margin, pageWidth }) {
  let y = margin;
  const logoSize = 34;
  const textX = logoDataUrl ? margin + logoSize + 12 : margin;

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "JPEG", margin, y - 24, logoSize, logoSize, undefined, "FAST");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(titulo, textX, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...MUTED);
  doc.text(subtitulo, textX, y);
  y += 12;
  doc.setDrawColor(...BORDER);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;
  return y;
}

// Dibuja el bloque de un día (header oscuro + items o "Sin novedades"),
// respetando el salto de página — devuelve el `y` actualizado.
function dibujarDia(doc, dia, { margin, contentW, pageHeight, y }) {
  function ensureSpace(h) {
    if (y + h > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  ensureSpace(34);
  doc.setFillColor(...HEADER_BG);
  doc.roundedRect(margin, y, contentW, 22, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(255, 255, 255);
  doc.text(nombreDia(dia.fecha), margin + 8, y + 15);
  y += 22 + 10;

  if (!dia.items || dia.items.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text("Sin novedades.", margin + 10, y);
    y += 18;
    return y;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.3);
  doc.setTextColor(...INK);
  for (const item of dia.items) {
    const prefijo = `• [${item.hora}] `;
    const texto = `${prefijo}${item.texto}`;
    const lineas = doc.splitTextToSize(texto, contentW - 10);
    ensureSpace(lineas.length * 13 + 4);
    doc.text(lineas, margin + 10, y);
    y += lineas.length * 13 + 4;
  }
  y += 6;
  return y;
}

// `dias`: [{ fecha: "YYYY-MM-DD", items: [{ texto, hora, autor }] }], ya
// filtrado a la semana que se quiere bajar — los días sin items igual
// aparecen, marcados "Sin novedades".
export async function generateReporteSemanalPdf(dias, { desde, hasta, fileName = "Reporte semanal.pdf" } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageWidth - margin * 2;

  const logoDataUrl = await imageUrlToDataUrl(LOGO_URL);
  let y = dibujarEncabezado(doc, {
    titulo: "Reporte semanal — Samurai Bikes",
    subtitulo: `Semana del ${desde} al ${hasta}`,
    logoDataUrl,
    margin,
    pageWidth,
  });

  for (const dia of dias) {
    y = dibujarDia(doc, dia, { margin, contentW, pageHeight, y });
  }

  doc.save(fileName);
}

// Mismo formato prolijo, pero para un solo día — para bajar nada más lo de
// hoy (o cualquier día puntual) sin tener que descargar la semana entera.
export async function generateReporteDiarioPdf(dia, { fileName } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageWidth - margin * 2;

  const logoDataUrl = await imageUrlToDataUrl(LOGO_URL);
  let y = dibujarEncabezado(doc, {
    titulo: "Reporte diario — Samurai Bikes",
    subtitulo: nombreDia(dia.fecha),
    logoDataUrl,
    margin,
    pageWidth,
  });

  y = dibujarDia(doc, dia, { margin, contentW, pageHeight, y });

  doc.save(fileName || `Reporte ${dia.fecha}.pdf`);
}
