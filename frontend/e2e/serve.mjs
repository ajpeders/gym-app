/**
 * Static server for the exported web build.
 *
 * Deliberately tiny: the e2e suite needs to serve `dist/` with an index.html
 * fallback so client-side routes survive a reload, and pulling in a server
 * package for that would be the only runtime dependency in the test harness.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8012);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

async function send(res, path) {
  const body = await readFile(path);
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    await send(res, join(root, rel === '/' ? 'index.html' : rel));
  } catch {
    try {
      // Expo exports a file per route; anything else is a client-side path.
      await send(res, join(root, `${rel}.html`));
    } catch {
      try {
        await send(res, join(root, 'index.html'));
      } catch {
        res.writeHead(404).end('not found');
      }
    }
  }
}).listen(port, () => console.log(`web build on http://127.0.0.1:${port}`));
