/** Repeatable, local-only, explicitly simulated incident surge. Use a disposable database. */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, chmod, access, unlink } from 'node:fs/promises';
import { database, systemStore } from '../services/agent/dist/db.js';
import { generateResponsePlan } from '../services/agent/dist/response.js';

const uri = process.env.SPACETIME_URI || '';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri))
  throw new Error('The simulated demo requires a loopback SpacetimeDB server.');
if (!process.env.SPACETIME_DATABASE) throw new Error('Set SPACETIME_DATABASE to a disposable local database.');
const reviewerToken = process.env.DEMO_REVIEWER_TOKEN;
if (!reviewerToken || !process.env.SPACETIME_SERVICE_TOKEN)
  throw new Error('Set DEMO_REVIEWER_TOKEN and SPACETIME_SERVICE_TOKEN for this local database.');
const reviewer = database(reviewerToken);
const service = systemStore();
const manifest = new URL('../.demo-incident.json', import.meta.url);
const count = Number(process.argv.find((value) => value.startsWith('--count='))?.slice(8) ?? '500');
const stage = process.argv.includes('--fill') ? 'fill' : process.argv.includes('--review') ? 'review' : process.argv.includes('--cleanup') ? 'cleanup' : 'seed';
const center = { latitude: 32.7767, longitude: -96.7970 };

