// src/pages/catalog/CatalogPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/AuthContext";
import { useLocation, Link } from "react-router-dom";
import { listProducts } from "../../services/products";
import { createOrder, checkStockEnVivo } from "../../services/orders";
import { getCustomerTypeById } from "../../services/customerTypes";
import { fetchEffectiveRate } from "../../services/exchangeRates";
import { getDollarConfig } from "../../services/dollarConfig";
import { validateCuit, formatCuit } from "../../utils/cuit";
import { LoadingOverlay, BusyButtonContent } from "../../components/ui/LoadingIndicators";
import Reveal from "../../components/ui/Reveal";
import { generateCatalogPdf } from "../../utils/generateCatalogPdf";

const SITE_URL = "https://samurai.ar";

// Pedidos suspendidos hasta nuevo aviso mientras se regulariza el stock —
// cambiar a false para reactivar. Solo corta el frontend; ver firestore.rules
// si además hace falta bloquear el lado del servidor.
const PEDIDOS_SUSPENDIDOS = false;
const MENSAJE_PEDIDOS_SUSPENDIDOS =
  "Los pedidos están temporalmente suspendidos mientras regularizamos el stock. Volvé a intentarlo pronto.";

function getProductImages(p) {
  if (p.images?.length) return p.images;
  return p.imageUrl ? [p.imageUrl] : [];
}

const TALLE_DOT_RE = /\bT\.(XS|S|M|L|XL)\b/i;
const TALLE_WORD_RE = /\bTALLE\s+(XS|S|M|L|XL)\b/i;
const COLOR_ONLY_RE = /\bCOLOR\s+(.+)$/i;

