import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { currentPlace, type Place } from './location';
import { useSession } from './session';
import { readJson, writeJson } from './storage';

type PlaceState = {
  place?: Place;
  locating: boolean;
  error?: string;
  locate(): Promise<Place | undefined>;
  setPlace(place: Place): void;
};

const PlaceContext = createContext<PlaceState | null>(null);

export function PlaceProvider({ children }: { children: ReactNode }) {
  const owner = useSession().profile?.id;
  const [selection, setSelection] = useState<{ owner?: string; place?: Place }>({});
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string>();
  const guestPlace = useRef<Place | undefined>(undefined);
  const revision = useRef(0);
  const place = selection.owner === owner ? selection.place : undefined;

  useEffect(() => {
    let active = true;
    const version = ++revision.current;
    setLocating(false);
    setError(undefined);
    if (!owner) {
      guestPlace.current = undefined;
      setSelection({});
      return;
    }
    const key = 'pawsafe.place.' + owner;
    const selectedDuringSetup = guestPlace.current;
    guestPlace.current = undefined;
    readJson<Place | undefined>(key, undefined).then((saved) => {
      if (!active || version !== revision.current) return;
      setSelection({ owner, place: saved ?? selectedDuringSetup });
      if (!saved && selectedDuringSetup)
        void writeJson(key, selectedDuringSetup).catch(() =>
          setError('Your area could not be saved on this device.'),
        );
    });
    return () => {
      active = false;
    };
  }, [owner]);

  const setPlace = useCallback(
    (next: Place) => {
      revision.current++;
      setSelection({ owner, place: next });
      setError(undefined);
      if (!owner) guestPlace.current = next;
      else
        void writeJson('pawsafe.place.' + owner, next).catch(() =>
          setError('Your area could not be saved on this device.'),
        );
    },
    [owner],
  );

  const locate = useCallback(async () => {
    const version = revision.current;
    setLocating(true);
    setError(undefined);
    try {
      const next = await currentPlace();
      if (version !== revision.current) return;
      setPlace(next);
      return next;
    } catch (e) {
      if (version === revision.current)
        setError(e instanceof Error ? e.message : 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  }, [setPlace]);

  const value = useMemo(
    () => ({ place, locating, error, locate, setPlace }),
    [place, locating, error, locate, setPlace],
  );
  return <PlaceContext.Provider value={value}>{children}</PlaceContext.Provider>;
}

export function usePlace() {
  const value = useContext(PlaceContext);
  if (!value) throw new Error('usePlace must be used inside PlaceProvider');
  return value;
}
