import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/lib/session';
import {
  caseStatusLabel,
  dateTime,
  km,
  priorityTone,
  similarity,
  speciesLabel,
  timeAgo,
} from '@/lib/format';
import type { ExternalReport, Match, NearbyShelter, Pet, QueuedCase, Report, RescueCase, ReportSummary, WeatherAlert } from '@/lib/types';

import { RemotePhoto } from './photos';
import { Badge, Body, Button, Card, Muted, Row, SourceLink, SourceTag, Strong, colors, styles } from './ui';

export function PetCard({ pet, photoId }: { pet: Pet; photoId?: string }) {
  return (
    <Card onPress={() => router.push(`/pets/${pet.id}`)}>
      <Row style={local.nowrap}>
        <RemotePhoto photoId={photoId} style={local.thumb} />
        <View style={styles.flex}>
          <Strong>{pet.name}</Strong>
          <Muted>{[speciesLabel(pet.species), pet.breed, pet.colors.join(', ')].filter(Boolean).join(' · ')}</Muted>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.baby} />
      </Row>
    </Card>
  );
}

const reportTone = { open: 'info', closed: 'neutral', reunited: 'success' } as const;

export function ReportCard({ report, petName }: { report: Report; petName?: string }) {
  return (
    <Card onPress={() => router.push(`/reports/${report.id}`)}>
      <Row>
        <Badge label={report.type === 'lost' ? 'Lost' : 'Found'} tone={report.type === 'lost' ? 'warning' : 'success'} />
        <Badge label={report.status} tone={reportTone[report.status]} />
      </Row>
      <Strong>{petName ?? `${speciesLabel(report.species)}${report.breed ? ` · ${report.breed}` : ''}`}</Strong>
      <Muted>
        {report.type === 'lost' ? 'Last seen' : 'Found'} {timeAgo(report.observedAt)}
        {report.generalLocation ? ` near ${report.generalLocation}` : ''}
      </Muted>
    </Card>
  );
}

export function SummaryCard({ summary, distance, onPress }: { summary: ReportSummary; distance?: number; onPress?: () => void }) {
  return (
    <Card onPress={onPress}>
      <Row>
        <Badge label={summary.type === 'lost' ? 'Lost' : 'Found'} tone={summary.type === 'lost' ? 'warning' : 'success'} />
        <SourceTag kind="live" />
      </Row>
      <Strong>
        {speciesLabel(summary.species)} {summary.type === 'lost' ? 'missing' : 'found'}
      </Strong>
      <Muted>
        {timeAgo(summary.observedAt)}
        {distance !== undefined ? ` · about ${km(distance)} away` : ''} · approximate area
      </Muted>
    </Card>
  );
}

const sourceLabel = { bluesky: 'Bluesky post', rescuegroups: 'Shelter listing', dallas: 'Dallas animal record' } as const;

export function ExternalCard({ item }: { item: ExternalReport }) {
  return (
    <Card>
      <Row>
        <Badge label={sourceLabel[item.source]} tone="neutral" />
        <Badge label={item.reportType.replace('_', ' ')} />
        <SourceTag kind="external" />
      </Row>
      <Strong>{[item.species ? speciesLabel(item.species) : 'Animal', item.breed, item.colors?.join(', ')].filter(Boolean).join(' · ')}</Strong>
      <Muted>
        {[item.locationLabel, item.observedAt || item.postedAt ? dateTime(item.observedAt ?? item.postedAt) : undefined].filter(Boolean).join(' · ') || 'Public source listing'}
      </Muted>
      <SourceLink url={item.sourceUrl} label="View original source" />
    </Card>
  );
}

const matchTone = { pending: 'warning', confirmed: 'success', rejected: 'neutral' } as const;

export function MatchCard({ match }: { match: Match }) {
  const score = similarity(match.score);
  return (
    <Card onPress={() => router.push(`/matches/${encodeURIComponent(match.id)}`)}>
      <Row style={local.nowrap}>
        <RemotePhoto photoId={match.evidence.candidatePhotoId} style={local.thumb} />
        <View style={styles.flex}>
          <Row>
            <Badge label={match.status === 'pending' ? 'Possible match' : match.status} tone={matchTone[match.status]} />
            <SourceTag kind={match.candidateType === 'external' ? 'external' : 'live'} />
          </Row>
          <Strong>Similarity score {score ?? '—'}/100</Strong>
          <Muted>Updated {timeAgo(match.updatedAt)}{match.status === 'pending' ? ' · awaiting review' : ''}</Muted>
        </View>
      </Row>
    </Card>
  );
}

