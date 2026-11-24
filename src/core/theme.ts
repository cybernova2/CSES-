// CSES's own dark-mode setting is the single source of truth.
// CSES stores it server-side and mirrors it into <script id="darkmode-enabled">, which ui.js rewrites on toggle.
import { parseTheme, type Theme } from './parse';
import { SEL } from './selectors';

export function currentTheme(): Theme {
  return parseTheme(document);
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.csesplusTheme = t;
}

export function watchTheme(cb: (t: Theme) => void): void {
  let last = currentTheme();
  const check = () => {
    const t = currentTheme();
    if (t !== last) {
      last = t;
      cb(t);
    }
  };
  const mo = new MutationObserver(check);
  const flag = document.querySelector(SEL.darkFlag);
  if (flag) mo.observe(flag, { childList: true, characterData: true, subtree: true });
  document.addEventListener('theme-changed', check);
}

// Toggle through CSES itself: activating its own dark-mode link runs CSES's toggle_theme(),
// which swaps its stylesheets and saves the choice on the server.
export function toggleTheme(): void {
  const link = document.querySelector<HTMLAnchorElement>(SEL.darkToggle);
  if (link) {
    link.click();
    return;
  }
  // Fallback: the same request CSES's ui.js makes, then mirror the flag so every observer updates.
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  void fetch(`/darkmode?noredir=true&set=${next === 'dark'}`, { credentials: 'same-origin' }).then(() => {
    const flag = document.querySelector(SEL.darkFlag);
    if (flag) flag.textContent = String(next === 'dark');
    applyTheme(next);
  });
}
