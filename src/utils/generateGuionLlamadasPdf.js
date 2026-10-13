// src/utils/generateGuionLlamadasPdf.js
import { jsPDF } from "jspdf";

const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const ACCENT = [217, 47, 62];
const CARD_BG = [248, 250, 252];
const HEADER_BG = [30, 41, 59];
const BORDER = [203, 213, 225];
const LABEL_COLOR = [100, 116, 139];

// PDF único con el guion de la llamada, seguido de una ficha detallada por
// cliente (agrupadas por zona) con TODOS sus datos: contacto, dirección,
// perfil comercial, situación/nota, cuenta corriente y estado de video — una
// ficha prolija por cliente en vez de una tabla apretada, para que nada
// quede truncado ni cortado durante la llamada.
//
// `guion`: [{ Etapa, "Qué decir" }]
// `porZona`: [{ zona, clientes: [{ "N°", Cliente, CUIT, Teléfono, Dirección,
//   Ciudad, Provincia, CP, Bicicletería, Instagram, "Perfil comercial",
//   Depósito, "Atendido por", Situación, Nota, "Marcado por", "Estado cta. cte.",
//   "Último pedido", "Video estado", "Video último" }] }]
export function generateGuionLlamadasPdf(guion, porZona, { fileName = "Guion de llamadas.pdf" } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageWidth - margin * 2;

  function drawPageHeader(subtitulo) {
    doc.setFillColor(...HEADER_BG);
    doc.rect(0, 0, pageWidth, 64, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text("Guion de llamadas — Nueva administración", margin, 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(210, 210, 210);
    doc.text(subtitulo, margin, 48);
  }

  // ---- Página(s) 1: el guion ----
  drawPageHeader("Ezequiel y Mariana · presentación, control de stock, cuenta corriente y venta");
  let y = 96;
  doc.setFont("helvetica", "normal");
  for (const etapa of guion || []) {
    const titulo = etapa["Etapa"] || "";
    const texto = etapa["Qué decir"] || "";
    if (!titulo && !texto) continue;
    const esTip = titulo.includes("Tip");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...ACCENT);
    if (y > pageHeight - 80) {
      doc.addPage();
      drawPageHeader("Guion (continuación)");
      y = 96;
    }
    doc.text(titulo, margin, y);
    y += 16;

    doc.setFont("helvetica", esTip ? "italic" : "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(esTip ? MUTED[0] : INK[0], esTip ? MUTED[1] : INK[1], esTip ? MUTED[2] : INK[2]);
    const lines = doc.splitTextToSize(texto, contentW - 20);
    const blockH = lines.length * 14 + 16;
    if (y + blockH > pageHeight - margin) {
      doc.addPage();
      drawPageHeader("Guion (continuación)");
      y = 96;
    }
    if (!esTip) {
      doc.setFillColor(...CARD_BG);
      doc.roundedRect(margin, y - 4, contentW, lines.length * 14 + 14, 5, 5, "F");
      doc.text(lines, margin + 10, y + 10);
    } else {
      doc.text(lines, margin, y);
    }
    y += blockH + 12;
  }

  // ---- Página(s) siguientes: una ficha por cliente, agrupadas por zona ----
  function campo(labelDoc, x, yPos, label, valor, w) {
    labelDoc.setFont("helvetica", "bold");
    labelDoc.setFontSize(7.5);
    labelDoc.setTextColor(...LABEL_COLOR);
    labelDoc.text(label.toUpperCase(), x, yPos);
    labelDoc.setFont("helvetica", "normal");
    labelDoc.setFontSize(9);
    labelDoc.setTextColor(...INK);
    const texto = String(valor || "—");
    const lines = labelDoc.splitTextToSize(texto, w);
    labelDoc.text(lines.slice(0, 2), x, yPos + 11);
    return lines.length > 1 ? 2 : 1;
  }

  const cardH = 118;
  const colGap = 14;
  const cardW = (contentW - colGap) / 2;

  for (const grupo of porZona || []) {
    doc.addPage();
    drawPageHeader(`${grupo.zona} · ${grupo.clientes.length} cliente(s) a llamar · orden: ruta sugerida por cercanía`);
    let cy = 92;
    let col = 0; // 0 = izquierda, 1 = derecha

    for (const c of grupo.clientes) {
      if (cy + cardH > pageHeight - margin) {
        doc.addPage();
        drawPageHeader(`${grupo.zona} (continuación)`);
        cy = 92;
        col = 0;
      }
      const cx = margin + col * (cardW + colGap);

      // Marco de la ficha
      doc.setDrawColor(...BORDER);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(cx, cy, cardW, cardH, 5, 5, "S");

      // Encabezado: N° + nombre + situación
      doc.setFillColor(...HEADER_BG);
      doc.roundedRect(cx, cy, cardW, 22, 5, 5, "F");
      doc.rect(cx, cy + 12, cardW, 10, "F"); // cuadra las esquinas de abajo del header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(255, 255, 255);
      const nombreCorto = doc.splitTextToSize(`N° ${c["N°"]} · ${c["Cliente"] || ""}`, cardW - 90)[0];
      doc.text(nombreCorto, cx + 8, cy + 15);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(220, 220, 220);
      const situ = doc.splitTextToSize(String(c["Situación"] || ""), 82)[0] || "";
      doc.text(situ, cx + cardW - 8, cy + 15, { align: "right" });

      const padX = cx + 8;
      const colW = (cardW - 16 - 10) / 2;
      let fy = cy + 34;

      campo(doc, padX, fy, "CUIT", c["CUIT"], colW);
      campo(doc, padX + colW + 10, fy, "Teléfono", c["Teléfono"], colW);
      fy += 20;

      campo(doc, padX, fy, "Dirección", c["Dirección"], cardW - 16);
      fy += 20;

      campo(doc, padX, fy, "Ciudad / Provincia / CP", `${c["Ciudad"] || ""} · ${c["Provincia"] || ""} ${c["CP"] ? "(CP " + c["CP"] + ")" : ""}`, cardW - 16);
      fy += 20;

      campo(doc, padX, fy, "Depósito", c["Depósito"], colW);
      campo(doc, padX + colW + 10, fy, "Video", `${c["Video estado"] || ""}${c["Video último"] ? " (" + c["Video último"] + ")" : ""}`, colW);
      fy += 20;

      campo(doc, padX, fy, "Cta. cte.", c["Estado cta. cte."], colW);
      campo(doc, padX + colW + 10, fy, "Último pedido", c["Último pedido"], colW);
      fy += 20;

      campo(doc, padX, fy, "Bicicletería / Instagram", `${c["Bicicletería"] || "—"} ${c["Instagram"] || ""}`.trim(), colW);
      const perfilConAtendido = c["Atendido por"]
        ? `${c["Perfil comercial"] || ""} · Atendido por ${c["Atendido por"]}`
        : c["Perfil comercial"];
      campo(doc, padX + colW + 10, fy, "Perfil comercial", perfilConAtendido, colW);

      if (col === 0) {
        col = 1;
      } else {
        col = 0;
        cy += cardH + 10;
      }
    }
  }

  doc.save(fileName);
}
