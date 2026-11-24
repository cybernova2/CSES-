// Local Run engine. Lives in the editor iframe (extension origin) and runs each language in its own module
// Web Worker. A worker that exceeds a time limit is terminated and replaced: that is the only reliable way to
// stop runaway code. Runtimes are packaged with the extension; nothing is downloaded and code never leaves
// the browser.

export type Engine = 'cpp' | 'python' | 'ruby' | 'js';

export interface RunRequest {
  langId: string; // CSES+ language id (cpp, c, python, ruby, node, ...)
  option?: string | null; // e.g. c++20, pypy
  code: string;
  inputs: string[];
}

export interface CaseResult {
  status: 'ok' | 'error' | 'timeout' | 'skipped';
  exit?: number;
  stdout?: string;
  stderr?: string;
  error?: string | null;
  runMs?: number;
}

export interface RunReport {
  supported: boolean;
  note?: string; // shown above results (e.g. engine differences)
  compiled: boolean;
  compileMs?: number;
  diagnostics?: string;
  cases: CaseResult[];
}

const COMPILE_TIMEOUT_MS = 120_000; // first C++ run builds the precompiled header
const RUN_TIMEOUT_MS = 5_000; // local limit per test (CSES limits are usually 1 s on faster hardware)

interface Target {
  engine: Engine;
  lang?: 'c' | 'cpp';
  std?: string;
  note?: string;
}

export function targetFor(langId: string, option?: string | null): Target | null {
  switch (langId) {
    case 'cpp':
      return { engine: 'cpp', lang: 'cpp', std: option && /^c\+\+(11|17|20|23)$/.test(option) ? option : 'c++20', note: 'Local run uses Clang + libc++ (CSES uses GCC). Exceptions are unavailable, long is 32-bit, and very deep recursion can overflow.' };
    case 'c':
      return { engine: 'cpp', lang: 'c', std: 'c99', note: 'Local run uses Clang (CSES uses GCC); long is 32-bit.' };
    case 'python':
      return { engine: 'python', note: option === 'pypy' ? 'PyPy is not available locally; running with CPython 3.12 (slower than PyPy).' : 'Local run uses CPython 3.12.' };
    case 'ruby':
      return { engine: 'ruby', note: 'Local run uses Ruby 3.2.' };
    case 'node':
      return { engine: 'js', note: 'Local run uses QuickJS with a Node.js shim (fs.readFileSync(0), readline, process.stdin, console). Other Node modules are unavailable.' };
    default:
      return null;
  }
}

class Worker_ {
  private worker: Worker;
  readonly ready: Promise<void>;
  private seq = 0;
  constructor(engine: Engine, onStatus: (s: string) => void) {
    this.worker = new Worker(chrome.runtime.getURL(`editor/workers/${engine}.js`), { type: 'module', name: `csesplus-${engine}` });
    this.worker.addEventListener('message', (e) => e.data?.type === 'status' && onStatus(e.data.text));
    this.ready = new Promise((resolve, reject) => {
      this.worker.addEventListener('message', (e) => {
        if (e.data?.type === 'ready') resolve();
        else if (e.data?.type === 'init-error') reject(new Error(e.data.message));
      });
      this.worker.addEventListener('error', (e) => reject(new Error(e.message || 'Runtime failed to load')));
    });
  }
  call<T>(msg: Record<string, unknown>, timeoutMs: number): Promise<T | 'timeout'> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.worker.removeEventListener('message', onMsg);
        resolve('timeout');
      }, timeoutMs);
      const onMsg = (e: MessageEvent) => {
        if (e.data?.id !== id) return;
        clearTimeout(timer);
        this.worker.removeEventListener('message', onMsg);
        resolve(e.data as T);
      };
      this.worker.addEventListener('message', onMsg);
      this.worker.postMessage({ id, ...msg });
    });
  }
  terminate(): void {
    this.worker.terminate();
  }
}

const workers = new Map<Engine, Worker_>();
const getWorker = (engine: Engine, onStatus: (s: string) => void) => {
  let w = workers.get(engine);
  if (!w) {
    w = new Worker_(engine, onStatus);
    workers.set(engine, w);
  }
  return w;
};
const drop = (engine: Engine) => {
  workers.get(engine)?.terminate();
  workers.delete(engine);
};

export async function runLocal(req: RunRequest, onStatus: (s: string) => void): Promise<RunReport> {
  const target = targetFor(req.langId, req.option);
  if (!target) return { supported: false, compiled: false, cases: [] };

  const w = getWorker(target.engine, onStatus);
  try {
    await w.ready;
  } catch (e) {
    drop(target.engine);
    return { supported: true, note: target.note, compiled: false, diagnostics: `The ${target.engine} runtime failed to load: ${(e as Error).message}`, cases: [] };
  }

  const c = await w.call<{ ok: boolean; compileMs: number; diagnostics: string }>({ op: 'compile', code: req.code, lang: target.lang, std: target.std }, COMPILE_TIMEOUT_MS);
  if (c === 'timeout') {
    drop(target.engine);
    return { supported: true, note: target.note, compiled: false, diagnostics: 'Compilation took too long and was stopped.', cases: [] };
  }
  if (!c.ok) return { supported: true, note: target.note, compiled: false, compileMs: c.compileMs, diagnostics: c.diagnostics, cases: [] };

  const cases: CaseResult[] = [];
  for (let i = 0; i < req.inputs.length; i++) {
    onStatus(`Running test ${i + 1} of ${req.inputs.length}…`);
    const r = await w.call<CaseResult & { ok: boolean }>({ op: 'run', stdin: req.inputs[i], timeLimitMs: RUN_TIMEOUT_MS }, RUN_TIMEOUT_MS + 1000);
    if (r === 'timeout') {
      drop(target.engine); // the compiled program is gone with the worker
      cases.push({ status: 'timeout', error: `Time limit exceeded (${RUN_TIMEOUT_MS / 1000} s local limit).` });
      for (let j = i + 1; j < req.inputs.length; j++) cases.push({ status: 'skipped' });
      break;
    }
    cases.push({ ...r, status: r.ok ? 'ok' : r.error && /Time limit exceeded/.test(r.error) ? 'timeout' : 'error' });
  }
  return { supported: true, note: target.note, compiled: true, compileMs: c.compileMs, diagnostics: c.diagnostics, cases };
}
