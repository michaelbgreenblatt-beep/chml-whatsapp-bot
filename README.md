# CHML WhatsApp Bot

One Node process connects directly to WhatsApp through Baileys, calls the existing CHML answer engine, and sends a quoted reply in an allowed group. It reads the archive at https://chml-history.netlify.app and refreshes it every 30 minutes. No webhook or OpenAI key is required for this listener.

## Setup and QR login

Use Node.js 22 or newer and Git on a machine that stays online.

```bash
npm ci
cp .env.example .env
npm test
npm run smoke
npm run groups
```

On Windows, copy `.env.example` to `.env` using Explorer or `Copy-Item .env.example .env`.

`npm run groups` prints a QR code. In the WhatsApp account that will act as the bot, open **Settings > Linked devices > Link a device** and scan it. The account must already belong to the CHML group. Discovery lists joined group names and IDs, then exits without answering messages. Copy the CHML group ID into `.env`:

```env
WHATSAPP_GROUP_JIDS=120363xxxxxxxx@g.us
```

Replace the example with the real numeric ID. Start the listener:

```bash
npm start
```

Saved credentials are reused, so normally there is no second QR prompt. If a new QR appears, scan it from that same account. Login and an actual group reply must be verified on WhatsApp; automated tests do not authenticate a real account.

## Group allowlist and triggers

`WHATSAPP_GROUP_JIDS` accepts comma-separated exact group IDs. The older singular `WHATSAPP_GROUP_JID` still works if the plural setting is empty. An empty allowlist stops startup. Partial group-name matching (`WHATSAPP_GROUP_NAME`) is no longer used; existing installations using only that setting must run discovery and configure IDs.

In an allowed group, members can tag the linked account using WhatsApp's mention picker, or send:

```text
chmlbot who has the most championships?
chmlbot closest game ever?
chmlbot Jordan vs Frank
```

Matching is case-insensitive and also accepts `chml bot`. It recognizes phone-number and LID mentions, including text and media captions inside disappearing-message wrappers. Direct messages, other groups, history synchronization events, and untriggered messages receive no reply. Incoming message IDs are deduplicated in a bounded in-memory cache across reconnects; the cache is not retained across process restarts.

Self-sent messages are ignored by default. To test using the linked account's own phone, set `WHATSAPP_ALLOW_SELF=true`; the listener suppresses echoes of its generated replies. Testing from a different group member is preferred.

## Persistent session and hosting

`WHATSAPP_AUTH_DIR` defaults to `./auth/whatsapp`. Keep this private directory on persistent storage, writable only by the bot service account. It contains credentials and encryption keys that provide account access. Do not commit, share, or include it in container images. The default path and `.env` are excluded from Git and Docker; a custom auth directory should live outside the checkout.

This setup uses Baileys' file-based auth helper for a single bot process. Run only one process per auth directory/account. For a larger production service, replace the helper with a transactional database-backed auth adapter, as recommended by [Baileys session documentation](https://github.com/WhiskeySockets/docs/blob/main/authentication/session-management.mdx).

Use a persistent VPS/container host, not a short-lived serverless function. Container example (first run needs an attached terminal for QR):

```bash
docker build -t chml-whatsapp-bot .
docker run --rm -it --env-file .env -v chml-auth:/app/auth chml-whatsapp-bot npm run groups
docker run -d --name chml-whatsapp-bot --restart unless-stopped --env-file .env -v chml-auth:/app/auth chml-whatsapp-bot
```

Update `.env` with the discovered group ID before the second command that starts the bot. If using a custom auth path, mount persistent storage at that path instead.

The included `systemd.service.example` is an alternative for a VPS. Install dependencies with `npm ci --omit=dev`, set the service's working directory and user, and pair interactively as that user before starting the service. Do not run a second copy during pairing/discovery.

Transient disconnects retry with exponential backoff capped at 30 seconds. The post-QR restart reconnects immediately. Logout, invalid sessions, replaced connections, and forbidden sessions stop the process with an error. Fix the underlying issue before restarting. After logout, unlink the old device if necessary, stop the service, move the auth directory aside, and run discovery again to pair. Never delete credentials while the listener is running.

Archive refresh failures retain the last successfully loaded archive and retry at the next interval. Startup requires the archive to load. SIGINT/SIGTERM close the socket and clear timers. Logs exclude message bodies; keep QR output private.

## Commands and configuration

- `npm start` / `npm run whatsapp`: direct listener.
- `npm run groups`: login and list group IDs without responding.
- `npm test`: offline message-routing and lifecycle tests.
- `npm run smoke`: existing answer-engine checks against live CHML data.
- `npm run ask -- "closest game ever"`: ask the engine from the terminal.
- `npm run server`: optional legacy HTTP server.

See `.env.example` for settings. `CHML_REFRESH_MINUTES=0` disables refresh after startup; valid values are 0–1440. Use the committed npm lockfile for reproducible installs.
