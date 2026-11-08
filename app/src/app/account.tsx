import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';

import { Button, Card, ErrorNote, Field, Muted, Notice, Screen, SectionTitle, Strong } from '@/components/ui';
import { db } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { shareText, type ShareOutcome } from '@/lib/share';

export default function Account() {
  const { profile, token, saveProfile, setCredentials } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [form, setForm] = useState({
    name: profile?.name ?? '',
    generalLocation: profile?.generalLocation ?? '',
    contactPreferences: profile?.contactPreferences ?? '',
    emergencyContact: profile?.emergencyContact ?? '',
  });
  const [saved, setSaved] = useState(false);
  const [outcome, setOutcome] = useState<ShareOutcome>();
  const [manualCopy, setManualCopy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { busy, error, run } = useAction();
  const set = (key: keyof typeof form) => (value: string) => {
    setSaved(false);
    setForm({ ...form, [key]: value });
  };
  useEffect(() => {
    if (token) void db.read<string>(token, 'account_username').then(setUsername).catch(() => undefined);
  }, [token]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account' }} />
      <SectionTitle>Profile</SectionTitle>
      <Field label="Name" value={form.name} onChangeText={set('name')} maxLength={120} />
      <Field label="Home city" value={form.generalLocation} onChangeText={set('generalLocation')} hint="Optional. Enter only your city or town." maxLength={120} />
      <Field label="Contact preferences" value={form.contactPreferences} onChangeText={set('contactPreferences')} hint="Private." maxLength={240} />
      <Field label="Emergency contact" value={form.emergencyContact} onChangeText={set('emergencyContact')} hint="Private." maxLength={240} />
      <ErrorNote error={error} />
      {saved ? <Notice tone="success">Profile saved.</Notice> : null}
      <Button
        label="Save profile"
        loading={busy === 'save'}
        onPress={() =>
          run('save', async () => {
            if (!form.name.trim()) throw new Error('Enter your name.');
            await saveProfile(form);
            setSaved(true);
          })
        }
      />

      <SectionTitle>Sign in</SectionTitle>
      <Muted>Use this username and password to sign in on another device. Existing account key users can set them here.</Muted>
      <Field label="Username" value={username} onChangeText={(value) => { setUsername(value); setCredentialsSaved(false); }} autoCapitalize="none" autoCorrect={false} maxLength={32} />
      <Field label="New password" value={password} onChangeText={(value) => { setPassword(value); setCredentialsSaved(false); }} secureTextEntry placeholder="At least 8 characters" maxLength={128} />
      {credentialsSaved ? <Notice tone="success">Sign-in details saved.</Notice> : null}
      <Button label="Save sign-in details" variant="outline" loading={busy === 'credentials'} disabled={!username.trim() || !password} onPress={() => run('credentials', async () => {
        await setCredentials(username, password);
        setPassword('');
        setCredentialsSaved(true);
      })} />

      <SectionTitle>Existing account key</SectionTitle>
      <Muted>Your account key signs you in on another device. Anyone with it can act as you, so share it only with yourself.</Muted>
      {outcome === 'copied' ? <Notice tone="success">Account key copied.</Notice> : null}
      {outcome === 'shared' ? <Notice tone="success">Account key shared.</Notice> : null}
      {outcome === 'opened' ? <Muted>Account key opened in the Android share sheet.</Muted> : null}
      {outcome === 'cancelled' ? <Muted>Sharing cancelled.</Muted> : null}
      <Button
        label={Platform.OS === 'web' ? 'Copy account key' : 'Share account key'}
        icon="key-outline"
        variant="outline"
        loading={busy === 'share'}
        onPress={() =>
          token &&
          run('share', async () => {
            setOutcome(undefined);
            setRevealed(false);
            setManualCopy(false);
            try { setOutcome(await shareText(token)); } catch (e) {
              setManualCopy(Platform.OS === 'web');
              throw e;
            }
          })
        }
      />
      {manualCopy && token ? <Card>
        <Button label={revealed ? 'Hide account key' : 'Reveal key for manual copy'} variant="ghost" onPress={() => setRevealed(!revealed)} />
        {revealed ? <Text selectable>{token}</Text> : null}
      </Card> : null}
      <Card>
        <Muted>Your user ID (safe to share with a shelter manager)</Muted>
        <Strong>{profile?.id}</Strong>
      </Card>
    </Screen>
  );
}
