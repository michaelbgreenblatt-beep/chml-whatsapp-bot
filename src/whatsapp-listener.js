const TRIGGER = /\bchml\s?bot\b/i;
const normalizeJid = jid => String(jid || '').replace(/:\d+(?=@)/, '');
function readConfig(env) {
  const groups = new Set((env.WHATSAPP_GROUP_JIDS || env.WHATSAPP_GROUP_JID || '').split(',').map(s => s.trim()).filter(Boolean));
  if ([...groups].some(jid => !/^\d+(?:-\d+)?@g\.us$/.test(jid))) throw new Error('Invalid WhatsApp group JID');
  const listGroups = env.WHATSAPP_LIST_GROUPS === 'true';
  if (!groups.size && !listGroups) throw new Error('Set WHATSAPP_GROUP_JIDS, or use npm run groups to discover group IDs.');
  const minutes = Number(env.CHML_REFRESH_MINUTES ?? 30);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) throw new Error('CHML_REFRESH_MINUTES must be between 0 and 1440');
  return { groups, listGroups, authDir: env.WHATSAPP_AUTH_DIR || './auth/whatsapp', allowSelf: env.WHATSAPP_ALLOW_SELF === 'true', refreshMs: minutes * 60000 };
}
function contentOf(message) {
  for (let depth = 0; depth < 8; depth++) {
    const wrapped = message?.ephemeralMessage || message?.viewOnceMessage || message?.viewOnceMessageV2;
    if (!wrapped) break;
    message = wrapped.message;
  }
  const part = message?.extendedTextMessage || message?.imageMessage || message?.videoMessage;
  return { text: message?.conversation || part?.text || part?.caption || '', mentions: part?.contextInfo?.mentionedJid || [] };
}
function createListener({ config, makeSocket, loadArchive, answerQuestion, saveCreds, printQr, logger, onFatal = () => {}, timers = { setTimeout, clearTimeout } }) {
  let socket, archive, reconnectTimer, refreshTimer, stopped = false, attempts = 0;
  let queue = Promise.resolve(), writes = Promise.resolve();
  const seen = new Set(), outgoing = new Set();
  const remember = (set, id) => { set.add(id); if (set.size > 10000) set.delete(set.values().next().value); };
  const report = err => logger.error({ err }, 'WhatsApp listener operation failed');
  async function refresh() {
    try { const next = await loadArchive(); if (!stopped) archive = next; } catch (err) { report(err); }
    if (!stopped && config.refreshMs) refreshTimer = timers.setTimeout(refresh, config.refreshMs);
  }
  async function handle(sock, { type, messages = [] }) {
    if (type !== 'notify' || config.listGroups) return;
    for (const msg of messages) {
      if (stopped || sock !== socket) return;
      const jid = msg.key?.remoteJid;
      if (!config.groups.has(jid) || !msg.message || !msg.key.id || (msg.key.fromMe && !config.allowSelf)) continue;
      const id = `${jid}:${msg.key.participant || ''}:${msg.key.id}`;
      if (seen.has(id) || outgoing.has(`${jid}:${msg.key.id}`)) continue;
      const { text, mentions } = contentOf(msg.message);
      const own = [sock.user?.id, sock.user?.lid].filter(Boolean).map(normalizeJid);
      if (!TRIGGER.test(text) && !mentions.some(j => own.includes(normalizeJid(j)))) continue;
      remember(seen, id);
      try {
        const answer = await answerQuestion(archive, text);
        if (stopped || sock !== socket) return;
        const sent = await sock.sendMessage(jid, { text: answer.reply }, { quoted: msg });
        if (sent?.key?.id) remember(outgoing, `${jid}:${sent.key.id}`);
      } catch (err) { report(err); }
    }
  }
  function reconnect(code) {
    if (stopped || reconnectTimer) return;
    const delay = code === 515 ? 0 : Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
    reconnectTimer = timers.setTimeout(() => { reconnectTimer = undefined; void connect(); }, delay);
  }
  async function connect() {
    if (stopped) return;
    try {
      await writes;
      if (stopped) return;
      const sock = makeSocket(); socket = sock;
      sock.ev.on('creds.update', () => {
        writes = writes.then(saveCreds).catch(async err => { report(err); await stop(); onFatal(); });
      });
      sock.ev.on('messages.upsert', event => { queue = queue.then(() => handle(sock, event)).catch(report); });
      sock.ev.on('connection.update', update => {
        if (!stopped && sock === socket) void connectionUpdate(sock, update).catch(report);
      });
    } catch (err) { report(err); reconnect(); }
  }
  async function connectionUpdate(sock, { connection, lastDisconnect, qr }) {
    if (qr) await printQr(qr);
    if (connection === 'open') {
      attempts = 0; logger.info('WhatsApp connected');
      if (config.listGroups) {
        try {
          const groups = await sock.groupFetchAllParticipating();
          for (const group of Object.values(groups)) logger.info({ jid: group.id, name: group.subject }, 'Joined group');
        } finally { await stop(); }
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      sock.ev.removeAllListeners(); socket = undefined;
      // Logged out, bad session, replaced connection, forbidden, multi-device mismatch.
      if ([401, 500, 440, 403, 411].includes(code)) {
        logger.error({ code }, 'Session stopped. Check linked devices/session before restarting.');
        await stop(); onFatal();
      } else { logger.warn({ code }, 'Reconnecting to WhatsApp'); reconnect(code); }
    }
  }
  async function stop() {
    stopped = true;
    timers.clearTimeout(reconnectTimer); timers.clearTimeout(refreshTimer);
    socket?.ev.removeAllListeners(); socket?.end(new Error('Listener stopped')); socket = undefined;
  }
  return { async start() {
    if (!config.listGroups) {
      archive = await loadArchive();
      if (!stopped && config.refreshMs) refreshTimer = timers.setTimeout(refresh, config.refreshMs);
    }
    await connect();
  }, stop, async idle() { await queue; await writes; } };
}
module.exports = { readConfig, contentOf, createListener };
