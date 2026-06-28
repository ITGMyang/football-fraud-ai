import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('single model ranking merges into latest ranking instead of replacing other models', async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'football-storage-'));
  process.chdir(tempDir);
  try {
    const storage = await import(`../src/storage.js?test=${Date.now()}`);
    storage.saveRanking({
      id: 'batch-1',
      marketCount: 4,
      createdAt: '2026-06-26T00:00:00.000Z',
      results: [
        { modelName: 'DeepSeek', picks: [{ marketId: 'a' }], scorePicks: [] },
        { modelName: 'Qwen', picks: [{ marketId: 'b' }], scorePicks: [] }
      ]
    });

    const merged = storage.saveRanking({
      id: 'single-gpt',
      marketCount: 4,
      createdAt: '2026-06-26T00:01:00.000Z',
      results: [
        { modelName: 'GPT', picks: [{ marketId: 'c' }], scorePicks: [{ score: '1:0' }] }
      ]
    }, { mergeLatest: true });

    assert.deepEqual(merged.results.map((result) => result.modelName), ['DeepSeek', 'Qwen', 'GPT']);
    assert.equal(storage.readDb().rankings.length, 1);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('single model ranking merges into latest ranking for the same context', async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'football-storage-'));
  process.chdir(tempDir);
  try {
    const storage = await import(`../src/storage.js?test=${Date.now()}-context-ranking`);
    storage.saveRanking({
      id: 'panama-batch',
      contextId: 'panama-england',
      contextName: '巴拿马 v 英格兰',
      marketCount: 4,
      createdAt: '2026-06-26T00:00:00.000Z',
      results: [
        { modelName: 'GPT 5.5', picks: [{ marketId: 'a' }], scorePicks: [] },
        { modelName: 'Qwen', picks: [{ marketId: 'b' }], scorePicks: [] }
      ]
    });
    storage.saveRanking({
      id: 'other-batch',
      contextId: 'other-match',
      contextName: '其他比赛',
      marketCount: 4,
      createdAt: '2026-06-26T00:02:00.000Z',
      results: [
        { modelName: 'DeepSeek', picks: [{ marketId: 'x' }], scorePicks: [] }
      ]
    });

    const merged = storage.saveRanking({
      id: 'panama-claude',
      contextId: 'panama-england',
      contextName: '巴拿马 v 英格兰',
      marketCount: 4,
      createdAt: '2026-06-26T00:03:00.000Z',
      results: [
        { modelName: 'Claude 4.8', error: '余额不足', picks: [], scorePicks: [] }
      ]
    }, { mergeLatest: true });

    assert.equal(merged.contextId, 'panama-england');
    assert.deepEqual(merged.results.map((result) => result.modelName), ['GPT 5.5', 'Qwen', 'Claude 4.8']);
    assert.equal(storage.readDb().rankings.length, 2);
    assert.equal(storage.readDb().rankings[0].contextId, 'panama-england');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('upserting an imported match context refreshes capturedAt in place', async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'football-storage-'));
  process.chdir(tempDir);
  try {
    const storage = await import(`../src/storage.js?test=${Date.now()}-context`);
    storage.upsertMatchContext({
      matchId: '54329995',
      sourceUrl: 'https://www.dongqiudi.com/match/54329995',
      matchName: 'A v B',
      capturedAt: '2026-06-26T00:00:00.000Z'
    });
    storage.upsertMatchContext({
      matchId: '54329995',
      sourceUrl: 'https://www.dongqiudi.com/match/54329995',
      matchName: 'A v B',
      capturedAt: '2026-06-27T00:00:00.000Z'
    });

    const contexts = storage.readDb().matchContexts;
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].capturedAt, '2026-06-27T00:00:00.000Z');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
