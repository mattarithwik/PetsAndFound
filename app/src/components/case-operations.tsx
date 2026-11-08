import { useState } from 'react';

import { Badge, Body, Button, Card, ErrorNote, KeyValue, Loading, Muted, Notice, Row, SectionTitle } from '@/components/ui';
import { db } from '@/lib/api';
import { capitalize, dateTime, priorityTone, timeAgo } from '@/lib/format';
import { useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { CaseOperations, OperationRun } from '@/lib/types';

const triggers: Record<string, string> = {
  found_report: 'New found report', capacity_changed: 'Shelter capacity changed',
  resources_changed: 'Shelter supplies changed', report_updated: 'Report updated', manual_refresh: 'Requested refresh',
};
const tools: Record<string, string> = {
  inspect_case: 'Read report', check_matches: 'Check possible matches', find_shelter_capacity: 'Check shelter capacity and supplies',
  check_weather: 'Check official weather', save_recommendation: 'Prepare recommendation', prepare_recommendation: 'Prepare recommendation',
};

export function CaseOperationsPanel({ caseId }: { caseId: string }) {
  const { token } = useSession();
  const [history, setHistory] = useState(false);
  const data = useLive(() => db.read<CaseOperations | null>(token!, 'case_operations', caseId), `operations:${caseId}`, 3000);
  const current = data.data?.runs[0];
  const pending = data.data?.job && data.data.job.status !== 'done';
  return <>
    <SectionTitle>Pawtricia’s recommendations</SectionTitle>
    {data.loading && !data.data ? <Loading label="Loading recommendations…" /> : null}
    <ErrorNote error={data.error} onRetry={data.refresh} />
    {pending ? <Notice tone="info" title={data.data?.job?.status === 'running' ? 'Pawtricia is checking this case' : 'Waiting for a recommendation'}>
      {data.data?.job?.retryAt ? 'We’ll try again automatically.' : 'Checking matches, nearby shelters and weather.'}
    </Notice> : null}
    {current ? <RunDetails run={current} /> : !data.loading ? <Muted>Recommendations will appear here when ready.</Muted> : null}
    {(data.data?.runs.length ?? 0) > 1 ? <>
      <Button label={history ? 'Hide earlier recommendations' : `Earlier recommendations (${data.data!.runs.length - 1})`} variant="ghost" compact onPress={() => setHistory(!history)} />
      {history ? data.data!.runs.slice(1).map((run) => <RunDetails key={run.id} run={run} />) : null}
    </> : null}
  </>;
}

function RunDetails({ run }: { run: OperationRun }) {
  const rec = run.recommendation;
  return <Card tone="info">
    <Row><Badge label={capitalize(run.status)} tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'} />
      <Muted>{triggers[run.trigger] ?? 'Case updated'}</Muted></Row>
    <Muted>Started {dateTime(run.startedAt)}{run.completedAt ? ` · finished ${timeAgo(run.completedAt)}` : ''}</Muted>
    {run.status === 'superseded' ? <Muted>Use the latest recommendation for this case.</Muted> : null}
    {rec ? <>
      <KeyValue label="Urgency" value={capitalize(rec.urgency)} />
      <Badge label={`${capitalize(rec.urgency)} urgency`} tone={priorityTone[rec.urgency]} />
      <KeyValue label="Possible match" value={rec.possibleMatch ? `${rec.possibleMatch.id} · ${Math.round(rec.possibleMatch.score * 100)}% similarity` : 'No supported match available'} />
      {rec.possibleMatch ? <Muted>Confirm identifying details before accepting a match.</Muted> : null}
      <KeyValue label="Suggested destination" value={rec.suggestedDestination ? `${rec.suggestedDestination.name} · ${rec.suggestedDestination.distanceKm} km · ${rec.suggestedDestination.spaces} reported spaces` : 'Awaiting confirmed shelter availability'} />
      <Body>Reasons</Body>
      {rec.reasons.map((reason, i) => <Muted key={i}>• {reason}</Muted>)}
      <Body>Missing information</Body>
      {rec.missingInformation.length ? rec.missingInformation.map((item, i) => <Muted key={i}>• {item}</Muted>) : <Muted>No additional information requested.</Muted>}
      <KeyValue label="Next action" value={rec.nextAction} />
    </> : null}
    {run.error ? <Muted>{run.error}</Muted> : null}
    <Body>Checks</Body>
    {!run.steps.length ? <Muted>Waiting for the first check to complete.</Muted> : null}
    {run.steps.map((step, i) => <Card key={i}>
      <Row><Badge label={step.status} tone={step.status === 'success' ? 'success' : step.status === 'failed' ? 'danger' : 'warning'} /><Body>{i + 1}. {tools[step.tool] ?? 'Check case details'}</Body></Row>
      <Body>{step.summary}</Body>
      <Muted>{dateTime(step.completedAt)}</Muted>
    </Card>)}
  </Card>;
}
