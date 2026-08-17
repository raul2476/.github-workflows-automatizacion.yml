const Anthropic = require("@anthropic-ai/sdk");
const { generarInforme } = require("./report");

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
15. Apenas tengas todos los datos de la FASE 2 y la recomendacion final de la
    FASE 3 armada, llama a la herramienta generar_informe_diagnostico con
    toda la informacion recopilada (una sola vez). Cuando el resultado sea
    exitoso, confirmale al cliente que su expediente quedo guardado
    (mencionando el numero de cliente que te devuelva la herramienta) y que
    se envio una copia al contador. Si la herramienta falla, disculpate,
    dile que el equipo de NLO lo va a contactar para completar el expediente
    manualmente, y NO vuelvas a llamar la herramienta en el mismo mensaje.

Reglas generales:
- Dirigete al cliente siempre por su nombre y el tratamiento (Sr./Sra.) que te
  indico.
- No repitas preguntas que el cliente ya respondio.
- Si el cliente da varios datos de una vez o se salta pasos, adaptate sin
  insistir en el orden estricto - solo asegurate de terminar teniendo todos
  los datos de la FASE 2 antes de pasar a la recomendacion final de la FASE 3.

Responde siempre en espanol, en mensajes cortos (estilo WhatsApp, sin markdown
pesado), maximo 2-3 parrafos por respuesta.`;

const TOOLS = [
  {
    name: "generar_informe_diagnostico",
    description:
      "Genera el informe final del diagnostico, crea la carpeta del cliente en Google Drive con el expediente (si Drive esta configurado) y envia una copia por correo al contador. Llamala UNA SOLA VEZ, solo cuando ya completaste la FASE 2 (datos del negocio) y la FASE 3 (diagnostico y recomendacion) y tengas toda la informacion.",
    input_schema: {
      type: "object",
      properties: {
        nombre_cliente: { type: "string", description: "Nombre de la persona de contacto" },
        tratamiento: { type: "string", description: "Sr. o Sra." },
        nombre_negocio: { type: "string" },
        rut_negocio: { type: "string" },
        sucursales: { type: "string", description: "Cantidad de sucursales o locales" },
        ticket_promedio: { type: "string" },
        sistema_pago: { type: "string" },
        ventas_promedio_mensual: { type: "string" },
        compras_promedio_mensual: { type: "string" },
        procedimiento_f29: { type: "string" },
        proceso_dolor: {
          type: "string",
          description: "Proceso operativo con mas dolor de cabeza",
        },
        diagnostico: {
          type: "string",
          description: "Resumen del diagnostico: costo actual, cuellos de botella detectados",
        },
        recomendacion: {
          type: "string",
          description: "Recomendacion final de automatizacion de NLO",
        },
      },
      required: [
        "nombre_cliente",
        "nombre_negocio",
        "rut_negocio",
        "proceso_dolor",
        "diagnostico",
        "recomendacion",
      ],
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

async function runTool(name, input) {
  if (name === "generar_informe_diagnostico") {
    try {
      const result = await generarInforme(input);
      return JSON.stringify({ ok: true, ...result });
    } catch (error) {
      console.error("Error generando informe:", error);
      return JSON.stringify({
        ok: false,
        error:
          "No se pudo generar el informe automaticamente. Avisa al cliente que el equipo de NLO lo va a contactar para completar el expediente.",
      });
    }
  }
  return JSON.stringify({ ok: false, error: `Herramienta desconocida: ${name}` });
}

async function getAgentReply(sessionId, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno ANTHROPIC_API_KEY");
  }

  const client = new Anthropic({ apiKey });
  appendToHistory(sessionId, "user", userMessage);

  let response = await client.messages.create({
    model: getModel(),
    max_tokens: 1024,
    // Sin esto, Claude Sonnet 5 razona internamente por defecto y ese
    // "thinking" consume del mismo max_tokens que la respuesta visible,
    // cortando el texto a media frase. No lo necesitamos para un bot
    // conversacional de WhatsApp.
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: getHistory(sessionId),
  });

  while (response.stop_reason === "tool_use") {
    appendToHistory(sessionId, "assistant", response.content);

    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await runTool(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }
    appendToHistory(sessionId, "user", toolResults);

    response = await client.messages.create({
      model: getModel(),
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: getHistory(sessionId),
    });
  }

  const reply = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  appendToHistory(sessionId, "assistant", reply);
  return reply;
}

module.exports = { getAgentReply, checkRateLimit };
