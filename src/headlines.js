import Anthropic from '@anthropic-ai/sdk';
import { HeadlineError, buildRequest, parseResponse } from '../headline-extension/lib/claude.js';

// Server side of the Chrome extension: the extension sends the article, the server calls
// Claude with its own API key, so no key is ever installed in a browser. The prompt,
// schema and response parsing are shared with the extension (headline-extension/lib).

export const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_FIELD = 300;

export { HeadlineError };

export class NotConfiguredError extends Error {}

/** Returns null when ANTHROPIC_API_KEY is not set, so the rest of the server still runs. */
export function createAnthropicClient(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
}

/**
 * Builds the headline function used by POST /api/ext/headlines.
 * `client` is an Anthropic client (or a test double with beta.messages.create).
 */
export function headlineService({ client, model = DEFAULT_MODEL }) {
  return async function suggest(input) {
    if (!client) throw new NotConfiguredError('Headline suggestions are not set up on the server yet (ANTHROPIC_API_KEY is missing).');
    const article = typeof input?.article === 'string' ? input.article : '';
    const focusKeyword = String(input?.focusKeyword ?? '').slice(0, MAX_FIELD);
    const currentHeadline = String(input?.currentHeadline ?? '').slice(0, MAX_FIELD);

    // Tables are trimmed to size and analysed inside buildRequest (headline-extension/lib/stats.js).
    const tables = Array.isArray(input?.tables) ? input.tables : [];
    const { headers, body } = buildRequest({ model, article, focusKeyword, currentHeadline, tables });
    const betas = headers['anthropic-beta'] ? [headers['anthropic-beta']] : undefined;
    const message = await client.beta.messages.create({ ...body, ...(betas ? { betas } : {}) });
    return parseResponse(message);
  };
}

/** Maps an error from suggest() to an HTTP status and a message that is safe to show. */
export function headlineErrorResponse(err) {
  if (err instanceof NotConfiguredError) return { status: 503, error: err.message };
  if (err instanceof HeadlineError) return { status: 422, error: err.message };
  if (err instanceof Anthropic.APIConnectionError) {
    console.error('Anthropic connection failed:', err.message);
    return { status: 502, error: 'Could not reach the AI service. Try again shortly.' };
  }
  if (err instanceof Anthropic.RateLimitError) return { status: 429, error: 'The AI service is busy. Try again in a minute.' };
  if (err instanceof Anthropic.AuthenticationError) {
    console.error('Anthropic rejected the server API key');
    return { status: 502, error: 'The server’s AI key was rejected. Ask the admin to check ANTHROPIC_API_KEY.' };
  }
  if (err instanceof Anthropic.APIError) {
    console.error(`Anthropic API ${err.status}`, err.message);
    return { status: 502, error: 'The AI service returned an error. Try again shortly.' };
  }
  console.error(err);
  return { status: 500, error: 'Internal error' };
}
