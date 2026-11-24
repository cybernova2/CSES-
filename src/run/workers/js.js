// Node.js-style runtime: QuickJS on WebAssembly with a small Node shim (fs.readFileSync(0), readline,
// process.stdin/stdout, console). User code runs inside QuickJS, never in the browser's own JS engine.
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { cap } from './common.js';

const NODE_SHIM = String.raw`
(() => {
  const listeners = { data: [], end: [] };
  const rls = [];
  const fmt = (v) => typeof v === 'string' ? v : (v === undefined ? 'undefined' : (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)));
  globalThis.console = { log: (...a) => __out(a.map(fmt).join(' ') + '\n'), error: (...a) => __err(a.map(fmt).join(' ') + '\n') };
  console.info = console.log; console.warn = console.error;
  const stdin = { on(ev, f) { (listeners[ev] ||= []).push(f); return stdin; }, setEncoding() { return stdin; }, resume() { return stdin; }, fd: 0 };
  globalThis.process = {
    stdin, argv: ['node', 'main.js'], env: {}, platform: 'linux',
    stdout: { write: (s) => { __out(String(s)); return true; } },
    stderr: { write: (s) => { __err(String(s)); return true; } },
    exit: (c = 0) => { throw { __exit: c }; },
  };
  const lines = () => { const ls = __stdin.split('\n'); if (ls[ls.length - 1] === '') ls.pop(); return ls.map((l) => l.replace(/\r$/, '')); };
  const fs = { readFileSync(f) { if (f === 0 || f === '/dev/stdin') return __stdin; throw new Error('ENOENT: no such file ' + f); } };
  const readline = { createInterface() {
    const rl = { h: { line: [], close: [] }, on(ev, f) { (rl.h[ev] ||= []).push(f); return rl; }, close() {},
      [Symbol.asyncIterator]: async function* () { for (const l of lines()) yield l; } };
    rls.push(rl); return rl; } };
  globalThis.require = (m) => {
    if (m === 'fs') return fs;
    if (m === 'readline') return readline;
    throw new Error("Module '" + m + "' is not available in CSES+ local run");
  };
  globalThis.__drain = () => {
    for (const f of listeners.data) f(__stdin);
    for (const f of listeners.end) f();
    for (const rl of rls) { for (const l of lines()) for (const f of rl.h.line) f(l); for (const f of rl.h.close) f(); }
  };
})();`;

let QuickJS;
let code = '';
try {
  QuickJS = await newQuickJSWASMModuleFromVariant(variant);
  self.postMessage({ type: 'ready' });
} catch (e) {
  self.postMessage({ type: 'init-error', message: String(e?.message ?? e) });
}

self.onmessage = ({ data }) => {
  if (data.op === 'compile') {
    code = data.code;
    self.postMessage({ id: data.id, ok: true, compileMs: 0, diagnostics: '' });
    return;
  }
  if (data.op !== 'run') return;
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(512 * 1024 * 1024);
  runtime.setMaxStackSize(0);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + (data.timeLimitMs ?? 5000)));
  const vm = runtime.newContext();
  let out = '';
  let err = '';
  const handles = [
    vm.newFunction('__out', (s) => { out += vm.getString(s); }),
    vm.newFunction('__err', (s) => { err += vm.getString(s); }),
    vm.newString(data.stdin ?? ''),
  ];
  vm.setProp(vm.global, '__out', handles[0]);
  vm.setProp(vm.global, '__err', handles[1]);
  vm.setProp(vm.global, '__stdin', handles[2]);
  handles.forEach((h) => h.dispose());
  vm.unwrapResult(vm.evalCode(NODE_SHIM)).dispose();

  const t = performance.now();
  let exit = 0;
  let error = null;
  const check = (r) => {
    if (!r.error) { r.value.dispose(); return true; }
    const e = vm.dump(r.error);
    r.error.dispose();
    if (e && typeof e === 'object' && '__exit' in e) { exit = e.__exit; return false; }
    error = e && typeof e === 'object' && 'message' in e ? `${e.name ?? 'Error'}: ${e.message}\n${e.stack ?? ''}`.trim() : `Uncaught ${JSON.stringify(e)}`;
    if (/interrupted/i.test(error)) error = 'Time limit exceeded (local run).';
    exit = 1;
    return false;
  };
  if (check(vm.evalCode(code, 'main.js')) && check(vm.evalCode('__drain()'))) runtime.executePendingJobs(-1);
  const runMs = Math.round(performance.now() - t);
  vm.dispose();
  runtime.dispose();
  self.postMessage({ id: data.id, ok: exit === 0, exit, error, runMs, stdout: cap(out), stderr: cap(err) });
};
