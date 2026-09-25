import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APIError, APIConnectionError, TypeSafeClient } from '@typesafe-ai/sdk';
import { InputError, analyze } from './src/analyze.js';
import { MockTypeSafeClient } from './src/mock.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const MOCK = process.env.TYPESAFE_MOCK === '1';

// The API key stays on the server; the browser only talks to /api/*.
const client = MOCK ? new MockTypeSafeClient() : new TypeSafeClient({ timeout: 20000 });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new InputError('Request too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new InputError('Invalid JSON body.');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, { mock: MOCK, model: client.defaultModel });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const result = await analyze(client, await readJson(req));
      return send(res, 200, { ...result, mock: MOCK });
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const path = normalize(join(PUBLIC, rel));
      if (!path.startsWith(PUBLIC)) return send(res, 404, { error: 'Not found' });
      const file = await readFile(path).catch(() => null);
      if (!file) return send(res, 404, { error: 'Not found' });
      return send(res, 200, file, TYPES[extname(path)] ?? 'application/octet-stream');
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof InputError) return send(res, 400, { error: err.message });
    if (err instanceof APIError) {
      console.error(`TypeSafe API ${err.status} (request ${err.requestId ?? 'n/a'})`, err.body);
      return send(res, 502, { error: `TypeSafe API error ${err.status}`, requestId: err.requestId });
    }
    if (err instanceof APIConnectionError) {
      console.error('TypeSafe connection failed:', err.message);
      return send(res, 502, { error: 'Could not reach the TypeSafe API.' });
    }
    console.error(err);
    send(res, 500, { error: 'Internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`Headline desk on http://localhost:${PORT}${MOCK ? ' (MOCK mode — heuristics, not Jev)' : ''}`);
});
