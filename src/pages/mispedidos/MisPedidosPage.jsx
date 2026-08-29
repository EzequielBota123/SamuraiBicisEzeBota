import { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { getClientComprobantes } from '../../services/comprobantes';
import PagoCCModal from '../../components/stock/PagoCCModal';


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

function isOverdue(fechaVencimiento) {
  if (!fechaVencimiento) return false;
  return new Date(fechaVencimiento + 'T23:59:59') < new Date();
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20 text-slate-400">
      <svg className="mr-3 h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      Cargando comprobantes...
    </div>
  );
}

export default function MisPedidosPage() {
  const { user } = useAuth();
  const history = useHistory();
  const [comprobantes, setComprobantes] = useState([]);
  const [saldoTotal, setSaldoTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tipoFiltro, setTipoFiltro] = useState('all');
  const [pagoModalOpen, setPagoModalOpen] = useState(false);

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

  const filtered = tipoFiltro === 'all'
    ? comprobantes
    : comprobantes.filter((c) => c.Tipo === tipoFiltro);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Mis comprobantes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Facturas y notas de crédito/débito de los últimos 2 años.
        </p>
      </div>

      {!loading && !error && (
        <div
          className={`mb-6 rounded-2xl border p-6 ${
            saldoTotal > 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {saldoTotal > 0 ? 'Debés' : saldoTotal < 0 ? 'Tenés saldo a favor' : 'Saldo total'}
          </p>
          <p className={`mt-2 text-3xl font-bold ${saldoTotal > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {money(saldoTotal)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {saldoTotal > 0
              ? 'Tenés saldo pendiente de pago.'
              : saldoTotal < 0
              ? 'Pagaste de más / tenés crédito a favor.'
              : 'Estás al día, sin saldo pendiente.'}
          </p>
          <button
            onClick={() => setPagoModalOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            💳 Subir comprobante de pago
          </button>
        </div>
      )}

      <PagoCCModal open={pagoModalOpen} onClose={() => setPagoModalOpen(false)} />

      <div className="mb-6 flex flex-wrap gap-2">
        {['all', 'FCA', 'NCA', 'NDA'].map((tipo) => (
          <button
            key={tipo}
            onClick={() => setTipoFiltro(tipo)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              tipoFiltro === tipo
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tipo === 'all' ? 'Todos' : TIPO_LABEL[tipo]}
          </button>
        ))}
      </div>

      {loading && <Spinner />}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error.includes('sin vinculación')
            ? 'Tu cuenta aún no está sincronizada con nuestro sistema. Contactá al equipo comercial.'
            : `No se pudieron cargar los comprobantes: ${error}`}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
          <p className="text-slate-400">No hay comprobantes para mostrar.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const overdue = isOverdue(c.FechaVencimiento) && c.Saldo > 0;
                  return (
                    <tr key={c.Id} className="transition-colors hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIPO_BADGE[c.Tipo] || 'bg-slate-100 text-slate-700'}`}>
                          {TIPO_LABEL[c.Tipo] || c.Tipo}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-slate-700">
                        {c.Numero || c.Id}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{fmtDate(c.Fecha)}</td>
                      <td className="px-6 py-4 text-sm">
                        {c.FechaVencimiento ? (
                          <span className={overdue ? 'font-semibold text-red-600' : 'text-slate-600'}>
                            {fmtDate(c.FechaVencimiento)}
                            {overdue && <span className="ml-1 text-xs">(vencido)</span>}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900">
                        {money(c.Total)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        <span className={
                          c.Saldo > 0
                            ? overdue ? 'font-semibold text-red-600' : 'font-semibold text-amber-600'
                            : 'text-emerald-600'
                        }>
                          {money(c.Saldo)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
