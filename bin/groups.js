process.env.WHATSAPP_LIST_GROUPS = 'true';
require('../src/whatsapp').main().catch(err => { console.error(err); process.exitCode = 1; });
