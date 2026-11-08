import { Redirect, router } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, colors } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Index() {
  const { token, profile, role, online, refresh, signOut } = useSession();
  const [retrying, setRetrying] = useState(false);
  if (!token) return <Redirect href="/welcome" />;
  if (!profile && !online)
    return (
      <View style={local.splash}>
        <Image source={require('@/assets/logo.png')} style={local.logo} contentFit="contain" />
        <Text style={local.text}>PawSafe can't reach its database right now. Your account is saved on this device.</Text>
        <Button
          label="Try again"
          variant="outline"
          loading={retrying}
          onPress={async () => {
            setRetrying(true);
            try {
              await refresh();
            } catch {
              // Keep the offline recovery options available when retry fails.
            } finally {
              setRetrying(false);
            }
          }}
        />
        <Button label="Sign out" variant="ghost" onPress={signOut} />
        <Button label="Try a practice drill" variant="outline" icon="game-controller-outline" onPress={() => router.push('/practice')} />
      </View>
    );
  if (!profile) return <Redirect href={role === 'shelter' ? '/shelter-onboarding' : '/owner-onboarding'} />;
  return <Redirect href={role === 'shelter' ? '/dashboard' : '/rescue'} />;
}

const local = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  logo: { width: 140, height: 120 },
  text: { maxWidth: 440, color: colors.text, fontSize: 16, textAlign: 'center', lineHeight: 22 },
});
