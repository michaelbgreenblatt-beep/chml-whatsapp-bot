const express = require('express');
const { loadArchive, answerQuestion, BOT_NAMES } = require('./server-core');
try { require('dotenv').config(); } catch {}

const app = express();
const port = Number(process.env.PORT || 8787);
const sharedSecret = process.env.BOT_SHARED_SECRET || '';
let archive;

app.use(express.json({ limit: '1mb' }));
function mentioned(text, body) { return body.mentioned === true || body.isMentioned === true || BOT_NAMES.some(n => String(text || '').toLowerCase().includes(n)); }
function authed(req, res) { if (!sharedSecret || req.get('x-bot-secret') === sharedSecret) return true; res.status(401).json({ error:'unauthorized' }); return false; }

app.get('/health', (_req,res) => res.json({ ok:true, generatedAt:archive.generatedAt, seasons:archive.years, games:archive.allGames.length, textDocs:archive.textDocs.length }));
app.post('/refresh', async (req,res,next) => { try { if (!authed(req,res)) return; archive = await loadArchive(); res.json({ ok:true, generatedAt:archive.generatedAt }); } catch(e) { next(e); } });
app.post('/ask', async (req,res,next) => { try { res.json(await answerQuestion(archive, req.body.text || req.body.question || '')); } catch(e) { next(e); } });
app.post('/webhook/openclaw', async (req,res,next) => { try { if (!authed(req,res)) return; const text = req.body.text || req.body.message || ''; if (!mentioned(text, req.body)) return res.json({ reply:null, ignored:true, reason:'not mentioned' }); const a = await answerQuestion(archive, text); res.json({ reply:a.reply, confidence:a.confidence, sources:a.sources || [] }); } catch(e) { next(e); } });
app.use((e,_req,res,_next) => { console.error(e); res.status(500).json({ error:'bot_error', message:e.message }); });

(async()=>{ archive = await loadArchive(); app.listen(port, () => console.log(`CHML bot listening on :${port}; loaded ${archive.allGames.length} games.`)); })().catch(e => { console.error(e); process.exit(1); });
