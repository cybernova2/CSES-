// Split-screen problem workspace. The original statement nodes are moved (not copied) into the left
// panel, so CSES's KaTeX rendering and markup stay intact. Submission goes through CSES's own form.
import { fmt, h, isTypingTarget } from '../core/dom';
import { icon } from '../core/icons';
import { findLang, LANGS, type Lang } from '../core/languages';
import { parseAuth, parseTabs, parseTask, type Status, type TaskPage } from '../core/parse';
import { LABELS, MAX_SOURCE_BYTES } from '../core/selectors';
import { store, type IndexedTask } from '../core/storage';
import { currentTheme, watchTheme } from '../core/theme';
import { confirmDialog } from './dialog';
import { targetFor, type CaseResult, type RunReport } from '../run/runner';
import { copyButton, topbar } from './shell';

interface NavTarget {
  id: string;
  title: string;
}

export async function runTask(): Promise<boolean> {
  const parsed = parseTask(document, location.pathname);
  if (!parsed || !parsed.statement) return false;
  const task: TaskPage = parsed;
  const statement = parsed.statement;

  const auth = parseAuth(document);
  const [index, settings, bookmarks] = await Promise.all([store.taskIndex(), store.settings(), store.bookmarks()]);
  const indexed = index?.tasks.find((t) => t.id === task.id) ?? null;
  const category = task.category ?? indexed?.category ?? '';
  const nav = neighbours(task, index?.tasks ?? null);

  let lang: Lang = findLang(settings.lang) ?? LANGS[0];
  let option: string | undefined = settings.options[lang.id] ?? lang.defaultOption;
  let code = (await store.draft(task.id, lang.id)) ?? lang.template;

  // ---------------- console
  const consoleList = h('div', { class: 'cp-console', role: 'log', 'aria-live': 'polite' });
  const log = (msg: string, kind: 'info' | 'warn' | 'ok' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    consoleList.append(h('div', { class: `cp-console-line is-${kind}` }, h('span', { class: 'cp-console-time' }, time), h('span', {}, msg)));
    consoleList.scrollTop = consoleList.scrollHeight;
  };

  // ---------------- top bar
  let isBookmarked = !!bookmarks[task.id];
  const bmBtn = h('button', { type: 'button', class: 'cp-iconbtn cp-iconbtn-bordered cp-bm' }, icon('bookmark', 16));
  const syncBm = () => {
    const label = isBookmarked ? 'Remove bookmark' : 'Bookmark this problem';
    bmBtn.classList.toggle('is-on', isBookmarked);
    bmBtn.setAttribute('aria-pressed', String(isBookmarked));
    bmBtn.setAttribute('aria-label', label);
    bmBtn.title = label;
  };
  syncBm();
  bmBtn.addEventListener('click', async () => {
    isBookmarked = await store.toggleBookmark({ id: task.id, title: task.title, category });
    syncBm();
    log(isBookmarked ? 'Bookmarked on this device.' : 'Bookmark removed.');
  });

  const bar = topbar(
    auth,
    [
      { label: 'Problem Set', href: '/problemset/list/' },
      ...(category ? [{ label: category, cls: 'cp-crumb-cat' }] : []),
      { label: task.title },
    ],
    [h('div', { class: 'cp-pager' }, navLink(nav.prev, 'prev'), nav.position ? h('span', { class: 'cp-pager-pos' }, nav.position) : null, navLink(nav.next, 'next')), bmBtn],
  );

  // ---------------- statement pane
  const chip = (t: string, mono = false, title?: string) => h('span', { class: `cp-chip${mono ? ' cp-mono' : ''}`, title }, t);
  const head = h(
    'div',
    { class: 'cp-task-head' },
    h('div', { class: 'cp-task-title-row' }, h('h1', { class: 'cp-task-title' }, task.title), statusChip(task.status)),
    h(
      'div',
      { class: 'cp-chips' },
      chip(`#${task.id}`, true),
      category ? chip(category) : null,
      task.timeLimit ? chip(`Time ${task.timeLimit}`, true) : null,
      task.memoryLimit ? chip(`Memory ${task.memoryLimit}`, true) : null,
      indexed && indexed.a != null && indexed.b != null ? chip(`${LABELS.stats} ${fmt(indexed.a)} / ${fmt(indexed.b)}`, true, LABELS.statsTitle) : null,
    ),
  );
  const statementBody = h('div', { class: 'cp-pane-body cp-statement-body', role: 'tabpanel' }, head);
  const submissionsBody = h('div', { class: 'cp-pane-body', role: 'tabpanel', hidden: true }, submissionsContent(task, auth.loggedIn));
  // CSES's own tabs (Results, Analysis, Statistics, Tests, Queue, ... as CSES offers them) become links
  // to those CSES pages, which CSES+ renders in the same shell. Task and Submit are handled here.
  const csesTabs = parseTabs(document).filter((t) => !/^(task|submit)$/i.test(t.label));
  if (!csesTabs.length) csesTabs.push({ label: 'Statistics', href: `/problemset/stats/${task.id}/`, current: false });
  const leftTabs = tabs(
    [
      ['Statement', statementBody],
      ['Your submissions', submissionsBody],
    ],
    csesTabs.map((t) => h('a', { class: 'cp-tab', href: t.href }, t.label)),
  );
  const statementPane = h('section', { class: 'cp-pane cp-statement', 'aria-label': 'Problem' }, leftTabs.bar, statementBody, submissionsBody);

  // ---------------- editor
  const frame = h('iframe', { class: 'cp-editor-frame', title: 'Code editor', src: chrome.runtime.getURL('editor/editor.html') });
  const extOrigin = new URL(frame.src).origin;
  let ready = false;
  let reqSeq = 0;
  const waiting = new Map<number, (code: string) => void>();
  const send = (msg: Record<string, unknown>) => frame.contentWindow?.postMessage(msg, extOrigin);

  const langSel = h('select', { class: 'cp-select', 'aria-label': 'Language' }, LANGS.map((l) => h('option', { value: l.id }, l.label)));
  langSel.value = lang.id;
  const optSel = h('select', { class: 'cp-select', 'aria-label': 'Language version' });
  const fillOptions = () => {
    optSel.replaceChildren(...(lang.options ?? []).map((o) => h('option', { value: o.id }, o.label)));
    optSel.hidden = !lang.options;
    if (option) optSel.value = option;
  };
  fillOptions();

  const draftNote = h('span', { class: 'cp-draft-note' }, h('span', { class: 'cp-dot', 'aria-hidden': 'true' }), 'Draft saved on this device');
  const cursorText = h('span', {}, 'Ln 1, Col 1');

  langSel.addEventListener('change', async () => {
    await store.saveDraft(task.id, lang.id, code);
    lang = findLang(langSel.value) ?? LANGS[0];
    option = settings.options[lang.id] ?? lang.defaultOption;
    fillOptions();
    code = (await store.draft(task.id, lang.id)) ?? lang.template;
    send({ type: 'setLanguage', language: lang.monaco, code });
    settings.lang = lang.id;
    await store.updateSettings({ lang: lang.id });
    log(`Language set to ${lang.label}.`);
  });
  optSel.addEventListener('change', async () => {
    option = optSel.value;
    settings.options = { ...settings.options, [lang.id]: option };
    await store.updateSettings({ options: settings.options });
  });

  const resetBtn = h('button', { type: 'button', class: 'cp-iconbtn', 'aria-label': 'Reset to template', title: 'Reset to template' }, icon('reset', 16));
  resetBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset the editor?',
      body: [h('p', {}, `This replaces your ${lang.label} code for this problem with the empty template. The current draft cannot be restored.`)],
      confirmLabel: 'Reset code',
    });
    if (!ok) return;
    code = lang.template;
    send({ type: 'setCode', code });
    await store.saveDraft(task.id, lang.id, code);
    log('Editor reset to the template.');
  });

  const app = h('div', { id: 'csesplus-app', class: 'cp-app cp-workspace' });
  app.dataset.mtab = 'statement';
  const expandBtn = h('button', { type: 'button', class: 'cp-iconbtn', 'aria-pressed': 'false' });
  const syncExpand = () => {
    const on = app.classList.contains('cp-expanded');
    expandBtn.replaceChildren(icon(on ? 'collapse' : 'expand', 16));
    expandBtn.setAttribute('aria-pressed', String(on));
    expandBtn.setAttribute('aria-label', on ? 'Show problem statement' : 'Expand editor');
    expandBtn.title = on ? 'Show problem statement (Esc)' : 'Expand editor';
  };
  syncExpand();
  expandBtn.addEventListener('click', () => toggleExpand());

  // Expand = editor takes the full width and the full height (bottom panel folds to its header).
  // Collapse restores both. The panel can still be dragged open while expanded.
  let dockBeforeExpand: number | null = null;
  function toggleExpand(on = !app.classList.contains('cp-expanded')): void {
    app.classList.toggle('cp-expanded', on);
    if (on) {
      dockBeforeExpand = dockHeight;
      setDock(DOCK_MIN, false);
    } else if (dockBeforeExpand !== null) {
      setDock(dockBeforeExpand, false);
      dockBeforeExpand = null;
    }
    syncExpand();
  }

  const editorCard = h(
    'section',
    { class: 'cp-editor-card', 'aria-label': 'Code editor' },
    h(
      'div',
      { class: 'cp-editor-toolbar' },
      langSel,
      optSel,
      draftNote,
      h('span', { class: 'cp-spacer' }),
      resetBtn,
      expandBtn,
    ),
    frame,
    h(
      'div',
      { class: 'cp-statusbar' },
      cursorText,
      h('span', {}, 'Spaces: 4'),
      h('span', { class: 'cp-spacer' }),
      h('span', {}, auth.loggedIn ? 'Ctrl+Enter to submit' : 'Log in to CSES to submit'),
    ),
  );

  // ---------------- dock
  // Run: compiles/interprets locally in the browser (runtimes packaged with the extension) and checks the
  // examples. It is labelled experimental and never claims to be CSES judging.
  const runLabel = h('span', {}, 'Run');
  const runBtn = h(
    'button',
    { type: 'button', class: 'cp-btn cp-btn-secondary cp-run', title: "Run on the examples locally in your browser (Ctrl+')", onClick: () => void startRun() },
    icon('play', 12),
    runLabel,
  );
  const tests = testCasesPanel(task);
  const submitBtn = auth.loggedIn
    ? h('button', { type: 'button', class: 'cp-btn cp-btn-primary', onClick: () => void startSubmit() }, icon('upload', 15), 'Submit to CSES')
    : h('a', { class: 'cp-btn cp-btn-primary', href: '/login' }, 'Log in to submit');

  const testsBody = h('div', { class: 'cp-dock-body', role: 'tabpanel' }, tests.el);
  const consoleBody = h('div', { class: 'cp-dock-body', role: 'tabpanel', hidden: true }, consoleList);
  const resultBody = h(
    'div',
    { class: 'cp-dock-body', role: 'tabpanel', hidden: true },
    h(
      'div',
      { class: 'cp-result' },
      h('p', {}, 'Submissions are judged by CSES. When you confirm, CSES+ opens the CSES submit page for this problem, attaches your code as a file and submits it with your CSES session. CSES then shows its own result page.'),
      auth.loggedIn
        ? h('button', { type: 'button', class: 'cp-btn cp-btn-secondary', onClick: () => leftTabs.select(1) }, 'View your submissions')
        : h('a', { class: 'cp-btn cp-btn-secondary', href: '/login' }, 'Log in to CSES'),
    ),
  );
  const dockTabs = tabs([
    ['Test cases', testsBody],
    ['Console', consoleBody],
    ['Result', resultBody],
  ]);
  const dock = h(
    'section',
    { class: 'cp-dock', 'aria-label': 'Test cases, console and result' },
    h('div', { class: 'cp-dock-head' }, dockTabs.bar, h('span', { class: 'cp-spacer' }), runBtn, submitBtn),
    testsBody,
    consoleBody,
    resultBody,
  );

  // ---------------- vertical resize: editor <-> test/console/result panel
  const DOCK_MIN = 48; // header only
  const hResizer = h(
    'div',
    { class: 'cp-hresizer', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize editor and test panel', title: 'Drag to resize · double-click to collapse', tabindex: '0' },
    h('span', {}),
  );
  const editorCol = h('div', { class: 'cp-editor-col' }, editorCard, hResizer, dock);
  let dockHeight = Math.max(DOCK_MIN, settings.dockHeight);
  let dockBeforeCollapse = dockHeight > DOCK_MIN ? dockHeight : 300;
  const maxDock = () => Math.max(DOCK_MIN, editorCol.getBoundingClientRect().height - 160);
  const applyDock = () => {
    dock.style.flexBasis = `${dockHeight}px`;
    dock.classList.toggle('is-collapsed', dockHeight <= DOCK_MIN);
  };
  const setDock = (px: number, save = true) => {
    dockHeight = Math.round(Math.min(maxDock(), Math.max(DOCK_MIN, px)));
    if (dockHeight > DOCK_MIN) dockBeforeCollapse = dockHeight;
    applyDock();
    if (save) void store.updateSettings({ dockHeight });
  };
  applyDock();
  hResizer.addEventListener('pointerdown', (e) => {
    hResizer.setPointerCapture(e.pointerId);
    app.classList.add('cp-dragging-v');
    const bottom = editorCol.getBoundingClientRect().bottom;
    const move = (ev: PointerEvent) => setDock(bottom - ev.clientY - 6, false);
    hResizer.addEventListener('pointermove', move);
    hResizer.addEventListener(
      'pointerup',
      () => {
        app.classList.remove('cp-dragging-v');
        hResizer.removeEventListener('pointermove', move);
        setDock(dockHeight);
      },
      { once: true },
    );
  });
  hResizer.addEventListener('dblclick', () => setDock(dockHeight > DOCK_MIN ? DOCK_MIN : dockBeforeCollapse));
  hResizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    setDock(dockHeight + (e.key === 'ArrowUp' ? 24 : -24));
  });
  window.addEventListener('resize', () => {
    if (dockHeight > maxDock()) setDock(dockHeight, false);
  });
  // Clicking a dock tab while collapsed opens the panel again.
  dock.querySelector('.cp-tabs')?.addEventListener('click', () => {
    if (dockHeight <= DOCK_MIN) setDock(dockBeforeCollapse);
  });

  // ---------------- resizable split
  const resizer = h('div', { class: 'cp-resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels', tabindex: '0' }, h('span', {}));
  const split = h('div', { class: 'cp-split' }, statementPane, resizer, editorCol);
  let ratio = Math.min(0.7, Math.max(0.25, settings.splitRatio));
  const applyRatio = () => {
    split.style.gridTemplateColumns = `minmax(0, ${ratio}fr) 12px minmax(0, ${1 - ratio}fr)`;
    resizer.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  };
  applyRatio();
  const saveRatio = () => void store.updateSettings({ splitRatio: ratio });
  resizer.addEventListener('pointerdown', (e) => {
    resizer.setPointerCapture(e.pointerId);
    app.classList.add('cp-dragging');
    const rect = split.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      ratio = Math.min(0.7, Math.max(0.25, (ev.clientX - rect.left) / rect.width));
      applyRatio();
    };
    const up = () => {
      app.classList.remove('cp-dragging');
      resizer.removeEventListener('pointermove', move);
      saveRatio();
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up, { once: true });
  });
  resizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    ratio = Math.min(0.7, Math.max(0.25, ratio + (e.key === 'ArrowLeft' ? -0.02 : 0.02)));
    applyRatio();
    saveRatio();
  });

  const mobileTabs = h(
    'div',
    { class: 'cp-mobile-tabs', role: 'group', 'aria-label': 'Panel' },
    (['statement', 'code'] as const).map((k) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(k === 'statement') }, k === 'statement' ? 'Statement' : 'Code');
      b.addEventListener('click', () => {
        app.dataset.mtab = k;
        mobileTabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      return b;
    }),
  );

  app.append(bar, mobileTabs, split);

  // ---------------- editor bridge (extension iframe <-> this page)
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || e.origin !== extOrigin) return;
    const m = e.data as { type?: string; code?: string; reqId?: number; line?: number; col?: number; text?: string; report?: RunReport };
    switch (m?.type) {
      case 'runStatus':
        if (m.reqId === runSeq) tests.setStatus(m.text ?? '');
        break;
      case 'runResult':
        if (m.reqId === runSeq) runDone?.(m.report!);
        break;
      case 'runShortcut':
        void startRun();
        break;
      case 'ready':
        ready = true;
        send({ type: 'init', code, language: lang.monaco, theme: currentTheme() });
        break;
      case 'change':
        code = m.code ?? '';
        void store.saveDraft(task.id, lang.id, code);
        break;
      case 'code':
        waiting.get(m.reqId ?? -1)?.(m.code ?? '');
        waiting.delete(m.reqId ?? -1);
        break;
      case 'cursor':
        cursorText.textContent = `Ln ${m.line}, Col ${m.col}`;
        break;
      case 'submitShortcut':
        if (auth.loggedIn) void startSubmit();
        break;
    }
  });
  const latestCode = () =>
    ready
      ? new Promise<string>((resolve) => {
          const id = ++reqSeq;
          waiting.set(id, resolve);
          send({ type: 'getCode', reqId: id });
          setTimeout(() => {
            if (waiting.delete(id)) resolve(code);
          }, 1000);
        })
      : Promise.resolve(code);

  // ---------------- local run
  // Make the Test cases panel visible and readable: open it to a comfortable height if it was dragged
  // down or collapsed, and scroll it back to the top so the verdict and output are in view.
  const RESULTS_MIN = 300;
  function revealResults(): void {
    dockTabs.select(0);
    const want = Math.min(Math.max(RESULTS_MIN, dockBeforeCollapse), maxDock());
    if (dockHeight < Math.min(RESULTS_MIN, maxDock())) setDock(want, false);
    testsBody.scrollTop = 0;
  }
  let runSeq = 0;
  let runDone: ((r: RunReport) => void) | null = null;
  let running = false;
  async function startRun(): Promise<void> {
    if (running) return;
    revealResults();
    if (!targetFor(lang.id, option)) {
      tests.setStatus(`Local run isn't available for ${lang.label} yet. Use Submit to have CSES judge it.`);
      log(`Local run isn't available for ${lang.label}. Supported locally: C, C++, Python 3, Ruby, Node.js.`, 'warn');
      return;
    }
    const src = await latestCode();
    if (!src.trim()) {
      tests.setStatus('The editor is empty.');
      return;
    }
    const inputs = tests.inputs();
    if (!inputs.length) {
      tests.setStatus('Add a custom input first.');
      return;
    }
    running = true;
    runBtn.disabled = true;
    runLabel.textContent = 'Running…';
    tests.clearResults();
    tests.setStatus('Starting…');
    const reqId = ++runSeq;
    const t = performance.now();
    const report = await new Promise<RunReport>((resolve) => {
      runDone = resolve;
      send({ type: 'run', reqId, run: { langId: lang.id, option: option ?? null, code: src, inputs } });
    });
    runDone = null;
    running = false;
    runBtn.disabled = false;
    runLabel.textContent = 'Run';
    tests.showReport(report);
    revealResults(); // the user may have resized or scrolled while it ran
    const secs = ((performance.now() - t) / 1000).toFixed(1);
    if (!report.compiled) log(`Compilation failed (${secs} s).`, 'warn');
    else {
      const bad = report.cases.filter((c) => c.status !== 'ok').length;
      log(`Local run finished in ${secs} s: ${report.cases.length - bad}/${report.cases.length} tests ran without errors.`, bad ? 'warn' : 'ok');
    }
  }

  async function startSubmit(): Promise<void> {
    const src = await latestCode();
    if (!src.trim()) {
      log('The editor is empty, so there is nothing to submit.', 'warn');
      return;
    }
    const bytes = new TextEncoder().encode(src).length;
    const filename = lang.filename(src);
    // Clicking Submit (or Ctrl+Enter) is the user's decision; only stop for things CSES would reject.
    if (bytes > MAX_SOURCE_BYTES) {
      dockTabs.select(1);
      log(`Not submitted: CSES accepts source files up to 128 kB, and this file is ${fmt(bytes)} bytes.`, 'warn');
      return;
    }
    if (lang.id === 'java' && /^package\s/m.test(src)) log("CSES warns: don't use 'package' in Java code.", 'warn');
    if (submitBtn instanceof HTMLButtonElement) {
      submitBtn.disabled = true;
      submitBtn.lastChild!.textContent = 'Submitting…';
    }
    await store.saveDraft(task.id, lang.id, src);
    await store.setPendingSubmission({ taskId: task.id, code: src, langId: lang.id, optionId: option ?? null, filename, createdAt: Date.now() });
    log('Opening the CSES submit page…', 'ok');
    location.assign(`/problemset/submit/${task.id}/`);
  }

  document.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape' && app.classList.contains('cp-expanded')) {
      toggleExpand(false);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const target = e.key === 'ArrowLeft' ? nav.prev : nav.next;
      if (target) location.assign(`/problemset/task/${target.id}`);
    }
  });
  watchTheme((t) => send({ type: 'setTheme', theme: t }));

  // ---------------- mount; moving original nodes is the last step
  document.body.prepend(app);
  document.documentElement.classList.add('csesplus-on');
  statementBody.append(statement);
  decorateSamples(task);
  log(`Ready. Your ${lang.label} code is saved as a draft on this device.`);
  return true;
}

