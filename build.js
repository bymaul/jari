// Generates manifest.json for the target browser.
// Usage: node build.js <chrome|firefox>
const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (target !== "chrome" && target !== "firefox") {
  console.error("Usage: node build.js <chrome|firefox>");
  process.exit(1);
}

const src = path.join(__dirname, `manifest.${target}.json`);
const dest = path.join(__dirname, "manifest.json");

if (!fs.existsSync(src)) {
  console.error(`Missing source manifest: ${src}`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`Wrote manifest.json from manifest.${target}.json`);
console.log(`Load this folder in ${target === "chrome" ? "Chrome" : "Firefox"}.`);
