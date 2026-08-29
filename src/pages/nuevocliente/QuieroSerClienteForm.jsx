import React, { useState } from "react";
import { submitClientSignup } from "../../services/comprobantes";
import { BusyButtonContent } from "../../components/ui/LoadingIndicators";
import { validateCuit, formatCuit } from "../../utils/cuit";

export default function QuieroSerClienteForm({ onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [createdUsername, setCreatedUsername] = useState("");
  const [error, setError] = useState("");
  const [cuitError, setCuitError] = useState("");
  const [form, setForm] = useState({
    nombre: "",
    password: "",
    celular: "",
    email: "",
    empresa: "",
    cuit: "",
    provincia: "",
    localidad: "",
    rubro: "",
    mensaje: "",
    acepta: false,
  });

  function onChange(e) {
    const { name, value, type, checked } = e.target;
    if (name === "cuit") {
      const formatted = formatCuit(value);
      setForm((f) => ({ ...f, cuit: formatted }));
      setCuitError("");
      return;
    }
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  function onCuitBlur() {
    if (form.cuit && !validateCuit(form.cuit)) {
      setCuitError("CUIT inválido. Ingresá los 11 dígitos correctamente.");
    } else {
      setCuitError("");
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.cuit) {
      setError("El CUIT es obligatorio.");
      return;
    }
    if (!validateCuit(form.cuit)) {
      setCuitError("CUIT inválido. Ingresá los 11 dígitos correctamente.");
      return;
    }
    if (!form.acepta) {
      setError("Debés aceptar la política de privacidad para continuar.");
      return;
    }
    if (!form.password || form.password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const { username } = await submitClientSignup(form);
      setCreatedUsername(username);
      setOk(true);
      onSuccess?.();
      setForm({
        nombre: "",
        password: "",
        celular: "",
        email: "",
        empresa: "",
        cuit: "",
        provincia: "",
        localidad: "",
        rubro: "",
        mensaje: "",
        acepta: false,
      });
      setCuitError("");
    } catch (err) {
      console.error(err);
      setError(err?.message || "No pudimos enviar el formulario. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (ok) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-8 text-emerald-100 shadow-[0_35px_60px_-30px_rgba(16,185,129,0.6)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_60%)]" />
        <div className="relative space-y-3">
          <h3 className="text-2xl font-semibold text-white">¡Gracias!</h3>
          <p className="text-sm text-emerald-100/80">
            Recibimos tu solicitud. Nuestro equipo comercial te va a contactar a la brevedad para activar tu cuenta.
          </p>
          <p className="rounded-2xl border border-emerald-400/40 bg-white/10 px-4 py-3 text-sm text-white">
            Tu usuario para ingresar va a ser: <strong>{createdUsername}</strong>
            <br />
            Guardalo — con eso y la contraseña que elegiste vas a poder entrar una vez que activemos tu cuenta.
          </p>
          <button
            className="inline-flex items-center justify-center rounded-xl border border-emerald-400/50 bg-white/10 px-6 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
            onClick={() => setOk(false)}
          >
            Enviar otra solicitud
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200/40 bg-white/80 p-8 shadow-[0_45px_80px_-45px_rgba(15,23,42,0.6)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.12),_transparent_60%)]" />
      <div className="relative space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-300/60 bg-white/60 px-4 py-2 text-xs font-medium uppercase tracking-[0.3em] text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
            Nuevo cliente
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Quiero ser cliente</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
              Completá el formulario y te contactamos con un plan personalizado.
            </p>
          </div>
          <dl className="grid gap-3 text-xs text-slate-500 dark:text-neutral-400 sm:grid-cols-3">
            {[{ label: "Tiempo de respuesta", value: "< 24 hs" }, { label: "Cobertura", value: "Todo el país" }, { label: "Canales", value: "Tienda + Mayorista" }].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200/70 bg-white/50 px-4 py-3 shadow-inner dark:border-neutral-700 dark:bg-neutral-800/60">
                <dt className="font-medium text-slate-700 dark:text-neutral-300">{item.label}</dt>
                <dd className="mt-1 text-slate-500 dark:text-neutral-400">{item.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <form onSubmit={onSubmit} className="space-y-6" aria-busy={loading}>
          {error && (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-50/80 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label="Tu Nombre y Apellido"
              name="nombre"
              required
              value={form.nombre}
              onChange={onChange}
            />
            <Field
              label="Elegí una contraseña"
              name="password"
              type="password"
              required
              value={form.password}
              onChange={onChange}
              helper="Mínimo 6 caracteres. La vas a usar para entrar una vez que activemos tu cuenta."
            />
          </div>

          <Field
            label="Celular"
            name="celular"
            required
            value={form.celular}
            onChange={onChange}
            inputMode="numeric"
            helper="Con código de área, sin el 0 y sin el 15. Ej: 3624-4568923."
          />

          <Field
            label="Correo electrónico"
            type="email"
            name="email"
            required
            value={form.email}
            onChange={onChange}
          />

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Empresa" name="empresa" value={form.empresa} onChange={onChange} />
            <div className="space-y-2 text-sm">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                CUIT <span className="ml-1 text-rose-500">*</span>
              </label>
              <input
                name="cuit"
                value={form.cuit}
                onChange={onChange}
                onBlur={onCuitBlur}
                required
                placeholder="XX-XXXXXXXX-X"
                inputMode="numeric"
                className={`w-full rounded-xl border bg-white/80 px-4 py-2.5 text-sm text-slate-700 shadow-inner outline-none transition focus:ring-2 dark:bg-neutral-800 dark:text-white ${
                  cuitError
                    ? "border-rose-400 focus:border-rose-400 focus:ring-rose-400/40"
                    : "border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/40 dark:border-neutral-700"
                }`}
              />
              {cuitError && <p className="text-xs text-rose-500">{cuitError}</p>}
              <p className="text-xs text-slate-400 dark:text-neutral-500">Ingresá el CUIT de la empresa o persona física.</p>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Provincia" name="provincia" value={form.provincia} onChange={onChange} />
            <Field label="Localidad" name="localidad" value={form.localidad} onChange={onChange} />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <SelectField
              label="Rubro"
              name="rubro"
              value={form.rubro}
              onChange={onChange}
              options={[
                { value: "", label: "Seleccioná una opción" },
                { value: "tienda", label: "Tienda de bicis" },
                { value: "taller", label: "Taller" },
                { value: "distribuidor", label: "Distribuidor" },
                { value: "otro", label: "Otro" },
              ]}
            />
            <Field
              as="textarea"
              label="Mensaje"
              name="mensaje"
              rows={4}
              value={form.mensaje}
              onChange={onChange}
            />
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/60 px-4 py-3 text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300">
            <input
              type="checkbox"
              id="acepta"
              name="acepta"
              checked={form.acepta}
              onChange={onChange}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 dark:border-neutral-600 dark:bg-neutral-800"
            />
            <span>
              Acepto la política de privacidad y el tratamiento de mis datos.
            </span>
          </label>

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Respondemos todas las solicitudes con seguimiento personalizado.
            </p>
            <button
              type="submit"
              disabled={loading || !!cuitError}
              className="inline-flex min-w-[180px] items-center justify-center rounded-xl bg-gradient-to-r from-slate-900 via-indigo-900 to-sky-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/40 transition focus:outline-none focus:ring-2 focus:ring-indigo-400/60 disabled:opacity-60"
            >
              <BusyButtonContent busy={loading} busyLabel="Enviando…" label="Enviar solicitud" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, helper, children, as = "input", required: isRequired, ...props }) {
  const Component = as;
  const inputClassName = "w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-2.5 text-sm text-slate-700 shadow-inner outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white";
  return (
    <div className="space-y-2 text-sm">
      <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
        {label}
        {isRequired && <span className="ml-1 text-rose-500">*</span>}
      </label>
      <Component className={inputClassName} required={isRequired} {...props}>{children}</Component>
      {helper && <p className="text-xs text-slate-400 dark:text-neutral-500">{helper}</p>}
    </div>
  );
}

function SelectField({ label, options, ...props }) {
  return (
    <Field label={label} as="select" {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Field>
  );
}
