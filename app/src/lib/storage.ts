import * as SecureStore from 'expo-secure-store';

export const storage = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
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
