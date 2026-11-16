import { detectInstructions } from './lib/guard.js';
import { readField, writeHeadline } from './lib/page.js';
import { getSettings, isReady, mode } from './lib/settings.js';
import { setThemePref, watchSystemTheme } from './lib/theme.js';
import { progressFor, quipSequence } from './lib/quips.js';

const QUIP_MS = 2600; // how long each loading line stays up

const LABELS = { search: 'Search', discover: 'Discover', data: 'Data-driven', explainer: 'Explainer' };
// Character targets per surface. Only Search is cut off hard in results.
const TARGETS = { search: [50, 65], discover: [60, 100], data: [45, 80], explainer: [45, 85] };

const $ = (id) => document.getElementById(id);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const charCount = (s) => [...segmenter.segment(s)].length;

let tab;
let settings;
let page = { found: false, text: '' };

init();

/** Sun/moon button: switches between day and night and remembers the choice. */
function setupThemeToggle() {
  const btn = $('theme-toggle');
  const label = () => {
    const next = document.documentElement.dataset.theme === 'night' ? 'day' : 'night';
    btn.title = `Switch to ${next}`;
    btn.setAttribute('aria-label', `Switch to ${next}`);
  };
  label();
  btn.addEventListener('click', () => {
    setThemePref(document.documentElement.dataset.theme === 'night' ? 'day' : 'night');
    label();
  });
  watchSystemTheme();
}

async function init() {
  setupThemeToggle();
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('sign-in').addEventListener('click', onSignIn);

  settings = await getSettings();
  if (!isReady(settings)) {
    showSetup();
    return;
  }
  $('main').hidden = false;
  $('empty').hidden = false;

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await readPage();

  $('form').addEventListener('submit', onGenerate);
  document.addEventListener('click', onCopyClick);

  const key = `result:${tab.id}`;
  const saved = (await chrome.storage.session.get(key))[key];
  if (saved) {
    if (saved.focusKeyword) $('keyword').value = saved.focusKeyword;
    render(saved);
  }
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes[key]?.newValue) render(changes[key].newValue);
  });
}

function showSetup(error = '') {
  const server = mode(settings) === 'server';
  $('setup').hidden = false;
  $('setup-text').textContent = server
    ? 'Sign in with your company Google account (@jagrannewmedia.com) to start.'
    : 'Set up the extension first: sign in through your company server, or add an API key.';
  $('sign-in').hidden = !server;
  $('open-settings').hidden = server;
  $('setup-error').hidden = !error;
  $('setup-error').textContent = error;
}

async function onSignIn() {
  // The Google window takes focus, which usually closes this popup. Sign-in carries on in
  // the background; reopen the popup afterwards.
  $('sign-in').disabled = true;
  $('setup-text').textContent = 'Finish signing in in the Google window…';
  const res = await chrome.runtime.sendMessage({ type: 'signIn' });
  if (res?.ok) return location.reload();
  $('sign-in').disabled = false;
  showSetup(res?.message ?? 'Sign-in failed.');
}

async function readPage() {
  const args = [settings.bodyField, settings.headlineField];
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: readField, args });
  } catch {
    try {
      results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readField, args });
    } catch {
      setSource(`Can't read this page. Open the article in your CMS and try again.`, true);
      return;
    }
  }
  const frames = results.map((r) => r.result).filter(Boolean);
  page = frames.find((r) => r.found && !r.guessed && r.text)
    ?? frames.find((r) => r.found && r.text)
    ?? frames.find((r) => r.found)
    ?? { found: false, text: '' };
  page.headline = frames.find((r) => r.headlineFound)?.headline ?? '';
  page.headlineFound = frames.some((r) => r.headlineFound);

  if (!page.found) {
    setSource(`No article body field (${fieldList()}) on this page. Open the article editor, or add the field name in Settings.`, true);
  } else if (!page.text) {
    setSource(`Found ${page.source.replace(/ \(.*\)$/, '')}, but it's empty. Write or paste the article first.`, true);
  } else {
    showWarnings();
    const words = page.text.split(/\s+/).filter(Boolean).length;
    const t = page.tables?.length ?? 0;
    setSource(`Read ${words.toLocaleString()} words${t ? ` and ${t} table${t > 1 ? 's' : ''}` : ''} from ${page.source}.`);
  }
}

