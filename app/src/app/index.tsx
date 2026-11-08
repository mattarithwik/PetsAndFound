import { Redirect } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, colors } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Index() {
  const { ready, token, profile, role, online, refresh, signOut } = useSession();
  const [retrying, setRetrying] = useState(false);
  if (!ready)
    return (
      <View style={local.splash}>
        <Image source={require('@/assets/logo.png')} style={local.logo} contentFit="contain" />
      </View>
    );
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
            await refresh().catch(() => undefined);
            setRetrying(false);
          }}
        />
        <Button label="Sign out" variant="ghost" onPress={signOut} />
      </View>
    );
  if (!profile) return <Redirect href={role === 'shelter' ? '/shelter-onboarding' : '/owner-onboarding'} />;
  return <Redirect href={role === 'shelter' ? '/dashboard' : '/rescue'} />;
}

const local = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.sky, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  logo: { width: 140, height: 120 },
  text: { color: colors.white, fontSize: 16, textAlign: 'center', lineHeight: 22 },
});
