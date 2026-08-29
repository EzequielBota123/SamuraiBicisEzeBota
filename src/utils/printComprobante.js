const TIPO_LABEL = { FCA: 'Factura A', NCA: 'Nota de Crédito A', NDA: 'Nota de Débito A' };
const LOGO_URL = 'https://samurai.ar/img/samurai-negro-total.png';

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function money(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n ?? 0);
}

export function printComprobante(comprobante) {
  const tipo = TIPO_LABEL[comprobante.Tipo] || comprobante.Tipo;
  const items = Array.isArray(comprobante.Items) ? comprobante.Items : [];

  const rowsHtml = items.map((item) => `
    <tr>
      <td>${item.Concepto || item.Descripcion || '—'}</td>
      <td class="right">${item.Cantidad ?? 0}</td>
      <td class="right">${money(item.PrecioUnitario)}</td>
      <td class="right">${money(item.Total ?? (Number(item.PrecioUnitario) || 0) * (Number(item.Cantidad) || 0))}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Samurai — ${tipo} ${comprobante.Numero || comprobante.Id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #1e293b; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
    .logo { height: 48px; }
    .title-block { text-align: right; }
    .title-block h1 { font-size: 20px; font-weight: 700; }
    .title-block p { margin-top: 4px; color: #64748b; font-size: 13px; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
    .meta-group h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 8px; }
    .meta-group p { font-size: 13px; color: #1e293b; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #f8fafc; }
    th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; border-bottom: 1px solid #e2e8f0; }
    td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .right { text-align: right; }
    .totals { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; margin-top: 16px; }
    .total-row { display: flex; gap: 24px; }
    .total-label { color: #64748b; }
    .total-value { font-weight: 600; min-width: 140px; text-align: right; }
    .total-final .total-label,
    .total-final .total-value { font-size: 16px; font-weight: 700; color: #1e293b; }
    .footer { margin-top: 48px; text-align: center; font-size: 11px; color: #94a3b8; }
    @media print { body { padding: 24px; } }
  </style>
</head>
<body>
  <div class="header">
    <img src="${LOGO_URL}" alt="Samurai" class="logo" onerror="this.style.display='none'" />
    <div class="title-block">
      <h1>${tipo} N° ${comprobante.Numero || comprobante.Id}</h1>
      <p>Fecha: ${fmtDate(comprobante.Fecha)}</p>
      ${comprobante.FechaVencimiento ? `<p>Vencimiento: ${fmtDate(comprobante.FechaVencimiento)}</p>` : ''}
    </div>
  </div>

  <hr />

  <div class="meta">
    <div class="meta-group">
      <h3>Cliente</h3>
      <p>${comprobante.RazonSocial || '—'}</p>
    </div>
    <div class="meta-group">
      <h3>Estado</h3>
      <p>Total: ${money(comprobante.Total)}</p>
      ${comprobante.Saldo !== undefined ? `<p>Saldo pendiente: ${money(comprobante.Saldo)}</p>` : ''}
    </div>
  </div>

  ${items.length > 0 ? `
  <table>
    <thead>
      <tr>
        <th>Descripción</th>
        <th class="right">Cantidad</th>
        <th class="right">P. Unitario</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ` : ''}

  <div class="totals">
    <div class="total-row total-final">
      <span class="total-label">Total</span>
      <span class="total-value">${money(comprobante.Total)}</span>
    </div>
    ${comprobante.Saldo !== undefined ? `
    <div class="total-row">
      <span class="total-label">Saldo pendiente</span>
      <span class="total-value">${money(comprobante.Saldo)}</span>
    </div>` : ''}
  </div>

  <div class="footer">
    <p>Samurai Bicis — Mayorista de bicicletas — samurai.ar</p>
  </div>

  <script>window.onload = function () { window.print(); };<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
