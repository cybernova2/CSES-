// Builds the unpacked extension into dist/.
//   node scripts/build.mjs          production build (minified)
//   node scripts/build.mjs --watch  rebuild on change
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('manifest.json', `${out}/manifest.json`);
await cp('public', out, { recursive: true });

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome110',
  logLevel: 'info',
  legalComments: 'none',
};

const builds = [
  // Content scripts must be classic scripts (no ES module imports).
  {
    ...common,
    entryPoints: { 'content/early': 'src/content/early.ts', 'content/main': 'src/content/main.ts' },
    outdir: out,
    format: 'iife',
  },
  { ...common, entryPoints: { 'content/csesplus': 'src/styles/csesplus.css' }, outdir: out },
  // Monaco runs in an extension-page iframe so it gets its own origin, CSP and workers.
  {
    ...common,
    entryPoints: { 'editor/editor': 'src/editor/editor.ts' },
    outdir: out,
    format: 'iife',
    loader: { '.ttf': 'file' },
    assetNames: 'editor/[name]-[hash]',
  },
  {
    ...common,
    entryPoints: { 'editor/editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js' },
    outdir: out,
    format: 'iife',
  },
];

// ---- Local Run: language workers (ES modules) + runtimes packaged as files next to them.
builds.push({
  ...common,
  entryPoints: ['src/run/workers/cpp.js', 'src/run/workers/python.js', 'src/run/workers/ruby.js', 'src/run/workers/js.js'],
  outdir: `${out}/editor/workers`,
  format: 'esm',
  platform: 'browser',
  loader: { '.h': 'text' },
  external: ['../vendor/*'],
});
await mkdir(`${out}/editor/vendor/pyodide`, { recursive: true });
await mkdir(`${out}/editor/vendor/ruby`, { recursive: true });
await cp('node_modules/@yowasp/clang/gen', `${out}/editor/vendor/clang`, { recursive: true });
for (const f of ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await cp(`node_modules/pyodide/${f}`, `${out}/editor/vendor/pyodide/${f}`);
}
await cp('node_modules/@ruby/3.2-wasm-wasi/dist/ruby+stdlib.wasm', `${out}/editor/vendor/ruby/ruby+stdlib.wasm`);

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log('Watching for changes…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
