import { router } from 'expo-router';
import { useState } from 'react';

import { LocationPicker } from '@/components/location-picker';
import { Body, Button, Card, Chips, Empty, ErrorNote, Field, Hero, ListRow, Muted, Notice, Screen, SectionTitle, Strong } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { km } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import type { Place } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import { shareText } from '@/lib/share';
import type { NearbyShelter, Sourced } from '@/lib/types';

type Path = 'register' | 'claim' | 'join';

export default function ShelterOnboarding() {
  const { createAccount, token, profile, access, refresh, setActiveShelter } = useSession();
  const { place, setPlace } = usePlace();
  const [name, setName] = useState('');
  const [path, setPath] = useState<Path>('register');
  const [org, setOrg] = useState({ name: '', phone: '', website: '', evidence: '' });
  const [orgPlace, setOrgPlace] = useState<Place>();
  const location = orgPlace ?? place;
  const [orgId] = useState(() => `org-${uuid()}`);
  const [nearby, setNearby] = useState<NearbyShelter[]>();
  const [claim, setClaim] = useState<NearbyShelter>();
  const { busy, error, run } = useAction();

  const finish = async (shelterId?: string) => {
    await refresh();
    if (shelterId) setActiveShelter(shelterId);
    router.replace('/dashboard');
  };

  if (!token || !profile)
    return (
      <Screen edges={['top']}>
        <Hero title="ShelterDash" subtitle="Coordinate care and help animals get home safely. Start with your staff profile." />
        <Field label="Your name" value={name} onChangeText={setName} placeholder="Alex Rivera" autoComplete="name" />
        <LocationPicker label="Where you work" value={place} onChange={setPlace} />
        <ErrorNote error={error} />
        <Button
          label="Create staff account"
          loading={busy === 'account'}
          onPress={() =>
            run('account', async () => {
              if (!name.trim()) throw new Error('Enter your name.');
              await createAccount('shelter', { name, generalLocation: place?.city ?? place?.label });
            })
          }
        />
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );

  const register = () =>
    run('register', async () => {
      if (!org.name.trim()) throw new Error('Enter the organization name.');
      if (!location) throw new Error('Choose the organization location.');
      if (!org.evidence.trim()) throw new Error('Describe how reviewers can verify your organization.');
      try {
        await db.call(token, 'register_shelter', {
          id: orgId,
          name: org.name.trim(),
          latitude: location.latitude,
          longitude: location.longitude,
          address: location.label,
          ...(org.phone.trim() ? { phone: org.phone.trim() } : {}),
          ...(org.website.trim() ? { website: org.website.trim() } : {}),
        });
      } catch (e) {
        // A retry after a dropped response finds the organization already registered by this user.
        if (!access?.staff.some((s) => s.shelterId === orgId) && !String(e).includes('already in use')) throw e;
      }
      await db.call(token, 'request_shelter_verification', { shelterId: orgId, evidence: org.evidence.trim() });
      await finish(orgId);
    });

  const findListings = () =>
    run('search', async () => {
      const center = location;
      if (!center) throw new Error('Choose a location to search near.');
      const result = await agent.post<Sourced<NearbyShelter>>(token, '/v1/ingestion/shelters/sync', {
        latitude: center.latitude,
        longitude: center.longitude,
        radiusKm: 40,
        limit: 25,
      });
      setNearby(result.items.filter((s) => !s.operatorVerified));
    });

  const submitClaim = () =>
    run('claim', async () => {
      if (!claim) throw new Error('Choose your organization from the list.');
      if (!org.evidence.trim()) throw new Error('Describe how reviewers can verify that you operate this shelter.');
      await db.call(token, 'request_shelter_verification', { shelterId: claim.id, evidence: org.evidence.trim() });
      await finish(claim.id);
    });

  return (
    <Screen edges={['top']}>
      <Hero title="Your organization" subtitle="Directory listings are public, but only verified operators can accept cases or report capacity." />
      <Chips
        value={path}
        onChange={setPath}
        options={[
          { value: 'register', label: 'Register new' },
          { value: 'claim', label: 'Claim a listing' },
          { value: 'join', label: 'Join a team' },
        ]}
      />
      {path === 'register' ? (
        <>
          <Field label="Organization name" value={org.name} onChangeText={(v) => setOrg({ ...org, name: v })} placeholder="North Texas Animal Rescue" />
          <LocationPicker label="Organization address" value={location} onChange={setOrgPlace} />
          <Field label="Public phone" value={org.phone} onChangeText={(v) => setOrg({ ...org, phone: v })} keyboardType="phone-pad" />
          <Field label="Website" value={org.website} onChangeText={(v) => setOrg({ ...org, website: v })} autoCapitalize="none" keyboardType="url" />
          <Field
            label="Verification evidence"
            value={org.evidence}
            onChangeText={(v) => setOrg({ ...org, evidence: v })}
            multiline
            placeholder="EIN, license number, official email domain, or a contact reviewers can call"
          />
          <ErrorNote error={error} />
          <Button label="Register and request verification" onPress={register} loading={busy === 'register'} />
        </>
      ) : null}
      {path === 'claim' ? (
        <>
          <Muted>Find your shelter in the public directory (OpenStreetMap and Shelterluv), then send evidence for review.</Muted>
          <LocationPicker label="Search near" value={orgPlace ?? place} onChange={setOrgPlace} />
          <Button label="Find directory listings" variant="outline" icon="search" onPress={findListings} loading={busy === 'search'} />
          {nearby?.length === 0 ? <Empty title="No unclaimed listings nearby" body="Register your organization instead." /> : null}
          {nearby?.map((s) => (
            <ListRow
              key={s.id}
              icon={claim?.id === s.id ? 'checkmark-circle' : 'business-outline'}
              title={s.name}
              detail={`${s.address || 'Address not listed'} · ${km(s.distanceKm)}`}
              onPress={() => setClaim(s)}
            />
          ))}
          {claim ? (
            <Card tone="info">
              <Strong>Claiming {claim.name}</Strong>
              <Field label="Verification evidence" value={org.evidence} onChangeText={(v) => setOrg({ ...org, evidence: v })} multiline placeholder="Your role and how reviewers can confirm it" />
            </Card>
          ) : null}
          <ErrorNote error={error} />
          <Button label="Request verification" onPress={submitClaim} loading={busy === 'claim'} disabled={!claim} />
        </>
      ) : null}
      {path === 'join' ? (
        <>
          <SectionTitle>Join an existing team</SectionTitle>
          <Body>Send your staff ID to your shelter manager. They can add you from ShelterDash → Settings → Staff.</Body>
          <Card>
            <Muted>Your staff ID</Muted>
            <Strong>{profile.id}</Strong>
          </Card>
          <Button label="Copy staff ID" icon="share-outline" variant="outline" onPress={() => run('copy', async () => { await shareText(profile.id); })} />
          <Notice>Once a manager adds you, ShelterDash unlocks automatically.</Notice>
          <Button label="Go to ShelterDash" onPress={() => finish()} />
        </>
      ) : null}
    </Screen>
  );
}
