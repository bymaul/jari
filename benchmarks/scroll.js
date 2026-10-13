// Scroll benchmark: per-keypress cost of Scroll.getTarget over a synthetic
// page, plus frame-paced drain of one smooth `j` step at 60fps vs 20fps.
// Not a test (no assertions, always exits 0).
// Run: node benchmarks/scroll.js [domSize]
const sizes = process.argv[2] ? [Number(process.argv[2])] : [500, 2000, 8000];

globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.window = {
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  innerWidth: 800,
  innerHeight: 600,
  scrollX: 0,
  scrollY: 0,
  top: null,
  getComputedStyle: () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
    overflowY: "auto",
    overflowX: "auto",
  }),
};
globalThis.window.top = globalThis.window;
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => {
  rafCb = cb;
  return 1;
};
let list = [];
globalThis.document = {
  addEventListener: () => {},
  activeElement: null,
  body: { appendChild: () => {} },
  documentElement: { style: {}, appendChild: () => {} },
  scrollingElement: { scrollHeight: 4000, clientHeight: 800 },
  createElement: () => ({ style: {}, appendChild: () => {}, remove: () => {} }),
  querySelectorAll: () => list,
  querySelector: () => null,
  execCommand: () => {},
};
globalThis.location = { hostname: "bench.example", href: "https://bench.example/" };
globalThis.chrome = {
  runtime: { onMessage: { addListener() {} }, sendMessage() {}, lastError: null },
  tabs: { onRemoved: { addListener() {} } },
  storage: {
    onChanged: { addListener() {} },
    sync: { get: async () => ({}), set: async () => {} },
    local: { get: async () => ({}), set: async () => {} },
  },
};

const { Scroll, smoothScrollBy } = await import("../content/scroll.js");

function makeArea(i) {
  return {
    tagName: "DIV",
    nodeType: 1,
    isConnected: true,
    parentElement: null,
    clientHeight: 200,
    clientWidth: 200,
    scrollHeight: 600,
    scrollWidth: 200,
    closest: () => null,
    contains: () => false,
    getAttribute: () => null,
    hasAttribute: () => false,
    getRootNode: () => ({ host: null }),
    getBoundingClientRect: () => ({
      left: (i * 37) % 600,
      top: (i * 53) % 600,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
    }),
    matches: (sel) => sel === "*",
  };
}

for (const n of sizes) {
  list = Array.from({ length: n }, (_, i) => makeArea(i));
  let start = performance.now();
  Scroll.getTarget();
  const cold = performance.now() - start;
  const K = 9;
  start = performance.now();
  for (let i = 0; i < K; i++) Scroll.getTarget();
  const follow = (performance.now() - start) / K;
  console.log(
    `dom: ${String(n).padStart(5)}  cold resolve ${cold.toFixed(2).padStart(7)}ms` +
      `  churn follow-up ${follow.toFixed(3).padStart(7)}ms/call`,
  );
}

function drainStep(frameMs) {
  const el = {
    scrollLeft: 0,
    scrollTop: 0,
    scrollBy({ left, top }) {
      this.scrollLeft += left;
      this.scrollTop += top;
    },
  };
  smoothScrollBy(el, 0, 120);
  let t = 0;
  let frames = 0;
  while (rafCb && frames < 1000) {
    const cb = rafCb;
    rafCb = null;
    t += frameMs;
    frames++;
    cb(t);
  }
  return { frames, ms: t };
}

for (const fps of [60, 20]) {
  const { frames, ms } = drainStep(1000 / fps);
  console.log(`smooth 120px @${fps}fps: ${frames} frames, ${ms.toFixed(0)}ms`);
}
