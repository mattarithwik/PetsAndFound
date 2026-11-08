import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/components/ui';
import { ChatFab } from '@/components/chat-fab';
import { ChatProvider } from '@/lib/chat';
import { PlaceProvider } from '@/lib/place';
import { SessionProvider, useSession } from '@/lib/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PlaceProvider>
          <ChatProvider>
            <Navigator />
          </ChatProvider>
        </PlaceProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const { ready, profile, token } = useSession();
  if (!ready)
    return (
      <View style={{ flex: 1, backgroundColor: colors.baby, alignItems: 'center', justifyContent: 'center' }}>
        <Image
          source={require('@/assets/logo.png')}
          style={{ width: 164, height: 120 }}
          contentFit="contain"
          accessibilityLabel="PawSafe"
        />
      </View>
    );
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: colors.navy,
          headerTitleStyle: { color: colors.text, fontWeight: '700' },
          headerStyle: { backgroundColor: colors.white },
          contentStyle: { backgroundColor: colors.bg },
          headerBackButtonDisplayMode: 'minimal',
          headerRight: profile ? () => <ChatFab header /> : undefined,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="practice" options={{ title: 'Practice arcade' }} />
        <Stack.Protected guard={!!token && !!profile}>
          <Stack.Screen name="(owner)" options={{ headerShown: false, title: 'PawSafe' }} />
          <Stack.Screen name="(shelter)" options={{ headerShown: false, title: 'ShelterDash' }} />
          <Stack.Screen name="chat" options={{ title: 'Pawtricia', presentation: 'modal', headerShown: true, headerRight: () => null }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="pets/new" options={{ title: 'Register a pet' }} />
          <Stack.Screen name="pets/[id]" options={{ title: 'Pet profile' }} />
          <Stack.Screen name="report/lost" options={{ title: 'Lost pet' }} />
          <Stack.Screen name="report/found" options={{ title: 'Found animal' }} />
          <Stack.Screen name="reports/[id]" options={{ title: 'Report' }} />
          <Stack.Screen name="cases/[id]" options={{ title: 'Rescue case' }} />
          <Stack.Screen name="registry" options={{ title: 'Shelter registry' }} />
          <Stack.Screen name="matches/[id]" options={{ title: 'Possible match' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
