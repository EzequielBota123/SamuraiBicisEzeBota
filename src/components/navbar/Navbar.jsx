import { useEffect, useState } from "react";
import { Link, NavLink, useHistory } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import ThemeToggle from "../ui/ThemeToggle";
import { activarNotificacionesPush, permisoNotificacionesEstado } from "../../utils/pushNotifications";

const ADMIN_ROLES = ["admin"];

export default function Navbar({
  logoSrc = "/img/samurai-negro-total.png",
  onLogin,
  transparentOnTop = false,
  scrollOffsetPx = 8,
}) {
  const { user, profile, loading: authLoading, logout } = useAuth();
  const history = useHistory();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > scrollOffsetPx);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrollOffsetPx]);

  const close = () => setOpen(false);

  const handleLogout = async () => {
    close();
    await logout();
    history.push("/");
  };

  const isAdminUser = !authLoading && ADMIN_ROLES.includes(profile?.role);
  const isChofer = !authLoading && profile?.role === "chofer";
  const isClient = !authLoading && !!user && !isAdminUser && !isChofer;
  const hasStock = !authLoading && !!user && !!profile?.contabiliumDepositoId;
  const hasVendedores = !authLoading && !!user && !!profile?.vendedoresAsignados?.length;
  // La "App simple" (/app) es solo para las cuentas que Samurai habilitó a
  // mano (hoy: Julián y Cuchi) — no todo distribuidor con depósito propio,
  // aunque todos puedan ver "Depósito"/"Mover stock" en el menú normal.
  const appSimpleHabilitada = !authLoading && !!user && !!profile?.appSimpleHabilitada;
  const isTransparentNow = transparentOnTop && !scrolled && !open;

  const headerBg = isTransparentNow
    ? "bg-transparent"
    : "supports-[backdrop-filter]:bg-white/80 bg-white/95 backdrop-blur border-b border-slate-200 dark:supports-[backdrop-filter]:bg-neutral-950/80 dark:bg-black/95 dark:border-neutral-800";

  const textBase = isTransparentNow ? "text-white" : "text-slate-900 dark:text-white";
  const ringColor = isTransparentNow
    ? "focus-visible:ring-white/70"
    : "focus-visible:ring-slate-900/30";

  const linkInactive = isTransparentNow
    ? "text-white/90 hover:text-white hover:bg-white/10"
    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-neutral-800";

  const linkActive = isTransparentNow
    ? "text-white bg-white/20"
    : "text-slate-900 bg-white shadow-sm shadow-slate-200 dark:text-white dark:bg-neutral-800 dark:shadow-none";

  const outlineBtn =
    "inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium transition " +
    (isTransparentNow
      ? "border-white/40 text-white hover:bg-white/10"
      : "border-slate-200 text-slate-900 hover:bg-slate-100 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-800") +
    ` focus:outline-none focus-visible:ring-2 ${ringColor}`;

  const solidBtn =
    "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition " +
    (isTransparentNow
      ? "bg-white text-slate-900 hover:bg-slate-100"
      : "bg-gradient-to-r from-sky-500 via-indigo-500 to-blue-600 text-white shadow-lg shadow-sky-200/60 hover:shadow-xl") +
    ` focus:outline-none focus-visible:ring-2 ${ringColor}`;

  const burgerBtn =
    "inline-flex items-center justify-center rounded-xl p-2 transition " +
    (isTransparentNow
      ? "text-white hover:bg-white/10"
      : "text-slate-700 hover:bg-slate-100") +
    ` focus:outline-none focus-visible:ring-2 ${ringColor}`;

  const mobilePanel =
    "space-y-2 rounded-b-xl pb-4 pt-2 " +
    (isTransparentNow
      ? "bg-black/85 text-white backdrop-blur border-t border-white/15"
      : "border-t border-slate-200 bg-white/95 text-slate-800 backdrop-blur dark:border-neutral-800 dark:bg-black/95 dark:text-neutral-200");

  return (
    <header
      className={`sticky top-0 z-50 transition-shadow ${headerBg} ${
        scrolled ? "shadow-[0_12px_30px_-20px_rgba(15,23,42,0.35)]" : "shadow-none"
      }`}
      role="banner"
    >
      <nav
        className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${textBase}`}
        aria-label="Principal"
      >
        <div className="flex h-20 items-center justify-between sm:h-28">
          {/* Logo */}
          <div className="flex items-center flex-shrink-0">
            <Link to="/" className="group relative inline-flex items-center gap-2" aria-label="Ir al inicio">
              <span className="inline-flex animate-float-y items-center">
                <span className="relative inline-block">
                  <img
                    src={logoSrc}
                    alt="Samurai"
                    className="block h-14 w-auto transition-transform duration-300 group-hover:scale-105 sm:h-24 dark:hidden"
                  />
                  <img
                    src="/img/samurai-blanco-navbar.png"
                    alt="Samurai"
                    className="hidden h-14 w-auto transition-transform duration-300 group-hover:scale-105 sm:h-24 dark:block"
                  />
                  <span
                    className="pointer-events-none absolute rounded-full bg-red-600/70 blur-[3px] animate-logo-dot-pulse dark:hidden"
                    style={{ left: "49.6%", top: "20.8%", width: "4.7%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)" }}
                    aria-hidden="true"
                  />
                  <span
                    className="pointer-events-none absolute hidden rounded-full bg-red-600/70 blur-[3px] animate-logo-dot-pulse dark:block"
                    style={{ left: "49.9%", top: "12.2%", width: "2.8%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)" }}
                    aria-hidden="true"
                  />
                </span>
              </span>
            </Link>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex md:items-center md:gap-6">
            <PrimaryLinks
              onNavigate={close}
              linkInactive={linkInactive}
              linkActive={linkActive}
              ringClass={ringColor}
              isAdminUser={isAdminUser}
              isChofer={isChofer}
              isClient={isClient}
              hasStock={hasStock}
              hasVendedores={hasVendedores}
              authLoading={authLoading}
              profile={profile}
            />
          </div>

          {/* Right actions (desktop) */}
          <div className="hidden md:flex md:items-center md:gap-3">
            <ThemeToggle isTransparentNow={isTransparentNow} />
            {!authLoading && (user ? (
              <UserMenu
                user={user}
                profile={profile}
                onLogout={handleLogout}
                outlineBtn={outlineBtn}
                isTransparentNow={isTransparentNow}
                isAdminUser={isAdminUser}
                isChofer={isChofer}
                hasStock={hasStock}
                hasVendedores={hasVendedores}
              />
            ) : (
              <>
                <LoginButton onLogin={onLogin} outlineBtn={outlineBtn} />
                <CTA solidBtn={solidBtn} />
              </>
            ))}
          </div>

          {/* Mobile toggle */}
          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle isTransparentNow={isTransparentNow} />
            <button
              type="button"
              className={burgerBtn}
              aria-controls="mobile-menu"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <span className="sr-only">Abrir menú</span>
              {!open ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                     fill="currentColor" className="h-6 w-6">
                  <path fillRule="evenodd" d="M3.75 5.25a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm0 6a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm.75 5.25a.75.75 0 0 0 0 1.5h15a.75.75 0 0 0 0-1.5h-15Z"
                        clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                     fill="currentColor" className="h-6 w-6">
                  <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 0 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <div id="mobile-menu" className={`md:hidden ${open ? "block" : "hidden"}`}>
          <div className={mobilePanel}>
            <MobileLink to="/" onClick={close} exact isTransparent={isTransparentNow} ringClass={ringColor}>
              Inicio
            </MobileLink>
            <MobileLink to="/catalogo" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
              Catálogo
            </MobileLink>
            {hasStock && (
              <MobileLink to="/mi-stock" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                Mi stock
              </MobileLink>
            )}
            {appSimpleHabilitada && (
              <MobileLink to="/app" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                📱 App simple
              </MobileLink>
            )}
            {appSimpleHabilitada && (
              <MobileLink to="/deposito" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                Depósito
              </MobileLink>
            )}
            {hasVendedores && (
              <MobileLink to="/mis-vendedores" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                Mis clientes
              </MobileLink>
            )}
            {hasVendedores && (
              <MobileLink to="/mapa-vendedores" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                Mapa
              </MobileLink>
            )}
            {appSimpleHabilitada && (
              <MobileLink to="/transferir-stock" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                Mover stock
              </MobileLink>
            )}
            {(isChofer || profile?.esChofer === true) && (
              <MobileLink to="/chofer" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                🚚 Sector chofer
              </MobileLink>
            )}
            {isClient && (
              <>
                <MobileLink to="/mis-pedidos" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                  Mis pedidos
                </MobileLink>
                <MobileLink to="/mi-cuenta" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                  Mi cuenta
                </MobileLink>
              </>
            )}
            {!authLoading && !isClient && !isAdminUser && !isChofer && (
              <>
                <MobileLink to="/estado-de-pedido" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                  Estado de pedido
                </MobileLink>
                <MobileLink to="/quiero-ser-cliente" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                  Quiero ser cliente
                </MobileLink>
              </>
            )}
            <div
              className={`border-t pt-2 ${
                isTransparentNow ? "border-white/15" : "border-slate-200/70"
              }`}
            />
            {!authLoading && (user ? (
              <>
                <div className={`px-4 py-2 text-xs ${isTransparentNow ? "text-white/70" : "text-slate-500"}`}>
                  {user.displayName || user.email}
                </div>
                {isAdminUser && (
                  <>
                    <MobileLink to="/admin" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                      Panel admin
                    </MobileLink>
                    <MobileLink to="/admin/users?new=1" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                      Generar usuario
                    </MobileLink>
                  </>
                )}
                {(isChofer || profile?.esChofer === true) && (
                  <MobileLink to="/chofer" onClick={close} isTransparent={isTransparentNow} ringClass={ringColor}>
                    🚚 Sector chofer
                  </MobileLink>
                )}
                <button
                  onClick={handleLogout}
                  className={outlineBtn + " w-full text-left"}
                >
                  Cerrar sesión
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    close();
                    if (onLogin) onLogin();
                    else history.push("/login");
                  }}
                  className={outlineBtn + " w-full text-left"}
                >
                  Ingresar
                </button>
                <Link to="/quiero-ser-cliente" onClick={close} className={solidBtn + " w-full text-center"}>
                  Quiero ser cliente
                </Link>
              </>
            ))}
          </div>
        </div>
      </nav>
    </header>
  );
}

function UserMenu({ user, profile, onLogout, outlineBtn, isTransparentNow, isAdminUser, isChofer, hasStock, hasVendedores }) {
  const [dropOpen, setDropOpen] = useState(false);
  const displayName = profile?.name || user.displayName || user.email?.split("@")[0] || "Usuario";
  const showMiStock = hasStock;
  const itemClass = `flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
    isTransparentNow ? "hover:bg-white/10" : "hover:bg-slate-100"
  }`;

  // Notificaciones push: cualquier cuenta (admin o cliente) puede activarlas
  // para su propio celular — cada uno recibe solo los avisos que le
  // corresponden a su cuenta, no los de otros.
  const [notifPermiso, setNotifPermiso] = useState(null);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState("");
  useEffect(() => {
    permisoNotificacionesEstado().then(setNotifPermiso);
  }, []);

  async function handleActivarNotificaciones() {
    setNotifBusy(true);
    setNotifError("");
    try {
      await activarNotificacionesPush(user.uid);
      setNotifPermiso("granted");
    } catch (e) {
      setNotifError(e.message || "No se pudo activar");
    } finally {
      setNotifBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setDropOpen((v) => !v)}
        className={outlineBtn + " gap-2"}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-xs font-bold text-white">
          {displayName[0]?.toUpperCase()}
        </span>
        <span className="max-w-[120px] truncate">{displayName}</span>
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
      {dropOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setDropOpen(false)} />
          <div className={`absolute right-0 z-20 mt-2 w-56 rounded-2xl border p-1 shadow-xl ${
            isTransparentNow
              ? "border-white/20 bg-slate-900/90 text-white backdrop-blur"
              : "border-slate-200 bg-white text-slate-900"
          }`}>
            <div className={`px-3 py-2 text-xs ${isTransparentNow ? "text-white/60" : "text-slate-500"}`}>
              {user.email}
            </div>
            {(showMiStock || hasVendedores || isAdminUser || isChofer) && (
              <hr className={isTransparentNow ? "border-white/15 my-1" : "border-slate-100 my-1"} />
            )}
            {showMiStock && (
              <Link to="/mi-stock" onClick={() => setDropOpen(false)} className={itemClass}>
                <BikeIcon />
                Mi stock
              </Link>
            )}
            {profile?.appSimpleHabilitada && (
              <Link to="/app" onClick={() => setDropOpen(false)} className={itemClass}>
                <BikeIcon />
                📱 App simple
              </Link>
            )}
            {profile?.appSimpleHabilitada && (
              <Link to="/deposito" onClick={() => setDropOpen(false)} className={itemClass}>
                <BikeIcon />
                Depósito
              </Link>
            )}
            {hasVendedores && (
              <Link to="/mis-vendedores" onClick={() => setDropOpen(false)} className={itemClass}>
                <BikeIcon />
                Mis clientes
              </Link>
            )}
            {hasVendedores && (
              <Link to="/mapa-vendedores" onClick={() => setDropOpen(false)} className={itemClass}>
                <BikeIcon />
                Mapa
              </Link>
            )}
            {profile?.appSimpleHabilitada && (
              <Link to="/transferir-stock" onClick={() => setDropOpen(false)} className={itemClass}>
                <BikeIcon />
                Mover stock
              </Link>
            )}
            {(isChofer || profile?.esChofer === true) && (
              <Link to="/chofer" onClick={() => setDropOpen(false)} className={itemClass}>
                🚚 Sector chofer
              </Link>
            )}
            {isAdminUser && (
              <>
                <Link to="/admin" onClick={() => setDropOpen(false)} className={itemClass}>
                  <GearIcon />
                  Panel admin
                </Link>
                <Link to="/admin/users?new=1" onClick={() => setDropOpen(false)} className={itemClass}>
                  <UserPlusIcon />
                  Generar usuario
                </Link>
              </>
            )}
            <hr className={isTransparentNow ? "border-white/15 my-1" : "border-slate-100 my-1"} />
            {notifPermiso === "granted" ? (
              <div className={`${itemClass} cursor-default opacity-60`}>🔔 Notificaciones activadas</div>
            ) : notifPermiso === "unsupported" ? null : (
              <button onClick={handleActivarNotificaciones} disabled={notifBusy} className={itemClass}>
                🔔 {notifBusy ? "Activando…" : "Activar notificaciones"}
              </button>
            )}
            {notifError && <p className="px-3 pb-1 text-[11px] text-rose-500">{notifError}</p>}
            <hr className={isTransparentNow ? "border-white/15 my-1" : "border-slate-100 my-1"} />
            <button onClick={onLogout} className={itemClass}>
              <LogoutIcon />
              Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BikeIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 17.5 10 8h5l3.5 9.5M10 8l2.5 5.5H18M10 8 8 5h-2" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5M19 8v6M22 11h-6" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
    </svg>
  );
}

function PrimaryLinks({ onNavigate, linkInactive, linkActive, ringClass, isAdminUser, isChofer, isClient, hasStock, hasVendedores, authLoading, profile }) {
  const base =
    `text-sm font-medium transition rounded-lg px-3 py-2 focus:outline-none focus-visible:ring-2 ${ringClass}`;
  return (
    <div className="flex items-center gap-2" role="menubar">
      <NavLink exact to="/" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
        Inicio
      </NavLink>
      <NavLink to="/catalogo" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
        Catálogo
      </NavLink>
      {hasStock && (
        <NavLink to="/mi-stock" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
          Mi stock
        </NavLink>
      )}
      {profile?.appSimpleHabilitada && (
        <NavLink to="/app" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
          📱 App simple
        </NavLink>
      )}
      {profile?.appSimpleHabilitada && (
        <NavLink to="/deposito" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
          Depósito
        </NavLink>
      )}
      {hasVendedores && (
        <NavLink to="/mis-vendedores" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
          Mis clientes
        </NavLink>
      )}
      {hasVendedores && (
        <NavLink to="/mapa-vendedores" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
          Mapa
        </NavLink>
      )}
      {profile?.appSimpleHabilitada && (
        <NavLink to="/transferir-stock" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
          Mover stock
        </NavLink>
      )}
      {isChofer && (
        <NavLink to="/chofer" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
          🚚 Sector chofer
        </NavLink>
      )}
      {isClient && (
        <>
          <NavLink to="/mis-pedidos" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
            Mis pedidos
          </NavLink>
          <NavLink to="/mi-cuenta" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
            Mi cuenta
          </NavLink>
        </>
      )}
      {!authLoading && !isClient && !isAdminUser && !isChofer && (
        <>
          <NavLink to="/estado-de-pedido" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
            Estado de pedido
          </NavLink>
          <NavLink to="/quiero-ser-cliente" onClick={onNavigate} className={base + " " + linkInactive} activeClassName={linkActive} role="menuitem">
            Quiero ser cliente
          </NavLink>
        </>
      )}
    </div>
  );
}

function CTA({ solidBtn }) {
  return (
    <Link to="/quiero-ser-cliente" className={solidBtn}>
      Quiero ser cliente
    </Link>
  );
}

function LoginButton({ onLogin, outlineBtn }) {
  return onLogin ? (
    <button onClick={onLogin} className={outlineBtn}>
      Ingresar
    </button>
  ) : (
    <Link to="/login" className={outlineBtn}>
      Ingresar
    </Link>
  );
}

function MobileLink({ to, children, onClick, exact, isTransparent, ringClass }) {
  const base =
    `block rounded-xl px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 ${ringClass}`;
  const colorClasses = isTransparent
    ? "text-white hover:bg-white/10"
    : "text-slate-700 hover:bg-slate-100";
  const activeClasses = isTransparent
    ? "bg-white/20 text-white"
    : "bg-white text-slate-900 shadow-sm shadow-slate-200";
  return (
    <NavLink
      exact={!!exact}
      to={to}
      onClick={onClick}
      className={`${base} ${colorClasses}`}
      activeClassName={activeClasses}
    >
      {children}
    </NavLink>
  );
}
