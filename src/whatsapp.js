require('dotenv').config();
const { loadArchive, answerQuestion } = require('./server-core');
const { readConfig, createListener } = require('./whatsapp-listener');
async function main() {
  const config = readConfig(process.env);
  const baileys = await import('@whiskeysockets/baileys');
  const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });
  const QRCode = require('qrcode');
  process.umask(0o077);
  const { state, saveCreds } = await baileys.useMultiFileAuthState(config.authDir);
  const listener = createListener({ config, loadArchive, answerQuestion, saveCreds, logger,
    makeSocket: () => baileys.default({ auth: state,
      logger: require('pino')({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }),
      syncFullHistory: false, markOnlineOnConnect: false }),
    printQr: async qr => {
      console.log('WhatsApp > Settings > Linked devices > Link a device');
      console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
    }, onFatal: () => { process.exitCode = 1; }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void listener.stop());
  await listener.start();
}
if (require.main === module) main().catch(err => { console.error(err); process.exitCode = 1; });
module.exports = { main };
