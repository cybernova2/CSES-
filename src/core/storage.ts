// All persistent state lives in chrome.storage.local on this device. Nothing is synced or sent anywhere.

export interface Bookmark {
  id: string;
  title: string;
  category: string;
  addedAt: number;
}

export interface IndexedTask {
  id: string;
  title: string;
  category: string;
  a: number | null;
  b: number | null;
}

export interface TaskIndex {
  updatedAt: number;
  tasks: IndexedTask[];
}

export interface Settings {
  lang: string;
  options: Record<string, string>;
  splitRatio: number;
  dockHeight: number;
}

export interface PendingSubmission {
  taskId: string;
  code: string;
  langId: string;
  optionId: string | null;
  filename: string;
  createdAt: number;
}

const DEFAULT_SETTINGS: Settings = { lang: 'cpp', options: {}, splitRatio: 0.44, dockHeight: 300 };

async function get<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}

function set(key: string, value: unknown): Promise<void> {
  return chrome.storage.local.set({ [key]: value });
}

export const store = {
  bookmarks: () => get<Record<string, Bookmark>>('bookmarks', {}),

  async toggleBookmark(b: Omit<Bookmark, 'addedAt'>): Promise<boolean> {
    const all = await store.bookmarks();
    const on = !all[b.id];
    if (on) all[b.id] = { ...b, addedAt: Date.now() };
    else delete all[b.id];
    await set('bookmarks', all);
    return on;
  },

  async removeBookmark(id: string): Promise<void> {
    const all = await store.bookmarks();
    delete all[id];
    await set('bookmarks', all);
  },

  onBookmarksChanged(cb: (all: Record<string, Bookmark>) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.bookmarks) cb((changes.bookmarks.newValue as Record<string, Bookmark>) ?? {});
    });
  },

  async settings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await get<Partial<Settings>>('settings', {})) };
  },

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    await set('settings', { ...(await store.settings()), ...patch });
  },

  taskIndex: () => get<TaskIndex | null>('taskIndex', null),
  saveTaskIndex: (tasks: IndexedTask[]) => set('taskIndex', { updatedAt: Date.now(), tasks } satisfies TaskIndex),

  draft: (taskId: string, langId: string) => get<string | null>(`draft:${taskId}:${langId}`, null),
  saveDraft: (taskId: string, langId: string, code: string) => set(`draft:${taskId}:${langId}`, code),

  setPendingSubmission: (p: PendingSubmission) => set('pendingSubmission', p),

  // Read once: the payload is deleted before it is used, so a reload can never submit twice.
  async takePendingSubmission(): Promise<PendingSubmission | null> {
    const p = await get<PendingSubmission | null>('pendingSubmission', null);
    if (p) await chrome.storage.local.remove('pendingSubmission');
    return p;
  },
};
