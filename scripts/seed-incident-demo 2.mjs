/** Local-only simulated surge for the Incident Command demonstration. */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { database } from '../services/agent/dist/db.js';

const uri = process.env.SPACETIME_URI || '';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri))
  throw new Error('Demo seeding is allowed only against a loopback SpacetimeDB server.');
const staffToken = process.env.DEMO_STAFF_TOKEN;
const reporterToken = process.env.DEMO_REPORTER_TOKEN;
if (!staffToken || !reporterToken) throw new Error('Set DEMO_STAFF_TOKEN and DEMO_REPORTER_TOKEN for local test accounts.');
const staff = database(staffToken), reporter = database(reporterToken);
const manifest = new URL('../.demo-incident.json', import.meta.url);

if (process.argv.includes('--cleanup')) {
  const saved = JSON.parse(await readFile(manifest, 'utf8'));
  for (const reportId of saved.reportIds) await reporter.write('update_report', { reportId, status: 'closed' });
  await staff.write('close_incident', { incidentId: saved.incidentId });
  console.log(`Closed ${saved.reportIds.length} simulated reports and incident ${saved.incidentId}.`);
} else {
  const count = Number(process.argv.find((arg) => arg.startsWith('--count='))?.slice(8) ?? '200');
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Use --count=1..1000.');
  const access = await staff.read('access');
  const shelter = access.staff.find((r) => r.verification === 'verified' && r.shelter?.operatorVerified)?.shelter;
  if (!shelter) throw new Error('The demo staff account needs a verified shelter.');
  if (!(await reporter.read('profile'))) throw new Error('The demo reporter account needs a profile.');
  const incidentId = `demo-${randomUUID()}`;
  await staff.write('create_incident', { id: incidentId, title: 'SIMULATED flood surge', hazard: 'flood',
    latitude: shelter.latitude, longitude: shelter.longitude, radiusKm: 30 });
  const reportIds = [];
  const conditions = ['healthy', 'unknown', 'needs care', 'injured', 'severe injury', 'trapped'];
  try {
    for (let i = 0; i < count; i++) {
      const reportId = `demo-found-${randomUUID()}`;
      const offset = ((i % 25) - 12) * 0.002;
      await reporter.write('create_found_report', {
        id: reportId, idempotencyKey: reportId, species: i % 4 === 0 ? 'cat' : 'dog',
        latitude: shelter.latitude + offset, longitude: shelter.longitude + offset / 2,
        observedAt: new Date(Date.now() - (i % 120) * 60_000).toISOString(),
        condition: conditions[i % conditions.length], generalLocation: 'SIMULATED incident area',
        description: `SIMULATED demo sighting ${i + 1}. No real animal or emergency is associated with this report.`,
      });
      reportIds.push(reportId);
      if ((i + 1) % 50 === 0) console.log(`Created ${i + 1} simulated reports.`);
    }
  } finally {
    await writeFile(manifest, JSON.stringify({ incidentId, reportIds }, null, 2));
  }
  console.log(`Created incident ${incidentId} with ${reportIds.length} simulated reports. Run --cleanup with the same accounts afterward.`);
}
