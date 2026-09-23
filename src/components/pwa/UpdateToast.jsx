import { useEffect, useState } from "react";

// Aviso de "hay una versión nueva" — reemplaza el recargo automático que
// hacía main.jsx antes, que cortaba lo que el usuario estuviera haciendo
// cada vez que Samurai deployaba algo nuevo. Ahora se le avisa y decide.
export default function UpdateToast() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onNeedRefresh() {
      setShow(true);
    }
    window.addEventListener("samurai:sw-need-refresh", onNeedRefresh);
    return () => window.removeEventListener("samurai:sw-need-refresh", onNeedRefresh);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[10000] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
      <span className="text-slate-700 dark:text-neutral-200">🔄 Hay una versión nueva de Samurai</span>
      <button
        onClick={() => window.__samuraiUpdateSW?.(true)}
        className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-neutral-200"
      >
        Actualizar
      </button>
      <button
        onClick={() => setShow(false)}
        className="text-xs text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
      >
        Después
      </button>
    </div>
  );
}
