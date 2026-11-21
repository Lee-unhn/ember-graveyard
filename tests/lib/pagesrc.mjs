// Everything the page runs, in load order: index.html plus the local scripts it references (kit/, content/, ...).
// Since the engine/content split (DEVLOG §4 #40) the game is no longer one inline script, so static checks read all of it.
import { readFileSync, existsSync } from 'node:fs';
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

// kit/ = engine (flows from A to the commercial version B), content/ = one content pack (stays with its game).
// Returns a list of human-readable violations; [] means the boundary holds.
export function splitViolations(kitFiles, contentFiles) {
  const bad = [];
  // 1. collect every string the content pack owns, so a kit file that copies one is caught even without a fixed word list
  const owned = new Set(['沐炎', '灰翁', '無燈之主']);
  for (const c of contentFiles) {
    try {
      const win = {};
      new Function('window', c.text + '\nreturn window.CONTENT;')(win);
      const C = win.CONTENT || {};
      for (const lines of Object.values(C.dialog || {})) for (const line of lines) if (line[1] && line[1].length >= 6) owned.add(line[1]);
      for (const sp of Object.values(C.speakers || {})) if (sp.n) owned.add(sp.n);
      for (const t of C.towers || []) if (t.name) owned.add(t.name);
    } catch (e) { /* a content file that does not run on its own gets reported by rule 2 or by the browser probe */ }
  }
  for (const k of kitFiles) for (const w of owned) if (k.text.includes(w)) bad.push(`kit/ file ${k.name} contains demo content: ${w.slice(0, 20)}`);
  // 2. content must be data only: no engine objects, no function definitions, no control flow
  const stripStrings = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  for (const c of contentFiles) {
    const code = c.text.replace(stripStrings, "''").replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const [re, what] of [[/\bTHREE\b/, 'THREE.'], [/\brenderer\b/, 'renderer'], [/\bfunction\b/, 'function'], [/=>/, 'arrow function'],
      [/\b(?:if|for|while|switch)\s*\(/, 'control flow'], [/\bdocument\b/, 'document'], [/\bnew\s+[A-Z]/, 'new'], [/\bclass\b/, 'class']])
      if (re.test(code)) bad.push(`content file ${c.name} contains engine logic: ${what}`);
  }
  return bad;
}
