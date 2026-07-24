import path from 'node:path';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.ico', 'image/x-icon']
]);

export function resolvePublicAsset(publicDir, pathname) {
  const requestPath = String(pathname || '');
  if (!requestPath.startsWith('/') || requestPath.startsWith('/api/') || requestPath.includes('\0')) return null;
  const root = path.resolve(publicDir);
  const file = path.resolve(root, requestPath.slice(1));
  if (file === root || !file.startsWith(`${root}${path.sep}`)) return null;
  const contentType = CONTENT_TYPES.get(path.extname(file).toLowerCase());
  return contentType ? { file, contentType } : null;
}
