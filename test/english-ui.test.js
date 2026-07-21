import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const HAN = /[\p{Script=Han}]/u;

test('static website and authentication copy are English-only', async () => {
  const files = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/auth-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/auth-utils.js', import.meta.url), 'utf8')
  ]);

  for (const source of files) assert.doesNotMatch(source, HAN);
});

test('primary website actions and billing plans use English labels', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(markup, /FutBots/);
  assert.doesNotMatch(markup, /Football Fraud/);
  assert.match(markup, /Match Intelligence/);
  assert.match(markup, /Run All AI Models/);
  assert.match(markup, /24-Hour Pass/);
  assert.match(markup, /Weekly Pass/);
  assert.match(markup, /Monthly Pass/);
});

test('dynamic UI and API errors no longer use legacy Chinese interface copy', async () => {
  const [app, worker] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  ]);

  for (const phrase of ['暂无数据', '加载失败', '请先登录', '预测中', '已抓取', '比赛详情']) {
    assert.doesNotMatch(app, new RegExp(phrase));
    assert.doesNotMatch(worker, new RegExp(phrase));
  }
});

test('legacy non-English AI predictions are hidden from the English interface', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /function isEnglishPredictionResult\(result\)/);
  assert.match(app, /Legacy non-English predictions are hidden/);
  assert.match(app, /if \(!isEnglishPredictionResult\(result\)\) continue;/);
  assert.doesNotMatch(app, /\?{8,}/);
});
