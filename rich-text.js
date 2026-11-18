'use strict';

const fs = require('fs');
const path = require('path');
const stateFile = path.join(__dirname, 'tabs-state.json');
const editors = new WeakMap();
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function refreshEditor(doc, settings) {
  const body = doc.body;
  if (!body) return;
  const previous = editors.get(doc);
  const headings = settings.enabled ? Array.from(body.querySelectorAll(':scope > h2')) : [];
  if (!headings.length) {
    previous?.bar.remove();
    previous?.style.remove();
    editors.delete(doc);
    return;
  }

  const titles = headings.map(heading => heading.textContent.trim());
  const blocks = Array.from(body.children).filter(block => block !== previous?.bar);
  const starts = headings.map(heading => blocks.indexOf(heading));
  const signature = JSON.stringify([settings.length, titles, starts]);
  if (previous?.signature === signature && previous.bar.nextElementSibling === headings[0] &&
      headings.every((heading, index) => heading === previous.headings[index])) return;

  previous?.bar.remove();
  previous?.style.remove();
  const bar = doc.createElement('div');
  bar.setAttribute('data-mce-bogus', 'all');
  bar.setAttribute('contenteditable', 'false');
  bar.className = 'headings-to-tabs-rich';
  bar.setAttribute('aria-label', 'Headings to Tabs');
  bar.setAttribute('role', 'tablist');
  // TinyMCE treats some key events as edits even inside non-editable controls.
  for (const type of ['mousedown', 'mouseup', 'keydown', 'keypress', 'keyup', 'click']) {
    bar.addEventListener(type, event => event.stopPropagation());
  }
  headings[0].before(bar);
  const style = doc.createElement('style');
  doc.head.append(style);

  function select(index) {
    editors.get(doc).selected = index;
    const buttons = Array.from(bar.children);
    buttons.forEach((button, number) => button.setAttribute('aria-selected', String(index === number)));
    // The inserted tab bar shifts the following elements by one position.
    const first = starts[0] + 2;
    const start = starts[index] + 2;
    const end = index + 1 < starts.length ? starts[index + 1] + 2 : null;
    const hidden = [];
    if (index > 0) hidden.push(`body > :nth-child(n+${first}):nth-child(-n+${start - 1})`);
    if (end !== null) hidden.push(`body > :nth-child(n+${end})`);
    style.textContent = `
      .headings-to-tabs-rich { display:flex; flex-wrap:wrap; gap:.3em; margin-block:.5em; margin-top:2em; user-select:none; }
      .mce-content-body .headings-to-tabs-rich[contenteditable="false"][data-mce-selected] {
        outline: none;
      }
      .headings-to-tabs-rich > button { color:inherit; background:transparent; font:inherit;
        border:1px solid currentColor; border-radius:.35em .35em 0 0; padding:.35em .65em; cursor:pointer; }
      .headings-to-tabs-rich > button::before { content:attr(data-tab-label); }
      .headings-to-tabs-rich > button[aria-selected="true"] { font-weight:bold; text-decoration:underline; }
      ${hidden.length ? hidden.join(', ') + ' { display:none !important; }' : ''}
    `;
  }

  titles.forEach((title, index) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.title = title || '§ ' + (index + 1);
    button.setAttribute('aria-label', button.title);
    const chars = Array.from(segmenter.segment(button.title), part => part.segment);
    button.dataset.tabLabel = chars.length > settings.length
      ? chars.slice(0, settings.length - 1).join('') + '…' : button.title;
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => select(index));
    bar.append(button);
  });
  editors.set(doc, { bar, style, signature, headings });
  select(Math.max(0, headings.indexOf(previous?.headings[previous.selected])));
}

