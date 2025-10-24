#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const MIME_MAP = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.wasm', 'application/wasm'],
]);

const args = process.argv.slice(2);
const options = Object.fromEntries(
  args
    .map((arg) => arg.split('='))
    .filter(([key]) => key?.startsWith('--'))
    .map(([key, value]) => [key.slice(2), value ?? '']),
);

const rootDir = path.resolve(process.cwd(), options.root ?? 'dist');
const port = Number(options.port ?? process.env.PORT ?? 5173);
const spaFallback = options.spa !== 'false';

const indexPath = path.join(rootDir, 'index.html');
const LEADING_SLASH_RE = /^\/+/;

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePath(requestUrl) {
  let pathname = '/';
  try {
    pathname = new URL(requestUrl, 'http://localhost').pathname || '/';
  } catch {}
  const decodedPath = decodeURIComponent(pathname.replace(LEADING_SLASH_RE, ''));
  const candidate = path.join(rootDir, decodedPath);

  if (!candidate.startsWith(rootDir)) {
    return null;
  }

  try {
    const stats = await stat(candidate);
    if (stats.isDirectory()) {
      const indexCandidate = path.join(candidate, 'index.html');
      if (await fileExists(indexCandidate)) {
        return indexCandidate;
      }
    } else if (stats.isFile()) {
      return candidate;
    }
  } catch {
    // ignore - will handle fallback below
  }

  return null;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_MAP.get(ext) ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  createReadStream(filePath).pipe(res);
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

async function handler(req, res) {
  if (!req || !res || req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const filePath = await resolvePath(req.url ?? '/');

  if (filePath) {
    sendFile(res, filePath);
    return;
  }

  const acceptsHtml = (req.headers.accept ?? '').includes('text/html');
  if (spaFallback && acceptsHtml && (await fileExists(indexPath))) {
    sendFile(res, indexPath);
    return;
  }

  sendNotFound(res);
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Static server listening on 0.0.0.0:${port}, serving ${rootDir}`);
});
