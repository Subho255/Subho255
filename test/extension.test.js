import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig, currentUser, extensionRedirect, handleAuth, sign } from '../src/auth.js';
import { headlineErrorResponse, headlineService } from '../src/headlines.js';

const SECRET = 'x'.repeat(40);
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const REDIRECT = `https://${EXT_ID}.chromiumapp.org/`;
const env = {
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'csecret',
  SESSION_SECRET: SECRET,
  PUBLIC_URL: 'https://hd.example.com',
  ALLOWED_DOMAINS: 'jagrannewmedia.com',
};

function fakeRes() {
  return {
    status: 0, headers: {}, body: '',
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b = '') { this.body = b; },
  };
}
const cookieValue = (res, name) => {
  const c = res.headers['set-cookie'].find((x) => x.startsWith(`${name}=`));
  return decodeURIComponent(c.split(';')[0].split('=').slice(1).join('='));
};
const idTokenFor = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const google = (claims) => async () => ({ ok: true, json: async () => ({ id_token: idTokenFor(claims) }) });

/** Runs /auth/extension then the Google callback, returning the final redirect URL. */
async function extensionSignIn(cfg, claims) {
  const start = fakeRes();
  await handleAuth({ headers: {} }, start, new URL(`https://hd.example.com/auth/extension?redirect=${encodeURIComponent(REDIRECT)}`), cfg);
  assert.equal(start.status, 302);
  const state = new URL(start.headers.location).searchParams.get('state');
  const cookie = `hd_oauth_state=${state}; hd_ext_login=${encodeURIComponent(cookieValue(start, 'hd_ext_login'))}`;
  const cb = fakeRes();
  await handleAuth({ headers: { cookie } }, cb, new URL(`https://hd.example.com/auth/google/callback?code=c&state=${state}`), cfg, google(claims));
  return new URL(cb.headers.location);
}

const company = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, email: 'atul.tyagi@jagrannewmedia.com', email_verified: true, name: 'Atul', hd: 'jagrannewmedia.com' };

test('only chromiumapp.org redirects are accepted, optionally limited to known extension IDs', () => {
  const cfg = authConfig(env);
  assert.equal(extensionRedirect(REDIRECT, cfg), REDIRECT);
  assert.equal(extensionRedirect('https://evil.example.com/', cfg), null);
  assert.equal(extensionRedirect(`http://${EXT_ID}.chromiumapp.org/`, cfg), null);
  assert.equal(extensionRedirect(`https://${EXT_ID}.chromiumapp.org.evil.com/`, cfg), null);
  assert.equal(extensionRedirect(REDIRECT, authConfig({ ...env, EXTENSION_IDS: 'b'.repeat(32) })), null);
  assert.equal(extensionRedirect(REDIRECT, authConfig({ ...env, EXTENSION_IDS: EXT_ID })), REDIRECT);
});

test('extension sign-in asks Google for the company domain and rejects bad redirects', async () => {
  const cfg = authConfig(env);
  const res = fakeRes();
  await handleAuth({ headers: {} }, res, new URL(`https://hd.example.com/auth/extension?redirect=${encodeURIComponent(REDIRECT)}`), cfg);
  const loc = new URL(res.headers.location);
  assert.equal(loc.searchParams.get('hd'), 'jagrannewmedia.com');
  assert.equal(loc.searchParams.get('redirect_uri'), cfg.redirectUri);

  const bad = fakeRes();
  await handleAuth({ headers: {} }, bad, new URL('https://hd.example.com/auth/extension?redirect=https%3A%2F%2Fevil.com%2F'), cfg);
  assert.equal(bad.status, 400);
});

test('a company account gets a token that works only as a bearer token', async () => {
  const cfg = authConfig(env);
  const done = await extensionSignIn(cfg, company);
  assert.equal(`${done.origin}/`, REDIRECT);
  const frag = new URLSearchParams(done.hash.slice(1));
  assert.equal(frag.get('email'), 'atul.tyagi@jagrannewmedia.com');
  const token = frag.get('token');

  assert.equal(currentUser({ headers: { authorization: `Bearer ${token}` } }, cfg).email, 'atul.tyagi@jagrannewmedia.com');
  assert.equal(currentUser({ headers: { cookie: `hd_session=${encodeURIComponent(token)}` } }, cfg), null);

  const session = sign({ email: 'atul.tyagi@jagrannewmedia.com', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  assert.equal(currentUser({ headers: { authorization: `Bearer ${session}` } }, cfg), null);
});

test('other accounts are refused and the error goes back to the extension', async () => {
  const cfg = authConfig(env);
  const gmail = await extensionSignIn(cfg, { ...company, email: 'someone@gmail.com', hd: undefined });
  assert.equal(gmail.hash, '#error=not_allowed');
  const lookalike = await extensionSignIn(cfg, { ...company, email: 'x@jagrannewmedia.com.evil.io' });
  assert.equal(lookalike.hash, '#error=not_allowed');
});

test('REQUIRE_WORKSPACE refuses company addresses not managed by the Workspace domain', async () => {
  const cfg = authConfig({ ...env, REQUIRE_WORKSPACE: '1' });
  const noHd = await extensionSignIn(cfg, { ...company, hd: undefined });
  assert.equal(noHd.hash, '#error=not_workspace');
  const ok = await extensionSignIn(cfg, company);
  assert.ok(new URLSearchParams(ok.hash.slice(1)).get('token'));
});

test('removing a domain from the allowlist blocks existing tokens', async () => {
  const done = await extensionSignIn(authConfig(env), company);
  const token = new URLSearchParams(done.hash.slice(1)).get('token');
  const narrowed = authConfig({ ...env, ALLOWED_DOMAINS: 'other.com' });
  assert.equal(currentUser({ headers: { authorization: `Bearer ${token}` } }, narrowed), null);
});

const ARTICLE = 'The Reserve Bank of India kept the repo rate unchanged at 5.5 per cent on Friday. '.repeat(5);

test('headline service sends the shared prompt with fallbacks and parses the reply', async () => {
  let sent;
  const reply = {
    article_language: 'English', primary_keyword: 'RBI repo rate', secondary_keywords: [],
    headlines: [{ strategy: 'search', angle: 'Keyword first', headline: 'RBI repo rate unchanged at 5.5%', focus_keyword: 'RBI repo rate', rationale: 'r', caution: '' }],
    url_slug: 'rbi-repo-rate', meta_description: 'm', current_headline_feedback: '',
  };
  const client = { beta: { messages: { create: async (body) => {
    sent = body;
    return { model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: {} };
  } } } };
  const result = await headlineService({ client, model: 'claude-opus-5-5' })({ article: ARTICLE, focusKeyword: 'RBI' });
  assert.deepEqual(sent.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(sent.fallbacks, 'default');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.match(sent.messages[0].content, /Focus keyword from the editor: RBI/);
  assert.equal(result.headlines[0].headline, 'RBI repo rate unchanged at 5.5%');
});

test('headline errors map to safe HTTP responses', async () => {
  const none = headlineService({ client: null });
  await assert.rejects(none({ article: ARTICLE }), (e) => headlineErrorResponse(e).status === 503);
  const svc = headlineService({ client: { beta: { messages: { create: async () => ({}) } } } });
  await assert.rejects(svc({ article: 'too short' }), (e) => headlineErrorResponse(e).status === 422);
});
