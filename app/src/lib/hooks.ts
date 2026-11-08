import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { errorText } from './api';
import { watchTables, type LiveTable } from './realtime';

/**
 * Loads a resource while the screen is focused and re-polls it, so records changed by
 * other users, the matching worker or shelter staff appear without a manual refresh.
 */
export function useLive<T>(load: () => Promise<T>, key: string, intervalMs = 0, tables: readonly LiveTable[] = []) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>();
  const loader = useRef(load);
  const request = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    loader.current = load;
  });

  const refresh = useCallback(async () => {
    const version = ++request.current;
    inFlight.current = true;
    try {
      const next = await loader.current();
      if (request.current === version) setResult({ key, data: next });
    } catch (e) {
      if (request.current === version)
        setResult((prev) => ({ key, data: prev?.key === key ? prev.data : undefined, error: errorText(e) }));
    } finally {
      if (request.current === version) inFlight.current = false;
    }
  }, [key]);

  const topics = tables.join(',');
  useFocusEffect(
    useCallback(() => {
      void refresh();
      let pending: ReturnType<typeof setTimeout> | undefined;
      const names = topics.split(',');
      const stop = topics
        ? watchTables((changed) => {
            if (!names.some((name) => changed.has(name)) || pending) return;
            pending = setTimeout(() => {
              pending = undefined;
              void refresh();
            }, 100);
          })
        : undefined;
      const timer = intervalMs
        ? setInterval(() => {
            if (!inFlight.current) void refresh();
          }, intervalMs)
        : undefined;
      const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
      return () => {
        request.current++;
        clearTimeout(pending);
        clearInterval(timer);
        stop?.();
        sub.remove();
      };
    }, [refresh, intervalMs, topics]),
  );

  const current = result?.key === key ? result : undefined;
  return { data: current?.data, error: current?.error, loading: !current, refresh };
}

/** Runs one async action at a time and keeps its error for display. */
export function useAction() {
  const [busy, setBusy] = useState<string>();
  const running = useRef(false);
  const [error, setError] = useState<string>();
  const run = useCallback(async (name: string, action: () => Promise<void>) => {
    if (running.current) return false;
    running.current = true;
    setBusy(name);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      running.current = false;
      setBusy(undefined);
    }
  }, []);
  return { busy, error, setError, run };
}