export function ShelterCard({ shelter }: { shelter: NearbyShelter }) {
  const fresh = !!shelter.capacityUpdatedAt && Date.now() - Date.parse(shelter.capacityUpdatedAt) < 24 * 3600000;
  const known = shelter.operatorVerified && fresh && typeof shelter.totalCapacity === 'number' && typeof shelter.currentOccupancy === 'number';
  const sources = (shelter.directorySources ?? []).filter((url) => /^https?:\/\//i.test(url));
  return (
    <Card>
      <Row>
        <Badge label={shelter.operatorVerified ? 'Verified operator' : 'Directory listing'} tone={shelter.operatorVerified ? 'success' : 'neutral'} />
        <Muted>{km(shelter.distanceKm)}</Muted>
      </Row>
      <Strong>{shelter.name}</Strong>
      {shelter.address ? <Muted>{shelter.address}</Muted> : null}
      {sources.length ? <Muted>{sources.length === 1 ? 'Listed in one directory' : 'Cross-listed in ' + sources.length + ' sources'}</Muted> : null}
      {sources.map((url) => <SourceLink key={url} url={url} />)}
      <Body style={local.small}>
        {known
          ? `${Math.max(0, shelter.totalCapacity! - shelter.currentOccupancy!)} spaces reported · ${shelter.acceptingAnimals ? 'accepting animals' : 'not accepting intake'} · updated ${timeAgo(shelter.capacityUpdatedAt)}`
          : 'Capacity unknown — call to confirm before bringing an animal.'}
      </Body>
      <Row>
        {shelter.phone ? <Button label="Call" icon="call-outline" compact variant="ghost" onPress={() => Linking.openURL(`tel:${shelter.phone}`)} /> : null}
        {shelter.website && /^https?:\/\//i.test(shelter.website) ? <Button label="Website" icon="globe-outline" compact variant="ghost" onPress={() => Linking.openURL(shelter.website!)} /> : null}
        <Button
          label="Directions"
          icon="navigate-outline"
          compact
          variant="ghost"
          onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${shelter.latitude},${shelter.longitude}`)}
        />
      </Row>
    </Card>
  );
}

export function AlertCard({ alert }: { alert: WeatherAlert }) {
  const severe = ['Extreme', 'Severe'].includes(alert.severity);
  return (
    <Card tone={severe ? 'danger' : 'warning'}>
      <Row>
        <SourceTag kind="official" />
        <Badge label={`${alert.severity} · ${alert.urgency}`} tone={severe ? 'danger' : 'warning'} />
      </Row>
      <Strong>{alert.event}</Strong>
      <Body>{alert.headline}</Body>
      {alert.instruction ? <Muted>{alert.instruction.slice(0, 400)}</Muted> : null}
      <Muted>
        Effective {dateTime(alert.effectiveAt)}
        {alert.expiresAt ? ` · expires ${dateTime(alert.expiresAt)}` : ''}
      </Muted>
      <SourceLink url={alert.sourceUrl} label="View on weather.gov" />
    </Card>
  );
}

export function CaseCard({ item, onPress }: { item: RescueCase | QueuedCase; onPress: () => void }) {
  const summary = 'report' in item ? item.report : undefined;
  const full = 'status' in item ? item : undefined;
  return (
    <Card onPress={onPress}>
      <Row>
        <Badge label={item.priority} tone={priorityTone[item.priority]} />
        {full ? <Badge label={caseStatusLabel[full.status]} tone="info" /> : <Badge label="Unassigned" tone="warning" />}
      </Row>
      <Text style={styles.strong}>
        {summary ? `${speciesLabel(summary.species)} ${summary.type}` : full?.reason ? `Reported: ${full.reason}` : 'Rescue case'}
      </Text>
      <Muted>
        {summary ? `Observed ${timeAgo(summary.observedAt)}` : full ? `Updated ${timeAgo(full.updatedAt)}` : ''}
        {full?.reason && summary ? ` · ${full.reason}` : ''}
      </Muted>
    </Card>
  );
}

export function NotificationBell() {
  const { unread } = useSession();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`} onPress={() => router.push('/notifications')} style={local.bell}>
      <Ionicons name="notifications-outline" size={24} color={colors.navy} />
      {unread ? (
        <View style={local.dot}>
          <Text style={local.dotText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const local = StyleSheet.create({
  nowrap: { flexWrap: 'nowrap' },
  thumb: { width: 64, borderRadius: 12 },
  small: { fontSize: 14 },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dotText: { color: colors.white, fontSize: 11, fontWeight: '800' },
});
