import { checkApiKey } from './lib/claude.js';
import { DEFAULTS, MODELS, getSettings, saveSettings } from './lib/settings.js';
import { THEME_PREFS, getThemePref, setThemePref, watchSystemTheme } from './lib/theme.js';

const $ = (id) => document.getElementById(id);
const fields = ['apiKey', 'model', 'bodyField', 'headlineField'];

for (const m of MODELS) $('model').add(new Option(m.label, m.id));

// Theme applies as soon as it changes (no Save needed).
for (const t of THEME_PREFS) $('theme').add(new Option(t.label, t.id));
$('theme').value = getThemePref();
$('theme').addEventListener('change', () => setThemePref($('theme').value));
watchSystemTheme();

const current = await getSettings();
for (const f of fields) $(f).value = current[f];

function keyStatus(text, ok) {
  const el = $('key-status');
  el.hidden = !text;
  el.textContent = text;
  el.className = `hint ${ok ? 'ok' : 'bad'}`;
}

async function runKeyCheck() {
  $('check-key').disabled = true;
  keyStatus('Checking…', true);
  const res = await checkApiKey($('apiKey').value);
  $('check-key').disabled = false;
  keyStatus(res.ok ? 'Key works. You’re ready to go.' : res.message, res.ok);
  return res.ok;
}

$('check-key').addEventListener('click', runKeyCheck);
$('apiKey').addEventListener('input', () => keyStatus('', true));

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(fields.map((f) => [f, $(f).value.trim()]));
  if (!values.bodyField) values.bodyField = DEFAULTS.bodyField;
  await saveSettings(values);
  for (const f of fields) $(f).value = values[f];
  $('saved').hidden = false;
  setTimeout(() => { $('saved').hidden = true; }, 1500);
  // Check a newly saved key straight away, so a bad key shows up here, not mid-article.
  if (values.apiKey && values.apiKey !== current.apiKey) {
    current.apiKey = values.apiKey;
    runKeyCheck();
  }
});
