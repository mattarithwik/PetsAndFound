/** Repeatable, local-only, explicitly simulated incident surge. Use a disposable database. */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, chmod, access, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { database, systemStore } from '../services/agent/dist/db.js';
import { generateResponsePlan } from '../services/agent/dist/response.js';
import { processJob } from '../services/agent/dist/matching.js';
import { DATASET_PAGE, DATASET_LICENSE, DOG_REID_PAGE, DOG_REID_LICENSE, datasetSample, uploadDemoImage, deleteDemoImage } from './lib/demo-images.mjs';

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
const stage = process.argv.includes('--owners') ? 'owners' : process.argv.includes('--fill') ? 'fill' : process.argv.includes('--match') ? 'match' : process.argv.includes('--review') ? 'review' : process.argv.includes('--release') ? 'release' : process.argv.includes('--cleanup') ? 'cleanup' : 'seed';
const withImages = process.argv.includes('--images');
const center = { latitude: 32.7767, longitude: -96.7970 };
const ownerDogs = [
  { dogId: '0062cada-a402-41bb-980e-6ae5e0672440', owner: 'SIMULATED Maya Reed', pet: 'SIMULATED Biscuit', shelter: 1,
    ownerFrames: [['4f82f8da-1e3f-46f8-b48a-3a161d52cdf0', 'right'], ['6efb5b41-a90d-4833-b72a-3840bb0e9298', 'other'], ['ac31fe97-5ef0-414e-8911-8f1da9f5e0a9', 'left']],
    shelterFrame: 'cd41e597-1c25-4120-a4dc-01fd7daabae1' },
  { dogId: '0072c0df-11b7-4ea9-8f41-d0a4d043c1c7', owner: 'SIMULATED Jordan Lee', pet: 'SIMULATED Scout', shelter: 2,
    ownerFrames: [['142def30-2012-42a0-9da9-2d700b59d2aa', 'front'], ['3a1ea585-ab17-43fb-a6e6-1466d7614eba', 'other'], ['6bd7aefa-7679-4688-9df2-a45d8a7e7fd1', 'left']],
    shelterFrame: '5f35e50b-e81a-41dc-90d1-59d0db4c43ce' },
];

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
    reportsWithPhotos: board.cases.filter((c) => c.photoId).length,
    visualMatchCandidates: board.cases.reduce((sum, c) => sum + c.visualMatchCount, 0),
    urgentUnassigned: active.filter((c) => c.priority !== 'normal' && !c.shelterId).length,
    casesWithNoUpdateFor15Minutes: active.filter((c) => Date.now() - Date.parse(c.updatedAt) >= 15 * 60000).length }, null, 2));
}

