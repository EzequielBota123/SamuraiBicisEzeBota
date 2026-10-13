// src/pages/auth/Login.jsx
import { useState } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useHistory } from "react-router-dom";
import { auth, db, actionCodeSettings } from "../../firebase";
import { resolveLoginEmail } from "../../services/loginResolve";
import { BusyButtonContent, LoadingSpinner } from "../../components/ui/LoadingIndicators";

const ADMIN_ROLES = ["admin"];

export default function Login() {
  const history = useHistory();
  const [identifier, setIdentifier] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [resetting, setResetting] = useState(false);
  const [welcome, setWelcome] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setWelcome("");
    setLoading(true);
    try {
      const id = identifier.trim();
      const email = id.includes("@") ? id : await resolveLoginEmail(id);
      const { user } = await signInWithEmailAndPassword(auth, email, pass);

      // Fetch profile to determine redirect destination
      let role = null;
      let status = null;
      let displayName = user.displayName || id;
      let appSimpleHabilitada = false;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          role = snap.data()?.role || null;
          status = snap.data()?.status || null;
          displayName = snap.data()?.name || displayName;
          appSimpleHabilitada = snap.data()?.appSimpleHabilitada === true;
        }
      } catch {
        // If profile fetch fails, default redirect
      }

      if (status === "suspendido") {
        await signOut(auth);
        setErr("Tu cuenta está desactivada. Contactá a Samurai si creés que es un error.");
        setLoading(false);
        return;
      }

      if (status === "pending") {
        await signOut(auth);
        setErr("Tu cuenta todavía está en revisión. Te vamos a avisar cuando esté activa.");
        setLoading(false);
        return;
      }

      updateDoc(doc(db, "users", user.uid), { lastLoginAt: serverTimestamp() }).catch(() => {});

      // Solo las cuentas habilitadas a mano (hoy: Julián y Cuchi) entran
      // directo a la app simplificada de "en la calle" — pocos botones
      // grandes para mover stock o ver su depósito, en vez del catálogo
      // completo. El resto de los distribuidores sigue entrando al catálogo
      // como siempre.
      const dest = ADMIN_ROLES.includes(role)
        ? "/"
        : role === "chofer"
        ? "/chofer"
        : appSimpleHabilitada
        ? "/app"
        : "/catalogo";
      setWelcome(`¡Bienvenido, ${displayName}!`);
      // Brief delay so the user sees the welcome message
      setTimeout(() => history.push(dest), 800);
    } catch (e) {
      console.error(e);
      setErr(humanizeAuthError(e));
      setLoading(false);
    }
  }

  async function onForgot() {
    setErr("");
    setMsg("");
    if (!identifier.includes("@")) {
      setErr("Para restablecer tu contraseña pedile a un admin que te la reinicie.");
      return;
    }
    try {
      setResetting(true);
      await sendPasswordResetEmail(auth, identifier.trim(), actionCodeSettings);
      setMsg("Te enviamos un email para restablecer/definir tu contraseña.");
    } catch (e) {
      console.error(e);
      setErr(humanizeAuthError(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_60%)]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 via-indigo-400 to-slate-300" />

      <section className="relative z-10 w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_35px_60px_-30px_rgba(15,23,42,0.2)]">
        <header className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Ingresar</h1>
          <p className="text-sm text-slate-500">Accedé a tu cuenta de Samurai</p>
        </header>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-busy={loading}>
          {err && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {err}
            </div>
          )}
          {welcome && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              {welcome} Redirigiendo…
            </div>
          )}
          {msg && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {msg}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Usuario</label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              disabled={loading}
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 disabled:opacity-60"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Contraseña</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
              disabled={loading}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 disabled:opacity-60"
            />
          </div>

          <button
            disabled={loading}
            className="flex w-full items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-lg shadow-slate-900/20 transition focus:outline-none focus:ring-2 focus:ring-slate-900/40 disabled:opacity-60"
          >
            <BusyButtonContent busy={loading} busyLabel="Ingresando…" label="Ingresar" />
          </button>

          <button
            type="button"
            onClick={onForgot}
            disabled={resetting || loading}
            className="w-full text-center text-sm font-medium text-sky-600 transition hover:text-sky-500 disabled:opacity-60"
          >
            {resetting ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />
                Enviando…
              </span>
            ) : (
              "Olvidé mi contraseña"
            )}
          </button>
        </form>
      </section>

      {(loading || resetting) && (
        <div className="pointer-events-none absolute inset-x-0 top-0">
          <LoadingSpinner label="Procesando…" className="mx-auto mt-6 justify-center text-sky-500" />
        </div>
      )}
    </div>
  );
}

function humanizeAuthError(e) {
  const code = e?.code || "";
  if (code.includes("auth/invalid-email")) return "Email inválido.";
  if (code.includes("auth/user-not-found")) return "No existe un usuario con ese nombre o email.";
  if (code.includes("auth/wrong-password")) return "Contraseña incorrecta.";
  if (code.includes("auth/invalid-credential")) return "Usuario o contraseña incorrectos.";
  if (code.includes("auth/too-many-requests")) return "Demasiados intentos, probá más tarde.";
  if (e?.message?.includes("No encontramos")) return "No encontramos ese usuario.";
  return "No pudimos iniciar sesión. Intentá de nuevo.";
}
