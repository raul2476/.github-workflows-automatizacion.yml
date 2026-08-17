# Agente NEX-SCAN en WhatsApp (Next Level Ops)

Conecta el agente de diagnostico operativo de Next Level Ops (NEX-SCAN) a
WhatsApp usando Twilio como proveedor y Claude como cerebro conversacional.

## Arquitectura

```
Usuario (WhatsApp)
      |
      v
Twilio WhatsApp (sandbox o numero aprobado)
      |  webhook POST
      v
src/server.js  ->  src/agent.js (Claude, persona NEX-SCAN)
      |
      v
Respuesta TwiML -> Twilio -> Usuario
```

`src/server.js` expone `POST /webhook/whatsapp`, valida la firma de Twilio
(`X-Twilio-Signature`) y responde con TwiML generado a partir de la
respuesta del agente (`src/agent.js`), que usa la API de Claude con un
system prompt de NEX-SCAN y mantiene un historial corto en memoria por
numero de telefono.

`scripts/send-test-message.js` envia un mensaje saliente de prueba via la
API REST de Twilio; el workflow `.github/workflows/whatsapp-send-test.yml`
lo dispara manualmente desde GitHub Actions.

Cuando el agente termina el diagnostico (FASE 3 del prompt en `src/agent.js`),
llama a la herramienta `generar_informe_diagnostico`, que `src/report.js`
resuelve: asigna un numero de cliente correlativo (`NLO-0001`, `NLO-0002`,
...), envia el informe por correo (`nodemailer` / Gmail SMTP), y si Drive
esta configurado, ademas crea una carpeta por cliente en Drive con el
informe (`.txt`), usando `src/googleClient.js` (Google Drive API).

**Drive es opcional.** Si `GOOGLE_SERVICE_ACCOUNT_JSON` o
`GOOGLE_DRIVE_ROOT_FOLDER_ID` no estan configuradas, el informe se envia
solo por correo y el numero de cliente se lleva en memoria (se reinicia si
el servidor se reinicia) — util mientras se resuelve el acceso a Drive.
Apenas se agreguen esas variables, el correlativo pasa a ser persistente en
Drive sin tocar nada mas.

## Requisitos previos

1. Cuenta de Twilio con el producto WhatsApp habilitado (sandbox para
   pruebas, o un numero de WhatsApp Business aprobado para produccion).
2. API key de Anthropic (Claude).
3. Node.js 18+.
4. Para el informe final: una service account de Google Cloud con acceso a
   Drive, y un App Password de la cuenta de Gmail que envia los correos
   (ver mas abajo).

## Variables de entorno

Copia `.env.example` a `.env` y completa:

| Variable                 | Descripcion                                              |
|---------------------------|-----------------------------------------------------------|
| `TWILIO_ACCOUNT_SID`      | SID de la cuenta de Twilio                                 |
| `TWILIO_AUTH_TOKEN`       | Auth token de Twilio (tambien valida la firma del webhook) |
| `TWILIO_WHATSAPP_NUMBER`  | Numero de WhatsApp de Twilio, formato `whatsapp:+1415...`  |
| `ANTHROPIC_API_KEY`       | API key de Claude                                          |
| `ANTHROPIC_MODEL`         | Modelo a usar (default `claude-sonnet-4-5`)                |
| `PORT`                    | Puerto del servidor local (default `3000`)                 |
| `NODE_ENV`                | En `production` se valida la firma de cada webhook         |
| `RATE_LIMIT_MAX_MESSAGES` | Mensajes maximos por numero en la ventana (default `20`)   |
| `RATE_LIMIT_WINDOW_MS`    | Duracion de la ventana en ms (default `3600000` = 1h)      |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON de la service account de Google Cloud (o en base64) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | ID de la carpeta raiz en Drive donde se crean las carpetas por cliente |
| `GMAIL_SENDER_EMAIL`      | Cuenta de Gmail que envia el informe (`nextlevelopsconsultinspa@gmail.com`) |
| `GMAIL_APP_PASSWORD`      | App Password de esa cuenta de Gmail (no la contrasena normal) |
| `CONTADOR_EMAIL`          | A quien se le envia el informe (`nextlevelopsconsultinspa@gmail.com`) |

### Configurar Google Drive + Gmail para el informe

1. **Service account de Google Cloud** (para Drive):
   - Ve a [console.cloud.google.com](https://console.cloud.google.com) y crea
     (o reutiliza) un proyecto.
   - Habilita la **Google Drive API** (APIs & Services > Library).
   - Crea una **Service Account** (IAM & Admin > Service Accounts > Create).
   - Entra a la service account creada > pestana **Keys** > **Add Key** >
     **JSON** — se descarga un archivo `.json`. Ese es el valor de
     `GOOGLE_SERVICE_ACCOUNT_JSON` (pega el contenido completo del archivo).
   - Copia el email de la service account (termina en
     `...iam.gserviceaccount.com`).
2. **Carpeta raiz en Drive**:
   - En `nextlevelopsconsultinspa@gmail.com`, crea una carpeta (ej. "Clientes
     NLO") en Google Drive.
   - Compartila con el email de la service account del paso anterior, con
     permiso de **Editor**.
   - Copia el ID de la carpeta desde la URL
     (`https://drive.google.com/drive/folders/<ESTE_ID>`) y ponlo en
     `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
3. **App Password de Gmail** (para enviar el correo):
   - En `nextlevelopsconsultinspa@gmail.com`, activa la verificacion en 2
     pasos (myaccount.google.com/security) si no esta activa.
   - Ve a **App Passwords** (myaccount.google.com/apppasswords), genera una
     para "Mail", y usa ese valor (16 caracteres) como
     `GMAIL_APP_PASSWORD`.

## Desarrollo local

```bash
npm install
npm run dev
```

Para recibir webhooks de Twilio en local, expon el puerto con un tunel
(ej. `ngrok http 3000`) y configura esa URL + `/webhook/whatsapp` como
webhook de mensajes entrantes en la consola de Twilio (WhatsApp Sandbox
Settings o tu numero de WhatsApp Business).

## Despliegue

`src/server.js` es un servidor Express estandar: se puede desplegar en
cualquier plataforma que exponga un puerto HTTP publico (Render, Railway,
Fly.io, un VPS, etc.). GitHub Actions no sirve para hostear el webhook en
vivo (no expone puertos persistentes); su rol aqui es CI y automatizaciones
puntuales (ej. enviar mensajes de prueba).

Tras desplegar, configura la URL publica + `/webhook/whatsapp` como webhook
de WhatsApp en Twilio.

## Enviar un mensaje de prueba

Local:

```bash
npm run send-test -- "+56912345678" "Hola desde NEX-SCAN"
```

Desde GitHub Actions (workflow `Enviar mensaje de prueba WhatsApp`,
disparo manual): agrega los secrets `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN` y `TWILIO_WHATSAPP_NUMBER` al repositorio y ejecuta el
workflow desde la pestana Actions indicando el numero destino.

## Pendiente / siguientes pasos

- Persistir el historial de conversacion (hoy es en memoria y se pierde al
  reiniciar el proceso).
- Elegir y configurar la plataforma de despliegue definitiva.
- Migrar del WhatsApp Sandbox de Twilio a un numero de WhatsApp Business
  aprobado para produccion.
