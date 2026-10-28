// src/firebase.ts
import { initializeApp, getApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  onIdTokenChanged,
} from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken as getAppCheckToken,
} from "firebase/app-check";

// ⚙️ Config (respeta tu bucket .firebasestorage.app)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: "bikeshop-ab2f0",
  storageBucket: "bikeshop-ab2f0.firebasestorage.app",
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// "Gestionar como X" (admin entrando como un cliente/vendedor desde
// Clientes 360, ver ImpersonarPage.jsx) abre una pestaña nueva en
// /impersonar — necesita loguearse con una identidad DISTINTA a la del
// admin sin pisarle su sesión, así que en vez de reusar la app/persistencia
// de siempre (local, compartida entre todas las pestañas por diseño de
// Firebase) arranca una segunda app con su propia sesión, acotada solo a
// esa pestaña (sessionStorage) — se pierde sola al cerrarla.
const esPestanaImpersonada = typeof window !== "undefined" && window.location.pathname.startsWith("/impersonar");

export const app = esPestanaImpersonada
  ? initializeApp(firebaseConfig, "impersonacion")
  : getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// 🔐 App Check
// En DEV: usá debug token. La primera vez poné `true` para que te lo imprima y registralo en la consola.
// Luego podés pegar el token fijo para no regenerarlo en cada reload.
const DEV_DEBUG_TOKEN = "34fd0434-6c9c-4a69-b8f2-d8d4e1bafc3a";
  // @ts-ignore
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = DEV_DEBUG_TOKEN;
  // Ejemplo fijo una vez registrado:
  // @ts-ignore
  // self.FIREBASE_APPCHECK_DEBUG_TOKEN = "TU_TOKEN_DEBUG_REGISTRADO";

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(
    import.meta.env.VITE_RECAPTCHA_SITE_KEY || "debug"
  ),
  isTokenAutoRefreshEnabled: true,
});

// (opcional) verificar que hay token de App Check en cliente
getAppCheckToken(appCheck, true)
  .then(t => console.log("[app-check] token presente?", !!t?.token))
  .catch(e => console.warn("[app-check] error getToken", e));

// 🔒 Auth con persistencia (misma app en todos lados)
export const auth = getAuth(app);
setPersistence(auth, esPestanaImpersonada ? browserSessionPersistence : browserLocalPersistence);
// @ts-ignore — acceso rápido desde la consola del navegador para diagnósticos puntuales
window.__auth = auth;

// 🗄️ Firestore / Storage / Functions
export const db = getFirestore(app);
// Usa el bucket del config para evitar mismatches
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
// @ts-ignore — acceso rápido desde la consola del navegador para diagnósticos puntuales
window.__db = db;
// @ts-ignore
window.__storage = storage;
// @ts-ignore
window.__fs = { collection, query, where, getDocs, addDoc, doc, Timestamp };
// @ts-ignore
window.__st = { ref, uploadBytes, getDownloadURL };

// Debug de config (útil para confirmar bucket y projectId)
console.log("projectId:", getApp().options.projectId);
console.log("storageBucket (SDK):", getApp().options.storageBucket);

// Logs de sesión (solo info útil)
onAuthStateChanged(auth, (u) => {
  console.log("[auth] onAuthStateChanged ->", {
    loggedIn: !!u,
    uid: u?.uid,
    email: u?.email,
  });
});

onIdTokenChanged(auth, async (u) => {
  if (!u) return;
  const tok = await u.getIdTokenResult().catch(() => null);
  console.log("[auth] onIdTokenChanged ->", {
    uid: u.uid,
    issuedAt: tok?.issuedAtTime,
    expiresAt: tok?.expirationTime,
  });
});

// URL post-acción (reset password, etc.)
const prodSiteUrl = "https://samurai.ar";

export const actionCodeSettings = {
  url: import.meta.env.PROD
    ? `${prodSiteUrl}/login`
    : "http://localhost:5173/login",
  handleCodeInApp: false,
};

console.log("appId (runtime):", getApp().options.appId);
console.log("projectId (runtime):", getApp().options.projectId);
console.log("storageBucket (runtime):", getApp().options.storageBucket);
