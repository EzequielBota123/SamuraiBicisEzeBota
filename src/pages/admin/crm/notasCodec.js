// Codifica/decodifica el campo "notas" de la tabla asignaciones.
// Formato (compartido con el CRM original, NO cambiar sin actualizar los
// dos lados): {"_fc":"ISO date","_notas":[{t,f,u}],"_vv":"vendedor cierre","_ev":"estado vendedor"}
// Legacy: texto plano viejo, o {_n:"texto"} de una version anterior.
export function fcExtraer(raw) {
  if (!raw) return { fecha: null, texto: "", notas: [], vendedorVenta: "", estadoVend: "" };
  try {
    if (typeof raw === "string" && raw.startsWith("{")) {
      const obj = JSON.parse(raw);
      let notas = obj._notas || [];
      if (!notas.length && obj._n && obj._n.trim()) {
        notas = [{ t: obj._n, f: obj._fc || null, u: "" }];
      }
      return {
        fecha: obj._fc || null,
        texto: obj._n || "",
        notas,
        vendedorVenta: obj._vv || "",
        estadoVend: obj._ev || "",
      };
    }
  } catch (e) {
    // sigue a texto plano
  }
  if (typeof raw === "string" && raw.trim()) {
    return { fecha: null, texto: raw, notas: [{ t: raw, f: null, u: "" }], vendedorVenta: "", estadoVend: "" };
  }
  return { fecha: null, texto: "", notas: [], vendedorVenta: "", estadoVend: "" };
}

export function fcSerializarVend(fecha, notasArr, vendedorVenta, estadoVend) {
  const obj = {};
  if (fecha) obj._fc = fecha;
  if (notasArr && notasArr.length) obj._notas = notasArr;
  if (vendedorVenta) obj._vv = vendedorVenta;
  if (estadoVend) obj._ev = estadoVend;
  return Object.keys(obj).length ? JSON.stringify(obj) : "";
}

export const ESTADOS = [
  { key: "Sin contactar", color: "#64748b", bg: "#f1f5f9", icon: "📵" },
  { key: "Contactado", color: "#0284c7", bg: "#e0f2fe", icon: "📞" },
  { key: "Interesado", color: "#d97706", bg: "#fef3c7", icon: "⭐" },
  { key: "En manos de vendedor", color: "#7c3aed", bg: "#f3e8ff", icon: "🤝" },
  { key: "Cerrado", color: "#15803d", bg: "#dcfce7", icon: "✅" },
  { key: "No interesado", color: "#dc2626", bg: "#fee2e2", icon: "❌" },
];
export function getEst(key) {
  return ESTADOS.find((e) => e.key === key) || ESTADOS[0];
}

export const ESTADOS_VEND = [
  { key: "Cliente Activo", color: "#15803d", bg: "#dcfce7", icon: "⭐" },
  { key: "Cliente Activo No Asig.", color: "#0284c7", bg: "#e0f2fe", icon: "🔓" },
  { key: "En proceso", color: "#0284c7", bg: "#e0f2fe", icon: "🔄" },
  { key: "Negociando", color: "#d97706", bg: "#fef3c7", icon: "💬" },
  { key: "Cerrado", color: "#15803d", bg: "#dcfce7", icon: "✅" },
  { key: "No interesado", color: "#dc2626", bg: "#fee2e2", icon: "❌" },
];
export function getEstVend(key) {
  return ESTADOS_VEND.find((e) => e.key === key) || { key: key || "En proceso", color: "#0284c7", bg: "#e0f2fe", icon: "🔄" };
}

// Convierte (cliente + asignacion cruda de Supabase) en la "vista asignado"
// que usan Telemarketers/Vendedores/Calendario/Exportar/PanelAdmin.
export function buildAsignadoView(cliente, asignacion) {
  const { fecha, texto, notas, vendedorVenta, estadoVend } = fcExtraer(asignacion.notas || "");
  let estadoReal;
  if (vendedorVenta && asignacion.estado === "Interesado") {
    estadoReal = estadoVend === "Cerrado" ? "Cerrado" : "En manos de vendedor";
  } else {
    estadoReal = asignacion.estado || "Sin contactar";
  }
  return {
    ...cliente,
    vendedorId: asignacion.vendedor_nombre,
    estado: estadoReal,
    notas: texto,
    notasHistorial: notas,
    vendedorVenta,
    estadoVend: estadoVend || "",
    fechaAsignacion: asignacion.fecha_asignacion ? new Date(asignacion.fecha_asignacion).toLocaleDateString("es-AR") : "",
    fecha_contacto: fecha,
  };
}
