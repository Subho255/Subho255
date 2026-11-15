import { readField, writeHeadline } from './lib/page.js';
import { getSettings, isReady, mode } from './lib/settings.js';

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

async function init() {
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
    setSource(`No "${settings.bodyField}" field on this page. Open the article editor, or change the field name in Settings.`, true);
  } else if (!page.text) {
    setSource(`Found "${settings.bodyField}", but it's empty. Write or paste the article first.`, true);
  } else {
    const words = page.text.split(/\s+/).filter(Boolean).length;
    const t = page.tables?.length ?? 0;
    setSource(`Read ${words.toLocaleString()} words${t ? ` and ${t} table${t > 1 ? 's' : ''}` : ''} from ${page.source}.`);
  }
}

function setSource(text, blocked = false) {
  $('source').textContent = text;
  $('generate').disabled = blocked;
}

async function onGenerate(event) {
  event.preventDefault();
  await readPage(); // pick up edits made since the popup opened
  if (!page.text) return;
  render({ status: 'loading' });
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

function render(entry) {
  const loading = entry.status === 'loading';
  $('loading').hidden = !loading;
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
  $('insight-note').hidden = Boolean(items.length) || !r.data_insights_note;
  $('insight-note').textContent = r.data_insights_note ?? '';
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
