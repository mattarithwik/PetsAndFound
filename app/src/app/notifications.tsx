import { router, Stack, type Href } from 'expo-router';
import { useState } from 'react';

import { Button, Empty, ErrorNote, ListRow, Screen } from '@/components/ui';
import type { IconName } from '@/components/ui';
import { db, errorText } from '@/lib/api';
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
    default:
      return undefined;
  }
}

export default function Notifications() {
  const { token, role, notifications, unread, refreshNotifications } = useSession();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

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
    await markRead(n);
    refreshNotifications();
    const href = target(n);
    if (href) router.push(href);
  };

  const markAll = async () => {
    await Promise.all(notifications.filter((n) => !n.readAt).map(markRead));
    refreshNotifications();
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
      <ErrorNote error={error} />
      {unread ? <Button label="Mark all as read" variant="ghost" compact onPress={markAll} /> : null}
      {!notifications.length ? <Empty icon="notifications-outline" title="You're all caught up" body="Match suggestions, case updates and weather alerts will appear here." /> : null}
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
