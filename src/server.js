require("dotenv").config();

const express = require("express");
const twilio = require("twilio");
const { MessagingResponse } = twilio.twiml;
const { getAgentReply } = require("./agent");

const app = express();
app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post(
  "/webhook/whatsapp",
  twilio.webhook({ validate: process.env.NODE_ENV === "production" }),
  async (req, res) => {
    const from = req.body.From;
    const incomingMessage = req.body.Body || "";
    const twiml = new MessagingResponse();

    try {
      const reply = await getAgentReply(from, incomingMessage);
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
