import { useEffect, useRef, useState } from "react";

export default function AuditRecorderModal({ open, onClose, onSubmit }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordedAtRef = useRef(null);

  const [permError, setPermError] = useState("");
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setPermError("");
    setBlob(null);
    setPreviewUrl("");
    setUploadError("");
    setSeconds(0);

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermError(
        "Este navegador no permite grabar video acá. Si entraste desde WhatsApp o Instagram, abrí el link en Chrome o Safari (tres puntitos → \"Abrir en el navegador\")."
      );
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: true })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        console.error(err);
        if (err?.name === "NotAllowedError") {
          setPermError("No tenés permiso de cámara habilitado. Andá a la configuración del navegador (o del teléfono) y habilitá la cámara para este sitio.");
        } else if (err?.name === "NotReadableError") {
          setPermError("La cámara está siendo usada por otra app. Cerrá otras apps que la estén usando (videollamadas, etc.) y volvé a intentar.");
        } else if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
          setPermError("No encontramos una cámara disponible en este dispositivo.");
        } else {
          setPermError("No pudimos acceder a la cámara. Revisá que le hayas dado permiso al navegador.");
        }
      });

    return () => {
      stopStream();
      clearInterval(timerRef.current);
    };
  }, [open]);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const b = new Blob(chunksRef.current, { type: mimeType });
      setBlob(b);
      setPreviewUrl(URL.createObjectURL(b));
      stopStream();
    };
    recorder.start();
    recorderRef.current = recorder;
    recordedAtRef.current = new Date();
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
    clearInterval(timerRef.current);
  }

  function handleElegirArchivo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    stopStream();
    chunksRef.current = [];
    recordedAtRef.current = new Date();
    setBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function grabarDeNuevo() {
    setBlob(null);
    setPreviewUrl("");
    setUploadError("");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: true })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setPermError("No pudimos acceder a la cámara. Revisá que le hayas dado permiso al navegador."));
  }

  async function handleEnviar() {
    if (!blob) return;
    setUploading(true);
    setUploadError("");
    try {
      await onSubmit(blob, recordedAtRef.current || new Date());
      handleClose();
    } catch (err) {
      setUploadError(err.message || "No se pudo subir el video.");
    } finally {
      setUploading(false);
    }
  }

  function handleClose() {
    stopStream();
    clearInterval(timerRef.current);
    onClose();
  }

  if (!open) return null;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">🎥 Video de auditoría de stock</h3>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {permError && <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{permError}</p>}

        {!recording && !previewUrl && !permError && (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            📦 Grabá <strong>todas</strong> las bicicletas: las que están en caja y también las que están armadas/fuera de caja. Si falta alguna, la auditoría queda incompleta.
          </p>
        )}

        <div className="relative overflow-hidden rounded-2xl bg-black">
          {permError ? (
            <div className="flex aspect-[3/4] w-full items-center justify-center p-6 text-center text-sm text-white/60">
              No se pudo abrir la cámara
            </div>
          ) : !previewUrl ? (
            <video ref={videoRef} autoPlay muted playsInline className="aspect-[3/4] w-full object-cover" />
          ) : (
            <video src={previewUrl} controls playsInline className="aspect-[3/4] w-full object-cover" />
          )}
          {recording && (
            <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {fmt(seconds)}
            </span>
          )}
        </div>

        {uploadError && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{uploadError}</p>}

        <div className="mt-4 flex gap-2">
          {!previewUrl && !recording && (
            <div className="w-full space-y-2">
              <button
                onClick={startRecording}
                disabled={!!permError}
                className="w-full rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                ⏺ Empezar a grabar
              </button>
              <label className="block w-full cursor-pointer rounded-2xl border border-slate-200 px-4 py-3 text-center text-sm font-semibold text-slate-600 hover:bg-slate-50">
                📁 O subí un video ya grabado
                <input type="file" accept="video/*" onChange={handleElegirArchivo} className="hidden" />
              </label>
            </div>
          )}
          {recording && (
            <button onClick={stopRecording} className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              ⏹ Detener
            </button>
          )}
          {previewUrl && !uploading && (
            <>
              <button onClick={grabarDeNuevo} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Grabar de nuevo
              </button>
              <button onClick={handleEnviar} className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
                Enviar
              </button>
            </>
          )}
          {uploading && (
            <button disabled className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white opacity-70">
              Subiendo…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
