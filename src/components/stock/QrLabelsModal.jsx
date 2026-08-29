import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

export default function QrLabelsModal({ open, onClose, items }) {
  const [selected, setSelected] = useState(() => new Set());
  const [qrDataUrls, setQrDataUrls] = useState({});

  useEffect(() => {
    if (open) setSelected(new Set((items || []).map((it) => it.sku)));
  }, [open, items]);

  const selectedItems = useMemo(
    () => (items || []).filter((it) => selected.has(it.sku)),
    [items, selected]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const missing = selectedItems.filter((it) => it.sku && !qrDataUrls[it.sku]);
      if (missing.length === 0) return;
      const entries = await Promise.all(
        missing.map(async (it) => [it.sku, await QRCode.toDataURL(it.sku, { margin: 1, width: 220 })])
      );
      if (cancelled) return;
      setQrDataUrls((prev) => {
        const next = { ...prev };
        for (const [sku, url] of entries) next[sku] = url;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedItems, qrDataUrls]);

  function toggle(sku) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 print:static print:bg-white sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl print:max-h-none print:overflow-visible print:rounded-none print:p-0 print:shadow-none dark:bg-neutral-900 dark:print:bg-white sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between print:hidden">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">🏷️ Etiquetas QR para tus bicis</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-500">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500 print:hidden dark:text-neutral-400">
          Mismo código que ya viene en la caja de cada bici. Imprimí y pegá el sticker cuando la armes, así el
          escáner la sigue reconociendo aunque ya no tengas la caja.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <button
            onClick={() => setSelected(new Set((items || []).map((it) => it.sku)))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            Seleccionar todas
          </button>
          <button
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-rose-400 hover:text-rose-600 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            Ninguna
          </button>
          <button
            onClick={() => window.print()}
            disabled={selected.size === 0}
            className="ml-auto rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 disabled:opacity-50"
          >
            🖨️ Imprimir ({selected.size})
          </button>
        </div>

        <ul className="mb-5 grid grid-cols-1 gap-2 print:hidden sm:grid-cols-2">
          {(items || []).map((it) => (
            <li key={it.sku || it.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900">
                <input
                  type="checkbox"
                  checked={selected.has(it.sku)}
                  onChange={() => toggle(it.sku)}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-slate-50 dark:bg-neutral-800">
                  {it.imageUrl && <img src={it.imageUrl} alt={it.name} className="h-full w-full object-contain" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-900 dark:text-white">{it.name}</p>
                  <p className="text-[11px] text-slate-400 dark:text-neutral-500">SKU: {it.sku}</p>
                </div>
              </label>
            </li>
          ))}
        </ul>

        {selectedItems.length > 0 && (
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 p-4 print:grid-cols-3 print:gap-2 print:rounded-none print:border-none print:p-0 sm:grid-cols-3">
            {selectedItems.map((it) => (
              <div
                key={it.sku}
                className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-slate-300 p-2.5 text-center print:break-inside-avoid print:border-slate-400"
              >
                {qrDataUrls[it.sku] ? (
                  <img src={qrDataUrls[it.sku]} alt={it.sku} className="h-20 w-20" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center text-xs text-slate-400">…</div>
                )}
                <p className="line-clamp-2 text-[11px] font-semibold text-slate-900 print:text-black dark:text-white">
                  {it.name}
                </p>
                <p className="font-mono text-[10px] text-slate-500 print:text-black dark:text-neutral-400">{it.sku}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
