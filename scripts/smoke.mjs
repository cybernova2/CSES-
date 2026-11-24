// End-to-end smoke test: the built extension in Chrome for Testing against live, logged-out cses.fi,
// plus logged-in pages served from tests/fixtures (scrubbed copies of real CSES pages).
//   npx @puppeteer/browsers install chrome@stable
//   CHROME_PATH=<path to chrome> node scripts/smoke.mjs [screenshot-dir]
// Live requests are ordinary page loads. Nothing is ever submitted to CSES.
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const chrome = process.env.CHROME_PATH;
if (!chrome) throw new Error('Set CHROME_PATH to a Chrome for Testing binary.');
const shots = process.argv[2];
const ext = resolve('dist');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fixture = (name) => readFileSync(`tests/fixtures/${name}`, 'utf8');
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // cses.fi itself has no /favicon.ico; that 404 is not ours.
  page.on('console', (m) => m.type() === 'error' && !/favicon\.ico/.test(m.location()?.url ?? '') && errors.push(`${m.text()} ${m.location()?.url ?? ''}`));

  // ---------------- Problem Set (live)
  await page.goto('https://cses.fi/problemset/list/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#csesplus-app', { timeout: 10000 });
  const list = await page.evaluate(() => ({
    rows: document.querySelectorAll('.cp-row').length,
    sections: document.querySelectorAll('.cp-list > .cp-card').length,
    originalHidden: getComputedStyle(document.querySelector('.skeleton')).display === 'none',
    statsHeader: document.querySelector('.cp-th-stats')?.textContent,
    statusColumn: !!document.querySelector('.cp-cell-status'),
  }));
  check('list renders all 400 problems', list.rows === 400, `${list.rows} rows`);
  check('list renders 18 categories', list.sections === 18);
  check('original list is hidden', list.originalHidden);
  check('stats column uses neutral label', list.statsHeader === 'CSES stats');
  check('no status column when logged out', !list.statusColumn);
  await shot(page, 'list-light');

  await page.type('.cp-search input', 'two');
  const visible = await page.$$eval('.cp-row', (rs) => rs.filter((r) => !r.hidden).map((r) => r.querySelector('.cp-title').textContent));
  check('search filters by name', visible.length > 0 && visible.every((t) => /two/i.test(t)), `${visible.length} matches`);
  await page.click('.cp-search input', { clickCount: 3 });
  await page.keyboard.press('Backspace');

  await page.click('.cp-row .cp-bm');
  await page.evaluate(() => (location.hash = '#bookmarks'));
  await page.waitForSelector('.cp-bm-row', { timeout: 5000 });
  const bm = await page.$$eval('.cp-bm-row .cp-bm-title', (a) => a.map((x) => x.textContent));
  check('bookmark appears on Bookmarks view', bm.length === 1 && bm[0] === 'Weird Algorithm', bm.join(', '));
  await shot(page, 'bookmarks-light');

  // ---------------- Workspace (live)
  await page.goto('https://cses.fi/problemset/task/1092', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.cp-workspace', { timeout: 10000 });
  await sleep(2500); // Monaco boot
  const ws = await page.evaluate(() => ({
    title: document.querySelector('.cp-task-title')?.textContent,
    movedStatement: !!document.querySelector('.cp-statement-body > .md'),
    katex: document.querySelectorAll('.cp-statement-body .katex').length,
    pairs: document.querySelectorAll('.cp-sample-pair').length,
    pager: document.querySelector('.cp-pager-pos')?.textContent,
    submitIsLogin: document.querySelector('.cp-dock-head a.cp-btn-primary')?.getAttribute('href'),
    tabs: Array.from(document.querySelectorAll('.cp-statement .cp-tabs .cp-tab')).map((t) => t.textContent),
  }));
  check('workspace shows the task', ws.title === 'Two Sets');
  check('original statement moved into the panel', ws.movedStatement);
  check('KaTeX math still rendered', ws.katex > 0, `${ws.katex} formulas`);
  check('examples paired side by side', ws.pairs === 2);
  check('prev/next position from cached list', ws.pager === '8 / 24', ws.pager);
  check('submit asks to log in when logged out', ws.submitIsLogin === '/login');
  check('CSES tabs shown in workspace', ws.tabs.includes('Statistics'), ws.tabs.join(' | '));

  // Local Run itself is covered by scripts/smoke-run.mjs.
  check('Run button is enabled', await page.$eval('.cp-run', (b) => !b.disabled));

  // Vertical resize: drag the handle between editor and bottom panel upward.
  const heights = () => page.evaluate(() => ({
    editor: Math.round(document.querySelector('.cp-editor-card').getBoundingClientRect().height),
    dock: Math.round(document.querySelector('.cp-dock').getBoundingClientRect().height),
    statement: getComputedStyle(document.querySelector('.cp-statement')).display,
  }));
  const before = await heights();
  const handle = await (await page.$('.cp-hresizer')).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 150, { steps: 8 });
  await page.mouse.up();
  const dragged = await heights();
  check('editor/panel split resizes vertically', dragged.dock > before.dock + 100 && dragged.editor < before.editor - 100, `dock ${before.dock}→${dragged.dock}px`);
  await page.click('.cp-editor-toolbar button[aria-label="Expand editor"]');
  const expanded = await heights();
  check('expand grows editor in both directions', expanded.statement === 'none' && expanded.dock <= 50 && expanded.editor > before.editor, `editor ${expanded.editor}px, panel ${expanded.dock}px`);
  await shot(page, 'workspace-expanded');
  await page.keyboard.press('Escape');
  const restored = await heights();
  check('Esc restores layout', restored.statement !== 'none' && Math.abs(restored.dock - dragged.dock) < 4, `panel ${restored.dock}px`);

  const editorFrame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));
  const editorText = editorFrame ? await editorFrame.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.textContent ?? '') : '';
  check('Monaco editor loaded with the C++ template', editorText.includes('#include'));
  await shot(page, 'workspace-light');

  // ---------------- Theme follows CSES's own setting (live)
  await page.click('.cp-topbar button[aria-label^="Switch to"]');
  await page.waitForFunction(() => document.documentElement.dataset.csesplusTheme === 'dark', { timeout: 5000 }).catch(() => {});
  const theme = await page.evaluate(() => ({ ours: document.documentElement.dataset.csesplusTheme, cses: document.getElementById('darkmode-enabled')?.textContent }));
  check('theme toggle switches CSES dark mode', theme.ours === 'dark' && theme.cses === 'true', JSON.stringify(theme));
  await sleep(800);
  await shot(page, 'workspace-dark');

  await page.goto('https://cses.fi/problemset/list/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#csesplus-app');
  check('dark mode persists through CSES on reload', (await page.evaluate(() => document.documentElement.dataset.csesplusTheme)) === 'dark');
  await shot(page, 'list-dark');

  // ---------------- Other CSES pages in the shared shell (live, logged out)
  for (const [url, name, expectText] of [
    ['https://cses.fi/problemset/stats/1068/', 'stats', /login/i],
    ['https://cses.fi/problemset/text/2433', 'text', /CSES Problem Set/],
    ['https://cses.fi/user/1/', 'profile', /Submission count/],
    ['https://cses.fi/login', 'login', /Username/],
  ]) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    const ok = await page.waitForSelector('.cp-page .cp-generic', { timeout: 8000 }).then(() => true).catch(() => false);
    const body = ok ? await page.$eval('.cp-generic', (g) => g.textContent) : '';
    check(`${name} page rendered in CSES+ shell`, ok && expectText.test(body));
    await shot(page, `${name}-dark`);
  }

  // restore the CSES session theme
  await page.goto('https://cses.fi/problemset/list/', { waitUntil: 'networkidle2' });
  await page.click('.cp-theme-seg button:first-child');
  await sleep(800);
  check('no page errors on live pages', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---------------- Logged-in pages, served from scrubbed fixtures (nothing is sent to cses.fi for these)
  const sim = await browser.newPage();
  await sim.setRequestInterception(true);
  let posted = false;
  const loggedInTask = fixture('task1068.html').replace(
    '<a class="account" href="/login">Login</a>',
    '<a class="account" href="/user/0">tester</a> <a href="/logout" title="Log out">Log out</a>',
  );
  // Real CSES submit page + a recorder for what the form would send (puppeteer cannot read multipart file bodies).
  const submitPage = fixture('submit1068.html').replace(
    '</body>',
    `<script>
      document.querySelector('form').addEventListener('submit', (e) => {
        const fd = new FormData(e.target, e.submitter);
        const f = fd.get('file');
        e.preventDefault();
        f.text().then((text) => {
          localStorage.setItem('captured', JSON.stringify({ lang: fd.get('lang'), option: fd.get('option'), csrf: fd.get('csrf_token'), task: fd.get('task'), name: f.name, text }));
          e.target.submit();
        });
      });
    </script></body>`,
  );
  const routes = {
    'https://cses.fi/problemset/task/1068': loggedInTask,
    'https://cses.fi/problemset/submit/1068/': submitPage,
    'https://cses.fi/problemset/view/1635/': fixture('view1635.html'),
  };
  sim.on('request', (req) => {
    const url = req.url();
    if (routes[url]) return req.respond({ status: 200, contentType: 'text/html', body: routes[url] });
    if (url === 'https://cses.fi/course/send.php') {
      posted = true;
      return req.respond({ status: 200, contentType: 'text/html', body: '<p>received</p>' });
    }
    // Never let a simulated page reach real CSES pages or endpoints.
    if (/^https:\/\/cses\.fi\/(problemset|course|user|logout)/.test(url)) return req.abort();
    return req.continue();
  });

  await sim.goto('https://cses.fi/problemset/view/1635/', { waitUntil: 'networkidle2' });
  await sim.waitForSelector('.cp-page .cp-generic', { timeout: 8000 });
  const view = await sim.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('.cp-ctab')).map((a) => a.textContent),
    current: document.querySelector('.cp-ctab.is-current')?.textContent,
    rows: document.querySelectorAll('.cp-generic tbody tr').length,
    sideSolved: document.querySelectorAll('.cp-side .task-score.full').length,
    profile: document.querySelector('.cp-topbar a.cp-account')?.getAttribute('href'),
    logout: !!document.querySelector('.cp-topbar a[aria-label="Log out of CSES"]'),
  }));
  check('Results page in shell with all CSES tabs', view.tabs.length === 7 && view.current === 'Results', view.tabs.join(' | '));
  check('Results table kept (7 submissions)', view.rows === 7);
  check('solved icons shown in sidebar', view.sideSolved > 0, `${view.sideSolved}`);
  check('profile link in top bar', view.profile === 'https://cses.fi/user/0', view.profile);
  check('log-out link in top bar', view.logout);
  await shot(sim, 'results-light');

  await sim.goto('https://cses.fi/problemset/task/1068', { waitUntil: 'networkidle2' });
  await sim.waitForSelector('.cp-dock-head button.cp-btn-primary', { timeout: 10000 });
  await sleep(2500);
  // One click submits: no extra confirmation dialog.
  await Promise.all([sim.waitForNavigation({ waitUntil: 'load' }), sim.click('.cp-dock-head button.cp-btn-primary')]);
  check('submit goes straight to CSES (no extra dialog)', true);
  for (let i = 0; i < 60 && !posted; i++) await sleep(100);
  check('real CSES submit form was submitted', posted);
  const sent = JSON.parse((await sim.evaluate(() => localStorage.getItem('captured'))) ?? '{}');
  check('submitted file is the editor code', sent.name === 'solution.cpp' && (sent.text ?? '').includes('#include <bits/stdc++.h>'), sent.name);
  check('submitted language and version', sent.lang === 'C++' && sent.option === 'C++20', `${sent.lang} / ${sent.option}`);
  check("submitted with the page's own CSRF token and task", sent.csrf === 'test-token' && sent.task === '1068');

  await sim.evaluate(() => localStorage.removeItem('captured'));
  posted = false;
  await sim.goto('https://cses.fi/problemset/submit/1068/', { waitUntil: 'load' });
  await sleep(1200);
  check('reloading the submit page does not submit again', !posted && (await sim.evaluate(() => localStorage.getItem('captured'))) === null);
  const submitShell = await sim.evaluate(() => !!document.querySelector('.cp-page .cp-generic form'));
  check('Submit page rendered in CSES+ shell', submitShell);
  await shot(sim, 'submit-light');
  await sim.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
