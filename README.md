# CHML WhatsApp Bot

This is the simple version: one Node process logs into WhatsApp Web, watches the CHML group, and replies when tagged.

It pulls league data from https://chml-history.netlify.app at startup and refreshes every 30 minutes by default. It does not pull from Sleeper at runtime.

## Run locally

```bash
npm install
cp .env.example .env
npm run smoke
npm start
```

When you run `npm start`, the terminal prints a WhatsApp QR code.

Scan it from the bot WhatsApp account:

```text
WhatsApp > Settings > Linked devices > Link a device
```

## Group matching

Default config watches any WhatsApp group whose name contains `CHML`:

```env
WHATSAPP_GROUP_NAME=CHML
WHATSAPP_GROUP_JID=
```

After the first successful run, lock it to the exact group JID by setting:

```env
WHATSAPP_GROUP_JID=120363xxxxxxxx@g.us
```

## How to use in WhatsApp

In the CHML group, tag the bot or say `chmlbot`:

```text
@CHMLBot who has the most championships?
chmlbot closest game ever?
chmlbot Jordan vs Frank
```

## Cheap VPS deploy

On an Ubuntu VPS:

```bash
apt update
apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
git clone https://github.com/michaelbgreenblatt-beep/chml-whatsapp-bot.git
cd chml-whatsapp-bot
npm install --omit=dev
cp .env.example .env
npm start
```

Scan the QR once. The session is saved in `auth/whatsapp`.

## Keeping it online

Use pm2:

```bash
npm install -g pm2
pm2 start src/whatsapp.js --name chml-whatsapp-bot
pm2 save
pm2 startup
```

Then the bot restarts if the server reboots.

## Optional HTTP server

The old HTTP webhook server is still available:

```bash
npm run server
```
