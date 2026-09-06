// Zero-dependency launcher for the included production build. Localhost only.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('./dist/', import.meta.url));
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let target = resolve(root, '.' + path);
    if (target !== resolve(root) && !target.startsWith(resolve(root) + sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
    const bytes = await readFile(target);
    res.writeHead(200, {
      'Content-Type': mime[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(bytes);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
server.listen(4173, '127.0.0.1', () =>
  console.log(
    'Kelana is ready at http://localhost:4173 — keep this terminal open for the first visit.',
  ),
);
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
