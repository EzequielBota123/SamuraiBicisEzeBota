import { useEffect, useRef, useState } from "react";

const WORD = "SAMURAI";

// Timeline (ms), relativa al momento en que arranca (el tap inicial, no el
// mount del componente):
// 0     -> logo/aura empiezan a aparecer, arranca sonido de bici
// 150   -> ícono aparece
// 1500  -> letras "SAMURAI" arrancan a aparecer (una por una)
// 3000  -> barra roja se dibuja
// 4000  -> corte de espada: flash + sonido de espada + mitades se separan
// 4650  -> empieza el fade out general
// 5550  -> desmonta

const CUT_AT = 4000;
const FADE_OUT_AT = CUT_AT + 650;
const UNMOUNT_AT = FADE_OUT_AT + 900;

// Los navegadores MÓVILES solo dejan sonar audio con volumen si el .play()
// se dispara DENTRO del mismo gesto sincrónico de un tap real — un tap que
// abre la app (ícono, link) no cuenta, porque ocurre antes de que esta
// página exista. En desktop esto no aplica (autoplay con sonido ya funciona
// bien), así que ahí la intro sigue arrancando sola, como siempre — el "tocá
// para entrar" solo aparece en dispositivos táctiles.
function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
}

export default function IntroSplash() {
  const [needsTap] = useState(isTouchDevice);
  const [started, setStarted] = useState(() => !isTouchDevice());
  const [phase, setPhase] = useState("in"); // in -> out -> done
  const [mounted, setMounted] = useState(true);
  const [cutting, setCutting] = useState(false);
  const [ripple, setRipple] = useState(null); // { x, y, id } — feedback visual del tap
  const bikeAudioRef = useRef(null);
  const swordAudioRef = useRef(null);

  function handleStart(e) {
    if (started) return;
    // Onda expansiva desde el punto exacto del tap, para que se sienta que
    // "pasó algo" en el instante del toque (se autolimpia con onAnimationEnd).
    const rect = e.currentTarget.getBoundingClientRect();
    const point = e.touches?.[0] || e.changedTouches?.[0] || e;
    setRipple({
      x: (point.clientX ?? rect.width / 2) - rect.left,
      y: (point.clientY ?? rect.height / 2) - rect.top,
      id: Date.now(),
    });
    // Este .play() va DENTRO del handler del tap a propósito — es lo único
    // que hace que el navegador móvil lo permita. El de la espada, más abajo,
    // se dispara después vía setTimeout: como ya hubo un play() exitoso
    // originado en un gesto real en esta misma página, el navegador sigue
    // permitiendo reproducir audio el resto de la sesión sin pedir un nuevo
    // gesto por cada sonido.
    bikeAudioRef.current?.play().catch(() => {});
    setStarted(true);
  }

  useEffect(() => {
    if (!started) return;
    document.body.style.overflow = "hidden";

    // Desktop: arranca solo, sin tap — acá SÍ hace falta disparar el sonido
    // de la bici (en el flujo con tap, handleStart ya lo hizo).
    if (!needsTap) {
      bikeAudioRef.current?.play().catch(() => {});
    }

    const cutTimer = setTimeout(() => {
      setCutting(true);
      swordAudioRef.current?.play().catch(() => {});
    }, CUT_AT);
    const outTimer = setTimeout(() => setPhase("out"), FADE_OUT_AT);
    const doneTimer = setTimeout(() => {
      setMounted(false);
      document.body.style.overflow = "";
    }, UNMOUNT_AT);

    return () => {
      clearTimeout(cutTimer);
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
      document.body.style.overflow = "";
    };
  }, [started, needsTap]);

  if (!mounted) return null;

  // Fondo (aura + resplandor): se muestra una sola vez, nunca se duplica ni
  // se recorta — si se clona dentro de las mitades con clip-path, el
  // degradé circular (mucho más grande que la caja del logo) queda cortado
  // por el propio clip-path y se ve como un triángulo/cuadrado sólido feo.
  const backgroundEffects = (
    <div style={{ opacity: cutting ? 0 : 1, transition: "opacity 500ms ease-out" }}>
      <div
        className="pointer-events-none absolute left-1/2 top-[38%] aspect-square w-[85vmin] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          opacity: 0,
          background:
            "radial-gradient(circle at 50% 50%, rgba(225,29,72,0.55) 0%, rgba(225,29,72,0.28) 32%, rgba(225,29,72,0.1) 55%, transparent 78%)",
          animation: "intro-aura 2.6s cubic-bezier(0.16,1,0.3,1) 0s forwards",
        }}
      />
      <div
        className="pointer-events-none absolute left-1/2 top-[22%] aspect-square w-[36vmin] max-w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500/50 blur-[36px] sm:w-32"
        style={{ opacity: 0, animation: "intro-aura-pulse 2.2s ease-in-out 1.1s infinite" }}
      />
    </div>
  );

  // Solo esto se "corta": el ícono, el texto y la barra — sin fondos que
  // desborden la caja, para que el clip-path dé un corte limpio.
  const foregroundContent = (
    <>
      <img
        src="/img/samurai-favicon-round.png"
        alt="Samurai"
        className="relative h-20 w-20 sm:h-24 sm:w-24"
        style={{ opacity: 0, transform: "scale(0.7)", animation: "intro-icon 1.4s cubic-bezier(0.16,1,0.3,1) 0.15s forwards" }}
      />

      <div className="relative mt-7 flex">
        {WORD.split("").map((letter, i) => (
          <span
            key={i}
            className="inline-block text-[clamp(1.5rem,8vw,2.75rem)] font-extrabold tracking-[0.2em] text-white"
            style={{
              opacity: 0,
              transform: "translateY(24px)",
              animation: `intro-letter 1s cubic-bezier(0.16,1,0.3,1) ${1.5 + i * 0.16}s forwards`,
            }}
          >
            {letter}
          </span>
        ))}
      </div>

      <div
        className="relative mt-5 h-[2px] w-0 bg-rose-600"
        style={{ animation: "intro-bar 1s cubic-bezier(0.16,1,0.3,1) 3s forwards" }}
      />
    </>
  );

  return (
    <div
      onClick={handleStart}
      className={`fixed inset-0 z-[9999] flex h-[100dvh] w-[100dvw] flex-col items-center justify-center overflow-hidden bg-black px-6 transition-opacity duration-[900ms] ease-in-out ${
        phase === "out" ? "pointer-events-none opacity-0" : "opacity-100"
      } ${started ? "" : "cursor-pointer"}`}
    >
      <audio ref={bikeAudioRef} src="/audio/bici.mp3" preload="auto" />
      <audio ref={swordAudioRef} src="/audio/espada.mp3" preload="auto" />

      {ripple && (
        <span
          key={ripple.id}
          onAnimationEnd={() => setRipple(null)}
          className="pointer-events-none absolute z-30 rounded-full bg-white/40"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: 14,
            height: 14,
            transform: "translate(-50%, -50%)",
            animation: "intro-tap-ripple 550ms ease-out forwards",
          }}
        />
      )}

      {!started ? (
        // Estado de espera: logo quieto + invitación a tocar. Recién con
        // este tap arranca todo el timeline de animación + sonido juntos.
        // active:scale-95 da feedback táctil inmediato apenas apoyás el dedo,
        // antes de que se dispare el click (que recién pasa al soltar).
        <div className="flex scale-100 flex-col items-center gap-6 transition-transform duration-150 active:scale-95">
          <img src="/img/samurai-favicon-round.png" alt="Samurai" className="h-20 w-20 sm:h-24 sm:w-24" />
          <p
            className="text-sm font-semibold tracking-[0.15em] text-white/80"
            style={{ animation: "intro-tap-hint 1.6s ease-in-out infinite" }}
          >
            TOCÁ PARA ENTRAR
          </p>
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          {backgroundEffects}

          {/* Contenido original: visible hasta el momento del corte */}
          <div className="relative flex flex-col items-center" style={{ opacity: cutting ? 0 : 1 }}>
            {foregroundContent}
          </div>

          {cutting && (
            <>
              {/* Katana que atraviesa el logo en diagonal */}
              <div
                className="pointer-events-none absolute inset-[-45%] z-20 flex items-center justify-center"
                style={{ transform: "rotate(-18deg)" }}
              >
                <div
                  className="relative"
                  style={{ width: "260%", animation: "intro-katana-move 480ms cubic-bezier(0.4,0,0.2,1) forwards" }}
                >
                  {/* resplandor detrás de la hoja */}
                  <svg
                    viewBox="0 0 600 60"
                    className="absolute left-0 top-1/2 h-12 w-full -translate-y-1/2"
                    style={{ filter: "blur(6px)", opacity: 0.8 }}
                  >
                    <polygon points="0,30 430,10 470,30 430,50" fill="#fff" />
                  </svg>
                  {/* hoja */}
                  <svg viewBox="0 0 600 60" className="relative h-10 w-full" style={{ overflow: "visible" }}>
                    <defs>
                      <linearGradient id="bladeSteel" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f8fafc" />
                        <stop offset="42%" stopColor="#e2e8f0" />
                        <stop offset="50%" stopColor="#ffffff" />
                        <stop offset="58%" stopColor="#cbd5e1" />
                        <stop offset="100%" stopColor="#94a3b8" />
                      </linearGradient>
                    </defs>
                    {/* hoja curva tipo katana, punta a la izquierda */}
                    <polygon
                      points="0,30 420,12 452,22 452,38 420,48"
                      fill="url(#bladeSteel)"
                      stroke="#f1f5f9"
                      strokeWidth="0.8"
                    />
                    {/* línea de brillo */}
                    <polyline points="10,29 415,17" stroke="#ffffff" strokeWidth="1" opacity="0.9" />
                    {/* tsuba (guarda) */}
                    <ellipse cx="459" cy="30" rx="7" ry="15" fill="#a16207" stroke="#facc15" strokeWidth="1" />
                    {/* empuñadura */}
                    <rect x="466" y="22" width="70" height="16" rx="4" fill="#1c1917" />
                    {[478, 490, 502, 514, 526].map((x) => (
                      <line key={x} x1={x} y1="22" x2={x + 8} y2="38" stroke="#57534e" strokeWidth="1.5" />
                    ))}
                    {/* pomo */}
                    <circle cx="540" cy="30" r="7" fill="#a16207" />
                  </svg>
                </div>
              </div>

              {/* Mitad superior-izquierda */}
              <div
                className="absolute inset-0 flex flex-col items-center"
                style={{
                  clipPath: "polygon(0 0, 100% 0, 0 100%)",
                  animation: "intro-half-tl 900ms cubic-bezier(0.33,1,0.68,1) 60ms forwards",
                }}
              >
                {foregroundContent}
              </div>

              {/* Mitad inferior-derecha */}
              <div
                className="absolute inset-0 flex flex-col items-center"
                style={{
                  clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
                  animation: "intro-half-br 900ms cubic-bezier(0.33,1,0.68,1) 60ms forwards",
                }}
              >
                {foregroundContent}
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes intro-icon {
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes intro-letter {
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes intro-bar {
          to { width: 5rem; }
        }
        @keyframes intro-aura {
          to { opacity: 1; }
        }
        @keyframes intro-aura-pulse {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.25); }
        }
        @keyframes intro-tap-hint {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes intro-tap-ripple {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(22); opacity: 0; }
        }
        @keyframes intro-katana-move {
          0% { transform: translateX(72%); opacity: 0; }
          10% { opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateX(-72%); opacity: 0; }
        }
        @keyframes intro-half-tl {
          0% { opacity: 1; transform: translate(0, 0) rotate(0deg); }
          100% { opacity: 0; transform: translate(-14%, -16%) rotate(-6deg); }
        }
        @keyframes intro-half-br {
          0% { opacity: 1; transform: translate(0, 0) rotate(0deg); }
          100% { opacity: 0; transform: translate(14%, 16%) rotate(6deg); }
        }
      `}</style>
    </div>
  );
}
