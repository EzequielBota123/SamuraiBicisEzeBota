import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";

export default function SkuScannerModal({ open, onClose, onDetected }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [permError, setPermError] = useState("");
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPermError("");
    setScanning(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermError(
        "Este navegador no permite usar la cámara acá. Si entraste desde WhatsApp o Instagram, abrí el link en Chrome o Safari (tres puntitos → \"Abrir en el navegador\")."
      );
      setScanning(false);
      return;
    }

    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (result, err) => {
          if (result) {
            const text = result.getText();
            controlsRef.current?.stop();
            setScanning(false);
            onDetected(text);
          } else if (err && !(err instanceof NotFoundException)) {
            console.error(err);
          }
        }
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      })
      .catch((err) => {
        console.error(err);
        if (err?.name === "NotAllowedError") {
          setPermError("No tenés permiso de cámara habilitado. Andá a la configuración del navegador y habilitá la cámara para este sitio.");
        } else if (err?.name === "NotReadableError") {
          setPermError("La cámara está siendo usada por otra app. Cerrala y volvé a intentar.");
        } else if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
          setPermError("No encontramos una cámara disponible en este dispositivo.");
        } else {
          setPermError("No pudimos acceder a la cámara. Revisá que le hayas dado permiso al navegador.");
        }
        setScanning(false);
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-neutral-900">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">📷 Escanear código de la bici</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300">
            ✕
          </button>
        </div>

        {permError && (
          <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {permError}
          </p>
        )}

        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`aspect-[3/4] w-full object-cover ${permError ? "hidden" : ""}`}
          />
          {permError && (
            <div className="flex aspect-[3/4] w-full items-center justify-center p-6 text-center text-sm text-white/60">
              No se pudo abrir la cámara
            </div>
          )}
          {scanning && !permError && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-2/3 w-2/3 rounded-2xl border-2 border-emerald-400/80" />
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-slate-500 dark:text-neutral-400">
          Apuntá la cámara al código de barras o QR de la etiqueta de la bici.
        </p>
      </div>
    </div>
  );
}
