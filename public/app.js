const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (p) => `${Math.round(p * 100)}%`;

const INTENT_ORDER = ['search', 'discover', 'news', 'explainer'];
const INTENT_TAGS = { search: 'I1', discover: 'I2', news: 'I3', explainer: 'I4' };
const INTENT_LABELS = { search: 'Search', discover: 'Discover', news: 'News', explainer: 'Explainer' };

let state = { result: null, selected: null };

const SAMPLE = {
  body: `Riverton City Council voted 7-2 on Tuesday to approve a $48 million plan that will add 60 kilometres of protected bike lanes across the city by 2029, the largest cycling investment in its history.

The plan, proposed by Mayor Elena Brandt last spring, replaces painted lanes on six major corridors with lanes separated from traffic by concrete curbs. Construction on the first two corridors, Harbor Avenue and Pine Street, is scheduled to begin in March.

Supporters said the vote follows a sharp rise in cycling injuries. City data shows 214 cyclists were hurt in crashes last year, up from 151 in 2022. "Paint is not protection," Brandt told councillors before the vote.

Opponents, including councillors Mark Oduya and Dana Wirth, argued the plan would remove about 900 on-street parking spaces and hurt small businesses on Harbor Avenue. The Harbor Avenue Merchants Association has said it will ask the council to phase construction to limit disruption.

The project will be funded through a mix of municipal bonds and a $12 million provincial transportation grant. City staff will present a detailed construction timeline at the council's next meeting on February 11.`,
  drafts: `Riverton approves $48M protected bike lane network
You won't believe what this city just did for cyclists
Bike lanes Riverton | Riverton bike lanes plan | cycling Riverton
Riverton council approves bike lanes: here's everything you need to know about parking
Why Riverton is betting $48 million on protected bike lanes
Riverton bike lanes: what the new plan means for your commute
City council votes to completely overhaul and totally transform cycling in the city`,
};

async function init() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    $('mock-banner').hidden = !cfg.mock;
  } catch { /* server offline: form still renders */ }

  $('sample').addEventListener('click', () => {
    $('body').value = SAMPLE.body;
    $('drafts').value = SAMPLE.drafts;
    updateDraftCount();
  });
  $('drafts').addEventListener('input', updateDraftCount);
  $('form').addEventListener('submit', onSubmit);
  renderEmpty();
}

function updateDraftCount() {
  const n = $('drafts').value.split('\n').filter((l) => l.trim()).length;
  $('draft-count').textContent = `${n} draft${n === 1 ? '' : 's'}`;
}

async function onSubmit(e) {
  e.preventDefault();
  const btn = $('run');
  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  $('error').hidden = true;
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: $('body').value, drafts: $('drafts').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    state = { result: data, selected: data.recommendation.headline };
    render();
  } catch (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze headlines';
  }
}

function renderEmpty() {
  $('intent-cards').innerHTML = INTENT_ORDER.map((k) => `
    <div class="card">
      <div class="card-head"><span class="tag">${INTENT_TAGS[k]}</span><b>${INTENT_LABELS[k]}</b><span class="muted count">0</span></div>
      <div class="tiles"><div class="tile empty"><span class="s">No drafts yet</span></div></div>
    </div>`).join('');
}

function render() {
  const { result } = state;
  const a = result.article;

  // Core story
  $('core-story').textContent = a.coreStory;
  $('core-conf').textContent = `confidence ${pct(a.coreStoryConfidence)}`;
  $('core-meta').innerHTML = [
    a.primarySubject ? `<span class="chip">subject <b>${esc(a.primarySubject)}</b></span>` : `<span class="chip">subject <b>unclear</b></span>`,
    `<span class="chip">article intent <b>${esc(INTENT_LABELS[a.intent])}</b> ${pct(a.intentConfidence)}</span>`,
    a.coreStoryIsExplicit ? '' : `<span class="flag">no single sentence states the story — consider a clearer nut graf</span>`,
  ].join('');

  // Intent buckets
  const rec = result.recommendation.headline;
  $('intent-cards').innerHTML = INTENT_ORDER.map((k) => {
    const items = result.headlines.filter((h) => h.intent === k).sort((x, y) => y.rank - x.rank);
    const isArticle = a.intent === k;
    const tiles = items.length
      ? items.map((h) => `
          <button type="button" class="tile ${h.passed === 5 ? 'pass' : ''} ${h.headline === rec ? 'rec' : ''} ${h.headline === state.selected ? 'selected' : ''}"
                  data-h="${esc(h.headline)}">
            <span class="t">${esc(h.headline)}</span>
            <span class="s">${h.passed}/5 checks · quality ${h.quality.toFixed(2)}${h.headline === rec ? ' · recommended' : ''}</span>
          </button>`).join('')
      : `<div class="tile empty"><span class="s">No drafts read as ${INTENT_LABELS[k]}</span></div>`;
    return `
      <div class="card ${isArticle ? 'is-article-intent' : ''}">
        <div class="card-head">
          <span class="tag">${INTENT_TAGS[k]}</span><b>${INTENT_LABELS[k]}</b>
          ${isArticle ? '<span class="flag">article intent</span>' : ''}
          <span class="muted count">${items.filter((h) => h.passed === 5).length}/${items.length}</span>
        </div>
        <div class="tiles">${tiles}</div>
      </div>`;
  }).join('');
  for (const el of document.querySelectorAll('.tile[data-h]')) {
    el.addEventListener('click', () => { state.selected = el.dataset.h; render(); });
  }

  renderChecks();
  renderRecommendation();
}

