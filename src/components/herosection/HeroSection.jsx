import { Link } from "react-router-dom";
import { useState } from "react";

const contactHighlights = [
  {
    id: "email",
    label: "Contacto comercial",
    title: "contacto@samurai.ar",
    description: "Coordinamos activaciones y reposiciones a tu ritmo.",
    action: "copy",
    value: "contacto@samurai.ar",
  },
];

function CopyIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export default function HeroSection({
  onLogin,
  onSignup,
  title = "Fábrica de bicicletas",
  subtitle = "Crecemos junto a la bicicletería",
}) {
  const [copiedId, setCopiedId] = useState(null);

  function handleContactAction(item) {
    navigator.clipboard.writeText(item.value).then(() => {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1800);
    });
  }

  const PrimaryAction = onSignup ? (
    <button
      onClick={onSignup}
      className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-slate-900/20 transition active:scale-95 hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/50 sm:w-auto sm:px-8 sm:py-4 sm:text-base"
    >
      Volvete distribuidor
    </button>
  ) : (
    <Link
      to="/quiero-ser-cliente"
      className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-slate-900/20 transition active:scale-95 hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/50 sm:w-auto sm:px-8 sm:py-4 sm:text-base"
    >
      Volvete distribuidor
    </Link>
  );

  const SecondaryAction = onLogin ? (
    <button
      onClick={onLogin}
      className="inline-flex w-full items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 transition active:scale-95 hover:-translate-y-1 hover:border-slate-400 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:hover:border-neutral-500 sm:w-auto sm:px-8 sm:py-4 sm:text-base"
    >
      Ingresar al portal
    </button>
  ) : (
    <Link
      to="/login"
      className="inline-flex w-full items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 transition active:scale-95 hover:-translate-y-1 hover:border-slate-400 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:hover:border-neutral-500 sm:w-auto sm:px-8 sm:py-4 sm:text-base"
    >
      Ingresar al portal
    </Link>
  );

  return (
    <section className="relative isolate overflow-hidden bg-white text-slate-900 dark:bg-black dark:text-white">
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(148,163,184,0.12)_1px,transparent_0)] bg-[size:24px_24px] opacity-25 dark:bg-[linear-gradient(120deg,rgba(255,255,255,0.04)_1px,transparent_0)]" aria-hidden="true" />
        <div
          className="absolute left-1/2 top-[-12rem] h-[32rem] w-[32rem] -translate-x-1/2 rounded-full opacity-70 blur-3xl bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.18),transparent_65%)] dark:opacity-60 dark:bg-[radial-gradient(circle_at_center,rgba(225,29,72,0.14),transparent_65%)]"
          aria-hidden="true"
        />
        <div className="absolute right-[-12rem] bottom-[-8rem] h-[28rem] w-[28rem] rounded-full bg-gradient-to-br from-fuchsia-200 via-sky-200/60 to-transparent blur-3xl dark:from-white/[0.03] dark:via-transparent dark:to-transparent" aria-hidden="true" />
        <div className="absolute left-[-10rem] top-1/2 h-[24rem] w-[24rem] -translate-y-1/2 rounded-full bg-gradient-to-tr from-emerald-200 via-cyan-200/60 to-transparent blur-3xl dark:from-white/[0.03] dark:via-transparent dark:to-transparent" aria-hidden="true" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 py-8 sm:gap-16 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:py-28">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-sky-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-sky-400">
              Mayoristas digitales
            </div>
            <h1 className="mt-4 flex flex-wrap text-2xl font-bold leading-[1.1] tracking-tight sm:mt-7 sm:text-5xl sm:leading-[1.05] lg:text-6xl">
              {title.split(" ").map((word, i) => (
                <span key={i} className="mr-[0.3em] overflow-hidden pb-1">
                  <span
                    className="inline-block"
                    style={{
                      opacity: 0,
                      transform: "translateY(100%)",
                      animation: `title-word-in 0.7s cubic-bezier(0.16,1,0.3,1) ${i * 0.1}s forwards`,
                    }}
                  >
                    {word}
                  </span>
                </span>
              ))}
            </h1>
            <p className="mt-2 text-base font-medium text-slate-600 dark:text-neutral-300 sm:mt-6 sm:text-2xl">
              {subtitle}
            </p>

            <div className="mt-5 flex flex-col items-stretch gap-3 sm:mt-12 sm:flex-row sm:items-center sm:gap-5">
              {PrimaryAction}
              {SecondaryAction}
            </div>
          </div>

          <div className="relative hidden sm:block">
            <div className="absolute inset-0 -translate-y-6 scale-[1.08] rounded-[3.25rem] bg-gradient-to-br from-slate-100 via-white to-transparent opacity-80 blur-3xl dark:from-white/[0.03] dark:via-transparent dark:opacity-60" aria-hidden="true" />
            <div className="relative isolate overflow-hidden rounded-[2.8rem] border border-slate-200 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.2)] backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5 sm:p-8">
              <div className="mb-6 overflow-hidden rounded-3xl sm:mb-8">
                <img
                  src="/img/bicis.jpeg"
                  alt="Bicicletas exhibidas en la sala de ventas de Samurai Bicis"
                  className="h-44 w-full object-cover animate-ken-burns sm:h-56 lg:h-64"
                />
              </div>
              <div className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 sm:right-6 sm:top-6 sm:gap-2 sm:px-3 sm:text-xs">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                Equipo comercial activo
              </div>
              <div className="absolute -right-16 top-24 h-48 w-48 rounded-full bg-gradient-to-br from-sky-200/70 via-blue-200/50 to-transparent blur-3xl dark:from-white/[0.04] dark:via-transparent dark:to-transparent" aria-hidden="true" />
              <div className="absolute -left-20 bottom-0 h-60 w-60 rounded-full bg-gradient-to-tr from-emerald-200/70 via-teal-200/50 to-transparent blur-3xl dark:from-white/[0.04] dark:via-transparent dark:to-transparent" aria-hidden="true" />
              <div className="relative rounded-[2.2rem] border border-slate-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/60 sm:p-8">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-sky-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-sky-400">
                  Generemos una alianza
                </span>
                <h3 className="mt-5 text-xl font-semibold text-slate-900 dark:text-white sm:mt-6 sm:text-2xl">
                  Operamos cerca de tu negocio
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                  Coordinamos lanzamientos, logística y soporte comercial con un equipo que entiende el mercado mayorista.
                </p>
                <div className="mt-6 grid gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-4">
                  {contactHighlights.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleContactAction(item)}
                      className="group/card relative overflow-hidden rounded-2xl border border-slate-200 bg-white/85 p-4 text-left shadow-[0_24px_55px_-35px_rgba(15,23,42,0.35)] transition duration-300 hover:-translate-y-0.5 hover:border-sky-300/60 hover:shadow-[0_28px_60px_-30px_rgba(15,23,42,0.3)] dark:border-neutral-700 dark:bg-neutral-800/70 dark:shadow-none dark:hover:border-sky-500/50 sm:p-5"
                    >
                      <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-slate-50 text-slate-400 opacity-0 transition duration-300 group-hover/card:opacity-100 group-hover/card:text-sky-600 dark:bg-neutral-700 dark:text-neutral-300">
                        <CopyIcon />
                      </span>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                        {item.label}
                      </p>
                      <p className="mt-2 break-words text-base font-semibold text-slate-900 dark:text-white">
                        {item.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-neutral-300">
                        {copiedId === item.id ? "¡Copiado!" : item.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
