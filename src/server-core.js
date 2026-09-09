try { require('dotenv').config(); } catch {}

const DATA_BASE = (process.env.CHML_DATA_BASE_URL || 'https://chml-history.netlify.app').replace(/\/$/, '');
const SITE_URL = process.env.CHML_SITE_URL || 'https://chml-history.netlify.app/#/';
const BOT_NAMES = ['chmlbot', 'chml bot', '@chmlbot', '@chml bot'];
const FINAL_WEEK = 17;
const HANDLE_TO_OWNER = new Map(Object.entries({
  Blatttman: 'Michael Greenblatt', JGropp731: 'Jordan Gropper', zstauber: 'Zach Stauber',
  '09fdisanti': 'Frank DiSanti', Reedybaby24: 'Reed Marcus', mattgold4: 'Matt Gold',
  cpadell: 'Cory Padell', kking1234: 'Kenny King', bkarp: 'Ben Karp', K3N4K1NG: 'Kenny King',
  ddisa10: 'Doug DiSanti', tcushing: 'Tucker Cushing', brote: 'Bruno Rotellini', Victorlaz: 'Victor Lazares', maxgold91: 'Max Gold'
}));

const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const round = n => Math.round(Number(n || 0) * 100) / 100;
const rec = (w, l, t = 0) => t ? `${w}-${l}-${t}` : `${w}-${l}`;
const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ownerOf = handle => HANDLE_TO_OWNER.get(handle) || handle;
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

