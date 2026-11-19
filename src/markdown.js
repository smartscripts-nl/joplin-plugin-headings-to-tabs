'use strict';

const fs = require('fs');
const path = require('path');

exports.default = () => {
  require('./rich-text').start();
  return {
  plugin(markdownIt, options) {
    if (options.postMessageSyntax !== 'ipcProxySendToHost') return;
    const render = markdownIt.renderer.render.bind(markdownIt.renderer);
    markdownIt.renderer.render = (tokens, renderOptions, env) => {
      let state;
      try {
        state = JSON.parse(fs.readFileSync(path.join(__dirname, 'tabs-state.json'), 'utf8'));
      } catch {
        return render(tokens, renderOptions, env);
      }
      if (!state.enabled) return render(tokens, renderOptions, env);

      const starts = tokens.flatMap((token, index) =>
        token.type === 'heading_open' && token.tag === 'h2' && token.level === 0 ? [index] : []);
      if (!starts.length) return render(tokens, renderOptions, env);
      const escape = markdownIt.utils.escapeHtml;
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const id = 'headings-to-tabs-' + Math.random().toString(36).slice(2);
      const length = Math.max(4, Number(state.length) || 32);
      const labels = starts.map((start, index) => {
        const title = tokens[start + 1].children
          .map(token => token.content).join('').trim() || '§ ' + (index + 1);
        const characters = Array.from(segmenter.segment(title), part => part.segment);
        const label = characters.length > length ? characters.slice(0, length - 1).join('') + '…' : title;
        return '<label for="' + id + '-' + index + '" title="' + escape(title) +
          '" data-tab-label="' + escape(label) + '"></label>';
      });
      const sections = starts.map((start, index) => {
        const input = '<input class="headings-to-tabs-choice" type="radio" name="' + id +
          '" id="' + id + '-' + index + '" aria-label="' +
          escape(tokens[start + 1].content || '§ ' + (index + 1)) + '"' +
          (index === 0 ? ' checked' : '') + '>';
        return '<div class="headings-to-tabs-section">' + input + labels[index] +
          '<div class="headings-to-tabs-content">' +
          render(tokens.slice(start, starts[index + 1]), renderOptions, env) + '</div></div>';
      });
      const introduction = render(tokens.slice(0, starts[0]), renderOptions, env);
      return introduction + '<div class="headings-to-tabs-layout">' + sections.join('') + '</div>';
    };
  },
  assets: () => [{
    inline: true,
    mime: 'text/css',
    text: `
      .headings-to-tabs-layout { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3em; margin-top: 2em; }
      .headings-to-tabs-section { display: contents; }
      .headings-to-tabs-choice { position: absolute; opacity: 0; width: 1px; height: 1px; }
      .headings-to-tabs-section > label {
        order: 0; display: block; max-width: 100%; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; padding: .35em .65em;
        border: 1px solid currentColor; border-radius: .35em .35em 0 0; cursor: pointer;
      }
      .headings-to-tabs-section > label::before { content: attr(data-tab-label); }
      .headings-to-tabs-choice:checked + label { font-weight: bold; text-decoration: underline; }
      .headings-to-tabs-choice:focus-visible + label { outline: 2px solid currentColor; }
      .headings-to-tabs-content { display: none; order: 1; flex: 0 0 100%; min-width: 0; }
      .headings-to-tabs-choice:checked ~ .headings-to-tabs-content { display: block; }
    `,
  }],
  };
};
