// Settings live in chrome.storage.local (this Chrome profile only, never synced).

// Set this to the deployed company server (e.g. 'https://headline-desk.onrender.com') before
// sharing the extension. Colleagues then only click "Sign in with Google": no URL, no key.
export const DEFAULT_SERVER_URL = '';

export const DEFAULTS = {
  // Company-server mode (recommended): sign in with a company Google account.
  serverUrl: DEFAULT_SERVER_URL,
  authToken: '',
  authEmail: '',
  authName: '',
  authExpiresAt: 0,
  // Direct mode: used only when no server URL is set.
  apiKey: '',
  model: 'claude-opus-5-5',
  // Page fields.
  bodyField: 'Enter_Body',
  headlineField: '',
};

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export function saveSettings(values) {
  return chrome.storage.local.set(values);
}

/** 'server' when a company server is set, otherwise 'key'. */
export function mode(s) {
  return s.serverUrl ? 'server' : 'key';
}

/** True when the extension can make requests right now. */
export function isReady(s) {
  if (mode(s) === 'server') return Boolean(s.authToken) && s.authExpiresAt > Date.now();
  return Boolean(s.apiKey);
}

export function clearSignIn() {
  return chrome.storage.local.set({ authToken: '', authEmail: '', authName: '', authExpiresAt: 0 });
}
