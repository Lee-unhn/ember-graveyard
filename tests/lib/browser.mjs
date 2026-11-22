// Shared headless-Chrome helper (zero dependencies: Node 18+ built-in fetch/WebSocket + Chrome DevTools Protocol).
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

// EG_ROOT lets the mutation test point every suite at a deliberately broken copy.
export const ROOT = process.env.EG_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find((p) => p && existsSync(p));
}

export function serve(root = ROOT) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
  const srv = http.createServer((req, res) => {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/** Launch Chrome, open `url`, return helpers. `errors` collects page exceptions, console.error and network errors. */
export async function openPage(url, { width = 1280, height = 800, mobile = false } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome/Chromium found (set CHROME_PATH)');
  const prof = mkdtempSync(join(tmpdir(), 'eg-cdp-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', ...(process.env.EG_AUDIBLE ? [] : ['--mute-audio', '--disable-audio-output']), '--autoplay-policy=no-user-gesture-required', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 30000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); res(m[0]); } });
  });
  const list = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*/, '/json/list'))).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(r.error.message);
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  // The game reads lines aloud with the OS speech engine when a line has no recorded voice; that sound bypasses the browser's audio
  // output, so --disable-audio-output cannot silence it. Tests replace speak() with a silent stand-in that still fires start and end
  // (EG_AUDIBLE=1 keeps the real voice). window.__egSpoken counts the lines that would have been read.
  if (!process.env.EG_AUDIBLE) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { const S = window.speechSynthesis; if (!S) return; window.__egSpoken = 0;
    S.speak = function (u) { window.__egSpoken++; setTimeout(() => { try { u.dispatchEvent(new Event('start')); u.dispatchEvent(new Event('end')); } catch (e) {} }, 0); }; } catch (e) {} })();` });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // CPU_THROTTLE=6 reproduces a slow CI runner locally (Chrome slows its own CPU by that factor)
  if (+process.env.CPU_THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: +process.env.CPU_THROTTLE });
  await send('Page.navigate', { url });
  const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr).catch(() => false)) return true; await sleep(200); } return false; };
  // real input
  const key = async (code, keyName = code, text) => {
    const base = { code, key: keyName, windowsVirtualKeyCode: VK[code] || 0 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const keyDown = (code) => send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: VK[code] || 0 });
  const keyUp = (code) => send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: VK[code] || 0 });
  const mouse = async (type, x, y, button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1, buttons: type === 'mousePressed' ? (button === 'left' ? 1 : 2) : 0 });
  const click = async (x, y, button = 'left') => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, button); await mouse('mouseReleased', x, y, button); };
  const clickSel = async (sel) => {
    const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error('no element ' + sel); await click(r[0], r[1]); return r;
  };
  // real touch input (touch emulation is on when openPage(..., { mobile: true }))
  const touch = (type, pts = []) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const tapSel = async (sel) => {
    const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error('no element ' + sel); await touch('touchStart', [r]); await sleep(60); await touch('touchEnd'); return r;
  };
  const screenshot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  // proc.kill() only ends Chrome's launcher process on Windows; its renderer/GPU children survive and keep the CPU busy,
  // which slowed (and stalled) the next Chrome a suite opened. Kill the whole tree instead.
  const close = async () => { try { ws.close(); } catch {}
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill();
    await sleep(300); try { rmSync(prof, { recursive: true, force: true }); } catch {} };
  return { send, evaluate, waitFor, key, keyDown, keyUp, mouse, click, clickSel, touch, tapSel, screenshot, errors, close };
}
const VK = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyF: 70, KeyG: 71, KeyI: 73, KeyR: 82, Space: 32, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Escape: 27, Tab: 9, KeyP: 80, ArrowLeft: 37, ArrowRight: 39 };

/** Tiny reporter shared by every suite: fail-loud, counts, exit code. */
export function reporter(title) {
  let fails = 0, passes = 0; console.log(`\n[${title}]`);
  return {
    ok(cond, msg, detail) { if (cond) { passes++; console.log('  PASS ' + msg); } else { fails++; console.log('  FAIL ' + msg + (detail !== undefined ? ' -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); } return cond; },
    get fails() { return fails; }, get passes() { return passes; },
    done() { console.log(fails ? `  RED: ${fails} failed, ${passes} passed` : `  GREEN: ${passes} passed`); return fails; },
  };
}
