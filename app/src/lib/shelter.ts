import { db } from './api';
import { useLive } from './hooks';
import { useSession } from './session';
import type { Match, QueuedCase, RescueCase, Shelter, Verification } from './types';

export type Membership = {
  shelterId: string;
  shelter: Shelter | null;
  verification: Verification;
  role?: 'manager' | 'staff';
};

/** The organization a shelter member is acting for, plus what they're allowed to do there. */
export function useShelter() {
  const { access, activeShelterId, setActiveShelter } = useSession();
  const memberships: Membership[] = [...(access?.staff ?? [])];
  for (const application of access?.applications ?? [])
    if (!memberships.some((m) => m.shelterId === application.shelterId))
      memberships.push({ shelterId: application.shelterId, shelter: application.shelter, verification: application.status });
  const active =
    memberships.find((m) => m.shelterId === activeShelterId) ??
    memberships.find((m) => m.verification === 'verified' && m.role) ??
    memberships[0];
  const verified = !!active?.shelter?.operatorVerified && !!active.role;
  return {
    memberships,
    active,
    verified,
    manager: verified && active?.role === 'manager',
    reviewer: access?.role === 'reviewer' || access?.role === 'admin',
    setActiveShelter,
  };
}

/** Live operational data for the active shelter. Queue and cases are only readable once verified. */
export function useShelterOps(intervalMs = 5000) {
  const { token } = useSession();
  const { active, verified } = useShelter();
  const shelterId = active?.shelterId;
  return useLive(
    async () => {
      if (!shelterId) return undefined;
      const [shelter, cases, queue, matches] = await Promise.all([
        db.read<Shelter | null>(token!, 'shelter', shelterId),
        verified ? db.read<RescueCase[]>(token!, 'cases') : Promise.resolve([]),
        verified ? db.read<QueuedCase[]>(token!, 'case_queue') : Promise.resolve([]),
        verified ? db.read<Match[]>(token!, 'matches') : Promise.resolve([]),
      ]);
      const ours = cases.filter((c) => c.shelterId === shelterId);
      const caseReports = new Set(ours.map((c) => c.reportId));
      return {
        shelter,
        ours,
        queue,
        matches: matches.filter((m) => m.status === 'pending' && (caseReports.has(m.lostReportId) || caseReports.has(m.candidateId))),
      };
    },
    `ops:${shelterId}:${verified}`,
    intervalMs,
  );
}

export const activeStatuses = ['open', 'under_review', 'assigned', 'in_progress'] as const;
