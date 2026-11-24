// Runs on /problemset/submit/{id}/. Acts only when the user has just confirmed a submission in the
// CSES+ workspace. It fills CSES's own form (language, version, file) and submits that form, so CSES's
// session, CSRF token and checks apply exactly as when submitting by hand. CSES+ never builds its own request.
//
// Verified CSES behaviour this relies on (logged-in submit page, 2026-11-23):
// - select#lang holds values like "C++", "Python3", "Java", "Rust", "Node.js", "C".
// - select#option is filled by CSES's checkSelects(), which runs on window load and on lang "change".
// - The file input's onchange="check(this)" guesses the language from the file name (and, for .py,
//   rewrites it asynchronously). CSES+ sets the language explicitly, so it does not fire that event.
import { h } from '../core/dom';
import { findLang, normalize } from '../core/languages';
import { parseAuth } from '../core/parse';
import { SEL } from '../core/selectors';
import { store } from '../core/storage';

const MAX_AGE_MS = 2 * 60 * 1000;

function banner(kind: 'info' | 'error', message: string, taskId?: string): void {
  document.getElementById('csesplus-banner')?.remove();
  document.body.append(
    h(
      'div',
      { id: 'csesplus-banner', class: `cp-banner is-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      h('strong', {}, 'CSES+ '),
      message,
      taskId && kind === 'error' ? h('a', { href: `/problemset/task/${taskId}` }, ' Back to the editor') : null,
    ),
  );
}

const pageLoaded = () =>
  document.readyState === 'complete' ? Promise.resolve() : new Promise<void>((r) => window.addEventListener('load', () => r(), { once: true }));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function runSubmit(): Promise<void> {
  const pending = await store.takePendingSubmission(); // removed before use: never submits twice
  if (!pending) return;

  const taskId = /^\/problemset\/submit\/(\d+)\/?$/.exec(location.pathname)?.[1];
  const keep = 'Your code is still saved as a draft in the CSES+ editor.';
  if (pending.taskId !== taskId) return; // belongs to another problem; ignore it
  if (Date.now() - pending.createdAt > MAX_AGE_MS) {
    banner('error', `The confirmed submission expired before this page opened, so nothing was submitted. ${keep}`, taskId);
    return;
  }
  if (!parseAuth(document).loggedIn) {
    banner('error', `You are not logged in to CSES, so nothing was submitted. ${keep}`, taskId);
    return;
  }

  // CSES wires up its language/version logic on window load; wait for it.
  await pageLoaded();
  await tick();

  const langSelect = document.querySelector<HTMLSelectElement>(SEL.submitLang);
  const form = langSelect?.form ?? null;
  const fileInput = form?.querySelector<HTMLInputElement>(SEL.submitFile) ?? null;
  if (!form || !langSelect || !fileInput || !form.querySelector(SEL.submitCsrf)) {
    banner('error', `This CSES submit form looks different from what CSES+ expects, so nothing was submitted. Please use the form below. ${keep}`, taskId);
    return;
  }

  const lang = findLang(pending.langId);
  if (!lang) {
    banner('error', `Unknown language, so nothing was submitted. ${keep}`, taskId);
    return;
  }
  // Some tasks have a fixed language (CSES disables the select); then CSES decides.
  if (!langSelect.disabled) {
    const langOpt = Array.from(langSelect.options).find((o) => lang.csesNames.includes(normalize(o.value)) || lang.csesNames.includes(normalize(o.text)));
    if (!langOpt) {
      banner('error', `CSES does not offer ${lang.label} for this problem, so nothing was submitted. ${keep}`, taskId);
      return;
    }
    langSelect.value = langOpt.value;
    langSelect.dispatchEvent(new Event('change', { bubbles: true })); // CSES refills select#option
    await tick(30);
  }

  const optSelect = form.querySelector<HTMLSelectElement>(SEL.submitOption);
  const wanted = lang.options?.find((o) => o.id === pending.optionId);
  if (optSelect && !optSelect.disabled && wanted) {
    const match = Array.from(optSelect.options).find((o) => wanted.matches(o.value) || wanted.matches(o.text));
    if (!match) {
      banner('error', `CSES does not offer ${wanted.label} here, so nothing was submitted. ${keep}`, taskId);
      return;
    }
    optSelect.value = match.value;
  }

  // The supported way to give a file input a value from script: a DataTransfer-backed FileList.
  const dt = new DataTransfer();
  dt.items.add(new File([pending.code], pending.filename, { type: 'text/plain' }));
  fileInput.files = dt.files;
  if (fileInput.files?.length !== 1) {
    banner('error', `CSES+ could not attach the file, so nothing was submitted. ${keep}`, taskId);
    return;
  }

  banner('info', `Submitting ${pending.filename} through the CSES form, as you confirmed…`);
  const submitter = form.querySelector<HTMLInputElement | HTMLButtonElement>(SEL.submitButton);
  form.requestSubmit(submitter ?? undefined);
}
