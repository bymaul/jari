(function () {
  "use strict";

  var article = document.getElementById("playground");
  var hintsEl = document.getElementById("hints");
  var findbar = document.getElementById("findbar");
  var findinput = document.getElementById("findinput");
  var findstatus = document.getElementById("findstatus");
  var help = document.getElementById("help");
  var toastEl = document.getElementById("toast");
  var pill = document.getElementById("pill");
  var showcmdEl = document.getElementById("showcmd");

  var CHARSET = "saevrtwyincmp";
  var LINE_PX = 60;
  var MAX_MARKS = 500;

  var mode = "normal";
  var countBuf = "";
  var pendingG = false;
  var clueEl = null;
  var findOpen = false;
  var hintState = null;
  var caretEl = null;
  var findState = { marks: [], idx: 0, query: "", hidden: false };
  var toastTimer = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.hidden = true;
    }, 1800);
  }

  var CLUE_G = [
    { suffix: "g", label: "scroll to top" },
    { suffix: "f", label: "hint link in background tab" },
    { suffix: "u", label: "go to parent URL" },
    { suffix: "U", label: "go to site root" },
  ];

  function hideClue() {
    if (!clueEl) return;
    try {
      clueEl.remove();
    } catch {}
    clueEl = null;
  }

  function showClue() {
    if (!clueEl) {
      clueEl = document.createElement("div");
      clueEl.className = "demo-clue";
      document.body.appendChild(clueEl);
    }
    clueEl.textContent = "";
    var title = document.createElement("div");
    title.className = "demo-clue-title";
    title.textContent = countBuf + "g — " + CLUE_G.length + " bindings";
    clueEl.appendChild(title);
    var list = document.createElement("div");
    list.className = "demo-clue-list";
    for (var i = 0; i < CLUE_G.length; i++) {
      var row = document.createElement("div");
      row.className = "demo-clue-row";
      var key = document.createElement("span");
      key.className = "demo-clue-key";
      key.textContent = CLUE_G[i].suffix;
      var label = document.createElement("span");
      label.className = "demo-clue-label";
      label.textContent = CLUE_G[i].label;
      row.appendChild(key);
      row.appendChild(label);
      list.appendChild(row);
    }
    clueEl.appendChild(list);
  }

  function setPill() {
    if (mode === "hints") {
      pill.textContent = "hint";
      pill.hidden = false;
    } else if (mode === "visual") {
      pill.textContent = "visual";
      pill.hidden = false;
    } else {
      pill.hidden = true;
    }
    var cmd = countBuf + (pendingG ? "g" : "");
    if (mode === "normal" && cmd) {
      showcmdEl.textContent = cmd;
      showcmdEl.hidden = false;
    } else {
      showcmdEl.hidden = true;
    }
    if (pendingG && mode === "normal") showClue();
    else hideClue();
  }

  function takeCount(fallback) {
    var n = parseInt(countBuf || "", 10);
    countBuf = "";
    if (!isFinite(n) || n < 1) return fallback;
    return Math.min(n, 1000);
  }

  function genLabels(count, charset) {
    var chars = String(charset || CHARSET).toUpperCase().split("");
    if (count <= 0 || chars.length < 2) return [];
    if (count <= chars.length) return chars.slice(0, count);
    var labels = chars.slice();
    var head = 0;
    while (labels.length - head < count) {
      if (head >= labels.length) break;
      var p = labels[head++];
      for (var i = 0; i < chars.length; i++) {
        labels.push(p + chars[i]);
        if (labels.length - head >= count) break;
        if (labels.length > 10000) break;
      }
      if (labels.length > 10000) break;
    }
    return labels.slice(head, head + count);
  }

  function visibleTargets() {
    var nodes = document.querySelectorAll("header a[href], nav a[href], article a[href], article button, footer a[href]");
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var r;
      try {
        r = el.getBoundingClientRect();
      } catch {
        continue;
      }
      if (r && r.width > 0 && r.height > 0) out.push(el);
    }
    return out;
  }

  function setHintText(div, label, typed) {
    div.textContent = "";
    if (!typed || !label.startsWith(typed)) {
      div.textContent = label;
      return;
    }
    var pre = document.createElement("span");
    pre.className = "demo-hint-matched";
    pre.textContent = typed;
    var rest = document.createElement("span");
    rest.textContent = label.slice(typed.length);
    div.appendChild(pre);
    div.appendChild(rest);
  }

  function openHints(newTab, background) {
    closeHints();
    countBuf = "";
    pendingG = false;
    var targets = visibleTargets();
    if (targets.length === 0) {
      toast("No hints here");
      return;
    }
    var labels = genLabels(targets.length, CHARSET);
    var items = [];
    for (var i = 0; i < targets.length; i++) {
      var div = document.createElement("div");
      div.className = "demo-hint";
      div.textContent = labels[i];
      var r = targets[i].getBoundingClientRect();
      div.style.left = Math.max(0, r.left) + "px";
      div.style.top = Math.max(0, r.top) + "px";
      hintsEl.appendChild(div);
      items.push({ el: div, target: targets[i], label: labels[i] });
    }
    hintState = { items: items, typed: "", newTab: newTab, background: background };
    mode = "hints";
    setPill();
  }

  function closeHints() {
    hintsEl.textContent = "";
    hintState = null;
    if (mode === "hints") {
      mode = "normal";
      setPill();
    }
  }

  function refreshHints() {
    var typed = hintState.typed;
    for (var i = 0; i < hintState.items.length; i++) {
      var it = hintState.items[i];
      if (!typed || it.label.startsWith(typed)) {
        it.el.classList.remove("demo-hint-dim");
        setHintText(it.el, it.label, typed);
      } else {
        it.el.classList.add("demo-hint-dim");
      }
      if (typed && it.label === typed) {
        activateHint(it);
        return;
      }
    }
  }

  function flash(el) {
    el.classList.add("demo-flash");
    setTimeout(function () {
      el.classList.remove("demo-flash");
    }, 350);
  }

  function activateHint(it) {
    var target = it.target;
    var isNew = hintState.newTab || hintState.background;
    flash(target);
    var href = target.getAttribute("href");
    closeHints();
    if (target.tagName === "BUTTON") {
      try {
        target.click();
      } catch {}
      return;
    }
    if (!href) return;
    if (isNew) {
      window.open(href, "_blank", "noopener");
      toast("Opened in new tab — demo stays open");
      return;
    }
    try {
      window.location.href = href;
    } catch {}
  }

  function onHintKey(key) {
    if (key === "Escape") {
      closeHints();
      return true;
    }
    if (key === "Backspace") {
      hintState.typed = hintState.typed.slice(0, -1);
      refreshHints();
      return true;
    }
    if (/^[a-z]$/i.test(key)) {
      hintState.typed += key.toUpperCase();
      refreshHints();
      return true;
    }
    return false;
  }

  function clearMarks() {
    var marks = article.querySelectorAll(".demo-find-hit, .demo-find-current");
    for (var i = 0; i < marks.length; i++) {
      try {
        marks[i].replaceWith(document.createTextNode(marks[i].textContent));
      } catch {}
    }
    try {
      article.normalize();
    } catch {}
    findState.marks = [];
    findState.idx = 0;
  }

  function collectTextNodes() {
    var walker = document.createTreeWalker(article, 4);
    var nodes = [];
    var n = walker.nextNode();
    while (n) {
      if (n.nodeValue && n.nodeValue.trim() !== "") nodes.push(n);
      n = walker.nextNode();
    }
    return nodes;
  }

  function rebuildFind() {
    clearMarks();
    var q = findState.query;
    if (!q) {
      updateFindStatus();
      return;
    }
    var sensitive = /[A-Z]/.test(q);
    var needle = sensitive ? q : q.toLowerCase();
    var nodes = collectTextNodes();
    var marks = [];
    for (var i = 0; i < nodes.length && marks.length < MAX_MARKS; i++) {
      var node = nodes[i];
      if (!node.isConnected) continue;
      var text = node.nodeValue;
      var hay = sensitive ? text : text.toLowerCase();
      if (hay.indexOf(needle) === -1) continue;
      var atList = [];
      var from = 0;
      while (atList.length < MAX_MARKS - marks.length) {
        var at = hay.indexOf(needle, from);
        if (at === -1) break;
        atList.push(at);
        from = at + Math.max(1, needle.length);
      }
      for (var k = atList.length - 1; k >= 0; k--) {
        var range = document.createRange();
        try {
          range.setStart(node, atList[k]);
          range.setEnd(node, atList[k] + needle.length);
        } catch {
          continue;
        }
        var mark = document.createElement("span");
        mark.className = "demo-find-hit";
        try {
          range.surroundContents(mark);
        } catch {
          continue;
        }
        marks.push(mark);
      }
    }
    marks.reverse();
    findState.marks = marks;
    findState.idx = 0;
    findState.hidden = false;
    paintCurrent();
    updateFindStatus();
  }

  function paintCurrent() {
    var marks = findState.marks;
    for (var i = 0; i < marks.length; i++) {
      marks[i].classList.add("demo-find-hit");
      marks[i].classList.remove("demo-find-current");
    }
    if (findState.hidden || marks.length === 0) return;
    var cur = marks[findState.idx];
    if (cur) cur.classList.add("demo-find-current");
  }

  function updateFindStatus() {
    var q = findState.query;
    findstatus.classList.remove("no-match");
    if (!q || findState.marks.length === 0) {
      if (q) {
        findstatus.textContent = 'No match for "' + q + '"';
        findstatus.classList.add("no-match");
      } else {
        findstatus.textContent = "";
      }
      return;
    }
    findstatus.textContent = findState.idx + 1 + "/" + findState.marks.length;
  }

  function gotoMark(idx, announce) {
    var len = findState.marks.length;
    if (len === 0) return;
    findState.idx = ((idx % len) + len) % len;
    paintCurrent();
    updateFindStatus();
    var cur = findState.marks[findState.idx];
    try {
      cur.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {}
    if (announce) toast(findState.idx + 1 + "/" + len);
  }

  function setFindHidden(hidden) {
    findState.hidden = hidden;
    if (hidden) {
      for (var i = 0; i < findState.marks.length; i++) {
        findState.marks[i].classList.remove("demo-find-hit", "demo-find-current");
      }
    } else {
      paintCurrent();
    }
  }

  function findNext(count, reverse) {
    var c = Math.max(1, count || 1);
    if (findState.hidden && findState.marks.length > 0) {
      setFindHidden(false);
      updateFindStatus();
    }
    if (findState.marks.length === 0) {
      if (!findState.query) {
        toast("No search");
        return;
      }
      rebuildFind();
      if (findState.marks.length === 0) {
        toast('No match for "' + findState.query + '"');
        return;
      }
    }
    gotoMark(findState.idx + (reverse ? -c : c), true);
  }

  function linkAncestor(el) {
    var node = el;
    while (node && node !== article) {
      if (node.tagName === "A" && node.getAttribute("href")) return node;
      node = node.parentElement;
    }
    return null;
  }

  function followCurrentMark() {
    if (findState.hidden || findState.marks.length === 0) return false;
    var cur = findState.marks[findState.idx];
    if (!cur) return false;
    var link = linkAncestor(cur.parentElement || cur);
    if (!link) return false;
    try {
      link.click();
    } catch {
      try {
        window.location.href = link.getAttribute("href");
      } catch {}
    }
    clearMarks();
    findState.query = "";
    updateFindStatus();
    return true;
  }

  function openFind() {
    findOpen = true;
    countBuf = "";
    pendingG = false;
    findbar.hidden = false;
    findinput.value = findState.query || "";
    try {
      findinput.focus({ preventScroll: true });
    } catch {
      findinput.focus();
    }
  }

  function closeFind() {
    findOpen = false;
    findbar.hidden = true;
    try {
      findinput.blur();
    } catch {}
    try {
      document.body.focus({ preventScroll: true });
    } catch {}
  }

  function caretRect() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var r = sel.getRangeAt(0).cloneRange();
    try {
      r.collapse(false);
      var rects = r.getClientRects();
      if (rects.length > 0) return rects[0];
      return r.getBoundingClientRect();
    } catch {
      return null;
    }
  }

  function drawCaret() {
    var rect = caretRect();
    if (!rect) return;
    if (!caretEl) {
      caretEl = document.createElement("div");
      caretEl.className = "demo-visual-caret";
      document.body.appendChild(caretEl);
    }
    caretEl.style.left = rect.left + "px";
    caretEl.style.top = rect.top + "px";
    caretEl.style.height = Math.max(14, rect.height || 18) + "px";
  }

  function removeCaret() {
    if (caretEl) {
      try {
        caretEl.remove();
      } catch {}
      caretEl = null;
    }
  }

  function startVisual() {
    countBuf = "";
    pendingG = false;
    var sel = window.getSelection();
    var range = null;
    try {
      if (sel && sel.rangeCount > 0) {
        var r = sel.getRangeAt(0);
        if (article.contains(r.commonAncestorContainer)) range = r.cloneRange();
      }
    } catch {}
    if (!range) {
      var p = article.querySelector("p");
      range = document.createRange();
      try {
        range.setStart(p.firstChild || p, 0);
        range.collapse(true);
      } catch {}
    }
    try {
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    mode = "visual";
    setPill();
    toast("VISUAL — hjkl move, y yank, Esc exits");
    drawCaret();
  }

  function stopVisual() {
    removeCaret();
    try {
      window.getSelection().removeAllRanges();
    } catch {}
    mode = "normal";
    setPill();
  }

  function moveVisual(dir) {
    var sel = window.getSelection();
    if (!sel) return;
    try {
      if (typeof sel.modify === "function") {
        if (dir === "h") sel.modify("extend", "backward", "character");
        else if (dir === "l") sel.modify("extend", "forward", "character");
        else if (dir === "j") sel.modify("extend", "forward", "line");
        else if (dir === "k") sel.modify("extend", "backward", "line");
        drawCaret();
        return;
      }
    } catch {}
    try {
      var r = sel.getRangeAt(0);
      var next = document.createRange();
      next.setStart(r.startContainer, r.startOffset);
      next.setEnd(r.endContainer, r.endOffset);
      if (dir === "l" || dir === "j") next.setEnd(next.endContainer, next.endOffset + 1);
      else next.setStart(next.startContainer, Math.max(0, next.startOffset - 1));
      sel.removeAllRanges();
      sel.addRange(next);
      drawCaret();
    } catch {}
  }

  function yankVisual() {
    var text = "";
    try {
      text = window.getSelection().toString();
    } catch {}
    if (!text) {
      toast("Nothing selected");
      return;
    }
    function done() {
      toast("Yanked " + text.length + " chars");
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          fallbackCopy(text);
          done();
        });
        return;
      }
    } catch {}
    fallbackCopy(text);
    done();
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch {}
  }

  function scrollStep(key, count) {
    var c = Math.max(1, count || 1);
    try {
      if (key === "j") window.scrollBy(0, LINE_PX * c);
      else if (key === "k") window.scrollBy(0, -LINE_PX * c);
      else if (key === "h") window.scrollBy(-LINE_PX * c, 0);
      else if (key === "l") window.scrollBy(LINE_PX * c, 0);
      else if (key === "d") window.scrollBy(0, Math.round(window.innerHeight / 2) * c);
      else if (key === "u") window.scrollBy(0, -Math.round(window.innerHeight / 2) * c);
      else if (key === "gg") window.scrollTo(0, 0);
      else if (key === "G") window.scrollTo(0, document.body.scrollHeight);
    } catch {
      if (key === "gg") window.scrollTo(0, 0);
    }
  }

  function goParent() {
    try {
      var url = new URL(window.location.href);
      var path = url.pathname;
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      var idx = path.lastIndexOf("/");
      url.pathname = idx > 0 ? path.slice(0, idx) : "/";
      url.search = "";
      url.hash = "";
      window.location.href = url.href;
    } catch {}
  }

  function goRoot() {
    try {
      var url = new URL(window.location.href);
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      window.location.href = url.href;
    } catch {}
  }

  function reloadPage(hard) {
    if (!hard) {
      try {
        window.location.reload();
      } catch {}
      return;
    }
    toast("No cache bypass in demo — normal reload");
    setTimeout(function () {
      try {
        window.location.reload();
      } catch {}
    }, 900);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    try {
      if (el.isContentEditable) return true;
    } catch {}
    return false;
  }

  findinput.addEventListener("input", function () {
    findState.query = findinput.value;
    findState.hidden = false;
    rebuildFind();
  });

  findinput.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      findState.query = findinput.value;
      closeFind();
      if (findState.query.trim() !== "") {
        rebuildFind();
        if (findState.marks.length > 0) gotoMark(0, false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  });

  article.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("button[data-toast]") : null;
    if (b) toast(b.getAttribute("data-toast") || "Done");
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var active = document.activeElement;

    if (findOpen) return;

    if (isTypingTarget(active) && active !== document.body) {
      if (e.key === "Escape") {
        try {
          active.blur();
        } catch {}
      }
      return;
    }

    if (!help.hidden && (e.key === "?" || e.key === "Escape")) {
      e.preventDefault();
      help.hidden = true;
      return;
    }

    if (mode === "hints" && hintState) {
      if (onHintKey(e.key)) {
        e.preventDefault();
        setPill();
      } else if (e.key !== "Shift") {
        closeHints();
      }
      return;
    }

    if (mode === "visual") {
      if (e.key === "Escape" || e.key === "v") {
        e.preventDefault();
        stopVisual();
      } else if (e.key === "y") {
        e.preventDefault();
        yankVisual();
      } else if (e.key === "h" || e.key === "j" || e.key === "k" || e.key === "l") {
        e.preventDefault();
        moveVisual(e.key);
      } else if (e.key === "?") {
        e.preventDefault();
        help.hidden = !help.hidden;
      }
      return;
    }

    if (pendingG) {
      pendingG = false;
      countBuf = "";
      if (e.key === "g" || e.key === "f" || e.key === "u" || e.key === "U") e.preventDefault();
      if (e.key === "g") {
        scrollStep("gg", 1);
        setPill();
        return;
      }
      if (e.key === "f") {
        openHints(true, true);
        return;
      }
      if (e.key === "u") {
        goParent();
        setPill();
        return;
      }
      if (e.key === "U") {
        goRoot();
        setPill();
        return;
      }
      setPill();
    }

    if (/^[0-9]$/.test(e.key)) {
      countBuf += e.key;
      setPill();
      e.preventDefault();
      return;
    }

    if (e.key === "g") {
      pendingG = true;
      setPill();
      e.preventDefault();
      return;
    }

    var c = takeCount(1);
    switch (e.key) {
      case "j":
      case "k":
      case "h":
      case "l":
      case "d":
      case "u":
        e.preventDefault();
        scrollStep(e.key, c);
        break;
      case "G":
        e.preventDefault();
        scrollStep("G", 1);
        break;
      case "H":
        e.preventDefault();
        try {
          window.history.go(-c);
        } catch {}
        break;
      case "L":
        e.preventDefault();
        try {
          window.history.go(c);
        } catch {}
        break;
      case "r":
        e.preventDefault();
        reloadPage(false);
        break;
      case "R":
        e.preventDefault();
        reloadPage(true);
        break;
      case "f":
        e.preventDefault();
        openHints(false, false);
        return;
      case "F":
        e.preventDefault();
        openHints(true, false);
        return;
      case "/":
        e.preventDefault();
        openFind();
        return;
      case "n":
        e.preventDefault();
        findNext(c, false);
        break;
      case "N":
        e.preventDefault();
        findNext(c, true);
        break;
      case "v":
        e.preventDefault();
        startVisual();
        return;
      case "?":
        e.preventDefault();
        help.hidden = !help.hidden;
        return;
      case "Escape":
        e.preventDefault();
        pendingG = false;
        countBuf = "";
        if (!help.hidden) help.hidden = true;
        else if (findState.marks.length > 0 && !findState.hidden) setFindHidden(true);
        break;
      case "Enter":
        if (findState.marks.length > 0 && !findState.hidden) {
          e.preventDefault();
          followCurrentMark();
        }
        break;
      default:
        setPill();
        return;
    }
    setPill();
  });

  setPill();
})();
