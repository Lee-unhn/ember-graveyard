// Everything the page runs, in load order: index.html plus the local scripts it references (kit/, content/, ...).
// Since the engine/content split (DEVLOG §4 #40) the game is no longer one inline script, so static checks read all of it.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';

export function pageSources(root) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const scripts = tags.map((m) => {
    const attrs = m[1], src = (attrs.match(/\bsrc="([^"]+)"/) || [])[1] || null;
    const local = !!src && !/^https?:/.test(src);
    return { attrs, src, local, defer: /\bdefer\b/.test(attrs), async: /\basync\b/.test(attrs),
      text: local ? (existsSync(join(root, src)) ? readFileSync(join(root, src), 'utf8') : null) : src ? null : m[2] };
  });
  return { html, scripts, localFiles: scripts.filter((s) => s.local).map((s) => s.src) };
}

// Every content-pack script the gates must look at: the ones index.html loads from content/ AND every content/<pack>/*.js on disk
// (a second pack that index.html does not load yet is still a pack the engine must stay clean of).
export function contentScripts(root) {
  const names = new Set(pageSources(root).scripts.filter((s) => s.local && /^content\//.test(s.src) && /\.js$/.test(s.src)).map((s) => s.src));
  const base = join(root, 'content');
  if (existsSync(base)) for (const d of readdirSync(base)) { const dir = join(base, d); if (statSync(dir).isDirectory()) for (const f of readdirSync(dir)) if (f.endsWith('.js') && statSync(join(dir, f)).isFile()) names.add(`content/${d}/${f}`); }
  return [...names].sort().filter((n) => existsSync(join(root, n))).map((n) => ({ name: n, text: readFileSync(join(root, n), 'utf8') }));
}

// Source text -> only the code: strings, template-literal text and comments removed in ONE pass (so an apostrophe inside a comment cannot
// swallow code, and code inside a template literal's ${...} is kept). Regex literals are not understood; content is data, so that is fine.
export function codeOnly(src) {
  let out = '', i = 0; const n = src.length;
  const tpl = () => { while (i < n) { const ch = src[i]; if (ch === '\\') { i += 2; continue; } if (ch === '`') { i++; return; } if (ch === '$' && src[i + 1] === '{') { i += 2; out += ' ( '; code(true); out += ' ) '; continue; } i++; } };
  const code = (inTpl) => { let depth = 0;
    while (i < n) { const ch = src[i], nx = src[i + 1];
      if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
      if (ch === '/' && nx === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
      if (ch === "'" || ch === '"') { i++; while (i < n && src[i] !== ch && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; out += "''"; continue; }
      if (ch === '`') { i++; tpl(); out += "''"; continue; }
      if (inTpl) { if (ch === '{') depth++; else if (ch === '}') { if (depth === 0) { i++; return; } depth--; } }
      out += ch; i++; } };
  code(false); return out;
}

// Text a kit file could hide a copied string behind: \u / \x escapes decoded, "a"+"b" joined.
const decoded = (t) => t.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (_, a, b, c) => String.fromCodePoint(parseInt(a || b || c, 16))).replace(/(['"`])\s*\+\s*\1/g, '');

// Strings the content packs own, read by really running the content files in a sandboxed global (they write to a bare `CONTENT`, so the
// context needs a `window` that is its own global). Returns { owned, read, errors }; `read` is how many content files produced a CONTENT.
export function ownedStrings(contentFiles) {
  const owned = new Set(['沐炎', '灰翁', '無燈之主']), errors = []; let read = 0;
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  for (const c of contentFiles) { try { vm.runInContext(c.text, ctx, { timeout: 1000 }); read++; } catch (e) { errors.push(`${c.name}: ${String(e && e.message || e).slice(0, 80)}`); } }
  let C = {}; try { C = JSON.parse(JSON.stringify(ctx.CONTENT || {})); } catch { /* getters that throw are reported by the side-effect rule */ }
  const add = (s, min) => { if (typeof s === 'string' && s.trim().length >= min) owned.add(s.trim()); };
  for (const lines of Object.values(C.dialog || {})) for (const line of Array.isArray(lines) ? lines : []) add(line && line[1], 3);
  for (const sp of Object.values(C.speakers || {})) add(sp && sp.n, 1);
  for (const t of C.towers || []) { add(t && t.name, 1); }
  for (const v of Object.values(C.text || {})) add(v, 2);
  return { owned, read, errors, hasContent: !!ctx.CONTENT };
}

// kit/ = engine (flows from A to the commercial version B), content/ = one content pack (stays with its game).
// Returns a list of human-readable violations; [] means the boundary holds.
export function splitViolations(kitFiles, contentFiles) {
  const bad = [];
  // 1. collect every string the content pack owns, so a kit file that copies one is caught even without a fixed word list
  const { owned, read, errors, hasContent } = ownedStrings(contentFiles);
  // self-check: a detector that silently read nothing is a detector that passes everything (the first version did exactly that, DEVLOG §5 #70)
  for (const e of errors) bad.push(`detector could not run content file ${e}`);
  if (contentFiles.length && (!read || !hasContent || owned.size <= 3)) bad.push(`detector read no strings from ${contentFiles.length} content file(s): the boundary check is not looking at the pack`);
  for (const k of kitFiles) { const plain = k.text, deco = decoded(k.text); for (const w of owned) if (plain.includes(w) || deco.includes(w)) bad.push(`kit/ file ${k.name} contains demo content: ${w.slice(0, 20)}`); }
  // 2. content must be data only: no engine objects, no function definitions, no control flow, no side effects
  const FORBID = [[/\bTHREE\b/, 'THREE.'], [/\brenderer\b/, 'renderer'], [/\bfunction\b/, 'function'], [/=>/, 'arrow function'],
    [/\b(?:if|for|while|switch|do|try|catch|throw|with)\b\s*[({]?/, 'control flow'], [/\bdocument\b/, 'document'], [/\bnew\s+[A-Za-z_$]/, 'new'], [/\bclass\b/, 'class'],
    [/\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|eval|Function|setTimeout|setInterval|requestAnimationFrame|import|require|process|globalThis|navigator|location|Proxy|Reflect|async|await|yield)\b/, 'side effect or global access'],
    [/[{,]\s*(?:get|set|static)\s+[\w$[]/, 'getter / setter'], [/\bwindow\s*(?:\.|\[)\s*(?!CONTENT\b)/, 'window access other than window.CONTENT'], [/\bwindow\s*\[/, 'window[...] access']];
  for (const c of contentFiles) {
    const code = codeOnly(c.text);
    for (const [re, what] of FORBID) if (re.test(code)) bad.push(`content file ${c.name} contains engine logic: ${what}`);
  }
  return bad;
}

// Names declared at the top level of one script text: const / let / class / var / function (brace depth 0 after strings and comments are removed).
// All blocking scripts share one global scope, so the same top-level const/let/class in two files is a SyntaxError in the browser;
// before the split one compile of the single inline script saw it, so the check has to do it across files now (breaker finding 11).
export function topLevelNames(text) {
  const code = codeOnly(text), names = []; let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if ('{(['.includes(ch)) { depth++; continue; } if ('})]'.includes(ch)) { depth--; continue; }
    if (depth !== 0 || /[\w$.]/.test(code[i - 1] || ' ')) continue;
    const m = /^(const|let|var|class|function\*?)\s+([A-Za-z_$][\w$]*)/.exec(code.slice(i, i + 80));
    if (m) { names.push({ kind: m[1][0] === 'f' ? 'function' : m[1], name: m[2] }); i += m[0].length - 1;
      if (m[1] === 'const' || m[1] === 'let' || m[1] === 'var') { // further declarators of the same statement: `const a=1,b=2`
        let d = 0, j = i + 1; for (; j < code.length; j++) { const c = code[j]; if ('{(['.includes(c)) d++; else if ('})]'.includes(c)) { if (d === 0) break; d--; } else if (d === 0 && c === ';') break; else if (d === 0 && c === '\n') { const prev = code.slice(0, j).trimEnd().slice(-1), next = code.slice(j).trimStart()[0]; if (!',=+-*/&|?:(['.includes(prev) && !',.?:+-*/&|=)]'.includes(next || ';')) break; }
          if (d === 0 && c === ',') { const m2 = /^,\s*([A-Za-z_$][\w$]*)\s*(?:=|,|;|\n|$)/.exec(code.slice(j, j + 80)); if (m2) names.push({ kind: m[1], name: m2[1] }); } }
      } }
    else { const d = /^(?:const|let)\s*[{[]/.exec(code.slice(i, i + 20)); if (d) { let k = i + d[0].length, dd = 1; const inner = []; for (; k < code.length && dd > 0; k++) { if ('{['.includes(code[k])) dd++; else if ('}]'.includes(code[k])) dd--; inner.push(code[k]); }
        for (const x of inner.join('').matchAll(/(?:^|[,{\s])(?:[\w$]+\s*:\s*)?([A-Za-z_$][\w$]*)\s*(?=[,=}\]]|$)/g)) names.push({ kind: 'destructured', name: x[1] }); } }
  }
  return names;
}
export function sharedScopeDuplicates(files) { // files: [{ name, text }] in load order; reports const/let/class names declared twice, or once as const/let/class and once as a function
  const seen = new Map(), dup = [];
  for (const f of files) for (const { kind, name } of topLevelNames(f.text)) {
    const prev = seen.get(name);
    if (prev && (kind !== 'var' && kind !== 'function' || prev.kind !== 'var' && prev.kind !== 'function' || (kind === 'function') !== (prev.kind === 'function'))) dup.push(`${name} (${prev.file} ${prev.kind} / ${f.name} ${kind})`);
    if (!prev) seen.set(name, { kind, file: f.name });
  }
  return dup;
}
