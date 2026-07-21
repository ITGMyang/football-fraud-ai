import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('authentication loads the pinned Supabase client from the deployed origin', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/vendor\/supabase\.js"/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
  assert.equal(fs.existsSync(new URL('../public/vendor/supabase.js', import.meta.url)), true);
});
