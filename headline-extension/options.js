import { DEFAULTS, MODELS, getSettings, saveSettings } from './lib/settings.js';
import { normaliseServerUrl } from './lib/server.js';

const $ = (id) => document.getElementById(id);
const fields = ['serverUrl', 'apiKey', 'model', 'bodyField', 'headlineField'];

for (const m of MODELS) $('model').add(new Option(m.label, m.id));

let current = await getSettings();
for (const f of fields) $(f).value = current[f];
if (current.apiKey && !current.serverUrl) $('direct').open = true;
showAccount();

function showAccount(error = '') {
  const signedIn = current.authToken && current.authExpiresAt > Date.now();
  const status = $('account-status');
  if (signedIn) {
    const days = Math.max(1, Math.round((current.authExpiresAt - Date.now()) / 86400000));
    status.textContent = `Signed in as ${current.authEmail}. Stays signed in for ${days} more day${days === 1 ? '' : 's'}.`;
    status.className = 'signed-in';
  } else {
    status.textContent = 'Not signed in.';
    status.className = 'muted';
  }
  $('sign-in').hidden = Boolean(signedIn);
  $('sign-out').hidden = !signedIn;
  $('account-error').hidden = !error;
  $('account-error').textContent = error;
}

/** Validates and saves the form. Returns false if something is invalid. */
async function save() {
  const values = Object.fromEntries(fields.map((f) => [f, $(f).value.trim()]));
  try {
    values.serverUrl = normaliseServerUrl(values.serverUrl);
  } catch (err) {
    showAccount(err.message);
    return false;
  }
  if (!values.bodyField) values.bodyField = DEFAULTS.bodyField;
  // A different server means the old sign-in no longer applies.
  if (values.serverUrl !== current.serverUrl) Object.assign(values, { authToken: '', authEmail: '', authName: '', authExpiresAt: 0 });
  await saveSettings(values);
  current = await getSettings();
  for (const f of fields) $(f).value = current[f];
  showAccount();
  return true;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!(await save())) return;
  $('saved').hidden = false;
  setTimeout(() => { $('saved').hidden = true; }, 1500);
});

$('sign-in').addEventListener('click', async () => {
  if (!(await save())) return;
  if (!current.serverUrl) return showAccount('Enter the company server URL first.');
  $('sign-in').disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'signIn' });
  $('sign-in').disabled = false;
  current = await getSettings();
  showAccount(res?.ok ? '' : res?.message ?? 'Sign-in failed.');
});

$('sign-out').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'signOut' });
  current = await getSettings();
  showAccount();
});
