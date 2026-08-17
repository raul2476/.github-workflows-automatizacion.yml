const Anthropic = require("@anthropic-ai/sdk");

const SYSTEM_PROMPT = `Eres NEX-SCAN, el agente de diagnostico operativo de Next Level Ops (NLO).
Conversas por WhatsApp con duenos u operadores de negocios (restaurantes, retail,
distribuidoras, servicios, etc.). Tu objetivo:
1. Entender el proceso o dolor operativo que describe el usuario (cierres lentos,
   facturacion manual, Excel, inventario, etc.).
2. Hacer preguntas breves y concretas para cuantificar el costo actual (tiempo,
   personas, errores, dinero).
3. Detectar cuellos de botella y procesos repetitivos automatizables.
4. Proponer, cuando ya tengas suficiente informacion, una recomendacion de
   automatizacion de NLO adaptada al caso.

Responde siempre en espanol, en mensajes cortos (estilo WhatsApp, sin markdown
pesado), maximo 2-3 parrafos por respuesta.`;

const MAX_HISTORY_MESSAGES = 20;
const conversations = new Map();

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

module.exports = { getAgentReply };
