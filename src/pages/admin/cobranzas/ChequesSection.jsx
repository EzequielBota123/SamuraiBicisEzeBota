// src/pages/admin/cobranzas/ChequesSection.jsx
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../../../firebase";
import ChequeRow, { calcularEstadoCheque } from "../../../components/crm/ChequeRow";
import { cargarChequeManual } from "../../../services/comprobantes";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const FILTROS = [
  { key: "pendiente", label: "🕓 Pendientes de imputar" },
  { key: "entregado", label: "📤 Entregados a terceros" },
  { key: "imputado", label: "✓ Imputados" },
  { key: "rechazado", label: "✕ Rechazados" },
  { key: "todos", label: "Todos" },
];

// Carga un cheque DE VERDAD en Tesorería > Cheques de Contabilium (no en
// `chequesRegistrados`, que es solo la cartera interna de Samurai) — vía
// automatización web, ver cargarChequeWeb en contabiliumWebAutomation.js.
// Los mismos campos que el alta de Contabilium, pero con menos fricción: el
// banco se escribe como texto libre y el backend lo resuelve por nombre.
function CargarChequeContabiliumForm({ onClose }) {
  const [esPropio, setEsPropio] = useState(false);
  const [banco, setBanco] = useState("");
  const [numero, setNumero] = useState("");
  const [importe, setImporte] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [fechaCobro, setFechaCobro] = useState("");
  const [emisor, setEmisor] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResultado(null);
    if (!banco.trim() || !numero.trim() || !importe || !fechaEmision || !fechaCobro) {
      setError("Completá banco, número, importe y las dos fechas.");
      return;
    }
    setEnviando(true);
    try {
      const r = await cargarChequeManual({
        banco: banco.trim(),
        numero: numero.trim(),
        importe: Number(importe),
        fechaEmision,
        fechaCobro,
        emisor: emisor.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        esPropio,
      });
      setResultado(r);
    } catch (err) {
      setError(err.message || "No se pudo cargar el cheque");
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
        <p className="font-semibold text-emerald-700 dark:text-emerald-400">
          ✅ Cheque cargado en Contabilium — banco {resultado.bancoNombre || `#${resultado.idBanco}`}, ID {resultado.idCheque}.
        </p>
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-500">
          Ojo: esto solo lo agrega a la cartera general de Tesorería. Imputarlo a un cliente/factura es un paso aparte, todavía manual en Contabilium.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-neutral-900 dark:text-emerald-400"
        >
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900 sm:grid-cols-2"
    >
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={esPropio} onChange={(e) => setEsPropio(e.target.checked)} />
        ¿Es cheque propio?
      </label>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Banco *</label>
        <input
          type="text"
          value={banco}
          onChange={(e) => setBanco(e.target.value)}
          placeholder="Ej: Banco Galicia"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Nro. de Cheque *</label>
        <input
          type="text"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Emisor</label>
        <input
          type="text"
          value={emisor}
          onChange={(e) => setEmisor(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Importe *</label>
        <input
          type="number"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Fecha emisión *</label>
        <input
          type="date"
          value={fechaEmision}
          onChange={(e) => setFechaEmision(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Fecha de cobro *</label>
        <input
          type="date"
          value={fechaCobro}
          onChange={(e) => setFechaCobro(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Observaciones</label>
        <input
          type="text"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      {error && <p className="text-xs text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {enviando ? "Cargando…" : "✓ Cargar cheque en Contabilium"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// Sección de cheques embebida en Cobranzas — ventana global de cheques
// recibidos de todos los clientes juntos, para saber de un vistazo qué
// cheques tenemos en cartera sin imputar todavía, y a quién se los dimos
// en los casos que se usaron para pagarle a un tercero.
export default function ChequesSection() {
  const [cheques, setCheques] = useState(null);
  const [filtro, setFiltro] = useState("pendiente");
  const [busqueda, setBusqueda] = useState("");
  const [cargarAbierto, setCargarAbierto] = useState(false);

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

      {!cargarAbierto ? (
        <button
          type="button"
          onClick={() => setCargarAbierto(true)}
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
        >
          🏦 Cargar cheque en Contabilium (Tesorería)
        </button>
      ) : (
        <CargarChequeContabiliumForm onClose={() => setCargarAbierto(false)} />
      )}

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
