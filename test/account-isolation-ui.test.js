import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('auth changes reload account-scoped prediction data', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /<script defer src="\/app\.js\?/);
  assert.match(app, /else refreshForAccountChange\(\)/);
  assert.match(app, /async function refreshForAccountChange\(\)[\s\S]*?await syncAccessStatus\(\);[\s\S]*?await refresh\(\);/);
  assert.match(app, /await \(window\.footballAuthReady \|\| Promise\.resolve\(\)\)/);
});

test('in-progress predictions survive navigation between app pages', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="predictionTaskStatus"/);
  assert.match(app, /function bindAppNavigation\(\)/);
  assert.match(app, /event\.preventDefault\(\);[\s\S]*?history\.pushState/);
  assert.match(app, /activePredictionTask = \{[\s\S]*?status: 'running'/);
  assert.match(app, /Prediction continues while you browse/);
  assert.match(app, /async function loadCurrentAppRoute\(\)/);
});
