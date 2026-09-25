# Headline Desk

A headline tool for authors. Paste an article and your headline drafts. It:

1. **Identifies the core story in one sentence.** It selects this sentence from the article; it does not rewrite it.
2. **Sorts every draft into one of four reader intents:** Search, Discover, News or Explainer. It also finds which intent the article itself serves.
3. **Checks each draft against five rules:**
   - names the primary subject/entity
   - matches what the article actually delivers
   - avoids keyword stuffing, vague substitutes and redundant phrasing
   - serves one story intent, not several
   - is concise and grammatically clean
4. **Recommends one headline** and shows the best draft for each intent.

Judgments come from [TypeSafe](https://typesafe.ai)'s **Jev** model via `@typesafe-ai/sdk`.

## How it works

Jev returns typed judgments and probabilities, not generated text. So the tool **selects** rather than generates:

| Step | Code does | Jev judges |
| --- | --- | --- |
| Core story | Splits the article into candidate sentences | `choice`: which sentence states the core story (or `none`) |
| Primary subject | Extracts candidate names (capitalised runs, ranked by mentions) | `choice`: which name the story is about |
| Article intent | — | `choice` over Search / Discover / News / Explainer |
| Per headline (in parallel) | Length, word count, repeated words | `choice` intent · `noul` names subject · `score` 0–3 faithfulness · `noul` stuffing / vague / redundant / mixed intents / grammar / wordy |
| Recommendation | Explicit policy in `src/policy.js` | — |

There are two request stages. Stage 2 depends on stage 1, because each headline is judged against the selected core story and subject. Stage 1 is one request. Stage 2 sends one request per draft, all in parallel.

**Policy** (`src/policy.js`) is kept separate from the raw judgments:
- Three hard gates: names subject, faithful (score ≥ 2 of 3), single intent. A draft that fails a gate cannot be recommended outright.
- Status is `ready` when all five checks pass, `best_available` when the gates pass but a polish check fails, and `needs_revision` when no draft clears the gates.
- Drafts are ranked by checks passed, then by weighted quality. Agreement with the article's intent adds a small bonus.

The thresholds and weights are starting guesses. Tune them on real newsroom headlines.

Failing checks show a fix hint. Jev doesn't write replacement headlines. If you want generated rewrites, add a generator (an LLM or the author) upstream and run its output back through the same checks.

## Run

```sh
npm install
cp .env.example .env          # set TYPESAFE_API_KEY
npm start                     # http://localhost:3000
```

Offline or UI work: `npm run dev:mock`. This swaps Jev for keyword heuristics that return the same response shapes. The UI shows a banner in this mode, and its judgments are not meaningful.

Tests: `npm test`

The API key stays on the server. The browser only calls `/api/analyze`.

## Layout

```
server.js           HTTP server: static UI + /api/analyze
src/text.js         sentence split, name candidates, headline stats (code-owned)
src/questions.js    Jev question definitions (intents, checks)
src/analyze.js      two-stage pipeline
src/policy.js       checks, gates, weights, recommendation
src/mock.js         offline stand-in client
public/             UI (vanilla HTML/CSS/JS)
test/               node:test suite
```
