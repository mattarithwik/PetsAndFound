import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/components/ui';
import { ChatProvider } from '@/lib/chat';
import { PlaceProvider } from '@/lib/place';
import { SessionProvider } from '@/lib/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PlaceProvider>
          <ChatProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerTintColor: colors.navy,
                headerTitleStyle: { color: colors.text, fontWeight: '700' },
                headerStyle: { backgroundColor: colors.white },
                contentStyle: { backgroundColor: colors.bg },
                headerBackButtonDisplayMode: 'minimal',
              }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(owner)" options={{ headerShown: false, title: 'PawSafe' }} />
              <Stack.Screen name="(shelter)" options={{ headerShown: false, title: 'ShelterDash' }} />
              <Stack.Screen name="chat" options={{ title: 'Pawtricia', presentation: 'modal' }} />
            </Stack>
          </ChatProvider>
        </PlaceProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
