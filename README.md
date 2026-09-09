# CHML WhatsApp Bot Package

WhatsApp-ready Q&A service for the Chestnut Hill Memorial League archive.

The bot loads data from `https://chml-history.netlify.app` at startup, answers common CHML history/stat questions quickly, and exposes HTTP endpoints that OpenClaw, Hermes, or another WhatsApp bridge can call when the bot is tagged in the league group.

## Run

```bash
npm install
cp .env.example .env
npm run smoke
npm start
```

## Endpoints

- `GET /health`
- `POST /ask` with `{ "text": "who has the most championships?" }`
- `POST /webhook/openclaw` with tagged WhatsApp payloads

Set `BOT_SHARED_SECRET` and send the same value as the `x-bot-secret` header from the bridge.

## Data

Default mode pulls from the public CHML site:

```env
CHML_DATA_MODE=remote
CHML_DATA_BASE_URL=https://chml-history.netlify.app
```

For offline operation, set `CHML_DATA_MODE=local` and copy the CHML data files into `data/`.

## Deploy

This is meant for a cheap VPS with Node 20+:

```bash
git clone https://github.com/michaelbgreenblatt-beep/chml-whatsapp-bot.git
cd chml-whatsapp-bot
npm install --omit=dev
cp .env.example .env
npm start
```

Use systemd, pm2, or Docker for production.