export function promptCss() {  return `
    :host { all: initial !important; }
    .jari-overlay {
      all: initial;
      display: block;
      contain: layout paint;
      position: fixed !important;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2147483646 !important;
      box-sizing: border-box;
      background: var(--jari-cmplt-bg, #f5f5f7) !important;
      color: var(--jari-cmplt-fg, #333738) !important;
      font-family: var(--jari-cmplt-font-family, monospace) !important;
      font-size: var(--jari-cmplt-font-size, 9pt) !important;
      max-height: 75vh;
      overflow: hidden;
      text-align: left !important;
      pointer-events: auto;
    }
    .jari-prompt {
      background: #1c1c24 !important;
      color: #cdcdcd !important;
      font-size: var(--jari-cmplt-font-size, 9pt) !important;
      font-family: var(--jari-cmplt-font-family, monospace) !important;
      outline: none !important;
    }
    .jari-prompt input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      font-family: var(--jari-cmdl-font-family, monospace) !important;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      line-height: var(--jari-cmdl-line-height, 1.5) !important;
      color: #cdcdcd;
      background: #1c1c24;
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
      text-align: left !important;
      padding: 0 0 0 0.5ex;
      margin: 0;
    }
    .jari-prompt input:focus,
    .jari-prompt input:focus-visible,
    .jari-prompt input:active {
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
    }
    .jari-prompt-header {
      display: block;
      background: #252530;
      color: #cdcdcd;
      font-size: var(--jari-header-font-size, 9pt) !important;
      font-weight: var(--jari-header-font-weight, bold) !important;
      border-bottom: 1px solid #333738;
      padding: 0 0.5ex;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-align: left !important;
    }
    .jari-prompt-list {
      display: block;
      contain: layout paint;
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 50vh;
      overflow: auto;
      border-bottom: 1px solid #333738;
      text-align: left !important;
    }
    .jari-prompt-list li {
      display: block;
      height: var(--jari-cmplt-option-height, 1.4em);
      line-height: var(--jari-cmplt-option-height, 1.4em) !important;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 0.5ex;
      margin: 0;
      cursor: pointer;
      text-align: left !important;
    }
    .jari-prompt-list li .url {
      color: #878787;
      background: transparent;
      text-decoration: none;
      margin-left: 1em;
    }
    .jari-prompt-list li .jari-win-tag {
      opacity: 0.7;
      margin-right: 1em;
    }
    .jari-prompt-list li.selected,
    .jari-prompt-list li.selected .url {
      color: var(--jari-of-fg, #cdcdcd);
      background: var(--jari-of-bg, #333738);
    }
    .jari-prompt-list li .jari-match,
    .jari-prompt-list li.selected .jari-match {
      color: var(--jari-accent, #e0a363);
      font-weight: bold !important;
    }
    .jari-overlay ::selection {
      background: var(--jari-accent, #e0a363);
      color: #1a1a1a;
    }
    .jari-prompt-footer {
      display: block;
      background: #252530;
      color: #cdcdcd;
      font-size: var(--jari-header-font-size, 9pt) !important;
      border-top: 1px solid #333738;
      padding: 0.25ex 0.5ex;
      margin: 0;
      white-space: normal;
      overflow: hidden;
      text-align: left !important;
    }
    .jari-prompt-footer.jari-manager-warn {
      color: #e0a363;
      font-weight: bold !important;
    }
  `;
}

export function renderText(el, text, indices) {
  if (!indices || indices.length === 0) {
    el.textContent = text;
    return;
  }
  const matched = new Set(indices);
  const frag = document.createDocumentFragment();
  let run = "";
  let mark = "";
  function flushRun() {
    if (run) {
      const span = document.createElement("span");
      span.textContent = run;
      frag.appendChild(span);
      run = "";
    }
  }
  function flushMark() {
    if (mark) {
      const span = document.createElement("span");
      span.className = "jari-match";
      span.textContent = mark;
      frag.appendChild(span);
      mark = "";
    }
  }
  for (let i = 0; i < text.length; i++) {
    if (matched.has(i)) {
      flushRun();
      mark += text[i];
    } else {
      flushMark();
      run += text[i];
    }
  }
  flushRun();
  flushMark();
  el.textContent = "";
  el.appendChild(frag);
}