// ---------------------------------------------------------------- helpers

function neighbours(task: TaskPage, tasks: IndexedTask[] | null): { prev: NavTarget | null; next: NavTarget | null; position: string | null } {
  const i = tasks?.findIndex((t) => t.id === task.id) ?? -1;
  if (tasks && i >= 0) {
    const inCat = tasks.filter((t) => t.category === tasks[i].category);
    return { prev: tasks[i - 1] ?? null, next: tasks[i + 1] ?? null, position: `${inCat.findIndex((t) => t.id === task.id) + 1} / ${inCat.length}` };
  }
  // No cached list yet: fall back to the neighbours CSES shows in its sidebar.
  const j = task.sidebar.findIndex((l) => l.current);
  return { prev: j > 0 ? task.sidebar[j - 1] : null, next: j >= 0 ? task.sidebar[j + 1] ?? null : null, position: null };
}

function navLink(t: NavTarget | null, dir: 'prev' | 'next'): HTMLElement {
  const ic = icon(dir === 'prev' ? 'chevLeft' : 'chevRight', 16);
  if (!t) return h('span', { class: 'cp-iconbtn is-disabled', 'aria-hidden': 'true' }, ic);
  const label = `${dir === 'prev' ? 'Previous' : 'Next'} problem: ${t.title} (Alt+${dir === 'prev' ? '←' : '→'})`;
  return h('a', { class: 'cp-iconbtn', href: `/problemset/task/${t.id}`, 'aria-label': label, title: label }, ic);
}

