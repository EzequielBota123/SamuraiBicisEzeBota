import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { addDoc, collection, deleteDoc, doc as firestoreDoc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { db, auth } from "../../../firebase";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const STORAGE_KEY = "samurai_conciliacion_bancaria_v1";
const EXTRACTOS_COLLECTION = "extractosBancarios";

// Guarda el extracto subido en Firestore (compartido para todo el equipo,
// con fecha/hora real) además del localStorage — antes esto se perdía al
// cambiar de compu o borrar el caché del navegador.
async function guardarExtractoEnFirestore(fileName, movimientos) {
  const ref = await addDoc(collection(db, EXTRACTOS_COLLECTION), {
    fileName,
    cantidad: movimientos.length,
    movimientos: movimientos.map((m) => ({ ...m, fecha: m.fecha.toISOString() })),
    subidoPor: auth.currentUser?.email || null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

function formatFechaHora(d) {
  if (!d) return "-";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " · " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) + " hs";
}

function saveMovimientos(fileName, movimientos) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ fileName, movimientos: movimientos.map((m) => ({ ...m, fecha: m.fecha.toISOString() })) })
    );
  } catch {
    // localStorage lleno o no disponible: no persistimos, no es crítico
  }
}

function loadMovimientos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { fileName, movimientos } = JSON.parse(raw);
    return { fileName, movimientos: movimientos.map((m) => ({ ...m, fecha: new Date(m.fecha) })) };
  } catch {
    return null;
  }
}

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function classifyMovimiento(descripcion, detalle) {
  const text = `${descripcion || ""} ${detalle || ""}`.toLowerCase();
  if (text.includes("echeq") || text.includes("g.de cheque") || text.includes("gestion de cheque")) return "cheque";
  if (text.includes("transferencia") || text.includes("debin") || text.includes("transf")) return "transferencia";
  if (text.includes("efvo") || text.includes("efectivo")) return "efectivo";
  return "otro";
}

function extractDocumento(detalle) {
  const m = /DOCUMENTO:\s*(\d+)/i.exec(detalle || "");
  return m ? m[1] : null;
}

// Junta todos los posibles CUIT (corridas de 11 dígitos, con o sin
// guiones/espacios/puntos separando) que aparecen en cualquier parte del
// texto del movimiento — no depende de que el banco lo marque con una
// etiqueta tipo "DOCUMENTO:". Una corrida más larga (CBU, nº de cuenta)
// puede tener un CUIT válido incrustado, por eso se prueban todas las
// ventanas de 11 dentro de cada corrida de dígitos, no solo el principio.
// El propio cruce contra el universo de CUITs de clientes reales (afuera de
// esta función) es lo que descarta los falsos positivos — un candidato que
// no matchea a ningún cliente simplemente se ignora.
function findCuitsEnTexto(text) {
  const runs = String(text || "").match(/\d[\d.\-\s]*\d/g) || [];
  const candidatos = new Set();
  for (const run of runs) {
    const digits = onlyDigits(run);
    for (let i = 0; i + 11 <= digits.length; i++) {
      candidatos.add(digits.slice(i, i + 11));
    }
  }
  return [...candidatos];
}

function daysBetween(a, b) {
  return Math.abs((a.getTime() - b.getTime()) / 86400000);
}

function normalizarEncabezado(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // saca tildes: "Descripción" -> "descripcion"
}

// Algunos exports (Banco Supervielle) escriben la fecha como texto
// "DD/MM/AAAA" en vez de una fecha real — sin esto, `fecha instanceof Date`
// descarta la fila entera en silencio.
function parseFechaCelda(v) {
  if (v instanceof Date) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || "").trim());
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Algunos exports (Banco Supervielle) escriben un "cero" como un valor
// denormalizado casi nulo (ej. 5e-324) en la columna que no corresponde al
// movimiento, en vez de 0 o vacío — un `|| 0` no lo detecta porque es un
// número truthy, así que un débito se toma por error como un crédito real.
function numeroSignificativo(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) >= 0.01 ? n : 0;
}

