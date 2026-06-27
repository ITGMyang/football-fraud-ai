import test from 'node:test';
import assert from 'node:assert/strict';
import { contextKey, extractDongqiudiMatchId, findExistingContext } from '../src/context-utils.js';

test('extracts Dongqiudi match id from urls and raw ids', () => {
  assert.equal(extractDongqiudiMatchId('https://www.dongqiudi.com/match/54329995'), '54329995');
  assert.equal(extractDongqiudiMatchId('54329995'), '54329995');
});

test('finds duplicate imported context by match id before source url fallback', () => {
  const contexts = [
    { matchId: '54329995', sourceUrl: 'https://www.dongqiudi.com/match/54329995?from=old', matchName: 'A v B' }
  ];

  assert.equal(findExistingContext(contexts, 'https://www.dongqiudi.com/match/54329995')?.matchName, 'A v B');
  assert.equal(contextKey(contexts[0]), '54329995');
});

test('finds context by existing context key or source url', () => {
  const contexts = [
    { id: 'https://www.dongqiudi.com/match/54330001', sourceUrl: 'https://www.dongqiudi.com/match/54330001', matchName: 'Panama v England' }
  ];

  assert.equal(findExistingContext(contexts, '54330001')?.matchName, 'Panama v England');
  assert.equal(findExistingContext(contexts, 'https://www.dongqiudi.com/match/54330001')?.matchName, 'Panama v England');
});
