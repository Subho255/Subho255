import { INTENTS } from './questions.js';

// Policy lives here, separate from the raw judgments, so thresholds and
// weights can be tuned on real newsroom data without re-running Jev.
// These starting values are guesses to be evaluated, not calibrated rules.
export const POLICY = {
  yesThreshold: 0.5,
  faithfulMin: 2, // on the 0–3 rubric
  weights: {
    subject: 3,
    faithful: 3,
    single_intent: 2,
    vague: 1.5,
    grammar: 1.5,
    stuffing: 1,
    redundant: 1,
    wordy: 0.5,
    length: 0.5,
  },
  // How much agreement with the article's own intent affects ranking.
  intentFitWeight: 0.25,
  // Hard gates: a headline failing any of these cannot be recommended
  // outright, however well it scores elsewhere.
  gates: ['subject', 'faithful', 'single_intent'],
};

const round = (n) => Math.round(n * 1000) / 1000;

/** Turn one headline's raw answers plus code stats into checks and scores. */
export function evaluateHeadline(headline, answers, stats, articleIntent, policy = POLICY) {
  const y = policy.yesThreshold;
  const a = answers;

  const checks = [
    {
      id: 'subject',
      label: 'Names the primary subject',
      pass: a.names_subject.noul >= y,
      signals: [{ label: 'names subject', p: a.names_subject.noul, good: 'high' }],
      fix: 'Put the specific person, organisation or thing the story is about into the headline by name.',
    },
    {
      id: 'faithful',
      label: 'Matches what the article delivers',
      pass: a.faithful.score >= policy.faithfulMin,
      signals: [{ label: 'faithfulness', score: a.faithful.score, max: 3 }],
      fix: 'Promise only what the article delivers: headline the core story, not a side detail or a bigger claim.',
    },
    {
      id: 'wording',
      label: 'No stuffing, vague substitutes or redundancy',
      pass: a.keyword_stuffing.noul < y && a.vague_substitute.noul < y && a.redundant.noul < y,
      signals: [
        { label: 'keyword stuffing', p: a.keyword_stuffing.noul, good: 'low' },
        { label: 'vague substitute', p: a.vague_substitute.noul, good: 'low' },
        { label: 'redundant phrasing', p: a.redundant.noul, good: 'low' },
      ],
      notes: stats.repeatedWords.length ? [`Repeated word(s): ${stats.repeatedWords.join(', ')}`] : [],
      fix: 'Replace stand-ins like "this star" with the actual name, drop repeated keywords and words that add nothing.',
    },
    {
      id: 'single_intent',
      label: 'One story intent only',
      pass: a.mixed_intents.noul < y,
      signals: [{ label: 'mixed intents', p: a.mixed_intents.noul, good: 'low' }],
      fix: 'Pick one job for the headline — report, explain, answer or intrigue — and cut the second clause.',
    },
    {
      id: 'concise',
      label: 'Concise and grammatically clean',
      pass: a.grammar_issue.noul < y && a.wordy.noul < y && !stats.tooLong,
      signals: [
        { label: 'grammar issue', p: a.grammar_issue.noul, good: 'low' },
        { label: 'wordy', p: a.wordy.noul, good: 'low' },
      ],
      notes: [`${stats.chars} chars · ${stats.words} words${stats.tooLong ? ' — over length limit' : ''}`],
      fix: 'Tighten to one clean clause in active voice; fix grammar and trim filler words.',
    },
  ];

  const w = policy.weights;
  const parts = {
    subject: a.names_subject.noul,
    faithful: a.faithful.score / 3,
    single_intent: 1 - a.mixed_intents.noul,
    vague: 1 - a.vague_substitute.noul,
    grammar: 1 - a.grammar_issue.noul,
    stuffing: 1 - a.keyword_stuffing.noul,
    redundant: 1 - a.redundant.noul,
    wordy: 1 - a.wordy.noul,
    length: stats.tooLong ? 0 : 1,
  };
  const totalWeight = Object.values(w).reduce((s, v) => s + v, 0);
  const quality = Object.entries(parts).reduce((s, [k, v]) => s + w[k] * v, 0) / totalWeight;

  const intentFit = articleIntent ? a.intent.probabilities[articleIntent] ?? 0 : 0;
  const rank = quality * (1 - policy.intentFitWeight + policy.intentFitWeight * intentFit);
  const failedGates = policy.gates.filter((g) => !checks.find((c) => c.id === g).pass);

  return {
    headline,
    intent: a.intent.choice,
    intentConfidence: round(a.intent.confidence),
    intentProbabilities: Object.fromEntries(Object.entries(a.intent.probabilities).map(([k, v]) => [k, round(v)])),
    checks,
    passed: checks.filter((c) => c.pass).length,
    quality: round(quality),
    intentFit: round(intentFit),
    rank: round(rank),
    failedGates,
    stats,
  };
}

/** Pick one recommended headline and the best headline per intent. */
export function recommend(evaluated) {
  // Most checks passed first, then the weighted rank.
  const ordered = [...evaluated].sort((a, b) => b.passed - a.passed || b.rank - a.rank);
  const eligible = ordered.filter((h) => h.failedGates.length === 0);
  const pick = eligible[0] ?? ordered[0] ?? null;

  const perIntent = Object.fromEntries(
    Object.keys(INTENTS).map((intent) => {
      const inBucket = evaluated.filter((h) => h.intent === intent).sort((a, b) => b.quality - a.quality);
      return [intent, inBucket[0]?.headline ?? null];
    }),
  );

  return {
    headline: pick?.headline ?? null,
    // ready: every check passes; best_available: gates pass, polish needed;
    // needs_revision: no draft clears the gates.
    status: !pick ? 'none'
      : pick.failedGates.length ? 'needs_revision'
      : pick.passed === pick.checks.length ? 'ready'
      : 'best_available',
    perIntent,
  };
}
