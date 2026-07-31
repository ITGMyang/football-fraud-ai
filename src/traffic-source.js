// Where a visitor came from, worked out at the edge.
//
// Cloudflare's zone analytics has no referrer dimension on this plan, so the Worker
// reads the Referer header itself. Only the referring host is kept, never the full
// referring URL - that URL can carry the visitor's search terms and account pages,
// and the host alone answers the question being asked.

const SEARCH_HOSTS = [
  'google.', 'bing.com', 'duckduckgo.com', 'baidu.com', 'yahoo.', 'yandex.',
  'sogou.com', 'so.com', 'naver.com', 'ecosia.org', 'brave.com', 'startpage.com',
  'qwant.com', 'search.marginalia.nu'
];

const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'instagram.com', 't.co', 'twitter.com', 'x.com',
  'reddit.com', 'linkedin.com', 'lnkd.in', 'tiktok.com', 'douyin.com',
  'youtube.com', 'youtu.be', 'telegram.org', 't.me', 'whatsapp.com',
  'weibo.com', 'zhihu.com', 'xiaohongshu.com', 'discord.com', 'pinterest.',
  'threads.net', 'threads.com', 'quora.com', 'tumblr.com', 'vk.com', 'line.me'
];

// Assistants send real traffic now and answer a different question from search:
// somebody was recommended the site rather than finding it in a result list.
const ASSISTANT_HOSTS = [
  'chatgpt.com', 'chat.openai.com', 'openai.com', 'perplexity.ai',
  'claude.ai', 'anthropic.com', 'gemini.google.com', 'copilot.microsoft.com',
  'you.com', 'poe.com', 'kimi.moonshot.cn', 'doubao.com', 'tongyi.aliyun.com'
];

export const TRAFFIC_SOURCES = ['campaign', 'search', 'social', 'assistant', 'referral', 'direct'];

// Only pages somebody can land on from outside. /auth/callback in particular carries a
// referrer of accounts.google.com, so counting it would file every Google sign-in as a
// visit from search.
export function countsAsArrival(pathname = '') {
  return pathname === '/' || pathname.startsWith('/match/');
}

export function classifyTrafficSource(request, url) {
  const params = url?.searchParams;
  const campaign = clean(params?.get('utm_campaign'));
  const utmSource = clean(params?.get('utm_source'));
  const referrerHost = hostOf(readHeader(request, 'referer'));

  // A tagged link says what it is, so it is believed over the referring host: the
  // whole point of tagging a link is that the host would have been misleading.
  if (utmSource) {
    return { source: 'campaign', referrerHost: utmSource.toLowerCase(), campaign: campaign.toLowerCase() };
  }
  // Ad click ids arrive with no referrer at all on some browsers.
  if (params?.get('gclid')) return { source: 'campaign', referrerHost: 'google ads', campaign: campaign.toLowerCase() };
  if (params?.get('fbclid')) return { source: 'campaign', referrerHost: 'facebook ads', campaign: campaign.toLowerCase() };

  if (!referrerHost) return { source: 'direct', referrerHost: '', campaign: '' };
  // Our own pages are navigation, not arrivals.
  if (isOwnHost(referrerHost, url)) return null;

  // An entry ending in a dot is a prefix - "google." covers google.com, google.co.uk
  // and news.google.com. Everything else is an exact host or a subdomain of one.
  const matches = (list) => list.some((entry) => (entry.endsWith('.')
    ? referrerHost.startsWith(entry) || referrerHost.includes(`.${entry}`)
    : referrerHost === entry || referrerHost.endsWith(`.${entry}`)));

  if (matches(ASSISTANT_HOSTS)) return { source: 'assistant', referrerHost, campaign: '' };
  if (matches(SEARCH_HOSTS)) return { source: 'search', referrerHost, campaign: '' };
  if (matches(SOCIAL_HOSTS)) return { source: 'social', referrerHost, campaign: '' };
  return { source: 'referral', referrerHost, campaign: '' };
}

export function summarizeTrafficSources(rows = []) {
  const bySource = new Map();
  const byReferrer = new Map();
  let total = 0;

  for (const row of rows) {
    const source = String(row.source || row.source_name || '').toLowerCase();
    const referrerHost = String(row.referrer_host ?? row.referrerHost ?? '');
    const campaign = String(row.campaign || '');
    const views = Number(row.views) || 0;
    if (!source || views <= 0) continue;
    total += views;
    bySource.set(source, (bySource.get(source) || 0) + views);
    const key = `${source}|${referrerHost}|${campaign}`;
    const seen = byReferrer.get(key) || { source, referrerHost, campaign, views: 0 };
    seen.views += views;
    byReferrer.set(key, seen);
  }

  const share = (views) => (total > 0 ? Math.round((views / total) * 10000) / 10000 : 0);
  return {
    total,
    sources: TRAFFIC_SOURCES
      .map((source) => ({ source, views: bySource.get(source) || 0 }))
      .filter((row) => row.views > 0)
      .map((row) => ({ ...row, share: share(row.views) }))
      .sort((left, right) => right.views - left.views),
    referrers: [...byReferrer.values()]
      .sort((left, right) => right.views - left.views)
      .slice(0, 40)
      .map((row) => ({ ...row, share: share(row.views) }))
  };
}

function isOwnHost(referrerHost, url) {
  const own = String(url?.hostname || '').toLowerCase();
  if (!own) return false;
  const root = own.split('.').slice(-2).join('.');
  return referrerHost === own || referrerHost === root || referrerHost.endsWith(`.${root}`);
}

function hostOf(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function readHeader(request, name) {
  const headers = request?.headers;
  if (typeof headers?.get === 'function') return headers.get(name) || '';
  return headers?.[name.toLowerCase()] || headers?.[name] || '';
}

function clean(value) {
  return String(value || '').trim().slice(0, 120);
}
