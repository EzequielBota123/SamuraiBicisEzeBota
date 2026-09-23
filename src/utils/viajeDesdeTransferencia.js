// Arma y carga en la grilla de logística el viaje que corresponde a un
// movimiento de stock hecho desde Stock consignado: de qué depósito sale, a
// cuál va, con el remito adjunto y el tiempo ya calculado por el mapa.
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { DEPOSITOS_PROPIOS, crearViaje, guardarPdfRemitoViaje } from "../services/logisticaViajes";
import { cargarClientesUnaVez } from "./clientesUbicados";
import { calcularDuracion, geocodificar } from "./rutaViaje";

const LAVALLE_DEPOSITO_ID = 135151;

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function propioPorNombre(nombre) {
  const n = normalizar(nombre);
  if (n.includes("lavalle")) return "lavalle";
  if (n.includes("canuelas")) return "canuelas";
  if (n.includes("avellaneda")) return "avellaneda";
  return null;
}

async function lugarDesdeDeposito(depositoId, nombre) {
  const propioId = Number(depositoId) === LAVALLE_DEPOSITO_ID ? "lavalle" : propioPorNombre(nombre);
  const propio = propioId ? DEPOSITOS_PROPIOS.find((d) => d.id === propioId) : null;
  if (propio) {
    return { tipo: "deposito", id: propio.id, nombre: propio.nombre, direccion: propio.direccion, lat: null, lon: null, horario: propio.horario || null, telefono: propio.telefono || null };
  }
  // Depósito de un distribuidor: se busca su cliente y de ahí la dirección.
  try {
    const snap = await getDocs(query(collection(db, "users"), where("contabiliumDepositoId", "==", Number(depositoId))));
    const contabiliumId = snap.docs[0]?.data()?.contabiliumId;
    if (contabiliumId) {
      const clientes = await cargarClientesUnaVez();
      const c = clientes.find((x) => x.contabiliumId === contabiliumId);
      if (c) {
        return {
          tipo: "cliente",
          id: String(c.contabiliumId),
          nombre: c.nombre,
          direccion: [c.direccion, c.ciudad, c.provincia].filter(Boolean).join(", "),
          lat: c.lat ?? null,
          lon: c.lon ?? null,
          horario: null,
          telefono: null,
        };
      }
    }
  } catch {
    // sin datos del cliente: se carga igual con el nombre del depósito
  }
  return { tipo: "libre", id: null, nombre: nombre || `Depósito ${depositoId}`, direccion: "", lat: null, lon: null, horario: null, telefono: null };
}

async function conCoords(lugar) {
  if (lugar.lat != null && lugar.lon != null) return lugar;
  if (!lugar.direccion) return lugar;
  const p = await geocodificar(lugar.direccion);
  return p ? { ...lugar, lat: p.lat, lon: p.lon } : lugar;
}

export function numeroDeRemito(archivo) {
  const m = archivo && /(\d{4}-\d{8})/.exec(archivo);
  return m ? m[1] : null;
}

// Devuelve el id del viaje creado. Si el mapa no puede calcular el tiempo
// (dirección que no encuentra, etc.) el viaje se carga igual, sin tiempo, y
// se puede completar después desde la grilla.
export async function crearViajeDesdeTransferencia({ origen, destino, fecha, turno, horaSalida, remitoArchivo, pdfBase64, notas, chofer, actor }) {
  const [o, d] = await Promise.all([lugarDesdeDeposito(origen.id, origen.nombre), lugarDesdeDeposito(destino.id, destino.nombre)]);
  const [oc, dc] = await Promise.all([conCoords(o), conCoords(d)]);

  let duracionMin = null;
  let distanciaKm = null;
  if (oc.lat != null && dc.lat != null) {
    try {
      const salida = horaSalida ? new Date(`${fecha}T${horaSalida}:00`) : null;
      const r = await calcularDuracion(oc, dc, salida);
      duracionMin = r.duracionMin;
      distanciaKm = r.distanciaKm;
    } catch {
      // sin tiempo estimado
    }
  }

  const numero = numeroDeRemito(remitoArchivo);
  const id = await crearViaje(
    {
      fecha,
      turno,
      origen: oc,
      destino: dc,
      horaSalida: horaSalida || null,
      duracionMin,
      distanciaKm,
      descargaMin: 20,
      notas: notas || "",
      remito: numero ? { numero, id: null, tienePdf: !!pdfBase64 } : null,
      chofer: chofer || null,
    },
    actor
  );
  if (pdfBase64) await guardarPdfRemitoViaje(id, { archivo: remitoArchivo || null, pdfBase64 });
  return id;
}
