import { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { getClientComprobantes, getComprobanteDetail } from '../../services/comprobantes';
import { printComprobante } from '../../utils/printComprobante';


const TIPO_LABEL = { FCA: 'Factura A', NCA: 'Nota de Crédito A', NDA: 'Nota de Débito A' };
const TIPO_BADGE = {
  FCA: 'bg-blue-100 text-blue-800',
  NCA: 'bg-emerald-100 text-emerald-800',
  NDA: 'bg-amber-100 text-amber-800',
};

function money(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n ?? 0);
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isOverdue(fv) {
  if (!fv) return false;
  return new Date(fv + 'T23:59:59') < new Date();
}

function isDueSoon(fv, days = 7) {
  if (!fv) return false;
  const venc = new Date(fv + 'T23:59:59');
  const now = new Date();
  const limit = new Date(now.getTime() + days * 86400000);
  return venc >= now && venc <= limit;
}

function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center py-20 text-slate-400">
      <svg className="mr-3 h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }) {
  const border = { red: 'border-red-200 bg-red-50', green: 'border-emerald-200 bg-emerald-50', amber: 'border-amber-200 bg-amber-50', neutral: 'border-slate-200 bg-white' };
  const text = { red: 'text-red-700', green: 'text-emerald-700', amber: 'text-amber-700', neutral: 'text-slate-900' };
  return (
    <div className={`rounded-2xl border p-6 ${border[accent]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${text[accent]}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

function DownloadBtn({ loading, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      )}
      PDF
    </button>
  );
}

export default function MiCuentaPage() {
  const { user } = useAuth();
  const history = useHistory();
  const [comprobantes, setComprobantes] = useState([]);
  const [saldoTotal, setSaldoTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    if (!user) { history.push('/login'); return; }

let cancelled = false;
    setLoading(true);
    setError(null);

    getClientComprobantes()
      .then(({ items, saldoTotal }) => {
        if (cancelled) return;
        setComprobantes(items);
        setSaldoTotal(saldoTotal ?? 0);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user, history]);

  const vencidos = comprobantes.filter((c) => isOverdue(c.FechaVencimiento) && c.Saldo > 0);
  const porVencer = comprobantes.filter((c) => isDueSoon(c.FechaVencimiento) && c.Saldo > 0);

  const handlePdf = async (c) => {
    setDownloading(c.Id);
    try {
const detalle = await getComprobanteDetail(c.Id);
      printComprobante(detalle);
    } catch (err) {
      alert(`No se pudo obtener el comprobante: ${err.message}`);
    } finally {
      setDownloading(null);
    }
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Mi cuenta corriente</h1>
        <p className="mt-1 text-sm text-slate-500">Saldo y movimientos de tu cuenta.</p>
      </div>

      {loading && <Spinner label="Cargando movimientos..." />}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error.includes('sin vinculación')
            ? 'Tu cuenta aún no está sincronizada con nuestro sistema. Contactá al equipo comercial.'
            : `No se pudo cargar la cuenta corriente: ${error}`}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Tarjetas de resumen */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <SummaryCard
              label={saldoTotal > 0 ? 'Debés' : saldoTotal < 0 ? 'Tenés saldo a favor' : 'Al día'}
              value={money(saldoTotal)}
              accent={saldoTotal > 0 ? 'red' : 'green'}
              sub={saldoTotal < 0 ? 'Pagaste de más / tenés crédito a favor' : null}
            />
            <SummaryCard
              label="Comprobantes vencidos"
              value={vencidos.length}
              sub={vencidos.length > 0 ? money(vencidos.reduce((a, c) => a + (c.Saldo ?? 0), 0)) : null}
              accent={vencidos.length > 0 ? 'red' : 'neutral'}
            />
            <SummaryCard
              label="Vencen en 7 días"
              value={porVencer.length}
              sub={porVencer.length > 0 ? money(porVencer.reduce((a, c) => a + (c.Saldo ?? 0), 0)) : null}
              accent={porVencer.length > 0 ? 'amber' : 'neutral'}
            />
          </div>

          {/* Alertas */}
          {vencidos.length > 0 && (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5">
              <p className="mb-3 text-sm font-semibold text-red-800">
                {vencidos.length === 1
                  ? 'Tenés 1 comprobante vencido'
                  : `Tenés ${vencidos.length} comprobantes vencidos`}
              </p>
              <ul className="space-y-1">
                {vencidos.map((c) => (
                  <li key={c.Id} className="text-sm text-red-700">
                    {TIPO_LABEL[c.Tipo] || c.Tipo} {c.Numero} — vencido el {fmtDate(c.FechaVencimiento)} — saldo {money(c.Saldo)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {porVencer.length > 0 && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="mb-3 text-sm font-semibold text-amber-800">
                {porVencer.length === 1
                  ? '1 comprobante vence en los próximos 7 días'
                  : `${porVencer.length} comprobantes vencen en los próximos 7 días`}
              </p>
              <ul className="space-y-1">
                {porVencer.map((c) => (
                  <li key={c.Id} className="text-sm text-amber-700">
                    {TIPO_LABEL[c.Tipo] || c.Tipo} {c.Numero} — vence el {fmtDate(c.FechaVencimiento)} — saldo {money(c.Saldo)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tabla de movimientos */}
          {comprobantes.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
              <p className="text-slate-400">No hay movimientos registrados.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-3 text-left">Tipo</th>
                      <th className="px-6 py-3 text-left">Número</th>
                      <th className="px-6 py-3 text-left">Fecha</th>
                      <th className="px-6 py-3 text-left">Vencimiento</th>
                      <th className="px-6 py-3 text-right">Total</th>
                      <th className="px-6 py-3 text-right">Saldo</th>
                      <th className="px-6 py-3 text-center">Descargar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {comprobantes.map((c) => {
                      const overdue = isOverdue(c.FechaVencimiento) && c.Saldo > 0;
                      const soon = isDueSoon(c.FechaVencimiento) && c.Saldo > 0;
                      return (
                        <tr
                          key={c.Id}
                          className={`transition-colors ${overdue ? 'bg-red-50/40' : soon ? 'bg-amber-50/40' : 'hover:bg-slate-50'}`}
                        >
                          <td className="px-6 py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIPO_BADGE[c.Tipo] || 'bg-slate-100 text-slate-700'}`}>
                              {TIPO_LABEL[c.Tipo] || c.Tipo}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-mono text-sm text-slate-700">{c.Numero || c.Id}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{fmtDate(c.Fecha)}</td>
                          <td className="px-6 py-4 text-sm">
                            {c.FechaVencimiento ? (
                              <span className={overdue ? 'font-semibold text-red-600' : soon ? 'font-semibold text-amber-600' : 'text-slate-600'}>
                                {fmtDate(c.FechaVencimiento)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900">
                            {money(c.Total)}
                          </td>
                          <td className="px-6 py-4 text-right text-sm">
                            <span className={
                              c.Saldo > 0
                                ? overdue ? 'font-semibold text-red-600' : 'font-semibold text-slate-900'
                                : 'text-emerald-600'
                            }>
                              {money(c.Saldo)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <DownloadBtn
                              loading={downloading === c.Id}
                              onClick={() => handlePdf(c)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
