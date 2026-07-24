import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePublicAsset } from '../src/static-assets.js';

test('local server resolves built frontend assets inside public only', () => {
  const root = '/app/public';
  assert.deepEqual(resolvePublicAsset(root, '/build/app.js'), {
    file: '/app/public/build/app.js',
    contentType: 'text/javascript; charset=utf-8'
  });
  assert.equal(resolvePublicAsset(root, '/assets/brand-ball.svg').contentType, 'image/svg+xml');
  assert.equal(resolvePublicAsset(root, '/assets/fonts/manrope-latin.woff2').contentType, 'font/woff2');
  assert.equal(resolvePublicAsset(root, '/../../secret.txt'), null);
  assert.equal(resolvePublicAsset(root, '/api/auth/status'), null);
});
