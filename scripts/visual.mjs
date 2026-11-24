// Screenshots for visual review. Logged-in pages are simulated from scrubbed fixtures (nothing is sent to CSES
// for them); everything else is live and logged out.   CHROME_PATH=... node scripts/visual.mjs <dir>
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const dir = process.argv[2];
const ext = resolve('dist');
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
  protocolTimeout: 300000,
});
const fx = (n) => readFileSync(`tests/fixtures/${n}`, 'utf8');
const loggedIn = (html) => html.replace('<a class="account" href="/login">Login</a>', '<a class="account" href="/user/0">tester</a> <a href="/logout" title="Log out">Log out</a>');

// Logged-in list: mark a few problems solved / attempted like CSES does.
let list = loggedIn(fx('list.html'));
for (const id of ['1068', '1083', '1069', '1094', '1092']) list = list.replace(`task/${id}">`, `task/${id}" data-s="1">`).replace(new RegExp(`(task/${id}" data-s="1">[^<]+</a><span class="detail">[^<]+</span> <span class="task-score icon )`), '$1full');
list = list.replace(/(task\/1072">[^<]+<\/a><span class="detail">[^<]+<\/span> <span class="task-score icon )/, '$1zero');
// Solved task page with CSES's full logged-in tab bar.
const tabs = '<ul class="nav">\n<li><a href="/problemset/task/1068/" class="current">Task</a></li>\n<li><a href="/problemset/submit/1068/">Submit</a></li>\n<li><a href="/problemset/view/1068/">Results</a></li>\n<li><a href="/problemset/model/1068/">Analysis</a></li>\n<li><a href="/problemset/stats/1068/">Statistics</a></li>\n<li><a href="/problemset/tests/1068/">Tests</a></li>\n<li><a href="/problemset/queue/1068/1/">Queue</a></li>\n</ul>';
const task = loggedIn(fx('task1068.html')).replace(/<ul class="nav">[\s\S]*?<\/ul>/, tabs).replace('<a class="current" href="/problemset/task/1068">Weird Algorithm<span class="task-score icon ">', '<a class="current" href="/problemset/task/1068">Weird Algorithm<span class="task-score icon full">');

const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (u === 'https://cses.fi/problemset/list/') return req.respond({ status: 200, contentType: 'text/html', body: list });
  if (u === 'https://cses.fi/problemset/task/1068') return req.respond({ status: 200, contentType: 'text/html', body: task });
  return req.continue();
});
const shot = (n) => page.screenshot({ path: `${dir}/${n}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('https://cses.fi/problemset/list/', { waitUntil: 'networkidle2' });
await page.waitForSelector('.cp-row');
await shot('v-list-loggedin');
const align = await page.evaluate(() => {
  const th = document.querySelector('.cp-th-stats').getBoundingClientRect();
  const td = document.querySelector('.cp-row .cp-stats').getBoundingClientRect();
  return { headerRight: Math.round(th.right), cellRight: Math.round(td.right) };
});
console.log('stats column alignment', align, Math.abs(align.headerRight - align.cellRight) <= 2 ? 'ALIGNED' : 'MISALIGNED');

await page.goto('https://cses.fi/problemset/task/1068', { waitUntil: 'networkidle2' });
await page.waitForSelector('.cp-workspace');
await sleep(3000);
// Make the statement pane narrow so the tabs overflow, as when the editor is widened.
await page.evaluate(() => { document.querySelector('.cp-split').style.gridTemplateColumns = 'minmax(0, 0.28fr) 12px minmax(0, 0.72fr)'; });
await sleep(400);
const tabsInfo = await page.evaluate(() => {
  const l = document.querySelector('.cp-statement .cp-tabs');
  return { overflow: l.scrollWidth > l.clientWidth, rightArrow: !document.querySelector('.cp-statement .cp-tabs-arrow.is-right').hidden, tabs: [...l.children].map((t) => t.textContent) };
});
console.log('workspace tabs', JSON.stringify(tabsInfo));
await shot('v-task-tabs-narrow');
await page.click('.cp-statement .cp-tabs-arrow.is-right');
await sleep(600);
await shot('v-task-tabs-scrolled');
await page.evaluate(() => { document.querySelector('.cp-split').style.gridTemplateColumns = ''; });

// Wrong output (prints only the first two numbers) to see the red styling, then a correct solution.
const setCode = async (code) => {
  await page.evaluate((c) => document.querySelector('.cp-editor-frame').contentWindow.postMessage({ type: 'setCode', code: c }, '*'), code);
  await sleep(700);
};
const run = async () => {
  await page.click('.cp-run');
  await page.waitForFunction(() => !document.querySelector('.cp-run').disabled, { timeout: 240000, polling: 300 });
};
await setCode('#include <cstdio>\nint main(){ long long n; scanf("%lld",&n); printf("%lld 10 5 16 8 4 2 2\\n", n); }\n');
await run();
await shot('v-run-wrong');
await setCode('#include <cstdio>\nint main(){ long long n; scanf("%lld",&n); while(1){ printf("%lld ", n); if(n==1) break; n = n%2 ? 3*n+1 : n/2; } puts(""); }\n');
await run();
await shot('v-run-pass');

for (const [u, n] of [['https://cses.fi/', 'v-home'], ['https://cses.fi/dt/list/', 'v-course-list']]) {
  await page.goto(u, { waitUntil: 'networkidle2' });
  const ok = await page.waitForSelector('.cp-page', { timeout: 8000 }).then(() => true).catch(() => false);
  console.log(n, ok ? 'rendered in CSES+ shell' : 'NOT RENDERED');
  await shot(n);
}
await browser.close();
