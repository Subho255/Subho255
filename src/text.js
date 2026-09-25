// Deterministic text work that stays in code: splitting, candidate
// generation and mechanical headline rules. Jev only judges what code
// cannot decide.

export const LIMITS = {
  maxSentences: 30,
  maxSentenceChars: 320,
  maxEntities: 12,
  articleChars: 12000,
  excerptChars: 4000,
  headlineMaxChars: 80,
  headlineMaxWords: 16,
};

const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Gen|Col|Lt|Sgt|Gov|Sen|Rep|Inc|Ltd|Co|Corp|vs|etc|No|U\.S|U\.K|a\.m|p\.m)\.$/i;

/** Split article text into sentences, keeping abbreviations intact. */
export function splitSentences(text) {
  const paragraphs = text.replace(/\r/g, '').split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const para of paragraphs) {
    let buf = '';
    const parts = para.split(/(?<=[.!?]["'”’)]?)\s+(?=["'“‘(]?[A-Z0-9])/);
    for (const part of parts) {
      buf = buf ? `${buf} ${part}` : part;
      if (!ABBREVIATIONS.test(buf)) {
        out.push(buf.trim());
        buf = '';
      }
    }
    if (buf) out.push(buf.trim());
  }
  return out.filter((s) => s.split(/\s+/).length >= 4);
}

/** Candidate sentences for the core-story choice, labelled s1..sN. */
export function sentenceCandidates(text) {
  return splitSentences(text)
    .slice(0, LIMITS.maxSentences)
    .map((s, i) => ({
      id: `s${i + 1}`,
      text: s.length > LIMITS.maxSentenceChars ? `${s.slice(0, LIMITS.maxSentenceChars - 1)}…` : s,
    }));
}

const STOP_CAPS = new Set([
  'The', 'A', 'An', 'In', 'On', 'At', 'For', 'But', 'And', 'Or', 'If', 'As', 'It', 'Its', 'This', 'That',
  'These', 'Those', 'He', 'She', 'They', 'We', 'I', 'You', 'His', 'Her', 'Their', 'Our', 'After', 'Before',
  'When', 'While', 'With', 'From', 'By', 'To', 'Of', 'According', 'However', 'Meanwhile', 'Also', 'There',
  'What', 'Why', 'How', 'Who', 'Where', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December',
]);

/**
 * Candidate primary subjects: runs of capitalised words and acronyms on
 * one line, ranked by how often they are mentioned. Jev picks among these;
 * it cannot pick a name that is not listed.
 */
export function entityCandidates(text, headline = '') {
  const source = `${headline}\n${text}`;
  const word = String.raw`(?:[A-Z](?:\.[A-Z])+\.?|[A-Z][\p{L}'’-]*\d*)`;
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${word}(?:(?:[ \t]+(?:of|de|for|&)[ \t]+|[ \t]+)${word})*`, 'gu');
  const found = new Map();
  let order = 0;
  for (const m of source.matchAll(re)) {
    const before = source.slice(Math.max(0, m.index - 6), m.index);
    const atSentenceStart = m.index === 0 || /(?:^|[.!?]["'”’)]?\s+|\n\s*)["'“‘(]?$/.test(before);
    const words = m[0].replace(/[’']s$/u, '').split(/\s+/);
    while (words.length && (STOP_CAPS.has(words[0]) || HONORIFICS.test(words[0]))) words.shift();
    while (words.length && /^(of|de|for|&)$/i.test(words.at(-1))) words.pop();
    const phrase = words.join(' ');
    if (phrase.length < 2 || !/\p{L}{2}/u.test(phrase) || STOP_CAPS.has(phrase)) continue;
    const entry = found.get(phrase) ?? { phrase, midSentence: false, first: order++ };
    // A lone capitalised word seen only at sentence starts is usually an
    // ordinary word ("Opponents"), not a name.
    if (!atSentenceStart || words.length > 1 || /^[A-Z]{2,}/.test(phrase)) entry.midSentence = true;
    found.set(phrase, entry);
  }
  const lowerSource = source.toLowerCase();
  return [...found.values()]
    .filter((e) => e.midSentence)
    // Count every mention, including inside longer names.
    .map((e) => ({ ...e, count: countMentions(lowerSource, e.phrase.toLowerCase()) }))
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, LIMITS.maxEntities)
    .map((e, i) => ({ id: `e${i + 1}`, text: e.phrase, count: e.count }));
}

const HONORIFICS = /^(?:Mr|Mrs|Ms|Dr|Prof|Sir|Dame|Mayor|President|Minister|Senator|Sen|Gov|Governor|Rep|Judge|Chief|CEO|Councillor|Councilor|Gen|Col|Capt|Lt|Sgt|Officer)\.?$/;

function countMentions(haystack, needle) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
  return (haystack.match(re) ?? []).length;
}

/** Mechanical headline facts computed in code, not asked of the model. */
export function headlineStats(headline) {
  const words = headline.trim().split(/\s+/).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length > 3);
  const seen = new Set();
  const repeated = new Set();
  for (const w of lower) (seen.has(w) ? repeated : seen).add(w);
  return {
    chars: headline.trim().length,
    words: words.length,
    repeatedWords: [...repeated],
    separators: (headline.match(/\s[|–—-]\s|\|/g) ?? []).length,
    tooLong: headline.trim().length > LIMITS.headlineMaxChars || words.length > LIMITS.headlineMaxWords,
  };
}

/** Parse the author's draft list: one headline per line, deduplicated. */
export function parseDrafts(raw) {
  const seen = new Set();
  const out = [];
  for (const line of String(raw ?? '').split('\n')) {
    const h = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    const key = h.toLowerCase();
    if (h && !seen.has(key)) {
      seen.add(key);
      out.push(h);
    }
  }
  return out;
}
