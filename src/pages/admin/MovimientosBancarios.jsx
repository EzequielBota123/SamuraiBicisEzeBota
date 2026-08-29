// src/pages/admin/MovimientosBancarios.jsx
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { subscribeCobranzas } from "../../services/cobranzas";
import ConciliacionBancaria from "./cobranzas/ConciliacionBancaria";
import MercadoPagoMovimientos from "./movimientos/MercadoPagoMovimientos";

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

const TABS = [
  { id: "mercadopago", label: "💳 Mercado Pago", sub: "Conectado por API" },
  { id: "galicia", label: "🏦 Banco Galicia", sub: "API (Open Galicia) — pendiente de conectar" },
  { id: "supervielle", label: "🏦 Supervielle", sub: "Extracto manual" },
  { id: "santander", label: "🏦 Santander Río", sub: "Extracto manual" },
];

// Pantalla central de todos los movimientos bancarios, separada por banco —
// antes esto vivía mezclado dentro de Cobranzas. Mercado Pago se trae en
// vivo por API; Galicia va a sumarse por API (Open Galicia) apenas se
// consiga el acceso con el banco; Supervielle y Santander siguen siendo por
// extracto manual, como ya funcionaba.
export default function MovimientosBancarios() {
  const [tab, setTab] = useState("mercadopago");
  const [cobranzas, setCobranzas] = useState([]);
  const [clientesPorCuit, setClientesPorCuit] = useState(new Map());
  const [clientesPorEmail, setClientesPorEmail] = useState(new Map());

  useEffect(() => {
    const unsub = subscribeCobranzas(setCobranzas, () => {});
    return unsub;
  }, []);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "users"), where("kind", "==", "client")));
      const porCuit = new Map();
      const porEmail = new Map();
      snap.forEach((d) => {
        const u = d.data();
        const nombre = u.contabiliumDepositoNombre || u.name || "(sin nombre)";
        const cuit = onlyDigits(u.cuit);
        if (cuit) porCuit.set(cuit, { uid: d.id, name: nombre, contabiliumId: u.contabiliumId || null });
        if (u.contactEmail) porEmail.set(u.contactEmail.toLowerCase(), { uid: d.id, name: nombre, contabiliumId: u.contabiliumId || null });
        if (u.contabiliumEmail) porEmail.set(u.contabiliumEmail.toLowerCase(), { uid: d.id, name: nombre, contabiliumId: u.contabiliumId || null });
      });
      setClientesPorCuit(porCuit);
      setClientesPorEmail(porEmail);
    })();
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">🏦 Movimientos Bancarios</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Todos los bancos y billeteras de Samurai en un solo lugar, separados por pestaña.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-xl border px-4 py-2.5 text-left text-sm font-semibold transition ${
              tab === t.id
                ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            <span className="block">{t.label}</span>
            <span className="block text-[10px] font-normal text-slate-400 dark:text-neutral-500">{t.sub}</span>
          </button>
        ))}
      </div>

      {tab === "mercadopago" && (
        <MercadoPagoMovimientos clientesPorCuit={clientesPorCuit} clientesPorEmail={clientesPorEmail} />
      )}

      {tab === "galicia" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400">
            <p className="font-semibold">🔌 Pendiente de conectar por API (Open Galicia)</p>
            <p className="mt-1 text-xs">
              Hay que escribir a <b>opengalicia@bancogalicia.com.ar</b> pidiendo acceso al servicio para la cuenta de Samurai. Mientras
              tanto, subí el extracto acá abajo como con los demás bancos.
            </p>
          </div>
          <ConciliacionBancaria cobranzas={cobranzas} bancoFiltro="galicia" />
        </div>
      )}

      {tab === "supervielle" && <ConciliacionBancaria cobranzas={cobranzas} bancoFiltro="supervielle" />}

      {tab === "santander" && <ConciliacionBancaria cobranzas={cobranzas} bancoFiltro="santander" />}
    </div>
  );
}
