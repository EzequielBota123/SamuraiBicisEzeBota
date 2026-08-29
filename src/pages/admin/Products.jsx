import { useEffect, useMemo, useState } from "react";
import { subscribeToSyncStatus, triggerSync } from "../../services/contabilium";
import ProductForm from "../../components/admin/ProductForm";
import BulkProductImport from "../../components/admin/BulkProductImport";
import {
  createProduct,
  updateProduct,
  deleteProductById,
  subscribeProducts,
  listProductsByBrand,
  uploadProductImages,
} from "../../services/products";
import { LoadingOverlay } from "../../components/ui/LoadingIndicators";
import { subscribeProductTypes } from "../../services/productTypes";
import { ensureSheetJs } from "../../utils/sheetjs";

const statusStyles = {
  true: "border border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  false: "border border-slate-200 bg-slate-100 text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400",
};

function moneyArs(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

const LEGACY_PREFIX = "legacy:";
const GENERAL_LEGACY_VALUE = `${LEGACY_PREFIX}${encodeURIComponent("general")}`;

function makeLegacyValue(title = "") {
  return `${LEGACY_PREFIX}${encodeURIComponent(title || "general")}`;
}

function parseLegacyValue(value = "") {
  if (!value.startsWith(LEGACY_PREFIX)) return value;
  const raw = value.slice(LEGACY_PREFIX.length);
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    console.error("Error decoding legacy value", err);
    return raw;
  }
}

