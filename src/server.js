require("dotenv").config();

const express = require("express");
const twilio = require("twilio");
const { MessagingResponse } = twilio.twiml;
const { getAgentReply, checkRateLimit } = require("./agent");
const { sendWhatsAppMessage } = require("./twilioClient");

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
  (req, res) => {
    const from = req.body.From;
    const incomingMessage = req.body.Body || "";
    console.log(`Mensaje recibido de ${from}: ${incomingMessage}`);

    // Twilio espera la respuesta del webhook en pocos segundos. En vez de
    // depender de ese timeout, se confirma de inmediato con un TwiML vacio
    // y la respuesta real (que puede tardar por Claude, el envio del
    // informe, etc.) se manda despues via la API REST de Twilio, sin
    // presion de tiempo.
    res.type("text/xml").send(new MessagingResponse().toString());

    if (!checkRateLimit(from)) {
      console.warn(`Rate limit excedido para ${from}`);
      sendWhatsAppMessage(
        from,
        "Alcanzaste el limite de mensajes por hora. Intenta de nuevo mas tarde."
      ).catch((err) => console.error("Error enviando aviso de rate limit:", err));
      return;
    }

    getAgentReply(from, incomingMessage)
      .then((reply) => {
        console.log(`Respuesta generada para ${from}: ${reply}`);
        return sendWhatsAppMessage(from, reply);
      })
      .catch((error) => {
        console.error("Error generando respuesta del agente:", error);
        return sendWhatsAppMessage(
          from,
          "Tuvimos un problema procesando tu mensaje. Intenta de nuevo en unos minutos."
        ).catch((err) => console.error("Error enviando mensaje de error:", err));
      });
  }
);

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor del agente de WhatsApp escuchando en el puerto ${port}`);
  });
}

module.exports = app;
