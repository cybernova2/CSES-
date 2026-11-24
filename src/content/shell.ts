// Pieces shared by the Problem Set and workspace screens.
import { h } from '../core/dom';
import { icon } from '../core/icons';
import type { Auth, Status } from '../core/parse';
import { currentTheme, toggleTheme, watchTheme } from '../core/theme';

export const isDisabledForSession = () => sessionStorage.getItem('csesplus-off') === '1';

export function disableForSession(): void {
  sessionStorage.setItem('csesplus-off', '1');
  location.reload();
}

export function enableForSession(): void {
  sessionStorage.removeItem('csesplus-off');
  location.reload();
}

export function brand(compact = false): HTMLAnchorElement {
  return h(
    'a',
    { class: 'cp-brand', href: '/problemset/list/', 'aria-label': 'CSES+ Problem Set' },
    h('span', { class: 'cp-brand-mark', 'aria-hidden': 'true' }, '+'),
    h(
      'span',
      { class: 'cp-brand-text' },
      h('span', { class: 'cp-brand-name' }, 'CSES', h('span', { class: 'cp-brand-plus' }, '+')),
      compact ? null : h('span', { class: 'cp-brand-sub' }, 'for cses.fi'),
    ),
  );
}

export function statusIcon(status: Status): HTMLElement | null {
  const map: Partial<Record<Status, [Parameters<typeof icon>[0], string]>> = {
    solved: ['solved', 'Solved'],
    attempted: ['attempted', 'Attempted, not solved'],
    pending: ['pending', 'Pending'],
    none: ['notAttempted', 'Not attempted'],
  };
  const m = map[status];
  if (!m) return null;
  return h('span', { class: `cp-status is-${status}`, role: 'img', 'aria-label': m[1], title: m[1] }, icon(m[0], 18));
}

// Light/Dark segmented control bound to CSES's own setting.
export function themeSwitch(): HTMLElement {
  const make = (t: 'light' | 'dark') =>
    h(
      'button',
      { type: 'button', onClick: () => currentTheme() !== t && toggleTheme(), title: `${t === 'light' ? 'Light' : 'Dark'} theme (CSES setting)` },
      icon(t === 'light' ? 'sun' : 'moon', 15),
      h('span', { class: 'cp-seg-label' }, t === 'light' ? 'Light' : 'Dark'),
    );
  const light = make('light');
  const dark = make('dark');
  const sync = (t: 'light' | 'dark') => {
    light.setAttribute('aria-pressed', String(t === 'light'));
    dark.setAttribute('aria-pressed', String(t === 'dark'));
  };
  sync(currentTheme());
  watchTheme(sync);
  return h('div', { class: 'cp-seg cp-theme-seg', role: 'group', 'aria-label': 'Theme' }, light, dark);
}

export function themeButton(): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'cp-iconbtn cp-iconbtn-bordered', onClick: toggleTheme });
  const sync = (t: 'light' | 'dark') => {
    const label = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    btn.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon', 16));
    btn.setAttribute('aria-label', label);
    btn.title = `${label} (CSES setting)`;
  };
  sync(currentTheme());
  watchTheme(sync);
  return btn;
}

// Signed-in user: links to their CSES profile (/user/{id}) and CSES's own log-out link.
export function account(auth: Auth, compact = false): HTMLElement {
  if (!auth.loggedIn) {
    return h('a', { class: 'cp-btn cp-btn-secondary cp-btn-sm', href: '/login' }, 'Log in to CSES');
  }
  const name = auth.username ?? 'Profile';
  const profile = h(
    'a',
    { class: 'cp-account', href: auth.profileUrl ?? '#', title: `Your CSES profile (${name})`, 'aria-label': `Your CSES profile: ${name}` },
    h('span', { class: 'cp-avatar', 'aria-hidden': 'true' }, name.charAt(0).toUpperCase()),
    compact
      ? null
      : h('span', { class: 'cp-account-text' }, h('span', { class: 'cp-account-name' }, name), h('span', { class: 'cp-account-sub' }, 'View profile')),
  );
  const logout = auth.logoutUrl
    ? h('a', { class: 'cp-iconbtn', href: auth.logoutUrl, title: 'Log out of CSES', 'aria-label': 'Log out of CSES' }, icon('logout', 16))
    : null;
  return h('div', { class: `cp-account-group${compact ? ' is-compact' : ''}` }, profile, logout);
}

export interface Crumb {
  label: string;
  href?: string;
  cls?: string;
}

// Shared top bar for the workspace and every other CSES page.
export function topbar(auth: Auth, crumbs: Crumb[], extras: (Node | null)[] = []): HTMLElement {
  const parts: Node[] = [];
  crumbs.forEach((c, i) => {
    const last = i === crumbs.length - 1;
    if (i > 0) parts.push(h('span', { class: `cp-crumb-sep ${c.cls ?? ''}`, 'aria-hidden': 'true' }, '/'));
    parts.push(
      last
        ? h('span', { class: `cp-crumb-current ${c.cls ?? ''}`, 'aria-current': 'page' }, c.label)
        : c.href
          ? h('a', { href: c.href, class: c.cls }, c.label)
          : h('span', { class: c.cls }, c.label),
    );
  });
  return h(
    'header',
    { class: 'cp-topbar' },
    brand(true),
    h('span', { class: 'cp-vsep', 'aria-hidden': 'true' }),
    h('nav', { class: 'cp-crumbs', 'aria-label': 'Breadcrumb' }, parts),
    h('span', { class: 'cp-spacer' }),
    extras,
    h('a', { class: 'cp-iconbtn cp-iconbtn-bordered', href: '/problemset/list/#bookmarks', 'aria-label': 'Bookmarks', title: 'Bookmarks' }, icon('bookmarks', 16)),
    themeButton(),
    account(auth, true),
    originalPageButton(true),
  );
}

export function originalPageButton(compact = false): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: compact ? 'cp-iconbtn cp-iconbtn-bordered' : 'cp-btn cp-btn-ghost cp-btn-sm', onClick: disableForSession, title: 'Show the original CSES page in this tab', 'aria-label': 'Show original CSES page' },
    icon('external', 14),
    compact ? null : 'Original page',
  );
}

export async function copyText(text: string, btn: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const label = btn.querySelector('.cp-copy-label');
    if (label) {
      label.textContent = 'Copied';
      setTimeout(() => (label.textContent = 'Copy'), 1500);
    }
  } catch {
    /* clipboard blocked: nothing else to do */
  }
}

export function copyButton(getText: () => string, ariaLabel: string): HTMLButtonElement {
  const btn: HTMLButtonElement = h(
    'button',
    { type: 'button', class: 'cp-copy', 'aria-label': ariaLabel, onClick: () => copyText(getText(), btn) },
    icon('copy', 13),
    h('span', { class: 'cp-copy-label' }, 'Copy'),
  );
  return btn;
}
