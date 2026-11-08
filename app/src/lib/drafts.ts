import { useEffect, useState } from 'react';

import { readJson, storage, writeJson } from './storage';

/**
 * A report draft survives app restarts and keeps the same report ID and submission key,
 * so a retry after a dropped connection can never create a duplicate report.
 */
export function useDraft<T extends object>(name: string, create: () => T) {
  const key = `pawsafe.draft.${name}`;
  const [draft, setDraftState] = useState<T>();
  useEffect(() => {
    readJson<T | undefined>(key, undefined).then((saved) => setDraftState(saved ?? create()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = (patch: Partial<T>) =>
    setDraftState((current) => {
      const next = { ...(current ?? create()), ...patch };
      writeJson(key, next);
      return next;
    });
  const clear = async () => {
    await storage.remove(key);
    setDraftState(create());
  };
  return { draft, update, clear };
}
