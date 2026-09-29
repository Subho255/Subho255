import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APIError, APIConnectionError, TypeSafeClient } from '@typesafe-ai/sdk';
import { InputError, analyze } from './src/analyze.js';
import { MockTypeSafeClient } from './src/mock.js';
import { assertAuthConfig, authConfig, currentUser, handleAuth, rateLimiter } from './src/auth.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const MOCK = process.env.TYPESAFE_MOCK === '1';

const auth = authConfig();
assertAuthConfig(auth);

// The API key stays on the server; the browser only talks to /api/*.
const client = MOCK ? new MockTypeSafeClient() : new TypeSafeClient({ timeout: 20000 });
const limit = rateLimiter(Number(process.env.RATE_LIMIT_PER_HOUR ?? 30), 3600_000);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
// Reachable without signing in.
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/login.js', '/styles.css', '/healthz']);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function sendFile(res, rel) {
  const path = normalize(join(PUBLIC, rel));
  if (!path.startsWith(PUBLIC)) return send(res, 404, { error: 'Not found' });
  const file = await readFile(path).catch(() => null);
  if (!file) return send(res, 404, { error: 'Not found' });
  return send(res, 200, file, TYPES[extname(path)] ?? 'application/octet-stream');
}

async function readJson(req, limitBytes = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new InputError('Request too large.');
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
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/auth/') && (await handleAuth(req, res, url, auth))) return;

    const user = currentUser(req, auth);
    if (req.method === 'GET' && (url.pathname === '/login' || url.pathname === '/login.html')) {
      if (user && auth.enabled) return send(res, 302, '', 'text/plain', { location: '/' });
      return sendFile(res, 'login.html');
    }
    if (!user && !PUBLIC_PATHS.has(url.pathname)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Sign in required.' });
      return send(res, 302, '', 'text/plain', { location: '/login' });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, {
        mock: MOCK,
        model: client.defaultModel,
        user: { email: user.email, name: user.name, picture: user.picture ?? null },
        auth: auth.enabled,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const quota = limit(user.email);
      if (!quota.ok) {
        return send(res, 429, { error: `Hourly limit reached. Try again in ${Math.ceil(quota.retryAfterS / 60)} min.` }, 'application/json', { 'retry-after': String(quota.retryAfterS) });
      }
      const result = await analyze(client, await readJson(req));
      console.log(`analyze by ${user.email}: ${result.headlines.length} drafts, ${result.usage.requests} requests`);
      return send(res, 200, { ...result, mock: MOCK });
    }
    if (req.method === 'GET') return sendFile(res, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
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
  console.log(`Headline desk on ${auth.publicUrl}${MOCK ? ' (MOCK mode — heuristics, not Jev)' : ''}`);
  console.log(auth.enabled
    ? `Google sign-in on; allowed: ${[...auth.allowedEmails, ...auth.allowedDomains.map((d) => `@${d}`)].join(', ') || 'any verified Google account'}`
    : 'Google sign-in OFF (local development only)');
});
