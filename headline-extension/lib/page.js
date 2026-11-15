// These functions are injected into the CMS page with chrome.scripting.executeScript.
// They must be self-contained: no imports and no outside variables.

// Reads the article body. `bodyField` is a comma-separated list of field names, because
// different forms name the body differently (Enter_Body, Body in the News form, Description
// in the Exam form). For each name it tries:
//   1. an element whose ID or name is that name (also "ctl00_Main_Enter_Body" style IDs),
//      including TinyMCE / CKEditor wrappers named after it;
//   2. a visible label with that exact text (page-builder CMSs show "Enter_Body" above each
//      body block) and the editor in the same block; all such blocks are read, in page order.
// The first name whose field holds real article text wins. Failing all names, it reads the
// editor on the page with the most text.
export function readField(bodyField, headlineField) {
  const esc = (s) => CSS.escape(s);
  const names = String(bodyField ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (!names.length) names.push('Enter_Body');

  // Exact ID/name, or one that ends with it after a separator ("ctl00_Main_Body"), so a
  // generic name like "Description" does not match "MetaDescription".
  function find(name) {
    if (!name) return null;
    const n = esc(name);
    return document.getElementById(name)
      || document.getElementsByName(name)[0]
      || document.querySelector(`[id$="_${n}"], [id$="-${n}"], [name$="$${n}"], [name$="_${n}"], [name$="-${n}"]`);
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

  // Returns the text of an editor element, or null if the element is not an editor.
  function editorText(el) {
    if (el.tagName === 'IFRAME') {
      try {
        const doc = el.contentDocument;
        const body = doc?.body;
        if (!body) return null;
        const isEditor = body.isContentEditable || doc.designMode === 'on'
          || el.classList.contains('cke_wysiwyg_frame') || /_ifr$/.test(el.id);
        return isEditor ? body.innerText : null;
      } catch {
        return null; // cross-origin frame (an embed, not an editor)
      }
    }
    if (el.isContentEditable) return el.innerText;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const v = el.value || '';
      return /<[a-z][\s\S]*>/i.test(v) ? htmlToText(v) : v;
    }
    return null;
  }

  // Rich editors (iframe or contenteditable) under root, outermost only.
  function richEditors(root) {
    return [...root.querySelectorAll('iframe, [contenteditable]:not([contenteditable="false"])')]
      .filter((el) => !el.parentElement?.closest('[contenteditable]')?.isContentEditable)
      .filter((el) => editorText(el) !== null);
  }

  function kind(el) {
    if (el.classList.contains('cke_wysiwyg_frame') || el.classList.contains('cke_editable')) return 'CKEditor';
    if (/_ifr$/.test(el.id) || el.classList.contains('mce-content-body')) return 'TinyMCE';
    if (el.classList.contains('ck-editor__editable')) return 'CKEditor 5';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return 'text field';
    return 'editor';
  }

  function byId(name) {
    // The textarea under a rich editor is only updated on save, so check the editors first.
    const n = esc(name);
    const wrapped = document.querySelector([
      `#${n}_ifr`, `[id$="_${n}_ifr"]`,
      `#cke_${n} iframe`, `[id^="cke_"][id$="_${n}"] iframe`,
      `#cke_${n} .cke_editable`, `[id^="cke_"][id$="_${n}"] .cke_editable`,
    ].join(', '));
    if (wrapped && editorText(wrapped)?.trim()) return [wrapped];
    const el = find(name);
    if (!el) return null;
    const ck5 = el.nextElementSibling?.querySelector?.('.ck-editor__editable');
    if (ck5) return [ck5];
    return editorText(el) !== null ? [el] : [el, 'plain'];
  }

  function byLabel(name) {
    const labels = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim() !== name) continue;
      const el = n.parentElement;
      if (!el || el.closest('script, style, [contenteditable="true"]')) continue;
      labels.push(el);
    }
    document.querySelectorAll(`input[value="${esc(name)}"]`).forEach((el) => labels.push(el));

    const found = [];
    for (const label of labels) {
      const after = (el) => label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      let node = label;
      for (let depth = 0; depth < 12 && node.parentElement; depth++) {
        node = node.parentElement;
        const eds = richEditors(node).filter(after);
        const pick = eds[0] ?? [...node.querySelectorAll('textarea')].filter(after)[0];
        if (pick) {
          if (!found.includes(pick)) found.push(pick);
          break;
        }
      }
    }
    return found.length ? found : null;
  }

  function largestEditor() {
    let best = null;
    let bestLen = 0;
    for (const el of richEditors(document)) {
      const len = (editorText(el) || '').trim().length;
      if (len > bestLen) { best = el; bestLen = len; }
    }
    return best ? [best] : null;
  }

  // The element whose contents hold the article (an editor iframe's body, the editable
  // element itself, or parsed textarea HTML), for finding tables.
  function contentRoot(el) {
    if (el.tagName === 'IFRAME') {
      try { return el.contentDocument?.body ?? null; } catch { return null; }
    }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return new DOMParser().parseFromString(el.value || '', 'text/html').body;
    }
    return el;
  }

  // A table as a grid of cell texts, with merged cells (rowspan/colspan) filled in so
  // columns line up.
  function tableGrid(table) {
    const grid = [];
    [...table.rows].slice(0, 80).forEach((tr, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      for (const cell of tr.cells) {
        while (grid[r][c] !== undefined) c++;
        const text = cell.textContent.replace(/\s+/g, ' ').trim();
        const rs = Math.min(cell.rowSpan || 1, 80);
        const cs = Math.min(cell.colSpan || 1, 20);
        for (let i = 0; i < rs; i++) {
          grid[r + i] = grid[r + i] || [];
          for (let j = 0; j < cs; j++) grid[r + i][c + j] = text;
        }
        c += cs;
      }
    });
    return grid.map((row) => [...row].map((v) => v ?? ''));
  }

  // The caption, or else the heading or sentence just before the table, which usually says
  // what the table is ("IIT Bombay closing ranks 2020-2025").
  function tableCaption(table) {
    const own = table.caption?.textContent.trim();
    if (own) return own;
    let node = table;
    for (let up = 0; up < 3 && node; up++) {
      let prev = node.previousElementSibling;
      for (let k = 0; k < 2 && prev; k++, prev = prev.previousElementSibling) {
        const t = prev.textContent.replace(/\s+/g, ' ').trim();
        if (t) return t.slice(0, 160);
      }
      node = node.parentElement;
    }
    return '';
  }

  function tablesIn(els) {
    const out = [];
    for (const el of els) {
      const root = contentRoot(el);
      if (!root) continue;
      for (const table of root.querySelectorAll('table')) {
        if (table.querySelector('table')) continue; // layout wrapper around another table
        const rows = tableGrid(table);
        if (rows.length >= 2 && rows[0].length >= 2) out.push({ caption: tableCaption(table), rows });
        if (out.length >= 6) return out;
      }
    }
    return out;
  }

  // --- hidden text ------------------------------------------------------------------
  // Text readers can't see (tiny, transparent, white on white, pushed off-screen) is a
  // common way to smuggle instructions to an AI inside pasted copy. It is reported to the
  // author and left out of what is sent.

  function rgba(value) {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(value || '');
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  }

  function luminance({ r, g, b }) {
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function backgroundOf(node, win) {
    for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
      const bg = rgba(win.getComputedStyle(el).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
    }
    return { r: 255, g: 255, b: 255, a: 1 }; // editors are white unless styled otherwise
  }

  function isHidden(node, win) {
    if (!win) {
      // Parsed textarea HTML has no layout; judge by inline styles.
      const st = (node.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
      return node.hidden || /display:none|visibility:hidden|font-size:0|opacity:0(\.0\d*)?(;|$)|color:(#fff\b|#ffffff|white|rgb\(255,255,255\))/.test(st);
    }
    if (node.checkVisibility && !node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return true;
    const cs = win.getComputedStyle(node);
    if (parseFloat(cs.fontSize) < 5 || parseFloat(cs.textIndent) < -500) return true;
    let opacity = 1;
    for (let el = node; el && el.nodeType === 1; el = el.parentElement) opacity *= parseFloat(win.getComputedStyle(el).opacity);
    if (opacity < 0.15) return true;
    const box = node.getBoundingClientRect();
    if (box.width * box.height < 2 || box.right < 0 || box.bottom < 0) return true;
    const fg = rgba(cs.color);
    if (fg && fg.a < 0.15) return true;
    return Boolean(fg && Math.abs(luminance(fg) - luminance(backgroundOf(node, win))) < 0.04);
  }

  function hiddenIn(els) {
    const out = [];
    for (const el of els) {
      const root = contentRoot(el);
      if (!root) continue;
      const win = root.ownerDocument.defaultView;
      const nodes = root.querySelectorAll('*');
      for (let i = 0; i < nodes.length && i < 4000 && out.length < 8; i++) {
        const node = nodes[i];
        const own = [...node.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
        if (own.length >= 12 && isHidden(node, win) && !out.includes(own)) out.push(own.slice(0, 400));
      }
    }
    return out;
  }

  function stripHidden(text, hidden) {
    let out = text || '';
    for (const h of hidden) {
      const words = h.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      out = out.replace(new RegExp(words.join('\\s+'), 'g'), ' ');
    }
    return out;
  }

  function readNamed(name) {
    const ids = byId(name);
    if (ids) {
      const [el, plain] = ids;
      const text = plain ? el.innerText : editorText(el);
      return { text, els: [el], tables: tablesIn([el]), source: `${name} (${plain ? 'page element' : kind(el)})` };
    }
    const labelled = byLabel(name);
    if (labelled) {
      const text = labelled.map(editorText).filter((t) => t && t.trim()).join('\n\n');
      const n = labelled.length;
      return { text, els: labelled, tables: tablesIn(labelled), source: `${n > 1 ? `${n} ${name} blocks` : name} (${kind(labelled[0])})` };
    }
    return null;
  }

  function readBody() {
    const found = names.map(readNamed).filter(Boolean);
    const len = (r) => clean(r.text).length;
    // Prefer a field with a real article (the API needs 200+ characters), then any text,
    // then any match at all, so an empty or short field (like a meta description) loses.
    const pick = found.find((r) => len(r) >= 200) ?? found.find((r) => len(r) > 0) ?? found[0];
    if (pick) return pick;
    const largest = largestEditor();
    if (largest) {
      const list = names.map((x) => `"${x}"`).join(', ');
      return { text: editorText(largest[0]), els: largest, tables: tablesIn(largest), source: `the largest editor on the page (${list} not found)`, guessed: true };
    }
    return null;
  }

  const body = readBody();
  const hidden = body ? hiddenIn(body.els) : [];
  const headlineEl = find(headlineField);
  const headline = headlineEl ? (headlineEl.value ?? headlineEl.innerText ?? '') : '';

  return {
    found: Boolean(body),
    guessed: Boolean(body?.guessed),
    text: clean(stripHidden(body?.text, hidden)),
    hiddenText: hidden.map((h) => (h.length > 160 ? `${h.slice(0, 160)}…` : h)),
    tables: body?.tables ?? [],
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
