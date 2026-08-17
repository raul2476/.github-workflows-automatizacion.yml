const { google } = require("googleapis");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function loadServiceAccountCredentials() {
  const raw = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  const json = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf-8");
  return JSON.parse(json);
}

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: loadServiceAccountCredentials(),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

module.exports = { getDriveClient };
