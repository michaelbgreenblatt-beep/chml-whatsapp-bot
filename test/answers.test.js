const test = require('node:test');
const assert = require('node:assert/strict');
const { answerQuestion } = require('../src/server-core');

test('answers the league sexiest-owner joke', async () => {
  const expected = 'Typically Bruno, or Tucker when Tucker shaves his rectum.';
  assert.equal((await answerQuestion({}, 'who is the sexiest owner in the league?')).reply, expected);
  assert.equal((await answerQuestion({}, "who's the sexiest owner?")).reply, expected);
});