/** A warning box: a title and a list of quoted snippets, all set as plain text. */
function fillWarning(el, title, items, footer = '') {
  el.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = title;
  el.append(strong);
  if (items.length) {
    const ul = document.createElement('ul');
    for (const t of items) {
      const li = document.createElement('li');
      li.textContent = t;
      ul.append(li);
    }
    el.append(ul);
  }
  if (footer) el.append(document.createTextNode(footer));
  el.hidden = false;
}

/** Warns about hidden text and text that addresses an AI, before anything is sent. */
function showWarnings() {
  const flags = detectInstructions({ article: page.text, keyword: $('keyword').value, headline: page.headline, tables: page.tables });
  const items = [
    ...(page.hiddenText ?? []).map((t) => `Hidden text (left out): “${t}”`),
    ...flags.map((f) => `In the ${f.field}: “${f.snippet}”`),
  ];
  if (!items.length) {
    $('warn').hidden = true;
    return;
  }
  fillWarning($('warn'), 'Check this text before publishing', items,
    'It looks like instructions to an AI, or text readers can’t see. Often it comes from copied press releases or websites. The extension ignores it, but check where it came from.');
}

/** "Enter_Body, Body or Description" */
function fieldList() {
  const names = settings.bodyField.split(',').map((s) => s.trim()).filter(Boolean);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? '';
}

function setSource(text, blocked = false) {
  $('source').textContent = text;
  $('generate').disabled = blocked;
}

async function onGenerate(event) {
  event.preventDefault();
  await readPage(); // pick up edits made since the popup opened
  if (!page.text) return;
  showWarnings();
  render({ status: 'loading', startedAt: Date.now() });
  const entry = await chrome.runtime.sendMessage({
    type: 'generate',
    tabId: tab.id,
    article: page.text,
    tables: page.tables,
    focusKeyword: $('keyword').value,
    currentHeadline: page.headline,
  });
  render(entry);
}

// --- loading: witty lines and a progress bar ----------------------------------------------

let loadingTimer = null;

/** Starts (or resumes, after reopening the popup) the loading lines and progress bar. */
function startLoading(startedAt) {
  if (loadingTimer) return;
  const lines = quipSequence({ theme: document.documentElement.dataset.theme, hasTables: Boolean(page.tables?.length) });
  const quip = $('quip');
  let shown = -1;
  const tick = () => {
    const elapsed = Date.now() - startedAt;
    $('progress-bar').style.width = `${Math.max(3, progressFor(elapsed) * 100)}%`;
    $('elapsed').textContent = `${Math.floor(elapsed / 1000)}s`;
    const index = Math.floor(elapsed / QUIP_MS) % lines.length;
    if (index !== shown) {
      shown = index;
      quip.classList.add('fade');
      setTimeout(() => { quip.textContent = lines[index]; quip.classList.remove('fade'); }, shown === 0 ? 0 : 250);
    }
  };
  tick();
  loadingTimer = setInterval(tick, 500);
}

function stopLoading() {
  clearInterval(loadingTimer);
  loadingTimer = null;
}

function render(entry) {
  const loading = entry.status === 'loading';
  $('loading').hidden = !loading;
  if (loading) startLoading(entry.startedAt ?? Date.now());
  else stopLoading();
  $('generate').disabled = loading || !page.text;
  $('error').hidden = entry.status !== 'error';
  $('error').textContent = entry.message ?? '';
  if (entry.signIn) {
    settings.authToken = '';
    showSetup(entry.message);
    $('error').hidden = true;
  }
  // The illustration fills the space until there are results.
  $('empty').hidden = loading || entry.status === 'done' || !$('results').hidden;
  if (entry.status !== 'done') {
    if (!loading) return;
    $('results').hidden = true;
    return;
  }
  $('generate').textContent = 'Regenerate';
  showResult(entry.result);
}

