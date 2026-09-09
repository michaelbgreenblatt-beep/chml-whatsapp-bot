const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readConfig, createListener } = require('../src/whatsapp-listener');
const group = '123@g.us';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(overrides = {}) {
  const sockets = [], jobs = new Map(), answers = [], replies = [], errors = [];
  let counter = 0, loads = 0, saves = 0, fatal = 0;
  const config = readConfig({ WHATSAPP_GROUP_JIDS: group, CHML_REFRESH_MINUTES: '1', ...overrides });
  const bot = createListener({ config,
    timers: { setTimeout(fn, ms) { jobs.set(++counter, { fn, ms }); return counter; }, clearTimeout(id) { jobs.delete(id); } },
    makeSocket() {
      const sock = { ev: new EventEmitter(), user: { id: '111:4@s.whatsapp.net', lid: '222:5@lid' },
        end() {}, async sendMessage(jid, content, options) { replies.push({ jid, content, options }); return { key: { id: 'out' } }; },
        async groupFetchAllParticipating() { return {}; } };
      sockets.push(sock); return sock;
    },
    async loadArchive() { loads++; return { fixture: true }; },
    async answerQuestion(archive, text) { answers.push({ archive, text }); if (text.includes('error')) throw Error('test'); return { reply: 'chmlbot answer' }; },
    async saveCreds() { saves++; }, async printQr() {},
    logger: { info() {}, warn() {}, error(err) { errors.push(err); } }, onFatal() { fatal++; }
  });
  await bot.start();
  const emit = async (messages, type = 'notify') => { sockets.at(-1).ev.emit('messages.upsert', { type, messages }); await bot.idle(); };
  const close = code => sockets.at(-1).ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: code } } } });
  return { bot, sockets, jobs, answers, replies, errors, emit, close, counts: () => ({ loads, saves, fatal }) };
}
function msg(text, id = '1', key = {}, message) {
  return { key: { remoteJid: group, id, fromMe: false, ...key }, message: message || { conversation: text } };
}
test('configuration fails closed and validates IDs/refresh', () => {
  assert.throws(() => readConfig({}));
  assert.throws(() => readConfig({ WHATSAPP_GROUP_JIDS: 'bad' }));
  assert.throws(() => readConfig({ WHATSAPP_GROUP_JID: group, CHML_REFRESH_MINUTES: 'NaN' }));
  assert.equal(readConfig({ WHATSAPP_GROUP_JID: group }).groups.has(group), true);
});
test('only allowed live triggered messages reach answer engine, with quoted group replies', async () => {
  const h = await setup();
  await h.emit([msg('chmlbot question')], 'append');
  await h.emit([msg('chmlbot question', '2', { remoteJid: '111@s.whatsapp.net' }), msg('chmlbot question', '3', { remoteJid: '999@g.us' }), msg('hello', '4'), msg('mychmlbotstuff', '5'), msg('chmlbot', '6', { fromMe: true })]);
  assert.equal(h.answers.length, 0);
  const request = msg('CHMLBOT closest game?');
  await h.emit([request, request]);
  assert.equal(h.answers.length, 1);
  assert.deepEqual(h.answers[0].archive, { fixture: true });
  assert.equal(h.replies[0].jid, group);
  assert.equal(h.replies[0].options.quoted, request);
  await h.bot.stop();
});
test('phone and LID mentions work in wrapped text and media captions', async () => {
  const h = await setup();
  await h.emit([msg('', 'a', {}, { ephemeralMessage: { message: { extendedTextMessage: { text: '@111 question', contextInfo: { mentionedJid: ['111@s.whatsapp.net'] } } } } }), msg('', 'b', {}, { imageMessage: { caption: 'question', contextInfo: { mentionedJid: ['222@lid'] } } }), msg('', 'c', {}, { extendedTextMessage: { text: 'question', contextInfo: { mentionedJid: ['333@lid'] } } })]);
  assert.equal(h.answers.length, 2); await h.bot.stop();
});
test('self-test opt-in never responds to its own generated reply', async () => {
  const h = await setup({ WHATSAPP_ALLOW_SELF: 'true' });
  await h.emit([msg('chmlbot test', '1', { fromMe: true })]);
  await h.emit([msg('chmlbot answer', 'out', { fromMe: true, participant: '111@s.whatsapp.net' })]);
  assert.equal(h.answers.length, 1); await h.bot.stop();
});
test('answer failures are contained and subsequent messages work', async () => {
  const h = await setup(); await h.emit([msg('chmlbot error'), msg('chmlbot works', '2')]);
  assert.equal(h.errors.length, 1); assert.equal(h.replies.length, 1); await h.bot.stop();
});
test('reconnect keeps one refresh timer, persists credentials, removes old handlers', async () => {
  const h = await setup(); const first = h.sockets[0];
  first.ev.emit('creds.update'); await h.bot.idle(); assert.equal(h.counts().saves, 1);
  h.close(408); h.close(408);
  assert.equal(h.jobs.size, 2);
  const [id, job] = [...h.jobs].find(([, j]) => j.ms === 1000); h.jobs.delete(id); job.fn(); await tick();
  assert.equal(h.sockets.length, 2); assert.equal(h.counts().loads, 1); assert.equal(h.jobs.size, 1);
  assert.equal(first.ev.listenerCount('messages.upsert'), 0);
  await h.bot.stop(); assert.equal(h.jobs.size, 0);
});
test('logout and replaced session stop without reconnect; pairing restart reconnects immediately', async () => {
  for (const code of [401, 440, 500, 403, 411]) {
    const h = await setup(); h.close(code); await tick();
    assert.equal(h.jobs.size, 0); assert.equal(h.counts().fatal, 1);
  }
  const h = await setup(); h.close(515);
  assert.ok([...h.jobs.values()].some(j => j.ms === 0)); await h.bot.stop();
});
test('group discovery skips archive loading and all replies', async () => {
  const h = await setup({ WHATSAPP_LIST_GROUPS: 'true' });
  await h.emit([msg('chmlbot')]); assert.equal(h.answers.length, 0); assert.equal(h.counts().loads, 0);
  h.sockets[0].ev.emit('connection.update', { connection: 'open' }); await tick();
  assert.equal(h.jobs.size, 0);
});

test('Baileys auth persists credentials and session keys across reloads', async () => {
  const { mkdtemp, rm } = require('node:fs/promises');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const { useMultiFileAuthState } = await import('@whiskeysockets/baileys');
  const dir = await mkdtemp(join(tmpdir(), 'chml-auth-test-'));
  try {
    const first = await useMultiFileAuthState(dir);
    first.state.creds.me = { id: '111@s.whatsapp.net', name: 'Test' };
    await first.saveCreds();
    await first.state.keys.set({ session: { example: Buffer.from('test-session') } });
    const second = await useMultiFileAuthState(dir);
    assert.equal(second.state.creds.me.id, '111@s.whatsapp.net');
    assert.deepEqual((await second.state.keys.get('session', ['example'])).example, Buffer.from('test-session'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
