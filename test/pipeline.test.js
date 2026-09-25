import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, InputError } from '../src/analyze.js';
import { articleQuestions, headlineQuestions } from '../src/questions.js';
import { evaluateHeadline, recommend } from '../src/policy.js';
import { entityCandidates, headlineStats, parseDrafts, splitSentences } from '../src/text.js';
import { MockTypeSafeClient } from '../src/mock.js';

const BODY = `Riverton City Council voted 7-2 on Tuesday to approve a $48 million plan that will add 60 kilometres of protected bike lanes. Mayor Elena Brandt proposed the plan last spring. Dr. Lee said the U.S. data was similar in many other cities too. Opponents argued that Riverton would lose about 900 parking spaces on Harbor Avenue and hurt small businesses there. City staff will present a detailed construction timeline for Riverton at the next council meeting in February.`;

test('splitSentences keeps abbreviations intact', () => {
  const s = splitSentences(BODY);
  assert.equal(s.length, 5);
  assert.match(s[2], /^Dr\. Lee said the U\.S\. data/);
});

test('entityCandidates ranks repeated names first', () => {
  const e = entityCandidates(BODY);
  assert.equal(e[0].text, 'Riverton');
  assert.ok(e.some((x) => x.text === 'Elena Brandt'));
  assert.ok(!e.some((x) => x.text === 'The'));
});

test('parseDrafts strips bullets and dedupes', () => {
  assert.deepEqual(parseDrafts('- One\n2. Two\n\none\n• Three'), ['One', 'Two', 'Three']);
});

test('headlineStats flags length and repetition', () => {
  const s = headlineStats('Bike lanes Riverton | Riverton bike lanes plan');
  assert.deepEqual(s.repeatedWords.sort(), ['bike', 'lanes', 'riverton']);
  assert.equal(s.separators, 1);
  assert.equal(headlineStats('x '.repeat(20)).tooLong, true);
});

test('question sets are well-formed for the SDK', () => {
  const q1 = articleQuestions([{ id: 's1', text: 'A sentence.' }], [{ id: 'e1', text: 'Riverton' }]);
  assert.deepEqual(Object.keys(q1.core_story.criteria), ['s1', 'none']);
  assert.deepEqual(Object.keys(q1.article_intent.criteria), ['search', 'discover', 'news', 'explainer']);
  const q2 = headlineQuestions();
  assert.equal(q2.faithful.type, 'score');
  assert.equal(q2.faithful.criteria.length, 4);
  for (const q of Object.values(q2)) assert.ok(['noul', 'choice', 'score'].includes(q.type));
});

function fakeAnswers(overrides = {}) {
  const intent = overrides.intent ?? 'news';
  return {
    intent: { type: 'choice', choice: intent, confidence: 0.8, probabilities: { search: 0.05, discover: 0.05, news: 0.05, explainer: 0.05, [intent]: 0.85 } },
    names_subject: { noul: 0.9 },
    faithful: { score: 2.8 },
    keyword_stuffing: { noul: 0.05 },
    vague_substitute: { noul: 0.05 },
    redundant: { noul: 0.05 },
    mixed_intents: { noul: 0.05 },
    grammar_issue: { noul: 0.05 },
    wordy: { noul: 0.1 },
    ...overrides.nouls,
  };
}

test('gates block a high-quality but unfaithful headline', () => {
  const good = evaluateHeadline('Good', fakeAnswers(), headlineStats('Good headline'), 'news');
  const bait = evaluateHeadline('Bait', fakeAnswers({ nouls: { faithful: { score: 1.2 } } }), headlineStats('Bait'), 'news');
  assert.equal(good.passed, 5);
  assert.deepEqual(bait.failedGates, ['faithful']);
  const rec = recommend([bait, good]);
  assert.equal(rec.headline, 'Good');
  assert.equal(rec.status, 'ready');
});

test('recommend falls back to needs_revision when nothing passes gates', () => {
  const h = evaluateHeadline('Vague', fakeAnswers({ nouls: { names_subject: { noul: 0.1 } } }), headlineStats('Vague'), 'news');
  const rec = recommend([h]);
  assert.equal(rec.headline, 'Vague');
  assert.equal(rec.status, 'needs_revision');
  assert.equal(rec.perIntent.news, 'Vague');
  assert.equal(rec.perIntent.search, null);
});

test('best_available when gates pass but a polish check fails', () => {
  const wordy = evaluateHeadline('Wordy', fakeAnswers({ nouls: { wordy: { noul: 0.9 } } }), headlineStats('Wordy'), 'news');
  assert.equal(wordy.failedGates.length, 0);
  assert.equal(recommend([wordy]).status, 'best_available');
});

test('intent fit breaks ties toward the article intent', () => {
  const news = evaluateHeadline('N', fakeAnswers({ intent: 'news' }), headlineStats('N'), 'explainer');
  const expl = evaluateHeadline('E', fakeAnswers({ intent: 'explainer' }), headlineStats('E'), 'explainer');
  assert.equal(recommend([news, expl]).headline, 'E');
});

test('analyze runs end-to-end: one article request plus one per draft', async () => {
  const mock = new MockTypeSafeClient();
  const calls = [];
  const client = { systemOne: (req) => { calls.push(req); return mock.systemOne(req); } };
  const out = await analyze(client, {
    body: BODY,
    drafts: 'Riverton approves $48M bike lane plan\nYou won\'t believe what this city did',
  });
  assert.equal(calls.length, 3);
  assert.ok(calls[0].questions.core_story);
  assert.equal(calls[1].state.headline, 'Riverton approves $48M bike lane plan');
  assert.equal(calls[1].state.article.core_story, out.article.coreStory);
  assert.equal(out.headlines.length, 2);
  assert.equal(out.recommendation.headline, 'Riverton approves $48M bike lane plan');
  assert.equal(out.usage.requests, 3);
});

test('analyze rejects missing input', async () => {
  await assert.rejects(analyze(new MockTypeSafeClient(), { body: 'short', drafts: 'x' }), InputError);
  await assert.rejects(analyze(new MockTypeSafeClient(), { body: BODY, drafts: '' }), InputError);
});
