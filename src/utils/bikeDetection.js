// src/utils/bikeDetection.js
// Detección "gratis" de bicicletas en un video de auditoría, corriendo
// enteramente en el navegador. Combina dos técnicas:
//
// 1) coco-ssd (TensorFlow.js) reconoce bicis ARMADAS y visibles — funciona
//    bien pero solo tiene 90 categorías entrenadas y "caja de cartón" no es
//    una de ellas, así que nunca va a ver una bici embalada.
// 2) Para las que están en caja se usa una heurística propia (sin modelo
//    entrenado): busca regiones rectangulares de color "cartón" (marrón/tan)
//    por frame. Es menos confiable que un modelo entrenado — puede contar
//    cualquier objeto rectangular de un color parecido (madera, piso, piel)
//    como si fuera una caja — pero es gratis y no requiere entrenar nada.
//    Se probó también leer el texto impreso en la caja con OCR
//    (Tesseract.js), pensando que sería más preciso, pero en la prueba real
//    dio peor resultado (4 de 23 cajas reales, contra 14 de 23 de esta
//    heurística de color) — el OCR necesita el cartel enfocado y quieto, y
//    en un video de cámara en mano paneando la mayoría de los frames no
//    alcanzan esa nitidez. Se descartó por eso.
//
// Ninguna de las dos trackea objetos entre frames por su cuenta, así que
// para acercarnos a un conteo total (no solo "cuántas se ven a la vez") se
// arma un tracking simple: se muestrean frames seguidos y cada detección se
// compara por posición/tamaño (IoU) contra las del frame anterior — si se
// solapa lo suficiente, es el mismo objeto que sigue en cuadro; si no, es
// uno nuevo y se suma al total. Sigue siendo una estimación (no un conteo
// exacto): un salto brusco de cámara puede contar de más, y algo que nunca
// entra en cuadro no se cuenta.

let modelPromise = null;

async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      const cocoSsd = await import("@tensorflow-models/coco-ssd");
      await tf.ready();
      return cocoSsd.load();
    })();
  }
  return modelPromise;
}

function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    function onSeeked() {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    }
    function onError() {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Error al buscar el frame del video"));
    }
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

function iou(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

// Trackea una lista de detecciones (boxes [x,y,w,h]) de un frame contra las
// del frame anterior, sumando al contador las que no matchean con nada
// previo (= objeto nuevo en cuadro). Devuelve el nuevo total acumulado.
function trackearFrame(boxesFrame, tracksPrevios, totalPrevio, iouThreshold) {
  let total = totalPrevio;
  const usados = new Set();
  for (const box of boxesFrame) {
    let mejorIdx = -1;
    let mejorIou = 0;
    tracksPrevios.forEach((prevBox, idx) => {
      if (usados.has(idx)) return;
      const solapa = iou(prevBox, box);
      if (solapa > mejorIou) {
        mejorIou = solapa;
        mejorIdx = idx;
      }
    });
    if (mejorIdx >= 0 && mejorIou >= iouThreshold) {
      usados.add(mejorIdx);
    } else {
      total += 1;
    }
  }
  return total;
}

// Heurística de cajas de cartón por color+forma (sin modelo entrenado).
// Trabaja en una resolución bajita (rápido) buscando píxeles "marrón/tan"
// en HSV, agrupándolos en regiones (flood fill 4-conexo) y quedándose con
// las que parecen caja (tamaño mínimo, forma no demasiado alargada).
const BOX_GRID_W = 96;
const BOX_GRID_H = 72;

function esColorCarton(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max === 0) return false;
  const value = max / 255;
  const saturation = delta / max;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
  }
  // Cartón/marrón claro: tono naranja-marrón, saturación media, brillo medio-alto.
  // Rango ensanchado tras pruebas reales (la primera versión subcontaba
  // cajas — 14 detectadas contra ~23 reales — por quedarse corta con el
  // tono exacto de cartón bajo distintas luces).
  return hue >= 8 && hue <= 50 && saturation >= 0.08 && saturation <= 0.72 && value >= 0.28 && value <= 0.95;
}

