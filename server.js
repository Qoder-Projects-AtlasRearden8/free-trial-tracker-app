#!/usr/bin/env node
/*
 * A tiny static server for using Trialwise locally.
 * No third-party packages, no database, no outbound requests.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '4173', 10);

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// A service worker's own CSP also governs its cache fetches. Allow it to read
// same-origin shell files; the page itself keeps connect-src 'none'.
const SERVICE_WORKER_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
};
const SERVICE_WORKER_PATH = resolve(ROOT, 'sw.js');

function sendText(response, status, message, extraHeaders = {}) {
  const body = `${message}\n`;
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
    ...extraHeaders,
  });
  response.end(body);
}

function resolveRequestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = decoded.replace(/^\/+/, '');
  const candidates = relative === '' ? ['index.html'] : [relative];

  for (const candidate of candidates) {
    if (candidate.split('/').some((part) => part.startsWith('.'))) {
      return null;
    }
    const filePath = resolve(ROOT, candidate);
    if (filePath === ROOT || filePath.startsWith(ROOT + sep)) {
      return filePath;
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url, `http://${HOST}`).pathname;
  } catch {
    sendText(response, 400, 'Bad request.');
    return;
  }

  const filePath = resolveRequestPath(pathname);
  if (!filePath) {
    sendText(response, 404, 'Not found.');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendText(response, 404, 'Not found.');
      return;
    }

    const body = await readFile(filePath);
    const type =
      CONTENT_TYPES.get(extname(filePath).toLowerCase()) ||
      'application/octet-stream';
    const securityHeaders =
      filePath === SERVICE_WORKER_PATH
        ? SERVICE_WORKER_SECURITY_HEADERS
        : SECURITY_HEADERS;

    response.writeHead(200, {
      ...securityHeaders,
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });

    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      sendText(response, 404, 'Not found.');
      return;
    }
    console.error('Could not serve request:', error);
    sendText(response, 500, 'Something went wrong on the local server.');
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`Trialwise is running at http://${HOST}:${activePort}`);
  console.log('Press Ctrl+C to stop. Your data never leaves this device.');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Try: PORT=4174 npm start`,
    );
  } else {
    console.error('The local server could not start:', error);
  }
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
