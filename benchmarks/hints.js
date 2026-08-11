// Jari: microbenchmark for hint label generation.
// Pure CPU cost of generateLabels() at realistic page sizes, for the
// home-row set (default) and the full alphabet. Full-page hint latency is
// DOM-bound (selector scan + getComputedStyle in isVisible) and is measured
// in-browser instead — this isolates the label algorithm.
// Usage: npm run bench
"use strict";

const { loadContentScript } = require("../tests/harness.js");

const Jari = loadContentScript("hints.js");

const ALPHABETS = {
  "home-row (14)": "SADFJKLEWCMPGH",
  "full (26)": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
};
const COUNTS = [100, 500, 1000, 5000, 10000];
const REPS = 50;

for (const [name, chars] of Object.entries(ALPHABETS)) {
  Jari.settings = { getHintChars: () => chars };
  console.log(`\nalphabet: ${name}`);
  for (const count of COUNTS) {
    Jari.Hints.generateLabels(count); // warmup
    const start = process.hrtime.bigint();
    for (let i = 0; i < REPS; i++) Jari.Hints.generateLabels(count);
    const ms = Number(process.hrtime.bigint() - start) / 1e6 / REPS;
    console.log(`  ${String(count).padStart(5)} labels  ${ms.toFixed(3)} ms  (${(count / (ms / 1000) / 1e6).toFixed(1)}M labels/s)`);
  }
}
