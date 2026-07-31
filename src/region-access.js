// Mainland China is blocked at the edge. Hong Kong (HK), Macau (MO) and Taiwan (TW)
// carry their own country codes and are deliberately not in this set.
const BLOCKED_COUNTRIES = new Set(['CN']);

// Signature-checked machine callbacks keep working wherever they originate. A payment
// webhook answered with 451 silently loses the order it was confirming, and the sender
// is a server whose location we neither control nor care about.
const MACHINE_PATHS = new Set([
  '/api/billing/webhook',
  '/api/internal/api-football-cache/refresh'
]);

const DENIED_BODY = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unavailable in your region</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d10; color: #e6e8eb;
        font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
      main { max-width: 32rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
      p { margin: 0 0 0.5rem; color: #9aa3ad; }
    </style>
  </head>
  <body>
    <main>
      <h1>FutBots is not available in your region</h1>
      <p>This service cannot be accessed from mainland China.</p>
      <p lang="zh">本服务不向中国大陆地区提供。</p>
    </main>
  </body>
</html>
`;

export function regionDenial(request, url) {
  const country = String(request?.cf?.country || '').toUpperCase();
  if (!BLOCKED_COUNTRIES.has(country)) return null;
  if (MACHINE_PATHS.has(url?.pathname)) return null;
  return new Response(DENIED_BODY, {
    status: 451,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A response that depends on the visitor's country must never be reused for a
      // different visitor, so it is kept out of both browser and edge caches.
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store'
    }
  });
}
