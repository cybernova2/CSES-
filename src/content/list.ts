// Problem Set and Bookmarks screens, rendered from the CSES list page's own DOM.
import { fmt, h, isTypingTarget } from '../core/dom';
import { icon } from '../core/icons';
import { parseAuth, parseList, type TaskRow } from '../core/parse';
import { LABELS } from '../core/selectors';
import { store, type Bookmark } from '../core/storage';
import { account, brand, originalPageButton, statusIcon, themeSwitch } from './shell';

type View = 'problems' | 'bookmarks';
type Filter = 'all' | 'solved' | 'attempted' | 'none' | 'bookmarked';

interface RowRef {
  task: TaskRow;
  row: HTMLElement;
  bm: HTMLButtonElement;
}

export async function runList(): Promise<boolean> {
  const categories = parseList(document);
  const all = categories.flatMap((c) => c.tasks);
  if (!all.length) return false;

  const auth = parseAuth(document);
  const showStatus = all.some((t) => t.status !== 'unknown');
  await store.saveTaskIndex(all.map(({ id, title, category, a, b }) => ({ id, title, category, a, b })));
  let bookmarks = await store.bookmarks();

  const state = { view: viewFromHash(), query: '', filter: 'all' as Filter, category: null as string | null };
  const refs: RowRef[] = [];
  const sections: { name: string; el: HTMLElement; rows: RowRef[] }[] = [];

  // ---------- sidebar
  const bmCount = h('span', { class: 'cp-badge' }, String(Object.keys(bookmarks).length));
  const navProblems = h('a', { class: 'cp-nav-item', href: '#problems' }, icon('list', 18), h('span', { class: 'cp-nav-label' }, 'Problem Set'));
  const navBookmarks = h('a', { class: 'cp-nav-item', href: '#bookmarks' }, icon('bookmark', 18), h('span', { class: 'cp-nav-label' }, 'Bookmarks'), bmCount);
  const catButtons = new Map<string | null, HTMLButtonElement>();
  const catItem = (name: string | null, label: string, count: number) => {
    const b = h(
      'button',
      { type: 'button', class: 'cp-cat', onClick: () => setCategory(name) },
      h('span', { class: 'cp-cat-name' }, label),
      h('span', { class: 'cp-cat-count' }, String(count)),
    );
    catButtons.set(name, b);
    return b;
  };
  const sidebar = h(
    'aside',
    { class: 'cp-sidebar' },
    brand(),
    h('nav', { class: 'cp-nav', 'aria-label': 'CSES+' }, navProblems, navBookmarks),
    h(
      'div',
      { class: 'cp-cats', role: 'group', 'aria-label': 'Categories' },
      h('div', { class: 'cp-caption' }, 'Categories'),
      catItem(null, 'All categories', all.length),
      categories.map((c) => catItem(c.name, c.name, c.tasks.length)),
    ),
    h('div', { class: 'cp-sidebar-foot' }, themeSwitch(), account(auth), originalPageButton()),
  );

  // ---------- problems view
  const search = h('input', { type: 'search', placeholder: 'Search by problem name or ID', 'aria-label': 'Search problems', autocomplete: 'off', spellcheck: 'false' });
  search.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    apply();
  });
  const catSelect = h(
    'select',
    { class: 'cp-select cp-cat-select', 'aria-label': 'Category' },
    h('option', { value: '' }, 'All categories'),
    categories.map((c) => h('option', { value: c.name }, c.name)),
  );
  catSelect.addEventListener('change', () => setCategory(catSelect.value || null));

  const filterDefs: [Filter, string][] = showStatus
    ? [['all', 'All'], ['solved', 'Solved'], ['attempted', 'Attempted'], ['none', 'Not attempted'], ['bookmarked', 'Bookmarked']]
    : [['all', 'All'], ['bookmarked', 'Bookmarked']];
  const filterButtons = filterDefs.map(([f, label]) => {
    const b = h('button', { type: 'button', onClick: () => setFilter(f) }, label);
    b.dataset.filter = f;
    return b;
  });

  const resultCount = h('p', { class: 'cp-result-count', 'aria-live': 'polite' });
  const noResults = h('div', { class: 'cp-empty', hidden: true }, 'No problems match your search and filters.');
  const listWrap = h('div', { class: `cp-list${showStatus ? '' : ' no-status'}` });

  for (const cat of categories) {
    const rows = cat.tasks.map((task) => {
      const bm = h('button', { type: 'button', class: 'cp-iconbtn cp-bm', onClick: () => toggleBookmark(task) }, icon('bookmark', 16));
      const row = h(
        'div',
        { class: 'cp-row', role: 'row' },
        showStatus ? h('span', { class: 'cp-cell-status', role: 'cell' }, statusIcon(task.status)) : null,
        h('span', { class: 'cp-id', role: 'cell' }, task.id),
        h('span', { class: 'cp-cell-title', role: 'cell' }, h('a', { class: 'cp-title', href: `/problemset/task/${task.id}` }, task.title)),
        h(
          'span',
          { class: 'cp-stats', role: 'cell' },
          task.a != null && task.b != null ? [fmt(task.a), h('span', { class: 'cp-of' }, ` / ${fmt(task.b)}`)] : '–',
        ),
        h('span', { class: 'cp-cell-bm', role: 'cell' }, bm),
      );
      const ref = { task, row, bm };
      refs.push(ref);
      return ref;
    });
    const el = h(
      'section',
      { class: 'cp-card', 'aria-label': cat.name },
      h('div', { class: 'cp-card-head' }, h('h2', { class: 'cp-h2' }, cat.name), h('span', { class: 'cp-muted-sm' }, `${cat.tasks.length} problems`)),
      h(
        'div',
        { class: 'cp-table', role: 'table', 'aria-label': `${cat.name} problems` },
        h(
          'div',
          { class: 'cp-thead', role: 'row' },
          // Every header is a real grid cell (screen-reader-only text goes inside it), so columns line up with rows.
          showStatus ? h('span', { role: 'columnheader' }, h('span', { class: 'cp-sr' }, 'Status')) : null,
          h('span', { role: 'columnheader' }, 'ID'),
          h('span', { role: 'columnheader' }, 'Problem'),
          h('span', { role: 'columnheader', class: 'cp-th-stats', title: LABELS.statsTitle }, LABELS.stats),
          h('span', { role: 'columnheader' }, h('span', { class: 'cp-sr' }, 'Bookmark')),
        ),
        rows.map((r) => r.row),
      ),
    );
    sections.push({ name: cat.name, el, rows });
    listWrap.append(el);
  }

  const problemsView = h(
    'div',
    { class: 'cp-main-inner' },
    h(
      'header',
      { class: 'cp-page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'cp-h1' }, 'Problem Set'),
        h('p', { class: 'cp-sub' }, `${all.length} problems in ${categories.length} categories, in CSES order. Statistics and status are read from cses.fi.`),
      ),
    ),
    auth.loggedIn
      ? null
      : h('p', { class: 'cp-notice' }, icon('lock', 14), 'Log in to CSES to see which problems you have solved. ', h('a', { href: '/login' }, 'Log in')),
    h(
      'div',
      { class: 'cp-toolbar' },
      h('label', { class: 'cp-search' }, icon('search', 16), search, h('kbd', { class: 'cp-kbd', 'aria-hidden': 'true' }, '/')),
      catSelect,
      h('div', { class: 'cp-seg', role: 'group', 'aria-label': 'Filter' }, filterButtons),
    ),
    resultCount,
    noResults,
    listWrap,
  );

  // ---------- bookmarks view
  const bookmarksView = h('div', { class: 'cp-main-inner' });
  const statusById = new Map(all.map((t) => [t.id, t.status]));
  function renderBookmarks(): void {
    const items = Object.values(bookmarks).sort((x: Bookmark, y: Bookmark) => y.addedAt - x.addedAt);
    bookmarksView.replaceChildren(
      h(
        'header',
        { class: 'cp-page-head' },
        h(
          'div',
          {},
          h('h1', { class: 'cp-h1' }, 'Bookmarks'),
          h('p', { class: 'cp-sub cp-with-icon' }, icon('lock', 14), `${items.length} saved · stored only in this browser, never synced`),
        ),
      ),
      items.length
        ? h(
            'section',
            { class: 'cp-card', 'aria-label': 'Saved problems' },
            items.map((b) => {
              const title = all.find((t) => t.id === b.id)?.title ?? b.title;
              return h(
                'div',
                { class: 'cp-bm-row' },
                showStatus ? statusIcon(statusById.get(b.id) ?? 'unknown') : null,
                h(
                  'div',
                  { class: 'cp-bm-main' },
                  h('a', { class: 'cp-bm-title', href: `/problemset/task/${b.id}` }, title),
                  h('div', { class: 'cp-bm-meta' }, h('span', { class: 'cp-mono' }, `#${b.id}`), h('span', { 'aria-hidden': 'true' }, '·'), b.category),
                ),
                h('a', { class: 'cp-btn cp-btn-secondary', href: `/problemset/task/${b.id}` }, 'Open problem', icon('chevRight', 14)),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'cp-iconbtn cp-iconbtn-bordered',
                    'aria-label': `Remove ${title} from bookmarks`,
                    title: 'Remove bookmark',
                    onClick: async () => {
                      await store.removeBookmark(b.id);
                    },
                  },
                  icon('trash', 16),
                ),
              );
            }),
          )
        : h('div', { class: 'cp-empty' }, icon('bookmark', 20), h('p', {}, 'No bookmarks yet. Use the bookmark icon on any problem to save it here.')),
    );
  }

  const main = h('main', { class: 'cp-main' }, problemsView, bookmarksView);
  const app = h('div', { id: 'csesplus-app', class: 'cp-app cp-shell' }, sidebar, main);

  // ---------- behaviour
  function viewFromHash(): View {
    return location.hash === '#bookmarks' ? 'bookmarks' : 'problems';
  }

  function setView(v: View): void {
    state.view = v;
    problemsView.hidden = v !== 'problems';
    bookmarksView.hidden = v !== 'bookmarks';
    for (const [el, on] of [[navProblems, v === 'problems'], [navBookmarks, v === 'bookmarks']] as const) {
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    if (v === 'bookmarks') renderBookmarks();
    window.scrollTo({ top: 0 });
  }

  function setCategory(name: string | null, fromUser = true): void {
    state.category = name;
    catSelect.value = name ?? '';
    catButtons.forEach((b, k) => {
      b.classList.toggle('is-active', k === name);
      b.setAttribute('aria-pressed', String(k === name));
    });
    if (fromUser && state.view !== 'problems') location.hash = '#problems';
    apply();
  }

  function setFilter(f: Filter): void {
    state.filter = f;
    filterButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
    apply();
  }

  function matches(t: TaskRow): boolean {
    if (state.category && t.category !== state.category) return false;
    if (state.query && !t.title.toLowerCase().includes(state.query) && !t.id.startsWith(state.query)) return false;
    switch (state.filter) {
      case 'solved':
        return t.status === 'solved';
      case 'attempted':
        return t.status === 'attempted' || t.status === 'pending';
      case 'none':
        return t.status === 'none';
      case 'bookmarked':
        return !!bookmarks[t.id];
      default:
        return true;
    }
  }

  function apply(): void {
    let shown = 0;
    for (const s of sections) {
      let visible = 0;
      for (const r of s.rows) {
        const ok = matches(r.task);
        r.row.hidden = !ok;
        if (ok) visible++;
      }
      s.el.hidden = visible === 0;
      shown += visible;
    }
    noResults.hidden = shown !== 0;
    resultCount.textContent = shown === all.length ? '' : `Showing ${shown} of ${all.length} problems`;
    resultCount.hidden = shown === all.length;
  }

  function syncBookmarks(): void {
    for (const r of refs) {
      const on = !!bookmarks[r.task.id];
      r.bm.classList.toggle('is-on', on);
      r.bm.setAttribute('aria-pressed', String(on));
      r.bm.setAttribute('aria-label', `${on ? 'Remove bookmark for' : 'Bookmark'} ${r.task.title}`);
    }
    bmCount.textContent = String(Object.keys(bookmarks).length);
    if (state.filter === 'bookmarked') apply();
    if (state.view === 'bookmarks') renderBookmarks();
  }

  async function toggleBookmark(t: TaskRow): Promise<void> {
    await store.toggleBookmark({ id: t.id, title: t.title, category: t.category });
  }

  store.onBookmarksChanged((next) => {
    bookmarks = next;
    syncBookmarks();
  });
  window.addEventListener('hashchange', () => setView(viewFromHash()));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !isTypingTarget(e.target) && state.view === 'problems') {
      e.preventDefault();
      search.focus();
    }
  });

  document.body.prepend(app);
  document.documentElement.classList.add('csesplus-on');
  setCategory(null, false);
  setFilter('all');
  syncBookmarks();
  setView(state.view);
  return true;
}
