const test = require('node:test');
const assert = require('node:assert/strict');
const { answerQuestion } = require('../src/server-core');

test('answers the league sexiest-owner joke', async () => {
  const expected = 'Typically Bruno, or Tucker when Tucker shaves his rectum.';
  assert.equal((await answerQuestion({}, 'who is the sexiest owner in the league?')).reply, expected);
  assert.equal((await answerQuestion({}, "who's the sexiest owner?")).reply, expected);
});

const archive = { seasons: {
  2023: { standings: [
    { owner: 'First Owner', owners: ['First Owner'], rank: 1, w: 10, l: 4, t: 0, pf: 1700 },
    { owner: 'Last Owner', owners: ['Last Owner'], rank: 12, w: 2, l: 12, t: 0, pf: 1300.25 }
  ] },
  2026: { standings: [{ owner: 'Nobody Yet', rank: null, w: 0, l: 0, t: 0, pf: 0 }] }
} };

test('answers last-place and ordinal standings questions from statistics', async () => {
  assert.equal((await answerQuestion(archive, 'who came in last place in 2023?')).reply,
    'Last Owner finished 12th in the 2023 standings with a 2-12 record and 1,300.25 points.');
  assert.equal((await answerQuestion(archive, 'who finished 1st in 2023?')).reply,
    'First Owner finished 1st in the 2023 standings with a 10-4 record and 1,700 points.');
  assert.equal((await answerQuestion(archive, 'who came in last place in 2026?')).reply,
    '2026 does not have final standings yet.');
});

test('ranks drafting over an intuitive completed-season window', async () => {
  const seasons = {};
  for (const year of [2021, 2022, 2023, 2024, 2025]) seasons[year] = {
    standings: [{ rank: 1 }],
    draft: [
      { id: 'a', owner: 'Alice', owners: ['Alice'] },
      { id: 'b', owner: 'Bob', owners: ['Bob'] }
    ],
    games: [{ isFinal: true, stage: 'reg', left: { owner: 'Alice', owners: ['Alice'], rows: [{ id: 'a', group: 'Starters', points: 100 }] },
      right: { owner: 'Bob', owners: ['Bob'], rows: [{ id: 'b', group: 'Starters', points: 80 }] } }]
  };
  const result = await answerQuestion({ years: Object.keys(seasons).map(Number), seasons }, 'who is the best drafter in the league last 5 years?');
  assert.equal(result.reply, "By regular-season starter points from players who remained with their original drafter, Alice was CHML's best drafter over 2021–2025, averaging 100 points per season. Next: Bob (80).");
});