function showResult(r) {
  $('results').hidden = false;

  if (r.injection_warning) {
    fillWarning($('model-warn'), 'Instructions in the article were ignored', [r.injection_warning]);
  } else {
    $('model-warn').hidden = true;
  }

  $('feedback').hidden = !r.current_headline_feedback;
  $('feedback').textContent = r.current_headline_feedback ? `Current headline: ${r.current_headline_feedback}` : '';

  const cards = $('cards');
  cards.replaceChildren();
  for (const h of r.headlines) {
    const node = $('card-tpl').content.cloneNode(true);
    const tag = node.querySelector('.tag');
    tag.textContent = LABELS[h.strategy] ?? h.strategy;
    tag.classList.add(h.strategy);
    node.querySelector('.angle').textContent = h.angle ?? '';

    const n = charCount(h.headline);
    const [lo, hi] = TARGETS[h.strategy] ?? [0, 999];
    const count = node.querySelector('.count');
    count.textContent = `${n} chars · target ${lo}–${hi}`;
    count.classList.add(n >= lo && n <= hi ? 'ok' : 'warn');

    node.querySelector('.headline').textContent = h.headline;
    node.querySelector('.why').textContent = h.rationale;
    if (h.caution) {
      const c = node.querySelector('.caution');
      c.hidden = false;
      c.textContent = h.caution;
    }
    node.querySelector('.kw').textContent = `Keyword: ${h.focus_keyword}`;
    node.querySelector('.copy').addEventListener('click', (e) => copy(h.headline, e.currentTarget));

    const use = node.querySelector('.use');
    if (settings.headlineField && page.headlineFound) {
      use.hidden = false;
      use.addEventListener('click', (e) => useHeadline(h.headline, e.currentTarget));
    }
    cards.append(node);
  }

  showInsights(r);

  chips($('primary'), [r.primary_keyword]);
  chips($('secondary'), r.secondary_keywords);
  $('slug').textContent = r.url_slug;
  $('meta').textContent = r.meta_description;
  $('meta-count').textContent = `(${charCount(r.meta_description)}/155)`;

  const tokens = r.usage ? (r.usage.input_tokens ?? 0) + (r.usage.output_tokens ?? 0) : 0;
  const who = mode(settings) === 'server' && settings.authEmail ? ` · ${settings.authEmail}` : '';
  $('meta-info').textContent = `${r.model} · ${r.article_language} · ${tokens.toLocaleString()} tokens${who}. Check facts before publishing.`;
}

const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

function showInsights(r) {
  const items = r.data_insights ?? [];
  // Hide the section for articles without tables, unless the model found something anyway.
  $('insights').hidden = !items.length && !(page.tables?.length);
  const removed = r.dropped_insights?.length ?? 0;
  const removedNote = removed
    ? `${removed} insight${removed > 1 ? 's were' : ' was'} removed because ${removed > 1 ? 'they quoted numbers' : 'it quoted a number'} not found in the table (${r.dropped_insights.flatMap((d) => d.numbers).join(', ')}).`
    : '';
  if (removed) $('insights').hidden = false;
  const note = [items.length ? '' : r.data_insights_note, removedNote].filter(Boolean).join(' ');
  $('insight-note').hidden = !note;
  $('insight-note').textContent = note;
  const list = $('insight-list');
  list.replaceChildren();
  for (const d of items) {
    const node = $('insight-tpl').content.cloneNode(true);
    node.querySelector('.method').textContent = d.method;
    const conf = node.querySelector('.confidence');
    conf.textContent = CONFIDENCE[d.confidence] ?? d.confidence;
    conf.classList.add(d.confidence);
    node.querySelector('.insight-text').textContent = d.insight;
    node.querySelector('.evidence').textContent = d.evidence;
    node.querySelector('.context').textContent = d.context;
    if (d.caveat) {
      const c = node.querySelector('.caveat');
      c.hidden = false;
      c.textContent = d.caveat;
    }
    node.querySelector('.use-as').textContent = d.use_as ? `Use as: ${d.use_as}` : '';
    node.querySelector('.copy').addEventListener('click', (e) => copy(d.insight, e.currentTarget));
    list.append(node);
  }
}

function chips(el, items) {
  el.replaceChildren(...items.filter(Boolean).map((t) => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = t;
    return s;
  }));
}

function onCopyClick(e) {
  const id = e.target.dataset?.copy;
  if (id) copy($(id).textContent, e.target);
}

async function copy(text, button) {
  await navigator.clipboard.writeText(text);
  flash(button, 'Copied');
}

async function useHeadline(text, button) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: writeHeadline,
    args: [settings.headlineField, text],
  }).catch(() => []);
  flash(button, results.some((r) => r.result) ? 'Inserted' : 'Not found');
}

function flash(button, label) {
  const original = button.textContent;
  button.textContent = label;
  setTimeout(() => { button.textContent = original; }, 1200);
}
