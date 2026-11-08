import { useEffect, useRef, useState } from 'react';

import { useSession } from './session';
import { readJson, storage, writeJson } from './storage';

/**
 * A report draft survives app restarts and keeps the same report ID and submission key,
 * so a retry after a dropped connection can never create a duplicate report.
 */
export function useDraft<T extends object>(name: string, create: () => T) {
  const { profile } = useSession();
  const key = profile ? `pawsafe.draft.${profile.id}.${name}` : undefined;
  const [current, setCurrent] = useState<{ key: string; value: T }>();
  const latest = useRef(current);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const [storageError, setStorageError] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (!key) return;
    readJson<T | undefined>(key, undefined).then((saved) => {
      if (!alive) return;
      latest.current = { key, value: saved ?? create() };
      setCurrent(latest.current);
    });
    return () => {
      alive = false;
    };
  }, [key, create]);
  const update = (patch: Partial<T>) => {
    if (!key || latest.current?.key !== key) return;
    const next = { ...latest.current.value, ...patch };
    latest.current = { key, value: next };
    setCurrent(latest.current);
    writes.current = writes.current
      .then(() => writeJson(key, next))
      .then(
        () => setStorageError(undefined),
        () => setStorageError('This draft is available in this screen only. Your device could not save a copy.'),
      );
  };
  const clear = async () => {
    if (!key) return;
    await writes.current;
    await storage.remove(key);
    latest.current = { key, value: create() };
    setCurrent(latest.current);
  };
  return { draft: current?.key === key ? current?.value : undefined, update, clear, storageError };
}
