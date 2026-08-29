import { useEffect, useState } from "react";

const STORAGE_KEY = "crm_scripts";

const SCRIPTS_DEFAULT = [
  {
    key: "apertura",
    label: "1. Apertura",
    cliente: "",
    texto:
      "Hola, ¿qué tal? Hablo con [Nombre del dueño/encargado]?\n\nQué tal, [Nombre], te saluda [Nombre del vendedor] de las marcas Samurai. Te llamaba cinco minutos porque estamos expandiendo nuestra red de distribución oficial en tu zona.\n\nVi tu local, sé que trabajás muy bien el rubro, y nosotros nos dedicamos exclusivamente a abastecer a bicicleterías con stock real, sin competirles nunca al público.\n\n¿Cómo te trata la temporada por allá?",
    tips: "💡 El objetivo no es vender la bici en el segundo uno: es generar confianza, detectar quién decide y marcar la cancha con el valor mayorista. Escuchá la respuesta sobre la temporada antes de seguir.",
  },
  {
    key: "presentacion",
    label: "2. Presentación",
    cliente: "",
    texto:
      "[Nombre], te cuento brevemente cómo trabajamos porque nuestro foco es ser socios de tu negocio, no clavarte con mercadería. Nosotros manejamos la línea Samurai: son bicicletas con una estética impecable, entran por los ojos y salen rápido del mostrador, que es lo que hoy buscás.\n\nPero lo fuerte nuestro es el servicio detrás:\n\n🔒 Cero competencia: No le vendemos jamás al consumidor final. Ahora que con el Hot Sale ves a todos los importadores reventando precios al público al mismo valor que te venden a vos, nosotros te protegemos el margen.\n\n📍 Exclusividad de zona: Si armamos la cuenta con vos, respetamos tu radio. No le abrimos la marca a tu competencia de la vuelta.\n\n🚚 Logística bonificada: Te la dejamos puesta en la puerta de tu local sin costo de envío (cubrimos casi todo el país por la ruta de Credifin).",
    tips: "💡 Pausá después de cada punto clave. Si el cliente interrumpe con una objeción, es buena señal: está escuchando. No atropelles, dejá que procese.",
  },
  {
    key: "obj-mostrador",
    label: "Obj. A — Mostrador parado",
    cliente: '❌ "No estoy vendiendo nada, el mostrador está parado, no voy a reponer."',
    texto:
      "Te entiendo perfectamente, [Nombre], el consumo en general bajó y es la realidad de todos hoy. Justamente por eso te llamo.\n\nCuando el mostrador está más tranquilo, el secreto no es dejar vacía la bicicletería —porque el cliente que entra ve siempre lo mismo y se va—, sino rotar con productos que llamen la atención por estética y precio, y que no te saquen liquidez.\n\nNosotros te resolvemos eso: te mandamos las bicis con envío gratis para que no gastes un peso de flete, y te doy plazos con cheques a 30, 60, 90 y hasta 120 días según el volumen. Básicamente, ponés las bicis en la vidriera, las vendés, y después las pagás.\n\n¿Qué modelos te están faltando hoy para darle movimiento a la entrada?",
    tips: "💡 Estrategia: Rotación + Financiamiento. No vendas la bici, vendé el flujo de caja positivo. El cierre de la objeción es una pregunta que abre la conversación sobre modelos.",
  },
  {
    key: "obj-stock",
    label: "Obj. B — Ya tengo stock",
    cliente: '❌ "Ya tengo cubierto el stock con otras marcas (Topmega, Volta, etc.)."',
    texto:
      "Buenísimo que estés stockeado, habla muy bien de tu negocio. Esas son marcas instaladas, pero hoy tenés un problema con la mayoría de ellas: te compiten directo al público en la web o te abren una cuenta en la otra cuadra y te canibalizan el precio.\n\nLo que te propongo con Samurai no es que dejes lo que tenés, sino que sumes una alternativa de alta rotación donde vos manejás el precio y tenés la zona asegurada.\n\nSi vos me comprás a mí, tu competencia no va a tener la misma bici para reventarte el margen.\n\n¿Te sirve que te mande el catálogo digital para que veas las estéticas y compares?",
    tips: "💡 Estrategia: Exclusividad y cuidado del margen. No ataques las marcas que ya tiene. El diferencial es la zona protegida y que no competimos al público.",
  },
  {
    key: "obj-flete",
    label: "Obj. C — Flete caro",
    cliente: '❌ "El flete al interior me mata el costo, prefiero comprar en mi provincia."',
    texto:
      "Olvidate de eso, ese costo corre por nuestra cuenta. Nosotros tenemos envío gratuito a casi todo el país a través de la ruta de Credifin.\n\nLa bici te llega a la puerta de tu local y el renglón de flete en tu costo es cero. El precio de lista que ves es el precio final puesta en tu negocio.\n\n¿En qué zona exacta estás así te confirmo la frecuencia de entrega?",
    tips: "💡 Derribá el costo logístico de inmediato y cerrá con una pregunta que confirme la zona. Eso te da info para la siguiente llamada y muestra que tenés sistema real de distribución.",
  },
  {
    key: "cierre",
    label: "4. Cierre",
    cliente: "",
    texto:
      "Bueno [Nombre], para arrancar y que pruebes cómo responden las marcas en tu vidriera, armemos un pedido inicial chico con los modelos que más están saliendo (por ejemplo, Gozen o Shonen).\n\nComo queremos que veas que somos socios flexibles, te puedo abrir la jugada con la financiación: lo armamos con pago combinado o me estiro a los cheques a 30 y 60 días para que calces el pago con las ventas del mes.\n\n¿Te armo la nota de pedido con 5 o con 10 unidades para aprovechar el camión de esta semana?",
    tips: '💡 Ofrecé dos opciones concretas (5 o 10 unidades), nunca preguntes "¿querés comprar?" — eso cierra la puerta. El foco es que elija entre dos versiones del sí.',
  },
  {
    key: "video-recordatorio",
    label: "5. Video — Recordatorio general",
    cliente: "",
    texto:
      "Hola buenos días! Soy Ezequiel de Samurai y les escribo para pedirles si por favor pueden revisar el vencimiento de los videos publicados para poder avanzar con el control de stock. También aprovecho para comentarles que es de suma importancia que graben los videos de forma que podamos visualizar y contabilizar las unidades ya sea con o sin caja. Es ideal que sea pausado y que vayan marcando una a una a medida que filman. El primer video estuvo perfecto! De esta forma nos evitamos tener que hacer llamado y que el procedimiento sea mas engorroso. De ser posible hoy y mañana aguardamos los nuevos videos. Quedo a disposición para cualquier consulta adicional. saludos!!",
    tips: "💡 Mensaje base para el recordatorio periódico de auditoría (cada 10 días). Usalo con quien ya viene grabando bien pero se le venció el plazo.",
  },
  {
    key: "video-nunca-grabo",
    label: "6. Video — Nunca grabó ninguno",
    cliente: '⚠️ El cliente todavía no subió ningún video de auditoría.',
    texto:
      "Hola [Nombre], buenos días! Soy Ezequiel de Samurai. Te escribo porque vimos que todavía no se registró ningún video de auditoría de stock de tu cuenta.\n\nEs un paso simple: entrás a tu cuenta de Samurai, vas a \"Mi Stock\" y tocás el botón \"🎥 Grabar video\". Ahí filmás pausado todas las bicicletas que tenés consignadas, tanto las que están en caja como las que están armadas o fuera de caja, marcándolas una por una a medida que filmás.\n\nEsto nos permite mantener al día el control de stock entre las dos partes y evitar diferencias más adelante. Te pido que lo hagas a la brevedad, hoy o mañana si es posible.\n\nCualquier duda con el paso a paso, quedo a disposición. Saludos!!",
    tips: "💡 Primer contacto con alguien que nunca grabó nada — explicá el paso a paso completo, no asumas que sabe usar el botón.",
  },
  {
    key: "video-faltan-sin-caja",
    label: "7. Video — Grabó cajas, faltan sin caja",
    cliente: '⚠️ Grabó las bicicletas en caja pero no las armadas/fuera de caja (o viceversa).',
    texto:
      "Hola [Nombre], buenos días! Soy Ezequiel de Samurai. Te comento que recibimos tu video, pero nos faltó ver las bicicletas que tenés armadas o fuera de la caja — solo se filmaron las que están todavía embaladas.\n\nPara que la auditoría quede completa necesitamos ver el 100% del stock consignado en un mismo video: las que están en caja y también las que están exhibidas o armadas en el local. Te pido que grabes de nuevo mostrando todas, pausado y marcando una por una a medida que las filmás.\n\nAsí evitamos ida y vuelta y dejamos el conteo cerrado de una sola vez. Aguardamos el nuevo video a la brevedad. Cualquier consulta, quedo a disposición. Saludos!!",
    tips: "💡 Para cuando el video llegó incompleto (falta una de las dos categorías: en caja / fuera de caja). Sé específico sobre qué faltó.",
  },
  {
    key: "video-faltan-en-caja",
    label: "7b. Video — Grabó armadas, faltan en caja",
    cliente: '⚠️ Grabó las bicicletas armadas/fuera de caja pero no las que están todavía en caja.',
    texto:
      "Hola [Nombre], buenos días! Soy Ezequiel de Samurai. Te comento que recibimos tu video, pero nos faltó ver las bicicletas que tenés todavía en caja — solo se filmaron las que están armadas o exhibidas.\n\nPara que la auditoría quede completa necesitamos ver el 100% del stock consignado en un mismo video: las que están armadas/fuera de caja y también las que siguen embaladas. Te pido que grabes de nuevo mostrando todas, pausado y marcando una por una a medida que las filmás — con las que están en caja alcanza con que muestres la cantidad de cajas, no hace falta abrirlas.\n\nAsí evitamos ida y vuelta y dejamos el conteo cerrado de una sola vez. Aguardamos el nuevo video a la brevedad. Cualquier consulta, quedo a disposición. Saludos!!",
    tips: "💡 Es el caso inverso al anterior: faltaron las que están en caja. Aclaración clave: no hace falta abrir las cajas, solo mostrarlas y contarlas.",
  },
  {
    key: "video-vencido-insistencia",
    label: "8. Video — Vencido hace tiempo (insistencia)",
    cliente: '🚨 Ya se le recordó antes y sigue sin grabar — segundo o tercer aviso.',
    texto:
      "Hola [Nombre], buenos días! Soy Ezequiel de Samurai. Te escribo nuevamente porque la auditoría de stock de tu cuenta sigue vencida y todavía no recibimos el video actualizado, a pesar del aviso anterior.\n\nEste control es fundamental para que ambos tengamos la misma información sobre las unidades consignadas, así que te pido por favor que lo resuelvas hoy mismo desde \"Mi Stock\" → \"🎥 Grabar video\", mostrando pausado y una por una todas las bicicletas, con o sin caja.\n\nQueremos evitar tener que gestionar esto por otra vía, así que agradecemos que puedas darle prioridad en el día de hoy. Ante cualquier inconveniente para grabarlo, avisanos y te ayudamos. Saludos!!",
    tips: "💡 Tono más firme, para segundo/tercer recordatorio sin respuesta. Sin ser agresivo, deja claro que es urgente y que hay una instancia previa.",
  },
  {
    key: "video-mala-calidad",
    label: "9. Video — Mala calidad / no se puede contar",
    cliente: '⚠️ El video llegó pero está borroso, muy rápido, o no se pueden contar las unidades.',
    texto:
      "Hola [Nombre], buenos días! Soy Ezequiel de Samurai. Recibimos tu video, pero no pudimos contabilizar bien las unidades porque quedó muy rápido / borroso (el detalle depende del caso).\n\nTe pido si podés grabar uno nuevo yendo bicicleta por bicicleta, deteniéndote un segundo en cada una y, si podés, nombrando el modelo en voz alta o marcándola con la mano a medida que la filmás. Así nos aseguramos de que se vea clarito cada unidad, con y sin caja.\n\nEl primer video que nos mandaste en su momento estuvo perfecto, ¡buscamos que todos queden así de claros! Aguardamos el nuevo cuando puedas. Cualquier duda, quedo a disposición. Saludos!!",
    tips: "💡 Para cuando el video en sí llegó pero no sirve para contar (calidad, velocidad, encuadre). Reforzá con el ejemplo del \"primer video perfecto\" para dar una referencia concreta.",
  },
];

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function Scripts() {
  const [activo, setActivo] = useState(SCRIPTS_DEFAULT[0].key);
  const [copiado, setCopiado] = useState(false);
  const [overrides, setOverrides] = useState(loadOverrides);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ cliente: "", texto: "", tips: "" });

  const base = SCRIPTS_DEFAULT.find((s) => s.key === activo);
  const script = { ...base, ...(overrides[activo] || {}) };

  useEffect(() => {
    setEditando(false);
  }, [activo]);

  function copiar() {
    navigator.clipboard.writeText(script.texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  function abrirEditor() {
    setForm({ cliente: script.cliente || "", texto: script.texto || "", tips: script.tips || "" });
    setEditando(true);
  }

  function guardar() {
    const next = { ...overrides, [activo]: { label: base.label, ...form } };
    setOverrides(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setEditando(false);
  }

  function restaurarOriginal() {
    const next = { ...overrides };
    delete next[activo];
    setOverrides(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setEditando(false);
  }

  const tieneEdicion = Boolean(overrides[activo]);

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-1.5">
        {SCRIPTS_DEFAULT.map((s) => (
          <button
            key={s.key}
            onClick={() => setActivo(s.key)}
            className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
              activo === s.key
                ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-600"
            }`}
          >
            {s.label}
            {overrides[s.key] && <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">✏️</span>}
          </button>
        ))}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
        {!editando ? (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">{base.label}</h3>
              <button onClick={abrirEditor} title="Editar mensaje" className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:border-sky-400 hover:text-slate-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-sky-700 dark:hover:text-white">
                ✏️ Editar
              </button>
            </div>
            {script.cliente && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:border dark:border-rose-900 dark:text-rose-400">{script.cliente}</p>}
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-neutral-300">{script.texto}</p>
            {script.tips && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:border dark:border-amber-900 dark:text-amber-400">{script.tips}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={copiar} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-neutral-800 dark:hover:bg-neutral-700">
                {copiado ? "✅ Copiado" : "📋 Copiar texto"}
              </button>
              {tieneEdicion && (
                <button onClick={restaurarOriginal} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-rose-800 dark:hover:text-rose-400">
                  Restaurar original
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white">Editando: {base.label}</h3>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-slate-400 dark:text-neutral-500">Frase del cliente (objeción, opcional)</label>
              <input
                value={form.cliente}
                onChange={(e) => setForm((f) => ({ ...f, cliente: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-sky-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-slate-400 dark:text-neutral-500">Mensaje</label>
              <textarea
                value={form.texto}
                onChange={(e) => setForm((f) => ({ ...f, texto: e.target.value }))}
                rows={10}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-sky-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-slate-400 dark:text-neutral-500">Tip (opcional)</label>
              <textarea
                value={form.tips}
                onChange={(e) => setForm((f) => ({ ...f, tips: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-sky-600"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={guardar} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600">
                💾 Guardar
              </button>
              <button onClick={() => setEditando(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
