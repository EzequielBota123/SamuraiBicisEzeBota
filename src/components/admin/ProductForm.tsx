// components/ProductForm.tsx
import { useEffect, useRef, useState } from "react";
import { createProduct, updateProduct, uploadProductImages, deleteProductImage, type Product } from "../../services/products";
// Or create the file at ../services/product.ts and export the required members.
import { subscribeProductTypes, type ProductType } from "../../services/productTypes";
import { fetchOfficialUsdArsRate } from "../../services/exchangeRates";

const LEGACY_PREFIX = "legacy:";

const makeLegacyValue = (title: string) =>
  `${LEGACY_PREFIX}${encodeURIComponent((title || "").trim() || "general")}`;

const parseLegacyValue = (value: string) => {
  if (!value.startsWith(LEGACY_PREFIX)) return value;
  const raw = value.slice(LEGACY_PREFIX.length);
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    console.error("Error decoding legacy value", err);
    return raw;
  }
};

type ProductFormProps = {
  open: boolean;
  onClose: () => void;
  initial?: Partial<Product> | null; // si viene, edita
  onSaved?: (p: Product) => void;    // opcional: avisar al padre
};

export default function ProductForm({ open, onClose, initial, onSaved }: ProductFormProps) {
  const [name, setName] = useState(initial?.name || "");
  const [sku, setSku] = useState(initial?.sku ? String(initial.sku) : "");
  const [brand, setBrand] = useState(initial?.brand || "");
  const [priceUsd, setPriceUsd] = useState<string>(
    initial?.price != null ? String(initial.price) : ""
  );
  const [priceArs, setPriceArs] = useState<string>("");
  const [costArs, setCostArs] = useState<string>(initial?.costArs != null ? String(initial.costArs) : "");
  const [stock, setStock] = useState<number | string>(initial?.stock ?? 0);
  const [description, setDescription] = useState<string>(initial?.description || "");
  const [active, setActive] = useState<boolean>(initial?.active ?? true);
  const [showInCatalog, setShowInCatalog] = useState<boolean>(initial?.showInCatalog ?? true);
  const [existingImages, setExistingImages] = useState<string[]>(
    initial?.images?.length ? initial.images : initial?.imageUrl ? [initial.imageUrl] : []
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [productTypeId, setProductTypeId] = useState<string | null>(
    initial?.productTypeId ? String(initial.productTypeId) : null
  );
  const [productTypeTitle, setProductTypeTitle] = useState<string>(
    (initial?.productTypeTitle || initial?.category || "general") as string
  );
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [exchangeRateDate, setExchangeRateDate] = useState<string | null>(null);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
  const [exchangeRateError, setExchangeRateError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setName(initial?.name || "");
    setSku(initial?.sku ? String(initial.sku) : "");
    setBrand(initial?.brand || "");
    setPriceUsd(initial?.price != null ? String(initial.price) : "");
    setPriceArs("");
    setStock(initial?.stock ?? 0);
    setDescription(initial?.description || "");
    setActive(initial?.active ?? true);
    setShowInCatalog(initial?.showInCatalog ?? true);
    setExistingImages(
      initial?.images?.length ? initial.images : initial?.imageUrl ? [initial.imageUrl] : []
    );
    setNewFiles([]);
    setNewPreviews([]);
    setUploadProgress([]);
    setIsDragOver(false);
    setErrorMsg(null);
    const nextTypeTitle = (() => {
      const rawTitle = typeof initial?.productTypeTitle === "string" ? initial?.productTypeTitle : undefined;
      const legacyCategory = typeof initial?.category === "string" ? initial?.category : undefined;
      const normalizedTitle = (rawTitle || "").trim();
      if (normalizedTitle) return normalizedTitle;
      const normalizedLegacy = (legacyCategory || "").trim();
      return normalizedLegacy || "general";
    })();
    setProductTypeId(initial?.productTypeId ? String(initial.productTypeId) : null);
    setProductTypeTitle(nextTypeTitle);
  }, [initial, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setExchangeRateLoading(true);
    setExchangeRateError(null);
    fetchOfficialUsdArsRate(controller.signal)
      .then(({ value, date }) => {
        setExchangeRate(value);
        setExchangeRateDate(date);
      })
      .catch((err: any) => {
        if (err?.name === "AbortError") return;
        console.error("Error fetching official exchange rate", err);
        setExchangeRate(null);
        setExchangeRateDate(null);
        setExchangeRateError(
          "No se pudo obtener el tipo de cambio oficial. Ingresá el precio en pesos manualmente."
        );
      })
      .finally(() => setExchangeRateLoading(false));

    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const rate = Number(exchangeRate);
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      return;
    }

    const usdNumber = Number(priceUsd);
    if (!Number.isFinite(usdNumber)) {
      setPriceArs("");
      return;
    }

    const arsValue = usdNumber * rate;
    setPriceArs(Number.isFinite(arsValue) ? arsValue.toFixed(2) : "");
  }, [open, priceUsd, exchangeRate]);

  useEffect(() => {
    const unsubscribe = subscribeProductTypes(
      (items) => setProductTypes(items || []),
      (error) => console.error("Error fetching product types", error)
    );
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const normalizedCurrentTypeTitle = (productTypeTitle || "").trim() || "general";
  const currentLegacyValue = makeLegacyValue(normalizedCurrentTypeTitle);
  const selectProductTypeValue = productTypeId ?? currentLegacyValue;
  const hasLegacyTypeOption =
    !productTypeId &&
    normalizedCurrentTypeTitle !== "general" &&
    !productTypes.some(
      (type) =>
        (type.title || "").trim().toLowerCase() === normalizedCurrentTypeTitle.toLowerCase()
    );

  if (!open) return null;

  function addFiles(files: File[]) {
    const valid: File[] = [];
    const errs: string[] = [];
    for (const f of files) {
      if (!/^image\/(jpeg|jpg|png|webp)/.test(f.type)) {
        errs.push(`"${f.name}" no es JPG/PNG/WEBP`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        errs.push(`"${f.name}" supera 10 MB`);
        continue;
      }
      valid.push(f);
    }
    if (errs.length) setErrorMsg(errs.join("; "));
    valid.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setNewPreviews((p) => [...p, String(reader.result)]);
      reader.readAsDataURL(f);
    });
    setNewFiles((p) => [...p, ...valid]);
    setUploadProgress((p) => [...p, ...valid.map(() => 0)]);
  }

  function moveExisting(i: number, dir: -1 | 1) {
    setExistingImages((prev) => {
      const arr = [...prev];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  function removeExisting(i: number) {
    setExistingImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  function removeNewFile(i: number) {
    setNewFiles((prev) => prev.filter((_, idx) => idx !== i));
    setNewPreviews((prev) => prev.filter((_, idx) => idx !== i));
    setUploadProgress((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const priceNum = Number(priceUsd ?? 0);
    const costNum = costArs.trim() === "" ? null : Number(costArs);
    const stockNum = Number(stock ?? 0);
    const normalizedTypeTitle = (productTypeTitle || "").trim() || "general";
    const normalizedDescription = (description || "").trim();
    const normalizedSku = (sku || "").trim();

    setLoading(true);
    try {
      let saved: Product;

      if (initial?.id) {
        // --- UPDATE ---
        const initialImages: string[] = initial.images?.length
          ? initial.images
          : initial.imageUrl ? [initial.imageUrl] : [];
        const removedUrls = initialImages.filter((u) => !existingImages.includes(u));

        let newUrls: string[] = [];
        if (newFiles.length) {
          newUrls = await uploadProductImages(initial.id, newFiles, (i, pct) =>
            setUploadProgress((p) => { const next = [...p]; next[i] = pct; return next; })
          );
        }
        const allImages = [...existingImages, ...newUrls];

        await updateProduct(initial.id, {
          name,
          sku: normalizedSku || null,
          brand: brand.trim() || null,
          price: priceNum,
          costArs: costNum,
          stock: stockNum,
          category: normalizedTypeTitle,
          productTypeId,
          productTypeTitle: normalizedTypeTitle,
          active,
          showInCatalog,
          description: normalizedDescription,
          images: allImages,
        });

        removedUrls.forEach((url) =>
          deleteProductImage(url).catch((err) => console.warn("Error borrando imagen de Storage:", err))
        );

        saved = {
          ...(initial as Product),
          name,
          sku: normalizedSku || null,
          brand: brand.trim() || null,
          price: priceNum,
          stock: stockNum,
          category: normalizedTypeTitle,
          productTypeId: productTypeId ?? null,
          productTypeTitle: normalizedTypeTitle,
          description: normalizedDescription,
          active,
          showInCatalog,
          images: allImages,
          imageUrl: allImages[0] ?? "",
        } as Product;
      } else {
        // --- CREATE ---
        const created = await createProduct({
          name,
          sku: normalizedSku || null,
          brand: brand.trim() || null,
          price: priceNum,
          costArs: costNum,
          stock: stockNum,
          description: normalizedDescription,
          category: normalizedTypeTitle,
          productTypeId,
          productTypeTitle: normalizedTypeTitle,
          active,
          showInCatalog,
        });

        let newUrls: string[] = [];
        if (newFiles.length) {
          newUrls = await uploadProductImages(created.id!, newFiles, (i, pct) =>
            setUploadProgress((p) => { const next = [...p]; next[i] = pct; return next; })
          );
        }
        const allImages = [...existingImages, ...newUrls];

        if (allImages.length) {
          await updateProduct(created.id!, { images: allImages });
        }

        saved = { ...created, images: allImages, imageUrl: allImages[0] ?? created.imageUrl ?? "" };
      }

      onSaved?.(saved);
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Error guardando el producto.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/30 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div ref={dialogRef} className="flex w-full max-w-2xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl" style={{ maxHeight: "90vh" }}>

        {/* Header sticky */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {initial?.id ? "Editar producto" : "Nuevo producto"}
            </h2>
            {initial?.id && (
              <p className="mt-0.5 text-xs text-slate-400">ID: {initial.id}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <form id="product-form" className="flex-1 overflow-y-auto" onSubmit={handleSubmit}>
          <div className="space-y-6 px-6 py-5">

            {/* Sección: Info básica */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Información del producto</h3>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Nombre</label>
                <input className={inputCls} value={name} onChange={e => setName(e.target.value)} required disabled={loading} placeholder="Nombre del producto" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Marca</label>
                <input className={inputCls} value={brand} onChange={e => setBrand(e.target.value)} disabled={loading} placeholder="Ej: Samurai, Bowie" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Descripción</label>
                <textarea
                  className={`${inputCls} resize-none`}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Detalles del producto, materiales, compatibilidades, etc."
                  disabled={loading}
                />
                <p className="mt-1.5 text-xs text-slate-400">Se mostrará en el catálogo para ayudar a tus clientes a elegir.</p>
              </div>
            </section>

            {/* Sección: Precios */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Precios</h3>
              {initial?.priceArs != null && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Precio real sincronizado desde Contabilium:{" "}
                  <strong>
                    {Number(initial.priceArs).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })}
                  </strong>
                  . Es el que ven tus clientes; se actualiza solo cada 5 minutos y pisa la estimación de abajo.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Precio base (USD)</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input
                      type="number" min={0} step="0.01"
                      className={`${inputCls} pl-7`}
                      value={priceUsd}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setPriceUsd(raw);
                        const rate = Number(exchangeRate);
                        if (!rate || rate <= 0 || raw === "") { setPriceArs(""); return; }
                        const usdValue = Number(raw);
                        if (!Number.isFinite(usdValue)) { setPriceArs(""); return; }
                        const arsValue = usdValue * rate;
                        if (!Number.isFinite(arsValue)) return;
                        setPriceArs((arsValue || 0).toFixed(2));
                      }}
                      disabled={loading || exchangeRateLoading}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {exchangeRateLoading && "Obteniendo tipo de cambio…"}
                    {!exchangeRateLoading && exchangeRate && exchangeRate > 0 && (
                      <span>Cambio oficial: ${exchangeRate.toFixed(2)} ARS/USD{exchangeRateDate ? ` · ${new Intl.DateTimeFormat("es-AR").format(new Date(exchangeRateDate))}` : ""}</span>
                    )}
                    {!exchangeRateLoading && exchangeRateError && (
                      <span className="text-amber-600">{exchangeRateError}</span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Precio (ARS) estimado</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input
                      type="number" min={0} step="0.01"
                      className={`${inputCls} pl-7`}
                      value={priceArs}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setPriceArs(raw);
                        const rate = Number(exchangeRate);
                        if (!rate || rate <= 0 || raw === "") return;
                        const arsValue = Number(raw);
                        if (!Number.isFinite(arsValue)) return;
                        const usdValue = arsValue / rate;
                        if (!Number.isFinite(usdValue)) return;
                        setPriceUsd(usdValue.toFixed(2));
                      }}
                      disabled={loading}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Solo una estimación para productos nuevos. El precio guardado es siempre en USD hasta que Contabilium sincronice el real.
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Costo (ARS)</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input
                      type="number" min={0} step="0.01"
                      className={`${inputCls} pl-7`}
                      value={costArs}
                      onChange={(e) => setCostArs(e.target.value)}
                      disabled={loading}
                      placeholder="Lo que nos cuesta a nosotros"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Interno, no se muestra a clientes — se usa para calcular margen en el dashboard de gestión.
                  </p>
                </div>
              </div>
            </section>

            {/* Sección: Inventario y clasificación */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Inventario y clasificación</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">SKU</label>
                  <input className={inputCls} value={sku} onChange={e => setSku(e.target.value)} placeholder="Ej: 100005" disabled={loading} />
                  <p className="mt-1.5 text-xs text-slate-400">No puede repetirse con otro activo.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Stock</label>
                  <input type="number" min={0} className={inputCls} value={stock} onChange={e => setStock(e.target.value)} disabled={loading} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de producto</label>
                  <select
                    className={inputCls}
                    value={selectProductTypeValue}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.startsWith(LEGACY_PREFIX)) {
                        const legacyTitle = (parseLegacyValue(value) || "general").trim();
                        setProductTypeId(null);
                        setProductTypeTitle(legacyTitle || "general");
                      } else {
                        const found = productTypes.find((type) => type.id === value);
                        const nextTitle = (found?.title || found?.identifier || value || "").trim();
                        setProductTypeId(value || null);
                        setProductTypeTitle(nextTitle || "general");
                      }
                    }}
                    disabled={loading}
                  >
                    <option value={makeLegacyValue("general")}>General</option>
                    {productTypes.map((type) => {
                      const optionValue = type.id || makeLegacyValue(type.title);
                      const label = type.title || type.identifier || type.id || "Sin título";
                      return <option key={optionValue} value={optionValue}>{label}</option>;
                    })}
                    {hasLegacyTypeOption && (
                      <option value={currentLegacyValue}>{normalizedCurrentTypeTitle}</option>
                    )}
                  </select>
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-3">
                <div
                  onClick={() => !loading && setActive(v => !v)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${active ? "bg-sky-500" : "bg-slate-300"} ${loading ? "opacity-50" : "cursor-pointer"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${active ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm font-medium text-slate-700">Producto activo</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-3">
                <div
                  onClick={() => !loading && setShowInCatalog(v => !v)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${showInCatalog ? "bg-sky-500" : "bg-slate-300"} ${loading ? "opacity-50" : "cursor-pointer"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${showInCatalog ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm font-medium text-slate-700">Visible en el catálogo público</span>
              </label>
              <p className="-mt-2 text-xs text-slate-400">
                Si lo apagás, sigue contando en el stock total y en el stock de los distribuidores, pero no se muestra en /catalogo.
              </p>
            </section>

            {/* Sección: Imágenes */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Imágenes</h3>
                {(existingImages.length + newFiles.length) > 0 && (
                  <span className="text-xs text-slate-400">
                    {existingImages.length + newFiles.length} imagen{existingImages.length + newFiles.length !== 1 ? "es" : ""} · la primera es la principal
                  </span>
                )}
              </div>

              {existingImages.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {existingImages.map((url, i) => (
                    <div key={url} className="group relative">
                      <img src={url} className="h-24 w-24 rounded-2xl border border-slate-200 object-cover" alt="" />
                      <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-2xl bg-black/50 opacity-0 transition group-hover:opacity-100">
                        <button type="button" onClick={() => moveExisting(i, -1)} disabled={i === 0 || loading}
                          className="rounded-lg bg-white/90 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-30">←</button>
                        <button type="button" onClick={() => moveExisting(i, 1)} disabled={i === existingImages.length - 1 || loading}
                          className="rounded-lg bg-white/90 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-30">→</button>
                        <button type="button" onClick={() => removeExisting(i)} disabled={loading}
                          className="rounded-lg bg-rose-500 px-2 py-1 text-xs font-medium text-white hover:bg-rose-600">✕</button>
                      </div>
                      {i === 0 && (
                        <span className="absolute bottom-0 left-0 right-0 rounded-b-2xl bg-sky-500 py-0.5 text-center text-[9px] font-semibold text-white">Principal</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
                onClick={() => !loading && fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition select-none ${
                  isDragOver ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-sky-50/50"
                } ${loading ? "pointer-events-none opacity-50" : ""}`}
              >
                <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-slate-500">Arrastrá imágenes acá o hacé click</p>
                <p className="text-xs text-slate-400">JPG · PNG · WEBP · máx 10 MB por imagen</p>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple className="hidden"
                  onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} disabled={loading} />
              </div>

              {newPreviews.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {newPreviews.map((src, i) => (
                    <div key={i} className="relative">
                      <img src={src} className="h-24 w-24 rounded-2xl border border-slate-200 object-cover" alt="" />
                      {uploadProgress[i] < 100 ? (
                        <div className="absolute bottom-0 left-0 right-0 rounded-b-2xl bg-black/50 px-2 py-1">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-white/30">
                            <div className="h-1 rounded-full bg-sky-400 transition-all" style={{ width: `${uploadProgress[i] || 0}%` }} />
                          </div>
                        </div>
                      ) : (
                        <div className="absolute bottom-0 left-0 right-0 rounded-b-2xl bg-emerald-500 py-0.5 text-center text-[9px] font-semibold text-white">✓ Listo</div>
                      )}
                      <button type="button" onClick={() => removeNewFile(i)} disabled={loading}
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white shadow hover:bg-rose-600 disabled:opacity-50">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {errorMsg && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{errorMsg}</div>
            )}
          </div>
        </form>

        {/* Footer sticky */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={loading}
            className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="submit" form="product-form" disabled={loading}
            className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-200/60 transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-sky-400/60 disabled:translate-y-0 disabled:opacity-60">
            {loading ? (initial?.id ? "Guardando…" : "Creando…") : (initial?.id ? "Guardar cambios" : "Crear producto")}
          </button>
        </div>
      </div>
    </div>
  );
}