function statusChip(s: Status): HTMLElement | null {
  if (s === 'solved') return h('span', { class: 'cp-status-chip is-solved' }, icon('check', 13), 'Solved');
  if (s === 'attempted') return h('span', { class: 'cp-status-chip is-attempted' }, 'Attempted');
  return null;
}

function tabs(items: [string, HTMLElement][], extra: HTMLElement[] = []) {
  const buttons = items.map(([label, panel], i) => {
    const b = h('button', { type: 'button', class: 'cp-tab', role: 'tab', 'aria-selected': String(i === 0) }, label);
    b.addEventListener('click', () => select(i));
    panel.hidden = i !== 0;
    return b;
  });
  function select(i: number) {
    buttons.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    items.forEach(([, p], k) => (p.hidden = k !== i));
  }
  const list = h('div', { class: 'cp-tabs', role: 'tablist' }, buttons, extra);
  return { bar: scrollableTabs(list), select };
}

// Tab bars can hold more tabs than fit (CSES adds Results, Analysis, Statistics, Tests, Queue, ...).
// The bar scrolls sideways, and arrow buttons appear on whichever side has hidden tabs.
function scrollableTabs(list: HTMLElement): HTMLElement {
  const arrow = (dir: -1 | 1) => {
    const b = h('button', { type: 'button', class: `cp-tabs-arrow is-${dir < 0 ? 'left' : 'right'}`, 'aria-label': dir < 0 ? 'Show earlier tabs' : 'Show more tabs', title: dir < 0 ? 'Earlier tabs' : 'More tabs', hidden: true }, icon(dir < 0 ? 'chevLeft' : 'chevRight', 14));
    b.addEventListener('click', () => list.scrollBy({ left: dir * Math.max(120, list.clientWidth * 0.6), behavior: 'smooth' }));
    return b;
  };
  const left = arrow(-1);
  const right = arrow(1);
  const sync = () => {
    left.hidden = list.scrollLeft <= 2;
    right.hidden = list.scrollLeft + list.clientWidth >= list.scrollWidth - 2;
  };
  list.addEventListener('scroll', sync, { passive: true });
  // A normal mouse wheel scrolls the bar sideways.
  list.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && list.scrollWidth > list.clientWidth) {
      e.preventDefault();
      list.scrollLeft += e.deltaY;
    }
  }, { passive: false });
  new ResizeObserver(sync).observe(list);
  // Keep the selected tab in view.
  list.addEventListener('click', (e) => (e.target as HTMLElement).closest('.cp-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }));
  return h('div', { class: 'cp-tabs-wrap' }, left, list, right);
}

function submissionsContent(task: TaskPage, loggedIn: boolean): HTMLElement {
  if (!loggedIn) {
    return h('p', { class: 'cp-muted' }, 'Log in to CSES to see your submissions for this problem. ', h('a', { href: '/login' }, 'Log in'));
  }
  const nodes = task.submissionNodes.filter((n) => (n.textContent ?? '').trim() || n.querySelector('a,table,img'));
  if (!nodes.length) return h('p', { class: 'cp-muted' }, 'No submissions for this problem yet.');
  // Move CSES's own list so its links and markup stay exactly as CSES renders them.
  return h('div', { class: 'cp-subs' }, nodes);
}

// ---------------------------------------------------------------- test cases + local run results

interface TestCase {
  name: string;
  input: string;
  expected: string | null; // null for custom input
  result?: CaseResult;
}

type Verdict = 'passed' | 'wrong' | 'error' | 'timeout' | 'ran' | 'skipped';

// Same output ignoring trailing spaces on each line and trailing blank lines.
const normalizeOutput = (s: string) => s.replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n+$/, '');

