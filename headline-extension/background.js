import { HeadlineError, suggestHeadlines } from './lib/claude.js';
import { SignInRequired, signIn, suggestViaServer } from './lib/server.js';
import { clearSignIn, getSettings, isReady, mode, saveSettings } from './lib/settings.js';

// API calls and Google sign-in run here, not in the popup, so they still finish if the
// popup closes (it does when the sign-in window opens). Results are kept per tab in session
// storage, so reopening the popup shows them.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = { generate, signIn: doSignIn, signOut: doSignOut };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg).then(sendResponse);
  return true; // keep the channel open for the async response
});

async function doSignIn() {
  const { serverUrl } = await getSettings();
  if (!serverUrl) return { ok: false, message: 'Add the company server URL in Settings first.' };
  try {
    const s = await signIn(serverUrl);
    await saveSettings({ authToken: s.token, authEmail: s.email, authName: s.name, authExpiresAt: s.expiresAt });
    return { ok: true, email: s.email };
  } catch (err) {
    return { ok: false, message: err instanceof HeadlineError ? err.message : 'Sign-in failed.' };
  }
}

async function doSignOut() {
  await clearSignIn();
  return { ok: true };
}

async function generate({ tabId, article, tables, focusKeyword, currentHeadline }) {
  const key = `result:${tabId}`;
  await chrome.storage.session.set({ [key]: { status: 'loading', startedAt: Date.now() } });
  let entry;
  try {
    const s = await getSettings();
    if (!isReady(s)) {
      throw mode(s) === 'server'
        ? new SignInRequired('Sign in with your company Google account first.')
        : new HeadlineError('Add your Anthropic API key in Settings first.');
    }
    const input = { article, tables, focusKeyword, currentHeadline };
    const result = mode(s) === 'server'
      ? await suggestViaServer({ serverUrl: s.serverUrl, token: s.authToken, ...input })
      : await suggestHeadlines({ apiKey: s.apiKey, model: s.model, ...input });
    entry = { status: 'done', result, focusKeyword, finishedAt: Date.now() };
  } catch (err) {
    if (err instanceof SignInRequired) await clearSignIn();
    const message = err instanceof HeadlineError ? err.message : 'Something went wrong. Try again.';
    if (!(err instanceof HeadlineError)) console.error(err);
    entry = { status: 'error', message, focusKeyword, signIn: err instanceof SignInRequired };
  }
  await chrome.storage.session.set({ [key]: entry });
  return entry;
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`result:${tabId}`));
