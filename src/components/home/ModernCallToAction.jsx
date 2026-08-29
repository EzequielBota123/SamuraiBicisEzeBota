import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import Reveal from '../ui/Reveal';

export default function ModernCallToAction() {
  const { user, profile, loading: authLoading } = useAuth();
  const isDistribuidor = !authLoading && !!user && !!profile?.contabiliumDepositoId;

  if (isDistribuidor) {
    return (
      <section className="relative isolate overflow-hidden py-10 sm:py-24">
        <div className="absolute inset-0 bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500" aria-hidden="true" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.45),_transparent_55%)] opacity-70" aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(255,255,255,0.12)_1px,_transparent_0)] bg-[size:22px_22px] opacity-20" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Reveal className="overflow-hidden rounded-[2.75rem] border border-white/20 bg-white/10 p-6 shadow-[0_25px_65px_rgba(15,23,42,0.35)] backdrop-blur sm:p-10">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_auto] lg:items-center sm:gap-12">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-white/80">
                  Tu cuenta
                </span>
                <h2 className="mt-6 text-3xl font-semibold text-white sm:text-4xl">
                  {profile?.name ? `Hola de nuevo, ${profile.name.split(" ")[0]}` : "Hola de nuevo"}
                </h2>
                <p className="mt-4 max-w-2xl text-base text-white/80">
                  Accedé directo a tu stock consignado o pedí más bicicletas al catálogo.
                </p>
              </div>

              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Link
                  to="/mi-stock"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-indigo-600 shadow-lg shadow-indigo-600/30 transition active:scale-95 hover:shadow-xl hover:shadow-indigo-600/40"
                >
                  Ir a Mi Stock
                </Link>
                <Link
                  to="/catalogo"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/60 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition active:scale-95 hover:bg-white/20"
                >
                  Ver catálogo
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    );
  }

  return (
    <section className="relative isolate overflow-hidden py-10 sm:py-24">
      <div className="absolute inset-0 bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500" aria-hidden="true" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.45),_transparent_55%)] opacity-70" aria-hidden="true" />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(255,255,255,0.12)_1px,_transparent_0)] bg-[size:22px_22px] opacity-20" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="overflow-hidden rounded-[2.75rem] border border-white/20 bg-white/10 p-6 shadow-[0_25px_65px_rgba(15,23,42,0.35)] backdrop-blur sm:p-10">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_auto] lg:items-center sm:gap-12">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-white/80">
                Próximo paso
              </span>
              <h2 className="mt-6 text-3xl font-semibold text-white sm:text-4xl">
                Activá la experiencia mayorista Samurai
              </h2>
              <p className="mt-4 max-w-2xl text-base text-white/80">
                Digitalizá tu proceso de compra y potenciá el asesoramiento comercial con información en vivo. Nuestro equipo te ayuda a lanzar tu cuenta en cuestión de horas.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Link
                to="/quiero-ser-cliente"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-indigo-600 shadow-lg shadow-indigo-600/30 transition active:scale-95 hover:shadow-xl hover:shadow-indigo-600/40"
              >
                Completar formulario
              </Link>
              <Link
                to="/catalogo"
                className="inline-flex items-center justify-center rounded-2xl border border-white/60 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition active:scale-95 hover:bg-white/20"
              >
                Ver catálogo demo
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
