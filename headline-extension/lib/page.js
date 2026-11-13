// These functions are injected into the CMS page with chrome.scripting.executeScript.
// They must be self-contained: no imports and no outside variables.

// Reads the article body. Handles a plain textarea or contenteditable field, a TinyMCE or
// CKEditor wrapper, and ASP.NET-style prefixed IDs such as "ctl00_Main_Enter_Body".
export function readField(bodyField, headlineField) {
  const esc = (s) => CSS.escape(s);

  function find(name) {
    if (!name) return null;
    return document.getElementById(name)
      || document.getElementsByName(name)[0]
      || document.querySelector(`[id$="${esc(name)}"], [name$="${esc(name)}"]`);
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(
      html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '</$1>\n'),
      'text/html',
    );
    doc.querySelectorAll('script, style, figure, iframe').forEach((n) => n.remove());
    return doc.body.textContent;
  }

  function clean(text) {
    return (text || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  }

  function iframeText(frame) {
    try {
      const body = frame?.contentDocument?.body;
      return body ? body.innerText : '';
    } catch {
      return ''; // cross-origin frame
    }
  }

  function readBody(name) {
    // Rich editors keep the live text in their own element. The textarea under them
    // is only updated on save, so check the editors first.
    const tiny = document.querySelector(`#${esc(name)}_ifr, [id$="${esc(name)}_ifr"]`);
    if (tiny) {
      const t = iframeText(tiny);
      if (t.trim()) return { text: t, source: 'TinyMCE editor' };
    }
    const cke = document.querySelector(`#cke_${esc(name)} iframe, [id$="cke_${esc(name)}"] iframe`);
    if (cke) {
      const t = iframeText(cke);
      if (t.trim()) return { text: t, source: 'CKEditor' };
    }
    const el = find(name);
    if (!el) return null;

    const ck5 = el.nextElementSibling?.querySelector?.('.ck-editor__editable');
    if (ck5?.innerText.trim()) return { text: ck5.innerText, source: 'CKEditor 5' };

    if (el.tagName === 'IFRAME') return { text: iframeText(el), source: 'iframe editor' };
    if (el.isContentEditable) return { text: el.innerText, source: 'editable field' };
    if ('value' in el) {
      const v = el.value || '';
      return { text: /<[a-z][\s\S]*>/i.test(v) ? htmlToText(v) : v, source: 'text field' };
    }
    return { text: el.innerText, source: 'page element' };
  }

  const body = readBody(bodyField);
  const headlineEl = find(headlineField);
  const headline = headlineEl ? (headlineEl.value ?? headlineEl.innerText ?? '') : '';

  return {
    found: Boolean(body),
    text: clean(body?.text),
    source: body?.source ?? '',
    headline: headline.trim(),
    headlineFound: Boolean(headlineEl),
  };
}

// Writes a headline into the configured headline field and fires input/change events
// so the CMS notices the edit.
export function writeHeadline(headlineField, value) {
  const el = document.getElementById(headlineField)
    || document.getElementsByName(headlineField)[0]
    || document.querySelector(`[id$="${CSS.escape(headlineField)}"], [name$="${CSS.escape(headlineField)}"]`);
  if (!el) return false;
  if ('value' in el) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  } else {
    el.innerText = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.focus();
  return true;
}
