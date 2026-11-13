// Settings live in chrome.storage.local (this Chrome profile only, never synced).
export const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5-5',
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
