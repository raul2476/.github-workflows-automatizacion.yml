require("dotenv").config();

const { sendWhatsAppMessage } = require("../src/twilioClient");

async function main() {
  const to = process.env.TEST_TO_NUMBER || process.argv[2];
  const body =
    process.env.TEST_MESSAGE ||
    process.argv[3] ||
    "Hola, soy NEX-SCAN, el agente de Next Level Ops. Este es un mensaje de prueba.";

  if (!to) {
    console.error(
      "Debes indicar el numero destino (TEST_TO_NUMBER o primer argumento), formato E.164, ej: +56912345678"
    );
    process.exit(1);
  }

  const message = await sendWhatsAppMessage(to, body);
  console.log(`Mensaje enviado. SID: ${message.sid}, status: ${message.status}`);
}

main().catch((error) => {
  console.error("Error enviando el mensaje de prueba:", error);
  process.exit(1);
});
