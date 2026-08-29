import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../../../firebase";
import { fetchAsignaciones, fetchClientes, fetchVendedores, subscribeCrmRealtime } from "./crmApi";
import { buildAsignadoView } from "./notasCodec";
import { getAuditProgramStart, isAuditOverdue, isAuditDueSoon } from "../../../services/stockAudits";

// Cartera real de clientes de Contabilium (169+ registros — no solo los que
// se registraron en la app) — se suma como una lista más dentro del CRM
// ("tipo": "Samurai"), con id prefijado "cb-" para no colisionar con los
// ids de crmClientes (CREDIFIN/SIN CREDIFIN/RETAIL).
async function fetchClientesSamurai() {
  const user = auth.currentUser;
  if (!user) return [];
  const token = await user.getIdToken();
  const res = await fetch("https://us-central1-bikeshop-ab2f0.cloudfunctions.net/listContabiliumClientes", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error("[CRM] no se pudo traer la cartera de Contabilium:", res.status);
    return [];
  }
  const { items = [] } = await res.json();
  return items.map((c) => ({ ...c, tipo: "Samurai" }));
}

// Carga y mantiene sincronizados (realtime) vendedores/clientes/asignaciones.
// Todas las pantallas del CRM comparten esta misma data para no duplicar
// llamadas a Supabase.
export default function useCrmData() {
  const [vendedores, setVendedores] = useState([]);
  const [clientesBase, setClientesBase] = useState([]);
  const [asignaciones, setAsignaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reloading = useRef(false);

  // Datos de Samurai (Firestore) en vivo: seguimiento (notas/contactado) y
  // videos de auditoría, para enriquecer la lista "Samurai" del CRM con la
  // misma info que se ve en Clientes 360 — cualquier cambio en cualquiera de
  // las dos pantallas se refleja al toque en la otra, porque leen la misma
  // fuente (users/{uid}.seguimiento).
  const [usuariosSamurai, setUsuariosSamurai] = useState([]);
  const [auditsPorDeposito, setAuditsPorDeposito] = useState(new Map());
  const [programStart, setProgramStart] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "users"), where("kind", "==", "client")), (snap) => {
      setUsuariosSamurai(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "stockAudits"), (snap) => {
      const map = new Map();
      snap.docs.forEach((d) => {
        const a = d.data();
        const key = String(a.depositoId);
        const fecha = a.createdAt?.toDate?.() || null;
        if (!fecha) return;
        if (!map.has(key) || fecha > map.get(key)) map.set(key, fecha);
      });
      setAuditsPorDeposito(map);
    });
    return unsub;
  }, []);

  useEffect(() => {
    getAuditProgramStart().then(setProgramStart).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    if (reloading.current) return;
    reloading.current = true;
    try {
      const [v, c, cSamurai, a] = await Promise.all([
        fetchVendedores(),
        fetchClientes(),
        fetchClientesSamurai(),
        fetchAsignaciones(),
      ]);
      setVendedores(v);
      setClientesBase([...c, ...cSamurai]);
      setAsignaciones(a);
      setError("");
    } catch (err) {
      console.error("[CRM] error cargando datos:", err);
      setError(err.message || "Error cargando datos del CRM");
    } finally {
      setLoading(false);
      reloading.current = false;
    }
  }, []);

  useEffect(() => {
    reload();
    const unsub = subscribeCrmRealtime(() => reload());
    return unsub;
  }, [reload]);

  // Enriquecimiento en vivo: por contabiliumId, el seguimiento (notas,
  // contactado) y el estado del video de auditoría más reciente.
  const enriquecimientoPorContabiliumId = useMemo(() => {
    const map = new Map();
    for (const u of usuariosSamurai) {
      if (u.contabiliumId == null) continue;
      const seg = u.seguimiento || {};
      const ultimoVideo = u.contabiliumDepositoId != null ? auditsPorDeposito.get(String(u.contabiliumDepositoId)) || null : null;
      const tieneDeposito = u.contabiliumDepositoId != null;
      let videoEstado = "no aplica";
      if (tieneDeposito) {
        if (!ultimoVideo) videoEstado = "sin video";
        else if (isAuditOverdue(ultimoVideo, programStart, u.auditIntervalDays)) videoEstado = "vencido";
        else if (isAuditDueSoon(ultimoVideo, programStart, u.auditIntervalDays)) videoEstado = "por vencer";
        else videoEstado = "al dia";
      }
      map.set(u.contabiliumId, {
        uid: u.id,
        contactado: !!seg.contactado,
        contactadoPor: seg.contactadoPor || null,
        contactadoFecha: seg.fecha?.toDate?.() || null,
        notas: seg.notas || "",
        tareaPendiente: seg.tareaPendiente || "",
        cantidadNotas: (seg.historial || []).length,
        videoEstado,
        videoUltimaFecha: ultimoVideo,
      });
    }
    return map;
  }, [usuariosSamurai, auditsPorDeposito, programStart]);

  const clientes = useMemo(() => {
    return clientesBase.map((c) => {
      if (c.tipo !== "Samurai" || c.contabiliumId == null) return c;
      const extra = enriquecimientoPorContabiliumId.get(c.contabiliumId);
      return extra ? { ...c, ...extra } : c;
    });
  }, [clientesBase, enriquecimientoPorContabiliumId]);

  const asignacionByCliente = {};
  asignaciones.forEach((a) => {
    asignacionByCliente[a.cliente_id] = a;
  });

  // "asignados": clientes con asignación, con estado/notas ya decodificados
  // (misma vista que usan Telemarketers, Vendedores, Calendario, Exportar y Panel Admin).
  const asignados = useMemo(() => {
    const clienteById = {};
    clientes.forEach((c) => {
      clienteById[c.id] = c;
    });
    return asignaciones
      .filter((a) => clienteById[a.cliente_id])
      .map((a) => buildAsignadoView(clienteById[a.cliente_id], a));
  }, [clientes, asignaciones]);

  return { vendedores, clientes, asignaciones, asignacionByCliente, asignados, loading, error, reload };
}
