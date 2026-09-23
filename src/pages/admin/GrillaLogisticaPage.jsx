import GrillaLogistica from "../../components/logistica/GrillaLogistica";

export default function GrillaLogisticaPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">📅 Grilla de logística</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Cargá los viajes de Julián (de qué depósito a cuál, con el tiempo calculado por el mapa) por turno, próximos 7 días. Él los ve servidos en su grilla y avisa cuando sale, llega y entrega.
        </p>
      </div>
      <GrillaLogistica />
    </div>
  );
}
