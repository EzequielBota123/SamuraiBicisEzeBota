// Contabilium no expone un endpoint de bancos en su API — el mapeo de
// IdBanco a nombre se armó a mano cruzando cobranzas puntuales contra la UI
// de Contabilium. Son los únicos 4 bancos/cuentas usados en la empresa.
const BANCOS_POR_ID: Record<number, string> = {
  217296: "Banco Galicia S.A",
  217302: "Banco Santander Río S.A",
  201286: "Banco Supervielle S.A",
  201285: "MercadoPago",
};

export function nombreBanco(idBanco?: number | null): string | null {
  if (idBanco == null) return null;
  return BANCOS_POR_ID[idBanco] || null;
}

export function listaBancos(): Array<{ id: number; nombre: string }> {
  return Object.entries(BANCOS_POR_ID).map(([id, nombre]) => ({ id: Number(id), nombre }));
}