// Lee la hoja de movimientos del Excel del banco. Las columnas se identifican
// por NOMBRE de encabezado, no por posición — el orden real varía entre
// exports y un desfasaje ahí hace que se descarten todas las filas en
// silencio. Soporta varios formatos:
//  - El genérico (hoja "Ingresos"): Banco/Cuenta/Fecha/Descripción/Detalle/
//    Importe/Nota, con una sola columna de Importe ya neta.
//  - Banco Galicia (hoja "Movimientos"): separa Débitos/Créditos en vez de un
//    Importe único, y el detalle de quién pagó viene repartido en Concepto/
//    Observaciones Cliente/Número de Comprobante/Leyendas Adicionales 1-4 en
//    vez de una sola columna "Detalle".
//  - Banco Supervielle: Fecha/Hora/Concepto/Detalle/Débito/Crédito/Saldo, con
//    la fecha como texto y ceros como valores casi-nulos (ver arriba).
// En los formatos con Débito/Crédito separados, solo interesan los INGRESOS:
// se usa Crédito como importe y se descartan las filas de Débito.
function parseIngresosSheet(workbook) {
  const sheetName = workbook.SheetNames.find((n) => /ingres|movimient/i.test(n)) || workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (rows.length === 0) return { movimientos: [], filasDeDatos: 0, columnasReconocidas: false };

  const encabezado = rows[0].map(normalizarEncabezado);
  const idx = {
    banco: encabezado.indexOf("banco"),
    cuenta: encabezado.indexOf("cuenta"),
    fecha: encabezado.indexOf("fecha"),
    descripcion: encabezado.indexOf("descripcion"),
    detalle: encabezado.indexOf("detalle"),
    importe: encabezado.indexOf("importe"),
    creditos: encabezado.indexOf("creditos") >= 0 ? encabezado.indexOf("creditos") : encabezado.indexOf("credito"),
    debitos: encabezado.indexOf("debitos") >= 0 ? encabezado.indexOf("debitos") : encabezado.indexOf("debito"),
    nota: encabezado.indexOf("nota"),
  };

  // Cualquier otra columna de texto (no fecha/importe/saldo/banco/cuenta) se
  // suma al detalle — ahí puede venir el CUIT o el nombre del pagante, y el
  // nombre exacto de esa columna cambia según el banco (Concepto, Leyendas
  // Adicionales 1-4, Observaciones Cliente, etc.), así que no se listan a
  // mano una por una.
  const columnasExcluidasDetalle = new Set(
    [idx.fecha, idx.descripcion, idx.detalle, idx.importe, idx.creditos, idx.debitos, idx.banco, idx.cuenta, idx.nota, encabezado.indexOf("saldo")].filter(
      (i) => i >= 0
    )
  );
  const columnasDetalleExtra = encabezado.map((_, i) => i).filter((i) => !columnasExcluidasDetalle.has(i));

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fecha = idx.fecha >= 0 ? parseFechaCelda(row[idx.fecha]) : null;
    if (!fecha) continue; // salta filas de resumen/vacías

    let importe;
    if (idx.importe >= 0) {
      const v = numeroSignificativo(row[idx.importe]);
      if (v === 0) continue;
      importe = v;
    } else if (idx.creditos >= 0) {
      const creditos = numeroSignificativo(row[idx.creditos]);
      if (creditos <= 0) continue; // es un débito (plata que salió), no un ingreso
      importe = creditos;
    }
    if (typeof importe !== "number" || !Number.isFinite(importe)) continue;

    const detalleExtra = columnasDetalleExtra
      .map((i) => row[i])
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
      .join(" · ");
    const detalle = idx.detalle >= 0 ? row[idx.detalle] : detalleExtra || null;

    // El impuesto Ley 25413 (débitos/créditos bancarios) y su devolución son
    // movimientos internos del banco, no plata de un cliente — no aportan
    // nada a "identificar pagos sueltos" y solo ensucian la lista.
    const descripcionCompleta = `${idx.descripcion >= 0 ? row[idx.descripcion] : ""} ${detalle || ""}`;
    if (/ley\s*25413/i.test(descripcionCompleta)) continue;

    out.push({
      cuenta: idx.cuenta >= 0 ? row[idx.cuenta] : null,
      descripcion: idx.descripcion >= 0 ? row[idx.descripcion] : null,
      detalle,
      fecha,
      banco: idx.banco >= 0 ? row[idx.banco] : null,
      importe,
      nota: idx.nota >= 0 ? row[idx.nota] || null : null,
    });
  }
  return {
    movimientos: out,
    filasDeDatos: rows.length - 1,
    columnasReconocidas: idx.fecha >= 0 && (idx.importe >= 0 || idx.creditos >= 0),
  };
}

