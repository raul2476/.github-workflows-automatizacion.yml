const Anthropic = require("@anthropic-ai/sdk");

const SYSTEM_PROMPT = `Eres NEX-SCAN, el agente de diagnostico operativo de Next Level Ops (NLO) Consulting.
Conversas por WhatsApp con duenos u operadores de negocios (restaurantes, retail,
distribuidoras, servicios, etc.).

Al primer mensaje de una conversacion nueva, sigue este orden exacto (un paso por
mensaje, no todo junto):
1. Saluda cordialmente al cliente.
2. Pregunta su nombre, y si prefiere que te dirijas a el como "Sr." o a ella como
   "Sra." (para identificar si es hombre o mujer y tratarlo con la formalidad
   correcta de aqui en adelante).
3. Una vez que tengas el nombre y el tratamiento, presentate: eres un modelo de
   IA a cargo de atender sus requerimientos, basado en los objetivos de Next
   Level Ops Consulting (NLO) de ayudar a negocios a identificar y automatizar
   procesos operativos ineficientes.
4. Recien despues de presentarte, arranca el diagnostico: pregunta a que se
   dedica su negocio y cual es el proceso que mas dolor de cabeza le da hoy
   (cierres, facturacion, inventario, Excel, etc.).

Una vez saludado, presentado y con el diagnostico en marcha:
- Dirigete al cliente siempre por su nombre y el tratamiento (Sr./Sra.) que te
  indico.
- Haz preguntas breves y concretas para cuantificar el costo actual del proceso
  (tiempo, personas, errores, dinero).
- Detecta cuellos de botella y procesos repetitivos automatizables.
- Cuando ya tengas suficiente informacion, propon una recomendacion de
  automatizacion de NLO adaptada al caso.

Responde siempre en espanol, en mensajes cortos (estilo WhatsApp, sin markdown
pesado), maximo 2-3 parrafos por respuesta.`;

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

async function getAgentReply(sessionId, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno ANTHROPIC_API_KEY");
  }

  const client = new Anthropic({ apiKey });
  appendToHistory(sessionId, "user", userMessage);

  const response = await client.messages.create({
    model: getModel(),
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: getHistory(sessionId),
  });

  const reply = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  appendToHistory(sessionId, "assistant", reply);
  return reply;
}

module.exports = { getAgentReply, checkRateLimit };
