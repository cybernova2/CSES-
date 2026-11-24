// End-to-end test of local Run inside CSES+ on the live (logged-out) Weird Algorithm page.
//   CHROME_PATH=... node scripts/smoke-run.mjs [screenshot-dir]
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const shots = process.argv[2];
const ext = resolve('dist');
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
  protocolTimeout: 300000,
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const page = await browser.newPage();
await page.goto('https://cses.fi/problemset/task/1068', { waitUntil: 'networkidle2' });
await page.waitForSelector('.cp-workspace');
await new Promise((r) => setTimeout(r, 3000)); // Monaco boot

const setLang = async (id) => {
  await page.evaluate((v) => { const s = document.querySelector('.cp-editor-toolbar select'); s.value = v; s.dispatchEvent(new Event('change')); }, id);
  await new Promise((r) => setTimeout(r, 1200)); // the switch loads that language's draft/template asynchronously
};
const setCode = async (code) => {
  await page.evaluate((c) => document.querySelector('.cp-editor-frame').contentWindow.postMessage({ type: 'setCode', code: c }, '*'), code);
  await new Promise((r) => setTimeout(r, 700)); // editor reports the change (debounced 400 ms)
};
const run = async (timeout = 180000) => {
  const t = Date.now();
  await page.click('.cp-run');
  await page.waitForFunction(() => !document.querySelector('.cp-run').disabled, { timeout, polling: 200 });
  const status = await page.$eval('.cp-run-status', (s) => `${s.classList.contains('is-pass') ? '[PASS] ' : s.classList.contains('is-fail') ? '[FAIL] ' : ''}${s.textContent}`);
  const out = await page.$$eval('.cp-your-output pre', (p) => p.map((x) => x.textContent).join('\n'));
  const banner = await page.$eval('.cp-run-banner', (b) => (b.hidden ? '' : b.textContent));
  return { status, out, banner, secs: ((Date.now() - t) / 1000).toFixed(1) };
};

const solutions = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ long long n; cin >> n; while (true) { cout << n << " "; if (n == 1) break; n = n % 2 ? 3*n+1 : n/2; } cout << "\\n"; }\n',
  c: '#include <stdio.h>\nint main(void){ long long n; scanf("%lld", &n); while (1) { printf("%lld ", n); if (n == 1) break; n = n % 2 ? 3*n+1 : n/2; } printf("\\n"); return 0; }\n',
  python: 'n = int(input())\nout = []\nwhile True:\n    out.append(n)\n    if n == 1:\n        break\n    n = 3*n+1 if n % 2 else n//2\nprint(*out)\n',
  ruby: 'n = gets.to_i\na = []\nloop do\n  a << n\n  break if n == 1\n  n = n.odd? ? 3*n+1 : n/2\nend\nputs a.join(" ")\n',
  node: "let n = Number(require('fs').readFileSync(0, 'utf8').trim());\nconst out = [];\nwhile (true) { out.push(n); if (n === 1) break; n = n % 2 ? 3*n+1 : n/2; }\nconsole.log(out.join(' '));\n",
};

for (const [lang, code] of Object.entries(solutions)) {
  await setLang(lang);
  await setCode(code);
  const r = await run();
  check(`${lang}: Weird Algorithm passes the example`, /^\[PASS\] Example passed/.test(r.status), `${r.status} | ${r.secs} s | out=${JSON.stringify(r.out.slice(0, 300))}`);
  if (shots && lang === 'cpp') await page.screenshot({ path: `${shots}/run-cpp-pass.png` });
}

// second C++ run should reuse the cached precompiled header
await setLang('cpp');
await setCode(solutions.cpp);
let r = await run();
check('cpp: second run is fast (cached bits/stdc++.h)', /^\[PASS\]/.test(r.status) && Number(r.secs) < 10, `${r.secs} s`);

await setCode(solutions.cpp.replace('3*n+1', '3*n+2'));
r = await run();
check('cpp: wrong answer is shown as failed (red)', /^\[FAIL\] 0\/1 examples passed/.test(r.status), r.status);
if (shots) await page.screenshot({ path: `${shots}/run-cpp-wrong.png` });

await setCode('#include <bits/stdc++.h>\nint main(){ return x; }\n');
r = await run();
check('cpp: compile error is shown', /Compilation failed/.test(r.status) && /undeclared identifier 'x'/.test(r.banner), r.status);
if (shots) await page.screenshot({ path: `${shots}/run-cpp-compile-error.png` });

await setCode('int main(){ volatile int x = 0; for(;;) x++; }\n');
r = await run(60000);
check('cpp: infinite loop stops at the local time limit', /Time limit/.test(r.out + r.status), `${r.status} | ${r.secs} s | ${r.out.slice(0, 80)}`);

await setLang('python');
await setCode('print(int(input()) * 2)\n');
await page.click('.cp-pill-add');
await page.type('.cp-custom-input', '21\n');
r = await run();
// After a run the panel jumps to the first failing case (the example, here); open the custom case.
await page.evaluate(() => [...document.querySelectorAll('.cp-sample-picker .cp-pill')].find((b) => /Custom/.test(b.textContent)).click());
const customOut = await page.$$eval('.cp-your-output pre', (p) => p.map((x) => x.textContent).join('\n'));
check('python: custom input runs', /^42\s*$/.test(customOut), JSON.stringify(customOut.slice(0, 40)));
if (shots) await page.screenshot({ path: `${shots}/run-python-custom.png` });

// Results must come into view even if the bottom panel was dragged down to its header.
await setLang('cpp');
await setCode('#include <cstdio>\nint main(){ puts("3 10 5 16 8 4 2 1"); }\n');
const handle = await (await page.$('.cp-hresizer')).boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + 6);
await page.mouse.down();
await page.mouse.move(handle.x + handle.width / 2, 2000, { steps: 6 });
await page.mouse.up();
const collapsed = await page.$eval('.cp-dock', (d) => Math.round(d.getBoundingClientRect().height));
r = await run();
const shown = await page.evaluate(() => {
  const dock = document.querySelector('.cp-dock').getBoundingClientRect();
  const status = document.querySelector('.cp-run-status').getBoundingClientRect();
  const out = document.querySelector('.cp-out-box').getBoundingClientRect();
  return { dock: Math.round(dock.height), statusVisible: status.top >= dock.top && status.bottom <= dock.bottom, outputVisible: out.top < dock.bottom - 40 };
});
check('run reveals results when the panel was dragged down', collapsed <= 50 && shown.dock >= 280 && shown.statusVisible && shown.outputVisible, `panel ${collapsed}px -> ${shown.dock}px`);
if (shots) await page.screenshot({ path: `${shots}/run-revealed.png` });

await setLang('java');
const selected = await page.$eval('.cp-editor-toolbar select', (s) => s.value);
await page.click('.cp-run');
await new Promise((res) => setTimeout(res, 800));
const javaMsg = `${await page.$eval('.cp-run-status', (s) => s.textContent)} [select=${selected}]`;
check('java: explains local run is unavailable', /isn't available for Java/.test(javaMsg), javaMsg);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);

