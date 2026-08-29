import { useState } from "react";
import { reportarPagoCuentaCorriente } from "../../services/comprobantes";

export default function PagoCCModal({ open, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState(null);

  if (!open) return null;

  function handleClose() {
    setFile(null);
    setMonto("");
    setFecha(new Date().toISOString().slice(0, 10));
    setNota("");
    setError("");
    setResultado(null);
    onClose();
  }

  async function handleEnviar() {
    if (!file || !monto || !fecha) {
      setError("Completá el comprobante, el monto y la fecha.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const r = await reportarPagoCuentaCorriente(file, Number(monto), fecha, nota);
      setResultado(r);
      onSuccess?.();
    } catch (err) {
      setError(err.message || "No se pudo enviar el comprobante.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">💳 Subir comprobante de pago</h3>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {resultado ? (
          <div className="space-y-3">
            {resultado.confirmadoAutomaticamente ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                ✓ Encontramos tu pago en el sistema — ya está confirmado, no hace falta que hagas nada más.
              </p>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                📋 Recibimos tu comprobante. Todavía no lo encontramos automáticamente entre los pagos ya registrados — el equipo lo va a revisar a mano y te va a confirmar.
              </p>
            )}
            <button onClick={handleClose} className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Comprobante (foto o PDF)</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Monto pagado</label>
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="Ej: 305000"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Fecha del pago</label>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Nota (opcional)</label>
                <input
                  type="text"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Ej: transferencia desde Banco Galicia"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
                />
              </div>
            </div>

            {error && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

            <button
              onClick={handleEnviar}
              disabled={uploading}
              className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {uploading ? "Enviando…" : "Enviar comprobante"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
