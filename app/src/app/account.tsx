import { Stack } from 'expo-router';
import { useState } from 'react';

import { Button, Card, ErrorNote, Field, Muted, Notice, Screen, SectionTitle, Strong } from '@/components/ui';
import { config } from '@/lib/config';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { shareText } from '@/lib/share';

export default function Account() {
  const { profile, token, saveProfile } = useSession();
  const [form, setForm] = useState({
    name: profile?.name ?? '',
    generalLocation: profile?.generalLocation ?? '',
    contactPreferences: profile?.contactPreferences ?? '',
    emergencyContact: profile?.emergencyContact ?? '',
  });
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
  const set = (key: keyof typeof form) => (value: string) => {
    setSaved(false);
    setForm({ ...form, [key]: value });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account' }} />
      <SectionTitle>Profile</SectionTitle>
      <Field label="Name" value={form.name} onChangeText={set('name')} />
      <Field label="Home area" value={form.generalLocation} onChangeText={set('generalLocation')} hint="City or neighborhood only." />
      <Field label="Contact preferences" value={form.contactPreferences} onChangeText={set('contactPreferences')} hint="Private." />
      <Field label="Emergency contact" value={form.emergencyContact} onChangeText={set('emergencyContact')} hint="Private." />
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

      <SectionTitle>Account key</SectionTitle>
      <Muted>Your account key signs you in on another device. Anyone with it can act as you, so share it only with yourself.</Muted>
      {copied ? <Notice tone="success">Account key copied. Store it somewhere private.</Notice> : null}
      <Button
        label="Copy account key"
        icon="key-outline"
        variant="outline"
        loading={busy === 'share'}
        onPress={() =>
          token &&
          run('share', async () => {
            await shareText(token);
            setCopied(true);
          })
        }
      />
      <Card>
        <Muted>Your user ID (safe to share with a shelter manager)</Muted>
        <Strong>{profile?.id}</Strong>
      </Card>
      <Muted>
        Connected to {config.spacetimeUrl} ({config.database}) and {config.agentUrl}
      </Muted>
    </Screen>
  );
}
