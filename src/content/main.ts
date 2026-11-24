import { applyTheme, currentTheme, watchTheme } from '../core/theme';
import { h } from '../core/dom';
import { runList } from './list';
import { runTask } from './task';
import { runPage } from './page';
import { runSubmit } from './submit';
import { enableForSession, isDisabledForSession } from './shell';

const root = document.documentElement;
const path = location.pathname;
const isList = /^\/problemset\/(list\/?)?$/.test(path);
const isTask = /^\/problemset\/task\/\d+\/?$/.test(path);
const isSubmit = /^\/problemset\/submit\/\d+\/?$/.test(path);

function failOpen(err: unknown): void {
  console.warn('[CSES+] Falling back to the original page:', err);
  document.getElementById('csesplus-app')?.remove();
  root.classList.remove('csesplus-on');
}

async function main(): Promise<void> {
  applyTheme(currentTheme());
  watchTheme(applyTheme);

  if (isDisabledForSession()) {
    document.body.append(h('button', { type: 'button', class: 'cp-off-pill', onClick: enableForSession }, 'CSES+ is off in this tab · Turn on'));
  } else {
    const ok = isList ? await runList() : isTask ? await runTask() : await runPage();
    if (!ok) failOpen('page structure not recognised');
  }
  // Finishing a submission the user confirmed works whether or not the page is restyled.
  if (isSubmit) await runSubmit();
}

main()
  .catch(failOpen)
  .finally(() => root.classList.remove('csesplus-pending'));