function lineupIndex(season) {
  const cells = new Map();
  for (const g of season.games || []) for (const side of [g.left, g.right]) {
    if (!side?.rows) continue;
    for (const r of side.rows) if (r.id) cells.set(`${r.id}|${side.owner}|${g.week}`, { points: Number(r.points) || 0, started: r.group === 'Starters' });
  }
  return cells;
}
function haul(cells, playerId, owner, fromWeek) {
  let started = 0, benched = 0, weeksStarted = 0, weeksHeld = 0;
  for (let w = fromWeek + 1; w <= FINAL_WEEK; w++) {
    const c = cells.get(`${playerId}|${owner}|${w}`);
    if (!c) continue;
    weeksHeld++;
    if (c.started) { started += c.points; weeksStarted++; } else benched += c.points;
  }
  return { started: round(started), benched: round(benched), weeksStarted, weeksHeld };
}
function txnsFor(a, year) { return a.transactions?.seasons?.[String(year)]?.transactions || []; }
function gradeTrade(rec, season, cells) {
  const week = rec.week;
  const weeksLeft = Math.max(0, FINAL_WEEK - week);
  const receiverOf = new Map((rec.adds || []).map(x => [x.id, ownerOf(x.owner)]));
  const names = new Set([...(rec.owners || []).map(ownerOf), ...(rec.adds || []).map(x => ownerOf(x.owner)), ...(rec.drops || []).map(x => ownerOf(x.owner))]);
  const sides = [...names].map(owner => {
    const received = (rec.adds || []).filter(x => ownerOf(x.owner) === owner).map(x => ({ name: x.name, ...haul(cells, x.id, owner, week) }));
    const sent = (rec.drops || []).filter(x => ownerOf(x.owner) === owner).map(x => {
      const to = receiverOf.get(x.id);
      return { name: x.name, to, ...haul(cells, x.id, to, week) };
    });
    const got = round(received.reduce((s,p)=>s+p.started,0));
    const gave = round(sent.reduce((s,p)=>s+p.started,0));
    return { owner, received, sent, got, gave, net: round(got - gave), benched: round(received.reduce((s,p)=>s+p.benched,0)), perWeek: weeksLeft ? round(got / weeksLeft) : 0 };
  }).sort((x,y)=>y.net-x.net);
  return { id: rec.id, year: season.year, week, weeksLeft, sides, winner: sides[0]?.net > 0 ? sides[0].owner : null, loser: sides.at(-1)?.net < 0 ? sides.at(-1).owner : null, spread: sides.length ? round(sides[0].net - sides.at(-1).net) : 0 };
}
function tradeGrades(a) {
  return Object.keys(a.transactions?.seasons || {}).flatMap(year => {
    const season = a.seasons[String(year)];
    if (!season) return [];
    const cells = lineupIndex(season);
    return txnsFor(a, year).filter(r => r.type === 'trade').map(r => gradeTrade(r, season, cells));
  });
}
function tradeBook(a) {
  const book = new Map();
  for (const t of tradeGrades(a)) for (const s of t.sides) {
    const b = book.get(s.owner) || { owner:s.owner, trades:0, won:0, lost:0, even:0, got:0, gave:0, net:0, best:null, worst:null };
    b.trades++; if (s.net > 0) b.won++; else if (s.net < 0) b.lost++; else b.even++;
    b.got += s.got; b.gave += s.gave; b.net += s.net;
    if (!b.best || s.net > b.best.side.net) b.best = { trade:t, side:s };
    if (!b.worst || s.net < b.worst.side.net) b.worst = { trade:t, side:s };
    book.set(s.owner, b);
  }
  return [...book.values()].map(b => ({ ...b, got:round(b.got), gave:round(b.gave), net:round(b.net), perTrade:b.trades?round(b.net/b.trades):0 })).sort((x,y)=>y.net-x.net);
}
function playerList(players) { return players.map(p => p.name).slice(0,3).join(', ') || 'no started points'; }
function answerTradeGrades(a, q) {
  if (!/trade/.test(q)) return null;
  const grades = tradeGrades(a);
  if (!grades.length) return { reply: 'No trade-grade data is available yet. The archive has transaction records from 2021 onward.', confidence:'exact' };
  const book = tradeBook(a);
  const owner = [...a.ownerMap.values()].find(o => q.includes(key(o).split(' ')[0]) || q.includes(key(o)));
  if (owner && /(grade|trade|trading|record)/.test(q)) {
    const b = book.find(x => x.owner === owner);
    if (b) return { reply: `${owner} trade grades since 2021: ${rec(b.won,b.lost,b.even)} over ${b.trades} trades, net ${fmt(b.net,1)} starter points. Best: +${fmt(b.best.side.net,1)} in ${b.best.trade.year} week ${b.best.trade.week}. Worst: ${fmt(b.worst.side.net,1)} in ${b.worst.trade.year} week ${b.worst.trade.week}.`, confidence:'exact' };
  }
  if (/worst|biggest loss|lost/.test(q)) {
    const t = grades.slice().sort((x,y)=>x.sides.at(-1).net-y.sides.at(-1).net)[0], s = t.sides.at(-1);
    return { reply: `Worst graded trade side: ${s.owner} in ${t.year} week ${t.week}, net ${fmt(s.net,1)} starter points. Got ${fmt(s.got,1)} from ${playerList(s.received)}; gave up ${fmt(s.gave,1)}.`, confidence:'exact' };
  }
  if (/best|won|winner|steal/.test(q)) {
    const t = grades.slice().sort((x,y)=>y.sides[0].net-x.sides[0].net)[0], s = t.sides[0];
    return { reply: `Best graded trade side: ${s.owner} in ${t.year} week ${t.week}, net +${fmt(s.net,1)} starter points. Got ${fmt(s.got,1)} from ${playerList(s.received)}; gave up ${fmt(s.gave,1)}.`, confidence:'exact' };
  }
  const leaders = book.slice(0,3).map(b => `${b.owner} ${fmt(b.net,1)} (${rec(b.won,b.lost,b.even)})`).join('; ');
  return { reply: `Trade-grade leaders since 2021 by net starter points: ${leaders}. Ask “chmlbot best trade” or “chmlbot Frank trade grades” for details.`, confidence:'exact' };
}

async function answerQuestion(a, question) {
  const clean = String(question || '').replace(/@\S+/g, '').trim();
  const q = clean.toLowerCase();
  if (!clean) return { reply: 'Tag me with a CHML question and I will check the archive.', confidence: 'empty' };
  if (/\b(?:who(?:'s| is)?|which owner(?: is)?)\b.*\bsexiest\b|\bsexiest\b.*\bowner\b/.test(q)) {
    return { reply: 'Typically Bruno, or Tucker when Tucker shaves his rectum.', confidence: 'exact' };
  }
  const tradeAnswer = answerTradeGrades(a, q); if (tradeAnswer) return tradeAnswer;
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
