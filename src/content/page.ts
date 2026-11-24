// Shared shell for every other CSES page CSES+ runs on: Submit, Results, result details, Statistics,
// Tests, Analysis, Queue, text pages, login and user profiles. CSES's own content nodes are moved into
// the shell (not copied), so forms, links and scripts keep working exactly as CSES built them.
import { h } from '../core/dom';
import { parseAuth, parseTabs } from '../core/parse';
import { SEL } from '../core/selectors';
import { topbar, type Crumb } from './shell';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();

// CSES pages share one layout, but be lenient about where the content block sits.
function findContent(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(SEL.content) ??
    document.querySelector<HTMLElement>('.skeleton .content') ??
    document.querySelector<HTMLElement>('body .content')
  );
}

export async function runPage(): Promise<boolean> {
  const content = findContent();
  if (!content) return false;
  const titleBlock = document.querySelector(SEL.titleBlock);
  const auth = parseAuth(document);
  const title = text(titleBlock?.querySelector('h1')) || document.title.replace(/^CSES\s*-\s*/, '') || 'CSES';
  const tabs = parseTabs(document);
  const sidebar = document.querySelector<HTMLElement>(SEL.sidebar);
  const path = location.pathname;
  const taskId = /^\/problemset\/[a-z]+\/(\d+)/.exec(path)?.[1] ?? null;

  // Breadcrumb: Problem Set / <task> / <current tab>, or the page title elsewhere.
  const crumbs: Crumb[] = [];
  if (path.startsWith('/problemset')) crumbs.push({ label: 'Problem Set', href: '/problemset/list/' });
  else if (path !== '/') crumbs.push({ label: 'CSES', href: '/' });
  // Course/contest pages (e.g. /dt/task/1234/) link back to their own list via the title block's h3.
  const parent = titleBlock?.querySelector<HTMLAnchorElement>('h3 a');
  if (parent && !path.startsWith('/problemset')) crumbs.push({ label: text(parent), href: parent.getAttribute('href') ?? '#', cls: 'cp-crumb-cat' });
  const currentTab = tabs.find((t) => t.current);
  if (taskId && currentTab) {
    crumbs.push({ label: title, href: `/problemset/task/${taskId}`, cls: 'cp-crumb-cat' });
    crumbs.push({ label: currentTab.label });
  } else {
    crumbs.push({ label: path === '/' ? 'Home' : title });
  }

  const tabNav = tabs.length
    ? h(
        'nav',
        { class: 'cp-ctabs', 'aria-label': `${title} pages` },
        tabs.map((t) => h('a', { class: `cp-ctab${t.current ? ' is-current' : ''}`, href: t.href, 'aria-current': t.current ? 'page' : null }, t.label)),
      )
    : null;

  const main = h('section', { class: 'cp-card cp-generic', 'aria-label': title });
  const aside = sidebar && sidebar.children.length ? h('aside', { class: 'cp-card cp-side', 'aria-label': 'Related problems and your submissions' }) : null;

  const app = h(
    'div',
    { id: 'csesplus-app', class: 'cp-app cp-page' },
    topbar(auth, crumbs),
    h(
      'div',
      { class: 'cp-page-body' },
      h('header', { class: 'cp-doc-head' }, h('h1', { class: 'cp-h1' }, title), tabNav),
      h('div', { class: `cp-page-grid${aside ? '' : ' no-side'}` }, main, aside),
    ),
  );

  document.body.prepend(app);
  document.documentElement.classList.add('csesplus-on');
  // Move CSES's own nodes last.
  main.append(...Array.from(content.childNodes));
  if (aside && sidebar) aside.append(...Array.from(sidebar.childNodes));
  return true;
}
