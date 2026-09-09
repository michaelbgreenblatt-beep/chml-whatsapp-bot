const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const QRCode = require('qrcode');
const { loadArchive, answerQuestion, BOT_NAMES } = require('./server-core');
try { require('dotenv').config(); } catch {}

const groupName = process.env.WHATSAPP_GROUP_NAME || 'CHML';
const groupJid = process.env.WHATSAPP_GROUP_JID || '';
const authDir = process.env.WHATSAPP_AUTH_DIR || './auth/whatsapp';
const refreshMinutes = Number(process.env.CHML_REFRESH_MINUTES || 30);
const logger = P({ level: process.env.LOG_LEVEL || 'info' });
let archive;
let sock;

function bodyOf(message) {
  return message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || '';
}

function wasMentioned(message, text) {
  const lower = String(text || '').toLowerCase();
  const mentionedJids = message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const myJid = sock?.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : '';
  return mentionedJids.includes(myJid) || BOT_NAMES.some(name => lower.includes(name));
}

async function printQr(qr) {
  const small = await QRCode.toString(qr, { type: 'terminal', small: true });
  console.log('\nScan this QR from the BOT WhatsApp account: WhatsApp > Settings > Linked devices > Link a device\n');
  console.log(small);
}

async function refreshArchive() {
  archive = await loadArchive();
  logger.info({ games: archive.allGames.length, seasons: archive.years.length }, 'CHML archive loaded');
}

async function connect() {
  await refreshArchive();
  if (refreshMinutes > 0) setInterval(refreshArchive, refreshMinutes * 60 * 1000).unref();

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: P({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }), browser: ['CHMLBot', 'Chrome', '1.0'] });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) await printQr(qr);
    if (connection === 'open') logger.info('WhatsApp connected');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      logger.warn({ code }, 'WhatsApp disconnected');
      if (code !== DisconnectReason.loggedOut) connect().catch(err => logger.error(err));
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const chatId = msg.key.remoteJid;
        if (!chatId?.endsWith('@g.us')) continue;
        if (groupJid && chatId !== groupJid) continue;
        const meta = await sock.groupMetadata(chatId).catch(() => null);
        if (!groupJid && meta?.subject && !meta.subject.toLowerCase().includes(groupName.toLowerCase())) continue;
        const text = bodyOf(msg.message);
        if (!wasMentioned(msg.message, text)) continue;
        logger.info({ group: meta?.subject || chatId, from: msg.key.participant }, 'answering CHML question');
        const answer = await answerQuestion(archive, text);
        await sock.sendMessage(chatId, { text: answer.reply }, { quoted: msg });
      } catch (err) {
        logger.error({ err }, 'failed handling message');
      }
    }
  });
}

connect().catch(err => { logger.error(err); process.exit(1); });
