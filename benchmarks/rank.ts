// Rank benchmark: per-keystroke cost of rankMatches over a synthetic
// suggest-sized pool. Not a test (no assertions, always exits 0).
// Run: npm run bench -- [poolSize]
import { rankMatches, type RankItem } from "../content/rank.ts";

const N = Number(process.argv[2]) || 600;
const titles = [
  "GitHub: opencode",
  "lofi hip hop radio - YouTube",
  "MDN Web Docs",
  "Stack Overflow - Where Developers Learn",
  "Hacker News",
  "Arch Linux Wiki",
  "PostgreSQL Documentation",
  "Rust Programming Language",
  "TypeScript Handbook",
  "NixOS Search",
];
const pool: RankItem[] = [];
for (let i = 0; i < N; i++) {
  const t = titles[i % titles.length];
  pool.push({
    title: `${t} #${i}`,
    url: `https://example${i % 97}.com/${t.toLowerCase().replace(/[^a-z]+/g, "-")}/${i}`,
    source: ["tab", "history", "bookmark"][i % 3],
    visitCount: i % 50,
    lastVisit: Date.now() - (i % 60) * 86400000,
  });
}

const queries = ["x", "gh", "ytb", "qzx", "arch wiki", "postgres doc 99"];
console.log(`pool: ${N} items`);
for (const q of queries) {
  rankMatches(q, pool);
  const passes = 30;
  const start = performance.now();
  for (let i = 0; i < passes; i++) rankMatches(q, pool);
  console.log(q.padEnd(16), `${((performance.now() - start) / passes).toFixed(2)}ms/pass`);
}
