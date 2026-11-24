// Ruby runtime: CRuby 3.2 on WebAssembly (ruby.wasm, with standard library), packaged with the extension.
import { RubyVM } from '@ruby/wasm-wasi/dist/vm';
import { WASI, File, OpenFile, PreopenDirectory } from '@bjorn3/browser_wasi_shim';
import { cap } from './common.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
let module;
let code = '';

try {
  self.postMessage({ type: 'status', text: 'Loading Ruby 3.2…' });
  module = await WebAssembly.compileStreaming(fetch(new URL('../vendor/ruby/ruby+stdlib.wasm', import.meta.url)));
  self.postMessage({ type: 'ready' });
} catch (e) {
  self.postMessage({ type: 'init-error', message: String(e?.message ?? e) });
}

self.onmessage = async ({ data }) => {
  if (data.op === 'compile') {
    code = data.code;
    self.postMessage({ id: data.id, ok: true, compileMs: 0, diagnostics: '' });
    return;
  }
  if (data.op !== 'run') return;
  const out = new File([]);
  const err = new File([]);
  const wasi = new WASI([], [], [new OpenFile(new File(enc.encode(data.stdin ?? ''))), new OpenFile(out), new OpenFile(err), new PreopenDirectory('/', new Map())]);
  const { vm } = await RubyVM.instantiateModule({ module, wasip1: wasi }); // fresh interpreter per test
  const t = performance.now();
  let exit = 0;
  let error = null;
  try {
    vm.eval(code);
  } catch (e) {
    error = String(e?.message ?? e);
    exit = 1;
  }
  try { vm.eval('$stdout.flush; $stderr.flush'); } catch {}
  self.postMessage({ id: data.id, ok: exit === 0, exit, error, runMs: Math.round(performance.now() - t), stdout: cap(dec.decode(out.data)), stderr: cap(dec.decode(err.data)) });
};
