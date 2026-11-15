// These functions are injected into the CMS page with chrome.scripting.executeScript.
// They must be self-contained: no imports and no outside variables.

// Reads the article body. Tries, in order:
//   1. an element whose ID or name is the field name (also "ctl00_Main_Enter_Body" style IDs),
//      including TinyMCE / CKEditor wrappers named after it;
//   2. a visible label with that text (page-builder CMSs show "Enter_Body" above each body
//      block) and the editor in the same block; all such blocks are read, in page order;
//   3. failing both, the editor on the page with the most text.
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
    const wrapped = document.querySelector(
      `#${esc(name)}_ifr, [id$="${esc(name)}_ifr"], #cke_${esc(name)} iframe, [id$="cke_${esc(name)}"] iframe, #cke_${esc(name)} .cke_editable, [id$="cke_${esc(name)}"] .cke_editable`,
    );
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

  function readBody(name) {
    const ids = byId(name);
    if (ids) {
      const [el, plain] = ids;
      const text = plain ? el.innerText : editorText(el);
      return { text, tables: tablesIn([el]), source: `${name} (${plain ? 'page element' : kind(el)})` };
    }
    const labelled = byLabel(name);
    if (labelled) {
      const text = labelled.map(editorText).filter((t) => t && t.trim()).join('\n\n');
      const n = labelled.length;
      return { text, tables: tablesIn(labelled), source: `${n > 1 ? `${n} ${name} blocks` : name} (${kind(labelled[0])})` };
    }
    const largest = largestEditor();
    if (largest) {
      return { text: editorText(largest[0]), tables: tablesIn(largest), source: `the largest editor on the page ("${name}" not found)`, guessed: true };
    }
    return null;
  }

  const body = readBody(bodyField);
  const headlineEl = find(headlineField);
  const headline = headlineEl ? (headlineEl.value ?? headlineEl.innerText ?? '') : '';

  return {
    found: Boolean(body),
    guessed: Boolean(body?.guessed),
    text: clean(body?.text),
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
