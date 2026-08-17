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
entrega el informe final (resumen + recomendacion de automatizacion)
directo como mensaje de WhatsApp — no genera archivos, no envia correos ni
usa ninguna herramienta externa.

## Requisitos previos

1. Cuenta de Twilio con el producto WhatsApp habilitado (sandbox para
   pruebas, o un numero de WhatsApp Business aprobado para produccion).
2. API key de Anthropic (Claude).
3. Node.js 18+.

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
