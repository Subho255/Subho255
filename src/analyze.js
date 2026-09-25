import { INTENTS, articleQuestions, headlineQuestions } from './questions.js';
import { evaluateHeadline, recommend } from './policy.js';
import { LIMITS, entityCandidates, headlineStats, parseDrafts, sentenceCandidates } from './text.js';

export class InputError extends Error {}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Two-stage pipeline:
 *  1. One request about the article: core story (selected sentence),
 *     primary subject (selected name) and the article's reader intent.
 *  2. One request per headline draft, all in parallel, judged against
 *     the stage-1 results — they need the core story as evidence.
 */
export async function analyze(client, input) {
  const body = String(input.body ?? '').trim().slice(0, LIMITS.articleChars);
  const drafts = parseDrafts(input.drafts);
  if (body.split(/\s+/).length < 40) throw new InputError('Paste the article body (at least ~40 words).');
  if (!drafts.length) throw new InputError('Add at least one headline draft, one per line.');
  if (drafts.length > 12) throw new InputError('Keep it to 12 headline drafts per run.');

  const sentences = sentenceCandidates(body);
  if (sentences.length < 1) throw new InputError('Could not find complete sentences in the article body.');
  const entities = entityCandidates(body);

  const log = [];
  const usage = { input_tokens: 0, output_tokens: 0, requests: 0 };
  const track = (res) => {
    usage.input_tokens += res.usage?.input_tokens ?? 0;
    usage.output_tokens += res.usage?.output_tokens ?? 0;
    usage.requests += 1;
    return res;
  };

  // Stage 1 -----------------------------------------------------------
  let t = Date.now();
  const q1 = articleQuestions(sentences, entities);
  if (!entities.length) delete q1.primary_subject;
  const s1 = track(await client.systemOne({ state: { article: { body } }, questions: q1 }));
  const a1 = s1.answers;

  const coreId = a1.core_story.choice === 'none'
    ? topLabel(a1.core_story.probabilities, ['none'])
    : a1.core_story.choice;
  const coreSentence = sentences.find((s) => s.id === coreId);
  const subjectId = a1.primary_subject?.choice;
  const subject = entities.find((e) => e.id === subjectId) ?? null;

  const article = {
    coreStory: coreSentence?.text ?? sentences[0].text,
    coreStoryConfidence: round(a1.core_story.confidence),
    coreStoryIsExplicit: a1.core_story.choice !== 'none',
    primarySubject: subject?.text ?? null,
    primarySubjectConfidence: a1.primary_subject ? round(a1.primary_subject.confidence) : null,
    intent: a1.article_intent.choice,
    intentConfidence: round(a1.article_intent.confidence),
    intentProbabilities: roundAll(a1.article_intent.probabilities),
    sentenceCount: sentences.length,
    entityCandidates: entities.map((e) => e.text),
  };
  log.push({
    step: 'Identify core story',
    detail: `Selected 1 of ${sentences.length} sentences; subject from ${entities.length} names; article intent`,
    ms: Date.now() - t,
  });

  // Stage 2 -----------------------------------------------------------
  t = Date.now();
  const hq = headlineQuestions();
  const excerpt = body.slice(0, LIMITS.excerptChars);
  const results = await Promise.all(
    drafts.map((headline) =>
      client
        .systemOne({
          state: {
            article: {
              core_story: article.coreStory,
              primary_subject: article.primarySubject,
              excerpt,
            },
            headline,
          },
          questions: hq,
        })
        .then(track),
    ),
  );
  const evaluated = results.map((r, i) =>
    evaluateHeadline(drafts[i], r.answers, headlineStats(drafts[i]), article.intent),
  );
  log.push({
    step: 'Judge headlines',
    detail: `${drafts.length} draft${drafts.length === 1 ? '' : 's'} × ${Object.keys(hq).length} questions, in parallel`,
    ms: Date.now() - t,
  });

  const recommendation = recommend(evaluated);
  log.push({
    step: 'Recommend',
    detail: {
      ready: 'Best-ranked draft; passes every check',
      best_available: 'Passes subject, faithfulness and single-intent gates; some polish checks fail',
      needs_revision: 'No draft passes every gate — showing the closest one to revise',
    }[recommendation.status] ?? 'No drafts',
    ms: 0,
  });

  return {
    model: s1.model,
    intents: Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.label])),
    article,
    headlines: evaluated,
    recommendation,
    usage,
    log,
  };
}

function topLabel(probabilities, exclude = []) {
  return Object.entries(probabilities)
    .filter(([k]) => !exclude.includes(k))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

function roundAll(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round(v)]));
}
