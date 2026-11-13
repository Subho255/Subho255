import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Google sign-in (OAuth 2.0 authorization-code flow) with a signed
// session cookie. No external dependencies: the ID token is received
// directly from Google's token endpoint over TLS, which Google documents
// as sufficient to trust its claims without re-verifying the signature.

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const SESSION_COOKIE = 'hd_session';
const STATE_COOKIE = 'hd_oauth_state';
const EXT_COOKIE = 'hd_ext_login';
const SESSION_TTL_S = 7 * 24 * 3600;
// Sign-in for the Chrome extension lasts 30 days, then the user clicks "Sign in" again.
export const EXT_TOKEN_TTL_S = 30 * 24 * 3600;
// chrome.identity.getRedirectURL() always has this shape; nothing else may receive a token.
const EXT_REDIRECT = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/[\w\-./]*$/;

const list = (v) => String(v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function authConfig(env = process.env) {
  const publicUrl = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, '');
  return {
    enabled: Boolean(env.GOOGLE_CLIENT_ID),
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    secret: env.SESSION_SECRET,
    publicUrl,
    redirectUri: `${publicUrl}/auth/google/callback`,
    secureCookies: publicUrl.startsWith('https://'),
    allowedEmails: list(env.ALLOWED_EMAILS),
    allowedDomains: list(env.ALLOWED_DOMAINS),
    // Require the Google account to be managed by the allowed Google Workspace domain
    // (the ID token's "hd" claim), not just to have an address at that domain.
    requireWorkspace: ['1', 'true', 'yes'].includes(String(env.REQUIRE_WORKSPACE ?? '').toLowerCase()),
    // Optional: only these extension IDs may sign in. Empty = any copy of the extension.
    extensionIds: list(env.EXTENSION_IDS),
  };
}

