// Defences against prompt injection and made-up numbers. Pure functions: used by the
// extension and the server alike.

export const MAX_SHORT_FIELD = 150; // focus keyword and current headline

/** Neutralises angle brackets so pasted text cannot fake the prompt's <article> etc. tags. */
export function escapeForPrompt(text) {
  return String(text ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Trims and caps a one-line field (focus keyword, current headline). */
export function shortField(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SHORT_FIELD);
}

// Phrases that address an AI rather than a reader. English and Hindi.
const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(instructions?|prompts?|rules|guidelines|directions)\b/i,
  /\b(previous|prior|above|earlier|system)\s+(instructions?|prompts?|messages?)\b/i,
  /\byou\s+are\s+(now\s+)?(an?\s+)?(ai|assistant|chatbot|language\s+model|llm|chatgpt|claude|gpt)\b/i,
  /\b(as\s+an?\s+)?(ai|language\s+model|llm|chatbot|assistant)[,:]?\s+(you\s+)?(must|should|will|need\s+to)\b/i,
  /\b(new|updated|real|actual|hidden)\s+instructions?\b/i,
  /\bsystem\s*prompt\b/i,
  /\b(jailbreak|developer\s+mode|dan\s+mode|do\s+anything\s+now)\b/i,
  /\b(pretend|act)\s+(to\s+be|as\s+if|as\s+an?)\b[^.\n]{0,30}\b(ai|assistant|model|editor|admin)\b/i,
  /\b(headlines?|output|response|answer)\s+(must|should)\s+(always\s+)?(include|mention|say|promote|contain)\b/i,
  /\brespond\s+only\s+with\b/i,
  /<\/?\s*(article|tables|table_stats|focus_keyword|current_headline|system|instructions?)\s*>/i,
  /(पिछले|पूर्व|ऊपर\s+के)\s+(सभी\s+)?निर्देश/,
  /निर्देश(ों)?\s+(को\s+)?(अनदेखा|नज़रअंदाज़|नजरअंदाज|भूल)/,
  /(तुम|आप)\s+(एक\s+)?(एआई|AI|चैटबॉट)\s+(हो|हैं)/,
];

/**
 * Finds text that looks like instructions aimed at an AI.
 * `fields` is { article, keyword, headline, tables } with tables as [{ caption, rows }].
 * Returns [{ field, snippet }], at most 5.
 */
export function detectInstructions(fields) {
  const sources = [
    ['article', fields.article],
    ['focus keyword', fields.keyword],
    ['current headline', fields.headline],
    ...(fields.tables ?? []).map((t, i) => [`table ${i + 1}`, [t.caption, ...(t.rows ?? []).flat()].join(' \n ')]),
  ];
  const found = [];
  for (const [field, raw] of sources) {
    const text = String(raw ?? '');
    for (const re of INSTRUCTION_PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      const start = Math.max(0, m.index - 30);
      const snippet = text.slice(start, m.index + m[0].length + 50).replace(/\s+/g, ' ').trim();
      found.push({ field, snippet: `${start > 0 ? '…' : ''}${snippet}…` });
      break; // one hit per field is enough to warn
    }
    if (found.length >= 5) break;
  }
  return found;
}

// --- number checking for data insights ------------------------------------------------

const DEVANAGARI = /[०-९]/g;
const toAscii = (s) => String(s).replace(DEVANAGARI, (d) => String(d.charCodeAt(0) - 0x0966));

/** All numbers written in a text, as absolute values ("−21.7%" → 21.7, "3,966" → 3966). */
export function numbersIn(text) {
  const out = [];
  for (const m of toAscii(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, '').replace(/\.$/, '');
    if (raw) out.push({ value: Number(raw), decimals: (raw.split('.')[1] ?? '').length, raw: m[0] });
  }
  return out;
}

/** Every number in a nested value (the table stats), as absolute values. */
export function collectNumbers(value, into = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) into.add(Math.abs(value));
  else if (typeof value === 'string') numbersIn(value).forEach((n) => into.add(n.value));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, into));
  return into;
}

/**
 * A quoted number matches an allowed one if it is the same number written with the
 * precision shown: 0.99 matches 0.995, 456 matches 456.13, 21.7 matches 21.7.
 * Small counts (up to 12, e.g. "5 years", "3 states") are always allowed.
 */
export function isAllowedNumber(q, allowed) {
  if (Number.isInteger(q.value) && q.value <= 12) return true;
  const tolerance = q.decimals ? 10 ** -q.decimals : 1;
  for (const a of allowed) if (Math.abs(a - q.value) < tolerance) return true;
  return false;
}

/**
 * Drops insights that quote a number not found in the tables or their computed stats.
 * Checks the insight and evidence fields (context may cite the article's prose).
 * Returns { kept, dropped: [{ insight, numbers }] }.
 */
export function verifyInsights(insights, allowedNumbers) {
  const allowed = [...allowedNumbers];
  const kept = [];
  const dropped = [];
  for (const d of insights ?? []) {
    const bad = numbersIn(`${d.insight} ${d.evidence}`).filter((q) => !isAllowedNumber(q, allowed));
    if (bad.length) dropped.push({ insight: d.insight, numbers: bad.map((b) => b.raw) });
    else kept.push(d);
  }
  return { kept, dropped };
}
