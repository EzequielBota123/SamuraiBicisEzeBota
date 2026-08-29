import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";

const navLinks = [
  { label: "Inicio", to: "/" },
  { label: "Catálogo", to: "/catalogo" },
  { label: "Quiero ser cliente", to: "/quiero-ser-cliente" },
  { label: "Ingresar", to: "/login" },
];

const contactInfo = [
  { label: "Pablo · 11 4916-6234", href: "tel:+541149166234" },
];

const socials = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/samuraibikes.oficial/",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-5 w-5"
      >
        <path d="M12 7.5C9.51472 7.5 7.5 9.51472 7.5 12C7.5 14.4853 9.51472 16.5 12 16.5C14.4853 16.5 16.5 14.4853 16.5 12C16.5 9.51472 14.4853 7.5 12 7.5ZM12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12C15 13.6569 13.6569 15 12 15Z" />
        <path d="M17.25 6.75C17.6642 6.75 18 6.41421 18 6V5.25C18 4.83579 17.6642 4.5 17.25 4.5H16.5C16.0858 4.5 15.75 4.83579 15.75 5.25V6C15.75 6.41421 16.0858 6.75 16.5 6.75H17.25Z" />
        <path d="M7.875 3C5.08934 3 3 5.08934 3 7.875V16.125C3 18.9107 5.08934 21 7.875 21H16.125C18.9107 21 21 18.9107 21 16.125V7.875C21 5.08934 18.9107 3 16.125 3H7.875ZM5.25 7.875C5.25 6.30122 6.30122 5.25 7.875 5.25H16.125C17.6988 5.25 18.75 6.30122 18.75 7.875V16.125C18.75 17.6988 17.6988 18.75 16.125 18.75H7.875C6.30122 18.75 5.25 17.6988 5.25 16.125V7.875Z" />
      </svg>
    ),
  },
  {
    label: "WhatsApp",
    href: "https://wa.me/5491149166234",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-5 w-5"
      >
        <path d="M12 3C7.02944 3 3 6.91015 3 11.733C3 13.6819 3.64816 15.4809 4.74888 16.9483L3.55835 20.8204C3.43764 21.2108 3.8062 21.5625 4.20028 21.4271L8.22364 20.0571C9.36607 20.5643 10.6479 20.8459 12 20.8459C16.9706 20.8459 21 16.9357 21 12.1129C21 7.29003 16.9706 3.37988 12 3.37988V3ZM7.12803 8.67343C7.28377 8.30365 7.79584 8.16128 8.20742 8.34094C8.61319 8.51846 9.92305 9.15843 10.188 9.29016C10.4529 9.42188 10.6387 9.59277 10.7136 9.83403C10.7886 10.0753 10.7524 10.3309 10.6078 10.5443C10.4631 10.7577 10.0636 11.2458 9.9318 11.4069C9.79996 11.568 9.77372 11.7782 9.86461 11.9585C10.1779 12.5844 10.6413 13.1358 11.2158 13.5668C11.3818 13.6907 11.6031 13.7138 11.7825 13.6262C12.6332 13.2106 13.2119 12.5987 13.4551 12.2763C13.617 12.0666 13.8991 11.9919 14.1432 12.0865C14.3873 12.1811 15.6772 12.7273 15.935 12.8434C16.1928 12.9596 16.3479 13.2028 16.3371 13.4712C16.3263 13.7396 16.1488 13.9817 15.8928 14.0869C15.2487 14.3518 14.2415 14.7713 13.3653 14.7713C12.4892 14.7713 11.2572 14.468 10.1248 13.4934C9.70818 13.1305 9.35278 12.7041 9.07183 12.2338C8.79088 11.7635 8.60801 11.2698 8.53069 10.7808C8.45337 10.2917 8.48279 9.81657 8.61753 9.37518C8.67418 9.18305 8.78106 9.01322 8.92766 8.88937C9.07426 8.76552 9.25368 8.69421 9.44179 8.68422L9.51559 8.68119C9.52155 8.68119 9.52752 8.68119 9.5335 8.68119C9.931 8.68119 10.0851 8.68119 10.1168 8.68119C10.1484 8.68119 10.1801 8.67343 10.2059 8.65991C10.2317 8.64639 10.2506 8.6271 10.2616 8.60457C10.2726 8.58204 10.2755 8.557 10.2708 8.53365C10.2661 8.5103 10.254 8.48988 10.2363 8.47512C10.2122 8.45487 10.1831 8.44156 10.1516 8.43706L8.15366 8.1696C7.6757 8.10005 7.35732 8.20939 7.20721 8.34864C7.05709 8.48789 7.03246 8.69375 7.12803 8.67343Z" />
      </svg>
    ),
  },
];

