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
import { AppState } from 'react-native';

import { account, ApiError, db } from './api';
import { startRealtime } from './realtime';
import { storage } from './storage';
import { unregisterOnSignOut } from './device-alerts';
import type { Access, AppNotification, Profile, Role } from './types';

const TOKEN_KEY = 'pawsafe.token';
const ROLE_KEY = 'pawsafe.role';

type ProfileInput = Pick<Profile, 'name'> & Partial<Omit<Profile, 'id' | 'name'>>;

type Session = {
  ready: boolean;
  token?: string;
  role?: Role;
  profile: Profile | null;
  access?: Access;
  notifications: AppNotification[];
  notificationStatus: 'loading' | 'ready' | 'unavailable';
  unread: number;
  online: boolean;
  activeShelterId?: string;
  setActiveShelter(id: string): void;
  createAccount(role: Role, profile: ProfileInput, username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  setCredentials(username: string, password: string): Promise<void>;
  restore(role: Role, token: string): Promise<void>;
  saveProfile(profile: ProfileInput): Promise<void>;
  setRole(role: Role): Promise<void>;
  refresh(): Promise<void>;
  refreshNotifications(): Promise<void>;
  signOut(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

async function snapshot(token: string) {
  const [profile, access] = await Promise.all([
    db.read<Profile | null>(token, 'profile'),
    db.read<Access>(token, 'access'),
  ]);
  return { profile, access };
}

function profilePayload(p: ProfileInput) {
  return {
    name: p.name.trim(),
    ...(p.generalLocation?.trim() ? { generalLocation: p.generalLocation.trim() } : {}),
    ...(p.contactPreferences?.trim() ? { contactPreferences: p.contactPreferences.trim() } : {}),
    ...(p.emergencyContact?.trim() ? { emergencyContact: p.emergencyContact.trim() } : {}),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string>();
  const [role, setRoleState] = useState<Role>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [access, setAccess] = useState<Access>();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationStatus, setNotificationStatus] = useState<Session['notificationStatus']>('loading');
  const [online, setOnline] = useState(true);
  const [activeShelterId, setActiveShelter] = useState<string>();
  const currentToken = useRef<string | undefined>(undefined);
  const loadNumber = useRef(0);
  const notificationNumber = useRef(0);
  const profileId = profile?.id;

  const remember = useCallback(async (value: string, nextRole: Role) => {
    await Promise.all([storage.set(TOKEN_KEY, value), storage.set(ROLE_KEY, nextRole)]);
    currentToken.current = value;
    setToken(value);
    setRoleState(nextRole);
  }, []);

  const load = useCallback(async (value: string) => {
    const attempt = ++loadNumber.current;
    const next = await snapshot(value);
    if (currentToken.current === value && attempt === loadNumber.current) {
      setProfile(next.profile);
      setAccess(next.access);
      setOnline(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const [savedToken, savedRole] = await Promise.all([storage.get(TOKEN_KEY), storage.get(ROLE_KEY)]);
      if (active && savedToken) {
        currentToken.current = savedToken;
        setToken(savedToken);
        setRoleState(savedRole === 'shelter' ? 'shelter' : 'owner');
        try {
          await load(savedToken);
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            // A key from the old server cannot be retried against the cloud server.
            // Return to sign-in instead of trapping the user on the offline screen.
            await Promise.all([storage.remove(TOKEN_KEY), storage.remove(ROLE_KEY)]);
            if (active) {
              currentToken.current = undefined;
              setToken(undefined);
              setRoleState(undefined);
              setOnline(true);
            }
          } else setOnline(false);
        }
      }
    })()
      .catch(() => setOnline(false))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [load]);

  const refreshNotifications = useCallback(async () => {
    if (!token || !profileId) return;
    const attempt = ++notificationNumber.current;
    try {
      const rows = await db.read<AppNotification[]>(token, 'notifications');
      if (currentToken.current !== token || attempt !== notificationNumber.current) return;
      setNotifications(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setNotificationStatus('ready');
      setOnline(true);
    } catch {
      if (currentToken.current === token && attempt === notificationNumber.current) {
        setOnline(false);
        setNotificationStatus('unavailable');
      }
    }
  }, [token, profileId]);

  useEffect(() => {
    if (!ready || !token || profileId || online) return;
    const reconnect = () => {
      void load(token).catch(() => undefined);
    };
    const timer = setInterval(reconnect, 10000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconnect();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [ready, token, profileId, online, load]);

  useEffect(() => {
    if (!token || !profileId) return;
    const refreshAccess = () =>
      load(token).catch(() => {
        if (currentToken.current === token) setOnline(false);
      });
    const refreshAll = () => {
      void refreshNotifications();
      void refreshAccess();
    };
    const stop = startRealtime(token, (tables) => {
      if (tables.has('my_notifications')) void refreshNotifications();
      if (
        ['my_profile', 'my_staff_roles', 'my_shelter_verifications', 'shelters'].some((name) =>
          tables.has(name),
        )
      )
        void refreshAccess();
    });
    void refreshNotifications();
    const timer = setInterval(refreshAll, 20000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAll();
    });
    return () => {
      stop();
      clearInterval(timer);
      sub.remove();
    };
  }, [token, profileId, load, refreshNotifications]);

  const value = useMemo<Session>(
    () => ({
      ready,
      token,
      role,
      profile,
      access,
      notifications,
      notificationStatus,
      unread: notifications.filter((n) => !n.readAt).length,
      online,
      activeShelterId,
      setActiveShelter,
      async createAccount(nextRole, input, username, password) {
        // Save the identity before registering. A dropped acknowledgement can safely be retried.
        const value = currentToken.current || (await db.createIdentity()).token;
        await remember(value, nextRole);
        await db.call(value, 'register_user', profilePayload(input));
        await account.setPassword(value, username.trim(), password, nextRole);
        await load(value);
      },
      async signIn(username, password) {
        const signed = await account.signIn(username.trim(), password);
        const restored = await snapshot(signed.token);
        if (!restored.profile) throw new Error('Account profile is unavailable.');
        await remember(signed.token, signed.role);
        setProfile(restored.profile);
        setAccess(restored.access);
        setNotifications([]);
        setNotificationStatus('loading');
        setActiveShelter(undefined);
        setOnline(true);
      },
      async setCredentials(username, password) {
        if (!token) throw new Error('Sign in first.');
        await account.setPassword(token, username.trim(), password, role ?? 'owner');
      },
      async restore(nextRole, value) {
        let trimmed = value.trim().replace(/^Bearer\s+/i, '');
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) trimmed = trimmed.slice(1, -1);
        let restored;
        try { restored = await snapshot(trimmed); }
        catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403 || /invalid.*signature|invalid token/i.test(error.message)))
            throw new Error('This account key is not valid for this PawSafe server. Check the app URL and copy only the key value.');
          throw error;
        }
        if (!restored.profile) throw new Error('No PawSafe profile is linked to that account key.');
        await remember(trimmed, nextRole);
        setProfile(restored.profile);
        setAccess(restored.access);
        setNotifications([]);
        setNotificationStatus('loading');
        setActiveShelter(undefined);
        setOnline(true);
      },
      async saveProfile(input) {
        if (!token) throw new Error('Sign in first.');
        await db.call(token, 'register_user', profilePayload(input));
        await load(token);
      },
      async setRole(nextRole) {
        await storage.set(ROLE_KEY, nextRole);
        setRoleState(nextRole);
      },
      async refresh() {
        if (token) await load(token);
      },
      refreshNotifications,
      async signOut() {
        if (token) await unregisterOnSignOut(token);
        await Promise.all([storage.remove(TOKEN_KEY), storage.remove(ROLE_KEY)]);
        currentToken.current = undefined;
        setToken(undefined);
        setRoleState(undefined);
        setProfile(null);
        setAccess(undefined);
        setNotifications([]);
        setNotificationStatus('loading');
        setActiveShelter(undefined);
      },
    }),
    [
      ready,
      token,
      role,
      profile,
      access,
      notifications,
      notificationStatus,
      online,
      activeShelterId,
      load,
      remember,
      refreshNotifications,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}

/** For screens that only render once signed in. */
export function useToken() {
  const { token } = useSession();
  return token ?? '';
}
