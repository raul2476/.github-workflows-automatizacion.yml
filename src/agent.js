const Anthropic = require("@anthropic-ai/sdk");
const { crearLeadEnMonday } = require("./mondayClient");

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

FASE 4 - Agendar reunion (solo si el cliente la pide)
15. Si en cualquier momento despues del informe final el cliente pide
    agendar/coordinar una reunion (con o sin fecha/hora especifica), llama
    a la herramienta crear_lead_monday UNA SOLA VEZ con los datos
    disponibles (si no dio fecha/hora, deja ese campo vacio o "por
    confirmar"). Cuando el resultado sea exitoso, confirmale que quedo
    registrado y que el equipo de NLO lo va a contactar para coordinar. Si
    la herramienta falla, disculpate y dile que igual anotaste su pedido y
    el equipo lo va a contactar. NO llames la herramienta si el cliente
    solo pregunta por la reunion sin pedirla explicitamente, y no la
    llames mas de una vez por conversacion salvo que el cliente cambie la
    fecha/hora despues de ya haberla agendado.

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

const TOOLS = [
  {
    name: "crear_lead_monday",
    description:
      "Crea un lead/item en Monday.com. Llamala UNA SOLA VEZ, solo cuando el cliente pide explicitamente agendar o coordinar una reunion (despues de ya haber recibido el informe final).",
    input_schema: {
      type: "object",
      properties: {
        nombre_cliente: { type: "string", description: "Nombre de la persona de contacto" },
        tratamiento: { type: "string", description: "Sr. o Sra." },
        nombre_negocio: { type: "string" },
        rut_negocio: { type: "string" },
        resumen_diagnostico: {
          type: "string",
          description: "Resumen breve del dolor detectado y la recomendacion dada",
        },
        fecha_reunion_solicitada: {
          type: "string",
          description: "Fecha/hora que pidio el cliente, o 'por confirmar' si no dio una",
        },
      },
      required: ["nombre_cliente", "nombre_negocio", "resumen_diagnostico"],
    },
  },
];

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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`Tiempo de espera agotado (${ms}ms)`)), ms)
    ),
  ]);
}

async function runTool(name, input, sessionId) {
  if (name === "crear_lead_monday") {
    try {
      const itemName = `${input.nombre_negocio} - ${input.nombre_cliente}`;
      const notas = [
        `Contacto: ${[input.tratamiento, input.nombre_cliente].filter(Boolean).join(" ")}`,
        `Telefono: ${sessionId}`,
        input.rut_negocio ? `RUT: ${input.rut_negocio}` : null,
        `Reunion solicitada: ${input.fecha_reunion_solicitada || "por confirmar"}`,
        "",
        `Diagnostico: ${input.resumen_diagnostico}`,
      ]
        .filter(Boolean)
        .join("\n");

      const result = await withTimeout(crearLeadEnMonday(itemName, notas), 8000);
      return JSON.stringify({ ok: true, ...result });
    } catch (error) {
      console.error("Error creando lead en Monday:", error);
      return JSON.stringify({
        ok: false,
        error:
          "No se pudo registrar en Monday automaticamente. Avisa al cliente que igual anotaste su pedido y el equipo de NLO lo va a contactar.",
      });
    }
  }
  return JSON.stringify({ ok: false, error: `Herramienta desconocida: ${name}` });
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

  // Sin "thinking: disabled", Claude Sonnet 5 razona internamente por
  // defecto y ese pensamiento consume del mismo max_tokens que la
  // respuesta visible, cortando el texto a media frase.
  const requestOptions = {
    model: getModel(),
    max_tokens: 2048,
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    tools: TOOLS,
  };

  let response = await client.messages.create({
    ...requestOptions,
    messages: getHistory(sessionId),
  });

  while (response.stop_reason === "tool_use") {
    appendToHistory(sessionId, "assistant", response.content);

    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await runTool(block.name, block.input, sessionId);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }
    appendToHistory(sessionId, "user", toolResults);

    response = await client.messages.create({
      ...requestOptions,
      messages: getHistory(sessionId),
    });
  }

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
