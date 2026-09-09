#!/usr/bin/env node
const { loadArchive, answerQuestion } = require('../src/server-core');
(async()=>{
  const q = process.argv.slice(2).join(' ');
  if (!q) throw new Error('Usage: node bin/ask.js "who has the most championships?"');
  const archive = await loadArchive();
  const answer = await answerQuestion(archive, q);
  console.log(answer.reply);
})().catch(e=>{ console.error(e); process.exit(1); });