async function save(state) {
  await writeFile(manifest, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(manifest, 0o600);
}
async function identity() {
  const response = await fetch(new URL('/v1/identity', uri), { method: 'POST' });
  if (!response.ok) throw new Error(`Could not create a local demo identity (${response.status}).`);
  return response.json();
}
async function existing() {
  const state = JSON.parse(await readFile(manifest, 'utf8'));
  if (state.database !== process.env.SPACETIME_DATABASE || state.uri !== uri)
    throw new Error('Demo manifest belongs to a different local database.');
  return state;
}
async function proof(state) {
  const board = await database(state.shelters[0].token).read('incident_board', state.incidentId);
  const active = board.cases.filter((c) => !['resolved', 'cancelled'].includes(c.status));
  const reviewed = board.cases.filter((c) => c.firstReviewedAt)
    .map((c) => Math.max(0, (Date.parse(c.firstReviewedAt) - Date.parse(c.createdAt)) / 60000))
    .sort((a, b) => a - b);
  console.log(JSON.stringify({ simulated: true, incidentId: state.incidentId, totalCases: board.cases.length,
    possibleDuplicateSightings: board.cases.filter((c) => c.possibleDuplicateOf).length,
    medianMinutesToFirstReview: reviewed.length ? Number(reviewed[Math.floor(reviewed.length / 2)].toFixed(1)) : null,
    reviewedCases: reviewed.length,
    urgentUnassigned: active.filter((c) => c.priority !== 'normal' && !c.shelterId).length,
    casesWithNoUpdateFor15Minutes: active.filter((c) => Date.now() - Date.parse(c.updatedAt) >= 15 * 60000).length }, null, 2));
}

if (stage === 'seed') {
  if (!Number.isInteger(count) || count < 500 || count > 1000) throw new Error('Use --count=500..1000.');
  try { await access(manifest); throw new Error('A demo manifest already exists. Run --cleanup before reseeding.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const incidentId = `demo-${randomUUID()}`;
  const state = { uri, database: process.env.SPACETIME_DATABASE, incidentId, reportIds: [], criticalId: '',
    shelters: [], reporterToken: '', stage: 'seeding' };
  await save(state);
  const reporter = await identity();
  state.reporterToken = reporter.token;
  await save(state);
  await database(reporter.token).write('register_user', { name: 'SIMULATED surge reporter', generalLocation: 'SIMULATED Dallas flood zone' });
  const sites = [
    { name: 'SIMULATED Central shelter', latitude: center.latitude, longitude: center.longitude, capacity: 20, occupancy: 18 },
    { name: 'SIMULATED East shelter', latitude: center.latitude + 0.06, longitude: center.longitude + 0.06, capacity: 40, occupancy: 10 },
    { name: 'SIMULATED North shelter', latitude: center.latitude + 0.10, longitude: center.longitude - 0.03, capacity: 35, occupancy: 8 },
  ];
  for (const site of sites) {
    const person = await identity();
    const shelterId = `demo-shelter-${randomUUID()}`;
    const staff = database(person.token);
    state.shelters.push({ id: shelterId, name: site.name, token: person.token });
    await save(state);
    await staff.write('register_user', { name: `${site.name} manager`, generalLocation: 'SIMULATED Dallas flood zone' });
    await staff.write('register_shelter', { id: shelterId, name: site.name, address: 'SIMULATED demo location',
      latitude: site.latitude, longitude: site.longitude, website: '', phone: '' });
    await staff.write('request_shelter_verification', { shelterId, evidence: 'SIMULATED local demo shelter; reviewer verifies test identity only' });
    await reviewer.write('set_shelter_verification', { shelterId, status: 'verified' });
    await staff.write('update_shelter_capacity', { shelterId, totalCapacity: site.capacity,
      currentOccupancy: site.occupancy, acceptingAnimals: true });
    await staff.write('update_shelter_resources', { shelterId, species: 'cat,dog', supplies: 'SIMULATED crates, food, first aid',
      foodUnits: 80, crates: 20, medicalKits: 5 });
  }
  await database(state.shelters[0].token).write('create_incident', { id: incidentId,
    title: 'SIMULATED Dallas flood surge', hazard: 'flood', ...center, radiusKm: 30 });
  const db = database(reporter.token);
  for (let i = 0; i < count; i++) {
    const reportId = `demo-found-${randomUUID()}`;
    const source = i >= 2 && i < 82 && i % 2 === 1 ? i - 1 : i;
    const pair = source >= 2 && source < 82;
    const latitude = center.latitude + (pair ? (source % 20) * 0.001 : (source % 40) * 0.0007);
    const longitude = center.longitude + (pair ? (source % 17) * 0.001 : (Math.floor(source / 40) % 20) * 0.0008);
    const observedAt = new Date(Date.now() - (source % 4 === 0 ? 30 : 5) * 60000).toISOString();
    const critical = i === 0;
    await db.write('create_found_report', { id: reportId, idempotencyKey: reportId,
      species: source % 4 === 0 ? 'cat' : 'dog', latitude, longitude, observedAt,
      condition: critical ? 'severe injury' : source % 8 === 0 ? 'injured' : 'unknown',
      generalLocation: 'SIMULATED Dallas flood zone',
      description: critical ? 'SIMULATED CRITICAL: injured animal in flood water. Training data only.' :
        `SIMULATED sighting ${i + 1}${pair ? ' in a duplicate sighting pair' : ''}. No real animal or emergency.`,
    });
    state.reportIds.push(reportId);
    if (critical) state.criticalId = reportId;
    if ((i + 1) % 25 === 0) { await save(state); console.log(`Seeded ${i + 1}/${count} simulated reports.`); }
  }
  state.stage = 'seeded';
  await save(state);
  const before = await generateResponsePlan(service, state.criticalId);
  console.log(`Initial critical-case plan suggests ${before.suggestedShelterId}.`);
  await proof(state);
  console.log('Open Incident command, then run --fill to fill the suggested shelter and re-plan.');
} else {
  const state = await existing();
  if (stage === 'fill') {
    if (state.stage !== 'seeded') throw new Error('Run --fill once after the seed stage.');
    const previous = await service.read('service_response_plan', state.criticalId);
    const first = state.shelters[0];
    if (previous?.suggestedShelterId !== first.id) throw new Error('Initial plan did not choose the demo central shelter; use a disposable database without competing shelters.');
    await database(first.token).write('update_shelter_capacity', { shelterId: first.id,
      totalCapacity: 20, currentOccupancy: 20, acceptingAnimals: false });
    const stale = await service.read('service_response_plan', state.criticalId);
    console.log(`Filled ${first.name}; previous plan is ${stale.status}.`);
    const next = await generateResponsePlan(service, state.criticalId);
    if (!next.suggestedShelterId || next.suggestedShelterId === first.id)
      throw new Error('Re-plan did not select another available demo shelter.');
    state.stage = 'filled';
    await save(state);
    console.log(`Agent re-plan suggests ${state.shelters.find((s) => s.id === next.suggestedShelterId)?.name ?? next.suggestedShelterId}.`);
    await proof(state);
    console.log('Run --review to assign the critical case to the newly suggested shelter.');
  } else if (stage === 'review') {
    if (state.stage !== 'filled') throw new Error('Run --review once after --fill.');
    const current = await service.read('service_response_plan', state.criticalId);
    const destination = state.shelters.find((s) => s.id === current.suggestedShelterId);
    if (!destination) throw new Error('Current plan does not suggest a demo shelter.');
    await database(destination.token).write('assign_rescue_case', { caseId: state.criticalId, shelterId: destination.id });
    state.stage = 'reviewed';
    await save(state);
    console.log(`First staff review: critical case assigned to ${destination.name}.`);
    await proof(state);
  } else {
    const reporter = database(state.reporterToken);
    for (const reportId of state.reportIds) await reporter.write('update_report', { reportId, status: 'closed' });
    await database(state.shelters[0].token).write('close_incident', { incidentId: state.incidentId });
    for (const shelter of state.shelters) await reviewer.write('set_shelter_verification', { shelterId: shelter.id, status: 'rejected' });
    await unlink(manifest);
    console.log(`Closed ${state.reportIds.length} simulated reports and incident. Demo shelter accounts remain in this disposable database.`);
  }
}