exports.start = () => {
  if (typeof window === 'undefined') return;
  const key = Symbol.for('com.alexpot.headings-to-tabs.rich-text');
  if (window[key]) return;
  window[key] = true;
  const readers = new Map();
  const autoTabsKey = Symbol.for('com.alexpot.headings-to-tabs.enable-on-load');
  const warningFile = path.join(__dirname, 'reader-warning.txt');
  // Joplin opens detached note editors as same-origin about:blank windows.
  // This also works when Read Distraction Free is absent.
  const openWindow = window.open;
  if (typeof openWindow === 'function') {
    window.open = function (url, ...args) {
      const child = openWindow.call(this, url, ...args);
      if (url === 'about:blank' && child) readers.set(child, { enabled: false });
      return child;
    };
  }
  let settings = { enabled: false, length: 32 };
  let modified;

  function updateDocument(doc, enabled) {
    for (const icon of doc.querySelectorAll('.toolbar-icon.headings-to-tabs-icon')) {
      const button = icon.closest('button');
      const pressed = String(enabled);
      if (button && button.getAttribute('aria-pressed') !== pressed) {
        button.setAttribute('aria-pressed', pressed);
      }
    }
    for (const frame of doc.querySelectorAll('iframe.tox-edit-area__iframe')) {
      if (frame.contentDocument) refreshEditor(frame.contentDocument, { ...settings, enabled });
    }
  }

  function updateReader(child, reader) {
    const doc = child.document;
    if (!doc.querySelector('.secondary-window-root')) return;
    const editor = doc.querySelector('iframe.tox-edit-area__iframe')?.contentDocument;
    if (reader.editor !== editor) reader.enabled = false;
    reader.editor = editor;
    const setEnabled = (enabled, automatic = false) => {
      const currentEditor = doc.querySelector('iframe.tox-edit-area__iframe')?.contentDocument;
      if (currentEditor !== reader.editor) return false;
      if (enabled && !currentEditor?.body?.querySelector(':scope > h2')) {
        if (!automatic) fs.writeFileSync(warningFile, require('crypto').randomUUID());
        return false;
      }
      reader.enabled = enabled;
      updateDocument(doc, enabled);
      return true;
    };
    const toggle = (showConfirmation = false) => {
      delete child[autoTabsKey];
      if (setEnabled(!reader.enabled) && showConfirmation) {
        const target = path.join(__dirname, 'reader-toast.txt');
        fs.writeFileSync(target + '.tmp', JSON.stringify({ enabled: reader.enabled }));
        fs.renameSync(target + '.tmp', target);
      }
    };
    if (child[autoTabsKey] && editor?.body?.querySelector(':scope > h2') &&
        setEnabled(true, true)) {
      delete child[autoTabsKey];
    }
    if (reader.document !== doc) {
      reader.document = doc;
      doc.addEventListener('click', event => {
        if (!event.target.closest?.('button')?.querySelector('.headings-to-tabs-icon')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggle();
      }, true);
    }
    for (const target of [doc, editor]) {
      if (!target || target === reader.keyDocument || target === reader.keyEditor) continue;
      if (target === doc) reader.keyDocument = target;
      else reader.keyEditor = target;
      target.addEventListener('keydown', event => {
        const shortcut = settings.readerShortcut?.toLowerCase().split('+');
        if (!shortcut || event.key.toLowerCase() !== shortcut.at(-1) ||
            event.ctrlKey !== shortcut.some(part => part === 'ctrl' || part === 'control') ||
            event.altKey !== shortcut.some(part => part === 'alt' || part === 'option') ||
            event.shiftKey !== shortcut.includes('shift') ||
            event.metaKey !== shortcut.some(part => part === 'cmd' || part === 'command' || part === 'super')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) toggle(true);
      }, true);
    }
    updateDocument(doc, reader.enabled);
  }

  const refresh = () => {
    try {
      const mtime = fs.statSync(stateFile).mtimeMs;
      if (mtime !== modified) {
        settings = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        modified = mtime;
      }
      updateDocument(window.document, settings.enabled);
      for (const [child, reader] of readers) {
        if (child.closed) readers.delete(child);
        else updateReader(child, reader);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Headings to Tabs', error);
    }
  };
  refresh();
  window.setInterval(refresh, 300);
};