export default function Products() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState("all");
  const [category, setCategory] = useState("all");
  const [productTypes, setProductTypes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [syncStatus, setSyncStatus]   = useState(null);
  const [syncing, setSyncing]         = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [bowieUploading, setBowieUploading] = useState(false);
  const [bowieMessage, setBowieMessage] = useState("");

  // Herramienta de un solo uso: reparte 3 fotos (una por color) a los 9
  // productos Bowie segun el color mencionado en el nombre de cada uno.
  async function handleBowiePhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setBowieUploading(true);
    setBowieMessage("");
    try {
      const colorByFile = (name) => {
        const n = name.toLowerCase();
        if (n.includes("gris-celeste") || n.includes("gris_celeste")) return "GRIS-CELESTE";
        if (n.includes("azul-celeste") || n.includes("azul_celeste")) return "AZUL-CELESTE";
        if (n.includes("negro-gris") || n.includes("negro_gris")) return "NEGRO-GRIS";
        return null;
      };
      const products = await listProductsByBrand("Bowie");
      let updated = 0;
      for (const file of files) {
        const color = colorByFile(file.name);
        if (!color) continue;
        const matches = products.filter((p) => (p.name || "").toUpperCase().includes(color));
        for (const p of matches) {
          const [url] = await uploadProductImages(p.id, [file]);
          await updateProduct(p.id, { images: [url] });
          updated++;
        }
      }
      setBowieMessage(`Listo, ${updated} producto(s) actualizados con foto.`);
    } catch (err) {
      setBowieMessage(err.message || "Error subiendo las fotos.");
    } finally {
      setBowieUploading(false);
    }
  }

  useEffect(() => {
    const unsub = subscribeToSyncStatus(setSyncStatus);
    return () => unsub();
  }, []);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await triggerSync();
      setSyncMessage(`Sync completada: ${result.updated} producto(s) del catálogo actualizados (revisamos ${result.total} conceptos en Contabilium).`);
    } catch (err) {
      setSyncMessage(`Error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeProducts(
      { q: "", onlyActive: "all", category: "all", pageSize: 50 },
      (items) => {
        setRows(items);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeProductTypes(
      (items) => setProductTypes(items || []),
      (error) => console.error("Error fetching product types", error)
    );
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const filtered = useMemo(() => {
    const nq = (q || "").trim().toLowerCase();
    return rows.filter((p) => {
      const skuValue = p.sku != null ? String(p.sku) : "";
      const text =
        !nq ||
        (p.nameLower || "").includes(nq) ||
        skuValue.toLowerCase().includes(nq) ||
        String(p.id || "").toLowerCase().includes(nq);
      const st = onlyActive === "all" ? true : !!p.active === (onlyActive === "true");
      let matchesType = true;
      if (category !== "all") {
        const candidateTitle = ((p.productTypeTitle || p.category || "") + "").toLowerCase();
        if (category.startsWith(LEGACY_PREFIX)) {
          const legacyTitle = parseLegacyValue(category).toLowerCase();
          if (legacyTitle === "general") {
            matchesType = !p.productTypeId && (!candidateTitle || candidateTitle === "general");
          } else {
            matchesType = candidateTitle === legacyTitle;
          }
        } else {
          const selectedType = productTypes.find((t) => t.id === category);
          const selectedTitle = (selectedType?.title || "").toLowerCase();
          matchesType =
            p.productTypeId === category ||
            (!!selectedTitle && candidateTitle === selectedTitle);
        }
      }
      return text && st && matchesType;
    });
  }, [rows, q, onlyActive, category, productTypes]);

  async function handleCreate(payload) {
    setLoading(true);
    await createProduct(payload);
    setLoading(false);
    setModalOpen(false);
  }

  async function handleUpdate(payload) {
    setLoading(true);
    await updateProduct(editing.id, payload);
    setLoading(false);
    setEditing(null);
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar este producto?")) return;
    setLoading(true);
    await deleteProductById(id);
    setLoading(false);
  }

  async function handleExport() {
    if (exporting || filtered.length === 0) return;
    setExporting(true);
    setExportMessage("");
    try {
      const sheetjs = await ensureSheetJs();
      const now = new Date();
      const filename = `productos-${now.toISOString().slice(0, 10)}.xlsx`;
      const rowsForSheet = filtered.map((product) => ({
        id: product.id || "",
        sku: product.sku || "",
        nombre: product.name || "",
        categoria: product.productTypeTitle || product.category || "general",
        precio: Number(product.price ?? 0),
        stock: Number(product.stock ?? 0),
        activo: product.active ? "sí" : "no",
      }));
      const worksheet = sheetjs.utils.json_to_sheet(rowsForSheet, {
        header: ["id", "sku", "nombre", "categoria", "precio", "stock", "activo"],
      });
      const workbook = sheetjs.utils.book_new();
      sheetjs.utils.book_append_sheet(workbook, worksheet, "Productos");
      sheetjs.writeFile(workbook, filename);
      setExportMessage(`Exportación generada: ${filename}`);
    } catch (error) {
      console.error("Error exporting products", error);
      setExportMessage("Ocurrió un error al exportar los productos.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_45px_80px_-50px_rgba(15,23,42,0.2)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="absolute -right-28 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-fuchsia-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
              Inventario vivo
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Productos</h1>
              <p className="mt-3 max-w-xl text-sm text-slate-500 dark:text-neutral-400">
                Administrá catálogo y stock con feedback inmediato y animaciones suaves durante las operaciones.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              onClick={handleExport}
              disabled={exporting || filtered.length === 0}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {exporting ? "Exportando…" : "Exportar Excel"}
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:text-sky-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              Importar Excel
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5"
            >
              Nuevo producto
            </button>
          </div>
        </div>
      </section>

      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-4 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Sincronización con Contabilium
            </div>
            <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
              {syncStatus
                ? `Última sync: ${syncStatus.lastSync ? syncStatus.lastSync.toLocaleString("es-AR") : "—"} · ${syncStatus.updated} del catálogo actualizados (${syncStatus.total} conceptos revisados en Contabilium)${syncStatus.errors?.length ? ` · ${syncStatus.errors.length} error(es)` : ""}`
                : "Sin datos de sincronización aún"}
            </div>
            {syncMessage && (
              <div className="mt-1 text-xs text-emerald-600">{syncMessage}</div>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-indigo-200 bg-indigo-50 px-6 py-4 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800 dark:text-indigo-300">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              Fotos Bowie (uso único)
            </div>
            <div className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
              Seleccioná las 3 fotos con fondo blanco (gris-celeste, azul-celeste, negro-gris) — se reparten solas a los 9 productos por color.
            </div>
            {bowieMessage && <div className="mt-1 text-xs text-indigo-600">{bowieMessage}</div>}
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-indigo-700">
            {bowieUploading ? "Subiendo…" : "Elegir fotos"}
            <input type="file" accept="image/*" multiple hidden disabled={bowieUploading} onChange={handleBowiePhotos} />
          </label>
        </div>
      </div>


      {exportMessage && (
        <div className="rounded-3xl border border-sky-200 bg-sky-50 px-6 py-4 text-sm text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400">
          {exportMessage}
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_65px_-45px_rgba(15,23,42,0.18)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="grid gap-4 md:grid-cols-4">
          <input
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500"
            placeholder="Buscar por nombre, SKU o ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            value={onlyActive}
            onChange={(e) => setOnlyActive(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="true">Solo activos</option>
            <option value="false">Solo inactivos</option>
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">Todas</option>
            <option value={GENERAL_LEGACY_VALUE}>General</option>
            {productTypes.map((type) => {
              const optionValue = type.id || makeLegacyValue(type.title);
              const label = type.title || type.identifier || type.id || "Sin título";
              return (
                <option key={optionValue} value={optionValue}>
                  {label}
                </option>
              );
            })}
          </select>
          <div className="flex items-center justify-end text-sm text-slate-500 dark:text-neutral-400">
            {loading ? "Cargando…" : `${filtered.length} resultados`}
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_40px_70px_-45px_rgba(15,23,42,0.18)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        {loading && (
          <LoadingOverlay
            label="Sincronizando productos…"
            className="rounded-[inherit] border border-slate-200 bg-white text-slate-600"
            labelClassName="text-slate-600"
          />
        )}
        {!loading && filtered.length === 0 && (
          <p className="p-12 text-center text-sm text-slate-500 dark:text-neutral-400">Sin resultados.</p>
        )}

        {filtered.length > 0 && (
          <>
            {/* Mobile: tarjetas */}
            <ul className="divide-y divide-slate-100 dark:divide-neutral-800 md:hidden">
              {filtered.map((p) => (
                <li key={p.id} className="space-y-3 p-4">
                  <div className="flex items-center gap-3">
                    {(p.images?.[0] ?? p.imageUrl) ? (
                      <img src={p.images?.[0] ?? p.imageUrl} alt={p.name} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{p.name}</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">{p.sku ? `SKU: ${p.sku}` : "Sin SKU"}</p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${statusStyles[p.active]}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {p.active ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 capitalize dark:bg-neutral-800 dark:text-neutral-300">
                      {p.productTypeTitle || p.category || "general"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {p.priceArs != null ? moneyArs(p.priceArs) : "Sin sincronizar"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-neutral-800 dark:text-neutral-300">Stock: {p.stock ?? 0}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                      onClick={() => setEditing(p)}
                    >
                      Editar
                    </button>
                    <button
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-rose-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                      onClick={() => handleDelete(p.id)}
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
                  <th className="px-4 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-left">Categoría</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {(p.images?.[0] ?? p.imageUrl) ? (
                          <img src={p.images?.[0] ?? p.imageUrl} alt={p.name} className="h-12 w-12 rounded-xl object-cover" />
                        ) : (
                          <div className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800" />
                        )}
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</div>
                          <div className="text-xs text-slate-500 dark:text-neutral-400">
                            {p.sku ? `SKU: ${p.sku}` : "Sin SKU"}
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-neutral-500">ID: {p.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 capitalize text-slate-500 dark:text-neutral-400">{p.productTypeTitle || p.category || "general"}</td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-900 dark:text-white">
                      {p.priceArs != null ? moneyArs(p.priceArs) : <span className="text-slate-400 dark:text-neutral-500">Sin sincronizar</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-500 dark:text-neutral-400">{p.stock ?? 0}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${statusStyles[p.active]}`}>
                        <span className="h-2 w-2 rounded-full bg-current" />
                        {p.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                          onClick={() => setEditing(p)}
                        >
                          Editar
                        </button>
                        <button
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-rose-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                          onClick={() => handleDelete(p.id)}
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

      <ProductForm open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={handleCreate} />
      <ProductForm open={!!editing} initial={editing} onClose={() => setEditing(null)} onSubmit={handleUpdate} />
      {importOpen && (
        <BulkProductImport
          open={importOpen}
          productTypes={productTypes}
          onClose={() => setImportOpen(false)}
          onCompleted={(result) => {
            setImportOpen(false);
            if (result.attempted > result.failed) {
              setLoading(true);
            }
          }}
        />
      )}
    </div>
  );
}
