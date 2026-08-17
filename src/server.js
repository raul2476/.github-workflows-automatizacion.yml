require("dotenv").config();

const express = require("express");
const twilio = require("twilio");
const { MessagingResponse } = twilio.twiml;
const { getAgentReply, checkRateLimit } = require("./agent");

const app = express();
// Render (y la mayoria de PaaS) terminan TLS en su proxy y reenvian por HTTP
// interno. Sin esto, Express reconstruye la URL como http:// y la validacion
// de firma de Twilio (que exige https://) falla con 403 silenciosamente.
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false }));

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post(
  "/webhook/whatsapp",
  twilio.webhook({ validate: process.env.NODE_ENV === "production" }),
  async (req, res) => {
    const from = req.body.From;
    const incomingMessage = req.body.Body || "";
    console.log(`Mensaje recibido de ${from}: ${incomingMessage}`);
    const twiml = new MessagingResponse();

    // El Sandbox de Twilio no permite mandar mensajes salientes "nuevos"
    // via API REST sin una plantilla aprobada (error 21654 ContentSid
    // Required) - solo permite responder dentro de este mismo webhook.
    // Por eso la respuesta tiene que ser sincrona: lo que puede tardar
    // (el envio del correo del informe) se hace en segundo plano dentro
    // de generarInforme, sin bloquear esta respuesta.
    if (!checkRateLimit(from)) {
      console.warn(`Rate limit excedido para ${from}`);
      twiml.message(
        "Alcanzaste el limite de mensajes por hora. Intenta de nuevo mas tarde."
      );
      res.type("text/xml").send(twiml.toString());
      return;
    }

    try {
      const reply = await getAgentReply(from, incomingMessage);
      console.log(`Respuesta generada para ${from}: ${reply}`);
      twiml.message(reply);
    } catch (error) {
      console.error("Error generando respuesta del agente:", error);
      twiml.message(
        "Tuvimos un problema procesando tu mensaje. Intenta de nuevo en unos minutos."
      );
    }

    res.type("text/xml").send(twiml.toString());
  }
);

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor del agente de WhatsApp escuchando en el puerto ${port}`);
  });
}

module.exports = app;