/**
 * Footer luminoso con tarjetas informativas
 */
export default function Footer() {
  const year = new Date().getFullYear();
  const [totalBicicletas, setTotalBicicletas] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "meta", "consignedRollup"), (snap) => {
      setTotalBicicletas(snap.exists() ? snap.data().totalBicicletas ?? null : null);
    });
    return () => unsub();
  }, []);

  const stockValue = totalBicicletas
    ? `+${totalBicicletas.toLocaleString("es-AR")} bicis`
    : "Stock en vivo";

  return (
    <footer className="relative overflow-hidden bg-slate-50 text-slate-900 dark:bg-black dark:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(165,180,252,0.16),_transparent_55%)] dark:bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.14),_transparent_55%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-sky-400 via-indigo-400 to-slate-300 dark:to-neutral-700" />

      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.3fr_1fr_1fr] lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-5">
            <Link to="/" className="inline-flex items-center gap-2" aria-label="Volver al inicio">
              <img src="/img/samurai-negro-total.png" alt="Logo Samurai" className="h-12 w-auto dark:hidden" />
              <img src="/img/samurai-blanco-navbar.png" alt="Logo Samurai" className="hidden h-12 w-auto dark:block" />
              <span className="sr-only">Samurai Bicis</span>
            </Link>
            <p className="max-w-sm text-sm text-slate-600 dark:text-neutral-300">
              Catálogo mayorista actualizado, stock real y soporte comercial que acompaña cada paso de tu crecimiento en el canal.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[{ label: "Stock activo", value: stockValue }, { label: "Cobertura", value: "Todo el país" }].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-[0_25px_45px_-35px_rgba(15,23,42,0.35)] dark:border-neutral-800 dark:bg-neutral-900/70"
                >
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.3em] text-slate-400 dark:text-neutral-500">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-neutral-400">Navegación</h3>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-neutral-300">
              {navLinks.map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.to}
                    className="group inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 transition hover:border-slate-200 hover:bg-white/80 hover:text-slate-900 dark:hover:border-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-white"
                  >
                    <span>{link.label}</span>
                    <span aria-hidden className="text-slate-400 transition group-hover:text-slate-600 dark:text-neutral-500 dark:group-hover:text-neutral-300">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-neutral-400">Contacto</h3>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-neutral-300">
              {contactInfo.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 transition hover:border-slate-200 hover:bg-white/80 hover:text-slate-900 dark:hover:border-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-white"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-4 w-4 text-slate-400"
                      aria-hidden
                    >
                      <path d="M19.5 3H4.5C3.67157 3 3 3.67157 3 4.5V19.5C3 20.3284 3.67157 21 4.5 21H19.5C20.3284 21 21 20.3284 21 19.5V4.5C21 3.67157 20.3284 3 19.5 3ZM6.75 6H17.25C17.6642 6 18 6.33579 18 6.75C18 7.11931 17.7898 7.44388 17.4566 7.58438L12.4566 9.70938C12.1622 9.83625 11.8378 9.83625 11.5434 9.70938L6.54344 7.58438C6.21022 7.44388 6 7.11931 6 6.75C6 6.33579 6.33579 6 6.75 6ZM6 9.17034L10.875 11.2346C11.5974 11.5469 12.4026 11.5469 13.125 11.2346L18 9.17034V17.25C18 17.6642 17.6642 18 17.25 18H6.75C6.33579 18 6 17.6642 6 17.25V9.17034Z" />
                    </svg>
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-neutral-400">Seguinos</h3>
            <p className="text-sm text-slate-600 dark:text-neutral-300">
              Contenidos técnicos, lanzamientos y soporte en vivo para tu equipo comercial.
            </p>
            <div className="flex flex-wrap gap-3">
              {socials.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm font-medium text-slate-700 shadow-[0_20px_35px_-30px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:text-slate-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-200/70 pt-6 text-xs text-slate-500 dark:border-neutral-800 dark:text-neutral-400 sm:flex-row">
          <p>© {year} Samurai. Todos los derechos reservados.</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-slate-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
              Experiencia mayorista
            </span>
            <span className="text-[0.7rem] text-slate-400 dark:text-neutral-500">Cargas en tiempo real y soporte dedicado.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
