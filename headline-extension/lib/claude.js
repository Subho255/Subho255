// Builds and sends the headline request to the Claude Messages API.
// Plain fetch: the extension has no build step, so the npm SDK isn't bundled.

import { analyseTables, tableToMarkdown } from './stats.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const MAX_ARTICLE_CHARS = 60000;

export const STRATEGIES = ['search', 'discover', 'data', 'explainer'];

const SYSTEM_PROMPT = `You are a senior SEO and audience editor at a large digital news publisher. You write headlines that earn clicks from Google Search and Google Discover without misleading readers.

Write five or six headlines for the article, grouped by strategy in this order: one search, two or three discover, one data and one explainer.

1. "search": Google Search / SEO.
   - Put the primary keyword or entity in the first five words.
   - Aim for 50-65 characters so it is not cut off in results.
   - Mirror how readers phrase the query. Add a year, place or other qualifier when people would search with it.
2. "discover": Google Discover. Write two or three, each with a clearly different angle.
   - Pick from angles such as reader impact ("what it means for you"), human or emotional, a surprising specific detail, or what happens next. Write three when the article supports three distinct angles, otherwise two.
   - Each must be specific and compelling, and still name the subject. 60-100 characters is fine.
   - Don't write the same headline twice with different words.
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
- angle: a 2-4 word label for its angle, in English (e.g. "Keyword first", "Reader impact", "Human story", "Surprising detail", "What's next", "Lead number", "Why it matters").
- focus_keyword: the term it targets.
- rationale: one sentence on why it works on that surface.
- caution: one short sentence on any risk, or an empty string.

Data insights (data_insights):
Give the author 2-3 insights from the tables in <tables>, the kind a data desk would put in a subhead, fact box or chart. Only include an insight that tells readers something they would not see by glancing at the table. Quality over quantity: one strong insight beats three weak ones.

Numbers:
- <table_stats> holds statistics computed exactly in code for each table: mean, median, change, change_pct, cagr_pct, trend_per_year and trend_r2, direction, biggest_move, latest_vs_median, outliers, top_share_pct, ranked_by_change_pct, opposite_directions and, only where the data allow it, projection.
- Quote numbers only from <table_stats> or the table itself. Do not do your own arithmetic. If a number you want is not there, leave it out.
- Pick the method that fits the data:
  - Change over several years: cagr_pct or change_pct, and say over which years.
  - Comparing a value with what is typical: use the median when the stats flag skew or outliers, otherwise the mean, and say which.
  - Two or more series moving apart: opposite_directions and ranked_by_change_pct.
  - Columns that are percentages: changes are in percentage points (change_unit). Never call them per cent changes.
  - A one-off spike: biggest_move or outliers.
- Consistency matters: "fell every year for six years" (direction) is stronger than a single change. Treat a trend with trend_r2 below 0.5 as noisy, and say so if you use it.
- Extrapolation: use a projection only if <table_stats> includes one (code allows it only for 5+ evenly spaced points with R² of at least 0.85, one period ahead). Present it as "if the trend continues, about X in YEAR", never as a forecast or fact, and give the method in the caveat. If projection_not_allowed is set, do not project at all.

Meaning:
- Read the direction for what the metric is. For ranks, a lower number is better: a falling closing rank means a seat became harder to get (more demand); a rising closing rank means less competition. Think the same way about prices, costs, rates and scores.
- Combine the number with context from the article: who is affected, and why it matters now.
- Explaining why: if the article gives the reason, use it. Otherwise offer at most one plausible explanation, framed as a possibility ("may reflect", "could point to"), and set the caveat to say the data show a pattern, not a cause. Never state a cause as fact from numbers alone.
- Skip trivial restatements ("the highest value is X") and anything drawn from fewer than 3 data points, unless a two-point change is itself the news.
- Write insight, evidence, context and caveat in the article's language; method and use_as in English.

For each insight give:
- insight: one sentence the author can use as written.
- evidence: the exact numbers behind it, with years or categories.
- method: e.g. "CAGR", "Median comparison", "Divergence", "Consistent trend", "Outlier", "Share of total", "Projection (straight-line)".
- context: one or two sentences linking it to the story.
- confidence: "high" (long, consistent data), "medium" or "low" (short or noisy data, or a speculative explanation).
- caveat: what the data cannot show, or an empty string.
- use_as: where it fits, e.g. "subhead", "fact box", "chart: line of CS vs Civil closing ranks 2020-2025", "angle for the data headline".

If there are no tables, or none supports a meaningful insight, return an empty data_insights list and say why in data_insights_note (otherwise leave the note empty). The data-driven headline may use these statistics too.`;

const HEADLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'angle', 'headline', 'focus_keyword', 'rationale', 'caution'],
  properties: {
    strategy: { type: 'string', enum: STRATEGIES },
    angle: { type: 'string' },
    headline: { type: 'string' },
    focus_keyword: { type: 'string' },
    rationale: { type: 'string' },
    caution: { type: 'string' },
  },
};

const DATA_INSIGHT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insight', 'evidence', 'method', 'context', 'confidence', 'caveat', 'use_as'],
  properties: {
    insight: { type: 'string' },
    evidence: { type: 'string' },
    method: { type: 'string' },
    context: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    caveat: { type: 'string' },
    use_as: { type: 'string' },
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
    'data_insights',
    'data_insights_note',
  ],
  properties: {
    article_language: { type: 'string' },
    primary_keyword: { type: 'string' },
    secondary_keywords: { type: 'array', items: { type: 'string' } },
    headlines: { type: 'array', items: HEADLINE_SCHEMA },
    url_slug: { type: 'string' },
    meta_description: { type: 'string' },
    current_headline_feedback: { type: 'string' },
    data_insights: { type: 'array', items: DATA_INSIGHT_SCHEMA },
    data_insights_note: { type: 'string' },
  },
};

export class HeadlineError extends Error {}

export function buildRequest({ model, article, focusKeyword = '', currentHeadline = '', tables = [] }) {
  const text = article.trim();
  if (text.length < 200) throw new HeadlineError('The article is too short. Write at least a paragraph in the body field.');
  if (text.length > MAX_ARTICLE_CHARS) {
    throw new HeadlineError(`The article is ${text.length.toLocaleString()} characters. The limit is ${MAX_ARTICLE_CHARS.toLocaleString()}.`);
  }

  const parts = [`<article>\n${text}\n</article>`];
  if (focusKeyword.trim()) parts.push(`Focus keyword from the editor: ${focusKeyword.trim()}`);
  if (currentHeadline.trim()) parts.push(`Current headline: ${currentHeadline.trim()}`);

  // Tables go in twice: as Markdown so the model sees the layout, and as exact statistics
  // computed in code so it never has to do arithmetic.
  const analysed = analyseTables(tables);
  if (analysed.length) {
    parts.push(`<tables>\n${analysed.map((a, i) => `Table ${i + 1}\n${tableToMarkdown(a.table)}`).join('\n\n')}\n</tables>`);
    parts.push(`<table_stats>\n${JSON.stringify(analysed.map((a) => a.stats))}\n</table_stats>`);
    parts.push('Write the headlines and the data insights.');
  } else {
    parts.push('The article has no tables, so return an empty data_insights list with data_insights_note "No table in the article." Write the headlines.');
  }

  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
    output_config: {
      // Finding a real insight in tables needs more thought than writing headlines.
      effort: analysed.length ? 'high' : 'medium',
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
  // Group by strategy in a fixed order: one each, except up to three for Discover.
  result.headlines = STRATEGIES.flatMap((s) => result.headlines
    .filter((h) => h.strategy === s)
    .slice(0, s === 'discover' ? 3 : 1));
  result.data_insights = (result.data_insights ?? []).slice(0, 3);
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
