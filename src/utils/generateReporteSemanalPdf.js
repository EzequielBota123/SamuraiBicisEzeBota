// src/utils/generateReporteSemanalPdf.js
import { jsPDF } from "jspdf";

const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const HEADER_BG = [30, 41, 59];
const BORDER = [203, 213, 225];

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function nombreDia(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DIAS[date.getDay()]} ${d} de ${date.toLocaleDateString("es-AR", { month: "long" })}`;
}

// `dias`: [{ fecha: "YYYY-MM-DD", items: [{ texto, hora, autor }] }], ya
// filtrado a la semana que se quiere bajar — los días sin items igual
// aparecen, marcados "Sin novedades".
export function generateReporteSemanalPdf(dias, { desde, hasta, fileName = "Reporte semanal.pdf" } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(h) {
    if (y + h > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text("Reporte semanal — Samurai Bikes", margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...MUTED);
  doc.text(`Semana del ${desde} al ${hasta}`, margin, y);
  y += 10;
  doc.setDrawColor(...BORDER);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  for (const dia of dias) {
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
      continue;
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
  }

  doc.save(fileName);
}
