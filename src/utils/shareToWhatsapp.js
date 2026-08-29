// Comparte una imagen (Blob) por WhatsApp. En celular usa el share sheet
// nativo (adjunta la imagen directo, el usuario elige el contacto/WhatsApp).
// Si el navegador no soporta compartir archivos (típicamente desktop), baja
// la imagen y abre WhatsApp Web con el texto ya escrito para que la adjunten
// a mano — no existe forma de "forzar" el adjunto sin usar la API paga de
// WhatsApp Business, así que esto es lo más cerca que se puede llegar desde
// una web común.
export async function shareReceiptToWhatsapp({ blob, fileName = "comprobante.png", text, whatsappNumber }) {
  const file = new File([blob], fileName, { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return { method: "share" };
    } catch (err) {
      if (err?.name === "AbortError") return { method: "cancelled" };
      // sigue al fallback si falla el share nativo
    }
  }

  // Fallback desktop: descarga la imagen + abre WhatsApp con el texto listo.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
  window.open(waUrl, "_blank");
  return { method: "download+wa" };
}
