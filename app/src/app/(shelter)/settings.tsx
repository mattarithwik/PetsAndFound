import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Chips, Empty, ErrorNote, Field, Hero, KeyValue, ListRow, Muted, Notice, Row, Screen, SectionTitle, Strong, Toggle } from '@/components/ui';
import { db } from '@/lib/api';
import { timeAgo, verificationLabel } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { shareText } from '@/lib/share';
import { useShelter, useShelterOps } from '@/lib/shelter';
import type { Shelter, StaffMember, VerificationRequest } from '@/lib/types';

export default function Settings() {
  const { profile, unread, refresh, setRole, signOut } = useSession();
  const { memberships, active, verified, manager, reviewer, setActiveShelter } = useShelter();
  const ops = useShelterOps(15000);
  const shelter = ops.data?.shelter ?? active?.shelter ?? null;

  return (
    <Screen edges={['top']} onRefresh={() => Promise.all([refresh(), ops.refresh()])}>
      <Hero title="Settings" subtitle={shelter?.name ?? profile?.name} />
      {memberships.length > 1 ? (
        <Chips label="Organization" value={active?.shelterId} onChange={setActiveShelter} options={memberships.map((m) => ({ value: m.shelterId, label: m.shelter?.name ?? m.shelterId }))} />
      ) : null}

      {active ? (
        <>
          <SectionTitle>Organization</SectionTitle>
          <Card>
            <Row>
              <Badge label={verificationLabel[active.verification]} tone={active.verification === 'verified' ? 'success' : active.verification === 'rejected' ? 'danger' : 'warning'} />
              {active.role ? <Badge label={active.role === 'manager' ? 'Manager' : 'Staff'} tone="neutral" /> : <Badge label="Claim pending" tone="neutral" />}
            </Row>
            <Strong>{shelter?.name ?? active.shelterId}</Strong>
            {shelter?.address ? <Muted>{shelter.address}</Muted> : null}
            {shelter ? <KeyValue label="Location" value={`${shelter.latitude.toFixed(4)}, ${shelter.longitude.toFixed(4)}`} /> : null}
            {shelter?.phone ? <KeyValue label="Phone" value={shelter.phone} /> : null}
            {shelter?.website ? <KeyValue label="Website" value={shelter.website} /> : null}
          </Card>
          <Verification shelterId={active.shelterId} status={active.verification} />
          {verified && shelter ? <Capacity shelter={shelter} onSaved={ops.refresh} /> : null}
          {active.role ? <Staff shelterId={active.shelterId} manager={manager} /> : null}
        </>
      ) : (
        <Empty icon="business-outline" title="No organization yet" />
      )}
      <Button label={active ? 'Add another organization' : 'Set up organization'} icon="add-circle-outline" variant="outline" onPress={() => router.push('/shelter-onboarding')} />

      {reviewer ? <Reviews /> : null}

      <SectionTitle>Account</SectionTitle>
      <Card>
        <ListRow icon="notifications-outline" title="Notifications" detail="Case assignments, capacity changes and alerts" right={unread ? <Badge label={`${unread} new`} tone="danger" /> : undefined} onPress={() => router.push('/notifications')} />
        <ListRow icon="person-outline" title="Profile and account key" detail="Your staff ID, name and sign-in key" onPress={() => router.push('/account')} />
        <ListRow
          icon="paw-outline"
          title="Switch to pet owner view"
          detail="Report lost or found pets yourself"
          onPress={async () => {
            await setRole('owner');
            router.replace('/rescue');
          }}
        />
        <ListRow
          icon="log-out-outline"
          title="Sign out"
          detail="Save your account key first if you want to sign in again"
          onPress={async () => {
            await signOut();
            router.replace('/welcome');
          }}
        />
      </Card>
    </Screen>
  );
}

