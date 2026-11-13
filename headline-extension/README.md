# Headline Optimiser (Chrome extension)

Reads the article from the CMS **`Enter_Body`** field and suggests four SEO-backed headlines, one for each surface:

| Strategy | Built for | Rules it follows |
| --- | --- | --- |
| **Search** | Google Search | Primary keyword in the first five words, 50–65 characters, phrased like the query people type |
| **Discover** | Google Discover | A specific human or "what it means for you" angle, 60–100 characters, no clickbait that Discover penalises |
| **Data-driven** | Both | Leads with the strongest number in the article, and only numbers that are in it |
| **Explainer** | People Also Ask, voice search | What / Why / How framing that the article actually answers |

Each suggestion shows its character count against the target, the keyword it targets, a one-line reason and any risk. It also returns a primary keyword, related keywords, a URL slug and a meta description.

Headlines come out in the article's language. Hindi articles get Devanagari headlines, with English search terms such as "RBI repo rate" kept in English. The model is told never to invent facts or numbers. Still check every headline before publishing.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `headline-extension` folder.
3. Pin the extension. Then right-click its icon, choose **Options**, paste your Anthropic API key and click **Save**.

## Use

1. Open an article in the CMS editor.
2. Click the extension icon. It reads `Enter_Body` and shows how many words it found.
3. Optionally type a focus keyword, then click **Suggest headlines**. A run takes about 15–30 seconds.
4. Click **Copy** on the headline you want.

You can close the popup while it works. The request runs in the background, and the results stay there when you reopen the popup on that tab.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| API key | — | Stored in `chrome.storage.local`, so it stays in this Chrome profile and is never synced. It is sent only to `api.anthropic.com`. |
| Model | Claude Opus 5.5 | Sonnet 5.5 and Haiku 5.5 are faster and cheaper. |
| Article body field | `Enter_Body` | Matches by ID or name. IDs that end with it also match, such as `ctl00_Main_Enter_Body`. |
| Headline field | empty | Set it to the CMS headline field's ID or name. The extension then critiques the current headline, and each suggestion gets a **Use** button that fills the field. |

## Which editors it reads

The body field can be any of these:

- a plain `<textarea>` or `<input>`. HTML in it is converted to text.
- a `contenteditable` element
- a TinyMCE editor (`Enter_Body_ifr` iframe)
- a CKEditor 4 editor (`cke_Enter_Body`) or a CKEditor 5 editor

Rich editors are read from their live editing area, not the hidden textarea, which is only updated on save. If your CMS uses something else, open DevTools, find the element that holds the article text, and put its ID or name in Settings.

## Cost

One run on Opus 5.5 uses roughly 2–4k tokens, which is about US$0.04–0.08. Haiku 5.5 costs a small fraction of that.

## Files

```
manifest.json     MV3 manifest (activeTab, scripting, storage; host access only to api.anthropic.com)
background.js     runs the API call and keeps results per tab
popup.html/.js/.css  the panel
options.html/.js  settings
lib/claude.js     prompt, JSON schema, request and response handling
lib/page.js       functions injected into the CMS page to read the body and fill the headline
lib/settings.js   settings storage
```

## Security note

The extension calls the Anthropic API directly from the browser. Anyone with access to this Chrome profile can read the key from the extension's storage. For a team rollout, put a small server in front of the API, as the Headline Desk app in this repo does, so the key never reaches the browser.
