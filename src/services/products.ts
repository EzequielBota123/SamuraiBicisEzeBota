import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy, limit, getDocs,
  where, startAfter, QueryDocumentSnapshot, DocumentData, onSnapshot,
} from "firebase/firestore";
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../firebase"; // 👈 asegurate que exista src/firebase.ts|js con {db,storage}
import { authReady } from "../authReady";

export type Product = {
  id?: string;
  name: string;
  nameLower: string;
  sku?: string | null;
  skuNumber?: number | null;
  brand?: string | null;
  price: number;
  priceArs?: number | null;
  costArs?: number | null;
  stock: number;
  description?: string;
  category: string;
  productTypeId?: string | null;
  productTypeTitle?: string | null;
  active: boolean;
  showInCatalog?: boolean;
  imageUrl: string;
  images?: string[];
  createdAt?: any; updatedAt?: any;
};

const colRef = collection(db, "products");
const normalize = (s: string) => (s || "").trim().toLowerCase();

function normalizeSku(input: unknown) {
  if (input == null) return { value: null as string | null, number: null as number | null };
  const raw = typeof input === "string" ? input : String(input ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, number: null };
  const parsed = Number(trimmed);
  return {
    value: trimmed,
    number: Number.isFinite(parsed) ? parsed : null,
  };
}

async function ensureSkuAvailable(
  sku: string,
  { excludeId }: { excludeId?: string } = {}
) {
  const normalized = sku.trim();
  if (!normalized) return;
  const skuQuery = query(colRef, where("sku", "==", normalized), limit(5));
  const snapshot = await getDocs(skuQuery);
  const conflict = snapshot.docs.find((docSnap) => docSnap.id !== excludeId);
  if (conflict) {
    throw new Error(`Ya existe un producto registrado con el SKU "${normalized}".`);
  }
}

export async function createProduct({
  name,
  sku,
  brand,
  price,
  costArs,
  stock,
  description,
  category,
  productTypeId,
  productTypeTitle,
  active,
  showInCatalog,
  imageFile,
}: {
  name: string;
  sku?: string | number | null;
  brand?: string | null;
  price?: number | string;
  costArs?: number | string | null;
  stock?: number | string;
  description?: string | null;
  category?: string;
  productTypeId?: string | null;
  productTypeTitle?: string | null;
  active?: boolean;
  showInCatalog?: boolean;
  imageFile?: File | null;
}) {
  const normalizedTypeTitle =
    typeof productTypeTitle === "string" ? productTypeTitle.trim() : "";
  const effectiveTypeTitle = normalizedTypeTitle || category || "general";
  const { value: normalizedSku, number: skuNumber } = normalizeSku(sku);
  if (normalizedSku) {
    await ensureSkuAvailable(normalizedSku);
  }
  const base = {
    name: name || "",
    nameLower: normalize(name),
    sku: normalizedSku,
    skuNumber: skuNumber,
    brand: (brand || "").trim() || null,
    price: Number(price ?? 0),
    costArs: costArs != null && costArs !== "" ? Number(costArs) : null,
    stock: Number(stock ?? 0),
    description: description || "",
    category: category || effectiveTypeTitle || "general",
    productTypeId: productTypeId || null,
    productTypeTitle: effectiveTypeTitle || "general",
    active: active ?? true,
    showInCatalog: showInCatalog ?? true,
    imageUrl: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const docRef = await addDoc(colRef, base);

  if (imageFile) {
    const url = await uploadProductImage(docRef.id, imageFile);
    await updateDoc(docRef, { imageUrl: url, updatedAt: serverTimestamp() });
  }
  return { id: docRef.id, ...base } as Product;
}

export async function updateProduct(id: string, {
  name,
  sku,
  brand,
  price,
  costArs,
  stock,
  description,
  category,
  productTypeId,
  productTypeTitle,
  active,
  showInCatalog,
  imageFile,
  images,
}: {
  name?: string;
  sku?: string | number | null;
  brand?: string | null;
  price?: number | string;
  costArs?: number | string | null;
  stock?: number | string;
  description?: string | null;
  category?: string;
  productTypeId?: string | null;
  productTypeTitle?: string | null;
  active?: boolean;
  showInCatalog?: boolean;
  imageFile?: File | null;
  images?: string[];
}) {
  const patch: any = { updatedAt: serverTimestamp() };
  if (name !== undefined) { patch.name = name; patch.nameLower = normalize(name); }
  if (brand !== undefined) patch.brand = (brand || "").trim() || null;
  if (sku !== undefined) {
    const { value: normalizedSku, number: skuNumber } = normalizeSku(sku);
    if (normalizedSku) {
      await ensureSkuAvailable(normalizedSku, { excludeId: id });
    }
    patch.sku = normalizedSku;
    patch.skuNumber = skuNumber;
  }
  if (price !== undefined) patch.price = Number(price);
  if (costArs !== undefined) patch.costArs = costArs != null && costArs !== "" ? Number(costArs) : null;
  if (stock !== undefined) patch.stock = Number(stock);
  if (description !== undefined) patch.description = description || "";
  if (category !== undefined) patch.category = category || "general";
  if (productTypeId !== undefined) patch.productTypeId = productTypeId || null;
  if (productTypeTitle !== undefined) {
    const normalizedTitle =
      typeof productTypeTitle === "string" ? productTypeTitle.trim() : "";
    const effectiveTitle = normalizedTitle || patch.category || category || "general";
    patch.productTypeTitle = effectiveTitle;
    if (category === undefined && patch.category === undefined) {
      patch.category = effectiveTitle;
    }
  }
  if (active !== undefined) patch.active = !!active;
  if (showInCatalog !== undefined) patch.showInCatalog = !!showInCatalog;
  if (imageFile) { const url = await uploadProductImage(id, imageFile); patch.imageUrl = url; }
  if (images !== undefined) {
    patch.images = images;
    if (images.length > 0) patch.imageUrl = images[0];
  }
  await updateDoc(doc(db, "products", id), patch);
}

export async function listProductsByBrand(brand: string): Promise<Product[]> {
  const snap = await getDocs(query(colRef, where("brand", "==", brand)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Product) }));
}