if (stage === 'seed') {
  if (!Number.isInteger(count) || count < 500 || count > 1000) throw new Error('Use --count=500..1000.');
  if (withImages && ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].some((name) => !process.env[name]))
    throw new Error('The --images stage requires Cloudinary credentials.');
  try { await access(manifest); throw new Error('A demo manifest already exists. Run --cleanup before reseeding.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const incidentId = `demo-${randomUUID()}`;
  const state = { uri, database: process.env.SPACETIME_DATABASE, incidentId, reportIds: [], criticalId: '',
    shelters: [], reporterToken: '', ownerToken: '', lostReportId: '', imageSources: [],
    photoStorageKeys: [], stage: 'seeding' };
  await save(state);
  const reporter = await identity();
  state.reporterToken = reporter.token;
  await save(state);
  await database(reporter.token).write('register_user', { name: 'SIMULATED surge reporter', generalLocation: 'SIMULATED Dallas flood zone' });
  const images = withImages ? await datasetSample() : null;
  if (images) {
    const owner = await identity();
    state.ownerToken = owner.token;
    await save(state);
    const ownerDb = database(owner.token);
    await ownerDb.write('register_user', { name: 'SIMULATED missing pet owner', generalLocation: 'SIMULATED Dallas flood zone' });
    const reference = images.cats[20];
    const photo = await uploadDemoImage(owner.identity, reference);
    state.photoStorageKeys.push(photo.storageKey);
    await save(state);
    const petId = `demo-pet-${randomUUID()}`;
    await ownerDb.write('register_pet', { id: petId, name: 'SIMULATED Atlas', species: 'cat', photos: [photo] });
    state.lostReportId = `demo-lost-${randomUUID()}`;
    await ownerDb.write('create_lost_report', { id: state.lostReportId, idempotencyKey: state.lostReportId,
      petId, latitude: center.latitude, longitude: center.longitude,
      observedAt: new Date(Date.now() - 60 * 60000).toISOString(),
      description: `SIMULATED missing pet. Image: Oxford-IIIT Pet ${reference.id}; ${DATASET_LICENSE}; ${DATASET_PAGE}` });
    state.imageSources.push(reference.id);
    await save(state);
  }
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
  const centralIdentity = (await database(state.shelters[0].token).read('access')).identity;
  await database(state.shelters[1].token).write('set_shelter_staff', {
    shelterId: state.shelters[1].id, userId: centralIdentity, role: 'staff',
  });
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
    const image = images && (critical ? images.cats[20] : pair ?
      (source % 4 === 0 ? images.cats[source / 4 - 1] : images.dogs[(source - 2) / 4]) : null);
    const photo = image ? await uploadDemoImage(reporter.identity, image) : null;
    if (photo) { state.photoStorageKeys.push(photo.storageKey); state.imageSources.push(image.id); await save(state); }
    await db.write('create_found_report', { id: reportId, idempotencyKey: reportId,
      species: source % 4 === 0 ? 'cat' : 'dog', latitude, longitude, observedAt,
      condition: critical ? 'severe injury' : source % 8 === 0 ? 'injured' : 'unknown',
      generalLocation: 'SIMULATED Dallas flood zone',
      description: critical ? `SIMULATED CRITICAL: reporter says injured animal in flood water. Dataset image is illustrative and does not show injury. ${image ? `Oxford-IIIT Pet ${image.id}; ${DATASET_LICENSE}; ${DATASET_PAGE}` : ''}` :
        `SIMULATED sighting ${i + 1}${pair ? ' in a duplicate sighting pair' : ''}. No real animal or emergency. ${image ? `Image: Oxford-IIIT Pet ${image.id}; ${DATASET_LICENSE}; ${DATASET_PAGE}` : ''}`,
      ...(photo ? { photos: [photo] } : {}),
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
  console.log(images ? 'Images are attached to the critical report and 40 duplicate pairs. Start the vision service and run --match to score the simulated lost/found pair.' : 'Run with --images to attach attributed Oxford-IIIT Pet images.');
  console.log('Open Incident command, then run --fill to fill the suggested shelter and re-plan.');
} else {
  const state = await existing();
  if (stage === 'owners') {
    if (!state.reporterToken || !state.shelters?.length) throw new Error('Seed the incident before adding owners.');
    if (['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].some((name) => !process.env[name]))
      throw new Error('The --owners stage requires Cloudinary credentials.');
    execFileSync('python3', [new URL('./fetch-dogreid-demo.py', import.meta.url).pathname], { stdio: 'inherit' });
    state.ownerPets ??= [];
    for (const dog of ownerDogs) {
      let row = state.ownerPets.find((item) => item.dogId === dog.dogId);
      if (!row) {
        const person = await identity();
        row = { dogId: dog.dogId, ownerName: dog.owner, petName: dog.pet, ownerToken: person.token,
          ownerIdentity: person.identity, petId: `demo-pet-${randomUUID()}`, lostReportId: `demo-lost-${randomUUID()}`,
          foundReportId: `demo-found-${randomUUID()}`, shelterAnimalId: `demo-animal-${randomUUID()}`,
          lostObservedAt: new Date(Date.now() - 90 * 60000).toISOString(),
          foundObservedAt: new Date(Date.now() - 20 * 60000).toISOString(),
          ownerPhotos: [], shelterPhoto: null };
        state.ownerPets.push(row);
        await save(state);
      }
      const ownerDb = database(row.ownerToken);
      await ownerDb.write('register_user', { name: dog.owner, generalLocation: 'SIMULATED Dallas flood zone' });
      const entry = (frame) => ({ id: `${dog.dogId}-${frame}`, localPath: resolve('.demo-images', 'dogreid', `${dog.dogId}-${frame}.jpg`) });
      for (const [frame, angle] of dog.ownerFrames) {
        if (row.ownerPhotos.some((photo) => photo.frame === frame)) continue;
        const photo = await uploadDemoImage(row.ownerIdentity, entry(frame));
        row.ownerPhotos.push({ ...photo, angle, frame });
        state.photoStorageKeys.push(photo.storageKey);
        state.imageSources.push(`DogReID-1553:${dog.dogId}:${frame}`);
        await save(state);
      }
      if (!row.shelterPhoto) {
        const reporterIdentity = (await database(state.reporterToken).read('access')).identity;
        const photo = await uploadDemoImage(reporterIdentity, entry(dog.shelterFrame));
        row.shelterPhoto = photo;
        state.photoStorageKeys.push(photo.storageKey);
        state.imageSources.push(`DogReID-1553:${dog.dogId}:${dog.shelterFrame}`);
        await save(state);
      }
      if (!row.petRegistered) {
        await ownerDb.write('register_pet', { id: row.petId, name: dog.pet, species: 'dog',
          photos: row.ownerPhotos.map(({ frame, ...photo }) => photo) });
        row.petRegistered = true; await save(state);
      }
      if (!row.lostCreated) {
        await ownerDb.write('create_lost_report', { id: row.lostReportId, idempotencyKey: row.lostReportId,
          petId: row.petId, latitude: center.latitude + dog.shelter * 0.025,
          longitude: center.longitude + dog.shelter * 0.01,
          observedAt: row.lostObservedAt,
          description: `SIMULATED owner report for ${dog.pet}. Three distinct identity-labeled views of DogReID-1553 dog ${dog.dogId}; ${DOG_REID_LICENSE}; ${DOG_REID_PAGE}` });
        row.lostCreated = true; await save(state);
      }
      if (!row.foundCreated) {
        await database(state.reporterToken).write('create_found_report', { id: row.foundReportId, idempotencyKey: row.foundReportId,
          species: 'dog', latitude: center.latitude + dog.shelter * 0.025 + 0.002,
          longitude: center.longitude + dog.shelter * 0.01 + 0.002,
          observedAt: row.foundObservedAt, condition: 'stable',
          generalLocation: 'SIMULATED Dallas flood zone',
          description: `SIMULATED found dog now in shelter care. Photo is a different view of DogReID-1553 dog ${dog.dogId}; ${DOG_REID_LICENSE}; ${DOG_REID_PAGE}. Owner identity remains a possible match until staff review.`,
          photos: [row.shelterPhoto] });
        state.reportIds.push(row.foundReportId);
        row.foundCreated = true; await save(state);
      }
      const shelter = state.shelters[dog.shelter];
      if (!row.assigned) {
        await database(shelter.token).write('assign_rescue_case', { caseId: row.foundReportId, shelterId: shelter.id });
        row.assigned = true; await save(state);
      }
      if (!row.inCare) {
        await database(shelter.token).write('register_shelter_animal', { id: row.shelterAnimalId,
          shelterId: shelter.id, caseId: row.foundReportId, species: 'dog',
          description: `SIMULATED ${dog.pet} candidate; DogReID-1553 identity ${dog.dogId}. Await human verification before reunion.` });
        row.inCare = true; await save(state);
      }
      console.log(`${dog.owner}: ${dog.pet}, 3 owner views; different shelter photo in ${shelter.name}.`);
    }
    const jobs = await service.read('service_jobs');
    for (const row of state.ownerPets) {
      for (const job of jobs.filter((item) => item.reportId === row.lostReportId || item.reportId === row.foundReportId))
        await processJob(service, job);
    }
    await proof(state);
    console.log('Owner and shelter identities are simulated. Visual candidates require staff review.');
  } else if (stage === 'match') {
    if (!state.lostReportId || !['seeded', 'filled', 'reviewed'].includes(state.stage)) throw new Error('Seed with --images before running --match.');
    const jobs = await service.read('service_jobs');
    const criticalJob = jobs.find((job) => job.reportId === state.criticalId && !job.photoId);
    if (criticalJob) await processJob(service, criticalJob);
    const matched = await database(state.shelters[0].token).read('incident_board', state.incidentId);
    if (!matched.cases.find((c) => c.id === state.criticalId)?.visualMatchCount)
      throw new Error('Vision completed without a visual match candidate for the simulated lost/found pair.');
    await service.write('queue_response_plan', { caseId: state.criticalId });
    await generateResponsePlan(service, state.criticalId);
    await proof(state);
    console.log('Visual candidates are proposals for human review, not confirmed identities.');
  } else if (stage === 'fill') {
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
    const currentCase = await service.read('service_case', state.criticalId);
    if (!currentCase.shelterId)
      await database(destination.token).write('assign_rescue_case', { caseId: state.criticalId, shelterId: destination.id });
    state.stage = 'reviewed';
    await save(state);
    console.log(`First staff review: critical case ${currentCase.shelterId ? 'was already accepted' : `assigned to ${destination.name}`}.`);
    await proof(state);
  } else if (stage === 'release') {
    if (state.stage !== 'reviewed') throw new Error('Run --release only after the scripted review stage.');
    const currentCase = await service.read('service_case', state.criticalId);
    const handler = state.shelters.find((s) => s.id === currentCase.shelterId);
    if (!handler) throw new Error('The current handling shelter is not a demo shelter.');
    await database(handler.token).write('release_rescue_case', { caseId: state.criticalId });
    state.stage = 'filled';
    await save(state);
    console.log('Released the critical case to the incident queue. Switch to East shelter and accept it in the app.');
    await proof(state);
  } else {
    const reporter = database(state.reporterToken);
    for (const owner of state.ownerPets ?? []) {
      if (!owner.inCare) continue;
      const current = await service.read('service_case', owner.foundReportId);
      const shelter = state.shelters.find((s) => s.id === current?.shelterId);
      if (shelter) await database(shelter.token).write('discharge_shelter_animal', {
        id: owner.shelterAnimalId, status: 'other', outcome: 'SIMULATED demo cleanup',
      });
      owner.inCare = false;
      await save(state);
    }
    for (const reportId of state.reportIds) await reporter.write('update_report', { reportId, status: 'closed' });
    if (state.lostReportId) await database(state.ownerToken).write('update_report', { reportId: state.lostReportId, status: 'closed' });
    for (const owner of state.ownerPets ?? []) await database(owner.ownerToken).write('update_report', { reportId: owner.lostReportId, status: 'closed' });
    await database(state.shelters[0].token).write('close_incident', { incidentId: state.incidentId });
    for (const shelter of state.shelters) await reviewer.write('set_shelter_verification', { shelterId: shelter.id, status: 'rejected' });
    for (const key of [...state.photoStorageKeys]) {
      await deleteDemoImage(key);
      state.photoStorageKeys = state.photoStorageKeys.filter((value) => value !== key);
      await save(state);
    }
    await unlink(manifest);
    console.log(`Closed ${state.reportIds.length} simulated found reports and incident, and removed demo Cloudinary images. Demo shelter accounts remain in the disposable database.`);
  }
}