function Verification({ shelterId, status }: { shelterId: string; status: string }) {
  const { token, refresh } = useSession();
  const [evidence, setEvidence] = useState('');
  const { busy, error, run } = useAction();
  if (status === 'verified') return null;
  if (status === 'pending_review')
    return (
      <Notice title="In review">
        An independent reviewer is checking your evidence. Until then, your organization can't accept cases or publish capacity.
      </Notice>
    );
  const submit = () =>
    run('verify', async () => {
      if (evidence.trim().length < 10) throw new Error('Describe how a reviewer can confirm you operate this organization.');
      await db.call(token!, 'request_shelter_verification', { shelterId, evidence: evidence.trim() });
      setEvidence('');
      await refresh();
    });
  return (
    <>
      <SectionTitle>Request verification</SectionTitle>
      {status === 'rejected' ? <Notice tone="danger">The last request was rejected. Submit updated evidence below.</Notice> : null}
      <Field
        label="Evidence"
        hint="e.g. 501(c)(3) EIN, municipal license number, official website and a phone number a reviewer can call."
        value={evidence}
        onChangeText={setEvidence}
        multiline
        maxLength={2000}
      />
      <ErrorNote error={error} />
      <Button label="Submit for review" icon="shield-checkmark-outline" onPress={submit} loading={busy === 'verify'} />
    </>
  );
}

function Capacity({ shelter, onSaved }: { shelter: Shelter; onSaved: () => Promise<void> }) {
  const { token } = useSession();
  const [total, setTotal] = useState('');
  const [occupied, setOccupied] = useState('');
  const [accepting, setAccepting] = useState(true);
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTotal(shelter.totalCapacity === undefined ? '' : String(shelter.totalCapacity));
    setOccupied(shelter.currentOccupancy === undefined ? '' : String(shelter.currentOccupancy));
    setAccepting(shelter.acceptingAnimals ?? true);
  }, [shelter.id, shelter.totalCapacity, shelter.currentOccupancy, shelter.acceptingAnimals]);

  const save = () =>
    run('capacity', async () => {
      const totalCapacity = Number(total);
      const currentOccupancy = Number(occupied);
      if (!Number.isInteger(totalCapacity) || totalCapacity < 0) throw new Error('Enter total spaces as a whole number.');
      if (!Number.isInteger(currentOccupancy) || currentOccupancy < 0 || currentOccupancy > totalCapacity)
        throw new Error('Occupancy must be a whole number no greater than total spaces.');
      await db.call(token!, 'update_shelter_capacity', { shelterId: shelter.id, totalCapacity, currentOccupancy, acceptingAnimals: accepting });
      await onSaved();
      setSaved(true);
    });

  return (
    <>
      <SectionTitle>Capacity</SectionTitle>
      <Muted>
        {shelter.capacityUpdatedAt ? `Last updated ${timeAgo(shelter.capacityUpdatedAt)}.` : 'Not published yet.'} Capacity older than 24 hours is shown to the public as unknown.
      </Muted>
      <Row style={{ flexWrap: 'nowrap' }}>
        <View style={{ flex: 1 }}>
          <Field label="Total spaces" value={total} onChangeText={(v) => (setTotal(v.replace(/\D/g, '')), setSaved(false))} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Occupied" value={occupied} onChangeText={(v) => (setOccupied(v.replace(/\D/g, '')), setSaved(false))} keyboardType="number-pad" />
        </View>
      </Row>
      <Toggle label="Accepting animals" detail="Turn off to pause new intake" value={accepting} onChange={(v) => (setAccepting(v), setSaved(false))} />
      <ErrorNote error={error} />
      {saved ? <Notice tone="success">Capacity published. Your team has been notified.</Notice> : null}
      <Button label="Publish capacity" icon="cloud-upload-outline" onPress={save} loading={busy === 'capacity'} />
    </>
  );
}

