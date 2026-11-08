import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chips, colors } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Role } from '@/lib/types';

export default function Welcome() {
  const { restore } = useSession();
  const [restoring, setRestoring] = useState(false);
  const [key, setKey] = useState('');
  const [role, setRole] = useState<Role>('owner');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const signIn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await restore(role, key);
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={local.screen}>
      <KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={local.content} keyboardShouldPersistTaps="handled">
          <Image source={require('@/assets/logo.png')} style={local.logo} contentFit="contain" />
          <Text style={local.title}>Hello!</Text>
          {!restoring ? (
            <>
              <Text style={local.question}>are you a</Text>
              <Pressable accessibilityRole="button" style={local.role} onPress={() => router.push('/owner-onboarding')}>
                <Text style={local.roleText}>Pet Owner</Text>
                <Text style={local.roleDetail}>Register pets, report lost or found animals, prepare for disasters</Text>
              </Pressable>
              <Text style={local.or}>or</Text>
              <Pressable accessibilityRole="button" style={local.role} onPress={() => router.push('/shelter-onboarding')}>
                <Text style={local.roleText}>Shelter Member</Text>
                <Text style={local.roleDetail}>Coordinate intake, rescue cases and reunifications</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setRestoring(true)} style={local.restoreLink}>
                <Text style={local.restoreText}>I already have a PawSafe account</Text>
              </Pressable>
            </>
          ) : (
            <View style={local.card}>
              <Text style={local.cardTitle}>Sign in with your account key</Text>
              <Text style={local.cardBody}>Find it on your other device under Account → Share account key.</Text>
              <TextInput
                value={key}
                onChangeText={setKey}
                placeholder="Paste account key"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={local.input}
              />
              <Chips
                label="Open as"
                value={role}
                onChange={setRole}
                options={[
                  { value: 'owner', label: 'Pet owner' },
                  { value: 'shelter', label: 'Shelter member' },
                ]}
              />
              {error ? <Text style={local.error}>{error}</Text> : null}
              <Button label="Sign in" onPress={signIn} loading={busy} disabled={!key.trim()} />
              <Button label="Back" variant="ghost" onPress={() => setRestoring(false)} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.sky },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 12 },
  logo: { width: 120, height: 100 },
  title: { color: colors.white, fontSize: 46, fontWeight: '800' },
  question: { color: colors.white, fontSize: 18 },
  role: { width: '100%', backgroundColor: colors.white, borderRadius: 18, padding: 18, gap: 4 },
  roleText: { color: colors.navy, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  roleDetail: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  or: { color: colors.white, fontSize: 15 },
  restoreLink: { padding: 12, marginTop: 8 },
  restoreText: { color: colors.white, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
  card: { width: '100%', backgroundColor: colors.white, borderRadius: 22, padding: 20, gap: 12 },
  cardTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  cardBody: { color: colors.muted, fontSize: 14 },
  input: { borderWidth: 1.5, borderColor: colors.baby, borderRadius: 12, padding: 12, fontSize: 16, color: colors.text },
  error: { color: colors.danger },
});
