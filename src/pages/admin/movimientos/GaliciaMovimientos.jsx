// src/pages/admin/movimientos/GaliciaMovimientos.jsx
import { useEffect, useState } from "react";
import { getGaliciaSaldos, solicitarGaliciaMovimientos, descargarGaliciaMovimientos } from "../../../services/comprobantes";

const money = (n, currency = "ARS") =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 2 });

const LS_KEY = "galiciaExtractoPendiente";

function fechaISO(diasAtras) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10);
}

// A diferencia de Mercado Pago, Galicia no entrega los movimientos al
// instante: hay que pedir un extracto (queda PENDING) y Galicia lo procesa
// por lote cada ~30 min. Por eso este componente guarda el id del extracto
// pedido en localStorage — así si el admin cierra la pestaña y vuelve más
// tarde, retoma el mismo extracto en vez de pedir uno nuevo.
export default function GaliciaMovimientos() {
  const [saldos, setSaldos] = useState(null);
  const [cargandoSaldos, setCargandoSaldos] = useState(true);
  const [errorSaldos, setErrorSaldos] = useState("");

  const [rangoDias, setRangoDias] = useState(30);
  const [extracto, setExtracto] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [movimientos, setMovimientos] = useState(null);
  const [header, setHeader] = useState(null);
  const [cargandoExtracto, setCargandoExtracto] = useState(false);
  const [errorExtracto, setErrorExtracto] = useState("");

  useEffect(() => {
    (async () => {
      setCargandoSaldos(true);
      setErrorSaldos("");
      try {
        const res = await getGaliciaSaldos();
        setSaldos(res?.data?.[0] || null);
      } catch (e) {
        setErrorSaldos(e.message || "No se pudieron traer los saldos de Galicia");
      } finally {
        setCargandoSaldos(false);
      }
    })();
  }, []);

  // Si ya había un extracto pedido (guardado en localStorage), intentamos
  // descargarlo apenas se monta la pantalla.
  useEffect(() => {
    if (extracto?.id) chequearExtracto(extracto.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cuentaArs = saldos?.accounts_cc?.find((c) => c.currency === "ARS") || saldos?.accounts_cc?.[0] || null;

  async function pedirExtracto() {
    if (!cuentaArs) return;
    setCargandoExtracto(true);
    setErrorExtracto("");
    setMovimientos(null);
    try {
      const data = await solicitarGaliciaMovimientos(cuentaArs.number, fechaISO(rangoDias), fechaISO(0));
      setExtracto(data);
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      await chequearExtracto(data.id);
    } catch (e) {
      setErrorExtracto(e.message || "No se pudo solicitar el extracto");
    } finally {
      setCargandoExtracto(false);
    }
  }

  async function chequearExtracto(extractoId) {
    setCargandoExtracto(true);
    setErrorExtracto("");
    try {
      const res = await descargarGaliciaMovimientos(extractoId);
      if (res.status === "PROCESSED") {
        setMovimientos(res.movimientos || []);
        setHeader(res.header || null);
        localStorage.removeItem(LS_KEY);
        setExtracto((prev) => (prev ? { ...prev, status: "PROCESSED" } : prev));
      } else {
        setExtracto((prev) => (prev ? { ...prev, status: res.status } : prev));
      }
    } catch (e) {
      setErrorExtracto(e.message || "No se pudo consultar el extracto");
    } finally {
      setCargandoExtracto(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">🏛️ Banco Galicia — Open Galicia (QA)</p>
        <p className="text-xs text-slate-500 dark:text-neutral-400">
          Conectado por API. Ambiente de homologación (QA) — cuando el banco habilite el acceso de producción, se cambia el host y ya
          queda funcionando con la cuenta real.
        </p>
      </div>

      {errorSaldos && <p className="text-sm text-rose-600 dark:text-rose-400">{errorSaldos}</p>}
      {cargandoSaldos && <p className="text-sm text-slate-400 dark:text-neutral-500">Consultando saldos…</p>}

      {saldos && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(saldos.accounts_cc || []).map((c) => (
            <div key={c.number} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-slate-500 dark:text-neutral-400">Cuenta Corriente · {c.currency}</p>
              <p className={`mt-1 text-lg font-bold ${c.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white"}`}>
                {money(c.balance, c.currency)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">IBAN {c.iban}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Movimientos de cuenta</p>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Galicia procesa el extracto por lote (no es instantáneo) — puede tardar hasta ~30 minutos en estar listo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={rangoDias}
              onChange={(e) => setRangoDias(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value={7}>7 días</option>
              <option value={15}>15 días</option>
              <option value={30}>30 días</option>
              <option value={90}>90 días</option>
            </select>
            <button
              onClick={pedirExtracto}
              disabled={cargandoExtracto || !cuentaArs}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              {cargandoExtracto ? "Consultando…" : "📄 Pedir extracto"}
            </button>
          </div>
        </div>

        {errorExtracto && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{errorExtracto}</p>}

        {extracto && !movimientos && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
            <p>
              Extracto <b>{extracto.name}</b> — estado: <b>{extracto.status}</b>
            </p>
            {extracto.status !== "PROCESSED" && (
              <button
                onClick={() => chequearExtracto(extracto.id)}
                disabled={cargandoExtracto}
                className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1 font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-neutral-900"
              >
                🔄 Volver a consultar
              </button>
            )}
          </div>
        )}

        {movimientos && (
          <div className="mt-3 overflow-x-auto">
            {header && <p className="mb-2 text-[10px] text-slate-400 dark:text-neutral-500">Columnas del extracto: {header}</p>}
            {movimientos.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400 dark:text-neutral-500">Sin movimientos en este período.</p>
            ) : (
              <table className="min-w-full divide-y divide-slate-100 text-xs dark:divide-neutral-800">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-neutral-400">
                    {Object.keys(movimientos[0])
                      .filter((k) => !["DebitosNum", "CreditosNum", "SaldoNum"].includes(k))
                      .map((k) => (
                        <th key={k} className="px-3 py-2 font-semibold">
                          {k}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-neutral-900">
                  {movimientos.map((m, i) => (
                    <tr key={i}>
                      {Object.keys(movimientos[0])
                        .filter((k) => !["DebitosNum", "CreditosNum", "SaldoNum"].includes(k))
                        .map((k) => (
                          <td key={k} className="whitespace-nowrap px-3 py-2 text-slate-700 dark:text-neutral-300">
                            {m[k]}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
