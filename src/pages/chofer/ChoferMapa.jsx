import useCrmData from "../admin/crm/useCrmData";
import MapaClientes from "../admin/crm/MapaClientes";

// Mismo mapa que usa el CRM (admin) — el chofer lo necesita para ubicar
// consignados/compradores camino a una entrega.
export default function ChoferMapa() {
  const crm = useCrmData();
  return <MapaClientes crm={crm} />;
}