function verdictOf(c: TestCase): Verdict | null {
  const r = c.result;
  if (!r) return null;
  if (r.status === 'skipped') return 'skipped';
  if (r.status === 'timeout') return 'timeout';
  if (r.status === 'error') return 'error';
  if (c.expected === null) return 'ran';
  return normalizeOutput(r.stdout ?? '') === normalizeOutput(c.expected) ? 'passed' : 'wrong';
}

const VERDICT_TEXT: Record<Verdict, string> = {
  passed: 'Passed',
  wrong: 'Wrong output',
  error: 'Runtime error',
  timeout: 'Time limit',
  ran: 'Finished',
  skipped: 'Not run',
};

function verdictIcon(v: Verdict): SVGSVGElement {
  return icon(v === 'passed' || v === 'ran' ? 'check' : v === 'timeout' ? 'pending' : 'cross', 14);
}

// "Line 3: expected "8", got "9"" — the first line where the output differs (after normalising whitespace).
function firstDifference(expected: string, actual: string): string {
  const e = normalizeOutput(expected).split('\n');
  const a = normalizeOutput(actual).split('\n');
  for (let i = 0; i < Math.max(e.length, a.length); i++) {
    if (e[i] !== a[i]) {
      const show = (s: string | undefined) => (s === undefined ? 'nothing' : `"${s.length > 60 ? `${s.slice(0, 60)}…` : s}"`);
      return `Line ${i + 1}: expected ${show(e[i])}, got ${show(a[i])}`;
    }
  }
  return '';
}

