// Builds and sends the headline request to the Claude Messages API.
// Plain fetch: the extension has no build step, so the npm SDK isn't bundled.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const MAX_ARTICLE_CHARS = 60000;

export const STRATEGIES = ['search', 'discover', 'data', 'explainer'];

const SYSTEM_PROMPT = `You are a senior SEO and audience editor at a large digital news publisher. You write headlines that earn clicks from Google Search and Google Discover without misleading readers.

Write exactly four headlines for the article, one for each strategy, in this order:

1. "search": Google Search / SEO.
   - Put the primary keyword or entity in the first five words.
   - Aim for 50-65 characters so it is not cut off in results.
   - Mirror how readers phrase the query. Add a year, place or other qualifier when people would search with it.
2. "discover": Google Discover.
   - A specific, compelling human, consequence or "what it means for you" angle. 60-100 characters is fine.
   - It must still name the subject.
   - Follow Google's Discover policies: no withholding the key fact ("you won't believe", "this one thing"), no exaggeration, no sensational or shock framing.
3. "data": Data-driven.
   - Lead with the strongest number in the article: an amount, percentage, count, rank, date or record.
   - Use only numbers that appear in the article. If there is no number at all, use the most concrete specific detail and say so in the rationale.
4. "explainer": Explainer / question-led.
   - A What / Why / How / Who framing that answers the question the article actually answers.
   - Targets People Also Ask and voice search. Can be a question or "X explained" style.

Rules for every headline:
- Write in the article's language. Hindi articles get Devanagari headlines; keep English terms readers search in English (brand names, "IPL 2026", "iPhone").
- Use only facts in the article. Never invent numbers, names, quotes, dates or outcomes.
- No keyword stuffing, no repeated words, no vague fillers ("big update", "know everything"), no ALL CAPS.
- Use sentence case unless the article's own style differs.
- If the editor gives a focus keyword, use it verbatim in the search headline when the facts support it.
- If the editor gives a current headline, critique it briefly in current_headline_feedback; otherwise leave that field as an empty string.

Also return:
- primary_keyword: the main search term the article can rank for.
- secondary_keywords: 3-5 related terms readers search.
- url_slug: lowercase English, hyphen-separated, 3-8 words, no stop words. Transliterate or translate Hindi.
- meta_description: up to 155 characters, in the article's language, with the primary keyword.

For each headline give:
- focus_keyword: the term it targets.
- rationale: one sentence on why it works on that surface.
- caution: one short sentence on any risk, or an empty string.`;

const HEADLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'headline', 'focus_keyword', 'rationale', 'caution'],
  properties: {
    strategy: { type: 'string', enum: STRATEGIES },
    headline: { type: 'string' },
    focus_keyword: { type: 'string' },
    rationale: { type: 'string' },
    caution: { type: 'string' },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'article_language',
    'primary_keyword',
    'secondary_keywords',
    'headlines',
    'url_slug',
    'meta_description',
    'current_headline_feedback',
  ],
  properties: {
    article_language: { type: 'string' },
    primary_keyword: { type: 'string' },
    secondary_keywords: { type: 'array', items: { type: 'string' } },
    headlines: { type: 'array', items: HEADLINE_SCHEMA },
    url_slug: { type: 'string' },
    meta_description: { type: 'string' },
    current_headline_feedback: { type: 'string' },
  },
};

export class HeadlineError extends Error {}

export function buildRequest({ model, article, focusKeyword = '', currentHeadline = '' }) {
  const text = article.trim();
  if (text.length < 200) throw new HeadlineError('The article is too short. Write at least a paragraph in the body field.');
  if (text.length > MAX_ARTICLE_CHARS) {
    throw new HeadlineError(`The article is ${text.length.toLocaleString()} characters. The limit is ${MAX_ARTICLE_CHARS.toLocaleString()}.`);
  }

  const parts = [`<article>\n${text}\n</article>`];
  if (focusKeyword.trim()) parts.push(`Focus keyword from the editor: ${focusKeyword.trim()}`);
  if (currentHeadline.trim()) parts.push(`Current headline: ${currentHeadline.trim()}`);
  parts.push('Write the four headlines.');

  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
  };

  const headers = {
    'content-type': 'application/json',
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  // If the model declines a request, the API retries it on a fallback model.
  // Haiku has no server-side fallback.
  if (!model.startsWith('claude-haiku')) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  return { headers, body };
}

export function parseResponse(data) {
  if (data.stop_reason === 'refusal') {
    throw new HeadlineError('The model declined this article. Edit the text and try again.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new HeadlineError('The response was cut off. Try again.');
  }
  const textBlock = (data.content ?? []).find((b) => b.type === 'text');
  if (!textBlock) throw new HeadlineError('The response had no text.');

  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch {
    throw new HeadlineError('The response was not valid JSON. Try again.');
  }
  // Keep the strategy order fixed, whatever order the model returned.
  result.headlines = STRATEGIES
    .map((s) => result.headlines.find((h) => h.strategy === s))
    .filter(Boolean);
  result.model = data.model;
  result.usage = data.usage;
  return result;
}

export async function suggestHeadlines({ apiKey, ...input }) {
  if (!apiKey) throw new HeadlineError('Add your Anthropic API key in Settings first.');
  const { headers, body } = buildRequest(input);

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { ...headers, 'x-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HeadlineError('Could not reach the Anthropic API. Check your connection.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    if (res.status === 401) throw new HeadlineError('The API key was rejected. Check it in Settings.');
    if (res.status === 429) throw new HeadlineError('Rate limited by the API. Wait a moment and try again.');
    if (res.status === 529 || res.status >= 500) throw new HeadlineError('The API is overloaded right now. Try again shortly.');
    throw new HeadlineError(`API error ${res.status}: ${msg}`);
  }
  return parseResponse(data);
}
