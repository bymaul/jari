/* global NodeFilter */

export function isWordChar(ch) {
  return !!ch && /[\p{L}\p{N}_]/u.test(ch);
}

export function findNextWordEnd(count) {
  const sel = window.getSelection();
  if (!sel || !sel.focusNode) return null;
  const startNode = sel.focusNode;
  const startOffset = sel.focusOffset;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let nodes = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n);
    n = walker.nextNode();
  }
  let startIdx = nodes.indexOf(startNode);
  if (startIdx === -1) return null;
  let found = 0;
  for (let i = startIdx; i < nodes.length; i++) {
    const node = nodes[i];
    const txt = node.nodeValue || "";
    let from = 0;
    if (i === startIdx) from = startOffset;
    let pos = from;
    let inWord = false;
    while (pos < txt.length) {
      if (!inWord) {
        while (pos < txt.length && !isWordChar(txt[pos])) pos++;
        if (pos >= txt.length) break;
        inWord = true;
      } else {
        while (pos < txt.length && isWordChar(txt[pos])) pos++;
        if (pos >= txt.length) {
          const nextTxt = i + 1 < nodes.length ? nodes[i + 1].nodeValue || "" : "";
          if (nextTxt && isWordChar(nextTxt[0])) break;
          if (txt.length === 0) break;
          const wordEnd = txt.length - 1;
          if (i === startIdx && wordEnd <= from) break;
          found++;
          if (found === count) {
            return { node, offset: wordEnd };
          }
          break;
        }
        inWord = false;
        const wordEnd = pos - 1;
        if (i === startIdx && wordEnd <= from) continue;
        found++;
        if (found === count) {
          return { node, offset: wordEnd };
        }
      }
    }
  }
  return null;
}
