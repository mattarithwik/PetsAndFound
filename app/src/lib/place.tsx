import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { currentPlace, type Place } from './location';
import { readJson, writeJson } from './storage';

const KEY = 'pawsafe.place';

type PlaceState = {
  place?: Place;
  locating: boolean;
  error?: string;
  locate(): Promise<Place | undefined>;
  setPlace(place: Place): void;
};

const PlaceContext = createContext<PlaceState | null>(null);

/** The user's working area for nearby searches, alerts and shelters. */
export function PlaceProvider({ children }: { children: ReactNode }) {
  const [place, setPlaceState] = useState<Place>();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    readJson<Place | undefined>(KEY, undefined).then((saved) => saved && setPlaceState(saved));
  }, []);

  const setPlace = useCallback((next: Place) => {
    setPlaceState(next);
    setError(undefined);
    writeJson(KEY, next);
  }, []);

  const locate = useCallback(async () => {
    setLocating(true);
    setError(undefined);
    try {
      const next = await currentPlace();
      setPlace(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  }, [setPlace]);

  const value = useMemo(() => ({ place, locating, error, locate, setPlace }), [place, locating, error, locate, setPlace]);
  return <PlaceContext.Provider value={value}>{children}</PlaceContext.Provider>;
}

export function usePlace() {
  const value = useContext(PlaceContext);
  if (!value) throw new Error('usePlace must be used inside PlaceProvider');
  return value;
}
