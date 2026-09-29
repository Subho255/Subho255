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

## Deploy with Google sign-in

The server has Google sign-in built in. Signed-out visitors see a login page. The app and `/api/*` need a session: a signed, HttpOnly cookie that lasts 7 days. Each user gets 30 analyses per hour by default, which protects the shared TypeSafe key. With `NODE_ENV=production`, the server refuses to start unless sign-in is configured.

### 1. Create Google OAuth credentials

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Set up the **OAuth consent screen**: user type *External*, app name *Headline Desk*, scopes `openid email profile`. Publish the app, or add testers while it's in testing mode.
3. Create an **OAuth client ID** of type *Web application*.
4. Add this **Authorized redirect URI**: `https://<your-app-url>/auth/google/callback`
5. Copy the client ID and client secret.

### 2. Deploy

**Render (free tier, one click):**
1. In [Render](https://dashboard.render.com), choose New → Blueprint and pick this repo/branch. `render.yaml` sets everything up.
2. When prompted, fill in `TYPESAFE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `ALLOWED_DOMAINS` / `ALLOWED_EMAILS`. `SESSION_SECRET` is generated for you.
3. The app URL will be `https://headline-desk-XXXX.onrender.com`. Put `/auth/google/callback` on that URL into the Google client's redirect URIs from step 1.

**Anywhere with Docker** (Cloud Run, Fly, a VM):
```sh
docker build -t headline-desk .
docker run -p 3000:3000 --env-file .env -e PUBLIC_URL=https://your.domain headline-desk
```
On Cloud Run: `gcloud run deploy headline-desk --source . --allow-unauthenticated --set-env-vars ...`. The app does its own sign-in, which is why the service can allow unauthenticated requests.

### Who can sign in

| `ALLOWED_DOMAINS` / `ALLOWED_EMAILS` | Access |
| --- | --- |
| both empty | any verified Google account |
| `ALLOWED_DOMAINS=jagrannewmedia.com` | only that Workspace domain |
| `ALLOWED_EMAILS=a@gmail.com,b@gmail.com` | only those people |

Both variables can be combined. Every analysis spends your TypeSafe credits, so restrict access unless you intend the tool to be public.

## Layout

```
server.js           HTTP server: auth gate, static UI, /api/analyze
src/text.js         sentence split, name candidates, headline stats (code-owned)
src/questions.js    Jev question definitions (intents, checks)
src/analyze.js      two-stage pipeline
src/policy.js       checks, gates, weights, recommendation
src/auth.js         Google OAuth, signed session cookie, allowlist, rate limit
src/mock.js         offline stand-in client
public/             UI + login page (vanilla HTML/CSS/JS)
render.yaml         Render blueprint
Dockerfile          container image for any host
test/               node:test suite
```
