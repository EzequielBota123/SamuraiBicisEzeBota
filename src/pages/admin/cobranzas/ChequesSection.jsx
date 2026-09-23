// src/pages/admin/cobranzas/ChequesSection.jsx
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../../../firebase";
import ChequeRow, { calcularEstadoCheque } from "../../../components/crm/ChequeRow";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const FILTROS = [
  { key: "pendiente", label: "🕓 Pendientes de imputar" },
  { key: "entregado", label: "📤 Entregados a terceros" },
  { key: "imputado", label: "✓ Imputados" },
  { key: "rechazado", label: "✕ Rechazados" },
  { key: "todos", label: "Todos" },
];

// Sección de cheques embebida en Cobranzas — ventana global de cheques
// recibidos de todos los clientes juntos, para saber de un vistazo qué
// cheques tenemos en cartera sin imputar todavía, y a quién se los dimos
// en los casos que se usaron para pagarle a un tercero.
export default function ChequesSection() {
  const [cheques, setCheques] = useState(null);
  const [filtro, setFiltro] = useState("pendiente");
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    const q = query(collection(db, "chequesRegistrados"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setCheques(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const contadores = useMemo(() => {
    const base = { pendiente: 0, entregado: 0, imputado: 0, rechazado: 0 };
    for (const ch of cheques || []) {
      const estado = calcularEstadoCheque(ch);
      if (base[estado] != null) base[estado]++;
    }
    return base;
  }, [cheques]);

  const filtrados = useMemo(() => {
    if (!cheques) return [];
    let base = filtro === "todos" ? cheques : cheques.filter((ch) => calcularEstadoCheque(ch) === filtro);
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase();
      base = base.filter((ch) =>
        `${ch.clienteName || ""} ${ch.nroCheque || ""} ${ch.entregadoA || ""}`.toLowerCase().includes(q)
      );
    }
    return base;
  }, [cheques, filtro, busqueda]);

  const totalPendiente = (cheques || [])
    .filter((ch) => calcularEstadoCheque(ch) === "pendiente")
    .reduce((acc, ch) => acc + Number(ch.monto || 0), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-neutral-400">
        {cheques === null
          ? "Cargando…"
          : `${cheques.length} cheques registrados en total · ${money(totalPendiente)} pendientes de imputar (${contadores.pendiente})`}
      </p>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              filtro === f.key
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            {f.label}
            {f.key !== "todos" && ` (${contadores[f.key]})`}
          </button>
        ))}
      </div>

      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por cliente, N° de cheque o a quién se lo dieron"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
      />

      {cheques === null && <p className="text-sm text-slate-400 dark:text-neutral-500">Cargando…</p>}

      {cheques !== null && (
        <div className="space-y-2">
          {filtrados.map((ch) => (
            <ChequeRow
              key={ch.id}
              cheque={ch}
              mostrarCliente
              otrosChequesCliente={(cheques || []).filter((o) => o.contabiliumId === ch.contabiliumId)}
              onChanged={() => {}}
            />
          ))}
          {filtrados.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-neutral-500">Sin resultados.</p>
          )}
        </div>
      )}
    </div>
  );
}
