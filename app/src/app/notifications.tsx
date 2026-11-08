import { router, Stack, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { Button, Empty, ErrorNote, ListRow, Loading, Screen } from '@/components/ui';
import type { IconName } from '@/components/ui';
import { db, errorText } from '@/lib/api';
import { dailyTipsEnabled, deviceAlertsEnabled, disableDailyTips, disableDeviceAlerts, enableDailyTips, enableDeviceAlerts } from '@/lib/device-alerts';
import { notificationTitle, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AppNotification, NotificationType } from '@/lib/types';

const icons: Record<NotificationType, IconName> = {
  POSSIBLE_PET_MATCH: 'images-outline',
  MATCH_CONFIRMED: 'heart-outline',
  NEW_NEARBY_REPORT: 'location-outline',
  SHELTER_CASE_ASSIGNED: 'home-outline',
  SHELTER_CAPACITY_CHANGED: 'stats-chart-outline',
  REPORT_STATUS_CHANGED: 'refresh-outline',
  DISASTER_ALERT: 'warning-outline',
  RESPONSE_PLAN_READY: 'document-text-outline',
  CASE_MESSAGE: 'chatbubble-outline',
  URGENT_CASE: 'alert-circle-outline',
  CASE_OVERDUE: 'time-outline',
  MATCH_MESSAGE: 'chatbubbles-outline',
};

function detail(n: AppNotification) {
  const p = n.payload as Record<string, string | undefined>;
  switch (n.eventType) {
    case 'NEW_NEARBY_REPORT':
      return `${p.type === 'lost' ? 'Lost' : 'Found'} ${p.species ?? 'animal'} reported nearby`;
    case 'REPORT_STATUS_CHANGED':
      return p.status ? `Status changed to ${p.status.replace('_', ' ')}` : undefined;
    case 'DISASTER_ALERT':
      return p.event;
    case 'SHELTER_CASE_ASSIGNED':
      return 'A verified shelter accepted the animal you reported';
    case 'CASE_MESSAGE':
      return 'A case partner sent an update';
    case 'MATCH_MESSAGE':
      return 'A match partner sent an update';
    default:
      return undefined;
  }
}

export default function Notifications() {
  const { token, role, notifications, notificationStatus, unread, refreshNotifications, setRole, setActiveShelter } = useSession();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [tipsOn, setTipsOn] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  useEffect(() => { void Promise.all([deviceAlertsEnabled(), dailyTipsEnabled()]).then(([push, tips]) => { setPushOn(push); setTipsOn(tips); }); }, []);

  const toggleDevice = async (kind: 'push' | 'tips') => {
    if (deviceBusy) return;
    setDeviceBusy(true); setError(undefined);
    try {
      if (kind === 'push') {
        if (pushOn) { await disableDeviceAlerts(token!); setPushOn(false); }
        else { await enableDeviceAlerts(token!); setPushOn(true); }
      } else {
        if (tipsOn) { await disableDailyTips(); setTipsOn(false); }
        else { await enableDailyTips(); setTipsOn(true); }
      }
    } catch (e) { setError(errorText(e)); }
    finally { setDeviceBusy(false); }
  };

  const target = (n: AppNotification): Href | undefined => {
    const p = n.payload as Record<string, string | undefined>;
    if (p.matchId) return `/matches/${encodeURIComponent(p.matchId)}`;
    if (p.caseId) return role === 'shelter' ? `/cases/${p.caseId}` : `/reports/${p.caseId}`;
    if (p.reportId) return `/reports/${p.reportId}`;
    if (n.eventType === 'SHELTER_CAPACITY_CHANGED') return '/settings';
    if (n.eventType === 'DISASTER_ALERT') return role === 'shelter' ? '/dashboard' : '/prepare';
  };

  const markRead = async (n: AppNotification) => {
    if (n.readAt) return;
    try {
      await db.call(token!, 'mark_notification_read', { id: n.id });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const open = async (n: AppNotification) => {
    setError(undefined);
    await markRead(n);
    void refreshNotifications();
    if (n.eventType === 'SHELTER_CAPACITY_CHANGED') {
      if (typeof n.payload.shelterId === 'string') setActiveShelter(n.payload.shelterId);
      if (role !== 'shelter') await setRole('shelter');
    }
    const href = target(n);
    if (href) router.push(href);
  };

  const markAll = async () => {
    if (marking) return;
    setMarking(true);
    setError(undefined);
    try {
      for (const item of notifications.filter((n) => !n.readAt)) await markRead(item);
      await refreshNotifications();
    } finally {
      setMarking(false);
    }
  };

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await refreshNotifications();
        setRefreshing(false);
      }}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {Platform.OS !== 'web' ? <>
        <Button label={pushOn ? 'Turn off device alerts' : 'Enable device alerts'} variant="outline" loading={deviceBusy} onPress={() => { void toggleDevice('push'); }} />
        <Button label={tipsOn ? 'Turn off daily preparation tips' : 'Get daily preparation tips'} variant="ghost" loading={deviceBusy} onPress={() => { void toggleDevice('tips'); }} />
      </> : null}
      <ErrorNote error={error} />
      {unread ? <Button label="Mark all as read" variant="ghost" compact loading={marking} onPress={markAll} /> : null}
      {notificationStatus === 'loading' ? <Loading label="Loading notifications…" /> : null}
      {notificationStatus === 'unavailable' ? <ErrorNote error="PawSafe couldn’t check for new notifications." onRetry={refreshNotifications} /> : null}
      {!notifications.length && notificationStatus === 'ready' ? <Empty icon="notifications-outline" title="You're all caught up" body="Match suggestions, case updates and weather alerts will appear here." /> : null}
      {notifications.map((n) => (
        <ListRow
          key={n.id}
          icon={icons[n.eventType] ?? 'notifications-outline'}
          title={`${n.readAt ? '' : '● '}${notificationTitle[n.eventType] ?? n.eventType}`}
          detail={[detail(n), timeAgo(n.createdAt)].filter(Boolean).join(' · ')}
          onPress={() => open(n)}
        />
      ))}
    </Screen>
  );
}
