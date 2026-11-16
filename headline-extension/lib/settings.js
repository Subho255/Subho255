// Settings live in chrome.storage.local (this Chrome profile only, never synced).

export const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  // Comma-separated: the first one found on the page with article text is used.
  bodyField: 'Enter_Body, Body, Description',
  headlineField: '',
};

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

// Left over from the removed company-server sign-in; deleted on first load.
const LEGACY_KEYS = ['serverUrl', 'authToken', 'authEmail', 'authName', 'authExpiresAt'];

export async function getSettings() {
  const stored = await chrome.storage.local.get([...Object.keys(DEFAULTS), ...LEGACY_KEYS]);
  if (LEGACY_KEYS.some((k) => k in stored)) {
    await chrome.storage.local.remove(LEGACY_KEYS);
    LEGACY_KEYS.forEach((k) => delete stored[k]);
  }
  // Earlier versions saved the single default name; move those users to the new list.
  if (stored.bodyField === 'Enter_Body') delete stored.bodyField;
  return { ...DEFAULTS, ...stored };
}

export function saveSettings(values) {
  return chrome.storage.local.set(values);
}

/** True when the extension can make requests: an API key is saved. */
export function isReady(s) {
  return Boolean(s.apiKey);
}
