// Every CSES selector lives here. If CSES changes its markup, this is the file to update.
// Verified against public HTML fetched 2026-11-22 unless marked UNVERIFIED (logged-in pages).

export const SEL = {
  // Shared shell
  darkFlag: 'script#darkmode-enabled', // JSON true/false, rewritten by CSES ui.js on toggle
  darkSheet: 'link#styles-dark',
  lightSheet: 'link#styles',
  darkToggle: '.header .controls a[href^="/darkmode"]',
  account: '.header .controls a.account', // "Login" -> /login when logged out; username -> /user/{id} when logged in
  logout: '.header .controls a[href*="/logout"]',

  // Problem Set list
  listHeading: '.content > h2',
  taskList: 'ul.task-list',
  taskItem: ':scope > li.task',
  taskLink: 'a[href*="/problemset/task/"]',
  taskDetail: 'span.detail', // "A / B", unlabelled by CSES
  taskScore: 'span.task-score', // modifier class: full (accepted) / zero (not accepted) — verified on logged-in pages

  // Task page
  taskTitle: '.title-block h1',
  taskTabs: '.title-block ul.nav a',
  constraints: 'ul.task-constraints li',
  statement: '.content > div.md',
  sidebar: '.nav.sidebar',

  // Generic CSES page parts
  titleBlock: '.title-block',
  content: '.content-wrapper > .content',

  // Submit page — verified against a logged-in /problemset/submit/{id}/ page (2026-11-23):
  // <form action="/course/send.php" enctype="multipart/form-data"> with csrf_token, task, file,
  // select#lang, select#option (filled by CSES's checkSelects() on window load / lang change), type, target.
  submitLang: 'select[name="lang"]',
  submitOption: 'select[name="option"]',
  submitFile: 'input[type="file"][name="file"]',
  submitCsrf: 'input[name="csrf_token"]',
  submitButton: 'input[type="submit"], button[type="submit"]',
} as const;

// Labels whose wording depends on facts not yet confirmed on CSES.
export const LABELS = {
  // The meaning of CSES's "A / B" pair has not been verified on a logged-in statistics page,
  // so the UI uses a neutral label. Change it here once it is verified.
  stats: 'CSES stats',
  statsTitle: 'The two numbers CSES shows next to each problem, as shown on cses.fi.',
} as const;

export const MAX_SOURCE_BYTES = 128 * 1024; // documented on https://cses.fi/howto/
