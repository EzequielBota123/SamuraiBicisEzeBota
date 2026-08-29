import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function formatFecha(fecha) {
  if (!fecha) return "-";
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("es-AR");
}

// Cheques tal cual quedaron cargados en Contabilium (vienen dentro de
// formasDePago de cada cobranza ya sincronizada) — a diferencia de
// ChequesSection (cartera física que carga el staff a mano con foto), esto
// es el registro "oficial" de la cuenta corriente, útil para cruzar contra
// lo que se tiene físicamente. Se arma agrupando por cliente para poder ver
// de un vistazo todos los cheques históricos de un cliente puntual.
function extraerCheques(cobranzas) {
  const out = [];
  for (const c of cobranzas || []) {
    const formas = c.formasDePago || [];
    formas.forEach((f, i) => {
      if (!/cheque|echeq/i.test(f.FormaDePago || "")) return;
      out.push({
        key: `${c.contabiliumId}-${i}`,
        idPersona: c.idPersona,
        razonSocial: c.razonSocial,
        nroDocumento: c.nroDocumento,
        nroCheque: f.NroReferencia || null,
        importe: Number(f.Importe || 0),
        cobranzaNumero: c.numero,
        fecha: c.fecha,
      });
    });
  }
  return out;
}

export default function ChequesContabiliumSection({ cobranzas }) {
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState(null);

  const cheques = useMemo(() => extraerCheques(cobranzas), [cobranzas]);

  const porCliente = useMemo(() => {
    const map = new Map();
    for (const ch of cheques) {
      const key = ch.idPersona ?? `sin-vinculo-${ch.nroDocumento || ch.razonSocial}`;
      if (!map.has(key)) map.set(key, { idPersona: ch.idPersona, razonSocial: ch.razonSocial, nroDocumento: ch.nroDocumento, cheques: [] });
      map.get(key).cheques.push(ch);
    }
    return Array.from(map.values())
      .map((g) => ({ ...g, total: g.cheques.reduce((acc, c) => acc + c.importe, 0), cantidad: g.cheques.length }))
      .sort((a, b) => b.total - a.total || (a.razonSocial || "").localeCompare(b.razonSocial || ""));
  }, [cheques]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return porCliente;
    return porCliente.filter((g) => `${g.razonSocial || ""} ${g.nroDocumento || ""}`.toLowerCase().includes(q));
  }, [porCliente, busqueda]);

  const totalGeneral = cheques.reduce((acc, c) => acc + c.importe, 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-neutral-400">
        {cheques.length} cheque{cheques.length === 1 ? "" : "s"} en Contabilium · {porCliente.length} cliente{porCliente.length === 1 ? "" : "s"} · {money(totalGeneral)} en total
      </p>

      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar cliente o CUIT"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
      />

      <div className="space-y-2">
        {filtrados.map((g) => {
          const key = g.idPersona ?? g.razonSocial;
          const isOpen = abierto === key;
          return (
            <div key={key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <button
                onClick={() => setAbierto(isOpen ? null : key)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  {g.idPersona ? (
                    <Link
                      to={`/admin/clientes-360?buscar=${encodeURIComponent(g.razonSocial || "")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-sky-700 hover:underline dark:text-sky-400"
                    >
                      {g.razonSocial || "(sin nombre)"}
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-700 dark:text-neutral-300">{g.razonSocial || "(sin nombre)"}</span>
                  )}
                  <span className="ml-2 text-xs text-slate-400 dark:text-neutral-500">
                    {g.nroDocumento} · {g.cantidad} cheque{g.cantidad === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{money(g.total)}</span>
                  <span className="text-slate-400">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>
              {isOpen && (
                <div className="space-y-1.5 border-t border-slate-100 px-4 py-3 dark:border-neutral-800">
                  {g.cheques
                    .slice()
                    .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
                    .map((c) => (
                      <div
                        key={c.key}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-neutral-800/50"
                      >
                        <span className="text-slate-600 dark:text-neutral-300">
                          Cheque Nº {c.nroCheque || "s/d"} · cobranza Nº {c.cobranzaNumero} · {formatFecha(c.fecha)}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white">{money(c.importe)}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {filtrados.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-neutral-500">
            {cheques.length === 0 ? "No hay cheques cargados en Contabilium todavía." : "Sin resultados."}
          </p>
        )}
      </div>
    </div>
  );
}
