// src/services/dolar.ts
// Cotización del dólar oficial en Argentina, en vivo — se usa para mostrar
// a cuántos dólares equivale el precio en pesos de cada bici. Fuente:
// dolarapi.com (gratis, sin key, CORS abierto — confirmado). Se usa la
// cotización "venta" (lo que cuesta comprar un dólar), que es el criterio
// correcto para convertir un precio de pesos a su equivalente en dólares.
export type DolarOficial = {
  compra: number;
  venta: number;
  fechaActualizacion: Date | null;
};

export async function getDolarOficial(): Promise<DolarOficial> {
  const res = await fetch("https://dolarapi.com/v1/dolares/oficial");
  if (!res.ok) throw new Error(`No se pudo consultar la cotización del dólar (status ${res.status})`);
  const data = await res.json();
  return {
    compra: Number(data.compra || 0),
    venta: Number(data.venta || 0),
    fechaActualizacion: data.fechaActualizacion ? new Date(data.fechaActualizacion) : null,
  };
}
