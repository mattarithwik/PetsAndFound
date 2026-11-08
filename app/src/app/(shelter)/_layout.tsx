import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import { colors, type IconName } from '@/components/ui';
import { useSession } from '@/lib/session';

function tabIcon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  }
  TabIcon.displayName = name;
  return TabIcon;
}

export default function ShelterLayout() {
  const { ready, token, profile } = useSession();
  if (!ready) return null;
  if (!token || !profile) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.sky,
        tabBarStyle: { borderTopColor: colors.baby, backgroundColor: colors.white },
        tabBarLabelStyle: { fontWeight: '700' },
      }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: tabIcon('grid-outline') }} />
      <Tabs.Screen name="cases" options={{ title: 'Cases', tabBarIcon: tabIcon('file-tray-full-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings-outline') }} />
    </Tabs>
  );
}
