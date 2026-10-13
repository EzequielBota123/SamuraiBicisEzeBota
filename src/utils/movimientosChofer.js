// src/utils/movimientosChofer.js
// Detecta, a partir del texto libre de la observación de un remito, qué
// chofer/vendedor con flota propia hizo ese movimiento — Julián (el chofer
// de planta) y los vendedores con reparto propio (Alfredo "Cuchi"
// Bavcevich, Pablo). No depende de que el remito tenga un cliente
// prolijamente atribuido: cualquier remito (interno o a cliente) que
// mencione a alguno de estos nombres cuenta, aunque el destino no se haya
// podido identificar.
export const CHOFERES_CONOCIDOS = [
  { id: "julian", nombre: "Julián", regex: /julian/i },
  { id: "alfredo", nombre: "Alfredo (Cuchi)", regex: /\bcuchi\b|alfredo/i },
  { id: "pablo", nombre: "Pablo", regex: /\bpablo\b/i },
];

export function detectarChoferesEnTexto(texto) {
  const t = String(texto || "");
  return CHOFERES_CONOCIDOS.filter((c) => c.regex.test(t)).map((c) => c.id);
}

// `remitos`: array de remitos (con .fecha, .numero, .bicis, .esInterno,
// .cliente, .observaciones) — se le pueden pasar TODOS (internos y a
// cliente), la función separa por chofer y no filtra por tener un cliente
// bien atribuido, así aparecen incluso los movimientos que nunca se
// pudieron etiquetar con un destino real.
export function movimientosPorChofer(remitos, desde, hasta) {
  const dentroDeRango = (fecha) => fecha && (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
  const porChofer = new Map(CHOFERES_CONOCIDOS.map((c) => [c.id, { ...c, movimientos: [], totalBicis: 0 }]));

  for (const r of remitos || []) {
    if (!dentroDeRango(r.fecha)) continue;
    const ids = detectarChoferesEnTexto(r.observaciones);
    if (ids.length === 0) continue;
    for (const id of ids) {
      const bucket = porChofer.get(id);
      if (!bucket) continue;
      bucket.movimientos.push({
        id: r.id,
        fecha: r.fecha,
        numero: r.numero,
        bicis: r.bicis || 0,
        esInterno: !!r.esInterno,
        destino: r.esInterno ? null : r.cliente || null,
        observaciones: r.observaciones || "",
      });
      bucket.totalBicis += r.bicis || 0;
    }
  }
  for (const bucket of porChofer.values()) {
    bucket.movimientos.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  }
  return [...porChofer.values()];
}

// Detecta de cuál de los 3 depósitos propios salió un movimiento, leyendo
// la observación — el que se nombra PRIMERO en el texto es el origen (así
// salen bien "Transferencia: Lavalle -> X", "Sale de credifin a lavalle",
// "Movimiento de bicicletas de Credifin al depósito del cliente", etc.).
// Temperley es la dirección física del depósito Lavalle, así que cuenta
// como el mismo sector.
export const SECTORES_DEPOSITO = [
  { id: "lavalle", nombre: "Lavalle", regex: /lavalle|temperley/i },
  { id: "canuelas", nombre: "Cañuelas", regex: /ca[ñn]uelas/i },
  { id: "credifin", nombre: "Credifin", regex: /credifin/i },
];

function detectarDepositoOrigen(texto) {
  const t = String(texto || "");
  let mejor = null;
  for (const s of SECTORES_DEPOSITO) {
    const m = s.regex.exec(t);
    if (m && (mejor === null || m.index < mejor.index)) mejor = { id: s.id, nombre: s.nombre, index: m.index };
  }
  return mejor ? { id: mejor.id, nombre: mejor.nombre } : null;
}

// `remitos`: TODOS (internos y a cliente) — cuenta cualquier movimiento
// donde se pueda detectar el depósito de origen por texto, tenga o no un
// cliente bien atribuido ("con remito o sin remito").
export function salidasPorDeposito(remitos, desde, hasta) {
  const dentroDeRango = (fecha) => fecha && (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
  const porDeposito = new Map(SECTORES_DEPOSITO.map((s) => [s.id, { ...s, movimientos: [], totalBicis: 0 }]));
  let sinDetectar = { movimientos: 0, bicis: 0 };

  for (const r of remitos || []) {
    if (!dentroDeRango(r.fecha)) continue;
    const origen = detectarDepositoOrigen(r.observaciones);
    if (!origen) {
      sinDetectar.movimientos += 1;
      sinDetectar.bicis += r.bicis || 0;
      continue;
    }
    const bucket = porDeposito.get(origen.id);
    bucket.movimientos.push({
      id: r.id,
      fecha: r.fecha,
      numero: r.numero,
      bicis: r.bicis || 0,
      esInterno: !!r.esInterno,
      destino: r.esInterno ? null : r.cliente || null,
      observaciones: r.observaciones || "",
    });
    bucket.totalBicis += r.bicis || 0;
  }
  for (const bucket of porDeposito.values()) {
    bucket.movimientos.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  }
  return { sectores: [...porDeposito.values()], sinDetectar };
}
