# Headline Optimiser (Chrome extension)

Reads the article from the CMS body field (**`Enter_Body`**, **`Body`** in the News form or **`Description`** in the Exam form) and suggests five or six SEO-backed headlines: one each for Search, Data-driven and Explainer, and two or three for Discover, each with a different angle.

| Strategy | Built for | Rules it follows |
| --- | --- | --- |
| **Search** | Google Search | Primary keyword in the first five words, 50–65 characters, phrased like the query people type |
| **Discover** (2–3) | Google Discover | Each takes a different angle, such as reader impact, human story, surprising detail or what's next. 60–100 characters, no clickbait that Discover penalises |
| **Data-driven** | Both | Leads with the strongest number in the article, and only numbers that are in it |
| **Explainer** | People Also Ask, voice search | What / Why / How framing that the article actually answers |

Each suggestion shows its angle, its character count against the target, the keyword it targets, a one-line reason and any risk. It also returns a primary keyword, related keywords, a URL slug and a meta description.

Headlines come out in the article's language. Hindi articles get Devanagari headlines, with English search terms such as "RBI repo rate" kept in English. The model is told never to invent facts or numbers. Still check every headline before publishing.

## Data insights

When the article contains tables, the popup adds a **Data insights** card with 2–3 pointers the author can use as a subhead, fact box or chart idea. Each one shows the evidence (the exact numbers), the method, a confidence level and a caveat.

How it stays accurate:

