// How the Worker answers for the two HTML shells, for bundles, and for a miss.

export function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// The shell names a content-hashed bundle, so a cached copy outlives the file it
// points at: the next deploy deletes that bundle, the stale HTML still asks for it,
// and the SPA fallback answers with HTML that the browser tries to run as JavaScript.
// Nothing renders and the page goes black. Build the headers from scratch - copying
// the asset response carried its ETag, which let revalidation keep serving the stale
// body - and use no-store plus CDN-Cache-Control, which is the header Cloudflare's
// own edge honours.
export async function serveShell(env, url, request, shellPath) {
  const shell = await env.ASSETS.fetch(new Request(new URL(shellPath, url.origin), request));
  return new Response(shell.body, {
    status: shell.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      'CDN-Cache-Control': 'no-store'
    }
  });
}

// The SPA fallback answers anything it cannot find with index.html, including a
// bundle that no longer exists - so the browser gets 200 text/html for a <script>
// and runs the markup as JavaScript. A 404 lets it fail as a failed script load
// instead, which the error boundary and a plain reload can both recover from.
export async function serveBundle(env, request) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.ok && (asset.headers.get('Content-Type') || '').includes('text/html')) return notFound();
  return asset;
}
