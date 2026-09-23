// src/pages/admin/RemitosReporte.jsx
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  subscribeBusinessDashboardDetail,
  subscribeRemitosDespachosDetail,
  importarRemitos,
  sincronizarRemitosDesdeWeb,
  triggerBusinessDashboardSync,
  adminObtenerRemitoDetalle,
  adminEditarObservacionRemito,
} from "../../services/comprobantes";
import { subscribeCobranzas } from "../../services/cobranzas";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function hoy() {
  return new Date().toISOString().slice(0, 10);
}
function haceNDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function weekStart(fechaISO) {
  const d = new Date(fechaISO + "T00:00:00");
  const day = d.getDay(); // 0=domingo
  const diff = day === 0 ? -6 : 1 - day; // llevar al lunes
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function periodo(fechaISO, modo) {
  if (!fechaISO) return "sin-fecha";
  if (modo === "dia") return fechaISO;
  return modo === "semana" ? weekStart(fechaISO) : fechaISO.slice(0, 7);
}

// Último día que cubre un período — para calcular el saldo en
// consignación "a fin de esta fila" (un stock se corta en un día puntual,
// no en un rango).
function finDePeriodo(p, modo) {
  if (p === "sin-fecha") return null;
  if (modo === "dia") return p;
  if (modo === "semana") {
    const start = new Date(p + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return end.toISOString().slice(0, 10);
  }
  const [y, m] = p.split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10); // día 0 del mes siguiente = último día de este mes
}

function labelPeriodo(p, modo) {
  if (p === "sin-fecha") return "Sin fecha";
  if (modo === "dia") {
    return new Date(p + "T00:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  if (modo === "mes") {
    const [y, m] = p.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", { month: "short", year: "numeric" });
  }
  const start = new Date(p + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)}–${fmt(end)}`;
}

// Clave para agrupar por cliente: preferimos el ID real de Contabilium
// (idPersona en remitos/cobranzas, idCliente en facturas) en vez del
// nombre de texto — Contabilium a veces escribe el nombre distinto en un
// lado y en el otro (ej. "GRASSELLI" en una factura vs "GRASSELLI WALTER"
// en el remito), y eso partía a un mismo cliente en dos filas separadas.
// Si el registro es viejo y todavía no tiene el ID guardado, cae al
// nombre como antes.
function claveDeRemito(r) {
  return r.idPersona != null ? `id:${r.idPersona}` : `nombre:${normalizarNombre(r.cliente)}`;
}
function claveDeFactura(f) {
  return f.idCliente != null ? `id:${f.idCliente}` : `nombre:${normalizarNombre(f.cliente)}`;
}
function claveDeCobranza(c) {
  return c.idPersona != null ? `id:${c.idPersona}` : `nombre:${normalizarNombre(c.razonSocial)}`;
}

function normalizarNombre(s) {
  return (s || "").trim().toUpperCase();
}

// Explicación automática del saldo "en consignación" de un cliente: intenta
// emparejar cada remito con una factura de la MISMA cantidad de bicis (sin
// importar la fecha) — lo que sobra de un lado es lo que probablemente
// explica el saldo positivo (entregado sin facturar) o negativo (facturado
// sin remito cargado). Es una aproximación por cantidad, no una conciliación
// contable exacta: si una entrega se facturó partida en varias facturas
// distintas, puede no encontrar el match y listarla igual como "sin remito".
function reconciliarCliente(remitos, facturas) {
  const fac = facturas.filter((f) => f.bicis > 0).map((f) => ({ ...f }));
  const usadas = new Array(fac.length).fill(false);
  const remSinFactura = [];
  for (const r of remitos.filter((r) => r.bicis > 0)) {
    const idx = fac.findIndex((f, i) => !usadas[i] && f.bicis === r.bicis);
    if (idx >= 0) usadas[idx] = true;
    else remSinFactura.push(r);
  }
  const facSinRemito = fac.filter((_, i) => !usadas[i]);
  return { remSinFactura, facSinRemito };
}

// Muchos remitos internos (FEPA→FEPA) en realidad SÍ fueron a un cliente
// real — solo que quedaron cargados a nombre de la propia empresa, y quien
// lo hizo anotó el destino real a mano en la observación con el formato
// "Transferencia: <depósito origen> → <cliente>" (la flecha a veces queda
// mal codificada como "?"). Cuando aparece ese patrón y el destino no es
// otro depósito propio, se puede recuperar el cliente real.
const DEPOSITO_O_LUGAR_AMBIGUO = /^(lavalle|fepa\s*top|ca[ñn]uelas|dep[oó]sito|temperley|credifin)\b/i;

function extraerClienteDeObservacion(obs) {
  if (!obs) return null;
  const texto = obs.trim();
  // Patrón 1: "Transferencia: <origen> → <destino>" (flecha a veces mal
  // codificada como "?").
  let m = /transferencia\s*:\s*.+?[→?>]\s*(.+)/i.exec(texto);
  // Patrón 2: "de/desde Lavalle a <destino>" — solo cuando Lavalle es el
  // ORIGEN (una entrega saliendo de Lavalle), nunca cuando es el destino
  // (eso sería una devolución, no una entrega a un cliente).
  if (!m) m = /\b(?:de|desde)\s+lavalle\s+a\s+(.+)/i.exec(texto);
  // Patrón 3: "al cliente <destino>" / "al depósito del cliente <destino>"
  // — frases tipo "Movimiento de bicicletas de temperley al cliente Marcos
  // Andrea Galuzzi".
  if (!m) m = /\bal\s+(?:dep[oó]sito\s+del\s+)?cliente\s+(.+)/i.exec(texto);
  // Patrón 4: "pedido de <destino>" — tipo "para completar pedido de
  // Fernando Maletti" o "pedido de cliente Maletti Fernando".
  if (!m) m = /\bpedido\s+de\s+(?:cliente\s+)?(.+)/i.exec(texto);
  if (!m) return null;
  // Corta en la primera coma — frases tipo "..., lleva julian" quedan
  // pegadas al final y no son parte del nombre del cliente. Lo mismo con
  // "... con remito 01-00539" — es una referencia a otro remito, no parte
  // del nombre.
  const destino = m[1]
    .split(",")[0]
    .replace(/\s+con\s+remito\b.*$/i, "")
    .trim()
    .replace(/\.+$/, "");
  if (!destino) return null;
  if (DEPOSITO_O_LUGAR_AMBIGUO.test(destino)) return null; // sigue siendo un depósito/lugar propio, no un cliente
  return destino;
}

export default function RemitosReporte() {
  const [remitosDetail, setRemitosDetail] = useState(null);
  const [businessDetail, setBusinessDetail] = useState(null);
  const [cobranzas, setCobranzas] = useState(null);
  const [desde, setDesde] = useState(haceNDias(90));
  const [hasta, setHasta] = useState(hoy());
  const [modo, setModo] = useState("mes"); // "dia" | "semana" | "mes"
  const [diaAbierto, setDiaAbierto] = useState(null);
  const [search, setSearch] = useState("");
  const [importando, setImportando] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);
  const porClienteRef = useRef(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [syncResult, setSyncResult] = useState(null);
  const [mostrarImportManual, setMostrarImportManual] = useState(false);

  // Modal "ver / editar remito real en Contabilium" — idAbierto es el id
  // de Contabilium (no el de nuestra caché), detalle es lo que devuelve
  // adminObtenerRemitoDetalle en vivo.
  const [remitoIdAbierto, setRemitoIdAbierto] = useState(null);
  const [remitoDetalle, setRemitoDetalle] = useState(null);
  const [remitoCargando, setRemitoCargando] = useState(false);
  const [remitoError, setRemitoError] = useState("");
  const [obsEditada, setObsEditada] = useState("");
  const [guardandoObs, setGuardandoObs] = useState(false);
  const [obsGuardadaOk, setObsGuardadaOk] = useState(false);

  async function abrirRemito(idRemito) {
    setRemitoIdAbierto(idRemito);
    setRemitoDetalle(null);
    setRemitoError("");
    setObsGuardadaOk(false);
    setRemitoCargando(true);
    try {
      const detalle = await adminObtenerRemitoDetalle(idRemito);
      setRemitoDetalle(detalle);
      setObsEditada(detalle.observaciones || "");
    } catch (e) {
      setRemitoError(e.message || "No se pudo traer el remito de Contabilium");
    } finally {
      setRemitoCargando(false);
    }
  }

  async function guardarObservacionRemito() {
    if (!remitoIdAbierto) return;
    setGuardandoObs(true);
    setRemitoError("");
    setObsGuardadaOk(false);
    try {
      const actualizado = await adminEditarObservacionRemito(remitoIdAbierto, obsEditada);
      setRemitoDetalle(actualizado);
      setObsEditada(actualizado.observaciones || "");
      setObsGuardadaOk(true);
    } catch (e) {
      setRemitoError(e.message || "No se pudo guardar la observación");
    } finally {
      setGuardandoObs(false);
    }
  }

  async function handleSincronizarAhora() {
    setSincronizando(true);
    setSyncError("");
    setSyncResult(null);
    try {
      // Ventana amplia (4 meses) — trae todo lo relevante para este
      // reporte sin depender de lo que haya seleccionado el filtro de
      // fechas de arriba. Se sincronizan remitos y facturas/cobranzas juntos
      // porque el saldo en consignación depende de los dos — si solo se
      // actualizan los remitos, el saldo queda atrasado hasta la próxima
      // corrida automática de facturas (cada 24hs).
      const desdeSync = haceNDias(120);
      const [result] = await Promise.all([sincronizarRemitosDesdeWeb(desdeSync, hoy()), triggerBusinessDashboardSync()]);
      setSyncResult(result);
    } catch (err) {
      setSyncError(err.message || "No se pudo sincronizar con Contabilium");
    } finally {
      setSincronizando(false);
    }
  }

  async function handleImportarArchivos(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImportando(true);
    setImportError("");
    setImportResult(null);
    try {
      const arrays = await Promise.all(
        files.map(
          (f) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const parsed = JSON.parse(reader.result);
                  resolve(Array.isArray(parsed) ? parsed : []);
                } catch (err) {
                  reject(new Error(`"${f.name}" no es un JSON válido`));
                }
              };
              reader.onerror = () => reject(new Error(`No se pudo leer "${f.name}"`));
              reader.readAsText(f);
            })
        )
      );
      const remitos = arrays.flat();
      if (remitos.length === 0) throw new Error("Los archivos no tienen remitos (¿son el JSON de detalle, no el de listado?)");
      const result = await importarRemitos(remitos);
      setImportResult(result);
    } catch (err) {
      setImportError(err.message || "No se pudo importar");
    } finally {
      setImportando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    const u1 = subscribeRemitosDespachosDetail(setRemitosDetail);
    const u2 = subscribeBusinessDashboardDetail(setBusinessDetail);
    const u3 = subscribeCobranzas(setCobranzas, () => setCobranzas([]));
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const loading = remitosDetail === null || businessDetail === null || cobranzas === null;

  const dentroDeRango = (fecha) => fecha && fecha >= desde && fecha <= hasta;

  // Nombres reales de clientes que ya conocemos (de facturas y cobranzas,
  // toda la base, no solo el rango filtrado) — contra esto se intenta
  // matchear el destino detectado en la observación de un remito interno.
  const nombresConocidos = useMemo(() => {
    const set = new Set();
    (businessDetail?.porFactura || []).forEach((f) => f.cliente && set.add(f.cliente));
    (cobranzas || []).forEach((c) => c.razonSocial && set.add(c.razonSocial));
    return [...set];
  }, [businessDetail, cobranzas]);

  // Nombre exacto (tal como lo devuelve matchNombreConocido) -> ID real de
  // Contabilium de ESE cliente. Hace falta para los remitos internos
  // atribuidos por observación: el remito en sí sigue teniendo el idPersona
  // de FEPA TOP (es un movimiento propio, no un remito real del cliente),
  // así que si no se corrige, TODOS esos remitos atribuidos comparten la
  // misma clave (la de FEPA TOP) y se mezclan entre sí sin importar a quién
  // se le atribuyeron de verdad.
  const idPorNombreConocido = useMemo(() => {
    const map = new Map();
    (businessDetail?.porFactura || []).forEach((f) => {
      if (f.cliente && f.idCliente != null) map.set(normalizarNombre(f.cliente), f.idCliente);
    });
    (cobranzas || []).forEach((c) => {
      if (c.razonSocial && c.idPersona != null && !map.has(normalizarNombre(c.razonSocial))) {
        map.set(normalizarNombre(c.razonSocial), c.idPersona);
      }
    });
    return map;
  }, [businessDetail, cobranzas]);

  // Devuelve { nombre, confianza } o null. Niveles de confianza, de más a
  // menos seguro:
  //  - "exacta": el texto matchea el nombre completo, letra por letra.
  //  - "alta": mismas palabras que un nombre conocido, en cualquier orden
  //    (ej. "Santiago Bonaudi Pez" vs "Bonaudi Pez, Santiago").
  //  - "media": una sola palabra que es justo la primera de un nombre
  //    conocido (ej. "desabike" -> "DESABIKE S.R.L.").
  //  - "dudosa": una palabra "fuerte" (5+ letras) aparece en algún lugar de
  //    un nombre conocido, pero el resto del texto no matchea — puede ser
  //    un lugar de entrega, no el nombre real (ej. "Larraburu avellaneda"
  //    contra "JULIAN BRAUER LARRABURU": coincide por apellido, pero
  //    "avellaneda" no tiene nada que ver). Esta NO se auto-atribuye — se
  //    junta aparte para que alguien la confirme a mano.
  function matchNombreConocido(nombreDetectado) {
    const key = normalizarNombre(nombreDetectado);
    const exacto = nombresConocidos.find((n) => normalizarNombre(n) === key);
    if (exacto) return { nombre: exacto, confianza: "exacta" };
    const palabras = key.split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) {
      const multi = nombresConocidos.find((n) => {
        const palabrasN = normalizarNombre(n).split(/\s+/).filter(Boolean);
        return palabras.every((p) => palabrasN.includes(p));
      });
      if (multi) return { nombre: multi, confianza: "alta" };
    } else if (palabras.length === 1) {
      const single = nombresConocidos.find((n) => normalizarNombre(n).split(/\s+/)[0] === palabras[0]);
      if (single) return { nombre: single, confianza: "media" };
    }
    const palabraFuerte = palabras.find((p) => p.length >= 5);
    if (palabraFuerte) {
      const porPalabra = nombresConocidos.find((n) => normalizarNombre(n).split(/\s+/).includes(palabraFuerte));
      if (porPalabra) return { nombre: porPalabra, confianza: "dudosa" };
    }
    return null;
  }

  const remitosInternosConDestino = useMemo(() => {
    return (remitosDetail?.porRemito || [])
      .filter((r) => r.esInterno && dentroDeRango(r.fecha))
      .map((r) => {
        const detectado = extraerClienteDeObservacion(r.observaciones);
        const match = detectado ? matchNombreConocido(detectado) : null;
        // Solo se auto-atribuye con confianza exacta/alta/media — "dudosa"
        // queda afuera (se muestra aparte, para confirmar a mano) en vez de
        // arriesgarse a poner un nombre equivocado en un reporte que se usa
        // como documento.
        const confiable = match && match.confianza !== "dudosa" ? match : null;
        return {
          ...r,
          clienteDetectado: confiable ? confiable.nombre : null,
          confianzaAtribucion: confiable ? confiable.confianza : null,
          candidatoDudoso: match && match.confianza === "dudosa" ? { detectado, sugerido: match.nombre } : null,
        };
      });
  }, [remitosDetail, desde, hasta, nombresConocidos]);

  // Remitos internos donde el texto de la observación sugiere un cliente,
  // pero con poca confianza — no se suman a ningún total, quedan para que
  // alguien los confirme a mano.
  const candidatosDudosos = useMemo(
    () => remitosInternosConDestino.filter((r) => r.candidatoDudoso),
    [remitosInternosConDestino]
  );

  const remitosFiltrados = useMemo(() => {
    const normales = (remitosDetail?.porRemito || []).filter((r) => !r.esInterno && dentroDeRango(r.fecha));
    const internosAtribuidos = remitosInternosConDestino
      .filter((r) => r.clienteDetectado)
      .map((r) => ({ ...r, cliente: r.clienteDetectado, esInterno: false, atribuidoDesdeObservacion: true }));
    return [...normales, ...internosAtribuidos];
  }, [remitosDetail, desde, hasta, remitosInternosConDestino]);

  const remitosInternos = useMemo(
    () =>
      remitosInternosConDestino
        .filter((r) => !r.clienteDetectado)
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")),
    [remitosInternosConDestino]
  );
  const facturasFiltradas = useMemo(
    () => (businessDetail?.porFactura || []).filter((f) => dentroDeRango(f.fecha)),
    [businessDetail, desde, hasta]
  );

  // Remitos reales a clientes de TODO el historial, sin recortar por fecha
  // — es la base para el SALDO en consignación, que es un stock acumulado
  // (no tiene sentido calcularlo solo dentro de un rango). El corte por
  // fecha se aplica después, al pedir el saldo "a tal día".
  const remitosRealesTodos = useMemo(() => {
    const todos = remitosDetail?.porRemito || [];
    const normales = todos.filter((r) => !r.esInterno && r.fecha);
    const internos = todos.filter((r) => r.esInterno && r.fecha);
    const internosAtribuidos = internos
      .map((r) => {
        const detectado = extraerClienteDeObservacion(r.observaciones);
        const match = detectado ? matchNombreConocido(detectado) : null;
        // Igual que arriba: "dudosa" no entra en ningún cálculo financiero,
        // por más que haya una palabra parecida — mejor dejarla afuera que
        // arriesgar un número mal atribuido en un reporte que se usa como
        // documento.
        if (!match || match.confianza === "dudosa") return null;
        const matcheado = match.nombre;
        // Pisamos el idPersona (que acá es el de FEPA TOP, inútil para
        // agrupar) por el ID real del cliente detectado, si lo tenemos.
        // Sin esto, claveDeRemito() agrupa por FEPA TOP y mezcla a todos
        // los clientes atribuidos por observación entre sí.
        const idReal = idPorNombreConocido.get(normalizarNombre(matcheado));
        return { ...r, cliente: matcheado, idPersona: idReal ?? null, confianzaAtribucion: match.confianza };
      })
      .filter(Boolean);
    return [...normales, ...internosAtribuidos];
  }, [remitosDetail, nombresConocidos, idPorNombreConocido]);

  const facturasTodas = businessDetail?.porFactura || [];

  // Saldo en consignación por cliente A UNA FECHA DE CORTE dada: bicis que
  // le entregamos por remito hasta esa fecha y todavía no le facturamos
  // (se le deja la bici hasta que la vende y avisa; recién ahí se factura).
  // Si entregado y facturado coinciden — como pasa con Policel, que factura
  // el mismo día que recibe — el saldo da 0: nunca llega a estar "en
  // consignación" de verdad.
  function saldoPorClienteAFecha(fechaCorte) {
    const map = new Map();
    function get(clave) {
      if (!map.has(clave)) map.set(clave, { entregado: 0, facturado: 0 });
      return map.get(clave);
    }
    remitosRealesTodos.forEach((r) => {
      if (r.fecha <= fechaCorte) get(claveDeRemito(r)).entregado += r.bicis;
    });
    facturasTodas.forEach((f) => {
      if (f.fecha && f.fecha <= fechaCorte) get(claveDeFactura(f)).facturado += f.bicis;
    });
    return map;
  }

  const saldoConsignacionPorCliente = useMemo(() => saldoPorClienteAFecha(hasta), [remitosRealesTodos, facturasTodas, hasta]);
  const cobranzasFiltradas = useMemo(
    () => (cobranzas || []).filter((c) => dentroDeRango((c.fecha || "").slice(0, 10))),
    [cobranzas, desde, hasta]
  );

  const totales = useMemo(() => {
    const bicisConsignadas = remitosFiltrados.reduce((a, r) => a + r.bicis, 0);
    const bicisFacturadas = facturasFiltradas.reduce((a, f) => a + f.bicis, 0);
    const facturado = facturasFiltradas.reduce((a, f) => a + f.facturado, 0);
    const cobrado = cobranzasFiltradas.reduce((a, c) => a + Number(c.importeReal ?? c.importeTotal ?? 0), 0);
    return { bicisConsignadas, bicisFacturadas, facturado, cobrado };
  }, [remitosFiltrados, facturasFiltradas, cobranzasFiltradas]);

  // Cuánto de lo pagado en cada cobranza fue realmente contra cada factura
  // puntual (Contabilium liga cada cobranza a una o más facturas por su ID
  // en "detalle") — es plata real, no una cobertura estimada. Se arma sobre
  // TODO el historial de cobranzas (no solo las del rango), porque una
  // factura se puede terminar de cobrar meses después.
  const pagosPorFacturaId = useMemo(() => {
    const map = new Map();
    (cobranzas || []).forEach((c) => {
      (c.detalle || []).forEach((d) => {
        const idComp = String(d.IDComprobante);
        if (!idComp || idComp === "0") return;
        map.set(idComp, (map.get(idComp) || 0) + Number(d.Importe || 0));
      });
    });
    return map;
  }, [cobranzas]);

  // Seguimiento real del lote de bicis entregado en el rango elegido: sigue
  // el mismo lote de principio a fin (entrega → factura → cobro) en vez de
  // mirar cada evento por separado como hace la tabla "por período" de más
  // abajo. Sigue una lógica FIFO: lo primero que se entregó es lo primero
  // que se factura y se cobra. Cuando una factura queda a caballo entre lo
  // que ya estaba entregado antes del rango y lo entregado en el rango, se
  // reparte en proporción a cuántas bicis de esa factura caen de cada lado.
  const seguimientoRealDelPeriodo = useMemo(() => {
    const porClave = new Map();
    function get(clave) {
      if (!porClave.has(clave)) porClave.set(clave, { nombre: "", entregas: [], facturas: [] });
      return porClave.get(clave);
    }
    remitosRealesTodos.forEach((r) => {
      if (r.fecha > hasta) return;
      const row = get(claveDeRemito(r));
      row.entregas.push(r);
      row.nombre = row.nombre || r.cliente;
    });
    facturasTodas.forEach((f) => {
      if (!f.fecha || f.fecha > hasta) return;
      const row = get(claveDeFactura(f));
      row.facturas.push(f);
      row.nombre = row.nombre || f.cliente;
    });

    let entregado = 0;
    let facturadoBicis = 0;
    let facturadoMonto = 0;
    let cobradoMonto = 0;
    const porCliente = [];

    porClave.forEach((row, clave) => {
      row.entregas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
      row.facturas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
      const eBefore = row.entregas.filter((r) => r.fecha < desde).reduce((a, r) => a + r.bicis, 0);
      const eWindow = row.entregas.filter((r) => r.fecha >= desde && r.fecha <= hasta).reduce((a, r) => a + r.bicis, 0);
      if (eWindow <= 0) return;
      const eTotal = eBefore + eWindow;
      const facturadoHastaCliente = row.facturas.reduce((a, f) => a + f.bicis, 0);
      const unidadFacturadoFin = Math.min(facturadoHastaCliente, eTotal);
      // Rango de "posiciones" (en orden de entrega) que corresponde a este
      // período: arranca donde termina el backlog previo, y llega hasta
      // donde llegó la facturación real (topeado por lo que existe).
      const ventanaIni = eBefore;
      const ventanaFin = Math.max(eBefore, unidadFacturadoFin);
      let facturadoDeVentanaBicis = 0;
      let facturadoDeVentanaMonto = 0;
      let cobradoDeVentanaMonto = 0;
      let acumFacturas = 0;
      row.facturas.forEach((f) => {
        const inicio = acumFacturas;
        const fin = acumFacturas + f.bicis;
        acumFacturas = fin;
        const solape = Math.max(0, Math.min(fin, ventanaFin) - Math.max(inicio, ventanaIni));
        if (solape <= 0) return;
        const fraccion = f.bicis > 0 ? solape / f.bicis : 0;
        facturadoDeVentanaBicis += solape;
        facturadoDeVentanaMonto += f.facturado * fraccion;
        const pagadoFactura = pagosPorFacturaId.get(String(f.id)) || 0;
        cobradoDeVentanaMonto += pagadoFactura * fraccion;
      });
      entregado += eWindow;
      facturadoBicis += facturadoDeVentanaBicis;
      facturadoMonto += facturadoDeVentanaMonto;
      cobradoMonto += cobradoDeVentanaMonto;
      porCliente.push({
        clave,
        nombre: row.nombre || "(sin nombre)",
        entregado: eWindow,
        facturado: Math.round(facturadoDeVentanaBicis),
        facturadoMonto: Math.round(facturadoDeVentanaMonto),
        cobradoMonto: Math.round(cobradoDeVentanaMonto),
      });
    });

    porCliente.sort((a, b) => b.entregado - a.entregado);
    return {
      entregado,
      facturadoBicis: Math.round(facturadoBicis),
      facturadoMonto: Math.round(facturadoMonto),
      cobradoMonto: Math.round(cobradoMonto),
      pendienteMonto: Math.round(facturadoMonto - cobradoMonto),
      sinFacturarBicis: Math.round(entregado - facturadoBicis),
      porCliente,
    };
  }, [remitosRealesTodos, facturasTodas, pagosPorFacturaId, desde, hasta]);

  const porPeriodo = useMemo(() => {
    const map = new Map();
    function get(p) {
      if (!map.has(p)) map.set(p, { periodo: p, bicisConsignadas: 0, bicisFacturadas: 0, facturado: 0, cobrado: 0 });
      return map.get(p);
    }
    remitosFiltrados.forEach((r) => (get(periodo(r.fecha, modo)).bicisConsignadas += r.bicis));
    facturasFiltradas.forEach((f) => {
      const row = get(periodo(f.fecha, modo));
      row.bicisFacturadas += f.bicis;
      row.facturado += f.facturado;
    });
    cobranzasFiltradas.forEach((c) => {
      const row = get(periodo((c.fecha || "").slice(0, 10), modo));
      row.cobrado += Number(c.importeReal ?? c.importeTotal ?? 0);
    });
    const rows = [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
    // El saldo en consignación es un STOCK a una fecha, no un flujo del
    // período — se calcula aparte, con todo el historial hasta el último
    // día de cada fila (por eso está afuera del loop de arriba).
    for (const row of rows) {
      const corte = finDePeriodo(row.periodo, modo);
      row.saldoEnConsignacion = corte
        ? [...saldoPorClienteAFecha(corte).values()].reduce((a, x) => a + Math.max(0, x.entregado - x.facturado), 0)
        : null;
    }
    return rows;
  }, [remitosFiltrados, facturasFiltradas, cobranzasFiltradas, modo, remitosRealesTodos, facturasTodas]);

  const detallePorDia = useMemo(() => {
    const map = new Map();
    function get(d) {
      if (!map.has(d)) map.set(d, { remitos: [], facturas: [], cobranzas: [] });
      return map.get(d);
    }
    remitosFiltrados.forEach((r) => get(r.fecha).remitos.push(r));
    remitosInternos.forEach((r) => get(r.fecha).remitos.push(r));
    facturasFiltradas.forEach((f) => get(f.fecha).facturas.push(f));
    cobranzasFiltradas.forEach((c) => get((c.fecha || "").slice(0, 10)).cobranzas.push(c));
    return map;
  }, [remitosFiltrados, remitosInternos, facturasFiltradas, cobranzasFiltradas]);

  const totalesPeriodo = useMemo(() => {
    const sumas = porPeriodo.reduce(
      (a, r) => ({
        bicisConsignadas: a.bicisConsignadas + r.bicisConsignadas,
        bicisFacturadas: a.bicisFacturadas + r.bicisFacturadas,
        facturado: a.facturado + r.facturado,
        cobrado: a.cobrado + r.cobrado,
      }),
      { bicisConsignadas: 0, bicisFacturadas: 0, facturado: 0, cobrado: 0 }
    );
    // El saldo NO se suma entre filas (es un stock, no un flujo) — el total
    // muestra el saldo de la fila más reciente, que es el saldo "a hoy".
    const ultima = porPeriodo[porPeriodo.length - 1];
    return { ...sumas, saldoEnConsignacion: ultima ? ultima.saldoEnConsignacion : null };
  }, [porPeriodo]);

  function irATablaPorCliente() {
    setSearch("");
    porClienteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function descargarExcel() {
    const importe = (c) => Math.round(Number(c.importeReal ?? c.importeTotal ?? 0));
    const dias = [...new Set([...detallePorDia.keys()])].sort();
    const resumen = dias.map((d) => {
      const x = detallePorDia.get(d);
      const remCli = x.remitos.filter((r) => !r.esInterno);
      return {
        Fecha: d,
        "Remitos a clientes": remCli.length,
        "Bicis consignadas": remCli.reduce((a, r) => a + (r.bicis || 0), 0),
        "Remitos internos": x.remitos.filter((r) => r.esInterno).length,
        Facturas: x.facturas.length,
        "Bicis facturadas": x.facturas.reduce((a, f) => a + (f.bicis || 0), 0),
        "Facturado $": Math.round(x.facturas.reduce((a, f) => a + (f.facturado || 0), 0)),
        Cobranzas: x.cobranzas.length,
        "Cobrado $": Math.round(x.cobranzas.reduce((a, c) => a + importe(c), 0)),
      };
    });
    if (resumen.length) {
      const tot = { Fecha: "TOTAL" };
      Object.keys(resumen[0]).slice(1).forEach((k) => (tot[k] = resumen.reduce((a, r) => a + r[k], 0)));
      resumen.push(tot);
    }
    const porFecha = (a, b) => (a.fecha || "").localeCompare(b.fecha || "");
    const wb = XLSX.utils.book_new();
    const add = (nombre, filas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), nombre);
    add("Resumen por día", resumen);
    add(
      "Facturas",
      [...facturasFiltradas].sort(porFecha).map((f) => ({ Fecha: f.fecha, Cliente: f.cliente, Bicis: f.bicis, "Facturado $": Math.round(f.facturado) }))
    );
    add(
      "Cobranzas",
      [...cobranzasFiltradas]
        .sort(porFecha)
        .map((c) => ({
          Fecha: (c.fecha || "").slice(0, 10),
          Número: c.numero,
          Cliente: c.razonSocial,
          "Cobrado $": importe(c),
          "Forma de pago": [...new Set((c.formasDePago || []).map((fp) => fp.FormaDePago))].join(", "),
        }))
    );
    add(
      "Remitos",
      [...remitosFiltrados, ...remitosInternos].sort(porFecha).map((r) => ({
        Fecha: r.fecha,
        Número: r.numero,
        Cliente: r.esInterno ? "" : r.cliente,
        Bicis: r.bicis,
        Tipo: r.esInterno ? "Interno (FEPA→FEPA)" : r.atribuidoDesdeObservacion ? "A cliente (detectado por observación)" : "A cliente",
        Observaciones: r.observaciones || "",
      }))
    );
    add(
      "Por cliente",
      porCliente.map((r) => ({
        Cliente: r.nombre,
        "Bicis consignadas": r.bicisConsignadas,
        "Bicis facturadas": r.bicisFacturadas,
        "Facturado $": Math.round(r.facturado),
        "Cobrado $": Math.round(r.cobrado),
      }))
    );
    XLSX.writeFile(wb, `Detalle ${desde} al ${hasta}.xlsx`);
  }

  // Misma lógica de las tarjetas de arriba (seguimientoRealDelPeriodo),
  // fila por cliente — así la tabla nunca contradice a las tarjetas. Se le
  // suma el saldo acumulado (independiente del rango) como una columna
  // aparte, bien marcada.
  const porCliente = useMemo(() => {
    let rows = seguimientoRealDelPeriodo.porCliente.map((r) => ({
      clave: r.clave,
      nombre: r.nombre,
      bicisConsignadas: r.entregado,
      bicisFacturadas: r.facturado,
      facturado: r.facturadoMonto,
      cobrado: r.cobradoMonto,
    }));
    rows = rows.map((r) => {
      const s = saldoConsignacionPorCliente.get(r.clave);
      return { ...r, saldoConsignacion: s ? s.entregado - s.facturado : 0 };
    });
    rows.sort((a, b) => b.bicisConsignadas - a.bicisConsignadas);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.nombre.toLowerCase().includes(q));
    }
    return rows;
  }, [seguimientoRealDelPeriodo, saldoConsignacionPorCliente, search]);

  const [clienteAbierto, setClienteAbierto] = useState(null); // clave de fila (id: o nombre:)

  const totalConsignacionActual = useMemo(
    () => [...saldoConsignacionPorCliente.values()].reduce((a, s) => a + Math.max(0, s.entregado - s.facturado), 0),
    [saldoConsignacionPorCliente]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Remitos, Facturación y Cobranza</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Cruce por fecha de lo entregado en consigna, lo facturado y lo cobrado. Los remitos internos (FEPA→FEPA) se ven
            aparte, más abajo, con su observación.
          </p>
        </div>
        <div className="text-right">
          <button
            type="button"
            onClick={handleSincronizarAhora}
            disabled={sincronizando}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {sincronizando ? "Sincronizando…" : "🔄 Actualizar desde Contabilium"}
          </button>
          {remitosDetail?.updatedAt?.toDate && (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
              Última actualización: {remitosDetail.updatedAt.toDate().toLocaleString("es-AR")} (remitos se actualizan solos cada 2hs, facturas cada 24hs — este
              botón trae los dos ya)
            </p>
          )}
        </div>
      </div>

      {syncResult && (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          ✅ Trajo {syncResult.traidos} remito(s) de Contabilium — {syncResult.nuevos} nuevo(s), {syncResult.actualizados} actualizado(s).
          {syncResult.aviso ? ` ${syncResult.aviso}` : ""}
        </p>
      )}
      {syncError && <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{syncError}</p>}

      <button
        type="button"
        onClick={() => setMostrarImportManual((v) => !v)}
        className="text-xs text-slate-400 underline hover:text-slate-600 dark:text-neutral-500"
      >
        {mostrarImportManual ? "Ocultar" : "Subir un JSON a mano (respaldo, por si la sincronización falla)"}
      </button>

      {mostrarImportManual && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">📤 Importar remitos (manual)</h2>
          <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
            Subí el/los archivo(s) <code>.json</code> que descarga el script de consola en Contabilium. Identifica cada remito por su ID — si
            subís uno que ya estaba, lo actualiza en vez de duplicarlo. Podés subir varios archivos juntos.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              multiple
              onChange={handleImportarArchivos}
              disabled={importando}
              className="text-xs text-indigo-900 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-700 dark:text-indigo-300"
            />
            {importando && <span className="text-xs text-indigo-700 dark:text-indigo-400">Procesando…</span>}
          </div>
          {importResult && (
            <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              ✅ {importResult.nuevos} remito(s) nuevo(s), {importResult.actualizados} actualizado(s) — total en el registro:{" "}
              {importResult.total}.
            </p>
          )}
          {importError && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{importError}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 p-1 dark:border-neutral-700">
          {[
            { id: "dia", label: "Por día" },
            { id: "semana", label: "Por semana" },
            { id: "mes", label: "Por mes" },
          ].map((op) => (
            <button
              key={op.id}
              onClick={() => setModo(op.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                modo === op.id ? "bg-slate-900 text-white dark:bg-neutral-700" : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {op.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[7, 30, 90, 365].map((n) => (
            <button
              key={n}
              onClick={() => {
                setDesde(haceNDias(n));
                setHasta(hoy());
              }}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {n}d
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={descargarExcel}
          disabled={loading}
          className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          ⬇️ Descargar Excel
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>
      ) : (
        <>
          <p className="text-xs text-slate-400 dark:text-neutral-500">
            Las 5 tarjetas de abajo siguen el mismo lote de bicis de punta a punta: de lo <strong>entregado</strong> en el rango elegido, cuánto ya
            está <strong>facturado</strong>, y de eso cuánto está <strong>cobrado</strong> de verdad (cruzado contra los recibos reales de
            Contabilium). "En consignación hoy" es aparte — es lo que hay afuera sin facturar <em>a día de hoy</em>, no depende de "Desde".
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <button
              type="button"
              onClick={irATablaPorCliente}
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:border-amber-400 hover:shadow-md dark:border-amber-900 dark:bg-amber-950/30"
            >
              <p className="text-xs text-amber-700 dark:text-amber-400">1. Entregadas en el rango</p>
              <p className="mt-1 text-xl font-bold text-amber-900 dark:text-amber-300">{seguimientoRealDelPeriodo.entregado.toLocaleString("es-AR")}</p>
              <p className="mt-0.5 text-[10px] text-amber-600/80 dark:text-amber-400/70">tocá para el detalle por cliente</p>
            </button>
            <button
              type="button"
              onClick={irATablaPorCliente}
              className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left transition hover:border-violet-400 hover:shadow-md dark:border-violet-900 dark:bg-violet-950/30"
            >
              <p className="text-xs text-violet-700 dark:text-violet-400">2. De esas, ya facturadas</p>
              <p className="mt-1 text-xl font-bold text-violet-900 dark:text-violet-300">
                {seguimientoRealDelPeriodo.facturadoBicis.toLocaleString("es-AR")}
              </p>
              <p className="mt-0.5 text-[10px] text-violet-600/80 dark:text-violet-400/70">
                {money(seguimientoRealDelPeriodo.facturadoMonto)} · {seguimientoRealDelPeriodo.sinFacturarBicis.toLocaleString("es-AR")} sin facturar
              </p>
            </button>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">3. De lo facturado, cobrado</p>
              <p className="mt-1 text-xl font-bold text-emerald-800 dark:text-emerald-300">{money(seguimientoRealDelPeriodo.cobradoMonto)}</p>
              <p className="mt-0.5 text-[10px] text-emerald-600/80 dark:text-emerald-400/70">cruzado contra los recibos reales</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30">
              <p className="text-xs text-rose-700 dark:text-rose-400">4. Facturado, sin cobrar</p>
              <p className="mt-1 text-xl font-bold text-rose-800 dark:text-rose-300">{money(seguimientoRealDelPeriodo.pendienteMonto)}</p>
            </div>
            <button
              type="button"
              onClick={irATablaPorCliente}
              className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-left transition hover:border-orange-400 hover:shadow-md dark:border-orange-900 dark:bg-orange-950/30"
            >
              <p className="text-xs text-orange-700 dark:text-orange-400">En consignación HOY (aparte)</p>
              <p className="mt-1 text-xl font-bold text-orange-900 dark:text-orange-300">{totalConsignacionActual.toLocaleString("es-AR")}</p>
              <p className="mt-0.5 text-[10px] text-orange-600/80 dark:text-orange-400/70">saldo a {hasta}, no depende de "Desde". Tocá para el detalle</p>
            </button>
          </div>



          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              🚚 Salidas a clientes {modo === "dia" ? "por día" : modo === "semana" ? "por semana" : "por mes"}
              {modo === "dia" && <span className="ml-2 text-xs font-normal text-slate-400 dark:text-neutral-500">tocá un día para ver el detalle</span>}
            </h2>
            <p className="mb-3 -mt-2 text-xs text-slate-400 dark:text-neutral-500">
              Bicis que salieron de un depósito propio hacia un cliente y lo facturado/cobrado de esos clientes. Los movimientos
              entre depósitos propios (FEPA→FEPA) están aparte, más abajo.
            </p>
            {porPeriodo.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500">Sin datos en este rango.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500 dark:text-neutral-400">
                    <tr>
                      <th className="py-1.5 pr-3">Período</th>
                      <th className="py-1.5 pr-3 text-right">Entregadas</th>
                      <th className="py-1.5 pr-3 text-right" title="Bicis entregadas por remito menos bicis facturadas, acumulado a fin del período — no es lo que tiene físicamente en su local">
                        Entregado − Facturado (a fin del período)
                      </th>
                      <th className="py-1.5 pr-3 text-right">Facturadas</th>
                      <th className="py-1.5 pr-3 text-right">Facturado</th>
                      <th className="py-1.5 text-right">Cobrado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                    {porPeriodo.map((row) => {
                      const abierto = modo === "dia" && diaAbierto === row.periodo;
                      const det = modo === "dia" ? detallePorDia.get(row.periodo) : null;
                      return (
                        <Fragment key={row.periodo}>
                          <tr
                            onClick={modo === "dia" ? () => setDiaAbierto(abierto ? null : row.periodo) : undefined}
                            className={modo === "dia" ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800/50" : ""}
                          >
                            <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-neutral-300">
                              {modo === "dia" && <span className="mr-1 text-slate-400">{abierto ? "▾" : "▸"}</span>}
                              {labelPeriodo(row.periodo, modo)}
                            </td>
                            <td className="py-1.5 pr-3 text-right">{row.bicisConsignadas || "-"}</td>
                            <td className="py-1.5 pr-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                              {row.saldoEnConsignacion ?? "-"}
                            </td>
                            <td className="py-1.5 pr-3 text-right">{row.bicisFacturadas || "-"}</td>
                            <td className="py-1.5 pr-3 text-right">{row.facturado ? money(row.facturado) : "-"}</td>
                            <td className="py-1.5 text-right">{row.cobrado ? money(row.cobrado) : "-"}</td>
                          </tr>
                          {abierto && det && (
                            <tr>
                              <td colSpan={6} className="bg-slate-50 px-3 py-3 dark:bg-neutral-800/40">
                                <div className="grid gap-4 md:grid-cols-3">
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-neutral-200">📦 Remitos ({det.remitos.length})</p>
                                    {det.remitos.length === 0 ? (
                                      <p className="text-xs text-slate-400">Ninguno.</p>
                                    ) : (
                                      det.remitos.map((r) => (
                                        <div key={r.id} className="border-b border-slate-100 py-1 text-xs dark:border-neutral-800">
                                          <div className="flex justify-between gap-2">
                                            <span className="font-mono text-slate-500 dark:text-neutral-400">{r.numero}</span>
                                            <span className="font-semibold text-slate-800 dark:text-white">{r.bicis} bici(s)</span>
                                          </div>
                                          <p className="text-slate-600 dark:text-neutral-300">
                                            {r.esInterno ? "Interno FEPA→FEPA" : r.cliente}
                                            {r.atribuidoDesdeObservacion ? " (detectado)" : ""}
                                          </p>
                                          {r.observaciones && <p className="text-[11px] text-slate-400 dark:text-neutral-500">💬 {r.observaciones}</p>}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-neutral-200">🧾 Facturas ({det.facturas.length})</p>
                                    {det.facturas.length === 0 ? (
                                      <p className="text-xs text-slate-400">Ninguna.</p>
                                    ) : (
                                      det.facturas.map((f) => (
                                        <div key={f.id} className="border-b border-slate-100 py-1 text-xs dark:border-neutral-800">
                                          <div className="flex justify-between gap-2">
                                            <span className="text-slate-600 dark:text-neutral-300">{f.cliente}</span>
                                            <span className="font-semibold text-slate-800 dark:text-white">{money(f.facturado)}</span>
                                          </div>
                                          <p className="text-[11px] text-slate-400 dark:text-neutral-500">{f.bicis} bici(s)</p>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-neutral-200">💳 Cobranzas ({det.cobranzas.length})</p>
                                    {det.cobranzas.length === 0 ? (
                                      <p className="text-xs text-slate-400">Ninguna.</p>
                                    ) : (
                                      det.cobranzas.map((c) => (
                                        <div key={c.id} className="border-b border-slate-100 py-1 text-xs dark:border-neutral-800">
                                          <div className="flex justify-between gap-2">
                                            <span className="text-slate-600 dark:text-neutral-300">{c.razonSocial}</span>
                                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{money(c.importeReal ?? c.importeTotal ?? 0)}</span>
                                          </div>
                                          {(c.formasDePago || []).length > 0 && (
                                            <p className="text-[11px] text-slate-400 dark:text-neutral-500">
                                              {[...new Set(c.formasDePago.map((fp) => fp.FormaDePago))].join(", ")}
                                            </p>
                                          )}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 text-sm font-bold text-slate-900 dark:border-neutral-700 dark:text-white">
                    <tr>
                      <td className="py-2 pr-3">Total / hoy</td>
                      <td className="py-2 pr-3 text-right">{totalesPeriodo.bicisConsignadas.toLocaleString("es-AR")}</td>
                      <td className="py-2 pr-3 text-right text-amber-600 dark:text-amber-400">
                        {(totalesPeriodo.saldoEnConsignacion ?? 0).toLocaleString("es-AR")}
                      </td>
                      <td className="py-2 pr-3 text-right">{totalesPeriodo.bicisFacturadas.toLocaleString("es-AR")}</td>
                      <td className="py-2 pr-3 text-right">{money(totalesPeriodo.facturado)}</td>
                      <td className="py-2 text-right">{money(totalesPeriodo.cobrado)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div ref={porClienteRef} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 scroll-mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Por cliente, en el rango {desde} a {hasta} ({porCliente.length})</h2>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente…"
                className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              />
            </div>
            <p className="mb-2 text-xs text-slate-400 dark:text-neutral-500">
              Las primeras 4 columnas son del mismo lote de bicis, siguiéndolo de punta a punta (igual que las tarjetas de arriba): de lo{" "}
              <strong>entregado</strong> en el rango, cuánto está ya <strong>facturado</strong>, y de eso cuánto <strong>cobrado</strong>. La última
              columna, <strong>"En consignación hoy"</strong>, es otra cosa — un saldo acumulado que no depende de "Desde", lo que ese cliente tiene
              afuera sin facturar a día de hoy. Tocá una fila para el detalle.
            </p>
            {porCliente.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500">Sin datos en este rango.</p>
            ) : (
              <div className="max-h-[600px] overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
                    <tr>
                      <th className="py-1.5 pr-3">Cliente</th>
                      <th className="py-1.5 pr-3 text-right" title={`Solo lo entregado dentro del rango ${desde} a ${hasta}`}>
                        Entregadas en el rango
                      </th>
                      <th className="py-1.5 pr-3 text-right">De esas, facturadas</th>
                      <th className="py-1.5 pr-3 text-right">$ Facturado</th>
                      <th className="py-1.5 pr-3 text-right">$ Cobrado</th>
                      <th
                        className="py-1.5 pr-3 text-right border-l-2 border-slate-200 pl-3 dark:border-neutral-700"
                        title="No es del rango de arriba: es un saldo acumulado de TODO el historial a hoy. Puede ser mayor, menor o no tener relación con 'Entregadas en el rango'."
                      >
                        Saldo histórico hoy ⓘ
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                    {porCliente.map((row) => {
                      const key = row.clave;
                      const abierto = clienteAbierto === key;
                      // Todo el historial hasta "Hasta" (no solo el rango
                      // filtrado) — el saldo en consignación es acumulado,
                      // así que el detalle tiene que mostrar todo lo que lo
                      // arma, no solo lo que cae dentro de "Desde".
                      const remCli = remitosRealesTodos
                        .filter((r) => claveDeRemito(r) === key && r.fecha <= hasta)
                        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
                      const facCli = facturasTodas
                        .filter((f) => claveDeFactura(f) === key && f.fecha && f.fecha <= hasta)
                        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
                      const cobCli = cobranzasFiltradas
                        .filter((c) => claveDeCobranza(c) === key)
                        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
                      const { remSinFactura, facSinRemito } = abierto ? reconciliarCliente(remCli, facCli) : { remSinFactura: [], facSinRemito: [] };
                      const primerRemitoFecha = remCli.length ? [...remCli].sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""))[0].fecha : null;
                      return (
                        <Fragment key={key}>
                          <tr onClick={() => setClienteAbierto(abierto ? null : key)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800/50">
                            <td className="py-1.5 pr-3 text-sky-700 dark:text-sky-400">
                              <span className="mr-1 text-slate-400">{abierto ? "▾" : "▸"}</span>
                              {row.nombre}
                            </td>
                            <td className="py-1.5 pr-3 text-right">{row.bicisConsignadas}</td>
                            <td className="py-1.5 pr-3 text-right">
                              {row.bicisFacturadas || <span className="text-slate-400 dark:text-neutral-500">0 de este rango</span>}
                            </td>
                            <td className="py-1.5 pr-3 text-right">
                              {row.facturado ? money(row.facturado) : <span className="text-slate-400 dark:text-neutral-500">$0 de este rango</span>}
                            </td>
                            <td className="py-1.5 pr-3 text-right">
                              {row.cobrado ? money(row.cobrado) : <span className="text-slate-400 dark:text-neutral-500">$0 de este rango</span>}
                            </td>
                            <td
                              className={`py-1.5 text-right font-semibold border-l-2 border-slate-200 pl-3 dark:border-neutral-700 ${
                                row.saldoConsignacion > 0
                                  ? "text-amber-600 dark:text-amber-400"
                                  : row.saldoConsignacion < 0
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-slate-300 dark:text-neutral-600"
                              }`}
                            >
                              {row.saldoConsignacion || 0}
                            </td>
                          </tr>
                          {abierto && (
                            <tr>
                              <td colSpan={6} className="bg-slate-50 px-3 py-3 dark:bg-neutral-800/40">
                                <div
                                  className={`mb-3 rounded-xl border px-3 py-2 text-xs ${
                                    row.saldoConsignacion > 0
                                      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                                      : row.saldoConsignacion < 0
                                      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
                                      : "border-slate-200 bg-white text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                                  }`}
                                >
                                  {row.saldoConsignacion === 0 ? (
                                    <p>Está saldado: lo que le entregamos por remito coincide con lo facturado.</p>
                                  ) : row.saldoConsignacion > 0 ? (
                                    <>
                                      <p>
                                        Tiene <strong>{row.saldoConsignacion}</strong> bici(s) entregada(s) por remito, EN TODO EL HISTORIAL (no solo el
                                        rango de arriba), que todavía no se facturaron — es lo normal en consignación, se factura recién cuando vende y
                                        avisa.
                                      </p>
                                      {remSinFactura.length > 0 && (
                                        <p className="mt-1">
                                          Remitos sin facturar detectados (por cantidad):{" "}
                                          {remSinFactura.map((r) => `${r.fecha} (${r.bicis})`).join(", ")}
                                          {remSinFactura.reduce((a, r) => a + r.bicis, 0) !== row.saldoConsignacion && (
                                            <span className="text-[11px] opacity-70">
                                              {" "}
                                              — la suma no cierra exacta con el saldo; puede haber remitos facturados en partes distintas.
                                            </span>
                                          )}
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <p>
                                        Se facturaron <strong>{Math.abs(row.saldoConsignacion)}</strong> bici(s) más de las que constan entregadas por
                                        remito en el sistema. No es una deuda del cliente: probablemente falte cargar algún remito (una entrega vieja, o
                                        facturada sin pasar por el flujo de consignación).
                                      </p>
                                      {facSinRemito.length > 0 && (
                                        <ul className="mt-1 list-disc pl-4">
                                          {facSinRemito.map((f) => (
                                            <li key={f.id}>
                                              Factura {f.fecha} por {f.bicis} bici(s)
                                              {primerRemitoFecha && f.fecha < primerRemitoFecha
                                                ? " — anterior al primer remito cargado de este cliente, probablemente de antes de usar el sistema."
                                                : " — no encontramos un remito de esa misma cantidad; conviene revisarla en Contabilium."}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </>
                                  )}
                                </div>
                                <div className="grid gap-4 md:grid-cols-3">
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-neutral-200">
                                      📦 Remitos ({remCli.length}) — todo el historial hasta {hasta}
                                    </p>
                                    {remCli.length === 0 ? (
                                      <p className="text-xs text-slate-400">Ninguno.</p>
                                    ) : (
                                      remCli.map((r) => (
                                        <div
                                          key={r.id}
                                          onClick={() => abrirRemito(r.id)}
                                          className="cursor-pointer border-b border-slate-100 py-1 text-xs hover:bg-white dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                                        >
                                          <div className="flex justify-between gap-2">
                                            <span className="text-slate-500 dark:text-neutral-400">
                                              {r.fecha}{" "}
                                              <span className="font-mono text-sky-700 underline decoration-dotted dark:text-sky-400">{r.numero}</span>
                                            </span>
                                            <span className="font-semibold text-slate-800 dark:text-white">{r.bicis} bici(s)</span>
                                          </div>
                                          {r.esInterno && (
                                            <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                              detectado por observación · confianza {r.confianzaAtribucion || "?"}
                                            </p>
                                          )}
                                          {r.observaciones && (
                                            <p className="text-[11px] text-slate-400 dark:text-neutral-500">💬 {r.observaciones}</p>
                                          )}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-neutral-200">
                                      🧾 Facturas ({facCli.length}) — todo el historial hasta {hasta}
                                    </p>
                                    {facCli.length === 0 ? (
                                      <p className="text-xs text-slate-400">Ninguna.</p>
                                    ) : (
                                      facCli.map((f) => (
                                        <div key={f.id} className="border-b border-slate-100 py-1 text-xs dark:border-neutral-800">
                                          <div className="flex justify-between gap-2">
                                            <span className="text-slate-500 dark:text-neutral-400">{f.fecha}</span>
                                            <span className="font-semibold text-slate-800 dark:text-white">{money(f.facturado)}</span>
                                          </div>
                                          <p className="text-[11px] text-slate-400 dark:text-neutral-500">{f.bicis} bici(s)</p>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div>
                                    <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-neutral-200">💳 Cobranzas ({cobCli.length})</p>
                                    {cobCli.length === 0 ? (
                                      <p className="text-xs text-slate-400">Ninguna en el período.</p>
                                    ) : (
                                      cobCli.map((c) => (
                                        <div key={c.id} className="border-b border-slate-100 py-1 text-xs dark:border-neutral-800">
                                          <div className="flex justify-between gap-2">
                                            <span className="text-slate-500 dark:text-neutral-400">{(c.fecha || "").slice(0, 10)} · Nº {c.numero}</span>
                                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{money(c.importeReal ?? c.importeTotal ?? 0)}</span>
                                          </div>
                                          {(c.formasDePago || []).length > 0 && (
                                            <p className="text-[11px] text-slate-400 dark:text-neutral-500">
                                              {[...new Set(c.formasDePago.map((fp) => fp.FormaDePago))].join(", ")}
                                            </p>
                                          )}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {candidatosDudosos.length > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                🤔 Candidatos dudosos, sin confirmar — {candidatosDudosos.length}
              </h2>
              <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/70">
                La observación menciona algo parecido al nombre de un cliente, pero no lo suficiente como para asignárselo solo.
                No suman en ningún total de arriba — quedan en "Movimientos internos" hasta que alguien confirme a mano quién es
                de verdad (editando la observación, con el lápiz de cada remito).
              </p>
              <div className="mt-2 space-y-1.5">
                {candidatosDudosos.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => abrirRemito(r.id)}
                    className="cursor-pointer rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs hover:border-amber-400 dark:border-amber-900 dark:bg-neutral-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-slate-600 dark:text-neutral-300">
                        {r.fecha} <span className="font-mono text-sky-700 dark:text-sky-400">{r.numero}</span> · {r.bicis} bici(s)
                      </span>
                      <span className="text-amber-700 dark:text-amber-400">
                        "{r.candidatoDudoso.detectado}" → ¿<strong>{r.candidatoDudoso.sugerido}</strong>?
                      </span>
                    </div>
                    {r.observaciones && <p className="mt-0.5 text-slate-400 dark:text-neutral-500">💬 {r.observaciones}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
              🔁 Movimientos internos entre depósitos propios (FEPA→FEPA) — {remitosInternos.length}
            </h2>
            <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
              Movimientos entre depósitos propios (no van a un distribuidor). Muchos de estos se cargaron sin poner el
              depósito real en ningún campo — la observación es la única forma de saber qué se movió de verdad.
            </p>
            {remitosInternos.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400 dark:text-neutral-500">Sin remitos internos en este rango.</p>
            ) : (
              <div className="mt-3 max-h-[420px] overflow-y-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
                    <tr>
                      <th className="py-1.5 pr-3">Fecha</th>
                      <th className="py-1.5 pr-3">Número</th>
                      <th className="py-1.5 pr-3 text-right">Bicis</th>
                      <th className="py-1.5">Observación (movimiento real)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                    {remitosInternos.map((r) => (
                      <tr key={r.id} onClick={() => abrirRemito(r.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800/50">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500 dark:text-neutral-400">{r.fecha}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap font-mono text-sky-700 underline decoration-dotted dark:text-sky-400">{r.numero}</td>
                        <td className="py-1.5 pr-3 text-right">{r.bicis}</td>
                        <td className="py-1.5 text-slate-600 dark:text-neutral-300">
                          {r.observaciones || <span className="text-amber-600 dark:text-amber-400">sin observación cargada</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {remitoIdAbierto && (
        <div
          className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setRemitoIdAbierto(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Remito {remitoDetalle?.numero || `#${remitoIdAbierto}`}</h2>
                <p className="text-xs text-slate-400 dark:text-neutral-500">Tal cual está ahora en Contabilium (id {remitoIdAbierto})</p>
              </div>
              <button
                onClick={() => setRemitoIdAbierto(null)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                ✕
              </button>
            </div>

            {remitoCargando && <p className="mt-4 text-sm text-slate-400 dark:text-neutral-500">Consultando Contabilium…</p>}
            {remitoError && <p className="mt-4 text-sm font-medium text-rose-600 dark:text-rose-400">{remitoError}</p>}

            {remitoDetalle && !remitoCargando && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border border-slate-200 p-2.5 dark:border-neutral-800">
                    <p className="text-[11px] text-slate-400 dark:text-neutral-500">Fecha</p>
                    <p className="font-semibold text-slate-800 dark:text-white">{remitoDetalle.fecha || "—"}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-2.5 dark:border-neutral-800">
                    <p className="text-[11px] text-slate-400 dark:text-neutral-500">A nombre de (idPersona)</p>
                    <p className="font-semibold text-slate-800 dark:text-white">
                      {remitoDetalle.razonSocialLista || "—"} <span className="font-normal text-slate-400">({remitoDetalle.idPersona ?? "?"})</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">📦 Ítems</h3>
                  {(remitoDetalle.items || []).length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">Sin ítems.</p>
                  ) : (
                    <div className="mt-1.5 space-y-1">
                      {remitoDetalle.items.map((it, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600 dark:text-neutral-300">
                            {it.nombre || it.descripcion || it.codigoConcepto} <span className="text-slate-400">({it.codigoConcepto})</span>
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-white">x{it.cantidad}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">💬 Observación</h3>
                  <textarea
                    value={obsEditada}
                    onChange={(e) => setObsEditada(e.target.value)}
                    rows={3}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={guardarObservacionRemito}
                      disabled={guardandoObs || obsEditada === (remitoDetalle.observaciones || "")}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {guardandoObs ? "Guardando…" : "Guardar observación en Contabilium"}
                    </button>
                    {obsGuardadaOk && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✅ Guardado</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