function testCasesPanel(task: TaskPage) {
  const cases: TestCase[] = task.samples.map((s, i) => ({ name: `Example ${i + 1}`, input: s.input, expected: s.output }));
  let selected = 0;
  let customInput = '';
  const statusLine = h('span', { class: 'cp-run-status', 'aria-live': 'polite' }, task.samples.length ? 'Examples read from the statement.' : 'No examples found; add a custom input.');
  const picker = h('div', { class: 'cp-sample-picker' });
  const view = h('div', { class: 'cp-case-view' });
  const banner = h('div', { class: 'cp-run-banner', hidden: true });
  const note = h('p', { class: 'cp-run-note', hidden: true });

  const custom = () => cases.find((c) => c.expected === null);
  const box = (label: string, content: Node, extra?: Node | null) =>
    h('div', { class: 'cp-sample' }, h('div', { class: 'cp-sample-head' }, h('span', {}, label), extra ?? null), content);

  function renderPicker(): void {
    const nodes: (Node | null)[] = [
      ...cases.map((c, i) => {
        const v = verdictOf(c);
        const b = h('button', { type: 'button', class: `cp-pill${v ? ` is-${v}` : ''}`, 'aria-pressed': String(i === selected) }, v ? h('span', { class: 'cp-pill-dot', 'aria-hidden': 'true' }) : null, c.name, v ? h('span', { class: 'cp-sr' }, `: ${VERDICT_TEXT[v]}`) : null);
        b.addEventListener('click', () => {
          selected = i;
          render();
        });
        return b;
      }),
      custom()
        ? null
        : h('button', { type: 'button', class: 'cp-pill cp-pill-add', onClick: () => { cases.push({ name: 'Custom', input: customInput, expected: null }); selected = cases.length - 1; render(); } }, '+ Custom input'),
      statusLine,
    ];
    picker.replaceChildren(...nodes.filter((n): n is Node => n !== null));
  }

  function renderView(): void {
    const c = cases[selected];
    if (!c) {
      view.replaceChildren(h('p', { class: 'cp-muted' }, 'Add a custom input to run your code.'));
      return;
    }
    let inputNode: HTMLElement;
    if (c.expected === null) {
      const ta = h('textarea', { class: 'cp-custom-input', spellcheck: 'false', 'aria-label': 'Custom input', placeholder: 'Type the input your program should read…' }) as HTMLTextAreaElement;
      ta.value = c.input;
      ta.addEventListener('input', () => { c.input = ta.value; customInput = ta.value; });
      inputNode = ta;
    } else {
      inputNode = h('pre', { class: 'cp-pre' }, c.input);
    }
    const r = c.result;
    const v = verdictOf(c);
    const outText = r?.status === 'skipped' ? '' : r?.stdout ?? '';
    const diff = v === 'wrong' && c.expected !== null ? firstDifference(c.expected, outText) : null;
    const yourOut = h(
      'div',
      { class: 'cp-your-output' },
      r ? h('pre', { class: 'cp-pre' }, outText || (r.status === 'ok' ? '(no output)' : '')) : h('p', { class: 'cp-muted-sm cp-pad' }, 'Press Run to see your output.'),
      diff ? h('p', { class: 'cp-diff' }, diff) : null,
      r?.error ? h('pre', { class: 'cp-pre cp-pre-error' }, r.error) : null,
      r?.stderr ? h('pre', { class: 'cp-pre cp-pre-error' }, r.stderr) : null,
    );
    view.replaceChildren(
      h(
        'div',
        { class: `cp-sample-grid${c.expected === null ? ' is-two' : ''}` },
        box('Input', inputNode, c.expected === null ? h('button', { type: 'button', class: 'cp-copy', onClick: () => { cases.splice(selected, 1); selected = Math.max(0, selected - 1); render(); } }, 'Remove') : copyButton(() => c.input, 'Copy input')),
        c.expected === null ? null : box('Expected output', h('pre', { class: 'cp-pre' }, c.expected), copyButton(() => c.expected ?? '', 'Copy expected output')),
        h(
          'div',
          { class: `cp-sample cp-out-box${v ? ` is-${v}` : ''}` },
          h(
            'div',
            { class: 'cp-sample-head' },
            h('span', { class: 'cp-out-title' }, 'Your output', v ? h('span', { class: 'cp-verdict' }, verdictIcon(v), VERDICT_TEXT[v]) : null, r?.runMs != null && r.status !== 'skipped' ? h('span', { class: 'cp-out-time' }, `${r.runMs} ms`) : null),
            r?.stdout ? copyButton(() => r.stdout ?? '', 'Copy your output') : null,
          ),
          yourOut,
        ),
      ),
    );
    view.dataset.verdict = v ?? '';
  }

  function render(): void {
    renderPicker();
    renderView();
  }
  render();

  return {
    el: h('div', { class: 'cp-samples' }, picker, banner, note, view),
    inputs: () => cases.map((c) => c.input),
    setStatus: (t: string) => { statusLine.className = 'cp-run-status'; statusLine.textContent = t; },
    clearResults(): void {
      cases.forEach((c) => (c.result = undefined));
      banner.hidden = true;
      render();
    },
    showReport(report: RunReport): void {
      note.hidden = !report.note;
      note.textContent = report.note ? `Local run, not CSES judging. ${report.note}` : '';
      if (!report.compiled) {
        banner.hidden = false;
        banner.className = 'cp-run-banner is-error';
        banner.replaceChildren(h('strong', {}, 'Compilation failed'), h('pre', { class: 'cp-pre cp-pre-error' }, report.diagnostics || 'No details.'));
        statusLine.className = 'cp-run-status is-fail';
        statusLine.replaceChildren(verdictIcon('error'), 'Compilation failed');
        render();
        return;
      }
      banner.hidden = true;
      report.cases.forEach((r, i) => cases[i] && (cases[i].result = r));
      const graded = cases.filter((c) => c.expected !== null);
      const passed = graded.filter((c) => verdictOf(c) === 'passed').length;
      const firstBad = cases.findIndex((c) => { const v = verdictOf(c); return v && v !== 'passed' && v !== 'ran'; });
      if (firstBad >= 0) selected = firstBad;
      const allOk = cases.every((c) => { const v = verdictOf(c); return v === 'passed' || v === 'ran'; });
      statusLine.className = `cp-run-status ${allOk ? 'is-pass' : 'is-fail'}`;
      statusLine.replaceChildren(
        verdictIcon(allOk ? 'passed' : 'wrong'),
        `${graded.length ? (allOk ? (graded.length === 1 ? 'Example passed' : `All ${graded.length} examples passed`) : `${passed}/${graded.length} examples passed`) : 'Finished'}${report.compileMs ? ` · compiled in ${(report.compileMs / 1000).toFixed(1)} s` : ''}`,
      );
      render();
    },
  };
}

// Adds a header with a copy button to each sample <pre> and pairs input/output side by side.
function decorateSamples(task: TaskPage): void {
  const boxes: { box: HTMLElement; kind: 'input' | 'output' }[] = [];
  for (const { pre, kind, label } of task.samplePres) {
    label.classList.add('cp-sample-label');
    const box = h('div', { class: 'cp-sample' });
    pre.before(box);
    box.append(
      h('div', { class: 'cp-sample-head' }, h('span', {}, kind === 'input' ? 'Input' : 'Output'), copyButton(() => pre.textContent ?? '', `Copy sample ${kind}`)),
      pre,
    );
    pre.classList.add('cp-pre');
    boxes.push({ box, kind });
  }
  for (let i = 0; i + 1 < boxes.length; i++) {
    if (boxes[i].kind === 'input' && boxes[i + 1].kind === 'output') {
      const pair = h('div', { class: 'cp-sample-pair' });
      boxes[i].box.before(pair);
      pair.append(boxes[i].box, boxes[i + 1].box);
      i++;
    }
  }
}
