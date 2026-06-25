import { ProxyAgent } from 'undici';

const proxyAgents = new Map();

export function createOpenRouterFetch(env = process.env, baseFetch = fetch) {
  const proxyUrl = env.OPENROUTER_PROXY_URL || env.HTTPS_PROXY || env.HTTP_PROXY || '';
  if (!proxyUrl) return baseFetch;

  return (url, options = {}) => baseFetch(url, {
    ...options,
    dispatcher: proxyAgent(proxyUrl)
  });
}

function proxyAgent(proxyUrl) {
  if (!proxyAgents.has(proxyUrl)) {
    proxyAgents.set(proxyUrl, new ProxyAgent(proxyUrl));
  }
  return proxyAgents.get(proxyUrl);
}
