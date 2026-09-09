try { require('dotenv').config(); } catch {}

const DATA_BASE = (process.env.CHML_DATA_BASE_URL || 'https://chml-history.netlify.app').replace(/\/$/, '');
const SITE_URL = process.env.CHML_SITE_URL || 'https://chml-history.netlify.app/#/';
const BOT_NAMES = ['chmlbot', 'chml bot', '@chmlbot', '@chml bot'];

const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const rec = (w, l, t = 0) => t ? `${w}-${l}-${t}` : `${w}-${l}`;
const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const owners = side => side?.owners || [side?.owner].filter(Boolean);
const winnerOf = g => g.winnerId ?? (Number(g.left?.score) === Number(g.right?.score) ? null : Number(g.left?.score) > Number(g.right?.score) ? g.left.id : g.right.id);

async function text(path) {
  const r = await fetch(`${DATA_BASE}/${path}`);
  if (!r.ok) throw new Error(`Failed loading ${path}: ${r.status}`);
  return r.text();
}

async function json(path) { return JSON.parse(await text(path)); }

function extractStrings(source, label) {
  return [...source.matchAll(/`([^`]{80,})`|"([^"\n]{80,})"|'([^'\n]{80,})'/g)].map(m => ({
    source: label,
    title: label.replace(/[-_]/g, ' ').replace(/\.js$/i, ''),
    url: SITE_URL,
    text: (m[1] || m[2] || m[3]).replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim()
  })).filter(d => d.text.length >= 80);
}

async function loadArchive() {
  const [seasonData, transactions, ...docs] = await Promise.all([
    json('season-data.json'),
    json('transactions.json').catch(() => ({})),
    ...['constitution-text.js','payouts.js','season-stories.js','trade-grades.js','league-record.js','fived-data.js'].map(f => text(f).then(t => [f, t]).catch(() => [f, '']))
  ]);
  const seasons = seasonData.seasons || seasonData || {};
  const years = Object.keys(seasons).map(Number).sort((a,b)=>a-b);
  const allGames = years.flatMap(year => (seasons[year]?.games || []).filter(g => g.isFinal).map(g => ({...g, year})));
  const ownerMap = new Map();
  for (const g of allGames) for (const s of [g.left, g.right]) for (const o of owners(s)) ownerMap.set(key(o), o);
  const textDocs = docs.flatMap(([f,t]) => extractStrings(t, f));
  return { generatedAt: new Date().toISOString(), seasons, years, allGames, ownerMap, textDocs, transactions };
}

function findOwner(a, name) {
  const q = key(name);
  return a.ownerMap.get(q) || [...a.ownerMap.values()].find(o => key(o).includes(q) || q.includes(key(o)));
}

function ownerStats(a) {
  const stats = new Map();
  for (const g of a.allGames) {
    const win = winnerOf(g);
    for (const [side, other] of [[g.left,g.right],[g.right,g.left]]) {
      for (const o of owners(side)) {
        const k = key(o), row = stats.get(k) || { owner:o, games:0, w:0, l:0, t:0, points:0, against:0 };
        row.games++; row.points += Number(side.score || 0); row.against += Number(other.score || 0);
        if (win == null) row.t++; else if (win === side.id) row.w++; else row.l++;
        stats.set(k,row);
      }
    }
  }
  return [...stats.values()];
}

function champions(a) {
  return a.years.flatMap(year => {
    const games = (a.seasons[year]?.games || []).filter(g => g.stage === 'playoff' && g.isFinal).sort((x,y)=>x.week-y.week);
    const final = games.at(-1); if (!final) return [];
    const win = winnerOf(final), champ = [final.left, final.right].find(s => s.id === win), runner = [final.left, final.right].find(s => s.id !== win);
    if (!champ || !runner) return [];
    return owners(champ).map(owner => ({ year, owner, team: champ.name, score: champ.score, runner: owners(runner).join(' / '), runnerScore: runner.score }));
  });
}

async function answerQuestion(a, question) {
  const clean = String(question || '').replace(/@\S+/g, '').trim();
  const q = clean.toLowerCase();
  if (!clean) return { reply: 'Tag me with a CHML question and I will check the archive.', confidence: 'empty' };
  if (/(championship|title|champion).*(most)|most.*(championship|title)/.test(q)) {
    const m = new Map(); for (const c of champions(a)) m.set(c.owner, (m.get(c.owner)||0)+1);
    const rows = [...m].map(([owner,titles])=>({owner,titles})).sort((x,y)=>y.titles-x.titles || x.owner.localeCompare(y.owner));
    const best = rows.filter(r => r.titles === rows[0].titles);
    return { reply: `${best.map(r=>r.owner).join(' and ')} lead CHML with ${best[0].titles} championships.`, confidence:'exact' };
  }
  const year = q.match(/\b(20\d{2})\b/)?.[1];
  if (year && /(champion|won|winner|title)/.test(q)) {
    const c = champions(a).find(x => String(x.year) === year);
    if (c) return { reply: `${c.owner} won ${year} with ${c.team}, beating ${c.runner} ${fmt(c.score,2)} to ${fmt(c.runnerScore,2)}.`, confidence:'exact' };
  }
  if (/all[ -]?time wins|most wins|wins leader/.test(q)) {
    const rows = ownerStats(a).sort((x,y)=>y.w-x.w); const best = rows.filter(r=>r.w===rows[0].w);
    return { reply: `${best.map(r=>r.owner).join(' and ')} ${best.length===1?'leads':'lead'} all-time wins with ${best[0].w}.`, confidence:'exact' };
  }
  if (/highest score|biggest week|single.game|single week/.test(q)) {
    const row = a.allGames.flatMap(g => [g.left,g.right].map(s => ({g,s}))).sort((x,y)=>Number(y.s.score)-Number(x.s.score))[0];
    return { reply: `${owners(row.s).join(' / ')} owns the highest single score: ${fmt(row.s.score,2)} in ${row.g.year} week ${row.g.week}.`, confidence:'exact' };
  }
  if (/closest/.test(q)) {
    const row = a.allGames.filter(g=>winnerOf(g)!=null).map(g=>({g,margin:Math.abs(Number(g.left.score)-Number(g.right.score))})).sort((x,y)=>x.margin-y.margin)[0];
    return { reply: `Closest game: ${owners(row.g.left).join(' / ')} vs ${owners(row.g.right).join(' / ')}, ${row.g.year} week ${row.g.week}, decided by ${fmt(row.margin,2)} points (${fmt(row.g.left.score,2)}-${fmt(row.g.right.score,2)}).`, confidence:'exact' };
  }
  const vs = q.match(/([a-z]+)\s+(?:vs|versus|against|v)\s+([a-z]+)/i);
  if (vs) {
    const A = findOwner(a, vs[1]), B = findOwner(a, vs[2]);
    const games = A && B ? a.allGames.filter(g => (owners(g.left).includes(A) && owners(g.right).includes(B)) || (owners(g.right).includes(A) && owners(g.left).includes(B))) : [];
    if (games.length) { let aw=0,bw=0,t=0,ap=0,bp=0; for (const g of games) { const as = owners(g.left).includes(A) ? g.left : g.right, bs = as===g.left ? g.right : g.left; ap+=Number(as.score||0); bp+=Number(bs.score||0); const w=winnerOf(g); if(w==null)t++; else if(w===as.id)aw++; else bw++; } return { reply: `${A} is ${rec(aw,bw,t)} against ${B}, with ${fmt(ap,1)} points for and ${fmt(bp,1)} against across ${games.length} games.`, confidence:'exact' }; }
  }
  const terms = q.split(/[^a-z0-9]+/).filter(x=>x.length>=4);
  const hit = a.textDocs.map(d => ({...d, score: terms.reduce((n,t)=>n+((d.title+' '+d.text).toLowerCase().includes(t)?1:0),0)})).filter(d=>d.score>0).sort((x,y)=>y.score-x.score)[0];
  if (hit) return { reply: `${hit.title}: ${hit.text.slice(0,450)}${hit.text.length>450?'...':''}`, confidence:'search', sources:[hit.source] };
  return { reply:'I could not find that in the CHML archive yet. Try a manager, season, record, matchup, constitution item, payout, or trade.', confidence:'miss' };
}

module.exports = { loadArchive, answerQuestion, BOT_NAMES };
