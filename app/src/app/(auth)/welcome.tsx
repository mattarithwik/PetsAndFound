import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, colors, displayFont, ErrorNote, Field, type IconName } from '@/components/ui';
import { useAction } from '@/lib/hooks';
import { MotionPressable } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { Role } from '@/lib/types';

const roles: { value: Role; name: string; detail: string; icon: IconName }[] = [
  {
    value: 'owner',
    name: 'Pet owner',
    detail: 'Prepare for emergencies and find a missing pet.',
    icon: 'paw-outline',
  },
  {
    value: 'shelter',
    name: 'Shelter member',
    detail: 'Manage intakes, coordinate care and reunite pets.',
    icon: 'home-outline',
  },
];

// Local demo sessions are configured in the ignored .env.local file.
const bypassAccounts = __DEV__ ? [
  { name: 'Rithwik', role: 'owner' as const, token: process.env.EXPO_PUBLIC_BYPASS_RITHWIK_TOKEN },
  { name: 'Shelter Central', role: 'shelter' as const, token: process.env.EXPO_PUBLIC_BYPASS_CENTRAL_TOKEN },
].filter((account) => !!account.token) : [];

export default function Welcome() {
  const { width } = useWindowDimensions();
  const wide = width >= 840;
  const { restore, signIn, profile } = useSession();
  const [mode, setMode] = useState<'create' | 'signin' | 'key'>('create');
  const [key, setKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('owner');
  const { run, busy, error, setError } = useAction();

  const changeMode = () => {
    setMode(mode === 'create' ? 'signin' : 'create');
    setKey('');
    setPassword('');
    setError(undefined);
  };
  const next = () => {
    if (mode === 'create') {
      router.push(role === 'owner' ? '/owner-onboarding' : '/shelter-onboarding');
      return;
    }
    void run('signin', async () => {
      if (mode === 'key') await restore(role, key);
      else await signIn(username, password);
      router.replace('/');
    });
  };

  if (profile) return <Redirect href="/" />;
  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
          <View style={[s.header, !wide && s.mobileHeader]}>
            <View style={s.brand}>
              <Image source={require('@/assets/doghead.png')} style={s.mark} contentFit="contain" />
              <Text style={s.wordmark}>PawSafe</Text>
            </View>
            <MotionPressable accessibilityRole="button" feedback="selection" onPress={changeMode} disabled={!!busy} style={s.signIn}>
              <Text style={s.signInText}>{mode === 'create' ? 'Sign in' : 'Create account'}</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.text} />
            </MotionPressable>
          </View>

          <View style={[s.main, wide ? s.desktopMain : s.mobileMain]}>
            <View style={[s.art, wide ? s.desktopArt : { height: Math.min(width * 0.64, 300) }]}>
              <Image
                source={require('@/assets/welcome.jpg')}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                accessibilityLabel="A sleeping puppy cradled in a hand"
              />
            </View>
            <View style={[s.form, wide ? s.desktopForm : s.mobileForm]}>
              <View style={s.headingBlock}>
                <Text accessibilityRole="header" style={[s.headline, !wide && s.mobileHeadline]}>
                  {mode === 'create' ? 'Hello!' : 'Welcome back.'}
                </Text>
                <Text style={s.question}>
                  {mode === 'create' ? 'How are you joining PawSafe?' : 'Sign in to your PawSafe account.'}
                </Text>
              </View>
              {mode === 'signin' ? (
                <>
                  <Field label="Username" autoCapitalize="none" autoCorrect={false} textContentType="username" value={username} onChangeText={setUsername} placeholder="Your username" />
                  <Field label="Password" secureTextEntry textContentType="password" value={password} onChangeText={setPassword} placeholder="Your password" />
                </>
              ) : mode === 'key' ? (
                <Field
                  label="Account key"
                  hint="For existing accounts: copy the key from Account on your other device."
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={key}
                  onChangeText={setKey}
                  placeholder="Paste your account key"
                />
              ) : null}
              {mode !== 'signin' ? <View style={s.roleList} accessibilityRole="radiogroup" accessibilityLabel="Your role">
                {roles.map((item) => {
                  const selected = role === item.value;
                  return (
                    <MotionPressable
                      key={item.value}
                      accessibilityRole="radio"
                      accessibilityLabel={item.name}
                      accessibilityState={{ checked: selected }}
                      disabled={!!busy}
                      feedback={selected ? 'none' : 'selection'}
                      onPress={() => setRole(item.value)}
                      style={[s.role, selected && s.selected]}
                    >
                      <View style={[s.roleIcon, selected && s.selectedIcon]}>
                        <Ionicons name={item.icon} size={25} color={selected ? colors.navy : colors.text} />
                      </View>
                      <View style={s.flex}>
                        <Text style={s.roleName}>{item.name}</Text>
                      {mode === 'create' ? <Text style={s.roleDetail}>{item.detail}</Text> : null}
                      </View>
                      <View style={[s.radio, selected && s.checked]}>
                        {selected ? <View style={s.dot} /> : null}
                      </View>
                    </MotionPressable>
                  );
                })}
              </View> : null}
              <ErrorNote error={error} />
              <Button
                label={mode === 'create' ? 'Continue' : 'Sign in'}
                icon="arrow-forward"
                onPress={next}
                loading={!!busy}
                disabled={mode === 'key' ? !key.trim() : mode === 'signin' ? !username.trim() || !password : false}
                style={s.continue}
              />
              {mode !== 'create' && bypassAccounts.length > 0 ? (
                <View style={s.roleList}>
                  {bypassAccounts.map((account) => (
                    <Button
                      key={account.role}
                      label={`Bypass as ${account.name}`}
                      variant="outline"
                      icon={account.role === 'owner' ? 'person-outline' : 'home-outline'}
                      loading={busy === `bypass-${account.role}`}
                      disabled={!!busy}
                      onPress={() => { void run(`bypass-${account.role}`, async () => {
                        await restore(account.role, account.token!);
                        router.replace('/');
                      }); }}
                    />
                  ))}
                </View>
              ) : null}
              {mode === 'signin' || mode === 'key' ? (
                <MotionPressable accessibilityRole="button" feedback="selection" onPress={() => { setMode(mode === 'key' ? 'signin' : 'key'); setError(undefined); }} style={s.practice}>
                  <Text style={s.practiceText}>{mode === 'key' ? 'Use username and password' : 'Use an existing account key'}</Text>
                </MotionPressable>
              ) : null}
              {mode === 'create' ? (
                <MotionPressable
                  accessibilityRole="button"
                  onPress={() => router.push('/practice')}
                  style={s.practice}
                >
                  <Ionicons name="game-controller-outline" size={19} color={colors.navy} />
                  <Text style={s.practiceText}>Try a practice drill</Text>
                </MotionPressable>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  page: { flexGrow: 1, width: '100%', alignSelf: 'center', maxWidth: 1536 },
  header: {
    marginHorizontal: '5%',
    minHeight: 84,
    borderBottomWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileHeader: { marginHorizontal: 20, minHeight: 62 },
  brand: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  mark: { width: 42, height: 37 },
  wordmark: {
    fontFamily: displayFont,
    fontWeight: 'bold',
    fontSize: 32,
    letterSpacing: -1.9,
    color: colors.text,
  },
  signIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#C3D1D7',
  },
  signInText: { fontSize: 14, fontWeight: '600', color: colors.text },
  main: { width: '100%', alignSelf: 'center' },
  desktopMain: {
    flexGrow: 1,
    maxWidth: 1472,
    flexDirection: 'row',
    alignItems: 'center',
    gap: '7%',
    paddingHorizontal: '5%',
    paddingVertical: 36,
    justifyContent: 'center',
  },
  mobileMain: { padding: 16, gap: 20 },
  art: { overflow: 'hidden', borderRadius: 25, backgroundColor: colors.baby },
  desktopArt: { flex: 1.16, aspectRatio: 1.05, maxHeight: 740 },
  form: { gap: 14 },
  desktopForm: { flex: 0.84, maxWidth: 480, paddingVertical: 14 },
  mobileForm: { paddingHorizontal: 6, paddingBottom: 12, alignSelf: 'center', width: '100%', maxWidth: 530 },
  headingBlock: { gap: 8, marginBottom: 10 },
  headline: {
    fontFamily: displayFont,
    fontWeight: 'bold',
    fontSize: 76,
    lineHeight: 82,
    letterSpacing: -4,
    color: colors.text,
  },
  mobileHeadline: { fontSize: 51, lineHeight: 55, letterSpacing: -2 },
  question: { color: colors.muted, fontSize: 18, lineHeight: 25 },
  roleList: { gap: 10 },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 16,
    minHeight: 82,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  selected: { borderColor: colors.navy, backgroundColor: '#EEF7FF' },
  roleIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F2EC',
    borderRadius: 13,
  },
  selectedIcon: { backgroundColor: '#D5EAFE' },
  roleName: { fontSize: 19, fontWeight: '700', color: colors.text },
  roleDetail: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  radio: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: '#A7B8C3',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { borderColor: colors.navy },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navy },
  continue: { minHeight: 52, marginTop: 3, flexDirection: 'row-reverse', borderRadius: 14 },
  practice: {
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  practiceText: { fontSize: 14, fontWeight: '600', color: colors.navy },
  pressed: { opacity: 0.8 },
});
