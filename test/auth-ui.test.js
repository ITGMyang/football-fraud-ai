import test from 'node:test';
import assert from 'node:assert/strict';

import { authErrorMessage, authRedirectUrl, guestAccessLabel, safeNextPath } from '../public/auth-utils.js';

test('safe next path keeps local destinations and rejects external redirects', () => {
  assert.equal(safeNextPath('/data?date=2026-07-11'), '/data?date=2026-07-11');
  assert.equal(safeNextPath('//evil.example/path'), '/');
  assert.equal(safeNextPath('https://evil.example/path'), '/');
});

test('auth errors are translated without exposing implementation details', () => {
  assert.equal(authErrorMessage({ message: 'Invalid login credentials' }), '邮箱或密码不正确');
  assert.equal(authErrorMessage({ message: 'Email not confirmed' }), '请先打开确认邮件完成验证');
  assert.equal(authErrorMessage({ message: 'User already registered' }), '这个邮箱已经注册，可以直接登录');
  assert.equal(authErrorMessage({ message: 'network request failed' }), '登录服务暂时不可用，请稍后重试');
});

test('guest access label describes remaining prediction access', () => {
  assert.deepEqual(guestAccessLabel({ authenticated: false, guestPredictionUsed: false }), {
    tone: 'available',
    title: '访客体验：剩余 1 次 AI 预测',
    detail: '无需登录即可浏览公开内容。本次体验使用 Qwen。'
  });
  assert.equal(guestAccessLabel({ authenticated: false, guestPredictionUsed: true }).tone, 'used');
  assert.deepEqual(guestAccessLabel({
    authenticated: true,
    billing: { tier: 'free', active: false, freePredictionUsed: false }
  }), {
    tone: 'available',
    title: '免费账户：剩余 1 次 Qwen 预测',
    detail: '预测结果会保存在当前账号下。订阅后可使用全部 AI 模型。'
  });
  assert.equal(guestAccessLabel({
    authenticated: true,
    billing: { tier: 'locked', active: false, freePredictionUsed: true }
  }).tone, 'used');
  assert.equal(guestAccessLabel({
    authenticated: true,
    billing: { tier: 'paid', active: true, validUntil: '2026-08-20T00:00:00.000Z' }
  }).tone, 'signed-in');
});

test('OAuth redirects use the configured production origin', () => {
  assert.equal(authRedirectUrl('https://futbots.cc/', '/auth/callback'), 'https://futbots.cc/auth/callback');
  assert.equal(authRedirectUrl('https://futbots.cc', '/auth/reset'), 'https://futbots.cc/auth/reset');
  assert.equal(authRedirectUrl('https://futbots.cc', '//evil.example/path'), 'https://futbots.cc/');
});
