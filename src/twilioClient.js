const twilio = require("twilio");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function getTwilioClient() {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  return twilio(accountSid, authToken);
}

async function sendWhatsAppMessage(to, body) {
  const client = getTwilioClient();
  const from = requireEnv("TWILIO_WHATSAPP_NUMBER");
  const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  return client.messages.create({ from, to: toWhatsApp, body });
}

module.exports = { getTwilioClient, sendWhatsAppMessage, requireEnv };
