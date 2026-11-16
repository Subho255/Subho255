import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlineError, buildRequest, parseResponse } from '../headline-extension/lib/claude.js';

const ARTICLE = 'The Reserve Bank of India kept the repo rate unchanged at 5.5 per cent on Friday. '.repeat(5);
const reply = (extra = {}) => ({
  article_language: 'English', primary_keyword: 'RBI repo rate', secondary_keywords: [],
  headlines: [{ strategy: 'search', angle: 'Keyword first', headline: 'RBI repo rate unchanged at 5.5%', focus_keyword: 'RBI repo rate', rationale: 'r', caution: '' }],
  url_slug: 'rbi-repo-rate', meta_description: 'm', current_headline_feedback: '', data_insights: [], data_insights_note: '', injection_warning: '',
  ...extra,
});
const message = (obj) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: {} });

test('request: browser-direct headers, structured output, fallbacks, keyword in its own tag', () => {
  const { headers, body } = buildRequest({ model: 'claude-opus-5-5', article: ARTICLE, focusKeyword: 'RBI' });
  assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.match(body.messages[0].content, /<focus_keyword>RBI<\/focus_keyword>/);
  assert.equal(headers['x-api-key'], undefined, 'the key is added only when sending');
});

test('Haiku gets no server-side fallback', () => {
  const { headers, body } = buildRequest({ model: 'claude-haiku-5-5', article: ARTICLE });
  assert.equal(headers['anthropic-beta'], undefined);
  assert.equal(body.fallbacks, undefined);
});

test('too short or too long articles are refused before any call', () => {
  assert.throws(() => buildRequest({ model: 'claude-opus-5-5', article: 'short' }), HeadlineError);
  assert.throws(() => buildRequest({ model: 'claude-opus-5-5', article: 'x'.repeat(70000) }), HeadlineError);
});

test('tables reach the prompt as Markdown plus exact stats, with higher effort', () => {
  const tables = [{ caption: 'Closing ranks', rows: [['Branch', '2021', '2022', '2023'], ['Civil', '3,812', '3,640', '3,512']] }];
  const { body } = buildRequest({ model: 'claude-opus-5-5', article: ARTICLE, tables });
  assert.match(body.messages[0].content, /<tables>[\s\S]*\| Civil \| 3,812/);
  assert.match(body.messages[0].content, /<table_stats>[\s\S]*"change":-300/);
  assert.equal(body.output_config.effort, 'high');
  const plain = buildRequest({ model: 'claude-opus-5-5', article: ARTICLE }).body;
  assert.equal(plain.output_config.effort, 'medium');
  assert.match(plain.messages[0].content, /no tables/);
});

test('response: headlines grouped in order, Discover capped at 3, insights capped at 3', () => {
  const h = (strategy, n) => ({ strategy, angle: 'a', headline: `${strategy} ${n}`, focus_keyword: 'k', rationale: 'r', caution: '' });
  const r = parseResponse(message(reply({
    headlines: [h('explainer', 1), h('discover', 1), h('search', 1), h('discover', 2), h('data', 1), h('discover', 3), h('discover', 4)],
    data_insights: [1, 2, 3, 4].map((i) => ({ insight: `i${i}`, evidence: 'e', method: 'm', context: 'c', confidence: 'high', caveat: '', use_as: 'u' })),
  })));
  assert.deepEqual(r.headlines.map((x) => x.headline), ['search 1', 'discover 1', 'discover 2', 'discover 3', 'data 1', 'explainer 1']);
  assert.equal(r.data_insights.length, 3);
});

test('refusals and cut-off responses become readable errors', () => {
  assert.throws(() => parseResponse({ stop_reason: 'refusal', content: [] }), /declined/);
  assert.throws(() => parseResponse({ stop_reason: 'max_tokens', content: [] }), /cut off/);
});
