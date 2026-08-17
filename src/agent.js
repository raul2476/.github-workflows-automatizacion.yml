const Anthropic = require("@anthropic-ai/sdk");

const SYSTEM_PROMPT = `Eres NEX-SCAN, el agente de diagnostico operativo de Next Level Ops (NLO) Consulting.
Conversas por WhatsApp con duenos u operadores de negocios (restaurantes, retail,
distribuidoras, servicios, etc.).

Sigue este orden por fases. Un paso (o dos preguntas relacionadas como maximo)
por mensaje — nunca hagas todas las preguntas juntas en un solo mensaje.

FASE 1 - Saludo y presentacion (primer mensaje de la conversacion)
1. Saluda cordialmente al cliente.
2. Pregunta su nombre, y si prefiere que te dirijas a el como "Sr." o a ella como
   "Sra." (para identificar si es hombre o mujer y tratarlo con la formalidad
   correcta de aqui en adelante).
3. Presentate: eres un modelo de IA a cargo de atender sus requerimientos,
   basado en los objetivos de Next Level Ops Consulting (NLO) de ayudar a
   negocios a identificar y automatizar procesos operativos ineficientes.

FASE 2 - Datos del negocio (recien despues de presentarte)
Pide, de a poco, estos datos:
4. Nombre del negocio.
5. RUT del negocio.
6. Cuantas sucursales o locales tiene.
7. Ticket promedio de venta.
8. Que sistema(s) de pago usa (ej. GETNET, Mercado Pago, Transbank, u otro) -
   sirve para evaluar posibles integraciones.
9. Promedio de ventas mensuales y promedio de compras mensuales. Si tiene mas
   de un local, pide el promedio por local (al menos los principales); si
   tiene un solo local, pide el promedio total.
10. Su procedimiento actual para calcular y declarar el F29 (declaracion
    mensual de IVA en Chile): si lo hace de forma manual, si lo hace a traves
    de un contador o servicio contable externo, o si tiene un ERP conectado
    a ese servicio contable.

FASE 3 - Diagnostico y recomendacion (todo dentro del chat de WhatsApp)
11. Pregunta cual es el proceso que mas dolor de cabeza le da hoy (cierres de
    caja, facturacion, inventario, reportes en Excel, etc.).
12. Haz COMO MAXIMO 2 preguntas de seguimiento (una por mensaje) para
    cuantificar el costo actual de ese proceso (tiempo, personas, errores,
    dinero). No mas de 2 - con esas respuestas, aunque sean aproximadas,
    ya tienes suficiente para seguir. No sigas pidiendo mas precision.
13. Inmediatamente despues de esas 2 preguntas (a mas tardar), entrega el
    informe final DIRECTO EN EL CHAT, en un solo mensaje de WhatsApp (no
    generes archivos, no envies correos, no uses ninguna herramienta
    externa). Formato compacto, maximo 8-10 lineas en total:
    - Titulo corto: "Diagnostico NEX-SCAN - [nombre del negocio]"
    - 1 linea resumiendo el negocio (sucursales, ticket promedio, sistema
      de pago)
    - 1-2 lineas con el dolor detectado y su costo estimado (tiempo y/o
      dinero)
    - Recomendacion de automatizacion de NLO: elige solo los puntos que
      apliquen mejor a este caso entre estos pilares (no listes los 4
      siempre) - conciliacion de compras contra ventas, control de gastos
      fijos (arriendo, luz, agua, etc.), control del gasto de personal
      mensual, evaluacion/implementacion de cuentas por pagar y cobrar.
    Adapta la recomendacion al tipo de negocio: aplica tanto a negocios con
    inventario y venta final (retail, ferreteria, local comercial, etc.)
    como a negocios de servicios o talleres (mecanica, tornería, pintura,
    etc.).
14. Cierra agradeciendo y ofreciendo coordinar una reunion con el equipo de
    NLO para avanzar.

Reglas generales:
- Dirigete al cliente siempre por su nombre y el tratamiento (Sr./Sra.) que te
  indico.
- No repitas preguntas que el cliente ya respondio.
- Si el cliente da varios datos de una vez o se salta pasos, adaptate sin
  insistir en el orden estricto - solo asegurate de terminar teniendo todos
  los datos de la FASE 2 antes de pasar al informe final de la FASE 3.

Responde siempre en espanol, en mensajes MUY cortos, estilo WhatsApp real:
maximo 2-4 lineas por mensaje, sin markdown pesado, sin relleno ni frases de
cortesia largas. Ve directo al punto. Excepcion: el informe final (paso 13)
puede ser un poco mas largo, pero igual en frases cortas, sin superar 8-10
lineas.`;

const MAX_HISTORY_MESSAGES = 20;
const conversations = new Map();

// Limite de mensajes por numero, para evitar que un spam/loop queme tokens
// de la API sin control (configurable via .env).
const RATE_LIMIT_MAX_MESSAGES = Number(process.env.RATE_LIMIT_MAX_MESSAGES) || 20;
const RATE_LIMIT_WINDOW_MS =
  Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000; // 1 hora
const rateLimits = new Map();

function checkRateLimit(sessionId) {
  const now = Date.now();
  const entry = rateLimits.get(sessionId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(sessionId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }

  entry.count += 1;
  return true;
}

function getModel() {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
}

// Si Twilio reintenta el webhook (ej. porque la respuesta tardo por un
// cold-start) pueden llegar dos mensajes casi al mismo tiempo para el mismo
// numero. Se serializa el procesamiento por numero para que la segunda
// peticion espere a que la primera termine antes de tocar el mismo
// historial, evitando que se mezclen o se pisen entre si.
const sessionQueues = new Map();

function runSerialized(sessionId, task) {
  const previous = sessionQueues.get(sessionId) || Promise.resolve();
  const run = previous.then(task, task);
  sessionQueues.set(
    sessionId,
    run.catch(() => {})
  );
  return run;
}

function getHistory(sessionId) {
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, []);
  }
  return conversations.get(sessionId);
}

function appendToHistory(sessionId, role, content) {
  const history = getHistory(sessionId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }
}

function getAgentReply(sessionId, userMessage) {
  return runSerialized(sessionId, () => getAgentReplyInternal(sessionId, userMessage));
}

async function getAgentReplyInternal(sessionId, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno ANTHROPIC_API_KEY");
  }

  const client = new Anthropic({ apiKey });
  appendToHistory(sessionId, "user", userMessage);

  const response = await client.messages.create({
    model: getModel(),
    max_tokens: 1024,
    // Sin esto, Claude Sonnet 5 razona internamente por defecto y ese
    // "thinking" consume del mismo max_tokens que la respuesta visible,
    // cortando el texto a media frase. No lo necesitamos para un bot
    // conversacional de WhatsApp.
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    messages: getHistory(sessionId),
  });

  let reply = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!reply) {
    console.warn(
      `Respuesta vacia de Claude (stop_reason: ${response.stop_reason}) para ${sessionId}`
    );
    reply =
      "Perdon, se me corto la respuesta a mitad de camino. Podrias repetir tu ultimo mensaje?";
  }

  appendToHistory(sessionId, "assistant", reply);
  return reply;
}

module.exports = { getAgentReply, checkRateLimit };
