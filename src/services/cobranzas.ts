import { db, auth } from "../firebase";
import { collection, onSnapshot, query, orderBy, doc } from "firebase/firestore";

const BASE_URL = "https://us-central1-bikeshop-ab2f0.cloudfunctions.net";

export type FormaDePago = {
  FormaDePago: string;
  NroReferencia: string | null;
  Importe: number;
  [key: string]: unknown;
};

export type Cobranza = {
  id: string;
  contabiliumId: number;
  idPersona: number | null;
  razonSocial: string | null;
  tipoDocumento: string | null;
  nroDocumento: string | null;
  numero: string | null;
  fecha: string | null;
  moneda: string | null;
  importeTotal: number;
  importeReal?: number;
  detalle: Array<{ IDComprobante: number; Importe: number }>;
  formasDePago: FormaDePago[];
  syncedAt: unknown;
};

export function subscribeCobranzas(onData: (items: Cobranza[]) => void, onError: (e: Error) => void) {
  const q = query(collection(db, "cobranzas"), orderBy("fecha", "desc"));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as Cobranza))),
    (err) => onError(err)
  );
}

export function subscribeCobranzasSyncStatus(onData: (status: Record<string, unknown> | null) => void) {
  return onSnapshot(doc(db, "meta/cobranzasSync"), (snap) => onData(snap.exists() ? snap.data() : null));
}

export async function triggerCobranzasSync(params?: { desde?: string; hasta?: string }): Promise<{ total: number; synced: number; errors: unknown[] }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sesión no iniciada");
  const token = await user.getIdToken();
  const qs = new URLSearchParams();
  if (params?.desde) qs.set("desde", params.desde);
  if (params?.hasta) qs.set("hasta", params.hasta);
  const url = `${BASE_URL}/triggerCobranzasSync${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}
