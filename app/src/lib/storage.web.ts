// Keep credentials and precise locations in the tab. Drills and supply checklists persist on this browser.
function store(key: string) {
  if (typeof window === 'undefined') return undefined;
  return key.startsWith('pawsafe.drills.') || key.startsWith('pawsafe.checklist.')
    ? window.localStorage
    : window.sessionStorage;
}

export const storage = {
  get: async (key: string) => {
    const value = store(key)?.getItem(key);
    // A browser session from an earlier app version may still hold its practice history.
    return value ?? (typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null);
  },
  set: async (key: string, value: string) => store(key)?.setItem(key, value),
  remove: async (key: string) => {
    store(key)?.removeItem(key);
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(key);
  },
};

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const writeJson = (key: string, value: unknown) => storage.set(key, JSON.stringify(value));
