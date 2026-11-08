import { action, fail, object, sender, str } from './common';

// Only the existing publisher may merge a migration. Existing rows are never overwritten.
export const import_migration_rows = action((ctx, p) => {
  if (ctx.db.grants.id.find(sender(ctx))?.role !== 'admin') fail('Publisher required');
  const allowed = ['users', 'credentials', 'pets', 'petPhotos', 'petCareNotes', 'reportPhotos',
    'sceneAssessments', 'reports', 'reportSummaries', 'requests', 'shelters', 'directoryAliases',
    'staff', 'verifications', 'cases', 'caseFirstReviews', 'incidents', 'incidentCases',
    'responsePlans', 'operationJobs', 'operationRuns', 'shelterResources', 'shelterAnimals',
    'caseMessages', 'matchMessages', 'external', 'matches', 'notifications', 'pushDevices',
    'pushDeliveries', 'jobs', 'alerts', 'alertLocations', 'simulations', 'runs', 'events'] as const;
  const table = str(p, 'table', 80) as typeof allowed[number];
  if (!allowed.includes(table) || !Array.isArray(p.rows) || p.rows.length > 100) fail('Invalid migration batch');
  const store = ctx.db[table] as unknown as {
    iter(): Iterable<Record<string, unknown>>;
    insert(row: Record<string, unknown>): unknown;
  };
  const primary = table === 'credentials' ? 'username' : table === 'petCareNotes' ? 'petId'
    : ['sceneAssessments'].includes(table) ? 'reportId'
    : ['caseFirstReviews', 'incidentCases', 'responsePlans', 'operationJobs'].includes(table) ? 'caseId'
    : table === 'shelterResources' ? 'shelterId' : table === 'alertLocations' ? 'ownerId' : 'id';
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const existing = new Map(Array.from(store.iter(), row => [row[primary], row]));
  for (const raw of p.rows) {
    const row = object(raw);
    if (typeof row[primary] !== 'string' || !row[primary]) fail('Missing migration key');
    const previous = existing.get(row[primary]);
    if (previous) {
      if (canonical(previous) !== canonical(row)) fail('Migration conflicts with existing data');
    } else {
      store.insert(row);
      existing.set(row[primary], row);
    }
  }
});
