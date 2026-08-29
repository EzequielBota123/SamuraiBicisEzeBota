import { useEffect, useRef, useState } from "react";

const WORD = "SAMURAI";

// Timeline (ms):
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

export default function IntroSplash() {
  const [phase, setPhase] = useState("in"); // in -> out -> done
  const [mounted, setMounted] = useState(true);
  const [cutting, setCutting] = useState(false);
  const bikeAudioRef = useRef(null);
  const swordAudioRef = useRef(null);
  const bikePlayedRef = useRef(false);
  const swordDueRef = useRef(false);
  const swordPlayedRef = useRef(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";

    // Los navegadores móviles bloquean el audio con sonido hasta que hay un
    // gesto del usuario (a veces autoplay "cuela" igual según el motor y el
    // engagement previo con el sitio — por eso a veces suena y a veces no).
    // Como red de seguridad: si el intento automático falla, en cuanto el
    // usuario toque/haga click en cualquier lugar (algo casi seguro en los
    // primeros segundos) disparamos el sonido que quedó pendiente.
    function unlockPending() {
      if (!bikePlayedRef.current) {
        bikeAudioRef.current
          ?.play()
          .then(() => { bikePlayedRef.current = true; })
          .catch(() => {});
      }
      if (swordDueRef.current && !swordPlayedRef.current) {
        swordAudioRef.current
          ?.play()
          .then(() => { swordPlayedRef.current = true; })
          .catch(() => {});
      }
    }
    const unlockEvents = ["pointerdown", "touchstart", "click", "keydown"];
    unlockEvents.forEach((ev) => document.addEventListener(ev, unlockPending, { passive: true }));

    bikeAudioRef.current
      ?.play()
      .then(() => { bikePlayedRef.current = true; })
      .catch(() => {});

    const cutTimer = setTimeout(() => {
      setCutting(true);
      swordDueRef.current = true;
      swordAudioRef.current
        ?.play()
        .then(() => { swordPlayedRef.current = true; })
        .catch(() => {});
    }, CUT_AT);
    const outTimer = setTimeout(() => setPhase("out"), FADE_OUT_AT);
    const doneTimer = setTimeout(() => {
      setMounted(false);
      document.body.style.overflow = "";
      unlockEvents.forEach((ev) => document.removeEventListener(ev, unlockPending));
    }, UNMOUNT_AT);

    return () => {
      unlockEvents.forEach((ev) => document.removeEventListener(ev, unlockPending));
      clearTimeout(cutTimer);
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
      document.body.style.overflow = "";
    };
  }, []);

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
      className={`fixed inset-0 z-[9999] flex h-[100dvh] w-[100dvw] flex-col items-center justify-center overflow-hidden bg-black px-6 transition-opacity duration-[900ms] ease-in-out ${
        phase === "out" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <audio ref={bikeAudioRef} src="/audio/bici.mp3" preload="auto" />
      <audio ref={swordAudioRef} src="/audio/espada.mp3" preload="auto" />

      <div className="relative flex flex-col items-center">
        {backgroundEffects}

        {/* Contenido original: visible hasta el momento del corte */}
        <div
          className="relative flex flex-col items-center"
          style={{ opacity: cutting ? 0 : 1 }}
        >
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
