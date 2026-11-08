import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { View, type ColorValue } from 'react-native';

import { ChatFab } from '@/components/chat-fab';
import { colors, type IconName } from '@/components/ui';
import { useSession } from '@/lib/session';

function tabIcon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  }
  TabIcon.displayName = name;
  return TabIcon;
}

export default function OwnerLayout() {
  const { ready, token, profile } = useSession();
  if (!ready) return null;
  if (!token || !profile) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.navy,
          tabBarInactiveTintColor: colors.sky,
          tabBarStyle: { borderTopColor: colors.baby, backgroundColor: colors.white },
          tabBarLabelStyle: { fontWeight: '700' },
        }}>
        <Tabs.Screen name="rescue" options={{ title: 'Rescue', tabBarIcon: tabIcon('home-outline') }} />
        <Tabs.Screen name="prepare" options={{ title: 'Prepare', tabBarIcon: tabIcon('shield-checkmark-outline') }} />
        <Tabs.Screen name="simulation" options={{ title: 'Simulation', tabBarIcon: tabIcon('game-controller-outline') }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('paw-outline') }} />
      </Tabs>
      <ChatFab />
    </View>
  );
}