1. **Real tables.** The extension reads the HTML tables in the editor, fills in merged cells and multi-row headers, and uses the heading above each table as its caption.
2. **Numbers computed in code, not by the model** (`lib/stats.js`, `lib/distribution.js`, `lib/explore.js`). Skewness, kurtosis, Shapiro–Wilk, percentiles and variance are tested against SciPy to 6 decimal places. The code detects whether years run across or down the table, and which measures can be added up (counts, amounts) and which can't (ranks, rates, averages, prices). Then it computes:

   | Family | Methods | Safeguards |
   | --- | --- | --- |
   | Descriptive | mean, median, mode, variance, standard deviation, coefficient of variation, range, quartiles (Q1–Q3), IQR, percentiles (P10, P90) | Mode only when a value repeats; percentiles only with 10+ values |
   | Distribution (category tables) | skewness (positive/negative), excess kurtosis (tails), Shapiro–Wilk normality test, frequency distribution (Sturges' rule, nice bins), bimodal/multimodal detection with where the groups split, outliers by IQR and robust z-score (median/MAD) | Normality needs 8+ values and says when the sample is small; bimodality needs 10+ values and agreement between histogram peaks and the bimodality coefficient; shape stats are skipped for time series |
   | Time-series outliers | years far off a robust (Theil–Sen) trend line | The odd year can't pull the trend towards itself |
   | Change over time | change, % change, CAGR, linear trend and R², direction streaks, biggest move, latest vs median | Percentage columns change in percentage points; no CAGR for rates |
   | Group comparison | benchmark against the group median (% above or below), ranking, top–bottom gap and % difference, growth vs the group's median CAGR, rank shifts between first and last year | — |
   | Cross-tabulation | shares of total, cells over- or under-represented against the overall mix, share shift over time (pp), Cramér's V | Only for additive measures of the same kind; Cramér's V only for whole-number counts |
   | Weighted averages | rate weighted by a count column (e.g. literacy by population) next to the simple mean | Only pairs a non-additive rate with an additive count |
   | Correlation | Pearson, Spearman, Kendall's tau-b, approximate p-value, correlation matrix (3–6 series) | 5+ shared points; significance flag at 5%; correlation of yearly changes to catch shared time trends; warns when Pearson and Spearman disagree |
   | Regression | linear trend over time; simple linear regression for strong, significant cross-sectional pairs; quadratic (polynomial) trend to detect acceleration or slowdown | The curve is kept only if a partial F-test at 5% beats the straight line |

   Multiple, logistic, ridge and lasso regression are deliberately left out. News tables rarely have more than 5–30 rows, so fitting several predictors would describe noise. Logistic regression needs a yes/no outcome per row, which these tables don't have. Ridge and lasso solve problems (many correlated predictors) these tables don't have.

3. **Extrapolation is gated.** A projection is offered only with at least 5 evenly spaced points and a steady trend (R² ≥ 0.85), only one period ahead, and never below zero for counts. Otherwise the stats say why not, and the model is told not to project.
4. **The model interprets.** It gets the table and the exact stats, may quote only those numbers, and chooses the method that fits: the median for skewed data, CAGR for multi-year growth, divergence when series move apart. It reads direction for the metric (a falling closing rank means more demand) and frames any explanation as a possibility, with a caveat that the data show a pattern, not a cause.

If there's no table, the card stays hidden. If the tables don't support anything meaningful, it says so instead of padding.

## Look

The popup and settings page use a pink kawaii theme:

- a pink gingham background
- a kitten peeking over the top of the main panel, with its paws on the edge
- a bold rounded title (Fredoka, bundled under the SIL Open Font License) between outline hearts, and a scalloped title band
- opaque cards with maroon outlines, so text stays easy to read
- kittens and tumblers peeking in from the left and right edges
- a kitten hugging a tumbler, shown until headlines arrive

There is a plum version for dark mode. All artwork is original, with no brand logos, in `assets/`.

## Install (colleagues)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `headline-extension` folder.
3. Pin the extension and click its icon. Click **Sign in with Google** and choose your **@jagrannewmedia.com** account.

That's it: no API key. You stay signed in for 30 days, then click **Sign in with Google** again. Personal Gmail and other accounts are refused.

If the popup asks for a server URL instead, your admin hasn't set the default yet. Open **Options**, paste the company server URL they give you, and click **Sign in with Google**.

## Set up the company server (admin, once)

The server holds the Anthropic key and checks every request comes from a signed-in company account. It's the `server.js` app at the root of this repo.

1. **Google sign-in.** In [Google Cloud Console → APIs & Services](https://console.cloud.google.com/apis/credentials):
   - Set up the **OAuth consent screen** with user type **Internal**. Google then only lets accounts from your company's Google Workspace sign in at all.
   - Create an **OAuth client ID** of type **Web application**. Add the redirect URI `https://<your-server>/auth/google/callback`.
2. **Deploy.** On [Render](https://dashboard.render.com), choose New → Blueprint and pick this repo; `render.yaml` sets it up. Fill in `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. `ALLOWED_DOMAINS=jagrannewmedia.com` and `REQUIRE_WORKSPACE=1` are already set. Docker works too; see the root README.
3. **Point the extension at it.** Put the server URL in `DEFAULT_SERVER_URL` in `lib/settings.js`, then zip the folder and share it. Colleagues then only click **Sign in with Google**.

Who gets in, and how to remove access:

| Setting | Effect |
| --- | --- |
| `ALLOWED_DOMAINS=jagrannewmedia.com` | Any company account, such as subhomoy.ganguly@jagrannewmedia.com or atul.tyagi@jagrannewmedia.com |
| `ALLOWED_EMAILS=a@jagrannewmedia.com,b@jagrannewmedia.com` | Use this instead of the domain to allow only named people |
| `REQUIRE_WORKSPACE=1` | The account must be managed by the company's Google Workspace, not just use a company address |
| `HEADLINES_PER_HOUR=60` | Requests per person per hour |

Allowlist changes apply to the next request, including for people already signed in. To sign everyone out at once, change `SESSION_SECRET`.

On Render's free plan the server sleeps when idle, so the first request after a quiet spell can take up to a minute.

## Use

1. Open an article in the CMS editor.
2. Click the extension icon. It reads `Enter_Body` and shows how many words it found.
3. Optionally type a focus keyword, then click **Suggest headlines**. A run takes about 15–30 seconds.
4. Click **Copy** on the headline you want.

You can close the popup while it works. The request runs in the background, and the results stay there when you reopen the popup on that tab.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Company server URL | `DEFAULT_SERVER_URL` in `lib/settings.js` | Where sign-in and headline requests go. |
| Own API key, model | empty, Opus 5.5 | Under **Advanced**. Used only when the server URL is empty: the extension then calls the Anthropic API directly with this key. |
| Article body field names | `Enter_Body, Body, Description` | Comma-separated. Each is matched by ID or name, or by a visible label with exactly that text. The first field with article text is used. See below. |
| Headline field | empty | Set it to the CMS headline field's ID or name. The extension then critiques the current headline, and each suggestion gets a **Use** button that fills the field. |

## How it finds the article

It tries each name in the list (by default `Enter_Body`, then `Body`, then `Description`). For each name it looks:

1. **By ID or name:** an element whose ID or name is `Enter_Body`, or ends with it, such as `ctl00_Main_Enter_Body`. TinyMCE (`Enter_Body_ifr`) and CKEditor (`cke_Enter_Body`) wrappers count.
2. **By label:** page-builder CMSs often show an "Enter_Body" label above each body block. The extension finds every such label and reads the editor in the same block, joining the blocks in page order. A hidden textarea, which only updates on save, is ignored. So are other editors, such as a summary box.
It uses the first field that holds real article text (200+ characters). So an empty Enter_Body, or a short field such as a meta description, doesn't win over the real body. Names match on a word boundary only: `Description` matches `Description` or `ctl00_Main_Description`, but not `MetaDescription` or `SeoDescription`.

3. **Fallback:** if no name matches, it reads the editor with the most text. The popup then says *"the largest editor on the page ("Enter_Body" not found)"*, so you know it guessed.

Supported editors: CKEditor 4 (iframe or inline), CKEditor 5, TinyMCE, any `contenteditable` element, and plain textareas or inputs. HTML in a textarea is converted to text.

The popup always says where it read from, for example *"Read 706 words from 2 Enter_Body blocks (CKEditor)."*

## Cost

One run on Opus 5.5 uses roughly 2–4k tokens, which is about US$0.04–0.08. Articles with tables use more thinking for the insights, roughly US$0.08–0.15. Haiku 5.5 costs a small fraction of that.

## Files

```
manifest.json     MV3 manifest (activeTab, scripting, storage, identity; host access only to api.anthropic.com)
background.js     runs Google sign-in and the API calls, and keeps results per tab
popup.html/.js/.css  the panel
options.html/.js  settings
lib/claude.js     prompt, JSON schema, request and response handling (shared with the server)
lib/server.js     Google sign-in through the company server, and server requests
lib/page.js       functions injected into the CMS page to read the body and tables, and fill the headline
lib/stats.js      exact statistics for tables (shared with the server)
lib/explore.js    comparison, cross-tab, weighted averages, correlation and regression
lib/distribution.js  descriptive stats, skewness, kurtosis, Shapiro–Wilk, frequency, modality, outliers
lib/guard.js      prompt-injection checks, escaping and number verification (shared with the server)
lib/settings.js   settings storage
assets/           peeking kitten, hugging kitten, side-edge artwork, icon source (SVG)
fonts/            Fredoka (OFL) for headings and buttons
icons/            toolbar icons
```

## Security note

**Prompt injection.** Anything in the article, tables, focus keyword or current headline reaches the model. So the extension treats all of it as untrusted content, not instructions:

1. **Data, not instructions.** The system prompt says these inputs are material to analyse and never instructions, whoever they claim to be from. If the model meets an attempt anyway, it ignores it and reports it in `injection_warning`, which the popup shows.
2. **No breaking out.** `<` and `>` in all user content are escaped, so pasted text such as `</article>` cannot close or fake the tags the prompt uses.
3. **Length caps.** The focus keyword and current headline are cut to 150 characters on one line.
4. **Warnings before sending** (`lib/guard.js`, `lib/page.js`). Text readers can't see is reported and left out of what is sent: white on white, tiny, transparent, off-screen or `display:none`. Text that addresses an AI ("ignore previous instructions", "you are an AI", in English or Hindi) is flagged. Both show in an amber box so the author can check where the copy came from.
5. **Numbers are checked.** Every number in a data insight is compared against the table and the statistics computed in code. Insights that quote anything else are dropped, and the popup says so.

The model has no tools: it can't browse, publish or edit the CMS, and the API key is never part of the prompt. Results are shown as plain text, never as HTML.

**API keys.** With the company server, no API key is stored in any browser. The extension holds only a signed sign-in pass that expires after 30 days, works only for company accounts, and stops working as soon as someone is removed from the allowlist. The **Advanced** own-key option stores a key in the browser, where anyone with access to that Chrome profile can read it. Use it only for personal testing.
