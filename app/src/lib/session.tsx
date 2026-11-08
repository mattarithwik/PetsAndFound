import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { db } from './api';
import { storage } from './storage';
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
  unread: number;
  online: boolean;
  activeShelterId?: string;
  setActiveShelter(id: string): void;
  createAccount(role: Role, profile: ProfileInput): Promise<void>;
  restore(role: Role, token: string): Promise<void>;
  saveProfile(profile: ProfileInput): Promise<void>;
  setRole(role: Role): Promise<void>;
  refresh(): Promise<void>;
  refreshNotifications(): Promise<void>;
  signOut(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

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
  const [online, setOnline] = useState(true);
  const [activeShelterId, setActiveShelter] = useState<string>();

  const load = useCallback(async (value: string) => {
    const [nextProfile, nextAccess] = await Promise.all([
      db.read<Profile | null>(value, 'profile'),
      db.read<Access>(value, 'access'),
    ]);
    setProfile(nextProfile);
    setAccess(nextAccess);
    setOnline(true);
    return nextProfile;
  }, []);

  useEffect(() => {
    (async () => {
      const [savedToken, savedRole] = await Promise.all([storage.get(TOKEN_KEY), storage.get(ROLE_KEY)]);
      if (savedToken) {
        setToken(savedToken);
        setRoleState((savedRole as Role) || 'owner');
        try {
          await load(savedToken);
        } catch {
          setOnline(false);
        }
      }
      setReady(true);
    })();
  }, [load]);

  const refreshNotifications = useCallback(async () => {
    if (!token || !profile) return;
    try {
      const rows = await db.read<AppNotification[]>(token, 'notifications');
      setNotifications(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [token, profile]);

  // Notifications are persistent records, so polling recovers anything missed while offline.
  useEffect(() => {
    if (!token || !profile) return;
    refreshNotifications();
    const timer = setInterval(refreshNotifications, 8000);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && refreshNotifications());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [token, profile, refreshNotifications]);

  const value = useMemo<Session>(
    () => ({
      ready,
      token,
      role,
      profile,
      access,
      notifications,
      unread: notifications.filter((n) => !n.readAt).length,
      online,
      activeShelterId,
      setActiveShelter,
      async createAccount(nextRole, input) {
        const identity = await db.createIdentity();
        await db.call(identity.token, 'register_user', profilePayload(input));
        await Promise.all([storage.set(TOKEN_KEY, identity.token), storage.set(ROLE_KEY, nextRole)]);
        setToken(identity.token);
        setRoleState(nextRole);
        await load(identity.token);
      },
      async restore(nextRole, value) {
        const trimmed = value.trim();
        const restored = await load(trimmed);
        if (!restored) throw new Error('No PawSafe profile is linked to that account key.');
        await Promise.all([storage.set(TOKEN_KEY, trimmed), storage.set(ROLE_KEY, nextRole)]);
        setToken(trimmed);
        setRoleState(nextRole);
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
        await Promise.all([storage.remove(TOKEN_KEY), storage.remove(ROLE_KEY)]);
        setToken(undefined);
        setRoleState(undefined);
        setProfile(null);
        setAccess(undefined);
        setNotifications([]);
        setActiveShelter(undefined);
      },
    }),
    [ready, token, role, profile, access, notifications, online, activeShelterId, load, refreshNotifications],
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