function normalizeColorLabel(raw) {
  return (raw || "")
    .replace(/\bGLOOS\b/gi, "GLOSS")
    .replace(/[-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Separa "modelo base" de "talle"/"color" a partir del nombre del producto.
// No todos los productos tienen variantes: si no matchea ningún patrón,
// colorLabel queda en null y el producto se muestra como item individual.
function parseVariant(name) {
  const raw = (name || "").trim();
  const match = raw.match(TALLE_DOT_RE) || raw.match(TALLE_WORD_RE);
  if (match) {
    const base = raw.slice(0, match.index).trim().replace(/[-–]\s*$/, "").trim();
    const rest = raw.slice(match.index + match[0].length).replace(/^[-–]\s*/, "");
    const colorLabel = normalizeColorLabel(rest);
    return { base, talle: match[1].toUpperCase(), colorLabel: colorLabel || null };
  }
  const colorOnly = raw.match(COLOR_ONLY_RE);
  if (colorOnly) {
    const base = raw.slice(0, colorOnly.index).trim();
    const colorLabel = normalizeColorLabel(colorOnly[1]);
    return { base, talle: null, colorLabel: colorLabel || null };
  }
  return { base: raw, talle: null, colorLabel: null };
}

const normalizeBase = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const formatUsd = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const toArs = (usdPrice, exchangeRate) => {
  const rate = Number(exchangeRate);
  const usd = Number(usdPrice ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(usd)) return null;
  const ars = usd * rate;
  return Number.isFinite(ars) ? ars : null;
};

// Precio de lista en ARS de un producto, priorizando el priceArs sincronizado
// de Contabilium por sobre el cálculo en USD*tipo de cambio — mismo criterio
// que usa GroupCard para el precio "desde $X" en pantalla.
function listPriceArs(product, exchangeRate) {
  const contabiliumArs = product.priceArs != null ? Number(product.priceArs) : null;
  if (Number.isFinite(contabiliumArs) && contabiliumArs > 0) return contabiliumArs;
  const convertedArs = toArs(Number(product.price || 0), exchangeRate);
  return Number.isFinite(convertedArs) && convertedArs > 0 ? convertedArs : null;
}

const NEW_PRODUCT_DAYS = 21;
function isRecentlyAdded(createdAt) {
  const date = createdAt?.toDate ? createdAt.toDate() : createdAt instanceof Date ? createdAt : null;
  if (!date) return false;
  const days = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= NEW_PRODUCT_DAYS;
}

const getEffectivePrice = (price, discount, isLoggedIn) => {
  const basePrice = Number(price || 0);
  if (!isLoggedIn) {
    return basePrice;
  }
  const parsedDiscount = Number(discount || 0);
  if (!Number.isFinite(parsedDiscount) || parsedDiscount <= 0) {
    return basePrice;
  }
  const discounted = basePrice - (basePrice * parsedDiscount) / 100;
  if (!Number.isFinite(discounted)) {
    return basePrice;
  }
  return Math.max(discounted, 0);
};

const SORTS = [
  { id: "featured", label: "Destacado" },
  { id: "newest", label: "Llegadas más recientes" },
  { id: "name", label: "Nombre (A-Z)" },
  { id: "priceAsc", label: "Precio - bajo a alto" },
  { id: "priceDesc", label: "Precio - alto a bajo" },
];

export default function CatalogPage() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const isLoggedIn = !!user;
  const [selectedCats, setSelectedCats] = useState([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState([]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [exchangeRateDate, setExchangeRateDate] = useState(null);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
  const [exchangeRateError, setExchangeRateError] = useState(null);
  const [rateMode, setRateMode] = useState(null);
  const [rateUsedFallback, setRateUsedFallback] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const customerTypeId = profile?.customerTypeId;

    if (!customerTypeId) {
      setDiscount(0);
      return () => {
        active = false;
      };
    }

    setDiscount(0);

    (async () => {
      try {
        const customerType = await getCustomerTypeById(customerTypeId);
        if (!active) return;
        const parsedDiscount = Number(customerType?.discount ?? 0);
        setDiscount(Number.isFinite(parsedDiscount) ? parsedDiscount : 0);
      } catch (error) {
        if (!active) return;
        console.error("Error obteniendo tipo de cliente:", error);
        setDiscount(0);
      }
    })();

    return () => {
      active = false;
    };
  }, [profile?.customerTypeId]);

  useEffect(() => {
    const controller = new AbortController();
    setExchangeRateLoading(true);
    setExchangeRateError(null);
    setRateUsedFallback(false);

    (async () => {
      try {
        const config = await getDollarConfig();
        const result = await fetchEffectiveRate(config, controller.signal);
        // En modo "disabled" igual usamos lastAutoValue para convertir precios USD→ARS internamente
        const rateValue = result.value > 0
          ? result.value
          : (result.mode === "disabled" && config.lastAutoValue > 0 ? config.lastAutoValue : 0);
        setExchangeRate(rateValue);
        setExchangeRateDate(result.date);
        setRateMode(result.mode);
        setRateUsedFallback(result.usedFallback);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("Error obteniendo tipo de cambio", err);
        setExchangeRate(null);
        setExchangeRateDate(null);
        setExchangeRateError(
          "No pudimos actualizar el tipo de cambio. Los valores en USD se muestran sin conversión."
        );
      } finally {
        setExchangeRateLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const response = await listProducts({
          onlyActive: "true",
          category: "all",
          q: "",
          pageSize: 200,
        });
        if (!active) return;
        setItems(response.items.filter((p) => p.showInCatalog !== false));
        setInitialLoaded(true);
      } catch (e) {
        console.error("Error listando productos:", e?.code, e?.message);
        alert("No se pudieron cargar los productos.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Congelamiento de precios por cliente: algunos clientes puntuales
  // (acordado a mano, ej. Stortini) mantienen el precio viejo hasta una
  // fecha/hora límite guardada en su perfil (users/{uid}.congelamientoPrecios
  // = { hasta: Timestamp, precios: { "<precioNuevo>": precioViejo, ... } }).
  // Mapea por VALOR de precio (no por SKU) porque el mismo aumento aplica
  // igual a todas las variantes de un modelo. Es idempotente: una vez
  // reemplazado el precio por el viejo, ya no vuelve a matchear el mapa, así
  // que no hay riesgo de aplicarlo dos veces ni de loop de renders.
  useEffect(() => {
    const congelamiento = profile?.congelamientoPrecios;
    const precios = congelamiento?.precios;
    const hasta = congelamiento?.hasta;
    if (!precios || !hasta) return;
    const hastaMs = typeof hasta?.toDate === "function" ? hasta.toDate().getTime() : new Date(hasta).getTime();
    if (!Number.isFinite(hastaMs) || Date.now() >= hastaMs) return;

    setItems((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        const viejo = precios[String(p.priceArs)];
        if (viejo == null) return p;
        const viejoNum = Number(viejo);
        if (!Number.isFinite(viejoNum) || viejoNum === p.priceArs) return p;
        changed = true;
        return { ...p, priceArs: viejoNum };
      });
      return changed ? next : prev;
    });
  }, [items, profile?.congelamientoPrecios]);

  useEffect(() => {
    setCart((prev) => {
      let changed = false;
      const next = [];
      for (const item of prev) {
        const product = items.find((p) => p.id === item.id);
        const stock = Number(product?.stock ?? 0);
        if (!product || stock <= 0) {
          changed = true;
          continue;
        }
        const clampedQty = Math.min(item.qty, stock);
        const latestPriceUsd = Number(product?.price ?? item.priceUsd ?? 0);
        const latestPriceArs = product?.priceArs != null ? Number(product.priceArs) : null;
        if (clampedQty !== item.qty) {
          changed = true;
          next.push({ ...item, qty: clampedQty, priceUsd: latestPriceUsd, priceArs: latestPriceArs });
        } else {
          const latestImageUrl = getProductImages(product)[0] || "";
          const needsUpdate =
            item.priceUsd !== latestPriceUsd || item.priceArs !== latestPriceArs || item.imageUrl !== latestImageUrl;
          next.push(
            needsUpdate
              ? { ...item, priceUsd: latestPriceUsd, priceArs: latestPriceArs, imageUrl: latestImageUrl }
              : item
          );
        }
      }
      if (!changed && next.length === prev.length) return prev;
      return next;
    });
  }, [items]);

  const categories = useMemo(() => {
    const set = new Set(items.map((p) => p.category || "general"));
    return Array.from(set)
      .sort()
      .map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));
  }, [items]);

  const toggleCategory = (id) =>
    setSelectedCats((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));

  const clearFilters = () => {
    setSelectedCats([]);
    setSearch("");
  };

  const filtered = useMemo(() => {
    let list = items;
    if (selectedCats.length)
      list = list.filter((p) => selectedCats.includes(p.category || "general"));

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.brand || "").toLowerCase().includes(q)
      );
    }

    const priceValue = (product) => {
      const contabiliumArs = product.priceArs != null ? Number(product.priceArs) : null;
      if (Number.isFinite(contabiliumArs) && contabiliumArs > 0) return contabiliumArs;
      const ars = toArs(product.price, exchangeRate);
      const usd = Number(product.price || 0);
      if (Number.isFinite(ars) && ars > 0) return ars;
      return Number.isFinite(usd) ? usd : 0;
    };

    switch (sort) {
      case "name":
        list = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "newest":
        list = [...list].sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        break;
      case "priceAsc":
        list = [...list].sort((a, b) => priceValue(a) - priceValue(b));
        break;
      case "priceDesc":
        list = [...list].sort((a, b) => priceValue(b) - priceValue(a));
        break;
      default:
        break;
    }
    return list;
  }, [items, selectedCats, search, sort, exchangeRate]);

  const catalogEntries = useMemo(() => {
    const map = new Map();
    for (const p of filtered) {
      const { base, talle, colorLabel } = parseVariant(p.name);
      if (!colorLabel) {
        map.set(`solo:${p.id}`, { isGroup: false, product: p });
        continue;
      }
      const key = `${p.category || "general"}::${normalizeBase(base)}`;
      if (!map.has(key)) {
        map.set(key, { isGroup: true, id: key, base, category: p.category, variants: [] });
      }
      map.get(key).variants.push({ product: p, talle, colorLabel });
    }
    const list = [];
    for (const entry of map.values()) {
      if (entry.isGroup && entry.variants.length === 1) {
        list.push({ isGroup: false, product: entry.variants[0].product });
      } else {
        list.push(entry);
      }
    }
    const categoryRank = (entry) => {
      const cat = (entry.isGroup ? entry.category : entry.product.category) || "";
      if (cat.toUpperCase() === "BICICLETAS") return 0;
      if (cat.toUpperCase() === "ACCESORIOS") return 1;
      return 2;
    };
    return list
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => categoryRank(a.entry) - categoryRank(b.entry) || a.index - b.index)
      .map(({ entry }) => entry);
  }, [filtered]);

  const handleGenerarCatalogoPdf = async () => {
    setGeneratingPdf(true);
    try {
      // Usa la misma lista agrupada por modelo que se ve en pantalla (un
      // modelo con 3 colores es UNA fila "desde $X", no 3 filas repetidas)
      // para que el PDF no quede redundante, ordenada bicicletas primero y
      // accesorios después en vez del orden mezclado que trae Firestore.
      const categoryRank = (entry) => {
        const cat = (entry.isGroup ? entry.category : entry.product.category) || "";
        if (cat.toUpperCase() === "BICICLETAS") return 0;
        if (cat.toUpperCase() === "ACCESORIOS") return 1;
        return 2;
      };
      const nameOf = (entry) => (entry.isGroup ? entry.base : entry.product.name) || "";
      const ordenados = [...catalogEntries].sort(
        (a, b) => categoryRank(a) - categoryRank(b) || nameOf(a).localeCompare(nameOf(b))
      );

      const categoryLabel = (entry) => {
        const cat = ((entry.isGroup ? entry.category : entry.product.category) || "").toUpperCase();
        if (cat === "BICICLETAS") return "Bicicletas";
        if (cat === "ACCESORIOS") return "Accesorios";
        return "Otros";
      };

      const items = ordenados.map((entry) => {
        if (!entry.isGroup) {
          const p = entry.product;
          return {
            id: p.id,
            name: p.name,
            category: categoryLabel(entry),
            imageUrl: getProductImages(p)[0] || "",
            priceArs: listPriceArs(p, exchangeRate),
            priceUsd: p.price,
          };
        }
        const withImages = entry.variants.find((v) => getProductImages(v.product).length);
        const arsPrices = entry.variants.map((v) => listPriceArs(v.product, exchangeRate)).filter((n) => n != null);
        const usdPrices = entry.variants.map((v) => Number(v.product.price || 0)).filter((n) => Number.isFinite(n) && n > 0);
        return {
          id: entry.variants[0].product.id,
          name: entry.base,
          category: categoryLabel(entry),
          imageUrl: withImages ? getProductImages(withImages.product)[0] : "",
          priceArs: arsPrices.length ? Math.min(...arsPrices) : null,
          priceUsd: usdPrices.length ? Math.min(...usdPrices) : null,
          desde: entry.variants.length > 1,
        };
      });

      await generateCatalogPdf(items);
    } catch (err) {
      alert(err.message || "No se pudo generar el catálogo PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const addToCart = (p) => {
    const availableStock = Number(p?.stock ?? 0);
    if (availableStock <= 0) {
      alert("No hay stock disponible para este producto.");
      return;
    }
    setCartOpen(true);
    setCart((prev) => {
      const existing = prev.find((x) => x.id === p.id);
      if (existing) {
        if (existing.qty >= availableStock) {
          alert("Alcanzaste el stock disponible de este producto.");
          return prev;
        }
        return prev.map((x) =>
          x.id === p.id
            ? { ...x, qty: Math.min(availableStock, x.qty + 1) }
            : x
        );
      }
      return [
        ...prev,
        {
          id:       p.id,
          name:     p.name,
          sku:      p.sku || "",
          priceUsd: Number(p.price || 0),
          priceArs: p.priceArs != null ? Number(p.priceArs) : null,
          imageUrl: getProductImages(p)[0] || "",
          qty:      1,
        },
      ];
    });
  };

  const setQty = (id, qty) =>
    setCart((prev) => {
      const product = items.find((p) => p.id === id);
      const maxQty = Number(product?.stock ?? 0);
      if (!product || maxQty <= 0) {
        return prev.filter((x) => x.id !== id);
      }
      const nextQty = Math.max(1, Math.min(maxQty, Number(qty || 1)));
      return prev.map((x) => (x.id === id ? { ...x, qty: nextQty } : x));
    });

  const removeFromCart = (id) => setCart((prev) => prev.filter((x) => x.id !== id));
  const clearCart = () => setCart([]);

  const cartTotal = useMemo(
    () =>
      cart.reduce((acc, it) => {
        const contabiliumArs = it.priceArs != null ? Number(it.priceArs) : null;
        const convertedArs   = toArs(it.priceUsd, exchangeRate);
        const base = Number.isFinite(contabiliumArs) && contabiliumArs > 0
          ? contabiliumArs
          : (Number.isFinite(convertedArs) ? convertedArs : Number(it.priceUsd || 0));
        return acc + getEffectivePrice(base, discount, isLoggedIn) * it.qty;
      }, 0),
    [cart, discount, isLoggedIn, exchangeRate]
  );

  async function submitOrder(customer) {
    setOrderResult(null);

    if (!cart.length) {
      setOrderResult({ ok: false, error: "Tu carrito está vacío." });
      return;
    }

    const orderItems = cart.map(({ id, name, sku, priceUsd, priceArs: itemPriceArs, qty }) => {
      const contabiliumArs = itemPriceArs != null ? Number(itemPriceArs) : null;
      const convertedArs   = toArs(priceUsd, exchangeRate);
      const base = Number.isFinite(contabiliumArs) && contabiliumArs > 0
        ? contabiliumArs
        : (Number.isFinite(convertedArs) ? convertedArs : Number(priceUsd || 0));
      return {
        id,
        name,
        sku,
        price: getEffectivePrice(base, discount, isLoggedIn),
        qty,
      };
    });
    const shortages = orderItems.filter((item) => {
      const product = items.find((p) => p.id === item.id);
      const available = Number(product?.stock ?? 0);
      return !product || available < item.qty;
    });

    if (shortages.length) {
      const names = shortages.map((it) => it.name).join(", ");
      setOrderResult({
        ok: false,
        error: `No hay stock suficiente para: ${names}. Actualizá las cantidades antes de continuar.`,
      });
      return;
    }

    try {
      setOrderSubmitting(true);

      // Chequeo final en vivo contra Contabilium: el stock de arriba es el
      // cacheado del catálogo (sync cada 15 min), puede estar desactualizado.
      const liveCheck = await checkStockEnVivo(orderItems);
      if (!liveCheck.ok) {
        const names = liveCheck.shortages.map((s) => s.name).join(", ");
        setOrderResult({
          ok: false,
          error: `No hay stock suficiente para: ${names}. Actualizá las cantidades antes de continuar.`,
        });
        setOrderSubmitting(false);
        return;
      }

      const orderId = await createOrder({
        customer,
        items: orderItems,
      });
      setOrderResult({ ok: true, orderId });
      setItems((prev) =>
        prev.map((product) => {
          const match = orderItems.find((it) => it.id === product.id);
          if (!match) return product;
          const currentStock = Number(product?.stock ?? 0);
          const nextStock = Math.max(0, currentStock - match.qty);
          return { ...product, stock: nextStock };
        })
      );
      clearCart();
    } catch (e) {
      console.error(e);
      setOrderResult({ ok: false, error: e?.message || "Error al crear el pedido" });
    } finally {
      setOrderSubmitting(false);
    }
  }

  // Scroll to a product highlighted via URL ?p=PRODUCT_ID
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const productId = params.get("p");
    if (!productId || !items.length) return;
    let el = document.getElementById(`product-${productId}`);
    if (!el) {
      const owningEntry = catalogEntries.find((entry) =>
        entry.isGroup
          ? entry.variants.some((v) => v.product.id === productId)
          : entry.product.id === productId
      );
      if (owningEntry) {
        const key = owningEntry.isGroup ? owningEntry.id : owningEntry.product.id;
        el = document.getElementById(`product-${key}`);
      }
    }
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [items, catalogEntries, location.search]);

  // Link "privado" del catálogo PDF: nadie puede ver precios sin sesión
  // navegando el catálogo normal, pero si entrás con el link puntual de un
  // producto (?p=ID, el que se manda por WhatsApp), ESE producto se
  // desbloquea igual sin necesidad de loguearse — el resto del catálogo
  // sigue pidiendo login.
  const unlockedEntryKey = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const productId = params.get("p");
    if (!productId) return null;
    const owningEntry = catalogEntries.find((entry) =>
      entry.isGroup ? entry.variants.some((v) => v.product.id === productId) : entry.product.id === productId
    );
    if (!owningEntry) return null;
    return owningEntry.isGroup ? owningEntry.id : owningEntry.product.id;
  }, [catalogEntries, location.search]);

  const showSkeleton = loading && !initialLoaded;
  const showOverlay = loading && initialLoaded;
  const closeProductModal = () => setSelectedEntry(null);
  const showUsd = false;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-black dark:text-white">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(165,180,252,0.18),_transparent_55%)] animate-drift-slow" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-sky-400 via-indigo-400 to-slate-300" />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
            <div>
              <Reveal as="h1" className="text-3xl font-semibold text-slate-900 dark:text-white sm:text-4xl lg:text-5xl">
                Descubrí todo nuestro portfolio
              </Reveal>
              <Reveal delay={40} className="mt-2 max-w-lg text-sm text-slate-500 dark:text-neutral-400 sm:text-base">
                Bicicletas y accesorios Samurai listos para pedir — elegí una categoría o buscá directo lo que necesitás.
              </Reveal>
            </div>
            <Reveal delay={100}>
              <button
                onClick={() => setCartOpen(true)}
                className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-300/40 transition active:scale-95 hover:-translate-y-0.5 sm:w-auto"
              >
                Carrito ({cart.length})
              </button>
            </Reveal>
          </div>

          <div className="mt-8 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-6">
            <Reveal delay={80}>
              <button
                onClick={() => {
                  setSelectedCats(["BICICLETAS"]);
                  document.getElementById("catalogo-resultados")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="group relative w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-[0_30px_60px_-40px_rgba(15,23,42,0.2)] transition active:scale-[0.98] hover:-translate-y-1 hover:border-sky-400/60 hover:shadow-[0_40px_80px_-40px_rgba(15,23,42,0.28)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5 sm:p-10"
              >
                <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-sky-200/50 blur-3xl transition group-hover:bg-sky-300/60" />
                <span className="relative text-2xl font-semibold text-slate-900 dark:text-white sm:text-3xl lg:text-4xl">Bicicletas</span>
                <p className="relative mt-2 text-sm text-slate-500 dark:text-neutral-400 sm:mt-3">Ver todo el catálogo de bicicletas Samurai.</p>
              </button>
            </Reveal>
            <Reveal delay={160}>
              <button
                onClick={() => {
                  setSelectedCats(["ACCESORIOS"]);
                  document.getElementById("catalogo-resultados")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="group relative w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-[0_30px_60px_-40px_rgba(15,23,42,0.2)] transition active:scale-[0.98] hover:-translate-y-1 hover:border-indigo-400/60 hover:shadow-[0_40px_80px_-40px_rgba(15,23,42,0.28)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5 sm:p-10"
              >
                <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-indigo-200/50 blur-3xl transition group-hover:bg-indigo-300/60" />
                <span className="relative text-2xl font-semibold text-slate-900 dark:text-white sm:text-3xl lg:text-4xl">Accesorios</span>
                <p className="relative mt-2 text-sm text-slate-500 dark:text-neutral-400 sm:mt-3">Ver todo el catálogo de accesorios.</p>
              </button>
            </Reveal>
          </div>
        </div>
      </section>

      <div id="catalogo-resultados" className="relative z-10 mx-auto max-w-7xl scroll-mt-20 px-4 pb-16 sm:px-6 lg:px-8">
        <div className="grid gap-8">
          <section className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full items-center gap-3 sm:max-w-sm">
                <div className="flex-1">
                  <label className="sr-only">Buscar</label>
                  <input
                    type="search"
                    placeholder="Buscar por producto o marca"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500"
                  />
                </div>
              </div>

              <SortBar sort={sort} setSort={setSort} />
            </div>

            <ActiveFilters
              categories={categories}
              selected={selectedCats}
              onRemove={(id) => toggleCategory(id)}
              onClear={clearFilters}
            />

            {isLoggedIn && (
              <div className="flex flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={handleGenerarCatalogoPdf}
                  disabled={generatingPdf}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-sky-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {generatingPdf ? "Generando…" : "📄 Generar catálogo PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${SITE_URL}/catalogo`).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    });
                  }}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-sky-600 dark:text-neutral-400 dark:hover:text-sky-400"
                >
                  {linkCopied ? "✓ Link copiado" : `🔗 Copiar link del catálogo (${SITE_URL.replace(/^https?:\/\//, "")}/catalogo)`}
                </button>
              </div>
            )}

            {(() => {
              const hasGroups = catalogEntries.some((entry) => entry.isGroup);
              const hasStandalone = catalogEntries.some((entry) => !entry.isGroup);
              if (!hasGroups) return null;
              return (
                <p className="text-sm text-slate-500">
                  {hasStandalone
                    ? "Las bicicletas tienen distintos colores y talles: elegí un modelo para verlos. Los accesorios se agregan directo al carrito."
                    : "Elegí un modelo para ver sus colores y talles disponibles."}
                </p>
              );
            })()}

            <div className="relative">
              {showOverlay && (
                <LoadingOverlay
                  label="Actualizando catálogo…"
                  className="rounded-3xl border border-slate-200 bg-white/90 text-slate-600"
                  labelClassName="text-slate-500"
                />
              )}
              {showSkeleton ? (
                <ProductGridSkeleton />
              ) : (
                <ProductGrid
                  entries={catalogEntries}
                  isLoggedIn={isLoggedIn}
                  unlockedKey={unlockedEntryKey}
                  discount={discount}
                  onAdd={addToCart}
                  exchangeRate={exchangeRate}
                  showUsd={showUsd}
                  onSelect={setSelectedEntry}
                />
              )}
            </div>
          </section>
        </div>
      </div>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        setQty={setQty}
        removeItem={removeFromCart}
        total={cartTotal}
        isLoggedIn={isLoggedIn}
        discount={discount}
        exchangeRate={exchangeRate}
        onCheckout={() => {
          const hasIssues = cart.some((item) => {
            const product = items.find((p) => p.id === item.id);
            const available = Number(product?.stock ?? 0);
            return !product || available < item.qty;
          });
          if (hasIssues) {
            alert("Actualizá las cantidades: no hay stock suficiente para continuar.");
            return;
          }
          setCartOpen(false);
          setOrderOpen(true);
          setOrderResult(null);
        }}
        products={items}
      />

      <ProductModal
        entry={selectedEntry}
        onClose={closeProductModal}
        isLoggedIn={
          isLoggedIn ||
          (!!selectedEntry &&
            unlockedEntryKey != null &&
            (selectedEntry.isGroup ? selectedEntry.id : selectedEntry.product.id) === unlockedEntryKey)
        }
        discount={discount}
        exchangeRate={exchangeRate}
        showUsd={showUsd}
        onAdd={(product) => {
          addToCart(product);
          closeProductModal();
          setCartOpen(true);
        }}
      />

      <OrderModal
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        submitting={orderSubmitting}
        result={orderResult}
        onSubmit={submitOrder}
        profile={profile}
        isLoggedIn={isLoggedIn}
      />
    </main>
  );
}

function SortBar({ sort, setSort }) {
  return (
    <div className="shrink-0">
      <label className="sr-only">Ordenar</label>
      <select
        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        value={sort}
        onChange={(e) => setSort(e.target.value)}
      >
        {SORTS.map((s) => (
          <option key={s.id} value={s.id} className="text-slate-900">
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ActiveFilters({ categories, selected, onRemove, onClear }) {
  if (!selected.length) return null;
  const map = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {selected.map((id) => (
        <button
          key={id}
          onClick={() => onRemove(id)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-1.5 text-slate-600 transition hover:border-sky-500 hover:text-slate-900"
        >
          {map[id]}
          <span className="text-slate-500">✕</span>
        </button>
      ))}
      <button onClick={onClear} className="rounded-full px-3 py-1 text-slate-500 hover:text-slate-600">
        Limpiar todo
      </button>
    </div>
  );
}

function entryCategory(entry) {
  const cat = ((entry.isGroup ? entry.category : entry.product.category) || "").toUpperCase();
  if (cat === "BICICLETAS") return "Bicicletas";
  if (cat === "ACCESORIOS") return "Accesorios";
  return "Otros";
}

function ProductGrid({ entries, isLoggedIn, unlockedKey = null, discount = 0, onAdd, exchangeRate, showUsd = true, onSelect }) {
  if (!entries.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300/60 bg-white p-12 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        No encontramos resultados. Ajustá tus filtros para explorar más productos.
      </div>
    );
  }

  const sections = [];
  for (const entry of entries) {
    const label = entryCategory(entry);
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else sections.push({ label, entries: [entry] });
  }
  // Si hay más de un bloque con la misma categoría (por el orden original), los unificamos.
  const merged = [];
  for (const s of sections) {
    const existing = merged.find((m) => m.label === s.label);
    if (existing) existing.entries.push(...s.entries);
    else merged.push(s);
  }

  return (
    <div className="space-y-10 sm:space-y-14">
      {merged.map((section) => (
        <section key={section.label}>
          {merged.length > 1 && (
            <div className="mb-4 flex items-center gap-3 sm:mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white sm:text-xl">{section.label}</h2>
              <span className="h-px flex-1 bg-slate-200 dark:bg-neutral-800" />
              <span className="text-xs font-medium text-slate-400 dark:text-neutral-500">
                {section.entries.length} producto{section.entries.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
          <ul className="grid gap-4 grid-cols-2 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {section.entries.map((entry, idx) => {
              const key = entry.isGroup ? entry.id : entry.product.id;
              const unlocked = isLoggedIn || (unlockedKey != null && key === unlockedKey);
              return (
                <Reveal as="li" key={key} id={`product-${key}`} delay={Math.min(idx * 45, 360)}>
                  {entry.isGroup ? (
                    <GroupCard
                      entry={entry}
                      isLoggedIn={unlocked}
                      exchangeRate={exchangeRate}
                      showUsd={showUsd}
                      onSelect={() => onSelect?.(entry)}
                    />
                  ) : (
                    <ProductCard
                      product={entry.product}
                      isLoggedIn={unlocked}
                      discount={discount}
                      onAdd={onAdd}
                      exchangeRate={exchangeRate}
                      showUsd={showUsd}
                      onSelect={() => onSelect?.(entry)}
                    />
                  )}
                </Reveal>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GroupCard({ entry, isLoggedIn, exchangeRate, showUsd = true, onSelect }) {
  const withImages = entry.variants.find((v) => getProductImages(v.product).length);
  const image = withImages ? getProductImages(withImages.product)[0] : null;
  const brand = entry.variants[0]?.product.brand;
  const available = entry.variants.some((v) => Number(v.product.stock ?? 0) > 0);
  // Precio real: prioriza el priceArs sincronizado de Contabilium por variante;
  // solo cae al cálculo en USD para las variantes que todavía no tienen SKU vinculado.
  const variantArsPrices = entry.variants
    .map((v) => {
      const contabiliumArs = v.product.priceArs != null ? Number(v.product.priceArs) : null;
      if (Number.isFinite(contabiliumArs) && contabiliumArs > 0) return contabiliumArs;
      const convertedArs = toArs(Number(v.product.price || 0), exchangeRate);
      return Number.isFinite(convertedArs) && convertedArs > 0 ? convertedArs : null;
    })
    .filter((n) => n != null);
  const minPriceArs = variantArsPrices.length ? Math.min(...variantArsPrices) : null;
  const usdPrices = entry.variants
    .map((v) => Number(v.product.price || 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const minPriceUsd = usdPrices.length ? Math.min(...usdPrices) : null;
  const colorsCount = new Set(entry.variants.map((v) => v.colorLabel)).size;
  const isNew = entry.variants.some((v) => isRecentlyAdded(v.product.createdAt));

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/70 transition duration-200 hover:-translate-y-1 hover:border-rose-400/60 hover:shadow-xl hover:shadow-slate-200 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5 dark:hover:border-rose-500/50"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-slate-50 dark:bg-neutral-800">
        {image ? (
          <img src={image} alt={entry.base} className="h-full w-full object-contain transition duration-300 group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400 dark:text-neutral-500">Sin imagen</div>
        )}
        {isNew && (
          <span className="absolute left-2 top-2 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow">
            Nuevo
          </span>
        )}
        {!available && (
          <span className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-2.5 py-1 text-[10px] font-semibold text-white">
            Sin stock
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5 sm:p-4">
        {brand ? <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-neutral-500">{brand}</p> : null}
        <h3 className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">{entry.base}</h3>
        <p className="text-xs text-slate-500 dark:text-neutral-400">{colorsCount} {colorsCount === 1 ? "color" : "colores"} disponibles</p>
        <div className="mt-auto pt-2">
          {!isLoggedIn ? (
            <p className="text-xs text-slate-500 dark:text-neutral-400">Iniciá sesión para ver el precio</p>
          ) : minPriceArs != null ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">Desde</div>
              <div className="text-xl font-extrabold leading-tight text-slate-900 dark:text-white">{money(minPriceArs)}</div>
              {showUsd && (
                <div className="text-[10px] text-slate-400 dark:text-neutral-500">{formatUsd(minPriceUsd)} USD</div>
              )}
            </div>
          ) : null}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          className="mt-2 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-rose-200/60 transition active:scale-95 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-rose-400/60"
        >
          Ver colores y talles
        </button>
      </div>
    </article>
  );
}

function ProductGridSkeleton({ count = 8 }) {
  return (
    <ul className="grid gap-4 grid-cols-2 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index} className="animate-pulse">
          <div className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="aspect-[4/3] w-full rounded-xl bg-slate-200 dark:bg-neutral-800" />
            <div className="mt-4 space-y-3">
              <div className="h-3 w-24 rounded bg-slate-200/80 dark:bg-neutral-800" />
              <div className="h-4 w-40 rounded bg-slate-200/80 dark:bg-neutral-800" />
              <div className="h-8 w-full rounded-xl bg-slate-200/80 dark:bg-neutral-800" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProductCard({ product, onAdd, discount = 0, isLoggedIn, exchangeRate, showUsd = true, onSelect }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePos, setSharePos] = useState({ top: 0, right: 0 });
  const shareButtonRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [activeImg, setActiveImg] = useState(0);
  const timerRef = useRef(null);
  const images = getProductImages(product);
  const available = (product.stock ?? 0) > 0;

  useEffect(() => () => clearInterval(timerRef.current), []);

  useEffect(() => {
    if (!shareOpen) return;
    const close = () => setShareOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [shareOpen]);

  const productUrl = `${SITE_URL}/catalogo?p=${product.id}`;

  function shareToWhatsApp() {
    const text = encodeURIComponent(`Mirá esta bici: ${product.name} — ${productUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
    setShareOpen(false);
  }

  function shareToFacebook() {
    window.open(`https://www.facebook.com/sharer.php?u=${encodeURIComponent(productUrl)}`, "_blank");
    setShareOpen(false);
  }

  function copyLink() {
    navigator.clipboard.writeText(productUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    setShareOpen(false);
  }

  function copyImageForInstagram() {
    const url = images[0] || productUrl;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    setShareOpen(false);
  }
  const effectiveDiscount = Number.isFinite(Number(discount)) ? Number(discount) : 0;
  const priceUsd = Number(product?.price || 0);
  const contabiliumArs = product.priceArs != null ? Number(product.priceArs) : null;
  const convertedArs = toArs(priceUsd, exchangeRate);
  const basePriceArs = Number.isFinite(contabiliumArs) && contabiliumArs > 0
    ? contabiliumArs
    : (Number.isFinite(convertedArs) && convertedArs > 0 ? convertedArs : null);
  const discountedPriceArs = getEffectivePrice(basePriceArs ?? 0, effectiveDiscount, isLoggedIn);
  const discountedPriceUsd = getEffectivePrice(priceUsd, effectiveDiscount, isLoggedIn);
  const hasDiscount =
    isLoggedIn &&
    effectiveDiscount > 0 &&
    basePriceArs != null &&
    discountedPriceArs !== basePriceArs &&
    basePriceArs > 0;
  const isNew = isRecentlyAdded(product.createdAt);

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/70 transition duration-200 hover:-translate-y-1 hover:border-rose-400/60 hover:shadow-xl hover:shadow-slate-200 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5 dark:hover:border-rose-500/50"
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(product)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(product);
        }
      }}
      onMouseEnter={() => {
        if (images.length > 1) {
          timerRef.current = setInterval(
            () => setActiveImg((c) => (c + 1) % images.length),
            1200
          );
        }
      }}
      onMouseLeave={() => {
        clearInterval(timerRef.current);
        setActiveImg(0);
      }}
    >
      {/* Share button */}
      <div className="absolute right-2 top-2 z-20" onClick={(e) => e.stopPropagation()}>
        <button
          ref={shareButtonRef}
          onClick={() => {
            const rect = shareButtonRef.current?.getBoundingClientRect();
            if (rect) setSharePos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
            setShareOpen((v) => !v);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 shadow backdrop-blur transition hover:bg-white dark:bg-neutral-800/80 dark:hover:bg-neutral-800"
          title="Compartir"
        >
          <ShareIcon className="h-3.5 w-3.5 text-slate-500 dark:text-neutral-300" />
        </button>
        {shareOpen && createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setShareOpen(false)} />
            <div className="fixed z-[100] w-44 rounded-2xl border border-slate-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900" style={{ top: sharePos.top, right: sharePos.right }}>
              <button onClick={shareToWhatsApp} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
                <span className="text-emerald-500">W</span> WhatsApp
              </button>
              <button onClick={shareToFacebook} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
                <span className="text-blue-600">f</span> Facebook
              </button>
              <button onClick={copyImageForInstagram} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
                <span className="text-pink-500">📷</span> Instagram (copiar URL)
              </button>
              <button onClick={copyLink} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
                <span>🔗</span> Copiar link
              </button>
            </div>
          </>,
          document.body
        )}
        {copied && (
          <div className="absolute right-0 top-9 z-20 rounded-xl bg-slate-900 px-2 py-1 text-[10px] text-white shadow dark:bg-neutral-100 dark:text-neutral-900">
            ¡Copiado!
          </div>
        )}
      </div>

      <div className="relative aspect-square w-full overflow-hidden bg-slate-50 dark:bg-neutral-800">
        {images.length > 0 ? (
          <img
            src={images[activeImg]}
            alt={product.name}
            className="h-full w-full object-contain transition-opacity duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400 dark:text-neutral-500">
            Sin imagen
          </div>
        )}
        {isNew && (
          <span className="absolute left-2 top-2 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow">
            Nuevo
          </span>
        )}
        {!available && (
          <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2.5 py-1 text-[10px] font-semibold text-white">
            Sin stock
          </span>
        )}
        {images.length > 1 && (
          <div className="pointer-events-none absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
            {images.slice(0, 5).map((_, i) => (
              <span
                key={i}
                className={`h-1 w-1 rounded-full transition-colors ${
                  i === activeImg ? "bg-rose-500" : "bg-slate-300 dark:bg-neutral-600"
                }`}
              />
            ))}
            {images.length > 5 && (
              <span className="text-[9px] text-slate-400 dark:text-neutral-500">+{images.length - 5}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5 sm:p-4">
        {product.brand ? (
          <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-neutral-500">{product.brand}</p>
        ) : null}
        <h3 className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">{product.name}</h3>
        {product.description ? (
          <p
            className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {product.description}
          </p>
        ) : null}
        <div className="mt-auto pt-1">
          {!isLoggedIn ? (
            <p className="text-xs text-slate-500 dark:text-neutral-400">Iniciá sesión para ver el precio</p>
          ) : (
            <>
              {basePriceArs != null && basePriceArs > 0 ? (
                <div>
                  {hasDiscount && (
                    <div className="text-[10px] font-medium text-slate-400 line-through dark:text-neutral-500">
                      {money(basePriceArs)}
                    </div>
                  )}
                  <div className="text-xl font-extrabold leading-tight text-slate-900 dark:text-white">
                    {money(hasDiscount ? discountedPriceArs : basePriceArs)}
                  </div>
                  {showUsd && (
                    <div className="text-[10px] text-slate-400 dark:text-neutral-500">
                      {hasDiscount
                        ? <><span className="line-through mr-1">{formatUsd(priceUsd)}</span>{formatUsd(discountedPriceUsd)} USD</>
                        : <>{formatUsd(discountedPriceUsd)} USD</>
                      }
                    </div>
                  )}
                </div>
              ) : null}
              {hasDiscount && (
                <p className="text-[10px] font-semibold text-emerald-600">Descuento del {effectiveDiscount}%</p>
              )}
            </>
          )}
        </div>
        <button
          disabled={!available}
          onClick={(e) => {
            e.stopPropagation();
            onAdd(product);
          }}
          className={`mt-2 flex w-full items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-rose-400/60 ${
            available
              ? "bg-gradient-to-r from-rose-600 to-orange-500 text-white shadow-md shadow-rose-200/60 active:scale-95 hover:-translate-y-0.5"
              : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500"
          }`}
        >
          Agregar al carrito
        </button>
      </div>
    </article>
  );
}

function ImageGallery({ images, productName }) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(images.length - 1, c + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length]);

  if (!images.length) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
        Sin imagen
      </div>
    );
  }

  const prev = () => setCurrent((c) => Math.max(0, c - 1));
  const next = () => setCurrent((c) => Math.min(images.length - 1, c + 1));

  return (
    <div className="space-y-3">
      <div
        className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-50 dark:bg-neutral-800"
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null) return;
          const delta = e.changedTouches[0].clientX - touchStartX.current;
          if (delta > 40) prev();
          else if (delta < -40) next();
          touchStartX.current = null;
        }}
      >
        <img
          src={images[current]}
          alt={productName}
          className="h-full w-full object-contain p-2 transition-opacity duration-200"
          loading={current === 0 ? "eager" : "lazy"}
        />
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); prev(); }}
              disabled={current === 0}
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow backdrop-blur transition hover:bg-white disabled:opacity-30 dark:bg-neutral-900/80 dark:hover:bg-neutral-900"
            >
              <ChevronLeftIcon className="h-4 w-4 text-slate-700 dark:text-neutral-200" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); next(); }}
              disabled={current === images.length - 1}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow backdrop-blur transition hover:bg-white disabled:opacity-30 dark:bg-neutral-900/80 dark:hover:bg-neutral-900"
            >
              <ChevronRightIcon className="h-4 w-4 text-slate-700 dark:text-neutral-200" />
            </button>
            <div className="absolute bottom-2 left-0 right-0 flex justify-center">
              <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white">
                {current + 1} / {images.length}
              </span>
            </div>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === current ? "border-sky-500" : "border-transparent hover:border-slate-300 dark:hover:border-neutral-600"
              }`}
            >
              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModalShell({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm dark:bg-black/70">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <button
          className="sticky top-4 float-right mr-4 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-200 z-10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          onClick={onClose}
        >
          Cerrar
        </button>
        <div className="flex flex-col gap-6 p-6">{children}</div>
      </div>
    </div>
  );
}

function ProductDetailBody({ product, onClose, isLoggedIn, discount = 0, exchangeRate, showUsd = true, onAdd }) {
  const images = getProductImages(product);
  const available = (product.stock ?? 0) > 0;
  const effectiveDiscount = Number.isFinite(Number(discount)) ? Number(discount) : 0;
  const priceUsd = Number(product?.price || 0);
  const contabiliumArs = product.priceArs != null ? Number(product.priceArs) : null;
  const convertedArs = toArs(priceUsd, exchangeRate);
  const basePriceArs = Number.isFinite(contabiliumArs) && contabiliumArs > 0
    ? contabiliumArs
    : (Number.isFinite(convertedArs) && convertedArs > 0 ? convertedArs : priceUsd);
  const discountedPriceArs = getEffectivePrice(basePriceArs, effectiveDiscount, isLoggedIn);
  const discountedPriceUsd = getEffectivePrice(priceUsd, effectiveDiscount, isLoggedIn);
  const hasDiscount =
    isLoggedIn && effectiveDiscount > 0 && discountedPriceArs !== basePriceArs && basePriceArs > 0;

  return (
    <>
      <div>
        <ImageGallery images={images} productName={product.name} />
      </div>
      <div className="space-y-4 text-slate-700 dark:text-neutral-300">
        {product.brand ? (
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-neutral-400">{product.brand}</p>
        ) : null}
        <h3 className="text-2xl font-semibold text-slate-900 dark:text-white">{product.name}</h3>
        {product.description ? (
          <p className="text-sm leading-relaxed text-slate-700 dark:text-neutral-300 whitespace-pre-line">{product.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium ${
              available ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"
            }`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            {available ? "Disponible" : "Sin stock"}
          </span>
          {Number.isFinite(product?.stock) ? (
            <span className="rounded-full bg-slate-50 px-3 py-1.5 font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">Stock: {product.stock}</span>
          ) : null}
          {product.category ? (
            <span className="rounded-full bg-slate-50 px-3 py-1.5 font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">Categoría: {product.category}</span>
          ) : null}
        </div>
        <div className="space-y-1 text-sm font-medium text-slate-900 dark:text-white">
          {!isLoggedIn ? (
            <p className="text-sm text-slate-500 dark:text-neutral-400">Iniciá sesión para ver el precio</p>
          ) : (
            <>
              {Number.isFinite(basePriceArs) && basePriceArs > 0 ? (
                hasDiscount ? (
                  <>
                    <span className="mr-2 text-base font-semibold line-through text-slate-400 dark:text-neutral-500">{money(basePriceArs)}</span>
                    <span className="text-2xl font-semibold">{money(discountedPriceArs)}</span>
                  </>
                ) : (
                  <span className="text-2xl font-semibold">{money(discountedPriceArs)}</span>
                )
              ) : null}
              {showUsd && Number.isFinite(basePriceArs) && basePriceArs > 0 && (
                <div className="text-xs font-medium text-slate-600 dark:text-neutral-400">
                  {hasDiscount ? (
                    <>
                      <span className="mr-2 line-through text-slate-400 dark:text-neutral-500">{formatUsd(priceUsd)}</span>
                      <span>{formatUsd(discountedPriceUsd)} USD</span>
                    </>
                  ) : (
                    <span>{formatUsd(discountedPriceUsd)} USD</span>
                  )}
                </div>
              )}
              {hasDiscount && (
                <p className="text-xs text-emerald-600">Descuento activo del {effectiveDiscount}%.</p>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-neutral-400">
          {product.sku ? <span className="rounded-full bg-slate-50 px-3 py-1.5 dark:bg-neutral-800">SKU: {product.sku}</span> : null}
          {product.reference ? (
            <span className="rounded-full bg-slate-50 px-3 py-1.5 dark:bg-neutral-800">Referencia: {product.reference}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            disabled={!available}
            onClick={() => onAdd?.(product)}
            className={`flex items-center justify-center rounded-2xl px-5 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-400/60 ${
              available
                ? "bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-200/60 hover:-translate-y-0.5"
                : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500"
            }`}
          >
            Agregar al carrito
          </button>
          <button
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Cerrar
          </button>
        </div>
      </div>
    </>
  );
}

const TALLE_ORDER = ["XS", "S", "M", "L", "XL"];

function ProductModal({ entry, onClose, isLoggedIn, discount = 0, exchangeRate, showUsd = true, onAdd }) {
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedTalle, setSelectedTalle] = useState(null);
  const entryKey = entry ? (entry.isGroup ? entry.id : entry.product.id) : null;

  useEffect(() => {
    setSelectedColor(null);
    setSelectedTalle(null);
  }, [entryKey]);

  if (!entry) return null;

  if (!entry.isGroup) {
    return (
      <ModalShell onClose={onClose}>
        <ProductDetailBody
          product={entry.product}
          onClose={onClose}
          isLoggedIn={isLoggedIn}
          discount={discount}
          exchangeRate={exchangeRate}
          showUsd={showUsd}
          onAdd={onAdd}
        />
      </ModalShell>
    );
  }

  const colors = Array.from(new Set(entry.variants.map((v) => v.colorLabel)));
  const variantsForColor = selectedColor
    ? entry.variants.filter((v) => v.colorLabel === selectedColor)
    : [];
  const talles = Array.from(new Set(variantsForColor.map((v) => v.talle).filter(Boolean))).sort(
    (a, b) => TALLE_ORDER.indexOf(a) - TALLE_ORDER.indexOf(b)
  );
  const resolvedVariant =
    variantsForColor.length === 1
      ? variantsForColor[0]
      : selectedTalle
      ? variantsForColor.find((v) => v.talle === selectedTalle) || null
      : null;

  if (resolvedVariant) {
    return (
      <ModalShell onClose={onClose}>
        <button
          onClick={() => setSelectedTalle(null)}
          className="self-start text-xs font-semibold text-sky-600 transition hover:text-sky-700 dark:text-sky-400"
        >
          ‹ Elegir otro talle
        </button>
        <ProductDetailBody
          product={resolvedVariant.product}
          onClose={onClose}
          isLoggedIn={isLoggedIn}
          discount={discount}
          exchangeRate={exchangeRate}
          showUsd={showUsd}
          onAdd={onAdd}
        />
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="space-y-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-sky-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-sky-400">
          Elegí tu combinación
        </span>
        <h3 className="text-2xl font-semibold text-slate-900 dark:text-white">{entry.base}</h3>
        <p className="text-sm text-slate-600 dark:text-neutral-300">Elegí color y talle para ver el detalle.</p>
      </div>

      {selectedColor && (
        <button
          onClick={() => {
            setSelectedColor(null);
            setSelectedTalle(null);
          }}
          className="self-start text-xs font-semibold text-sky-600 transition hover:text-sky-700 dark:text-sky-400"
        >
          ‹ Elegir otro color
        </button>
      )}

      <div>
        <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-neutral-300">Elegí un color</p>
        <div className="flex flex-wrap gap-2">
          {colors.map((color) => {
            const hasStock = entry.variants.some(
              (v) => v.colorLabel === color && Number(v.product.stock ?? 0) > 0
            );
            const active = selectedColor === color;
            return (
              <button
                key={color}
                onClick={() => {
                  setSelectedColor(color);
                  setSelectedTalle(null);
                }}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                  active
                    ? "border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-200/60"
                    : hasStock
                    ? "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
                    : "border-slate-200 bg-slate-50 text-slate-400 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-600"
                }`}
              >
                {color}
                {!hasStock ? " (sin stock)" : ""}
              </button>
            );
          })}
        </div>
      </div>

      {selectedColor && talles.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-neutral-300">Elegí un talle</p>
          <div className="flex flex-wrap gap-2">
            {talles.map((talle) => {
              const variant = variantsForColor.find((v) => v.talle === talle);
              const hasStock = Number(variant?.product.stock ?? 0) > 0;
              const active = selectedTalle === talle;
              return (
                <button
                  key={talle}
                  onClick={() => setSelectedTalle(talle)}
                  className={`h-11 min-w-[2.75rem] rounded-2xl border px-4 text-sm font-semibold transition ${
                    active
                      ? "border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-200/60"
                      : hasStock
                      ? "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
                      : "border-slate-200 bg-slate-50 text-slate-400 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-600"
                  }`}
                >
                  {talle}
                  {!hasStock ? " ✕" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function CartDrawer({
  open,
  onClose,
  cart,
  setQty,
  removeItem,
  total,
  isLoggedIn,
  discount = 0,
  onCheckout,
  products = [],
  exchangeRate,
}) {
  const effectiveDiscount = Number.isFinite(Number(discount)) ? Number(discount) : 0;
  const getAvailable = (id) => {
    const product = products.find((p) => p.id === id);
    return Number(product?.stock ?? 0);
  };
  const stockProblems = cart.filter((it) => getAvailable(it.id) < it.qty);
  const checkoutDisabled = PEDIDOS_SUSPENDIDOS || !cart.length || stockProblems.length > 0;

  return (
    <div className={`fixed inset-0 z-[60] ${open ? "" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 bottom-0 w-full max-w-md rounded-l-3xl border border-slate-200 bg-white p-6 shadow-2xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Tu carrito</h3>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">
            Cerrar
          </button>
        </div>

        {!cart.length ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Todavía no agregaste productos.
          </div>
        ) : (
          <>
            <ul className="mt-4 max-h-[55vh] space-y-3 overflow-auto pr-2">
              {cart.map((it) => {
                const availableStock = getAvailable(it.id);
                const disableDecrease = it.qty <= 1;
                const disableIncrease = availableStock > 0 ? it.qty >= availableStock : true;
                const priceUsd = Number(it.priceUsd || 0);
                const contabiliumArs = it.priceArs != null ? Number(it.priceArs) : null;
                const convertedArs = toArs(priceUsd, exchangeRate);
                const basePrice = Number.isFinite(contabiliumArs) && contabiliumArs > 0
                  ? contabiliumArs
                  : (Number.isFinite(convertedArs) && convertedArs > 0 ? convertedArs : priceUsd);
                const unitPrice = getEffectivePrice(basePrice, effectiveDiscount, isLoggedIn);
                const unitPriceUsd = getEffectivePrice(priceUsd, effectiveDiscount, isLoggedIn);
                const lineTotal = unitPrice * it.qty;
                const showDiscount =
                  isLoggedIn && effectiveDiscount > 0 && unitPrice !== basePrice && basePrice > 0;
                return (
                  <li key={it.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="h-16 w-16 overflow-hidden rounded-2xl bg-slate-100">
                      {it.imageUrl ? (
                        <img src={it.imageUrl} className="h-full w-full object-cover" alt="" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-500">Sin imagen</div>
                      )}
                    </div>
                    <div className="flex-1 text-sm text-slate-600">
                      <div className="font-medium text-slate-900">{it.name}</div>
                      {isLoggedIn ? (
                        <div className="text-xs text-slate-500 space-y-1">
                          {showDiscount ? (
                            <>
                              <span className="mr-2 line-through text-[11px] text-slate-400">
                                {money(basePrice)}
                              </span>
                              <span>{money(unitPrice)} c/u</span>
                            </>
                          ) : (
                            <span>{money(unitPrice)} c/u</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">Precio visible al iniciar sesión</div>
                      )}
                      <div className="mt-3 inline-flex items-center gap-2">
                        <button
                          className="rounded-xl border border-slate-300 px-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                          onClick={() => setQty(it.id, it.qty - 1)}
                          disabled={disableDecrease}
                        >
                          –
                        </button>
                        <input
                          className="w-14 rounded-xl border border-slate-300 bg-white px-2 py-1 text-center text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                          type="number"
                          min={1}
                          max={availableStock || 1}
                          value={it.qty}
                          onChange={(e) => setQty(it.id, Number(e.target.value || 1))}
                        />
                        <button
                          className="rounded-xl border border-slate-300 px-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                          onClick={() => setQty(it.id, it.qty + 1)}
                          disabled={disableIncrease}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right text-sm text-slate-600">
                      <button
                        className="text-xs text-slate-500 hover:text-slate-700"
                        onClick={() => removeItem(it.id)}
                      >
                        Quitar
                      </button>
                      {isLoggedIn ? (
                        <div className="text-sm font-semibold text-slate-900">{money(lineTotal)}</div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {stockProblems.length > 0 && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-600">
                Revisá cantidades: hay productos con menos stock disponible del solicitado.
              </div>
            )}

            <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Total</span>
                <span className="text-lg font-semibold text-slate-900">
                  {isLoggedIn ? money(total) : "Iniciá sesión para ver"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isLoggedIn
                  ? "El pedido se cargará directamente como orden pagadera."
                  : "Si no iniciaste sesión, generaremos una solicitud con tu selección para seguimiento manual."}
              </p>
              {isLoggedIn && effectiveDiscount > 0 ? (
                <p className="text-xs text-emerald-600">
                  Tenés un descuento del {effectiveDiscount}% activo para tus precios.
                </p>
              ) : null}
              {PEDIDOS_SUSPENDIDOS ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {MENSAJE_PEDIDOS_SUSPENDIDOS}
                </p>
              ) : null}
              <button
                onClick={onCheckout}
                disabled={checkoutDisabled}
                className="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Avanzar con el pedido
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function OrderModal({ open, onClose, submitting, result, onSubmit, profile, isLoggedIn }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [cuit, setCuit] = useState("");
  const [cuitError, setCuitError] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setPhone("");
      setNotes("");
      setCuit("");
      setCuitError("");
    } else {
      // Auto-fill CUIT from user profile if available
      if (profile?.cuit) setCuit(profile.cuit);
    }
  }, [open, profile]);

  function onCuitChange(e) {
    const formatted = formatCuit(e.target.value);
    setCuit(formatted);
    setCuitError("");
  }

  function onCuitBlur() {
    if (cuit && !validateCuit(cuit)) {
      setCuitError("CUIT inválido. Ingresá los 11 dígitos correctamente.");
    } else {
      setCuitError("");
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!cuit) {
      setCuitError("El CUIT es obligatorio.");
      return;
    }
    if (!validateCuit(cuit)) {
      setCuitError("CUIT inválido. Ingresá los 11 dígitos correctamente.");
      return;
    }
    onSubmit({ name, email, phone, notes, cuit });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Datos del pedido</h2>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">
            Cerrar
          </button>
        </div>

        {PEDIDOS_SUSPENDIDOS ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              {MENSAJE_PEDIDOS_SUSPENDIDOS}
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
                Cerrar
              </button>
            </div>
          </div>
        ) : !isLoggedIn ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-800">
              Para hacer un pedido tenés que ser distribuidor de Samurai con tu cuenta aprobada. Si todavía no tenés
              cuenta, completá el formulario de "Volvete distribuidor" y te contactamos para darte de alta.
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
                Cerrar
              </button>
              <Link
                to="/quiero-ser-cliente"
                onClick={onClose}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Quiero ser distribuidor
              </Link>
            </div>
          </div>
        ) : result ? (
          <div className="mt-6 space-y-4">
            {result.ok ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-600">
                ¡Listo! Tu pedido se creó con ID <b>{result.orderId}</b>. Te contactaremos a la brevedad.
              </div>
            ) : (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-600">
                Hubo un error: {result.error}
              </div>
            )}
            <div className="text-right">
              <button onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Nombre <span className="text-rose-500">*</span>
              </label>
              <input
                required
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                CUIT <span className="text-rose-500">*</span>
              </label>
              <input
                required
                placeholder="XX-XXXXXXXX-X"
                inputMode="numeric"
                className={`w-full rounded-2xl border bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:ring-2 ${
                  cuitError
                    ? "border-rose-400 focus:border-rose-400 focus:ring-rose-400/40"
                    : "border-slate-200 focus:border-sky-500 focus:ring-sky-500/40"
                }`}
                value={cuit}
                onChange={onCuitChange}
                onBlur={onCuitBlur}
              />
              {profile?.cuit && cuit === profile.cuit && (
                <p className="text-xs text-sky-600">Auto-completado desde tu perfil.</p>
              )}
              {cuitError && <p className="text-xs text-rose-500">{cuitError}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Teléfono</label>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Notas</label>
              <textarea
                rows={3}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                disabled={submitting || !!cuitError}
                className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition focus:outline-none focus:ring-2 focus:ring-sky-400/60 disabled:opacity-60"
              >
                <BusyButtonContent busy={submitting} busyLabel="Enviando…" label="Enviar pedido" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ChevronLeftIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
