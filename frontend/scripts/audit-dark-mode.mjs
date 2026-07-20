import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, relative } from "node:path";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const extensions = new Set([".ts", ".tsx"]);
const violations = [];
const patterns = [
  { name: "inline white background", regex: /background(?:Color)?:\s*["'`]#(?:fff|ffffff)["'`]/gi },
  { name: "inline pale surface", regex: /background(?:Color)?:\s*["'`]#(?:f8fafc|f5f7fb|f4f7fb|eef2f7)["'`]/gi },
  { name: "light graph tooltip", regex: /background:#fff;border:1px solid #d7e0ec/gi },
  { name: "white graph label", regex: /labelBgStyle:\s*\{\s*fill:\s*["'`]#ffffff["'`]/gi },
];

function walk(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) {
      walk(file);
      continue;
    }
    if (!extensions.has(extname(file))) continue;

    const source = readFileSync(file, "utf8");
    for (const rule of patterns) {
      for (const match of source.matchAll(rule.regex)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${relative(join(root, ".."), file)}:${line} ${rule.name}`);
      }
    }
  }
}

walk(root);
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Dark-mode inline color audit passed.");
}
