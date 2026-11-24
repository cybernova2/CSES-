// Python 3 runtime: Pyodide 0.27.7 (CPython 3.12.7 on WebAssembly), packaged with the extension.
import { loadPyodide } from '../vendor/pyodide/pyodide.mjs';
import { cap } from './common.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
let py;
let code = '';

try {
  self.postMessage({ type: 'status', text: 'Loading Python 3.12…' });
  py = await loadPyodide({ indexURL: new URL('../vendor/pyodide/', import.meta.url).href, stdout() {}, stderr() {} });
  self.postMessage({ type: 'ready' });
} catch (e) {
  self.postMessage({ type: 'init-error', message: String(e?.message ?? e) });
}

// Keep only the user's part of a Pyodide traceback.
const cleanTrace = (msg) => {
  const lines = msg.split('\n');
  const i = lines.findIndex((l) => l.includes('File "main.py"'));
  return (i > 0 ? ['Traceback (most recent call last):', ...lines.slice(i)] : lines).join('\n').trim();
};

self.onmessage = async ({ data }) => {
  if (data.op === 'compile') {
    code = data.code;
    const t = performance.now();
    try {
      py.globals.get('compile')(code, 'main.py', 'exec');
      self.postMessage({ id: data.id, ok: true, compileMs: Math.round(performance.now() - t), diagnostics: '' });
    } catch (e) {
      self.postMessage({ id: data.id, ok: false, compileMs: Math.round(performance.now() - t), diagnostics: cleanTrace(String(e?.message ?? e)) });
    }
    return;
  }
  if (data.op !== 'run') return;
  let out = '';
  let err = '';
  const bytes = enc.encode(data.stdin ?? '');
  let pos = 0;
  py.setStdin({ read: (buf) => { const n = Math.min(buf.length, bytes.length - pos); buf.set(bytes.subarray(pos, pos + n)); pos += n; return n; } });
  py.setStdout({ write: (b) => { out += dec.decode(b); return b.length; } });
  py.setStderr({ write: (b) => { err += dec.decode(b); return b.length; } });
  const globals = py.globals.get('dict')();
  globals.set('__name__', '__main__');
  const t = performance.now();
  let exit = 0;
  let error = null;
  try {
    py.runPython(code, { globals, filename: 'main.py' });
  } catch (e) {
    const msg = String(e?.message ?? e);
    const m = /SystemExit:\s*(\d+)?/.exec(msg);
    if (m) exit = Number(m[1] ?? 0);
    else { error = cleanTrace(msg); exit = 1; }
  } finally {
    try { py.runPython('import sys; sys.stdout.flush(); sys.stderr.flush()'); } catch {}
    globals.destroy();
  }
  self.postMessage({ id: data.id, ok: exit === 0, exit, error, runMs: Math.round(performance.now() - t), stdout: cap(out), stderr: cap(err) });
};
