/** Merge the existing local demo into Maincloud, preserving cloud records and private backups. */
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { randomBytes, scryptSync } from 'node:crypto';
import { database } from '../services/agent/dist/db.js';

const cloud = 'https://maincloud.spacetimedb.com';
const target = process.env.SPACETIME_DATABASE;
if (process.env.SPACETIME_URI !== cloud || !target) throw Error('Load the cloud .env only.');
const local = JSON.parse(await readFile('.demo-incident.json', 'utf8'));
const localEnv = parseEnv(await readFile('.demo-run.env', 'utf8'));
const publisherOutput = execFileSync('spacetime', ['login', 'show', '--token'], { encoding: 'utf8' });
const publisher = publisherOutput.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
if (!publisher) throw Error('Cloud publisher login is required.');
const manifestPath = '.cloud-migration.json';
const tables = {
  users: 'users', credentials: 'credentials', pets: 'pets', petPhotos: 'pet_photos', petCareNotes: 'pet_care_notes',
  reportPhotos: 'report_photos', sceneAssessments: 'scene_assessments', reports: 'reports', reportSummaries: 'report_summaries',
  requests: 'submission_requests', shelters: 'shelters', directoryAliases: 'directory_aliases', staff: 'shelter_staff',
  verifications: 'shelter_verifications', cases: 'rescue_cases', caseFirstReviews: 'case_first_reviews', incidents: 'incidents',
  incidentCases: 'incident_cases', responsePlans: 'response_plans', operationJobs: 'operation_jobs', operationRuns: 'operation_runs',
  shelterResources: 'shelter_resources', shelterAnimals: 'shelter_animals', caseMessages: 'case_messages', matchMessages: 'match_messages',
  external: 'external_reports', matches: 'matches', notifications: 'notifications', pushDevices: 'push_devices',
  pushDeliveries: 'push_deliveries', jobs: 'matching_jobs', alerts: 'disaster_alerts', alertLocations: 'alert_locations',
  simulations: 'simulation_runs', runs: 'agent_runs', events: 'agent_tool_events', grants: 'grants',
};
async function save(value) {
  await writeFile(manifestPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(manifestPath, 0o600);
}
function camel(name) { return name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()); }
function decode(type, value) {
  if (type.Sum) return value[0] === 0 ? decode(type.Sum.variants[0].algebraic_type, value[1]) : undefined;
  if (type.Array) return value.map(item => decode(type.Array, item));
  return value;
}
async function query(uri, db, token, sql) {
  const r = await fetch(`${uri}/v1/database/${db}/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: sql,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error(`Snapshot query failed (${r.status}) for ${sql}: ${(await r.text()).slice(0, 120)}`);
  const [result] = await r.json();
  return result.rows.map(row => Object.fromEntries(result.schema.elements.map((field, i) =>
    [camel(field.name.some), decode(field.algebraic_type, row[i])])));
}
async function snapshot(uri, db, token) {
  const result = {};
  for (const [key, table] of Object.entries(tables)) result[key] = await query(uri, db, token, `SELECT * FROM ${table}`);
  return result;
}
let state;
try { state = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await mkdir('.migration-backups', { recursive: true, mode: 0o700 });
  const source = await snapshot(local.uri, local.database, localEnv.DEMO_REVIEWER_TOKEN);
  const previousCloud = await snapshot(cloud, target, publisher);
  await writeFile('.migration-backups/local.json', JSON.stringify(source), { mode: 0o600 });
  await writeFile('.migration-backups/cloud-before.json', JSON.stringify(previousCloud), { mode: 0o600 });
  state = { target, sourceDatabase: local.database, identities: {}, completed: [], accounts: [] };
  const owner = previousCloud.grants.find(row => row.role === 'admin').id;
  const service = previousCloud.grants.find(row => row.role === 'service').id;
  for (const grant of source.grants) state.identities[grant.id] = { identity: grant.role === 'admin' ? owner : service };
  await save(state);
  console.log(`Backed up ${source.users.length} local accounts and ${source.reports.length} reports; existing cloud data preserved.`);
}
if (state.target !== target || state.sourceDatabase !== local.database) throw Error('Migration manifest targets a different database.');
const source = JSON.parse(await readFile('.migration-backups/local.json', 'utf8'));
for (const user of source.users) {
  if (state.identities[user.id]?.token) continue;
  const r = await fetch(`${cloud}/v1/identity`, { method: 'POST' });
  if (!r.ok) throw Error('Could not create cloud account identity.');
  state.identities[user.id] = await r.json();
  await save(state);
}
function remap(value, key = '') {
  if (key === 'storageKey') return value; // Existing private Cloudinary assets retain their keys.
  if (typeof value === 'string') {
    for (const [oldId, next] of Object.entries(state.identities)) value = value.replaceAll(oldId, next.identity);
    return value;
  }
  if (Array.isArray(value)) return value.map(item => remap(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, k)]));
  return value;
}
const cloudPublisher = database(publisher);
for (const table of Object.keys(tables).filter(name => name !== 'grants')) {
  if (state.completed.includes(table)) continue;
  const rows = source[table].map(row => {
    const migrated = remap(row);
    if (table === 'credentials') migrated.token = state.identities[row.identity].token;
    return migrated;
  });
  let batch = [];
  for (const row of rows) {
    if (batch.length >= 40 || JSON.stringify([...batch, row]).length > 80000) {
      await cloudPublisher.write('import_migration_rows', { table, rows: batch }); batch = [];
    }
    batch.push(row);
  }
  if (batch.length) await cloudPublisher.write('import_migration_rows', { table, rows: batch });
  state.completed.push(table); await save(state);
  console.log(`Migrated ${table}: ${rows.length}`);
}
const cloudService = database(process.env.SPACETIME_SERVICE_TOKEN);
for (const [i, shelter] of local.shelters.entries()) {
  const oldId = JSON.parse(Buffer.from(shelter.token.split('.')[1], 'base64url')).hex_identity;
  const next = state.identities[oldId];
  let account = state.accounts.find(item => item.identity === next.identity);
  if (!account) {
    account = { name: shelter.name, identity: next.identity, token: next.token,
      username: ['demo-central', 'demo-east', 'demo-north'][i], password: `Paws-${randomBytes(6).toString('hex')}` };
    state.accounts.push(account); await save(state);
  }
  const salt = randomBytes(16).toString('hex');
  await cloudService.write('save_credentials', { username: account.username, identity: account.identity, appRole: 'shelter',
    token: account.token, salt, passwordHash: scryptSync(account.password, Buffer.from(salt, 'hex'), 64).toString('hex') });
}
const output = state.accounts.map(account => `${account.name}\nUsername: ${account.username}\nPassword: ${account.password}\nCloud account key: ${account.token}\n`).join('\n');
await writeFile('.cloud-accounts.txt', output, { mode: 0o600 });
await chmod('.cloud-accounts.txt', 0o600);
console.log('Cloud migration complete. Private sign-in details are in .cloud-accounts.txt.');
