import { HeadlineError, suggestHeadlines } from './lib/claude.js';
import { getSettings } from './lib/settings.js';

// The API call runs here, not in the popup, so it still finishes if the popup closes.
// Results are kept per tab in session storage, so reopening the popup shows them.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'generate') return false;
  generate(msg).then(sendResponse);
  return true; // keep the channel open for the async response
});

async function generate({ tabId, article, focusKeyword, currentHeadline }) {
  const key = `result:${tabId}`;
  await chrome.storage.session.set({ [key]: { status: 'loading', startedAt: Date.now() } });
  let entry;
  try {
    const { apiKey, model } = await getSettings();
    const result = await suggestHeadlines({ apiKey, model, article, focusKeyword, currentHeadline });
    entry = { status: 'done', result, focusKeyword, finishedAt: Date.now() };
  } catch (err) {
    const message = err instanceof HeadlineError ? err.message : 'Something went wrong. Try again.';
    if (!(err instanceof HeadlineError)) console.error(err);
    entry = { status: 'error', message, focusKeyword };
  }
  await chrome.storage.session.set({ [key]: entry });
  return entry;
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`result:${tabId}`));