export async function deleteProductById(id: string) {
  await deleteDoc(doc(db, "products", id));
}

export async function findProductBySku(rawSku: string) {
  const normalized = (rawSku || "").trim();
  if (!normalized) return null;
  const skuQuery = query(colRef, where("sku", "==", normalized), limit(1));
  const snapshot = await getDocs(skuQuery);
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  return { id: docSnap.id, ...(docSnap.data() as Product) } as Product;
}

// Sube a Storage: products/{id}/{timestamp_nombre}
export async function uploadProductImage(productId: string, file: File) {
  // 1) Asegurar sesión activa (evita storage/unauthenticated)
  const user = await authReady();
  if (!user) {
    throw new Error("No hay sesión activa. Iniciá sesión y volvé a intentar.");
  }

  // 2) (Recomendado) refrescar token por si está expirado / reloj corrido
  await user.getIdToken(true);

  // 3) Validaciones básicas del archivo
  if (!/^image\//.test(file.type)) throw new Error("Solo se permiten imágenes");
  const maxMB = 10;
  if (file.size > maxMB * 1024 * 1024) throw new Error(`Imagen > ${maxMB}MB`);

  // 4) Subida con contentType y metadata útil
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const fileRef = ref(storage, `products/${productId}/${Date.now()}_${safeName}`);

  const snap = await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: { uploadedBy: user.uid },
  });

  return await getDownloadURL(snap.ref);
}
export async function uploadProductImages(
  productId: string,
  files: File[],
  onProgress?: (fileIndex: number, pct: number) => void
): Promise<string[]> {
  const user = await authReady();
  if (!user) throw new Error("No hay sesión activa. Iniciá sesión y volvé a intentar.");
  await user.getIdToken(true);

  return Promise.all(
    files.map((file, i) => {
      if (!/^image\//.test(file.type)) throw new Error(`Solo se permiten imágenes (${file.name})`);
      if (file.size > 10 * 1024 * 1024) throw new Error(`Imagen > 10MB (${file.name})`);
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const fileRef = ref(storage, `products/${productId}/${Date.now()}_${i}_${safeName}`);
      return new Promise<string>((resolve, reject) => {
        const task = uploadBytesResumable(fileRef, file, {
          contentType: file.type || "application/octet-stream",
          customMetadata: { uploadedBy: user.uid },
        });
        task.on(
          "state_changed",
          (snap) => onProgress?.(i, Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          reject,
          () => getDownloadURL(task.snapshot.ref).then(resolve, reject)
        );
      });
    })
  );
}

export async function deleteProductImage(url: string): Promise<void> {
  const match = url.match(/\/o\/(.+?)(\?|$)/);
  if (!match) throw new Error("URL de Storage no válida");
  const path = decodeURIComponent(match[1]);
  await deleteObject(ref(storage, path));
}

// Listado con búsqueda por prefijo, filtros y paginación simple
export async function listProducts({
  q = "", onlyActive = "all", category = "all", pageSize = 20,
  cursor = null as QueryDocumentSnapshot<DocumentData> | null
} = {}) {
  const nq = normalize(q);
  const clauses: any[] = [];
  if (nq) {
    clauses.push(where("nameLower", ">=", nq));
    clauses.push(where("nameLower", "<=", nq + "\uf8ff"));
  }
  if (onlyActive === "true") clauses.push(where("active", "==", true));
  if (category !== "all")    clauses.push(where("category", "==", category));

  const baseQ = query(colRef, ...clauses, orderBy("nameLower"), limit(pageSize));
  const pagedQ = cursor ? query(baseQ, startAfter(cursor)) : baseQ;

  const snap = await getDocs(pagedQ);
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
  const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
  return { items, nextCursor };
}

export function subscribeProducts({
  q = "", onlyActive = "all", category = "all", pageSize = 20,
}: {
  q?: string;
  onlyActive?: "all" | "true" | "false";
  category?: string;
  pageSize?: number;
} = {},
onChange: (items: Product[]) => void,
onError?: (error: Error) => void,
) {
  const nq = normalize(q);
  const clauses: any[] = [];
  if (nq) {
    clauses.push(where("nameLower", ">=", nq));
    clauses.push(where("nameLower", "<=", nq + "\uf8ff"));
  }
  if (onlyActive === "true") clauses.push(where("active", "==", true));
  if (category !== "all")    clauses.push(where("category", "==", category));

  const baseQ = query(colRef, ...clauses, orderBy("nameLower"), limit(pageSize));

  return onSnapshot(
    baseQ,
    snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
      onChange(items);
    },
    onError,
  );
}