// expo-secure-store has no web implementation; the browser build keeps the session in this tab only.
const store = typeof window !== 'undefined' ? window.sessionStorage : undefined;

export const storage = {
  get: async (key: string) => store?.getItem(key) ?? null,
  set: async (key: string, value: string) => store?.setItem(key, value),
  remove: async (key: string) => store?.removeItem(key),
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
