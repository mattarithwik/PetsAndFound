import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, type IconName } from '@/components/ui';
import { ChatFab } from '@/components/chat-fab';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';

function tabIcon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  }
  TabIcon.displayName = name;
  return TabIcon;
}

export default function ShelterLayout() {
  const insets = useSafeAreaInsets();
  const { ready, token, profile, role } = useSession();
  if (!ready) return null;
  if (!token || !profile || role !== 'shelter') return <Redirect href="/" />;
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenListeners={{ tabPress: () => feedback('selection') }}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.navy,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { height: 62 + insets.bottom, paddingTop: 3, paddingBottom: 5 + insets.bottom, borderTopColor: colors.border, backgroundColor: colors.white },
          tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
        }}>
        <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: tabIcon('grid-outline') }} />
        <Tabs.Screen name="cases" options={{ title: 'Cases', tabBarIcon: tabIcon('file-tray-full-outline') }} />
        <Tabs.Screen name="command" options={{ title: 'Command', tabBarIcon: tabIcon('map-outline') }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings-outline') }} />
      </Tabs>
      <ChatFab />
    </View>
  );
}
