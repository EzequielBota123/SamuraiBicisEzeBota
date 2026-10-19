// src/utils/generateEtiquetasPdf.js
import { jsPDF } from "jspdf";

const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const LINE = [150, 150, 150];

// Una hoja A4 dividida en 5 franjas iguales, cada una con el mismo
// cliente/destino — pensada para imprimir y cortar con tijera, una
// etiqueta por bulto de un mismo envío. `etiqueta`: { cliente, destino }.
export function generateEtiquetasPdf(etiqueta, { fileName = "Etiquetas.pdf" } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 34;
  const n = 5;
  const stripH = pageH / n;
  const contentW = pageW - marginX * 2;

  for (let i = 0; i < n; i++) {
    const top = pageH - i * stripH;
    const bottom = top - stripH;
    const centerY = (top + bottom) / 2;

    // Marco punteado de corte alrededor de cada etiqueta.
    doc.setLineDashPattern([4, 3], 0);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.8);
    doc.rect(marginX, bottom + 2, contentW, stripH - 4);
    doc.setLineDashPattern([], 0);

    if (i > 0) {
      doc.setLineDashPattern([2, 2], 0);
      doc.line(0, top, pageW, top);
      doc.setLineDashPattern([], 0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(...MUTED);
      doc.text("✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  ✂", pageW / 2, top - 4, { align: "center" });
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text("SAMURAI BIKES", marginX + 10, top - 20);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...INK);
    doc.text("Cliente:", marginX + 10, centerY + 14);
    doc.setFontSize(22);
    doc.text(etiqueta.cliente, marginX + 10, centerY - 12);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...MUTED);
    doc.text("Ubicación destino:", marginX + 10, centerY - 34);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    const lineas = doc.splitTextToSize(etiqueta.destino || "(sin dirección cargada)", contentW - 20);
    doc.text(lineas, marginX + 10, centerY - 52);
  }

  doc.save(fileName);
}
