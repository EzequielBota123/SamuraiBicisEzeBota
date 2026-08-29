import { useTheme } from "../../theme/ThemeContext";

function SunIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

export default function ThemeToggle({ isTransparentNow = false }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Modo claro" : "Modo oscuro"}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={`relative inline-flex h-9 w-16 shrink-0 items-center rounded-full border transition-colors duration-300 focus:outline-none focus-visible:ring-2 ${
        isTransparentNow
          ? "border-white/40 bg-white/10 focus-visible:ring-white/70"
          : "border-slate-200 bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800 focus-visible:ring-slate-900/30"
      }`}
    >
      <span
        className={`absolute left-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-300 dark:bg-neutral-900 ${
          isDark ? "translate-x-7" : "translate-x-0"
        }`}
      >
        {isDark ? (
          <MoonIcon className="h-4 w-4 text-indigo-300" />
        ) : (
          <SunIcon className="h-4 w-4 text-amber-500" />
        )}
      </span>
    </button>
  );
}
