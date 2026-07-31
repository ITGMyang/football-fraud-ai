import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adminConsoleUrl, adminHostname, allowedOnAdminHost, isAdminHost } from '../src/admin-host.js';

const env = { ADMIN_HOSTNAME: 'admin.futbots.cc' };

test('the console hostname is recognised however it is written', () => {
  assert.equal(adminHostname({ ADMIN_HOSTNAME: ' https://Admin.FutBots.cc/ ' }), 'admin.futbots.cc');
  assert.equal(isAdminHost(new URL('https://admin.futbots.cc/'), env), true);
  assert.equal(isAdminHost(new URL('https://futbots.cc/admin'), env), false);
});

test('without a configured hostname nothing is treated as the console host', () => {
  // Local development serves both from one origin, so the split must switch itself off.
  assert.equal(isAdminHost(new URL('http://localhost:3888/'), {}), false);
  assert.equal(adminConsoleUrl({}), '');
  assert.equal(adminConsoleUrl(env), 'https://admin.futbots.cc/');
});

test('the console host answers only what the console needs', () => {
  for (const path of ['/', '/admin', '/api/auth/config', '/api/admin/dashboard', '/build/admin.js', '/assets/back.svg', '/media/team-crests/33.png']) {
    assert.equal(allowedOnAdminHost(path), true, `${path} should be served`);
  }
  // The public app must not be reachable there, or the split buys nothing.
  for (const path of ['/login', '/match/1591866', '/api/rankings', '/api/matches', '/auth/callback']) {
    assert.equal(allowedOnAdminHost(path), false, `${path} should not be served`);
  }
});

test('the Worker splits the two hostnames and hides the console from the public site', async () => {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');

  // The region check runs before anything else, including the routes that answer early.
  const denialAt = worker.indexOf('const denial = regionDenial(request, url);');
  assert.ok(denialAt > 0, 'the region check must be wired in');
  assert.ok(denialAt < worker.indexOf("url.pathname === '/api/auth/config'"), 'it must run first');

  assert.match(worker, /if \(onAdminHost && !allowedOnAdminHost\(url\.pathname\)\) return notFound\(\);/);
  // /api/admin/* answering on the public hostname would leave the console reachable
  // there even with the shell moved.
  assert.match(worker, /if \(!onAdminHost && url\.pathname\.startsWith\('\/api\/admin\/'\)\) return notFound\(\);/);
  assert.match(worker, /onAdminHost && \(url\.pathname === '\/' \|\| url\.pathname === '\/admin'\)/);
  assert.match(worker, /if \(consoleUrl\) return Response\.redirect\(consoleUrl, 301\);/);
});

test('every request reaches the Worker, or neither the region check nor the split applies', async () => {
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"run_worker_first": \["\/\*"\]/);
  assert.match(wrangler, /"pattern": "admin\.futbots\.cc"/);
  assert.match(wrangler, /"ADMIN_HOSTNAME": "admin\.futbots\.cc"/);
});
