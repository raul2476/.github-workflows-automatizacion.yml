const nodemailer = require("nodemailer");
const { getDriveClient } = require("./googleClient");

const COUNTER_FILE_NAME = "_contador_clientes.json";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

async function getOrCreateCounterFileId(drive, rootFolderId) {
  const existing = await drive.files.list({
    q: `'${rootFolderId}' in parents and name = '${COUNTER_FILE_NAME}' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: COUNTER_FILE_NAME,
      parents: [rootFolderId],
      mimeType: "application/json",
    },
    media: { mimeType: "application/json", body: JSON.stringify({ ultimo: 0 }) },
    supportsAllDrives: true,
    fields: "id",
  });
  return created.data.id;
}

async function getNextClientNumber(drive, rootFolderId) {
  const fileId = await getOrCreateCounterFileId(drive, rootFolderId);

  const current = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "text" }
  );
  const data =
    typeof current.data === "string" ? JSON.parse(current.data) : current.data;
  const next = (data.ultimo || 0) + 1;

  await drive.files.update({
    fileId,
    media: { mimeType: "application/json", body: JSON.stringify({ ultimo: next }) },
    supportsAllDrives: true,
  });

  return next;
}

function formatClientNumber(n) {
  return `NLO-${String(n).padStart(4, "0")}`;
}

// Mientras Drive no este configurado, el correlativo vive solo en memoria
// (se reinicia si el servidor se reinicia). Se reemplaza por el contador
// persistente en Drive apenas GOOGLE_DRIVE_ROOT_FOLDER_ID este configurado.
let inMemoryClientCounter = 0;
function getNextInMemoryClientNumber() {
  inMemoryClientCounter += 1;
  return inMemoryClientCounter;
}

function isDriveConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  );
}

function buildReportText(data, clientNumber) {
  return `INFORME DE DIAGNOSTICO OPERATIVO - NEX-SCAN / Next Level Ops Consulting
Numero de cliente: ${clientNumber}
Fecha: ${new Date().toLocaleString("es-CL")}

--- Contacto ---
Nombre: ${[data.tratamiento, data.nombre_cliente].filter(Boolean).join(" ")}

--- Datos del negocio ---
Nombre del negocio: ${data.nombre_negocio || ""}
RUT: ${data.rut_negocio || ""}
Sucursales: ${data.sucursales || ""}
Ticket promedio de venta: ${data.ticket_promedio || ""}
Sistema de pago: ${data.sistema_pago || ""}
Ventas promedio mensuales: ${data.ventas_promedio_mensual || ""}
Compras promedio mensuales: ${data.compras_promedio_mensual || ""}
Procedimiento actual F29: ${data.procedimiento_f29 || ""}

--- Diagnostico ---
Proceso con mayor dolor operativo: ${data.proceso_dolor || ""}
Detalle del diagnostico: ${data.diagnostico || ""}

--- Recomendacion de NLO ---
${data.recomendacion || ""}
`;
}

async function createClientFolder(drive, rootFolderId, clientNumber, nombreNegocio) {
  const created = await drive.files.create({
    requestBody: {
      name: `${clientNumber} - ${nombreNegocio || "Cliente"}`,
      parents: [rootFolderId],
      mimeType: "application/vnd.google-apps.folder",
    },
    supportsAllDrives: true,
    fields: "id, webViewLink",
  });
  return created.data;
}

async function uploadReportFile(drive, folderId, reportText, clientNumber) {
  await drive.files.create({
    requestBody: {
      name: `${clientNumber} - Informe de diagnostico.txt`,
      parents: [folderId],
      mimeType: "text/plain",
    },
    media: { mimeType: "text/plain", body: reportText },
    supportsAllDrives: true,
    fields: "id",
  });
}

async function sendReportEmail(reportText, folderUrl, clientNumber, nombreNegocio) {
  const sender = requireEnv("GMAIL_SENDER_EMAIL");
  const appPassword = requireEnv("GMAIL_APP_PASSWORD");
  const contadorEmail = requireEnv("CONTADOR_EMAIL");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: sender, pass: appPassword },
  });

  const driveLine = folderUrl ? `\nCarpeta en Drive: ${folderUrl}\n` : "\n";

  await transporter.sendMail({
    from: sender,
    to: contadorEmail,
    subject: `Nuevo informe de diagnostico - ${clientNumber} - ${nombreNegocio || ""}`,
    text: `${reportText}${driveLine}`,
  });
}

async function generarInforme(data) {
  let clientNumber;
  let folderUrl = null;

  if (isDriveConfigured()) {
    const rootFolderId = requireEnv("GOOGLE_DRIVE_ROOT_FOLDER_ID");
    const drive = getDriveClient();

    const clientNumberValue = await getNextClientNumber(drive, rootFolderId);
    clientNumber = formatClientNumber(clientNumberValue);

    const folder = await createClientFolder(
      drive,
      rootFolderId,
      clientNumber,
      data.nombre_negocio
    );
    const reportText = buildReportText(data, clientNumber);
    await uploadReportFile(drive, folder.id, reportText, clientNumber);
    folderUrl = folder.webViewLink;
    await sendReportEmail(reportText, folderUrl, clientNumber, data.nombre_negocio);
  } else {
    // Drive todavia no esta configurado (GOOGLE_SERVICE_ACCOUNT_JSON /
    // GOOGLE_DRIVE_ROOT_FOLDER_ID ausentes) - mandamos solo el correo.
    clientNumber = formatClientNumber(getNextInMemoryClientNumber());
    const reportText = buildReportText(data, clientNumber);
    await sendReportEmail(reportText, null, clientNumber, data.nombre_negocio);
  }

  return {
    numero_cliente: clientNumber,
    carpeta_drive: folderUrl,
  };
}

module.exports = { generarInforme };
