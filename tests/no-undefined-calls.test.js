import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// フレームループの中で起きる ReferenceError は、ビルドもNodeのテストも素通りする。
// ブラウザで実際に1フレーム回すまで誰も気づかない（このプロジェクトで2度起きた）。
// 呼び出している名前が定義されているかだけでも、ここで止められるようにする。

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const KNOWN_GLOBALS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof",
  "await", "new", "do", "else", "throw", "case", "delete", "void", "in", "of",
  "Math", "Number", "String", "Boolean", "Array", "Object", "JSON", "Set", "Map",
  "Date", "Error", "Promise", "Symbol", "BigInt", "RegExp", "WeakMap", "WeakSet",
  "parseInt", "parseFloat", "isNaN", "isFinite", "structuredClone",
  "window", "document", "navigator", "location", "performance", "console",
  "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "fetch", "URL", "URLSearchParams",
  "Float32Array", "Uint8Array", "Uint16Array", "Uint32Array", "Int32Array",
  "PointerEvent", "TouchEvent", "KeyboardEvent", "CustomEvent", "Event",
  "AudioContext", "webkitAudioContext", "Image", "Blob", "matchMedia",
]);

// 宣言している名前を集める。完全な構文解析ではなく、
// 「呼び出しているのにどこにも無い名前」を見つけるための粗い網。
function declaredNames(source) {
  const names = new Set();
  const add = (regex, group = 1) => {
    for (const match of source.matchAll(regex)) names.add(match[group]);
  };
  add(/\bfunction\s+([A-Za-z_$][\w$]*)/g);
  add(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
  add(/\bclass\s+([A-Za-z_$][\w$]*)/g);
  // import { a, b as c } from "..." と import d from "..."
  for (const match of source.matchAll(/import\s+([^;]+?)\s+from\s+["']/g)) {
    const clause = match[1];
    for (const piece of clause.replace(/[{}]/g, ",").split(",")) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim();
      if (name && name !== "*") names.add(name);
    }
  }
  // 分割代入で受けた名前（{ x, y } = ... / [a, b] = ...）
  for (const match of source.matchAll(/(?:const|let|var)\s*[{[]([^}\]]+)[}\]]/g)) {
    for (const piece of match[1].split(",")) {
      const name = piece.trim().split(":").pop().trim().replace(/\s*=.*$/, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // オブジェクトやクラスの短縮メソッド定義（呼び出しと同じ形に見える）
  add(/^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm);
  // 関数の引数
  for (const match of source.matchAll(/(?:function\s*[\w$]*\s*|=>\s*)?\(([^)]*)\)\s*(?:=>|\{)/g)) {
    for (const piece of match[1].split(",")) {
      const name = piece.trim().replace(/[{}[\]]/g, "").split(/[:=]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function calledNames(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  const names = new Set();
  // 直前がドットでない（＝メソッド呼び出しでない）呼び出しだけを見る
  for (const match of stripped.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/gm)) {
    names.add(match[2]);
  }
  return names;
}

test("every function called in src/ is actually defined somewhere", () => {
  const files = readdirSync(srcDir).filter(
    // iCloudが作る「〇〇 2.js」のような同期競合コピーは対象外
    (name) => name.endsWith(".js") && !/ \d+\.js$/.test(name)
  );
  assert.ok(files.length > 0, "src/ に読むファイルがない");

  const problems = [];
  for (const file of files) {
    const source = readFileSync(join(srcDir, file), "utf8");
    const declared = declaredNames(source);
    for (const name of calledNames(source)) {
      if (KNOWN_GLOBALS.has(name) || declared.has(name)) continue;
      problems.push(`${file}: ${name}() を呼んでいるが、どこにも定義がない`);
    }
  }

  assert.deepEqual(problems, []);
});
