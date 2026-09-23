import GrillaLogistica from "../../components/logistica/GrillaLogistica";

export default function ChoferGrillaLogistica() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">📅 Grilla de logística</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Tus viajes por turno: tocá Salí, Llegué y Entregué a medida que avanzás — el equipo lo ve al instante.
        </p>
      </div>
      <GrillaLogistica />
    </div>
  );
}
