import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const allowed = new Set([
  "MIT", "ISC", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Unlicense", "WTFPL",
  "(MIT AND Zlib)", "(MIT OR GPL-3.0-or-later)", "(WTFPL OR MIT)", "WTFPL OR ISC",
]);
const summary = new Map();
const rejected = [];
for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path.includes("node_modules/") || metadata.dev || path.startsWith("node_modules/@cwp/")) continue;
  const license = metadata.license ?? "MISSING";
  summary.set(license, (summary.get(license) ?? 0) + 1);
  if (!allowed.has(license)) rejected.push(`${path.replace(/^.*node_modules\//, "")} (${license})`);
}
if (rejected.length) {
  console.error(`Production dependency license check failed:\n${rejected.join("\n")}`);
  process.exit(1);
}
console.log(`Production dependency licenses passed (${[...summary.values()].reduce((sum, count) => sum + count, 0)} packages).`);
for (const [license, count] of [...summary].sort(([a], [b]) => a.localeCompare(b))) console.log(`${license}: ${count}`);
