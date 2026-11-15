// Company-server mode: the extension signs in with Google through the company server and
// sends articles there. The server holds the Anthropic key and only accepts company accounts.
import { HeadlineError } from './claude.js';

export class SignInRequired extends HeadlineError {}

const SIGN_IN_ERRORS = {
  not_allowed: 'Only company Google accounts can sign in. Choose your @jagrannewmedia.com account.',
  not_workspace: 'Use your company Google Workspace account to sign in.',
  unverified: 'Google did not confirm the email for this account.',
  state: 'Sign-in expired. Try again.',
  cancelled: 'Sign-in was cancelled.',
  google: 'Google sign-in failed. Try again.',
};

/** Returns a cleaned server URL, or throws if it is not https (or localhost for testing). */
export function normaliseServerUrl(value) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HeadlineError('The server URL is not valid.');
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new HeadlineError('The server URL must start with https://');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Opens Google sign-in through the company server. Resolves to { token, email, name, expiresAt }. */
export async function signIn(serverUrl) {
  const url = `${serverUrl}/auth/extension?redirect=${encodeURIComponent(chrome.identity.getRedirectURL())}`;
  let finalUrl;
  try {
    finalUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/did not approve|closed|cancel/i.test(msg)) throw new HeadlineError(SIGN_IN_ERRORS.cancelled);
    throw new HeadlineError(`Could not open sign-in. Check the server URL. (${msg})`);
  }
  const params = new URLSearchParams(new URL(finalUrl).hash.slice(1));
  const error = params.get('error');
  if (error) throw new HeadlineError(SIGN_IN_ERRORS[error] ?? 'Sign-in failed.');
  const token = params.get('token');
  if (!token) throw new HeadlineError('Sign-in failed: the server sent no token.');
  return {
    token,
    email: params.get('email') ?? '',
    name: params.get('name') ?? '',
    expiresAt: Date.now() + Number(params.get('expires_in') ?? 0) * 1000,
  };
}

/** Sends the article to the company server and returns the same result shape as direct mode. */
export async function suggestViaServer({ serverUrl, token, article, tables, focusKeyword, currentHeadline }) {
  let res;
  try {
    res = await fetch(`${serverUrl}/api/ext/headlines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ article, tables, focusKeyword, currentHeadline }),
    });
  } catch {
    throw new HeadlineError('Could not reach the company server. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new SignInRequired('Your sign-in has expired. Sign in with Google again.');
  if (!res.ok) throw new HeadlineError(data.error ?? `Server error ${res.status}.`);
  return data;
}
