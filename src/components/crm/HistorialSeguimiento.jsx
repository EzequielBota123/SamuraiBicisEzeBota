function iniciales(email) {
  if (!email) return "?";
  const nombre = email.split("@")[0];
  return nombre.slice(0, 2).toUpperCase();
}

function formatFechaHora(date) {
  if (!date) return "—";
  const fecha = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${fecha} · ${hora} hs`;
}

// Historial completo de notas de seguimiento de un cliente: una tarjeta por
// entrada, con autor, fecha/hora, texto completo (nada truncado), tarea
// pendiente e imágenes adjuntas. Un solo componente compartido por Clientes
// 360 y por el CRM (Contactar sin video) para que no haya dos versiones
// divergentes de lo mismo.
export default function HistorialSeguimiento({ historial, puedeEditar, onEditar, onEliminar, deletingEntry }) {
  const items = [...(historial || [])].sort((a, b) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0));
  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      {items.map((h, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/60">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white dark:bg-neutral-600">
                {iniciales(h.contactadoPor)}
              </span>
              <span className="text-sm font-medium text-slate-800 dark:text-neutral-200">{h.contactadoPor || "Sin usuario"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-neutral-400">
                {formatFechaHora(h.fecha?.toDate?.())}
              </span>
              {puedeEditar && onEditar && (
                <button
                  onClick={() => onEditar(h)}
                  title="Editar esta nota"
                  className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-950/30 dark:hover:text-sky-400"
                >
                  ✏️
                </button>
              )}
              {puedeEditar && onEliminar && (
                <button
                  onClick={() => onEliminar(h)}
                  disabled={deletingEntry === h}
                  title="Borrar esta nota"
                  className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                >
                  🗑
                </button>
              )}
            </div>
          </div>
          <div className="px-4 py-3">
            {h.notas ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-neutral-300">{h.notas}</p>
            ) : (
              <p className="text-sm italic text-slate-400 dark:text-neutral-500">Sin notas escritas.</p>
            )}
            {h.tareaPendiente && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                <span>📌</span> {h.tareaPendiente}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  h.contactado
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                    : "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"
                }`}
              >
                {h.contactado ? "✓ Contactado" : "Sin contactar"}
              </span>
              {h.cuentaCoincide === true && (
                <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
                  Cuenta coincide
                </span>
              )}
              {h.cuentaCoincide === false && (
                <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
                  Cuenta con diferencias
                </span>
              )}
            </div>
            {h.editadoPor && (
              <p className="mt-2 text-[11px] italic text-slate-400 dark:text-neutral-500">
                Editado por {h.editadoPor}{h.editadoAt?.toDate ? ` · ${formatFechaHora(h.editadoAt.toDate())}` : ""}
              </p>
            )}
            {(h.imagenes || []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {h.imagenes.map((url, j) => (
                  <a key={j} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="Adjunto" className="h-16 w-16 rounded-lg border border-slate-200 object-cover transition hover:opacity-80 dark:border-neutral-700" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
