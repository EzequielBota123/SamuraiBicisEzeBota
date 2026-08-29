// src/utils/notaImagenes.js
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";

// Sube una o más imágenes adjuntas a una nota de seguimiento y devuelve sus URLs.
export async function subirImagenesNota(uid, files) {
  const urls = [];
  for (const file of files) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const fileRef = ref(storage, `seguimiento-notas/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
    const snap = await uploadBytes(fileRef, file, { contentType: file.type || "image/jpeg" });
    urls.push(await getDownloadURL(snap.ref));
  }
  return urls;
}
