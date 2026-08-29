import { useEffect, useState } from "react";

function getPlatform() {
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  const isChromiumBased = /chrome|chromium|crios|edg|brave|opr\//i.test(ua);
  const isSafari = /safari/i.test(ua) && !isChromiumBased && !/firefox|fxios/i.test(ua);

  if (isIos) return "ios";
  if (isSafari) return "macos-safari";
  return "other";
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

const INSTRUCTIONS = {
  ios: {
    title: "Instalar la app en iPhone",
    steps: [
      <>Tocá el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba) en la barra de Safari.</>,
      <>Elegí <strong>"Agregar a pantalla de inicio"</strong>.</>,
      <>Confirmá tocando <strong>"Agregar"</strong>.</>,
    ],
  },
  "macos-safari": {
    title: "Instalar la app en Safari",
    steps: [
      <>Tocá el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba) en la barra de Safari.</>,
      <>Elegí <strong>"Agregar al Dock"</strong> (o desde el menú <strong>Archivo → Agregar al Dock</strong>).</>,
      <>Confirmá tocando <strong>"Agregar"</strong>.</>,
    ],
  },
  other: {
    title: "Instalar la app",
    steps: [
      <>Abrí el menú de tu navegador (los tres puntos, arriba a la derecha).</>,
      <>Buscá la opción <strong>"Instalar app"</strong> o <strong>"Agregar a pantalla de inicio"</strong>.</>,
      <>Confirmá la instalación.</>,
    ],
  },
};

export default function InstallPWAButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [platform, setPlatform] = useState("other");
  const [showHelp, setShowHelp] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (sessionStorage.getItem("samurai_install_dismissed") === "1") return;

    const plat = getPlatform();
    setPlatform(plat);

    if (plat === "ios" || plat === "macos-safari") {
      setVisible(true);
      return;
    }

    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", onInstalled);

    const fallbackTimer = setTimeout(() => {
      setVisible((v) => v || true);
    }, 2500);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(fallbackTimer);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem("samurai_install_dismissed", "1");
    setVisible(false);
    setShowHelp(false);
  };

  const handleClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setVisible(false);
      return;
    }
    setShowHelp(true);
  };

  const info = INSTRUCTIONS[platform] || INSTRUCTIONS.other;

  return (
    <>
      <div className="fixed bottom-4 left-1/2 z-[9000] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 pl-4 shadow-xl backdrop-blur sm:left-auto sm:right-4 sm:translate-x-0 dark:border-neutral-700 dark:bg-neutral-900/95">
        <img src="/icons/icon-192.png" alt="Samurai" className="h-10 w-10 flex-shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">Instalá la app de Samurai</p>
          <p className="truncate text-xs text-slate-500 dark:text-neutral-400">Acceso rápido desde tu pantalla de inicio</p>
        </div>
        <button
          onClick={handleClick}
          className="flex-shrink-0 rounded-full bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-700"
        >
          Instalar
        </button>
        <button
          onClick={dismiss}
          aria-label="Cerrar"
          className="flex-shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          ✕
        </button>
      </div>

      {showHelp && (
        <div
          className="fixed inset-0 z-[9500] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-bold text-slate-900 dark:text-white">{info.title}</p>
            <ol className="mt-3 space-y-2.5 text-sm text-slate-600 dark:text-neutral-300">
              {info.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <button
              onClick={dismiss}
              className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-black"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
