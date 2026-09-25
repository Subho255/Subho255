// Offline stand-in for TypeSafeClient.systemOne, for UI work and tests
// when the TypeSafe API is unreachable. It returns the same response
// shapes using crude keyword heuristics — it is NOT a model and its
// judgments must not be used to evaluate headline quality.

const clamp = (n) => Math.min(0.97, Math.max(0.03, n));

function distribution(labels, favoured, strength = 0.7) {
  const rest = (1 - strength) / Math.max(1, labels.length - 1);
  const probabilities = Object.fromEntries(labels.map((l) => [l, l === favoured ? strength : rest]));
  return { type: 'choice', choice: favoured, confidence: strength, probabilities };
}

function intentOf(text) {
  const t = text.toLowerCase();
  if (/\b(why|what it means|explained|how .* works|everything you need)\b/.test(t)) return 'explainer';
  if (/\b(how to|what is|when is|price|date|list of|best|vs\.?|guide)\b/.test(t)) return 'search';
  if (/\b(you won't|secret|surprising|this is|meet|inside)\b/.test(t)) return 'discover';
  return 'news';
}

function answer(name, q, state) {
  const headline = typeof state.headline === 'string' ? state.headline : '';
  const h = headline.toLowerCase();
  const subject = state.article?.primary_subject?.toLowerCase().split(' ')[0] ?? '';

  if (q.type === 'choice') {
    const labels = Object.keys(q.criteria);
    if (name === 'core_story') return distribution(labels, labels[0], 0.62);
    if (name === 'primary_subject') {
      const lead = String(state.article?.body ?? '').slice(0, 200);
      const hit = labels.find((l) => l !== 'none' && lead.includes(String(q.criteria[l])));
      return distribution(labels, hit ?? labels[0], 0.58);
    }
    const text = name === 'article_intent' ? String(state.article?.body ?? '').slice(0, 600) : headline;
    return distribution(labels, intentOf(text), 0.64);
  }
  if (q.type === 'score') {
    const s = subject && h.includes(subject) ? 2.5 : 1.6;
    const probabilities = { 0: 0.05, 1: 0.2, 2: 0.4, 3: 0.35 };
    return { type: 'score', score: s, confidence: 0.6, legend: { ...q.criteria }, probabilities };
  }
  const words = h.split(/\s+/);
  const heuristics = {
    names_subject: subject ? (h.includes(subject) ? 0.85 : 0.2) : 0.5,
    keyword_stuffing: /\|/.test(h) || new Set(words).size < words.length * 0.8 ? 0.8 : 0.1,
    vague_substitute: /\b(this|these|you won't|here's why|a popular|a famous|the star)\b/.test(h) ? 0.8 : 0.12,
    redundant: /\b(completely|new innovation|past history|very unique|end result)\b/.test(h) ? 0.75 : 0.1,
    mixed_intents: /:\s*(here's|everything|what|why|how)/.test(h) || (h.match(/[:;—]/g) ?? []).length > 1 ? 0.8 : 0.15,
    grammar_issue: /\s{2,}| ,|\b(\w+) \1\b/.test(headline) ? 0.7 : 0.08,
    wordy: words.length > 14 ? 0.75 : 0.2,
  };
  return { type: 'noul', noul: clamp(heuristics[name] ?? 0.5) };
}

export class MockTypeSafeClient {
  defaultModel = 'mock-heuristics';

  async systemOne({ state, questions }) {
    await new Promise((r) => setTimeout(r, 120));
    const answers = Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, answer(name, q, state)]));
    return { model: this.defaultModel, answers, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}
