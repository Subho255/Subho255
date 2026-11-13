import { DEFAULTS, MODELS, getSettings, saveSettings } from './lib/settings.js';

const form = document.getElementById('form');
const fields = ['apiKey', 'model', 'bodyField', 'headlineField'];

const select = document.getElementById('model');
for (const m of MODELS) select.add(new Option(m.label, m.id));

const current = await getSettings();
for (const f of fields) document.getElementById(f).value = current[f];

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(fields.map((f) => [f, document.getElementById(f).value.trim()]));
  if (!values.bodyField) values.bodyField = DEFAULTS.bodyField;
  document.getElementById('bodyField').value = values.bodyField;
  await saveSettings(values);
  const saved = document.getElementById('saved');
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 1500);
});