// Reconstruye el texto de un PDF línea por línea agrupando los ítems de
// pdf.js por coordenada Y (pdf.js no da saltos de línea, solo texto suelto
// posicionado) — necesario porque los resúmenes de Supervielle solo se
// consiguen en PDF, no en Excel, para meses viejos.
async function extractPdfLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = [...content.items].sort((a, b) => b.transform[5] - a.transform[5]);
    const TOL = 2; // tolerancia en puntos PDF para considerar dos ítems en la misma línea
    let current = null;
    let currentY = null;
    for (const it of items) {
      const y = it.transform[5];
      if (current === null || Math.abs(y - currentY) > TOL) {
        current = [];
        lines.push(current);
        currentY = y;
      }
      current.push(it);
    }
  }
  return lines.map((items) =>
    items
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Parsea el texto reconstruido de un resumen de cuenta de Banco Supervielle
// (formato "Fecha Concepto Débito Crédito Saldo", una sola columna de
// importe por fila — nunca las dos juntas). No hay columna "banco" ni
// "detalle" explícitas como en el Excel genérico, así que se arman acá:
//  - El saldo SIEMPRE viene en la fila (a diferencia del Excel), así que la
//    forma confiable de saber si un importe es débito o crédito es comparar
//    contra el saldo anterior (delta positivo = ingreso), no la posición de
//    la columna en el texto reconstruido (que puede variar).
//  - Las líneas de continuación (nombre del que transfirió + CUIT, "Ref:…")
//    quedan pegadas al movimiento anterior como "detalle", para que
//    matchMovimiento pueda encontrar el CUIT igual que con el Excel.
function parseSupervielleTexto(lines) {
  // El saldo negativo se imprime con el signo AL FINAL ("802.629,94-"), no
  // adelante — sin el "-?" acá se pierde la fila entera (y por lo tanto el
  // resto de la sección queda con un runningSaldo desfasado en cascada).
  const movRegex = /^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+([\d.]+,\d{2}-?)\s+([\d.]+,\d{2}-?)$/;
  const saldoAnteriorRegex = /Saldo del per[ií]odo anterior\s+([\d.]+,\d{2}-?)$/i;
  const cuentaRegex = /NUMERO DE CUENTA\s+([\d./-]+)/i;
  const finSeccionRegex = /SALDO PER[IÍ]ODO ACTUAL/i;
  const ruidoRegex = /^(RESUMEN DE CUENTA|CLAVE BANCARIA|IMPORTANTE:|Fecha\s+Concepto|Usted puede|Monotributistas|Los dep[oó]sitos|TXTel|I\.V\.A\.|PARA CONSUMIDOR|Servicio\s+Moneda|CUENTA CORRIENTE|Cantidad Total|INFORMACION SOBRE|\*{5,}|Responsable Inscripto|Detalle de Movimientos)/i;

  const toNumber = (s) => {
    const str = String(s).trim();
    const negativo = str.endsWith("-");
    const n = Number((negativo ? str.slice(0, -1) : str).replace(/\./g, "").replace(",", "."));
    return negativo ? -n : n;
  };

  const out = [];
  let cuentaActual = null;
  let runningSaldo = null;
  let currentMov = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const cuentaMatch = cuentaRegex.exec(line);
    if (cuentaMatch) {
      cuentaActual = cuentaMatch[1];
      runningSaldo = null;
      currentMov = null;
      continue;
    }

    const saldoAntMatch = saldoAnteriorRegex.exec(line);
    if (saldoAntMatch) {
      runningSaldo = toNumber(saldoAntMatch[1]);
      currentMov = null;
      continue;
    }

    if (finSeccionRegex.test(line)) {
      runningSaldo = null;
      currentMov = null;
      continue;
    }

    const movMatch = movRegex.exec(line);
    if (movMatch && runningSaldo !== null) {
      const [, fechaStr, concepto, importeStr, saldoStr] = movMatch;
      const importe = toNumber(importeStr);
      const saldo = toNumber(saldoStr);
      const delta = saldo - runningSaldo;
      runningSaldo = saldo;

      if (delta > 0.01) {
        const [, dd, mm, yy] = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(fechaStr);
        const fecha = new Date(2000 + Number(yy), Number(mm) - 1, Number(dd));
        const mov = {
          cuenta: cuentaActual,
          descripcion: concepto,
          detalle: "",
          fecha,
          banco: "Supervielle",
          importe,
          nota: null,
        };
        out.push(mov);
        currentMov = mov;
      } else {
        currentMov = null;
      }
      continue;
    }

    // Línea de continuación (nombre del pagante + CUIT, "Ref:…") — se pega
    // al detalle del movimiento anterior si todavía estamos dentro de una
    // sección de movimientos y no es texto legal/de encabezado.
    if (currentMov && runningSaldo !== null && !ruidoRegex.test(line) && line.length < 200) {
      currentMov.detalle = currentMov.detalle ? `${currentMov.detalle} · ${line}` : line;
    }
  }

  return out;
}

