// Monaco editor page, loaded in an iframe on CSES task pages. It only talks to its parent cses.fi page.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js';
import { runLocal, type RunRequest } from '../run/runner';

const PARENT_ORIGIN = 'https://cses.fi';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorkerUrl: () => './editor.worker.js',
};

monaco.editor.defineTheme('csesplus-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'C792EA' },
    { token: 'type', foreground: '82AAFF' },
    { token: 'string', foreground: 'F2C47E' },
    { token: 'number', foreground: 'F78C6C' },
    { token: 'comment', foreground: '6E8278', fontStyle: 'italic' },
    { token: 'keyword.directive', foreground: 'FF9CAC' },
    { token: 'delimiter', foreground: 'B3C2BA' },
    { token: 'identifier', foreground: 'E7EEEA' },
  ],
  colors: {
    'editor.background': '#0A0F0C',
    'editor.foreground': '#E7EEEA',
    'editorGutter.background': '#0A0F0C',
    'editorLineNumber.foreground': '#4F6158',
    'editorLineNumber.activeForeground': '#B3C2BA',
    'editor.lineHighlightBackground': '#111B16',
    'editor.lineHighlightBorder': '#111B16',
    'editorCursor.foreground': '#34D399',
    'editor.selectionBackground': '#1F4D3B',
    'editorIndentGuide.background1': '#1A2520',
    'editorWidget.background': '#121A16',
    'editorWidget.border': '#25332C',
  },
});

monaco.editor.defineTheme('csesplus-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '7C3AED' },
    { token: 'type', foreground: '1D4ED8' },
    { token: 'string', foreground: 'A16207' },
    { token: 'number', foreground: 'C2410C' },
    { token: 'comment', foreground: '6B7B72', fontStyle: 'italic' },
    { token: 'keyword.directive', foreground: 'BE185D' },
    { token: 'delimiter', foreground: '3E4F46' },
    { token: 'identifier', foreground: '0E1A14' },
  ],
  colors: {
    'editor.background': '#FCFDFC',
    'editor.foreground': '#0E1A14',
    'editorGutter.background': '#FCFDFC',
    'editorLineNumber.foreground': '#8A9A91',
    'editorLineNumber.activeForeground': '#0E1A14',
    'editor.lineHighlightBackground': '#EEF6F1',
    'editor.lineHighlightBorder': '#EEF6F1',
    'editorCursor.foreground': '#0A6B3D',
    'editor.selectionBackground': '#CDEBD9',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#E1E8E4',
  },
});

const themeName = (t: unknown) => (t === 'dark' ? 'csesplus-dark' : 'csesplus-light');
const post = (msg: Record<string, unknown>) => parent.postMessage(msg, PARENT_ORIGIN);

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let changeTimer: ReturnType<typeof setTimeout> | undefined;

function create(code: string, language: string, theme: unknown): void {
  editor = monaco.editor.create(document.getElementById('root')!, {
    value: code,
    language,
    theme: themeName(theme),
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Consolas, monospace",
    fontSize: 13.5,
    lineHeight: 22,
    tabSize: 4,
    insertSpaces: true,
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    renderLineHighlight: 'line',
    smoothScrolling: true,
    fixedOverflowWidgets: true,
    // No language services ship with CSES+, so word-based suggestions are the only completions.
    wordBasedSuggestions: 'currentDocument',
  });
  editor.onDidChangeModelContent(() => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => post({ type: 'change', code: editor!.getValue() }), 400);
  });
  editor.onDidChangeCursorPosition((e) => post({ type: 'cursor', line: e.position.lineNumber, col: e.position.column }));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => post({ type: 'submitShortcut' }));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Quote, () => post({ type: 'runShortcut' }));
  editor.focus();
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== PARENT_ORIGIN || e.source !== parent) return;
  const m = e.data as { type?: string; code?: string; language?: string; theme?: string; reqId?: number; run?: RunRequest };
  switch (m?.type) {
    case 'run': {
      // Local Run happens here, in the extension origin, so the language workers and packaged runtimes are reachable.
      const reqId = m.reqId;
      void runLocal(m.run!, (text) => post({ type: 'runStatus', reqId, text }))
        .then((report) => post({ type: 'runResult', reqId, report }))
        .catch((err) => post({ type: 'runResult', reqId, report: { supported: true, compiled: false, diagnostics: String(err?.message ?? err), cases: [] } }));
      break;
    }
    case 'init':
      if (!editor) create(m.code ?? '', m.language ?? 'cpp', m.theme);
      break;
    case 'setTheme':
      monaco.editor.setTheme(themeName(m.theme));
      break;
    case 'setLanguage': {
      const model = editor?.getModel();
      if (model) monaco.editor.setModelLanguage(model, m.language ?? 'plaintext');
      editor?.setValue(m.code ?? '');
      break;
    }
    case 'setCode':
      editor?.setValue(m.code ?? '');
      break;
    case 'getCode':
      post({ type: 'code', reqId: m.reqId, code: editor?.getValue() ?? '' });
      break;
  }
});

post({ type: 'ready' });
