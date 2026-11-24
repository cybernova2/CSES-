import { SEL } from './selectors';

export type Status = 'solved' | 'attempted' | 'pending' | 'none' | 'unknown';
export type Theme = 'light' | 'dark';

export interface TaskRow {
  id: string;
  title: string;
  category: string;
  a: number | null;
  b: number | null;
  status: Status;
}

export interface Category {
  name: string;
  tasks: TaskRow[];
}

export interface Auth {
  loggedIn: boolean;
  username: string | null;
  profileUrl: string | null; // CSES links the username to /user/{id}
  logoutUrl: string | null;
}

export interface NavTab {
  label: string;
  href: string;
  current: boolean;
}

export interface Sample {
  input: string;
  output: string;
}

export interface SidebarLink {
  id: string;
  title: string;
  current: boolean;
}

export interface TaskPage {
  id: string;
  title: string;
  category: string | null;
  timeLimit: string | null;
  memoryLimit: string | null;
  statement: HTMLElement | null;
  samples: Sample[];
  samplePres: { pre: HTMLPreElement; kind: 'input' | 'output'; label: HTMLElement }[];
  status: Status;
  sidebar: SidebarLink[];
  submissionNodes: Element[];
  hasSubmitTab: boolean;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();

export function taskIdFromHref(href: string | null | undefined): string | null {
  const m = /\/problemset\/task\/(\d+)/.exec(href ?? '');
  return m ? m[1] : null;
}

export function parseCounts(raw: string | null | undefined): [number | null, number | null] {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw ?? '');
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

// Status is only reported when the page is logged in; otherwise CSES renders every icon blank.
export function parseStatus(el: Element | null, loggedIn: boolean): Status {
  if (!loggedIn || !el) return 'unknown';
  const c = el.classList;
  if (c.contains('full')) return 'solved';
  if (c.contains('zero') || c.contains('partial') || c.contains('compile-err')) return 'attempted';
  if (c.contains('pending')) return 'pending';
  return 'none';
}

export function parseAuth(doc: Document): Auth {
  const a = doc.querySelector(SEL.account);
  const href = a?.getAttribute('href') ?? '';
  const loggedIn = !!a && !/\/login\/?$/.test(href);
  return {
    loggedIn,
    username: loggedIn ? text(a) || null : null,
    profileUrl: loggedIn && href ? href : null,
    logoutUrl: loggedIn ? doc.querySelector(SEL.logout)?.getAttribute('href') ?? null : null,
  };
}

// CSES's own tab bar on task-related pages (Task, Submit, Results, Statistics, Tests, ...).
export function parseTabs(doc: Document): NavTab[] {
  return Array.from(doc.querySelectorAll(SEL.taskTabs)).map((a) => ({
    label: text(a),
    href: a.getAttribute('href') ?? '#',
    current: a.classList.contains('current'),
  }));
}

export function parseTheme(doc: Document): Theme {
  const flag = text(doc.querySelector(SEL.darkFlag));
  if (flag === 'true') return 'dark';
  if (flag === 'false') return 'light';
  return doc.querySelector(SEL.darkSheet)?.getAttribute('rel') === 'stylesheet' ? 'dark' : 'light';
}

export function parseList(doc: Document): Category[] {
  const { loggedIn } = parseAuth(doc);
  const out: Category[] = [];
  doc.querySelectorAll(SEL.listHeading).forEach((h2) => {
    const ul = h2.nextElementSibling;
    if (!ul || !ul.matches(SEL.taskList)) return;
    const name = text(h2);
    const tasks: TaskRow[] = [];
    ul.querySelectorAll(SEL.taskItem).forEach((li) => {
      const a = li.querySelector(SEL.taskLink);
      const id = taskIdFromHref(a?.getAttribute('href'));
      if (!a || !id) return;
      const [ca, cb] = parseCounts(li.querySelector(SEL.taskDetail)?.textContent);
      tasks.push({
        id,
        title: text(a),
        category: name,
        a: ca,
        b: cb,
        status: parseStatus(li.querySelector(SEL.taskScore), loggedIn),
      });
    });
    if (tasks.length) out.push({ name, tasks });
  });
  return out;
}

function limitValue(doc: Document, pattern: RegExp): string | null {
  for (const li of Array.from(doc.querySelectorAll(SEL.constraints))) {
    const t = text(li);
    if (pattern.test(t)) return t.slice(t.indexOf(':') + 1).trim() || null;
  }
  return null;
}

export function parseTask(doc: Document, pathname: string): TaskPage | null {
  const id = /^\/problemset\/task\/(\d+)\/?$/.exec(pathname)?.[1];
  const title = text(doc.querySelector(SEL.taskTitle));
  if (!id || !title) return null;

  const { loggedIn } = parseAuth(doc);
  const sidebar = doc.querySelector(SEL.sidebar);
  const statement = doc.querySelector<HTMLElement>(SEL.statement);

  // Samples: a <p>Input:</p> followed by <pre>, then <p>Output:</p> followed by <pre>.
  const samples: Sample[] = [];
  const samplePres: TaskPage['samplePres'] = [];
  let pendingInput: string | null = null;
  statement?.querySelectorAll('pre').forEach((pre) => {
    const label = pre.previousElementSibling as HTMLElement | null;
    const kind = /^input:?$/i.test(text(label)) ? 'input' : /^output:?$/i.test(text(label)) ? 'output' : null;
    if (!kind || !label) return;
    samplePres.push({ pre, kind, label });
    if (kind === 'input') pendingInput = pre.textContent ?? '';
    else if (pendingInput !== null) {
      samples.push({ input: pendingInput, output: pre.textContent ?? '' });
      pendingInput = null;
    }
  });

  const links: SidebarLink[] = [];
  sidebar?.querySelectorAll(':scope > a').forEach((a) => {
    const lid = taskIdFromHref(a.getAttribute('href'));
    if (lid) links.push({ id: lid, title: (a.firstChild?.textContent ?? text(a)).trim(), current: a.classList.contains('current') });
  });

  // "Your submissions" section: everything after that heading in the sidebar.
  const submissionNodes: Element[] = [];
  const subsHeading = sidebar
    ? Array.from(sidebar.querySelectorAll('h4')).find((h) => /your submissions/i.test(text(h)))
    : undefined;
  for (let n = subsHeading?.nextElementSibling; n; n = n.nextElementSibling) submissionNodes.push(n);

  return {
    id,
    title,
    category: text(sidebar?.querySelector('h4')) || null,
    timeLimit: limitValue(doc, /time limit/i),
    memoryLimit: limitValue(doc, /memory limit/i),
    statement,
    samples,
    samplePres,
    status: parseStatus(sidebar?.querySelector('a.current .task-score') ?? null, loggedIn),
    sidebar: links,
    submissionNodes,
    hasSubmitTab: Array.from(doc.querySelectorAll(SEL.taskTabs)).some((a) =>
      /\/problemset\/submit\//.test(a.getAttribute('href') ?? ''),
    ),
  };
}