// Identifica un movimiento bancario por CUIT, sea cual sea su tipo
// (transferencia, efectivo, cheque, otro) — el importe NO es una condición
// para dar el pago por identificado, es solo información de referencia que
// se muestra en pantalla. `clientesPorCuit` (Map cuit-solo-dígitos ->
// {uid, name, contabiliumId}) es el universo COMPLETO de clientes de
// Samurai, así que esto también cubre el caso de plata que entró pero
// todavía no se facturó nada (no hay cobranza en Contabilium todavía).
//
// Prioriza el CUIT marcado explícitamente por el banco ("DOCUMENTO: ...",
// más confiable) y si no hay, escanea el resto del texto por cualquier
// corrida de 11 dígitos que matchee a un cliente real — ese cruce contra el
// universo de clientes es lo que evita falsos positivos con números de
// cuenta o CBU que no son CUIT de nadie.
function matchMovimiento(mov, cobranzas, clientesPorCuit) {
  const texto = `${mov.descripcion || ""} ${mov.detalle || ""}`;
  const doc = extractDocumento(mov.detalle);
  const candidatos = doc ? [doc, ...findCuitsEnTexto(texto)] : findCuitsEnTexto(texto);

  let cuit = null;
  let cliente = null;
  for (const candidato of candidatos) {
    const match = clientesPorCuit?.get(candidato);
    if (match) {
      cuit = candidato;
      cliente = match;
      break;
    }
  }

  if (cliente) {
    // Bonus informativo: si además hay una cobranza sincronizada de este
    // mismo cliente con el mismo importe, la mostramos como referencia — pero
    // no es requisito para identificar el pago.
    const cobranza = cobranzas.find(
      (c) => onlyDigits(c.nroDocumento) === cuit && Math.round(Number(c.importeTotal || 0)) === Math.round(mov.importe)
    ) || null;
    return {
      status: "green",
      cobranza,
      cliente,
      reason: cobranza
        ? `${cliente.name} — CUIT identificado, coincide además con la cobranza Nº ${cobranza.numero}`
        : `${cliente.name} — identificado por CUIT`,
    };
  }

  if (doc || candidatos.length > 0) {
    return { status: "orange", cobranza: null, reason: "Hay un número de documento en el movimiento, pero no coincide con el CUIT de ningún cliente" };
  }

  if (classifyMovimiento(mov.descripcion, mov.detalle) === "cheque") {
    // Los echeq no suelen traer CUIT en el texto — solo el código de gestión
    // del banco. Como fallback, sugerimos por importe entre las cobranzas
    // cobradas en cheque, para que el usuario elija a mano.
    const sugeridas = cobranzas
      .filter((c) =>
        (c.formasDePago || []).some(
          (f) => /cheque|echeq/i.test(f.FormaDePago || "") && Math.round(Number(f.Importe || 0)) === Math.round(mov.importe)
        )
      )
      .sort((a, b) => {
        const fa = a.fecha ? daysBetween(new Date(a.fecha), mov.fecha) : Infinity;
        const fb = b.fecha ? daysBetween(new Date(b.fecha), mov.fecha) : Infinity;
        return fa - fb;
      })
      .slice(0, 5);
    return {
      status: "orange",
      cobranza: null,
      reason: "Echeq sin CUIT en el detalle — no viene esa info en el extracto",
      sugeridas,
    };
  }

  return { status: "orange", cobranza: null, reason: "No se encontró un CUIT en el movimiento que coincida con ningún cliente" };
}

// Clave estable por movimiento (fecha+importe+descripción) para saber si ya
// se generó un reporte de pago para esa fila puntual y no duplicarlo.
function movKey(mov) {
  return `${mov.fecha?.toISOString?.() || ""}|${mov.importe}|${mov.descripcion}`;
}

