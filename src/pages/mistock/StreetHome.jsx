import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

// Pantalla de inicio simplificada para distribuidores con depósito propio
// (ej. Julián, Cuchi) — pensada para usarse parados en la calle, de apuro:
// pocos botones, grandes, directo a lo que ya usan. Reemplaza el catálogo
// completo como destino después del login para este tipo de cuenta.
const TILE_BASE =
  "flex flex-col items-start gap-1 rounded-3xl border-2 p-6 text-left transition hover:-translate-y-1 hover:shadow-xl active:scale-[0.98]";

export default function StreetHome() {
  const { profile } = useAuth();
  const tieneEquipo = !!profile?.vendedoresAsignados?.length;
  // "Mis clientes" también sirve para ver el informe propio (comisión,
  // flete, ventas) aunque no tenga un equipo de sub-vendedores propio (ej.
  // Cuchi, que solo tiene depósito propio) — MisVendedoresPage.jsx ya
  // acepta este caso, antes solo faltaba mostrar el acceso acá.
  const tieneDepositoPropio = !!profile?.contabiliumDepositoId;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
        👋 Hola, {profile?.name || "de nuevo"}
      </h1>
      <p className="mt-2 text-base text-slate-500 dark:text-neutral-400">
        {profile?.contabiliumDepositoNombre ? `Tu depósito: ${profile.contabiliumDepositoNombre}` : "Accesos rápidos para cuando estás en la calle."}
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link to="/deposito" className={`${TILE_BASE} border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/20`}>
          <span className="text-4xl">📦</span>
          <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Mi depósito</p>
          <p className="text-sm text-slate-600 dark:text-neutral-400">Ver el detalle de cada bici que tenés ahora — modelo, talle, color y cuántas.</p>
        </Link>

        <Link to="/transferir-stock" className={`${TILE_BASE} border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/20`}>
          <span className="text-4xl">🔁</span>
          <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Mover stock</p>
          <p className="text-sm text-slate-600 dark:text-neutral-400">Traer bicis de Lavalle{tieneEquipo ? " o mandarle a un cliente" : ""}.</p>
        </Link>

        {(tieneEquipo || tieneDepositoPropio) && (
          <Link to="/mis-vendedores" className={`${TILE_BASE} border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20`}>
            <span className="text-4xl">👥</span>
            <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{tieneEquipo ? "Mis clientes" : "Mi informe"}</p>
            <p className="text-sm text-slate-600 dark:text-neutral-400">
              {tieneEquipo ? "Tu cartera, con el stock de cada uno." : "Flete, ventas y comisión — entregado, cobrado y detalle venta por venta."}
            </p>
          </Link>
        )}

        <Link to="/mi-cuenta" className={`${TILE_BASE} border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20`}>
          <span className="text-4xl">💳</span>
          <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Mi cuenta</p>
          <p className="text-sm text-slate-600 dark:text-neutral-400">Facturas, saldo y comprobantes de pago.</p>
        </Link>

        <Link to="/catalogo" className={`${TILE_BASE} border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900`}>
          <span className="text-4xl">🚲</span>
          <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Ver catálogo completo</p>
          <p className="text-sm text-slate-600 dark:text-neutral-400">El sitio normal, con todo.</p>
        </Link>
      </div>
    </div>
  );
}
