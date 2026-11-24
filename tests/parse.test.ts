// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAuth, parseCounts, parseList, parseStatus, parseTabs, parseTask, parseTheme } from '../src/core/parse';
import { SEL } from '../src/core/selectors';
import { LANGS, normalize } from '../src/core/languages';

// Fixtures are real CSES pages saved on 2026-11-22 while logged out.
const load = (name: string) => new DOMParser().parseFromString(readFileSync(`tests/fixtures/${name}`, 'utf8'), 'text/html');

describe('Problem Set list', () => {
  const doc = load('list.html');
  const cats = parseList(doc);
  const tasks = cats.flatMap((c) => c.tasks);

  it('finds every category and task', () => {
    expect(cats).toHaveLength(18);
    expect(tasks).toHaveLength(400);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(400);
    expect(cats.map((c) => c.name)).not.toContain('General');
  });

  it('reads the first task exactly as CSES shows it', () => {
    expect(tasks[0]).toEqual({
      id: '1068',
      title: 'Weird Algorithm',
      category: 'Introductory Problems',
      a: 184703,
      b: 192809,
      status: 'unknown',
    });
  });

  it('keeps CSES order inside a category', () => {
    expect(cats[0].tasks.slice(0, 4).map((t) => t.id)).toEqual(['1068', '1083', '1069', '1094']);
  });

  it('reports no solved status when logged out', () => {
    expect(parseAuth(doc)).toEqual({ loggedIn: false, username: null, profileUrl: null, logoutUrl: null });
    expect(tasks.every((t) => t.status === 'unknown')).toBe(true);
  });

  it('reads the CSES theme flag', () => {
    expect(parseTheme(doc)).toBe('light');
  });
});

// Logged-in pages saved by the project owner (scrubbed: user "tester", id 0, token "test-token").
describe('logged-in pages', () => {
  const view = load('view1635.html');

  it('finds the user, profile link and log-out link', () => {
    expect(parseAuth(view)).toEqual({
      loggedIn: true,
      username: 'tester',
      profileUrl: 'https://cses.fi/user/0',
      logoutUrl: 'https://cses.fi/logout',
    });
  });

  it("reads CSES's tab bar", () => {
    expect(parseTabs(view).map((t) => t.label)).toEqual(['Task', 'Submit', 'Results', 'Analysis', 'Statistics', 'Tests', 'Queue']);
    expect(parseTabs(view).find((t) => t.current)?.label).toBe('Results');
  });

  it('reads solved status and your submissions from the sidebar', () => {
    const t = parseTask(view, '/problemset/task/1635')!;
    expect(t.status).toBe('solved');
    expect(t.submissionNodes).toHaveLength(7);
    expect(t.submissionNodes[0].querySelector('.task-score')?.classList.contains('full')).toBe(true);
    expect(t.submissionNodes[1].querySelector('.task-score')?.classList.contains('zero')).toBe(true);
  });

  it('matches the real submit form', () => {
    const doc = load('submit1068.html');
    const lang = doc.querySelector<HTMLSelectElement>(SEL.submitLang)!;
    const form = lang.form!;
    expect(form.getAttribute('action')).toMatch(/\/course\/send\.php$/);
    expect(form.querySelector(SEL.submitFile)).not.toBeNull();
    expect(form.querySelector(SEL.submitOption)).not.toBeNull();
    expect(form.querySelector(SEL.submitCsrf)).not.toBeNull();
    expect(form.querySelector(SEL.submitButton)).not.toBeNull();
    const values = Array.from(lang.options).map((o) => o.value);
    for (const l of LANGS) expect(values.some((v) => l.csesNames.includes(normalize(v)))).toBe(true);
  });
});

describe('status and counts', () => {
  const span = (cls: string) => {
    const el = document.createElement('span');
    el.className = `task-score icon ${cls}`;
    return el;
  };
  it('maps CSES task-score classes only when logged in', () => {
    expect(parseStatus(span('full'), true)).toBe('solved');
    expect(parseStatus(span('zero'), true)).toBe('attempted');
    expect(parseStatus(span(''), true)).toBe('none');
    expect(parseStatus(span('full'), false)).toBe('unknown');
  });
  it('parses "A / B" and rejects anything else', () => {
    expect(parseCounts('184703 / 192809')).toEqual([184703, 192809]);
    expect(parseCounts('n/a')).toEqual([null, null]);
  });
});

describe('task pages', () => {
  it('reads Weird Algorithm', () => {
    const t = parseTask(load('task1068.html'), '/problemset/task/1068')!;
    expect(t.title).toBe('Weird Algorithm');
    expect(t.category).toBe('Introductory Problems');
    expect(t.timeLimit).toBe('1.00 s');
    expect(t.memoryLimit).toBe('512 MB');
    expect(t.statement?.classList.contains('md')).toBe(true);
    expect(t.samples).toEqual([{ input: '3\n', output: '3 10 5 16 8 4 2 1\n' }]);
    expect(t.sidebar.find((l) => l.current)?.id).toBe('1068');
    expect(t.hasSubmitTab).toBe(false);
    expect(t.status).toBe('unknown');
  });

  it('pairs multiple examples (Two Sets)', () => {
    const t = parseTask(load('task1092.html'), '/problemset/task/1092')!;
    expect(t.samples).toHaveLength(2);
    expect(t.samplePres.map((p) => p.kind)).toEqual(['input', 'output', 'input', 'output']);
  });

  it.each([
    ['task1094.html', '1094', 'Increasing Array', 'Introductory Problems'],
    ['task1158.html', '1158', 'Book Shop', 'Dynamic Programming'],
    ['task1671.html', '1671', 'Shortest Routes I', 'Graph Algorithms'],
  ])('reads %s', (file, id, title, category) => {
    const t = parseTask(load(file), `/problemset/task/${id}/`)!;
    expect(t.title).toBe(title);
    expect(t.category).toBe(category);
    expect(t.samples.length).toBeGreaterThan(0);
  });

  it('rejects non-task paths', () => {
    expect(parseTask(load('task1068.html'), '/problemset/stats/1068/')).toBeNull();
  });
});