export default function ConciliacionBancaria({ cobranzas, bancoFiltro }) {
  const [movimientos, setMovimientos] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const [pickerAbierto, setPickerAbierto] = useState(null); // índice de la fila con el selector de cliente abierto
  const [clienteElegido, setClienteElegido] = useState("");
  const [reportando, setReportando] = useState(false);
  const [reportados, setReportados] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("samurai_conciliacion_reportados_v1") || "[]"));
    } catch {
      return new Set();
    }
  });
  const [clientesPorCuit, setClientesPorCuit] = useState(null);
  const [historialExtractos, setHistorialExtractos] = useState(null);
  const [extractoActivoId, setExtractoActivoId] = useState(null);
  const [cargandoExtracto, setCargandoExtracto] = useState(null);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  // Historial de extractos subidos por todo el equipo, compartido vía
  // Firestore (antes esto vivía solo en el localStorage de cada compu).
  useEffect(() => {
    const q = query(collection(db, EXTRACTOS_COLLECTION), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setHistorialExtractos(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            fileName: data.fileName,
            cantidad: data.cantidad ?? (data.movimientos || []).length,
            subidoPor: data.subidoPor || null,
            createdAt: data.createdAt?.toDate?.() || null,
          };
        })
      );
    });
    return unsub;
  }, []);

  async function abrirExtractoHistorial(id) {
    if (id === extractoActivoId) return;
    setCargandoExtracto(id);
    try {
      const snap = await getDoc(firestoreDoc(db, EXTRACTOS_COLLECTION, id));
      if (!snap.exists()) return;
      const data = snap.data();
      const parsed = (data.movimientos || []).map((m) => ({ ...m, fecha: new Date(m.fecha) }));
      setFileName(data.fileName);
      setMovimientos(parsed);
      setExtractoActivoId(id);
      saveMovimientos(data.fileName, parsed);
    } catch (e) {
      setError(e.message || "No se pudo abrir ese extracto");
    } finally {
      setCargandoExtracto(null);
    }
  }

  async function handleEliminarExtracto(e, id) {
    e.stopPropagation(); // no abrir el extracto al tocar el botón de borrar
    if (!confirm("¿Eliminar este extracto del historial? No se puede deshacer.")) return;
    try {
      await deleteDoc(firestoreDoc(db, EXTRACTOS_COLLECTION, id));
      if (id === extractoActivoId) {
        setMovimientos(null);
        setFileName("");
        setExtractoActivoId(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e2) {
      setError(e2.message || "No se pudo eliminar ese extracto");
    }
  }

  // Universo completo de clientes con CUIT cargado — se pide una sola vez al
  // montar, no depende de qué cobranzas haya sincronizadas.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "users"), where("kind", "==", "client")));
        const map = new Map();
        snap.forEach((d) => {
          const u = d.data();
          const cuit = onlyDigits(u.cuit);
          if (!cuit) return;
          map.set(cuit, { uid: d.id, name: u.contabiliumDepositoNombre || u.name || "(sin nombre)", contabiliumId: u.contabiliumId || null });
        });
        setClientesPorCuit(map);
      } catch {
        setClientesPorCuit(new Map());
      }
    })();
  }, []);

  // Clientes distintos que aparecen en las cobranzas ya sincronizadas — sirve
  // como universo para elegir a mano a quién pertenece un movimiento que no
  // se pudo matchear solo.
  const clientesDisponibles = useMemo(() => {
    const map = new Map();
    for (const c of cobranzas || []) {
      if (c.idPersona == null) continue;
      if (!map.has(c.idPersona)) map.set(c.idPersona, { idPersona: c.idPersona, razonSocial: c.razonSocial, nroDocumento: c.nroDocumento });
    }
    return Array.from(map.values()).sort((a, b) => (a.razonSocial || "").localeCompare(b.razonSocial || ""));
  }, [cobranzas]);

  function marcarReportado(key) {
    setReportados((prev) => {
      const next = new Set(prev).add(key);
      localStorage.setItem("samurai_conciliacion_reportados_v1", JSON.stringify([...next]));
      return next;
    });
  }

  async function handleReportar(mov, idPersona) {
    const cliente = clientesDisponibles.find((c) => c.idPersona === idPersona);
    if (!cliente) return;
    setReportando(true);
    try {
      await addDoc(collection(db, "pagosReportados"), {
        distributorUid: null,
        distributorName: cliente.razonSocial || "",
        contabiliumId: cliente.idPersona,
        monto: mov.importe,
        fecha: mov.fecha.toISOString().slice(0, 10),
        nota: `Movimiento bancario: ${mov.descripcion || ""} ${mov.detalle || ""}`.trim(),
        comprobanteUrl: null,
        estado: "pendiente",
        source: "conciliacion_bancaria",
        cargadoPor: auth.currentUser?.email || null,
        createdAt: serverTimestamp(),
      });
      marcarReportado(movKey(mov));
      setPickerAbierto(null);
      setClienteElegido("");
    } catch (e) {
      alert(e.message || "No se pudo reportar el pago.");
    } finally {
      setReportando(false);
    }
  }

  // Al montar, recupera el último extracto subido (persiste entre recargas).
  useEffect(() => {
    const saved = loadMovimientos();
    if (saved) {
      setFileName(saved.fileName);
      setMovimientos(saved.movimientos);
    }
  }, []);

  async function handleFile(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError("");
    try {
      let todos = [];
      let huboFilasSinColumnas = false;
      let huboArchivoVacio = false;

      for (const file of files) {
        if (/\.pdf$/i.test(file.name)) {
          const lines = await extractPdfLines(file);
          const parsed = parseSupervielleTexto(lines);
          if (parsed.length === 0) huboArchivoVacio = true;
          todos = todos.concat(parsed);
        } else {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array", cellDates: true });
          const { movimientos: parsed, filasDeDatos, columnasReconocidas } = parseIngresosSheet(wb);
          if (filasDeDatos > 0 && !columnasReconocidas) huboFilasSinColumnas = true;
          else if (filasDeDatos > 0 && parsed.length === 0) huboArchivoVacio = true;
          todos = todos.concat(parsed);
        }
      }

      if (huboFilasSinColumnas) {
        setError(
          `⚠️ No reconocí las columnas de alguno de estos archivos (no encontré "Fecha" y "Importe"/"Crédito" en el encabezado). El formato de este banco todavía no está soportado — mandale el archivo a soporte para agregarlo antes de dar por hecho que no hay pagos.`
        );
      } else if (huboArchivoVacio) {
        setError(
          `⚠️ Se reconoció el formato pero no se encontró ningún ingreso en alguno de estos archivos. Revisá que el extracto tenga el rango de fechas correcto antes de asumir que no hubo pagos.`
        );
      }

      const nombre = files.length === 1 ? files[0].name : `${files.length} archivos (${files[0].name}, …)`;
      setFileName(nombre);
      setMovimientos(todos);
      saveMovimientos(nombre, todos);
      const id = await guardarExtractoEnFirestore(nombre, todos);
      setExtractoActivoId(id);
    } catch (err) {
      setError(err.message || "No se pudo leer el archivo");
      setMovimientos(null);
    }
  }

  function handleClear() {
    localStorage.removeItem(STORAGE_KEY);
    setMovimientos(null);
    setFileName("");
    setExtractoActivoId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Recalcula los matches contra las cobranzas actuales (por si sincronizaste
  // cobranzas nuevas después de subir el extracto).
  const rows = useMemo(() => {
    if (!movimientos) return null;
    // Cuando esta pantalla vive dentro de una pestaña por banco (Galicia,
    // Supervielle, Santander), solo interesan los movimientos de ESE banco —
    // el extracto compartido guarda todos juntos, se filtra acá al mostrar.
    const filtrados = bancoFiltro
      ? movimientos.filter((m) => (m.banco || "").toLowerCase().includes(bancoFiltro.toLowerCase()))
      : movimientos;
    return filtrados.map((mov) => ({ ...mov, ...matchMovimiento(mov, cobranzas || [], clientesPorCuit) }));
  }, [movimientos, cobranzas, clientesPorCuit, bancoFiltro]);

  const summary = useMemo(() => {
    if (!rows) return null;
    const green = rows.filter((r) => r.status === "green").length;
    const sinFacturar = rows.filter((r) => r.status === "green" && !r.cobranza).length;
    const orange = rows.length - green;
    return { green, orange, sinFacturar, total: rows.length };
  }, [rows]);

  // Movimientos donde SÍ identificamos al pagante por CUIT pero todavía no
  // hay ninguna cobranza/factura en Contabilium con ese importe — alerta
  // para los casos que no pasan por el sistema (no reportan la venta, no
  // suben comprobante): avisa a facturar y hacer el recibo.
  const pagosSinFacturar = useMemo(() => (rows || []).filter((r) => r.status === "green" && !r.cobranza), [rows]);

  // Cobranzas que YA están sincronizadas (no es un movimiento bancario suelto
  // sin cargar) pero nunca quedaron aplicadas contra ninguna factura — plata
  // "a cuenta" que quedó suelta. Se excluyen las que son 100% "Saldo a favor"
  // (esas ya se excluyen del saldo por diseño, no son un pago real nuevo).
  const cobranzasSinImputar = useMemo(() => {
    return (cobranzas || [])
      .filter((c) => {
        const detalle = c.detalle || [];
        if (detalle.length > 0) return false;
        const formas = c.formasDePago || [];
        const esSoloSaldoAFavor = formas.length > 0 && formas.every((f) => f.FormaDePago === "Saldo a favor");
        return !esSoloSaldoAFavor;
      })
      .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  }, [cobranzas]);

  return (
    <div className="space-y-4">
      {pagosSinFacturar.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/20">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-400">
            💰 {pagosSinFacturar.length} pago(s) detectado(s) en el banco que todavía no tienen factura/cobranza en Contabilium
          </p>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-400/80">
            Identificamos de quién es por el CUIT del pagante en la transferencia — hay que facturar y hacer el recibo.
          </p>
          <ul className="mt-3 space-y-2">
            {pagosSinFacturar.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm dark:bg-neutral-900">
                <div className="min-w-0">
                  <Link
                    to={`/admin/clientes-360?buscar=${encodeURIComponent(r.cliente.name)}`}
                    className="font-semibold text-sky-700 hover:underline dark:text-sky-400"
                  >
                    {r.cliente.name}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400 dark:text-neutral-500">
                    {r.banco} · {r.fecha.toLocaleDateString("es-AR")}
                  </span>
                </div>
                <span className="shrink-0 font-semibold text-slate-900 dark:text-white">{money(r.importe)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cobranzasSinImputar.length > 0 && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/20">
          <p className="text-sm font-semibold text-orange-900 dark:text-orange-400">
            🟠 {cobranzasSinImputar.length} cobranza(s) sincronizada(s) sin aplicar a ninguna factura
          </p>
          <p className="mt-1 text-xs text-orange-700 dark:text-orange-400/80">
            Ya están cargadas en el sistema (no son un movimiento bancario suelto) pero quedaron como saldo a cuenta sin imputar a una factura puntual.
          </p>
          <div className="mt-3 space-y-1.5">
            {cobranzasSinImputar.map((c) => (
              <div
                key={c.contabiliumId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-100 bg-white px-3 py-2 text-xs dark:border-orange-900/50 dark:bg-neutral-900"
              >
                <div className="min-w-0">
                  <Link
                    to={`/admin/clientes-360?buscar=${encodeURIComponent(c.razonSocial || "")}`}
                    className="font-semibold text-sky-700 hover:underline dark:text-sky-400"
                  >
                    {c.razonSocial || "(sin nombre)"}
                  </Link>
                  <span className="ml-2 text-slate-400 dark:text-neutral-500">
                    Nº {c.numero} · {c.fecha ? new Date(c.fecha).toLocaleDateString("es-AR") : "sin fecha"}
                  </span>
                </div>
                <span className="shrink-0 font-semibold text-slate-900 dark:text-white">{money(c.importeReal ?? c.importeTotal)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Subir extracto bancario</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
          Excel con la hoja "Ingresos" (Cuenta, Descripción, Detalle, Fecha, Banco, Importe), o PDF del resumen de cuenta de Supervielle — podés seleccionar varios a la vez.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.pdf"
            multiple
            onChange={handleFile}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800 dark:text-neutral-400 dark:file:bg-neutral-800 dark:hover:file:bg-neutral-700 sm:w-auto"
          />
          {fileName && <span className="max-w-full truncate text-xs text-slate-500 dark:text-neutral-400">{fileName}</span>}
          {movimientos && (
            <button
              onClick={handleClear}
              className="text-xs font-medium text-rose-600 transition hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
            >
              Quitar archivo
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <button
          onClick={() => setMostrarHistorial((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            🗓️ Historial de extractos subidos {historialExtractos ? `(${historialExtractos.length})` : ""}
          </span>
          <span className="text-slate-400">{mostrarHistorial ? "▲" : "▼"}</span>
        </button>
        {mostrarHistorial && (
          <div className="space-y-1.5 border-t border-slate-100 p-4 dark:border-neutral-800">
            {historialExtractos === null && <p className="text-xs text-slate-400 dark:text-neutral-500">Cargando…</p>}
            {historialExtractos?.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-neutral-500">Todavía no se subió ningún extracto.</p>
            )}
            {historialExtractos?.map((h) => {
              const activo = h.id === extractoActivoId;
              return (
                <div
                  key={h.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => abrirExtractoHistorial(h.id)}
                  onKeyDown={(e) => e.key === "Enter" && abrirExtractoHistorial(h.id)}
                  className={`flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${
                    activo
                      ? "border-sky-400 bg-sky-50 dark:border-sky-500 dark:bg-sky-950/30"
                      : "border-slate-200 bg-white hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-sky-700"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-slate-900 dark:text-white">{formatFechaHora(h.createdAt)}</span>
                    <span className="ml-2 text-slate-500 dark:text-neutral-400">{h.fileName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-slate-400 dark:text-neutral-500">
                    {cargandoExtracto === h.id ? "Abriendo…" : activo ? "✓ Viendo este" : `${h.cantidad} movimiento(s)`}
                    {h.subidoPor ? ` · ${h.subidoPor}` : ""}
                    <button
                      onClick={(e) => handleEliminarExtracto(e, h.id)}
                      title="Eliminar este extracto del historial"
                      className="rounded-lg border border-rose-200 bg-white px-1.5 py-1 text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-neutral-900 dark:hover:bg-rose-500/10"
                    >
                      🗑
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {summary && (
        <div className="flex flex-wrap gap-3">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
            🟢 {summary.green} imputado{summary.green === 1 ? "" : "s"}
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
            🟠 {summary.orange} sin comprobante / falta info
          </div>
          {summary.sinFacturar > 0 && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
              💰 {summary.sinFacturar} pago(s) identificado(s) sin facturar
            </div>
          )}
        </div>
      )}

      {rows && (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className={`rounded-2xl border p-3 ${
                r.status === "green"
                  ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                  : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{r.descripcion}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-neutral-400">{r.detalle}</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                    {r.fecha?.toLocaleDateString("es-AR")} · {r.banco}
                  </p>
                </div>
                <p className="shrink-0 font-semibold text-slate-900 dark:text-white">{money(r.importe)}</p>
              </div>
              <p
                className={`mt-2 text-xs font-medium ${
                  r.status === "green" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {r.status === "green" ? "✅ " : "⚠️ "}
                {r.reason}
                {r.cobranza ? ` — ${r.cobranza.razonSocial} (Nº ${r.cobranza.numero})` : ""}
              </p>
              {r.sugeridas && (
                <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                  {r.sugeridas.length > 0
                    ? `Posibles cobranzas por importe: ${r.sugeridas
                        .map((c) => `${c.razonSocial} (Nº ${c.numero}, ${c.fecha ? new Date(c.fecha).toLocaleDateString("es-AR") : "sin fecha"})`)
                        .join(" · ")}`
                    : "Ninguna cobranza sincronizada tiene ese importe exacto en un cheque."}
                </p>
              )}

              {reportados.has(movKey(r)) ? (
                <p className="mt-2 text-xs font-medium text-sky-700 dark:text-sky-400">
                  🔗 Ya se reportó como pago pendiente para revisar en Clientes 360
                </p>
              ) : pickerAbierto === i ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
                  <select
                    value={clienteElegido}
                    onChange={(e) => setClienteElegido(e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                  >
                    <option value="">— Elegir cliente —</option>
                    {clientesDisponibles.map((c) => (
                      <option key={c.idPersona} value={c.idPersona}>
                        {c.razonSocial} ({c.nroDocumento})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleReportar(r, Number(clienteElegido))}
                    disabled={!clienteElegido || reportando}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {reportando ? "Guardando…" : "Reportar a este cliente"}
                  </button>
                  <button
                    onClick={() => { setPickerAbierto(null); setClienteElegido(""); }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setPickerAbierto(i);
                    const primeraSugerida = r.cobranza?.idPersona || (r.sugeridas && r.sugeridas[0]?.idPersona) || "";
                    setClienteElegido(primeraSugerida ? String(primeraSugerida) : "");
                  }}
                  className="mt-2 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  🔗 Vincular a un cliente
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