/** Fail fast on a half-configured deployment rather than serving it open. */
export function assertAuthConfig(cfg, env = process.env) {
  if (!cfg.enabled) {
    if (env.NODE_ENV === 'production') {
      throw new Error('GOOGLE_CLIENT_ID is required in production; refusing to start without sign-in.');
    }
    return;
  }
  if (!cfg.clientSecret) throw new Error('GOOGLE_CLIENT_SECRET is required when GOOGLE_CLIENT_ID is set.');
  if (!cfg.secret || cfg.secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
}

/** Empty allowlists mean any verified Google account may sign in. */
export function isAllowed(email, cfg) {
  const e = String(email ?? '').toLowerCase();
  if (!cfg.allowedEmails.length && !cfg.allowedDomains.length) return true;
  return cfg.allowedEmails.includes(e) || cfg.allowedDomains.includes(e.split('@')[1]);
}

// --- signed values ------------------------------------------------------

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const mac = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

export function sign(payload, secret) {
  const data = b64(JSON.stringify(payload));
  return `${data}.${mac(data, secret)}`;
}

export function verify(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = mac(data, secret);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return payload.exp && payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

// --- cookies --------------------------------------------------------------

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

function cookie(name, value, cfg, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`,
    cfg.secureCookies ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

// --- request handling ------------------------------------------------------

/** The signed-in user for a request, or null. With auth disabled, a local dev user. */
export function currentUser(req, cfg) {
  if (!cfg.enabled) return { email: 'local@dev', name: 'Local dev', local: true };
  // The extension sends "Authorization: Bearer <token>"; the web app uses the session cookie.
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
  const user = verify(bearer ?? parseCookies(req.headers.cookie)[SESSION_COOKIE], cfg.secret);
  if (!user) return null;
  // An extension token is only valid as a bearer token, and a session only as a cookie.
  if ((user.typ === 'ext') !== Boolean(bearer)) return null;
  // Re-check the allowlist on every request, so removing someone takes effect at once.
  return isAllowed(user.email, cfg) ? user : null;
}

/** Validates the redirect URL a Chrome extension asks for. Returns it, or null. */
export function extensionRedirect(value, cfg) {
  const m = EXT_REDIRECT.exec(String(value ?? ''));
  if (!m) return null;
  if (cfg.extensionIds.length && !cfg.extensionIds.includes(m[1])) return null;
  return m[0];
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, { location, 'set-cookie': cookies, 'cache-control': 'no-store' });
  res.end();
}

/**
 * Handle /auth/* routes. Returns true if the request was handled.
 * `fetchImpl` is injectable for tests.
 */
export async function handleAuth(req, res, url, cfg, fetchImpl = fetch) {
  if (url.pathname === '/auth/logout') {
    redirect(res, '/login', [cookie(SESSION_COOKIE, '', cfg, 0)]);
    return true;
  }
  if (!cfg.enabled) return false;

  const startGoogle = (extra = []) => {
    const state = b64(randomBytes(24));
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    // With a single company domain, ask Google to offer only accounts from it.
    // This only filters the account picker; the callback still enforces the allowlist.
    if (cfg.allowedDomains.length === 1 && !cfg.allowedEmails.length) params.set('hd', cfg.allowedDomains[0]);
    redirect(res, `${GOOGLE_AUTH}?${params}`, [cookie(STATE_COOKIE, state, cfg, 600), ...extra(state)]);
  };

  if (url.pathname === '/auth/google') {
    startGoogle(() => [cookie(EXT_COOKIE, '', cfg, 0)]);
    return true;
  }

  // Sign-in started from the Chrome extension (chrome.identity.launchWebAuthFlow).
  if (url.pathname === '/auth/extension') {
    const target = extensionRedirect(url.searchParams.get('redirect'), cfg);
    if (!target) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('Invalid extension redirect.');
      return true;
    }
    startGoogle((state) => [cookie(EXT_COOKIE, sign({ s: state, to: target, exp: Math.floor(Date.now() / 1000) + 600 }, cfg.secret), cfg, 600)]);
    return true;
  }

  if (url.pathname === '/auth/google/callback') {
    const cookies = parseCookies(req.headers.cookie);
    const expectedState = cookies[STATE_COOKIE];
    // Was this sign-in started by the extension? Only if the signed cookie matches this state.
    const ext = verify(cookies[EXT_COOKIE], cfg.secret);
    const toExtension = ext && ext.s === expectedState && extensionRedirect(ext.to, cfg);
    const clearState = [cookie(STATE_COOKIE, '', cfg, 0), cookie(EXT_COOKIE, '', cfg, 0)];
    const fail = (reason) => (toExtension
      ? redirect(res, `${toExtension}#error=${encodeURIComponent(reason)}`, clearState)
      : redirect(res, `/login?error=${encodeURIComponent(reason)}`, clearState));
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error')) return fail('cancelled'), true;
    if (!code || !expectedState || url.searchParams.get('state') !== expectedState) return fail('state'), true;

    const tokenRes = await fetchImpl(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      console.error('Google token exchange failed', tokenRes.status, await tokenRes.text().catch(() => ''));
      return fail('google'), true;
    }
    const { id_token: idToken } = await tokenRes.json();
    let claims;
    try {
      claims = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    } catch {
      return fail('google'), true;
    }
    const validIssuer = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
    if (!validIssuer || claims.aud !== cfg.clientId || !claims.email || claims.email_verified !== true) {
      return fail('unverified'), true;
    }
    if (!isAllowed(claims.email, cfg)) return fail('not_allowed'), true;
    const domain = claims.email.toLowerCase().split('@')[1];
    const byDomainOnly = !cfg.allowedEmails.includes(claims.email.toLowerCase()) && cfg.allowedDomains.includes(domain);
    if (cfg.requireWorkspace && byDomainOnly && String(claims.hd ?? '').toLowerCase() !== domain) {
      return fail('not_workspace'), true;
    }

    if (toExtension) {
      const name = claims.name ?? claims.email;
      const token = sign({ typ: 'ext', email: claims.email, name, exp: Math.floor(Date.now() / 1000) + EXT_TOKEN_TTL_S }, cfg.secret);
      const frag = new URLSearchParams({ token, email: claims.email, name, expires_in: String(EXT_TOKEN_TTL_S) });
      console.log(`extension sign-in: ${claims.email}`);
      redirect(res, `${toExtension}#${frag}`, clearState);
      return true;
    }

    const session = sign(
      { email: claims.email, name: claims.name ?? claims.email, picture: claims.picture ?? null, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S },
      cfg.secret,
    );
    redirect(res, '/', [...clearState, cookie(SESSION_COOKIE, session, cfg, SESSION_TTL_S)]);
    return true;
  }
  return false;
}

// --- rate limiting ------------------------------------------------------------

/** Fixed-window per-user limiter to protect the shared API keys. */
export function rateLimiter(limit, windowMs, now = () => Date.now()) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      return { ok: true, remaining: limit - 1 };
    }
    if (entry.count >= limit) return { ok: false, retryAfterS: Math.ceil((entry.start + windowMs - t) / 1000) };
    entry.count += 1;
    return { ok: true, remaining: limit - entry.count };
  };
}
