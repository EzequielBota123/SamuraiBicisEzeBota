// Genera una imagen (PNG) prolija de "comprobante de venta reportada" para
// que el distribuidor la mande por WhatsApp a Samurai como respaldo visual.
// Se dibuja a mano con canvas — no depende de ninguna librería externa.

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export async function generateReceiptImage({
  distributorName,
  depositoNombre,
  productName,
  sku,
  quantity,
  unitPrice,
  referenceId,
}) {
  const W = 900;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 1200; // se recorta al final según el contenido real
  const ctx = canvas.getContext("2d");

  // Fondo
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = 0;
  const pad = 48;

  // Header
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, W, 140);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px -apple-system, Helvetica, Arial, sans-serif";
  ctx.fillText("Samurai Bicis", pad, 80);
  ctx.font = "20px -apple-system, Helvetica, Arial, sans-serif";
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText("Comprobante de venta reportada", pad, 114);
  y = 140 + 48;

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 15px -apple-system, Helvetica, Arial, sans-serif";
  const now = new Date();
  const fecha = now.toLocaleDateString("es-AR");
  const hora = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  function field(label, value, opts = {}) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillText(label.toUpperCase(), pad, y);
    y += 26;
    ctx.fillStyle = "#0f172a";
    ctx.font = `${opts.bold ? "bold " : ""}${opts.size || 24}px -apple-system, Helvetica, Arial, sans-serif`;
    const lines = wrapText(ctx, value, W - pad * 2);
    lines.forEach((line) => {
      ctx.fillText(line, pad, y);
      y += (opts.size || 24) + 6;
    });
    y += 18;
  }

  field("Distribuidor", distributorName || "—");
  if (depositoNombre) field("Depósito", depositoNombre, { size: 18 });
  field("Fecha y hora", `${fecha} · ${hora}`, { size: 18 });

  // separador
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 40;

  field("Producto", productName, { bold: true, size: 26 });
  field("SKU", sku, { size: 18 });

  const total = unitPrice != null ? Number(unitPrice) * Number(quantity) : null;

  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 40;

  // Cantidad / precio en dos columnas
  const colW = (W - pad * 2) / 2;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px -apple-system, Helvetica, Arial, sans-serif";
  ctx.fillText("CANTIDAD", pad, y);
  if (unitPrice != null) ctx.fillText("PRECIO UNITARIO", pad + colW, y);
  y += 30;
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 28px -apple-system, Helvetica, Arial, sans-serif";
  ctx.fillText(String(quantity), pad, y);
  if (unitPrice != null) ctx.fillText(money(unitPrice), pad + colW, y);
  y += 56;

  if (total != null) {
    ctx.fillStyle = "#f0fdf4";
    ctx.fillRect(pad - 20, y - 34, W - pad * 2 + 40, 70);
    ctx.fillStyle = "#15803d";
    ctx.font = "15px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillText("TOTAL", pad, y - 8);
    ctx.font = "bold 30px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillText(money(total), pad, y + 24);
    y += 90;
  }

  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 36;

  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px -apple-system, Helvetica, Arial, sans-serif";
  ctx.fillText(`Ref. interna: ${referenceId}`, pad, y);
  y += 24;
  ctx.fillText("Este comprobante confirma el reporte de venta en samurai.ar — pendiente de facturación.", pad, y);
  y += 40;

  // Recorta el canvas a la altura real usada
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = W;
  finalCanvas.height = y + pad;
  const fctx = finalCanvas.getContext("2d");
  fctx.drawImage(canvas, 0, 0, W, finalCanvas.height, 0, 0, W, finalCanvas.height);

  return new Promise((resolve) => {
    finalCanvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
  });
}
