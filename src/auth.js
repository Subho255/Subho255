import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Google sign-in (OAuth 2.0 authorization-code flow) with a signed
// session cookie. No external dependencies: the ID token is received
// directly from Google's token endpoint over TLS, which Google documents
// as sufficient to trust its claims without re-verifying the signature.

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const SESSION_COOKIE = 'hd_session';
const STATE_COOKIE = 'hd_oauth_state';
const SESSION_TTL_S = 7 * 24 * 3600;

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
  return verify(parseCookies(req.headers.cookie)[SESSION_COOKIE], cfg.secret);
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

  if (url.pathname === '/auth/google') {
    const state = b64(randomBytes(24));
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    redirect(res, `${GOOGLE_AUTH}?${params}`, [cookie(STATE_COOKIE, state, cfg, 600)]);
    return true;
  }

  if (url.pathname === '/auth/google/callback') {
    const clearState = cookie(STATE_COOKIE, '', cfg, 0);
    const fail = (reason) => redirect(res, `/login?error=${encodeURIComponent(reason)}`, [clearState]);
    const expectedState = parseCookies(req.headers.cookie)[STATE_COOKIE];
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

    const session = sign(
      { email: claims.email, name: claims.name ?? claims.email, picture: claims.picture ?? null, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S },
      cfg.secret,
    );
    redirect(res, '/', [clearState, cookie(SESSION_COOKIE, session, cfg, SESSION_TTL_S)]);
    return true;
  }
  return false;
}

// --- rate limiting ------------------------------------------------------------

/** Fixed-window per-user limiter to protect the shared TypeSafe API key. */
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