function detectarCajasEnCanvas(smallCtx) {
  const { data } = smallCtx.getImageData(0, 0, BOX_GRID_W, BOX_GRID_H);
  const mask = new Uint8Array(BOX_GRID_W * BOX_GRID_H);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    mask[i] = esColorCarton(data[o], data[o + 1], data[o + 2]) ? 1 : 0;
  }

  const visitado = new Uint8Array(mask.length);
  const cajas = [];
  const minArea = Math.round(BOX_GRID_W * BOX_GRID_H * 0.012); // ~1.2% del cuadro

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visitado[start]) continue;
    // Flood fill iterativo (pila) para no volar el stack en regiones grandes.
    const pila = [start];
    visitado[start] = 1;
    let minX = BOX_GRID_W, maxX = 0, minY = BOX_GRID_H, maxY = 0, area = 0;
    while (pila.length) {
      const idx = pila.pop();
      const x = idx % BOX_GRID_W;
      const y = Math.floor(idx / BOX_GRID_W);
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const vecinos = [idx - 1, idx + 1, idx - BOX_GRID_W, idx + BOX_GRID_W];
      for (const v of vecinos) {
        if (v < 0 || v >= mask.length) continue;
        if (x === 0 && v === idx - 1) continue;
        if (x === BOX_GRID_W - 1 && v === idx + 1) continue;
        if (!visitado[v] && mask[v]) {
          visitado[v] = 1;
          pila.push(v);
        }
      }
    }
    if (area < minArea) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const aspect = w / h;
    if (aspect < 0.25 || aspect > 4) continue; // descarta formas muy alargadas (no parecen caja)
    cajas.push([minX, minY, w, h]);
  }
  return cajas;
}

// videoEl: un <video> ya cargado (con metadata disponible, duration > 0).
// minScore: confianza mínima de coco-ssd para contar una bici armada.
// iouThreshold: qué tanto tienen que solaparse dos boxes en frames
//   consecutivos para considerarlas "el mismo objeto" y no contarlo de nuevo.
// frameIntervalSec: cada cuánto se analiza un frame (más chico = más
//   preciso el tracking, pero más lento).
// detectarCajas: si además de bicis armadas corre la heurística de cajas.
export async function detectBikesInVideo(
  videoEl,
  { minScore = 0.4, iouThreshold = 0.15, frameIntervalSec = 0.6, maxFrames = 40, detectarCajas = true, onProgress } = {}
) {
  if (!videoEl || !videoEl.duration || !isFinite(videoEl.duration)) {
    throw new Error("El video todavía no cargó los metadatos (duración desconocida)");
  }

  const model = await loadModel();

  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth || 640;
  canvas.height = videoEl.videoHeight || 480;
  const ctx = canvas.getContext("2d");

  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = BOX_GRID_W;
  smallCanvas.height = BOX_GRID_H;
  const smallCtx = smallCanvas.getContext("2d", { willReadFrequently: true });

  const wasPaused = videoEl.paused;
  const originalTime = videoEl.currentTime;
  if (!wasPaused) videoEl.pause();

  const duration = videoEl.duration;
  const samples = Math.max(4, Math.min(maxFrames, Math.round(duration / frameIntervalSec)));

  let totalBicis = 0;
  let maxSimultaneas = 0;
  let sumaScores = 0;
  let cantidadScores = 0;
  let tracksBicisPrevios = [];

  let totalCajas = 0;
  let cajasMaxSimultaneas = 0;
  let tracksCajasPrevios = [];

  try {
    for (let i = 0; i < samples; i++) {
      const t = (duration * (i + 0.5)) / samples;
      await seekTo(videoEl, t);
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const predicciones = await model.detect(canvas);
      const bicis = predicciones.filter((p) => p.class === "bicycle" && p.score >= minScore);
      maxSimultaneas = Math.max(maxSimultaneas, bicis.length);
      bicis.forEach((b) => {
        sumaScores += b.score;
        cantidadScores += 1;
      });
      totalBicis = trackearFrame(bicis.map((b) => b.bbox), tracksBicisPrevios, totalBicis, iouThreshold);
      tracksBicisPrevios = bicis.map((b) => b.bbox);

      if (detectarCajas) {
        smallCtx.drawImage(videoEl, 0, 0, BOX_GRID_W, BOX_GRID_H);
        const cajas = detectarCajasEnCanvas(smallCtx);
        cajasMaxSimultaneas = Math.max(cajasMaxSimultaneas, cajas.length);
        totalCajas = trackearFrame(cajas, tracksCajasPrevios, totalCajas, 0.2);
        tracksCajasPrevios = cajas;
      }

      onProgress?.(i + 1, samples);
    }
  } finally {
    videoEl.currentTime = originalTime;
    if (!wasPaused) videoEl.play().catch(() => {});
  }

  return {
    bicicletas: totalBicis,
    maxSimultaneas,
    cajas: totalCajas,
    cajasMaxSimultaneas,
    samplesAnalizados: samples,
    confianzaPromedio: cantidadScores > 0 ? sumaScores / cantidadScores : 0,
  };
}
