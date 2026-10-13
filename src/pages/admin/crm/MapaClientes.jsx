import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../auth/AuthContext";
import {
  getClientesConUbicacion,
  subscribeClientesReportDetail,
  exportarMapaClientes,
  exportarGuionLlamadas,
  adminGetClientComprobantes,
  adminImportarSituacionesClientes,
} from "../../../services/comprobantes";
import { ensureSheetJs } from "../../../utils/sheetjs";
import { subscribeCobranzas } from "../../../services/cobranzas";
import { ClienteDetalle } from "../Clientes360";
import { loadGoogleMaps } from "../../../utils/loadGoogleMaps";
import RutaPanel from "../../../components/mapa/RutaPanel";
import { subscribeSituacionesClientes, setSituacionCliente, SITUACION_OPCIONES } from "../../../services/situacionClientes";
import { subscribeCustomerTypes } from "../../../services/customerTypes";

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

const COLOR_CONSIGNADO = "#059669"; // emerald-600
const COLOR_COMPRADOR = "#0284c7"; // sky-600

const FILTROS = [
  { key: "todos", label: "Todos" },
  { key: "consignados", label: "🟢 Consignados" },
  { key: "compradores", label: "🔵 Compradores (sin depósito)" },
  { key: "vencido", label: "🔴 Video vencido" },
  { key: "sinVideo", label: "Sin video" },
];

function normalizarTelefonoWhatsapp(raw) {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  d = d.replace(/^15/, "");
  if (!d.startsWith("54")) d = "549" + d;
  else if (!d.startsWith("549")) d = "549" + d.slice(2);
  return d;
}

const VIDEO_BADGE = {
  "al dia": { label: "✅ Al día", cls: "text-emerald-700 dark:text-emerald-400" },
  "por vencer": { label: "🟡 Por vencer", cls: "text-amber-700 dark:text-amber-400" },
  vencido: { label: "🔴 Vencido", cls: "text-rose-700 dark:text-rose-400" },
  "sin video": { label: "⚪ Sin video", cls: "text-slate-500 dark:text-neutral-400" },
};

// Ícono circular armado a mano (SVG con halo + relleno), del mismo estilo
// que tenía el mapa anterior — tamaño fijo en pixeles sea cual sea el zoom,
// como hacía MapLibre con circle-radius.
function markerIcon(color, radio, anillo) {
  const r = Math.max(6, radio);
  const size = r * 2 + 8;
  const c = size / 2;
  // Si el punto tiene clientes con situación marcada, se dibuja un anillo
  // de ese color alrededor — así se ve de un vistazo sin tener que hacer
  // clic en cada punto del mapa.
  const anilloSvg = anillo
    ? `<circle cx="${c}" cy="${c}" r="${r + 2.5}" fill="none" stroke="${anillo}" stroke-width="3" />`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${c}" cy="${c}" r="${r + 4}" fill="${color}" opacity="0.22" />
    <circle cx="${c}" cy="${c}" r="${r}" fill="${color}" fill-opacity="0.92" stroke="#ffffff" stroke-width="2" />
    ${anilloSvg}
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: size, height: size },
    anchor: { x: c, y: c },
  };
}

const SITUACION_HEX = { vencido: "#a855f7", rojo: "#ef4444", naranja: "#f97316", amarillo: "#eab308", verde: "#22c55e" };
const SITUACION_PRIORIDAD = ["vencido", "rojo", "naranja", "amarillo", "verde"];

// De un grupo de clientes, la situación "más urgente" marcada entre ellos
// (si hay uno rojo, prima sobre que haya otros verdes) — para pintar el
// anillo del punto en el mapa.
function peorSituacionColor(clientes, situaciones) {
  let peor = null;
  for (const c of clientes) {
    const s = c.contabiliumId != null ? situaciones.get(String(c.contabiliumId)) : null;
    if (!s) continue;
    if (peor === null || SITUACION_PRIORIDAD.indexOf(s.color) < SITUACION_PRIORIDAD.indexOf(peor)) {
      peor = s.color;
    }
  }
  return peor ? SITUACION_HEX[peor] : null;
}

function fmtDistancia(metros) {
  if (metros >= 1000) return `${(metros / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} km`;
  return `${Math.round(metros)} m`;
}

function fmtDuracion(segundos) {
  const totalMin = Math.round(segundos / 60);
  const hs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hs > 0) return `${hs} h ${min} min`;
  return `${min} min`;
}

