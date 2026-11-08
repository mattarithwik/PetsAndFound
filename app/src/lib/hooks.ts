import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { errorText } from './api';

/**
 * Loads a resource while the screen is focused and re-polls it, so records changed by
 * other users, the matching worker or shelter staff appear without a manual refresh.
 */
export function useLive<T>(load: () => Promise<T>, key: string, intervalMs = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  const refresh = useCallback(async () => {
    try {
      const next = await loader.current();
      setData(next);
      setError(undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      if (!intervalMs) return;
      const timer = setInterval(refresh, intervalMs);
      const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
      return () => {
        clearInterval(timer);
        sub.remove();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh, intervalMs, key]),
  );

  return { data, error, loading, refresh, setData };
}

/** Runs one async action at a time and keeps its error for display. */
export function useAction() {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const run = useCallback(async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);
  return { busy, error, setError, run };
}
