import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrafficSource, countsAsArrival, summarizeTrafficSources } from '../src/traffic-source.js';

function arrival(referer, path = '/') {
  const url = new URL(`https://futbots.cc${path}`);
  return classifyTrafficSource({ headers: new Headers(referer ? { referer } : {}) }, url);
}

test('search engines are recognised across their country domains and subdomains', () => {
  for (const referer of [
    'https://www.google.com/', 'https://google.co.uk/search?q=x', 'https://news.google.com/',
    'https://www.bing.com/', 'https://duckduckgo.com/', 'https://www.baidu.com/'
  ]) {
    assert.equal(arrival(referer)?.source, 'search', referer);
  }
});

test('social platforms and their link shorteners are one bucket', () => {
  for (const referer of ['https://t.co/abc', 'https://x.com/post', 'https://m.facebook.com/', 'https://www.reddit.com/r/soccer', 'https://lnkd.in/x']) {
    assert.equal(arrival(referer)?.source, 'social', referer);
  }
});

test('assistants are counted apart from search', () => {
  // Being recommended by an assistant is a different arrival from ranking in a result
  // list, and folding them together would hide whichever one is growing.
  assert.equal(arrival('https://chatgpt.com/')?.source, 'assistant');
  assert.equal(arrival('https://www.perplexity.ai/search')?.source, 'assistant');
  assert.equal(arrival('https://gemini.google.com/app')?.source, 'assistant');
  // ...but plain Google is still search, even though the assistant lives on that domain.
  assert.equal(arrival('https://www.google.com/')?.source, 'search');
});

test('no referrer is direct and an unknown site is a referral', () => {
  assert.deepEqual(arrival(''), { source: 'direct', referrerHost: '', campaign: '' });
  assert.deepEqual(arrival('not a url'), { source: 'direct', referrerHost: '', campaign: '' });
  assert.deepEqual(arrival('https://someblog.example/post'), { source: 'referral', referrerHost: 'someblog.example', campaign: '' });
});

test('our own pages are navigation, not an arrival', () => {
  assert.equal(arrival('https://futbots.cc/match/1591866'), null);
  assert.equal(arrival('https://admin.futbots.cc/'), null);
  assert.equal(arrival('https://www.futbots.cc/'), null);
});

test('a tagged link is believed over the host that sent it', () => {
  const url = new URL('https://futbots.cc/?utm_source=Newsletter&utm_campaign=Launch');
  const tagged = classifyTrafficSource({ headers: new Headers({ referer: 'https://t.co/abc' }) }, url);
  // Tagging a link exists precisely because the referring host would mislead.
  assert.deepEqual(tagged, { source: 'campaign', referrerHost: 'newsletter', campaign: 'launch' });

  // Ad click ids arrive with no referrer at all in some browsers.
  const clicked = classifyTrafficSource({ headers: new Headers() }, new URL('https://futbots.cc/?gclid=abc'));
  assert.equal(clicked.source, 'campaign');
  assert.equal(clicked.referrerHost, 'google ads');
});

test('the summary totals by bucket and keeps referrers ranked', () => {
  const summary = summarizeTrafficSources([
    { source: 'search', referrer_host: 'google.com', campaign: '', views: 60 },
    { source: 'search', referrer_host: 'bing.com', campaign: '', views: 20 },
    { source: 'direct', referrer_host: '', campaign: '', views: 20 },
    { source: 'social', referrer_host: 't.co', campaign: '', views: 0 }
  ]);

  assert.equal(summary.total, 100);
  assert.deepEqual(summary.sources.map((row) => [row.source, row.views, row.share]), [
    ['search', 80, 0.8],
    ['direct', 20, 0.2]
  ]);
  assert.equal(summary.referrers[0].referrerHost, 'google.com');
  // A row with no views is not a source anybody arrived from.
  assert.equal(summary.sources.some((row) => row.source === 'social'), false);
});

test('only pages reachable from outside are counted as arrivals', () => {
  assert.equal(countsAsArrival('/'), true);
  assert.equal(countsAsArrival('/match/1591866'), true);
  // The OAuth callback carries a referrer of accounts.google.com, which would file
  // every Google sign-in as a visit from search.
  assert.equal(countsAsArrival('/auth/callback'), false);
  assert.equal(countsAsArrival('/auth/reset'), false);
  assert.equal(countsAsArrival('/login'), false);
});