export default function MapaClientes({ crm }) {
  const { profile, user } = useAuth();
  const esChofer = profile?.role === "chofer";
  const containerRef = useRef(null);
  const [mapaAmpliado, setMapaAmpliado] = useState(false);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const directionsRendererRef = useRef(null);
  const gruposRef = useRef(new Map()); // groupKey -> array de clientes (para el click)
  const watchIdRef = useRef(null);
  const miMarkerRef = useRef(null);
  const ultimoCalculoRef = useRef(0);
  const [mapListo, setMapListo] = useState(false);
  const [mapError, setMapError] = useState("");
  const [ubicaciones, setUbicaciones] = useState(null); // Map contabiliumId -> {lat, lon, ciudad, provincia}
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [busquedaNombre, setBusquedaNombre] = useState("");
  const [mostrarResultadosBusqueda, setMostrarResultadosBusqueda] = useState(false);
  const [provinciaElegida, setProvinciaElegida] = useState("");
  const [seleccion, setSeleccion] = useState(null); // { ciudad, provincia, clientes }
  // Saldo en vivo (contra Contabilium) de los clientes que se ven en el
  // panel del mapa — el "Debe $X" de reporteFilaPorUid viene de una
  // instantánea que se recalcula sola una vez por día, así que después de
  // cobrarle a alguien puede seguir marcando la deuda vieja hasta el otro
  // día. Acá, al abrir el panel de una localidad, se pide el saldo real de
  // cada cliente (son pocos por marcador) y se pisa el valor cacheado.
  const [saldosLive, setSaldosLive] = useState({}); // uid -> { saldoDeudor, saldoAFavor } | "cargando" | "error"
  const [detalleUid, setDetalleUid] = useState(null); // uid del cliente cuyo "cuadro" de Clientes 360 está abierto
  const [detalleUserDoc, setDetalleUserDoc] = useState(null);
  const [cobranzas, setCobranzas] = useState([]);
  const [reporteDetail, setReporteDetail] = useState(null);
  const [customerTypes, setCustomerTypes] = useState([]);
  const [situaciones, setSituaciones] = useState(new Map()); // contabiliumId (string) -> SituacionCliente
  // Calendario de seguimiento: qué clientes se fueron marcando con color
  // cada día (mientras se los va llamando desde el mapa), para poder
  // repasar "a quién llamé hoy" o revisar un día anterior.
  const [mesCalendario, setMesCalendario] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [diaSeleccionado, setDiaSeleccionado] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [guardandoSituacion, setGuardandoSituacion] = useState(null); // contabiliumId en curso
  const [exportando, setExportando] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportandoGuion, setExportandoGuion] = useState(false);
  const [importando, setImportando] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const importInputRef = useRef(null);

  // Quita el emoji (🟢/🟡/🟠/🔴/🟣) del texto de "Situación" tal como lo
  // deja el propio export (exportarMapaClientes) — nos quedamos con la
  // etiqueta en texto para guardarla en situacionClientes.etiqueta.
  function limpiarEtiquetaSituacion(s) {
    return (s || "").replace(/^[^\w\sÁÉÍÓÚÑáéíóúñ(]+\s*/u, "").trim();
  }

  async function handleImportarArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportando(true);
    setImportError("");
    setImportResult(null);
    try {
      const XLSX = await ensureSheetJs();
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames.find((n) => /consignad/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });

      const filas = rows
        .filter((r) => r["CUIT"] || r["Nombre"])
        .map((r) => {
          const situacionRaw = r["Situación"];
          const esSinMarcar = !situacionRaw || /sin marcar/i.test(situacionRaw);
          return {
            nombreExcel: r["Nombre"] || "",
            cuit: r["CUIT"] || "",
            situacionEtiqueta: esSinMarcar ? "" : limpiarEtiquetaSituacion(situacionRaw),
            color: r["Color"] ? String(r["Color"]).trim().toLowerCase() : "",
            llamado: r["Llamado"] === "Sí" || r["Llamado"] === "Si",
            nota: r["Nota"] || "",
            marcadoPor: r["Marcado por"] || "",
            notaExtra: r["__EMPTY"] || "",
          };
        });

      if (!filas.length) throw new Error(`No se encontraron filas con CUIT/Nombre en la hoja "${sheetName}"`);

      const resultado = await adminImportarSituacionesClientes(filas);
      setImportResult(resultado);
    } catch (e) {
      setImportError(e.message || "No se pudo importar el Excel");
    } finally {
      setImportando(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function descargarBase64Excel(base64, filename) {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "clientes.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportar() {
    setExportando(true);
    setExportError("");
    try {
      const { base64, filename } = await exportarMapaClientes(provinciaElegida || undefined);
      descargarBase64Excel(base64, filename);
    } catch (e) {
      setExportError(e.message || "No se pudo exportar");
    } finally {
      setExportando(false);
    }
  }

  async function handleExportarGuion() {
    setExportandoGuion(true);
    setExportError("");
    try {
      const { guion, porZona } = await exportarGuionLlamadas();
      const { generateGuionLlamadasPdf } = await import("../../../utils/generateGuionLlamadasPdf");
      generateGuionLlamadasPdf(guion, porZona, {
        fileName: `Guion de llamadas ${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch (e) {
      setExportError(e.message || "No se pudo generar el guion de llamadas");
    } finally {
      setExportandoGuion(false);
    }
  }

  // Planificación de ruta: paradas elegidas a mano desde la lista de
  // clientes de cada localidad — el primer agregado es el origen, el
  // último el destino, y Directions API optimiza el orden del resto.
  const [modoRuta, setModoRuta] = useState(false);
  const [origenInput, setOrigenInput] = useState("");
  const [origenPunto, setOrigenPunto] = useState(null); // { label, lat, lon }
  const [origenEnVivo, setOrigenEnVivo] = useState(false); // true = se actualiza solo con el GPS
  const [buscandoOrigen, setBuscandoOrigen] = useState(false);
  const [origenError, setOrigenError] = useState("");
  const [rutaStops, setRutaStops] = useState([]); // [{id, nombre, lat, lon, direccion}]
  const [rutaResultado, setRutaResultado] = useState(null); // { distanciaTotal, duracionTotal, orden: [c.id,...] }
  const [calculandoRuta, setCalculandoRuta] = useState(false);
  const [rutaError, setRutaError] = useState("");

  // Mismas fuentes que usa Clientes 360 para armar el "cliente" que le pasa a
  // ClienteDetalle — así el cuadro que se abre acá es exactamente el mismo,
  // sin navegar a otra pantalla.
  useEffect(() => {
    const unsubCobranzas = subscribeCobranzas(setCobranzas, () => setCobranzas([]));
    const unsubReporte = subscribeClientesReportDetail(setReporteDetail);
    const unsubCustomerTypes = subscribeCustomerTypes(setCustomerTypes, () => setCustomerTypes([]));
    return () => {
      unsubCobranzas();
      unsubReporte();
      unsubCustomerTypes();
    };
  }, []);

  // Datos "profundos" por cliente para la lista del mapa — estado de cuenta
  // corriente, fecha del último pedido y perfil comercial — a partir de las
  // mismas fuentes que ya usa el resto del CRM (nada de pegarle de nuevo a
  // Contabilium acá).
  const reporteFilaPorUid = useMemo(() => {
    const map = new Map();
    for (const r of reporteDetail?.rows || []) map.set(r.uid, r);
    return map;
  }, [reporteDetail]);
  const customerTypeTituloPorId = useMemo(() => {
    const map = new Map();
    for (const t of customerTypes) map.set(t.id, t.title);
    return map;
  }, [customerTypes]);

  useEffect(() => {
    return subscribeSituacionesClientes(setSituaciones);
  }, []);

  useEffect(() => {
    if (!seleccion?.clientes?.length) return;
    let cancelled = false;
    for (const c of seleccion.clientes) {
      if (!c.uid || !c.contabiliumId) continue;
      if (saldosLive[c.uid]) continue; // ya lo tenemos (o ya está cargando)
      setSaldosLive((prev) => ({ ...prev, [c.uid]: "cargando" }));
      adminGetClientComprobantes(c.contabiliumId)
        .then((r) => {
          if (cancelled) return;
          const saldo = Number(r.saldoTotal || 0);
          setSaldosLive((prev) => ({
            ...prev,
            [c.uid]: { saldoDeudor: saldo > 0 ? saldo : 0, saldoAFavor: saldo < 0 ? -saldo : 0 },
          }));
        })
        .catch(() => {
          if (!cancelled) setSaldosLive((prev) => ({ ...prev, [c.uid]: "error" }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccion]);

  const nombrePorContabiliumId = useMemo(() => {
    const map = new Map();
    for (const c of crm.clientes || []) {
      if (c.contabiliumId != null) map.set(String(c.contabiliumId), c.nombre);
    }
    return map;
  }, [crm.clientes]);

  // Agrupa las situaciones marcadas por día (clave YYYY-MM-DD en hora
  // local) para el calendario. OJO: cada cliente guarda una sola situación
  // vigente (se pisa con la última que se cargó) — si a alguien lo vuelven
  // a marcar más adelante, el día anterior deja de mostrarlo. Para "hoy" y
  // días recientes esto funciona bien igual, que es el uso real.
  const situacionesPorDia = useMemo(() => {
    const porDia = new Map();
    for (const [contabiliumId, s] of situaciones) {
      if (!s.updatedAt) continue;
      const d = s.updatedAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!porDia.has(key)) porDia.set(key, []);
      porDia.get(key).push({
        contabiliumId,
        nombre: nombrePorContabiliumId.get(contabiliumId) || `Cliente ${contabiliumId}`,
        ...s,
      });
    }
    for (const lista of porDia.values()) {
      lista.sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
    }
    return porDia;
  }, [situaciones, nombrePorContabiliumId]);

  const diasDelMes = useMemo(() => {
    const año = mesCalendario.getFullYear();
    const mes = mesCalendario.getMonth();
    const primerDia = new Date(año, mes, 1);
    // Lunes = 0 ... Domingo = 6, para que el calendario arranque en lunes.
    const offset = (primerDia.getDay() + 6) % 7;
    const totalDias = new Date(año, mes + 1, 0).getDate();
    const celdas = [];
    for (let i = 0; i < offset; i++) celdas.push(null);
    for (let dia = 1; dia <= totalDias; dia++) {
      const key = `${año}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      celdas.push({ dia, key });
    }
    return celdas;
  }, [mesCalendario]);

  const marcasDelDiaSeleccionado = situacionesPorDia.get(diaSeleccionado) || [];

  async function marcarSituacion(c, cambios) {
    setGuardandoSituacion(c.contabiliumId);
    try {
      const actual = situaciones.get(String(c.contabiliumId));
      await setSituacionCliente(c.contabiliumId, {
        color: cambios.color ?? actual?.color ?? "amarillo",
        etiqueta: cambios.etiqueta ?? actual?.etiqueta ?? "",
        nota: cambios.nota ?? actual?.nota ?? "",
        llamado: cambios.llamado ?? actual?.llamado ?? false,
        updatedByNombre: profile?.name || profile?.username || user?.email || "",
      });
    } catch (e) {
      console.error("[MapaClientes] error guardando situación:", e);
    } finally {
      setGuardandoSituacion(null);
    }
  }

  useEffect(() => {
    if (!detalleUid) {
      setDetalleUserDoc(null);
      return;
    }
    const unsub = onSnapshot(doc(db, "users", detalleUid), (snap) => {
      setDetalleUserDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return unsub;
  }, [detalleUid]);

  const clienteDetalle = useMemo(() => {
    if (!detalleUserDoc) return null;
    const cuitDigits = onlyDigits(detalleUserDoc.cuit);
    const pagado = (cobranzas || [])
      .filter((c) => onlyDigits(c.nroDocumento) === cuitDigits)
      .reduce((acc, c) => acc + Number(c.importeReal ?? c.importeTotal ?? 0), 0);
    const cobranzasList = (cobranzas || [])
      .filter((c) => onlyDigits(c.nroDocumento) === cuitDigits)
      .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    const reporteRow = (reporteDetail?.rows || []).find((r) => r.uid === detalleUserDoc.id);
    return {
      ...detalleUserDoc,
      pagado,
      cobranzasList,
      linked: !!detalleUserDoc.contabiliumId,
      saldoDeudor: reporteRow?.saldoDeudor || 0,
      saldoAFavor: reporteRow?.saldoAFavor || 0,
    };
  }, [detalleUserDoc, cobranzas, reporteDetail]);

  useEffect(() => {
    let cancelled = false;
    getClientesConUbicacion()
      .then(({ items }) => {
        if (cancelled) return;
        const map = new Map();
        for (const it of items) map.set(it.contabiliumId, it);
        setUbicaciones(map);
      })
      .catch((e) => setError(e.message || "No se pudo cargar la ubicación de los clientes"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Inicializa el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    loadGoogleMaps()
      .then((gmaps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = new gmaps.Map(containerRef.current, {
          center: { lat: -38, lng: -64 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          // El fullscreen nativo del navegador solo agranda el <div> del
          // mapa y deja afuera de la pantalla al panel lateral con la info
          // del cliente (queda "interactivo" pero invisible) — por eso se
          // desactiva acá y se reemplaza por un modo "ampliar" propio (ver
          // mapaAmpliado más abajo) que mantiene mapa + panel juntos.
          fullscreenControl: false,
          // Por defecto ("cooperative") el trackpad necesita Ctrl+scroll
          // para hacer zoom, porque el mapa está dentro de una página que
          // se puede scrollear y Google evita "robarse" el scroll de la
          // página. Con "greedy" el gesto de pellizcar/dos dedos del
          // trackpad hace zoom directo, sin Ctrl — el precio es que ya no
          // se puede scrollear la página arrastrando arriba del mapa, pero
          // es el comportamiento esperado para un mapa que se usa de verdad.
          gestureHandling: "greedy",
        });
        // Encuadra Argentina entera (no un centro/zoom fijo a ojo) — así se ve
        // bien sea cual sea el tamaño del panel del mapa.
        const bounds = new gmaps.LatLngBounds(
          { lat: -55.1, lng: -73.6 },
          { lat: -21.5, lng: -53.6 }
        );
        map.fitBounds(bounds, 30);
        directionsRendererRef.current = new gmaps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          polylineOptions: { strokeColor: "#dc2626", strokeWeight: 4 },
        });
        mapRef.current = map;
        setMapListo(true);
      })
      .catch((e) => {
        console.error("[MapaClientes] error cargando Google Maps:", e);
        setMapError(e.message || "No se pudo cargar el mapa");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clientesConUbicacion = useMemo(() => {
    if (!ubicaciones) return [];
    return (crm.clientes || [])
      .filter((c) => c.tipo === "Samurai" && c.contabiliumId != null)
      .map((c) => {
        const ub = ubicaciones.get(c.contabiliumId);
        if (!ub || ub.lat == null) return null;
        const tieneDeposito = !!c.videoEstado && c.videoEstado !== "no aplica";
        return {
          ...c,
          lat: ub.lat,
          lon: ub.lon,
          ciudad: ub.ciudad,
          provincia: ub.provincia,
          direccion: ub.direccion || "",
          cp: ub.cp || "",
          ubicacionPrecisa: !!ub.ubicacionPrecisa,
          tieneDeposito,
        };
      })
      .filter(Boolean);
  }, [crm.clientes, ubicaciones]);

  // Buscador por nombre — independiente de los filtros de color/provincia,
  // para encontrar un cliente puntual rápido y saltar directo a su punto
  // en el mapa, sin tener que andar mirando el mapa entero.
  const resultadosBusqueda = useMemo(() => {
    const q = busquedaNombre.trim().toLowerCase();
    if (q.length < 2) return [];
    return clientesConUbicacion.filter((c) => (c.nombre || "").toLowerCase().includes(q)).slice(0, 8);
  }, [busquedaNombre, clientesConUbicacion]);

  function irAUbicacionDeCliente(c) {
    setBusquedaNombre("");
    setMostrarResultadosBusqueda(false);
    setSeleccion({
      ciudad: c.ciudad,
      provincia: c.provincia,
      clientes: [c],
      tipo: c.tieneDeposito ? "consignados" : "compradores",
    });
    if (mapRef.current && window.google?.maps) {
      mapRef.current.panTo({ lat: c.lat, lng: c.lon });
      if (mapRef.current.getZoom() < 13) mapRef.current.setZoom(13);
    }
  }

  const totalSinUbicar = useMemo(() => {
    if (!ubicaciones) return 0;
    return (crm.clientes || []).filter((c) => c.tipo === "Samurai" && c.contabiliumId != null).length - clientesConUbicacion.length;
  }, [crm.clientes, ubicaciones, clientesConUbicacion]);

  const totalAproximados = useMemo(
    () => clientesConUbicacion.filter((c) => !c.ubicacionPrecisa).length,
    [clientesConUbicacion]
  );

  const provinciasDisponibles = useMemo(() => {
    const set = new Set();
    for (const c of clientesConUbicacion) {
      if (c.provincia) set.add(c.provincia);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [clientesConUbicacion]);

  const clientesFiltrados = useMemo(() => {
    return clientesConUbicacion.filter((c) => {
      if (provinciaElegida && c.provincia !== provinciaElegida) return false;
      switch (filtro) {
        case "consignados": return c.tieneDeposito;
        case "compradores": return !c.tieneDeposito;
        case "vencido": return c.videoEstado === "vencido";
        case "sinVideo": return c.videoEstado === "sin video";
        default: return true;
      }
    });
  }, [clientesConUbicacion, filtro, provinciaElegida]);

  // Agrupa por localidad (redondeando coordenadas: varios clientes en la
  // misma ciudad comparten el mismo centroide geocodificado) y separa
  // consignados/compradores en dos grupos, para comparar de un vistazo qué
  // proporción de cada ciudad tiene depósito.
  const grupos = useMemo(() => {
    const porLocalidad = new Map();
    for (const c of clientesFiltrados) {
      const key = `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
      if (!porLocalidad.has(key)) {
        porLocalidad.set(key, { lat: c.lat, lon: c.lon, ciudad: c.ciudad, provincia: c.provincia, consignados: [], compradores: [] });
      }
      const g = porLocalidad.get(key);
      (c.tieneDeposito ? g.consignados : g.compradores).push(c);
    }

    gruposRef.current = new Map();
    const puntos = [];
    const radioPor = (n) => Math.min(6 + Math.sqrt(n) * 4, 30);
    // Separación fija en grados entre los dos puntos de una misma ciudad
    // cuando hay consignados Y compradores, para que no queden pisados.
    const OFFSET_GRADOS = 0.09;

    for (const [key, g] of porLocalidad) {
      const dLon = OFFSET_GRADOS / Math.cos((g.lat * Math.PI) / 180);

      if (g.consignados.length > 0) {
        const groupKey = `${key}|consignados`;
        const grupo = { ciudad: g.ciudad, provincia: g.provincia, clientes: g.consignados, tipo: "consignados" };
        gruposRef.current.set(groupKey, grupo);
        puntos.push({
          groupKey,
          grupo,
          color: COLOR_CONSIGNADO,
          anillo: peorSituacionColor(g.consignados, situaciones),
          radio: radioPor(g.consignados.length),
          lat: g.lat,
          lon: g.lon - (g.compradores.length ? dLon : 0),
        });
      }
      if (g.compradores.length > 0) {
        const groupKey = `${key}|compradores`;
        const grupo = { ciudad: g.ciudad, provincia: g.provincia, clientes: g.compradores, tipo: "compradores" };
        gruposRef.current.set(groupKey, grupo);
        puntos.push({
          groupKey,
          grupo,
          color: COLOR_COMPRADOR,
          radio: radioPor(g.compradores.length),
          lat: g.lat,
          lon: g.lon + (g.consignados.length ? dLon : 0),
        });
      }
    }
    return puntos;
  }, [clientesFiltrados, situaciones]);

  // Redibuja los marcadores cada vez que cambian los grupos filtrados.
  useEffect(() => {
    if (!mapListo || !mapRef.current || !window.google?.maps) return;
    const gmaps = window.google.maps;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = grupos.map((p) => {
      const marker = new gmaps.Marker({
        position: { lat: p.lat, lng: p.lon },
        map: mapRef.current,
        icon: markerIcon(p.color, p.radio, p.anillo),
        cursor: "pointer",
      });
      marker.addListener("click", () => setSeleccion(p.grupo));
      return marker;
    });
  }, [grupos, mapListo]);

  // Al elegir una provincia, acerca el mapa a esa zona en vez de dejarlo
  // encuadrado en el país entero — así el filtro se siente útil de verdad.
  // También se re-encuadra al ampliar/achicar el mapa: el contenedor
  // cambia de tamaño por fuera del flujo normal, y sin recalcular el
  // fitBounds a mano queda mostrando de más (mismo zoom, más píxeles =
  // se ve mucho más mundo del que corresponde).
  useEffect(() => {
    if (!mapListo || !mapRef.current || !window.google?.maps) return;
    const gmaps = window.google.maps;
    // Avisarle al mapa que su contenedor cambió de tamaño antes de
    // recalcular el encuadre — si no, sigue midiendo con el tamaño viejo.
    const t = setTimeout(() => {
      if (!mapRef.current) return;
      gmaps.event.trigger(mapRef.current, "resize");
      if (!provinciaElegida) {
        mapRef.current.fitBounds(
          new gmaps.LatLngBounds({ lat: -55.1, lng: -73.6 }, { lat: -21.5, lng: -53.6 }),
          30
        );
        return;
      }
      if (grupos.length === 0) return;
      const bounds = new gmaps.LatLngBounds();
      for (const p of grupos) bounds.extend({ lat: p.lat, lng: p.lon });
      mapRef.current.fitBounds(bounds, 40);
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinciaElegida, mapListo, mapaAmpliado]);

  function toggleRutaStop(c) {
    setRutaResultado(null);
    setRutaError("");
    setRutaStops((prev) => {
      if (prev.some((s) => s.id === c.id)) return prev.filter((s) => s.id !== c.id);
      return [...prev, { id: c.id, nombre: c.nombre, lat: c.lat, lon: c.lon, direccion: c.direccion, ciudad: c.ciudad }];
    });
  }

  function detenerSeguimientoEnVivo() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    miMarkerRef.current?.setMap(null);
    miMarkerRef.current = null;
    setOrigenEnVivo(false);
  }

  function limpiarRuta() {
    setRutaStops([]);
    setRutaResultado(null);
    setRutaError("");
    setOrigenPunto(null);
    setOrigenInput("");
    setOrigenError("");
    detenerSeguimientoEnVivo();
    directionsRendererRef.current?.set("directions", null);
  }

  async function buscarOrigen() {
    if (!origenInput.trim() || !window.google?.maps) return;
    detenerSeguimientoEnVivo();
    setBuscandoOrigen(true);
    setOrigenError("");
    setRutaResultado(null);
    try {
      const gmaps = window.google.maps;
      const geocoder = new gmaps.Geocoder();
      const { results } = await geocoder.geocode({ address: origenInput.trim(), region: "ar" });
      const r = results?.[0];
      if (!r) {
        setOrigenError("No se encontró esa dirección.");
        return;
      }
      setOrigenPunto({ label: r.formatted_address, lat: r.geometry.location.lat(), lon: r.geometry.location.lng() });
    } catch (e) {
      console.error("[MapaClientes] error geocodificando origen:", e);
      setOrigenError("No se pudo buscar la dirección.");
    } finally {
      setBuscandoOrigen(false);
    }
  }

  // Arranca el seguimiento en vivo por GPS: pide permiso de ubicación,
  // actualiza el origen en cada movimiento (para que la ruta calcule
  // siempre "cuánto falta" desde donde está realmente ahora, no desde
  // donde arrancó), y dibuja un marcador de bici que se va moviendo.
  function activarSeguimientoEnVivo() {
    if (!navigator.geolocation) {
      setOrigenError("Este navegador no soporta geolocalización.");
      return;
    }
    if (watchIdRef.current != null) return; // ya está activo
    setBuscandoOrigen(true);
    setOrigenError("");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setBuscandoOrigen(false);
        setOrigenEnVivo(true);
        const punto = { label: "Mi ubicación en vivo", lat: pos.coords.latitude, lon: pos.coords.longitude };
        setOrigenPunto(punto);
        setOrigenInput("Mi ubicación en vivo");

        const gmaps = window.google?.maps;
        if (gmaps && mapRef.current) {
          const pos2 = { lat: punto.lat, lng: punto.lon };
          if (!miMarkerRef.current) {
            miMarkerRef.current = new gmaps.Marker({
              position: pos2,
              map: mapRef.current,
              icon: {
                path: gmaps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: "#dc2626",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
              label: { text: "🚴", fontSize: "14px" },
              zIndex: 999,
            });
          } else {
            miMarkerRef.current.setPosition(pos2);
          }
        }

        // No recalcula la ruta completa en cada tic de GPS (podría ser
        // cada 1-2 segundos): la recalcula como mucho cada 20 segundos,
        // así el "cuánto falta" se actualiza solo sin gastar de más en la
        // API de rutas.
        const ahora = Date.now();
        if (ahora - ultimoCalculoRef.current > 20000) {
          ultimoCalculoRef.current = ahora;
          calcularRutaDesde(punto);
        }
      },
      () => {
        setBuscandoOrigen(false);
        setOrigenError("No se pudo obtener tu ubicación — revisá los permisos del navegador.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function quitarOrigen() {
    detenerSeguimientoEnVivo();
    setOrigenPunto(null);
    setOrigenInput("");
    setOrigenError("");
    setRutaResultado(null);
  }

  // Al activar el modo ruta, pide el permiso de ubicación de una — así
  // arranca directo el seguimiento en vivo en vez de esperar a que el
  // chofer busque el botón.
  useEffect(() => {
    if (modoRuta && !origenPunto) {
      activarSeguimientoEnVivo();
    }
    if (!modoRuta) {
      detenerSeguimientoEnVivo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoRuta]);

  useEffect(() => {
    return () => detenerSeguimientoEnVivo();
  }, []);

  async function calcularRutaDesde(origenForzado) {
    const origenBase = origenForzado || origenPunto;
    const minStops = origenBase ? 1 : 2;
    if (rutaStops.length < minStops || !window.google?.maps) return;
    setCalculandoRuta(true);
    setRutaError("");
    try {
      const gmaps = window.google.maps;
      const service = new gmaps.DirectionsService();
      // Con un punto de partida elegido a mano, todas las paradas
      // agregadas son destinos posibles (la última es el destino final).
      // Sin un origen explícito, la primera parada agregada actúa como
      // origen (comportamiento anterior).
      const origen = origenBase || rutaStops[0];
      const destino = rutaStops[rutaStops.length - 1];
      const intermedias = origenBase ? rutaStops.slice(0, -1) : rutaStops.slice(1, -1);
      const base = {
        origin: { lat: origen.lat, lng: origen.lon },
        destination: { lat: destino.lat, lng: destino.lon },
        waypoints: intermedias.map((s) => ({ location: { lat: s.lat, lng: s.lon }, stopover: true })),
        optimizeWaypoints: true,
      };
      // Rutas pensadas para reparto en bici — camino más simple/directo en
      // bici, no el más rápido en auto. Si Google no tiene datos de
      // ciclovías para esa zona (pasa en localidades chicas), cae a
      // rutas de auto para no dejar al chofer sin nada.
      let result;
      try {
        result = await service.route({ ...base, travelMode: gmaps.TravelMode.BICYCLING });
      } catch {
        result = await service.route({ ...base, travelMode: gmaps.TravelMode.DRIVING });
      }
      directionsRendererRef.current?.setDirections(result);
      const legs = result.routes[0].legs;
      const distanciaTotal = legs.reduce((acc, l) => acc + l.distance.value, 0);
      const duracionTotal = legs.reduce((acc, l) => acc + l.duration.value, 0);
      const ordenWaypoints = result.routes[0].waypoint_order || [];
      const ordenCompleto = [
        { ...origen, id: origen.id ?? "__origen__", nombre: origen.nombre || origen.label },
        ...ordenWaypoints.map((i) => intermedias[i]),
        destino,
      ];
      setRutaResultado({ distanciaTotal, duracionTotal, orden: ordenCompleto, legs });
    } catch (e) {
      console.error("[MapaClientes] error calculando ruta:", e);
      setRutaError("No se pudo calcular la ruta. Verificá que las direcciones sean accesibles.");
    } finally {
      setCalculandoRuta(false);
    }
  }

  function calcularRuta() {
    ultimoCalculoRef.current = Date.now();
    return calcularRutaDesde(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">🗺️ Localización de clientes</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
          Cada punto es una dirección real (calle y altura) — <span className="font-semibold text-emerald-600 dark:text-emerald-400">verde</span> son
          clientes con depósito consignado, <span className="font-semibold text-sky-600 dark:text-sky-400">azul</span> los que solo
          compran. El tamaño representa la cantidad de clientes ahí.
        </p>
        {totalSinUbicar > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            ⚠️ {totalSinUbicar} cliente(s) no se pudieron ubicar (dirección y localidad sin identificar, o no encontrada en el padrón oficial).
          </p>
        )}
        {totalAproximados > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            ⚠️ {totalAproximados} cliente(s) ubicados solo por el centro de su localidad — no se pudo geocodificar su calle exacta.
          </p>
        )}
      </div>

      <RutaPanel />

      <div className="relative max-w-sm">
        <input
          type="search"
          value={busquedaNombre}
          onChange={(e) => {
            setBusquedaNombre(e.target.value);
            setMostrarResultadosBusqueda(true);
          }}
          onFocus={() => setMostrarResultadosBusqueda(true)}
          onBlur={() => setTimeout(() => setMostrarResultadosBusqueda(false), 150)}
          placeholder="🔎 Buscar cliente por nombre…"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
        {mostrarResultadosBusqueda && resultadosBusqueda.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {resultadosBusqueda.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => irAUbicacionDeCliente(c)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-sky-50 dark:hover:bg-sky-950/30"
              >
                <span className="min-w-0 truncate text-slate-700 dark:text-neutral-200">{c.nombre}</span>
                <span className="shrink-0 text-slate-400 dark:text-neutral-500">{c.ciudad}</span>
              </button>
            ))}
          </div>
        )}
        {mostrarResultadosBusqueda && busquedaNombre.trim().length >= 2 && resultadosBusqueda.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-400 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500">
            No se encontró ningún cliente ubicado con ese nombre.
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
              filtro === f.key
                ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={provinciaElegida}
          onChange={(e) => setProvinciaElegida(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        >
          <option value="">Todas las provincias</option>
          {provinciasDisponibles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          onClick={() => setModoRuta((v) => !v)}
          className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
            modoRuta
              ? "border-rose-500 bg-rose-50 text-rose-700 dark:border-rose-500 dark:bg-rose-950/40 dark:text-rose-400"
              : "border-slate-200 bg-white text-slate-600 hover:border-rose-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
        >
          🛣️ {modoRuta ? "Modo ruta: ON" : "Planificar ruta"}
        </button>
        <button
          onClick={handleExportar}
          disabled={exportando}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-emerald-300 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        >
          {exportando ? "Exportando…" : provinciaElegida ? `⬇️ Exportar ${provinciaElegida}` : "⬇️ Exportar por provincia"}
        </button>
        <button
          onClick={handleExportarGuion}
          disabled={exportandoGuion}
          title="PDF con el guion sugerido y el listado numerado de clientes por zona, todo junto"
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-violet-300 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        >
          {exportandoGuion ? "Generando…" : "📞 Guion de llamadas (PDF)"}
        </button>
        <button
          onClick={() => importInputRef.current?.click()}
          disabled={importando}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-indigo-300 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        >
          {importando ? "Importando…" : "⬆️ Importar situaciones (Excel)"}
        </button>
        <input ref={importInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleImportarArchivo} />
        <span className="self-center text-xs text-slate-400 dark:text-neutral-500">
          {clientesFiltrados.length} cliente(s) ubicados
        </span>
      </div>

      {importResult && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300">
          <p className="font-semibold">
            ✅ Importado: {importResult.actualizados} de {importResult.total} cliente(s) actualizados
            {importResult.soloNota ? ` (${importResult.soloNota} solo con nota, sin cambio de situación)` : ""}.
          </p>
          {importResult.noEncontrados.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">
                ⚠️ {importResult.noEncontrados.length} sin encontrar por CUIT — revisar a mano
              </summary>
              <ul className="mt-1 list-disc pl-4">
                {importResult.noEncontrados.map((n, i) => (
                  <li key={i}>
                    {n.nombre} {n.cuit ? `(CUIT ${n.cuit})` : "(sin CUIT)"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {importError && <p className="text-sm text-rose-600 dark:text-rose-400">{importError}</p>}
      {exportError && <p className="text-sm text-rose-600 dark:text-rose-400">{exportError}</p>}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {mapError && <p className="text-sm text-rose-600 dark:text-rose-400">{mapError}</p>}
      {!ubicaciones && !error && (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Geocodificando localidades…</p>
      )}

      {modoRuta && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/20">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">🛣️ Planificador de ruta</p>

          {!origenPunto ? (
            <>
              <p className="mt-1 text-xs text-rose-600/80 dark:text-rose-400/80">
                Primero indicá de dónde arranca el viaje (dirección, o tu ubicación actual).
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={origenInput}
                  onChange={(e) => setOrigenInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && buscarOrigen()}
                  placeholder="Dirección de partida (ej: Depósito, calle y ciudad)"
                  className="min-w-[240px] flex-1 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-rose-400 dark:border-rose-500/30 dark:bg-neutral-900 dark:text-white"
                />
                <button
                  onClick={buscarOrigen}
                  disabled={!origenInput.trim() || buscandoOrigen}
                  className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {buscandoOrigen ? "Buscando…" : "Usar como origen"}
                </button>
                <button
                  onClick={activarSeguimientoEnVivo}
                  disabled={buscandoOrigen}
                  className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/40 dark:bg-transparent dark:text-rose-400"
                >
                  {buscandoOrigen ? "Pidiendo ubicación…" : "📍 Seguir mi ubicación en vivo"}
                </button>
              </div>
              {origenError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{origenError}</p>}
            </>
          ) : (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-white/60 px-2 py-1.5 text-sm text-slate-700 dark:bg-neutral-900/40 dark:text-neutral-200">
              <span>
                🏁 Origen: <span className="font-semibold">{origenPunto.label}</span>
                {origenEnVivo && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    ● EN VIVO
                  </span>
                )}
              </span>
              <button
                onClick={quitarOrigen}
                className="text-xs text-slate-400 hover:text-rose-600 dark:text-neutral-500 dark:hover:text-rose-400"
              >
                Cambiar
              </button>
            </div>
          )}

          <p className="mt-2 text-xs text-rose-600/80 dark:text-rose-400/80">
            Tocá un punto del mapa y agregá clientes a la ruta desde la lista de la derecha
            {origenPunto ? " — se ordenan automáticamente desde el origen" : ". El primero que agregues es el origen, el último el destino"}.
          </p>
          {rutaStops.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">Todavía no agregaste ninguna parada.</p>
          ) : (
            <>
              <ol className="mt-3 space-y-1 text-sm text-slate-700 dark:text-neutral-200">
                {(rutaResultado?.orden || rutaStops).map((s, i) => {
                  // El leg[i-1] es el tramo que va DESDE la parada anterior
                  // HASTA esta — así cada fila muestra cuánto falta para
                  // llegar ahí, no la distancia acumulada total.
                  const leg = rutaResultado?.legs?.[i - 1];
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/60 px-2 py-1 dark:bg-neutral-900/40">
                      <span>
                        <span className="font-semibold">{i + 1}.</span> {s.nombre}
                        {s.ciudad ? <span className="text-slate-400 dark:text-neutral-500"> — {s.ciudad}</span> : null}
                        {leg && (
                          <span className="ml-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                            ({fmtDistancia(leg.distance.value)} · {fmtDuracion(leg.duration.value)})
                          </span>
                        )}
                      </span>
                      {s.id !== "__origen__" && (
                        <button
                          onClick={() => toggleRutaStop(s)}
                          className="text-xs text-slate-400 hover:text-rose-600 dark:text-neutral-500 dark:hover:text-rose-400"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={calcularRuta}
                  disabled={rutaStops.length < (origenPunto ? 1 : 2) || calculandoRuta}
                  className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {calculandoRuta ? "Calculando…" : "📍 Calcular ruta"}
                </button>
                <button
                  onClick={limpiarRuta}
                  className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:bg-transparent dark:text-rose-400"
                >
                  Limpiar
                </button>
                {!origenPunto && rutaStops.length === 1 && (
                  <span className="text-xs text-slate-500 dark:text-neutral-400">Agregá al menos una parada más.</span>
                )}
              </div>
              {rutaError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{rutaError}</p>}
              {rutaResultado && (
                <p className="mt-2 text-sm font-semibold text-rose-700 dark:text-rose-400">
                  Total: {fmtDistancia(rutaResultado.distanciaTotal)} · {fmtDuracion(rutaResultado.duracionTotal)} de viaje
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div
        className={
          mapaAmpliado
            ? "fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto bg-slate-50 p-4 dark:bg-black"
            : ""
        }
      >
        {mapaAmpliado && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">🗺️ Mapa ampliado</p>
            <button
              onClick={() => setMapaAmpliado(false)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              ✕ Achicar mapa
            </button>
          </div>
        )}
        <div className={`grid grid-cols-1 gap-4 lg:grid-cols-3 ${mapaAmpliado ? "flex-1" : ""}`}>
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-neutral-800 lg:col-span-2">
            {!mapaAmpliado && (
              <button
                onClick={() => setMapaAmpliado(true)}
                title="Ampliar mapa a pantalla completa (con el panel de info incluido)"
                className="absolute right-2 top-2 z-10 rounded-lg border border-slate-200 bg-white/90 p-1.5 text-slate-600 shadow-sm hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-300"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M3 3a1 1 0 011-1h4a1 1 0 010 2H5.414l3.293 3.293a1 1 0 11-1.414 1.414L4 5.414V8a1 1 0 01-2 0V4a1 1 0 011-1zm14 14a1 1 0 01-1 1h-4a1 1 0 110-2h2.586l-3.293-3.293a1 1 0 111.414-1.414L16 14.586V12a1 1 0 112 0v4a1 1 0 01-1 1z" />
                </svg>
              </button>
            )}
            <div ref={containerRef} className={mapaAmpliado ? "h-full min-h-[420px] w-full" : "h-[560px] w-full"} />
          </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          {!seleccion ? (
            <p className="text-sm text-slate-400 dark:text-neutral-500">Tocá un punto del mapa para ver los clientes de esa localidad.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {[seleccion.ciudad, seleccion.provincia].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    {seleccion.tipo === "consignados" ? "🟢 Con depósito consignado" : "🔵 Compradores (sin depósito)"} ·{" "}
                    {seleccion.clientes.length} cliente(s)
                  </p>
                </div>
                <button
                  onClick={() => setSeleccion(null)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3 max-h-[460px] space-y-2 overflow-y-auto">
                {seleccion.clientes.map((c) => {
                  const wa = normalizarTelefonoWhatsapp(c.telefono);
                  const badge = c.videoEstado ? VIDEO_BADGE[c.videoEstado] : null;
                  const enRuta = rutaStops.some((s) => s.id === c.id);
                  const situacion = c.contabiliumId != null ? situaciones.get(String(c.contabiliumId)) : null;
                  return (
                    <div key={c.id} className="rounded-xl border border-slate-100 p-2.5 text-xs dark:border-neutral-800">
                      <button
                        type="button"
                        onClick={() => setDetalleUid(c.uid || null)}
                        disabled={!c.uid}
                        className="text-left font-semibold text-sky-700 hover:underline disabled:cursor-default disabled:text-slate-700 disabled:no-underline dark:text-sky-400 dark:disabled:text-neutral-200"
                      >
                        {c.nombre}
                      </button>
                      <p className="text-slate-400 dark:text-neutral-500">CUIT {c.cuit || "—"}</p>
                      <p className="text-slate-400 dark:text-neutral-500">
                        📍 {c.direccion ? `${c.direccion}, ` : ""}
                        {[c.ciudad, c.provincia].filter(Boolean).join(", ")}
                        {c.cp ? ` (CP ${c.cp})` : ""}
                      </p>
                      <p className={c.ubicacionPrecisa ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                        {c.ubicacionPrecisa ? "✓ Pin en la dirección exacta" : "⚠️ Pin aproximado — solo se ubicó el centro de la localidad"}
                      </p>
                      {badge && <p className={`mt-1 font-medium ${badge.cls}`}>{badge.label}</p>}
                      {(() => {
                        const reporteFila = c.uid ? reporteFilaPorUid.get(c.uid) : null;
                        const live = c.uid ? saldosLive[c.uid] : null;
                        const perfil = c.customerTypeId ? customerTypeTituloPorId.get(c.customerTypeId) : null;
                        // Preferimos siempre el saldo en vivo (contra
                        // Contabilium) sobre el de la instantánea diaria —
                        // así se ve al toque cuando se acaba de cobrar algo.
                        const saldoFuente = live && live !== "cargando" && live !== "error" ? live : reporteFila;
                        const ctaCte =
                          live === "cargando"
                            ? { texto: "actualizando…", cls: "text-slate-400 dark:text-neutral-500" }
                            : !saldoFuente
                            ? null
                            : saldoFuente.saldoDeudor > 0
                            ? { texto: `Debe $${Math.round(saldoFuente.saldoDeudor).toLocaleString("es-AR")}`, cls: "text-rose-600 dark:text-rose-400" }
                            : saldoFuente.saldoAFavor > 0
                            ? { texto: `A favor $${Math.round(saldoFuente.saldoAFavor).toLocaleString("es-AR")}`, cls: "text-sky-600 dark:text-sky-400" }
                            : { texto: "Al día", cls: "text-emerald-600 dark:text-emerald-400" };
                        const ultimoPedido = reporteFila?.fechaUltimaFactura
                          ? new Date(reporteFila.fechaUltimaFactura).toLocaleDateString("es-AR")
                          : null;
                        if (!ctaCte && !ultimoPedido && !perfil) return null;
                        return (
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-500 dark:text-neutral-400">
                            <span>🏷️ {c.tieneDeposito ? "Consignado" : "Comprador directo"}</span>
                            {perfil && <span>· {perfil}</span>}
                            {ctaCte && <span className={ctaCte.cls}>· 💰 {ctaCte.texto}</span>}
                            {ultimoPedido && <span>· 🗓️ Último pedido {ultimoPedido}</span>}
                          </p>
                        );
                      })()}
                      {c.tieneDeposito && (
                        <div className="mt-1.5 rounded-lg bg-slate-50 p-1.5 dark:bg-neutral-800/60">
                          <div className="flex items-center gap-1.5">
                            {SITUACION_OPCIONES.map((op) => (
                              <button
                                key={op.color}
                                type="button"
                                title={op.label}
                                disabled={guardandoSituacion === c.contabiliumId}
                                onClick={() => marcarSituacion(c, { color: op.color, etiqueta: op.label })}
                                className={`flex h-6 w-6 items-center justify-center rounded-full text-sm transition ${
                                  situacion?.color === op.color ? "ring-2 ring-offset-1 ring-slate-900 dark:ring-white" : "opacity-50 hover:opacity-100"
                                }`}
                                style={{ backgroundColor: op.hex + "33" }}
                              >
                                {op.emoji}
                              </button>
                            ))}
                            {situacion && (
                              <span className="text-[10px] font-medium text-slate-500 dark:text-neutral-400">
                                {situacion.etiqueta}
                              </span>
                            )}
                            {situacion && (
                              <button
                                type="button"
                                title="Editar nota"
                                onClick={() => {
                                  const nota = window.prompt("Nota sobre la situación de este cliente:", situacion.nota || "");
                                  if (nota !== null) {
                                    marcarSituacion(c, { nota });
                                  }
                                }}
                                className="ml-auto text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200"
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                          {situacion && (
                            <button
                              type="button"
                              disabled={guardandoSituacion === c.contabiliumId}
                              onClick={() => marcarSituacion(c, { llamado: !situacion.llamado })}
                              className={`mt-1.5 flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-medium transition ${
                                situacion.llamado
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                              }`}
                            >
                              {situacion.llamado ? "📞 Llamado ✓" : "📵 No llamado — marcar como llamado"}
                            </button>
                          )}
                          {situacion?.nota && (
                            <p className="mt-1 text-[10px] italic text-slate-500 dark:text-neutral-400">📝 {situacion.nota}</p>
                          )}
                          {situacion?.updatedByNombre && (
                            <p className="mt-0.5 text-[9px] text-slate-400 dark:text-neutral-500">
                              — {situacion.updatedByNombre}
                              {situacion.updatedAt ? ` · ${situacion.updatedAt.toLocaleDateString("es-AR")}` : ""}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {wa && (
                          <a
                            href={`https://wa.me/${wa}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                          >
                            💬 WhatsApp
                          </a>
                        )}
                        {modoRuta && (
                          <button
                            onClick={() => toggleRutaStop(c)}
                            className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${
                              enRuta
                                ? "border-rose-400 bg-rose-100 text-rose-700 dark:border-rose-500/50 dark:bg-rose-950/40 dark:text-rose-400"
                                : "border-slate-200 text-slate-500 hover:border-rose-300 dark:border-neutral-700 dark:text-neutral-400"
                            }`}
                          >
                            {enRuta ? "✓ En la ruta" : "+ Agregar a ruta"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">📅 Seguimiento por día</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
          A quién se fue marcando con color (🟢🟡🟠🔴) cada día desde el mapa, con la nota que se haya dejado.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setMesCalendario((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                ‹
              </button>
              <p className="text-sm font-semibold capitalize text-slate-800 dark:text-neutral-200">
                {mesCalendario.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
              </p>
              <button
                onClick={() => setMesCalendario((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                ›
              </button>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-slate-400 dark:text-neutral-500">
              {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {diasDelMes.map((celda, i) => {
                if (!celda) return <div key={`vacio-${i}`} />;
                const marcas = situacionesPorDia.get(celda.key) || [];
                const hoy = new Date();
                const esHoy =
                  celda.key === `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
                const esSeleccionado = celda.key === diaSeleccionado;
                const coloresDelDia = [...new Set(marcas.map((m) => m.color))];
                return (
                  <button
                    key={celda.key}
                    onClick={() => setDiaSeleccionado(celda.key)}
                    className={`flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border text-xs transition ${
                      esSeleccionado
                        ? "border-sky-400 bg-sky-50 font-semibold text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                        : esHoy
                        ? "border-slate-300 font-semibold text-slate-800 dark:border-neutral-600 dark:text-neutral-200"
                        : "border-transparent text-slate-600 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    }`}
                  >
                    <span>{celda.dia}</span>
                    {coloresDelDia.length > 0 && (
                      <span className="flex gap-0.5">
                        {coloresDelDia.slice(0, 3).map((color) => (
                          <span
                            key={color}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: SITUACION_OPCIONES.find((o) => o.color === color)?.hex || "#94a3b8" }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
              {new Date(diaSeleccionado + "T00:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
              {" · "}
              {marcasDelDiaSeleccionado.length} marca{marcasDelDiaSeleccionado.length === 1 ? "" : "s"}
            </p>
            <div className="mt-2 max-h-[320px] space-y-2 overflow-y-auto">
              {marcasDelDiaSeleccionado.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-neutral-500">Nadie fue marcado ese día.</p>
              )}
              {marcasDelDiaSeleccionado.map((m) => {
                const op = SITUACION_OPCIONES.find((o) => o.color === m.color);
                return (
                  <div key={m.contabiliumId} className="rounded-xl border border-slate-100 p-2.5 text-xs dark:border-neutral-800">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{m.nombre}</p>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: (op?.hex || "#94a3b8") + "22", color: op?.hex || "#64748b" }}
                      >
                        {op?.emoji} {m.etiqueta}
                      </span>
                    </div>
                    {m.nota && <p className="mt-1 text-slate-500 dark:text-neutral-400">📝 {m.nota}</p>}
                    <p className="mt-1 text-[10px] text-slate-400 dark:text-neutral-500">
                      {m.updatedByNombre ? `${m.updatedByNombre} · ` : ""}
                      {m.updatedAt?.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {clienteDetalle && <ClienteDetalle cliente={clienteDetalle} onClose={() => setDetalleUid(null)} soloLectura={esChofer} />}
    </div>
  );
}
