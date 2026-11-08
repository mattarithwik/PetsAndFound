import type { CaseStatus, NotificationType, Priority, Verification } from './types';

export function timeAgo(iso?: string) {
  if (!iso) return 'unknown time';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown time';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : 'Unknown');

export const km = (value: number) => (value < 1 ? '<1 km' : `${Math.round(value)} km`);

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const speciesLabel = (species: string) => (species === 'other' ? 'Animal' : capitalize(species));

export const priorityTone: Record<Priority, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  urgent: 'warning',
  normal: 'neutral',
};

export const priorityRank: Record<Priority, number> = { critical: 0, urgent: 1, normal: 2 };

export const caseStatusLabel: Record<CaseStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export const verificationLabel: Record<Verification, string> = {
  unverified: 'Not verified',
  pending_review: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected',
};

export const notificationTitle: Record<NotificationType, string> = {
  POSSIBLE_PET_MATCH: 'Possible match for your pet',
  MATCH_CONFIRMED: 'Match confirmed',
  NEW_NEARBY_REPORT: 'New report nearby',
  SHELTER_CASE_ASSIGNED: 'A shelter took your case',
  SHELTER_CAPACITY_CHANGED: 'Shelter capacity updated',
  REPORT_STATUS_CHANGED: 'Report status changed',
  DISASTER_ALERT: 'Official weather alert',
};

/** Similarity is not an identity probability, so it is shown as a 0–100 score rather than a percentage. */
export const similarity = (score?: number) => (typeof score === 'number' ? Math.round(score * 100) : undefined);

export const conditions = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'healthy', label: 'Seems healthy' },
  { value: 'needs care', label: 'Needs care' },
  { value: 'injured', label: 'Injured' },
  { value: 'severe injury', label: 'Severe injury' },
  { value: 'trapped', label: 'Trapped' },
  { value: 'immediate danger', label: 'In immediate danger' },
];

export const sinceOptions = [
  { value: '0', label: 'Just now' },
  { value: '1', label: '1 h ago' },
  { value: '3', label: '3 h ago' },
  { value: '12', label: '12 h ago' },
  { value: '24', label: '1 day ago' },
  { value: '72', label: '3 days ago' },
  { value: '168', label: '1 week ago' },
];

export const hoursAgo = (hours: string) => new Date(Date.now() - Number(hours) * 3600000).toISOString();
