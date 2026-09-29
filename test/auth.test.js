import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthConfig, authConfig, currentUser, handleAuth, isAllowed, rateLimiter, sign, verify } from '../src/auth.js';

const SECRET = 'x'.repeat(40);
const env = {
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'csecret',
  SESSION_SECRET: SECRET,
  PUBLIC_URL: 'https://hd.example.com/',
  ALLOWED_DOMAINS: 'Example.com',
  ALLOWED_EMAILS: 'friend@gmail.com',
};

function fakeRes() {
  return {
    status: 0, headers: {},
    writeHead(s, h) { this.status = s; this.headers = h; },
    end() {},
  };
}

test('config derives redirect URI and secure cookies from PUBLIC_URL', () => {
  const cfg = authConfig(env);
  assert.equal(cfg.redirectUri, 'https://hd.example.com/auth/google/callback');
  assert.equal(cfg.secureCookies, true);
  assert.doesNotThrow(() => assertAuthConfig(cfg, env));
});

test('production refuses to start without sign-in or with a weak secret', () => {
  assert.throws(() => assertAuthConfig(authConfig({}), { NODE_ENV: 'production' }), /GOOGLE_CLIENT_ID/);
  assert.doesNotThrow(() => assertAuthConfig(authConfig({}), {}));
  assert.throws(() => assertAuthConfig(authConfig({ ...env, SESSION_SECRET: 'short' }), env), /SESSION_SECRET/);
});

test('allowlist by email or domain; empty lists allow everyone', () => {
  const cfg = authConfig(env);
  assert.equal(isAllowed('a@example.com', cfg), true);
  assert.equal(isAllowed('FRIEND@gmail.com', cfg), true);
  assert.equal(isAllowed('stranger@gmail.com', cfg), false);
  assert.equal(isAllowed('anyone@gmail.com', authConfig({ ...env, ALLOWED_DOMAINS: '', ALLOWED_EMAILS: '' })), true);
});

test('signed sessions reject tampering and expiry', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = sign({ email: 'a@example.com', exp }, SECRET);
  assert.equal(verify(token, SECRET).email, 'a@example.com');
  assert.equal(verify(token, 'y'.repeat(40)), null);
  const [data, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'evil@x.com', exp })).toString('base64url');
  assert.equal(verify(`${forged}.${sig}`, SECRET), null);
  assert.equal(verify(`${data}.${sig}`, SECRET, Date.now() + 120_000), null);
});

test('without GOOGLE_CLIENT_ID a local dev user is used', () => {
  assert.equal(currentUser({ headers: {} }, authConfig({})).local, true);
  assert.equal(currentUser({ headers: {} }, authConfig(env)), null);
});

test('full OAuth round trip sets a session for an allowed, verified account', async () => {
  const cfg = authConfig(env);
  const start = fakeRes();
  await handleAuth({ headers: {} }, start, new URL('https://hd.example.com/auth/google'), cfg);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.location);
  assert.equal(loc.searchParams.get('redirect_uri'), cfg.redirectUri);
  const state = loc.searchParams.get('state');

  const claims = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, email: 'a@example.com', email_verified: true, name: 'A' };
  const idToken = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  let posted;
  const fakeFetch = async (url, init) => { posted = init.body; return { ok: true, json: async () => ({ id_token: idToken }) }; };

  const cb = fakeRes();
  await handleAuth(
    { headers: { cookie: `hd_oauth_state=${state}` } }, cb,
    new URL(`https://hd.example.com/auth/google/callback?code=abc&state=${state}`), cfg, fakeFetch,
  );
  assert.equal(posted.get('code'), 'abc');
  assert.equal(cb.headers.location, '/');
  const session = cb.headers['set-cookie'].find((c) => c.startsWith('hd_session='));
  assert.match(session, /HttpOnly/);
  assert.match(session, /Secure/);
  const value = decodeURIComponent(session.split(';')[0].split('=').slice(1).join('='));
  assert.equal(currentUser({ headers: { cookie: `hd_session=${encodeURIComponent(value)}` } }, cfg).email, 'a@example.com');
});

test('callback rejects state mismatch, wrong audience and disallowed accounts', async () => {
  const cfg = authConfig(env);
  const run = async (claims, cookieState = 's1', qState = 's1') => {
    const idToken = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
    const res = fakeRes();
    await handleAuth({ headers: { cookie: `hd_oauth_state=${cookieState}` } }, res,
      new URL(`https://hd.example.com/auth/google/callback?code=c&state=${qState}`), cfg,
      async () => ({ ok: true, json: async () => ({ id_token: idToken }) }));
    return res.headers.location;
  };
  const ok = { iss: 'accounts.google.com', aud: env.GOOGLE_CLIENT_ID, email: 'a@example.com', email_verified: true };
  assert.equal(await run(ok, 's1', 's2'), '/login?error=state');
  assert.equal(await run({ ...ok, aud: 'other' }), '/login?error=unverified');
  assert.equal(await run({ ...ok, email_verified: false }), '/login?error=unverified');
  assert.equal(await run({ ...ok, email: 'stranger@gmail.com' }), '/login?error=not_allowed');
  assert.equal(await run(ok), '/');
});

test('rate limiter blocks after the limit and resets after the window', () => {
  let t = 0;
  const limit = rateLimiter(2, 1000, () => t);
  assert.equal(limit('a').ok, true);
  assert.equal(limit('a').ok, true);
  assert.equal(limit('a').ok, false);
  assert.equal(limit('b').ok, true);
  t = 1000;
  assert.equal(limit('a').ok, true);
});
