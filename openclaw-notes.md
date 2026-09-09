# OpenClaw Notes

Use OpenClaw for WhatsApp login, group filtering, and mention gating. This service is the CHML answer brain.

Recommended behavior:

- Use a dedicated WhatsApp number for the bot.
- Add that number to the CHML group.
- Allow only the CHML group ID.
- Require a mention before forwarding a message.
- Forward tagged messages to `POST /webhook/openclaw`.
- Send `reply` from the JSON response back to the same group.

Webhook request:

```json
{
  "text": "@CHMLBot closest game ever?",
  "chatId": "120363000000000000@g.us",
  "sender": "15551234567",
  "mentioned": true
}
```

Use the `x-bot-secret` header with `BOT_SHARED_SECRET`.
