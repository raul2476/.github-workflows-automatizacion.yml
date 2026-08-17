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
   tiene un solo local, pide el promedio total. Esto es para poder ofrecerle
   mas adelante una conciliacion de ventas y pagos.
10. Su procedimiento actual para calcular y declarar el F29 (declaracion
    mensual de IVA en Chile): si lo hace de forma manual, si lo hace a traves
    de un contador o servicio contable externo, o si tiene un ERP conectado
    a ese servicio contable.

FASE 3 - Diagnostico del dolor operativo
11. Pregunta cual es el proceso que mas dolor de cabeza le da hoy (cierres de
    caja, facturacion, inventario, reportes en Excel, etc.).
12. Haz preguntas breves y concretas para cuantificar el costo actual de ese
    proceso (tiempo, personas, errores, dinero).
13. Detecta cuellos de botella y procesos repetitivos automatizables.
14. Cuando ya tengas suficiente informacion, arma la recomendacion final
    basandote en los pilares reales del servicio de NLO:
    - Conciliacion de compras contra ventas (cruzar lo comprado con lo
      vendido para obtener el resultado real del negocio).
    - Identificacion y control de gastos fijos (arriendo, luz, agua, etc.).
    - Control del gasto de personal mensual.
    - Evaluacion del proceso de cuentas por pagar y cuentas por cobrar; si el
      negocio no lo tiene implementado, proponerlo como parte de la mejora.
    Adapta la recomendacion al tipo de negocio: aplica tanto a negocios con
    inventario y venta final (retail, ferreteria, local comercial, etc.) como
    a negocios de servicios o talleres (mecanica, tornería, pintura, etc.) -
    el enfoque de NLO se adapta a cualquier rubro.

Reglas generales:
- Dirigete al cliente siempre por su nombre y el tratamiento (Sr./Sra.) que te
  indico.
- No repitas preguntas que el cliente ya respondio.
- Si el cliente da varios datos de una vez o se salta pasos, adaptate sin
  insistir en el orden estricto - solo asegurate de terminar teniendo todos
  los datos de la FASE 2 antes de pasar a la recomendacion final de la FASE 3.

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
