import { useEffect, useMemo, useState } from "react";
import {
  subscribeProductTypes,
  createProductType,
  updateProductType,
  removeProductType,
} from "../../services/productTypes";
import { BusyButtonContent, LoadingOverlay } from "../../components/ui/LoadingIndicators";

export default function ProductTypes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeProductTypes(
      (items) => {
        setRows(items);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoading(false);
        alert("No se pudieron cargar los tipos de producto.");
      }
    );

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.title?.toLowerCase().includes(q));
  }, [rows, query]);

  async function handleSubmit(data) {
    try {
      if (editing?.id) {
        await updateProductType(editing.id, data);
      } else {
        await createProductType(data);
      }
      setModalOpen(false);
      setEditing(null);
    } catch (error) {
      console.error(error);
      alert("No se pudo guardar el tipo de producto.");
    }
  }

  async function handleDelete(row) {
    if (!confirm(`¿Eliminar el tipo "${row.title}"?`)) return;
    try {
      await removeProductType(row.id);
    } catch (error) {
      console.error(error);
      alert("No se pudo eliminar el tipo de producto.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_45px_80px_-50px_rgba(15,23,42,0.2)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="absolute -right-28 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-indigo-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
              Catálogo de productos
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Tipos de producto</h1>
              <p className="mt-3 max-w-xl text-sm text-slate-500 dark:text-neutral-400">
                Crea y organiza categorías de productos para reutilizarlas al cargar tu inventario.
              </p>
            </div>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200/60 transition hover:-translate-y-0.5"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            Nuevo tipo
          </button>
        </div>
      </section>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_65px_-45px_rgba(15,23,42,0.18)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <input
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500"
          placeholder="Buscar por nombre…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_40px_70px_-45px_rgba(15,23,42,0.18)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        {loading && (
          <LoadingOverlay
            label="Cargando tipos…"
            className="rounded-[inherit] border border-slate-200 bg-white text-slate-600"
            labelClassName="text-slate-600"
          />
        )}
        {loading && <p className="p-8 text-center text-sm text-slate-500 dark:text-neutral-400">Cargando…</p>}
        {!loading && filtered.length === 0 && (
          <p className="p-12 text-center text-sm text-slate-500 dark:text-neutral-400">No hay tipos de producto.</p>
        )}
        {!loading && filtered.length > 0 && (
          <>
            {/* Mobile: tarjetas */}
            <ul className="divide-y divide-slate-100 dark:divide-neutral-800 md:hidden">
              {filtered.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 p-4">
                  <p className="min-w-0 truncate font-semibold text-slate-900 dark:text-white">{row.title || "-"}</p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-indigo-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                      onClick={() => {
                        setEditing(row);
                        setModalOpen(true);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-rose-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                      onClick={() => handleDelete(row)}
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabla */}
            <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm text-slate-600 dark:divide-neutral-800 dark:text-neutral-300">
              <thead className="bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-3 text-left">Título</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-4 text-slate-700 dark:text-neutral-300">{row.title || "-"}</td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-indigo-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                          onClick={() => {
                            setEditing(row);
                            setModalOpen(true);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-rose-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                          onClick={() => handleDelete(row)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      <ProductTypeModal
        open={modalOpen}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

function ProductTypeModal({ open, onClose, onSubmit, initial }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(initial?.title || "");
  }, [initial, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 dark:bg-black/60">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {initial?.id ? "Editar tipo" : "Nuevo tipo"}
          </h2>
          <button onClick={onClose} className="rounded-2xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
            Cerrar
          </button>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            await onSubmit({
              title,
            });
            setSaving(false);
          }}
        >
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">Título</label>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancelar
            </button>
            <button
              disabled={saving}
              className="rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-200/60 transition focus:outline-none focus:ring-2 focus:ring-indigo-400/60 disabled:opacity-60"
            >
              <BusyButtonContent busy={saving} busyLabel="Guardando…" label="Guardar" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
