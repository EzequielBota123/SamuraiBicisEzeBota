import { getClientesConUbicacion } from "../services/comprobantes";

// Lista de clientes con su dirección y coordenadas — se pide una sola vez
// por sesión (el primer pedido puede tardar si hay direcciones nuevas para
// ubicar) y se comparte entre el formulario de viajes y la carga automática
// desde Stock consignado.
let promesa = null;

export function cargarClientesUnaVez() {
  if (!promesa) {
    promesa = getClientesConUbicacion()
      .then((r) => r.items || [])
      .catch((e) => {
        promesa = null;
        throw e;
      });
  }
  return promesa;
}
