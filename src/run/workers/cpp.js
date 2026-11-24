// C / C++ runtime: Clang/LLD 22 (WebAssembly build, packaged with the extension) compiles to wasm32-wasip1,
// and the program runs on a WASI shim with the test input as stdin. Nothing leaves the browser.
//
// Protocol (all workers): in  { id, op: 'compile', code, lang, std } | { id, op: 'run', stdin, timeLimitMs }
//                         out { type: 'ready' | 'init-error' | 'status' } | { id, ...result }
import { runClang } from '../vendor/clang/bundle.js';
import { WASI, WASIProcExit, File, OpenFile } from '@bjorn3/browser_wasi_shim';
import stdcpp from '../shim/bits/stdc++.h';
import compat from '../shim/csesplus_gcc_compat.h';
import { cap, idbGet, idbPut } from './common.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const shim = { bits: { 'stdc++.h': stdcpp }, 'csesplus_gcc_compat.h': compat };
const PRE = '#include "csesplus_gcc_compat.h"\n#include <bits/stdc++.h>\n';
const BASE = ['-O2', '-Wall', '-fno-exceptions', '-Ishim', '-D_WASI_EMULATED_SIGNAL'];
const LINK = ['-lwasi-emulated-signal', '-Wl,-z,stack-size=67108864'];
const PCH_KEY = (std) => `pch|clang-22.0.0-git20695-13|${std}|${stdcpp.length}|${compat.length}`;
const status = (text) => self.postMessage({ type: 'status', text });

let program = null; // compiled WebAssembly.Module of the last successful compile

async function clang(args, files) {
  let diag = '';
  try {
    const out = await runClang(args, files, { stdout() {}, stderr: (b) => b && (diag += dec.decode(b)) });
    return { out, diag };
  } catch (e) {
    return { out: null, diag: diag || String(e?.message ?? e) };
  }
}

// Precompiled <bits/stdc++.h>, built once per C++ standard and kept in IndexedDB (extension origin).
const pchMemo = new Map();
async function pchFor(std) {
  if (pchMemo.has(std)) return pchMemo.get(std);
  let pch = await idbGet(PCH_KEY(std)).catch(() => null);
  if (!pch) {
    status(`Preparing bits/stdc++.h for ${std.toUpperCase()} (first time only, about 20–30 s)…`);
    const r = await clang(['clang++', `-std=${std}`, ...BASE, '-x', 'c++-header', 'pre.h', '-o', 'pre.h.pch'], { 'pre.h': PRE, shim });
    pch = r.out?.['pre.h.pch'] ?? null;
    if (pch) await idbPut(PCH_KEY(std), pch).catch(() => {});
  }
  pchMemo.set(std, pch);
  return pch;
}

// Turn clang's diagnostics into something readable: drop the temp-file noise.
const cleanDiag = (d) => d.replace(/\/tmp\/[\w.-]+\.o: /g, '').trim();

async function compile({ code, lang, std }) {
  if (lang === 'c') {
    status('Compiling with Clang (C99)…');
    return clang(['clang', '-std=c99', '-O2', '-Wall', '-D_WASI_EMULATED_SIGNAL', 'main.c', ...LINK, '-o', 'a.wasm'], { 'main.c': code });
  }
  const files = { 'main.cpp': code, shim };
  const args = ['clang++', `-std=${std}`, ...BASE];
  if (/#\s*include\s*<bits\/stdc\+\+\.h>/.test(code)) {
    const pch = await pchFor(std);
    if (pch) {
      files['pre.h'] = PRE;
      files['pre.h.pch'] = pch;
      args.push('-include-pch', 'pre.h.pch');
    } else {
      args.push('-include', 'shim/csesplus_gcc_compat.h');
    }
  } else {
    args.push('-include', 'shim/csesplus_gcc_compat.h');
  }
  status(`Compiling with Clang (${std.toUpperCase()})…`);
  return clang([...args, 'main.cpp', ...LINK, '-o', 'a.wasm'], files);
}

async function execute(stdin) {
  const out = new File([]);
  const err = new File([]);
  const wasi = new WASI([], [], [new OpenFile(new File(enc.encode(stdin))), new OpenFile(out), new OpenFile(err)]);
  const instance = await WebAssembly.instantiate(program, { wasi_snapshot_preview1: wasi.wasiImport });
  const t = performance.now();
  let exit = 0;
  let error = null;
  try {
    if (typeof WebAssembly.promising === 'function') {
      // JSPI runs the program on a separate stack: roughly twice the recursion depth of a direct call.
      wasi.inst = instance;
      await WebAssembly.promising(instance.exports._start)();
    } else {
      exit = wasi.start(instance);
    }
  } catch (e) {
    if (e instanceof WASIProcExit) exit = e.code;
    else {
      const msg = String(e?.message ?? e);
      exit = 134;
      error = /call stack/i.test(msg)
        ? 'Recursion too deep for the browser (stack overflow). Browsers allow roughly 10,000 levels of C/C++ recursion; CSES allows far more. Your code may still be correct on CSES.'
        : /unreachable/i.test(msg)
          ? 'Program aborted (for example abort(), a failed assert, or an invalid operation).'
          : /out of bounds/i.test(msg)
            ? 'Invalid memory access (out of bounds).'
            : msg;
    }
  }
  return { exit, error, runMs: Math.round(performance.now() - t), stdout: cap(dec.decode(out.data)), stderr: cap(dec.decode(err.data)) };
}

try {
  status('Loading the C/C++ compiler…');
  await clang(['clang++', '-fsyntax-only', 'w.cpp'], { 'w.cpp': 'int main(){}' });
  self.postMessage({ type: 'ready' });
} catch (e) {
  self.postMessage({ type: 'init-error', message: String(e?.message ?? e) });
}

self.onmessage = async ({ data }) => {
  if (data.op === 'compile') {
    const t = performance.now();
    const c = await compile(data);
    const compileMs = Math.round(performance.now() - t);
    const wasm = c.out?.['a.wasm'];
    program = wasm ? await WebAssembly.compile(wasm) : null;
    self.postMessage({ id: data.id, ok: !!program, compileMs, diagnostics: cleanDiag(c.diag) });
  } else if (data.op === 'run') {
    if (!program) return self.postMessage({ id: data.id, ok: false, exit: -1, error: 'Not compiled.' });
    const r = await execute(data.stdin ?? '');
    self.postMessage({ id: data.id, ok: r.exit === 0 && !r.error, ...r });
  }
};
