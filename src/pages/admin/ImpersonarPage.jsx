// src/pages/admin/ImpersonarPage.jsx
import { useEffect, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { signInWithCustomToken } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";

const ADMIN_ROLES = ["admin"];

// Página que abre la pestaña nueva que lanza "Gestionar como X" desde
// Clientes 360 — recibe un custom token de un solo uso (ver
// adminCrearSesionImpersonada en functions/index.js) y loguea esta pestaña
// como esa cuenta. src/firebase.ts ya detectó por la URL (/impersonar) que
// esta pestaña usa una app de Firebase separada, con sesión acotada a la
// pestaña (sessionStorage) — no toca la sesión del admin en su propia
// pestaña. Al terminar redirige al mismo destino que vería ese usuario si
// hiciera login de verdad (misma lógica que Login.jsx).
export default function ImpersonarPage() {
  const history = useHistory();
  const location = useLocation();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token");
    if (!token) {
      setError("Falta el token. Volvé a abrir esto desde Clientes 360.");
      return;
    }

    (async () => {
      try {
        const { user } = await signInWithCustomToken(auth, token);
        const snap = await getDoc(doc(db, "users", user.uid));
        const perfil = snap.exists() ? snap.data() : null;
        const role = perfil?.role || null;
        const nombre = perfil?.name || user.email || "este usuario";

        try {
          sessionStorage.setItem("impersonando", "1");
          sessionStorage.setItem("impersonandoNombre", nombre);
        } catch {
          // no crítico
        }

        const dest = ADMIN_ROLES.includes(role)
          ? "/"
          : role === "chofer"
          ? "/chofer"
          : perfil?.appSimpleHabilitada === true
          ? "/app"
          : "/catalogo";
        history.replace(dest);
      } catch (e) {
        console.error("[ImpersonarPage] error:", e);
        setError(e.message || "No se pudo iniciar la sesión. El link puede haber expirado — volvé a abrirlo desde Clientes 360.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {error ? (
          <>
            <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>
            <button
              onClick={() => window.close()}
              className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300"
            >
              Cerrar pestaña
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Entrando a su cuenta…</p>
          </>
        )}
      </div>
    </div>
  );
}
