import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import useCrmData from "../admin/crm/useCrmData";
import { getClientesConUbicacion } from "../../services/comprobantes";
import {
  addNotaEntrega,
  deleteNotaEntrega,
  subscribeNotasEntregaPorCliente,
  subscribeNotasEntregaRecientes,
} from "../../services/notasEntrega";

function formatFechaHora(d) {
  if (!d) return "-";
  return (
    d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) +
    " · " +
    d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) +
    " hs"
  );
}

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
  "al dia": { label: "✅ Video al día", cls: "text-emerald-700 dark:text-emerald-400" },
  "por vencer": { label: "🟡 Video por vencer", cls: "text-amber-700 dark:text-amber-400" },
  vencido: { label: "🔴 Video vencido", cls: "text-rose-700 dark:text-rose-400" },
  "sin video": { label: "⚪ Sin video", cls: "text-slate-500 dark:text-neutral-400" },
};

export default function ChoferNotas() {
  const { user, profile } = useAuth();
  const crm = useCrmData();
  const [search, setSearch] = useState("");
  const [clienteSel, setClienteSel] = useState(null); // fila completa de crm.clientes
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [notasCliente, setNotasCliente] = useState([]);
  const [recientes, setRecientes] = useState([]);
  const [ubicaciones, setUbicaciones] = useState(null); // Map contabiliumId -> {direccion, ciudad, provincia, cp}

  useEffect(() => {
    let cancelled = false;
    getClientesConUbicacion()
      .then(({ items }) => {
        if (cancelled) return;
        const map = new Map();
        for (const it of items) map.set(it.contabiliumId, it);
        setUbicaciones(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Solo clientes ya vinculados a una cuenta de Samurai (tienen uid) — las
  // notas quedan ligadas a esa cuenta, igual que el resto del CRM.
  const clientesConUid = useMemo(
    () => (crm.clientes || []).filter((c) => c.tipo === "Samurai" && c.uid),
    [crm.clientes]
  );

  const resultados = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return clientesConUid.filter((c) => (c.nombre || "").toLowerCase().includes(q)).slice(0, 10);
  }, [clientesConUid, search]);

  const ubicacionSel = clienteSel && ubicaciones ? ubicaciones.get(clienteSel.contabiliumId) : null;
  const waSel = clienteSel ? normalizarTelefonoWhatsapp(clienteSel.telefono) : null;
  const videoBadgeSel = clienteSel?.videoEstado ? VIDEO_BADGE[clienteSel.videoEstado] : null;

  useEffect(() => {
    const unsub = subscribeNotasEntregaRecientes((notas) => setRecientes(notas.slice(0, 15)));
    return unsub;
  }, []);

  useEffect(() => {
    if (!clienteSel) {
      setNotasCliente([]);
      return;
    }
    const unsub = subscribeNotasEntregaPorCliente(clienteSel.uid, setNotasCliente);
    return unsub;
  }, [clienteSel]);

  async function handleGuardar() {
    if (!clienteSel || !texto.trim() || !user) return;
    setGuardando(true);
    try {
      await addNotaEntrega({
        clienteUid: clienteSel.uid,
        clienteNombre: clienteSel.nombre,
        clienteContabiliumId: clienteSel.contabiliumId,
        choferUid: user.uid,
        choferNombre: profile?.name || user.email || "Chofer",
        texto,
      });
      setTexto("");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">📝 Notas de entrega</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Buscá a qué cliente vas a ver — te tira su dirección y datos — y dejale una nota de la entrega.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          ¿A qué cliente vas a ver?
        </label>
        <input
          type="text"
          value={clienteSel ? clienteSel.nombre : search}
          onChange={(e) => {
            setClienteSel(null);
            setSearch(e.target.value);
          }}
          placeholder="Nombre del cliente…"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
        {!clienteSel && resultados.length > 0 && (
          <div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-100 dark:border-neutral-800">
            {resultados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setClienteSel(c);
                  setSearch("");
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800"
              >
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {clienteSel && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{clienteSel.nombre}</p>
              <button
                type="button"
                onClick={() => setClienteSel(null)}
                className="text-xs font-medium text-slate-400 hover:underline dark:text-neutral-500"
              >
                Cambiar
              </button>
            </div>

            {/* Ficha del cliente: todos los datos que necesita el chofer para ir */}
            <div className="mt-2 space-y-1 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-800/50">
              <p className="text-slate-500 dark:text-neutral-400">CUIT: {clienteSel.cuit || "—"}</p>
              {waSel ? (
                <p>
                  📞{" "}
                  <a
                    href={`https://wa.me/${waSel}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    {clienteSel.telefono} — WhatsApp →
                  </a>
                </p>
              ) : (
                <p className="text-slate-400 dark:text-neutral-500">📞 Sin teléfono cargado</p>
              )}
              {!ubicaciones ? (
                <p className="text-slate-400 dark:text-neutral-500">📍 Buscando dirección…</p>
              ) : ubicacionSel ? (
                <p className="text-slate-700 dark:text-neutral-300">
                  📍 {ubicacionSel.direccion ? `${ubicacionSel.direccion}, ` : ""}
                  {[ubicacionSel.ciudad, ubicacionSel.provincia].filter(Boolean).join(", ")}
                  {ubicacionSel.cp ? ` (CP ${ubicacionSel.cp})` : ""}
                </p>
              ) : (
                <p className="text-slate-400 dark:text-neutral-500">📍 Sin dirección cargada en Contabilium</p>
              )}
              <p className={clienteSel.tieneDeposito ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-sky-700 dark:text-sky-400"}>
                {clienteSel.tieneDeposito ? "🟢 Con depósito consignado" : "🔵 Comprador (sin depósito)"}
              </p>
              {videoBadgeSel && <p className={`font-medium ${videoBadgeSel.cls}`}>{videoBadgeSel.label}</p>}
            </div>

            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Ej: no había nadie, reprogramar para el viernes…"
              rows={3}
              className="mt-3 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            />
            <button
              onClick={handleGuardar}
              disabled={guardando || !texto.trim()}
              className="mt-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar nota"}
            </button>

            {notasCliente.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
                <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400">Notas anteriores de este cliente</p>
                {notasCliente.map((n) => (
                  <div key={n.id} className="rounded-xl border border-slate-100 p-2.5 text-xs dark:border-neutral-800">
                    <p className="text-slate-700 dark:text-neutral-300">{n.texto}</p>
                    <div className="mt-1 flex items-center justify-between text-slate-400 dark:text-neutral-500">
                      <span>{n.choferNombre} · {formatFechaHora(n.createdAt)}</span>
                      {n.choferUid === user?.uid && (
                        <button onClick={() => deleteNotaEntrega(n.id)} className="text-rose-500 hover:underline">
                          Borrar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Últimas notas (todos los clientes)</p>
        {recientes.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-neutral-500">Todavía no hay notas cargadas.</p>
        ) : (
          <div className="space-y-2">
            {recientes.map((n) => (
              <div key={n.id} className="rounded-xl border border-slate-100 p-2.5 text-xs dark:border-neutral-800">
                <p className="font-semibold text-slate-700 dark:text-neutral-300">{n.clienteNombre}</p>
                <p className="mt-0.5 text-slate-600 dark:text-neutral-400">{n.texto}</p>
                <p className="mt-1 text-slate-400 dark:text-neutral-500">{n.choferNombre} · {formatFechaHora(n.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