function renderChecks() {
  const h = state.result.headlines.find((x) => x.headline === state.selected);
  if (!h) return;
  $('selected-headline').innerHTML = `${esc(h.headline)}
    <div class="meta-row" style="margin-top:6px">
      <span class="chip">reads as <b>${esc(INTENT_LABELS[h.intent])}</b> ${pct(h.intentConfidence)}</span>
      <span class="chip">fits article intent <b>${pct(h.intentFit)}</b></span>
      ${h.failedGates.length ? `<span class="flag">fails gate: ${h.failedGates.join(', ')}</span>` : ''}
    </div>`;

  $('check-cards').innerHTML = h.checks.map((c, i) => `
    <div class="card check-card">
      <div class="card-head">
        <span class="tag">K${i + 1}</span><b>${esc(c.label)}</b>
        <span class="status ${c.pass ? 'ok' : 'fail'}">${c.pass ? 'pass' : 'fix'}</span>
      </div>
      <div class="tiles">${c.signals.map(signal).join('')}</div>
      ${(c.notes ?? []).map((n) => `<p class="note">${esc(n)}</p>`).join('')}
      ${c.pass ? '' : `<p class="fix">${esc(c.fix)}</p>`}
    </div>`).join('');
}

function signal(s) {
  if (s.score !== undefined) {
    const good = s.score >= 2;
    return `<div class="sig ${good ? 'good' : 'bad'}">${esc(s.label)}<small>${s.score.toFixed(2)} / ${s.max}</small></div>`;
  }
  const good = s.good === 'high' ? s.p >= 0.5 : s.p < 0.5;
  return `<div class="sig ${good ? 'good' : 'bad'}">${esc(s.label)}<small>p(yes) ${s.p.toFixed(2)}</small></div>`;
}

function renderRecommendation() {
  const { recommendation, headlines, log, usage, model } = state.result;
  const rec = headlines.find((h) => h.headline === recommendation.headline);
  $('rec-headline').textContent = recommendation.headline ?? '—';
  const status = $('rec-status');
  status.textContent = { ready: 'ready', best_available: 'best available', needs_revision: 'needs revision' }[recommendation.status] ?? '';
  status.className = `pill ${recommendation.status === 'ready' ? '' : 'warn'}`;
  const passed = rec?.passed ?? 0;
  $('rec-passed').textContent = `${passed} / 5`;
  $('rec-meter').innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < passed ? 'on' : ''}"></i>`).join('');

  $('per-intent').innerHTML = INTENT_ORDER.map((k) => `
    <li><span class="k">${INTENT_LABELS[k]}</span>
    <span class="v ${recommendation.perIntent[k] ? '' : 'muted'}">${esc(recommendation.perIntent[k] ?? 'No draft — write one for this intent')}</span></li>`).join('');

  const maxMs = Math.max(1, ...log.map((l) => l.ms));
  $('timeline').innerHTML = log.map((l) => `
    <li><div class="k">${esc(l.step)}</div><div class="d">${esc(l.detail)}${l.ms ? ` · ${l.ms} ms` : ''}</div>
    ${l.ms ? `<div class="bar"><span style="width:${(l.ms / maxMs) * 100}%"></span></div>` : ''}</li>`).join('');
  $('usage').textContent = `${esc(model)} · ${usage.requests} req · ${usage.input_tokens + usage.output_tokens} tok`;
}

init();