function Staff({ shelterId, manager }: { shelterId: string; manager: boolean }) {
  const { token, profile, access } = useSession();
  const staff = useLive(async () => {
    try {
      return await db.read<StaffMember[]>(token!, 'shelter_staff', shelterId);
    } catch {
      const self = access?.staff.find((s) => s.shelterId === shelterId);
      return profile && self ? [{ userId: profile.id, role: self.role, name: profile.name }] : [];
    }
  }, `staff:${shelterId}:${profile?.id}`);
  const [userId, setUserId] = useState('');
  const [role, setNewRole] = useState<'staff' | 'manager'>('staff');
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();

  const change = (target: string, next: 'staff' | 'manager' | 'remove') =>
    run(`${target}:${next}`, async () => {
      if (!target.trim()) throw new Error("Enter the person's staff ID. They can find it under Profile and account key.");
      await db.call(token!, 'set_shelter_staff', { shelterId, userId: target.trim(), role: next });
      setUserId('');
      await staff.refresh();
    });

  return (
    <>
      <SectionTitle>Staff access</SectionTitle>
      <Card>
        <KeyValue label="Your staff ID" value={profile?.id} />
        <Button
          label={copied ? 'Staff ID copied' : 'Copy staff ID'}
          icon="share-outline"
          compact
          variant="ghost"
          onPress={() =>
            profile &&
            run('copy', async () => {
              await shareText(profile.id);
              setCopied(true);
            })
          }
        />
      </Card>
      <ErrorNote error={staff.error} onRetry={staff.refresh} />
      {staff.data?.map((m) => (
        <Card key={m.userId}>
          <Row>
            <Strong>{m.name || 'Unnamed member'}</Strong>
            <Badge label={m.role === 'manager' ? 'Manager' : 'Staff'} tone="neutral" />
            {m.userId === profile?.id ? <Badge label="You" /> : null}
          </Row>
          <Muted>{m.userId}</Muted>
          {manager && m.userId !== profile?.id ? (
            <Row>
              <Button
                label={m.role === 'manager' ? 'Make staff' : 'Make manager'}
                compact
                variant="ghost"
                onPress={() => change(m.userId, m.role === 'manager' ? 'staff' : 'manager')}
                loading={busy === `${m.userId}:${m.role === 'manager' ? 'staff' : 'manager'}`}
              />
              <Button label="Remove" compact variant="danger" onPress={() => change(m.userId, 'remove')} loading={busy === `${m.userId}:remove`} />
            </Row>
          ) : null}
        </Card>
      ))}
      {manager ? (
        <>
          <Field label="Add a teammate by staff ID" value={userId} onChangeText={setUserId} autoCapitalize="none" autoCorrect={false} placeholder="c200…" />
          <Chips value={role} onChange={setNewRole} options={[{ value: 'staff', label: 'Staff' }, { value: 'manager', label: 'Manager' }]} />
          <Button label="Add teammate" icon="person-add-outline" variant="outline" onPress={() => change(userId, role)} loading={busy === `${userId}:${role}`} />
        </>
      ) : (
        <Muted>Only verified managers can add or remove staff.</Muted>
      )}
      <ErrorNote error={error} />
    </>
  );
}

function Reviews() {
  const { token, profile } = useSession();
  const { busy, error, run } = useAction();
  const queue = useLive(
    async () => {
      const rows = (await db.read<VerificationRequest[]>(token!, 'shelter_verifications')).filter((v) => v.status === 'pending_review');
      const shelters = await Promise.all(rows.map((v) => db.read<Shelter | null>(token!, 'shelter', v.id)));
      return rows.map((v, i) => ({ request: v, shelter: shelters[i] }));
    },
    'reviews',
    15000,
  );
  const decide = (shelterId: string, status: 'verified' | 'rejected') =>
    run(`${shelterId}:${status}`, async () => {
      await db.call(token!, 'set_shelter_verification', { shelterId, status });
      await queue.refresh();
    });

  return (
    <>
      <SectionTitle>Verification reviews</SectionTitle>
      <Muted>You're a PawSafe reviewer. Confirm the evidence independently (call the listed number, check registries) before approving.</Muted>
      <ErrorNote error={queue.error ?? error} onRetry={queue.refresh} />
      {queue.data && !queue.data.length ? <Muted>No requests waiting.</Muted> : null}
      {queue.data?.map(({ request, shelter }) => (
        <Card key={request.id}>
          <Strong>{shelter?.name ?? request.id}</Strong>
          {shelter?.address ? <Muted>{shelter.address}</Muted> : null}
          {shelter?.phone ? <KeyValue label="Phone" value={shelter.phone} /> : null}
          {shelter?.website ? <KeyValue label="Website" value={shelter.website} /> : null}
          <KeyValue label="Evidence" value={request.evidence} />
          <KeyValue label="Applicant" value={request.applicantId} />
          {request.applicantId === profile?.id ? (
            <Muted>You submitted this request, so another reviewer must decide it.</Muted>
          ) : (
            <Row>
              <Button label="Approve" icon="checkmark" compact onPress={() => decide(request.id, 'verified')} loading={busy === `${request.id}:verified`} />
              <Button label="Reject" compact variant="danger" onPress={() => decide(request.id, 'rejected')} loading={busy === `${request.id}:rejected`} />
            </Row>
          )}
        </Card>
      ))}
    </>
  );
}
