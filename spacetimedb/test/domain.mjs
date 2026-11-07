import assert from "node:assert/strict";

// Run against a fresh test module through scripts/verify-backend.mjs.
export async function verifyDomain({ admin, service, ownerDb, finderDb, ownerId, finderId }) {
  const intake = {
    id: "domain-intake",
    idempotencyKey: "domain-submit",
    observedAt: "2026-01-01T12:00:00Z",
    latitude: 32.91,
    longitude: -96.72,
    species: "dog",
    condition: "trapped",
    photos: [{ id: "intake-photo", storageKey: "pawsafe/" + finderId + "/intake-photo", animalCount: 1 }],
  };
  await finderDb.write("create_found_report", intake);
  await finderDb.write("create_found_report", intake);
  const nearby = (await ownerDb.read("notifications")).filter(
    (n) => n.eventType === "NEW_NEARBY_REPORT" && n.payload.reportId === intake.id,
  );
  assert.equal(nearby.length, 1);
  assert.notEqual(nearby[0].payload.latitude, intake.latitude);
  await assert.rejects(() => finderDb.write("create_found_report", { ...intake, latitude: 33 }));
  await assert.rejects(() =>
    ownerDb.write("attach_pet_photo", {
      id: "stolen",
      petId: "max",
      storageKey: "pawsafe/" + finderId + "/stolen",
    }),
  );
  assert.equal(await ownerDb.read("photo", "intake-photo"), null);
  assert.equal((await finderDb.read("cases")).find((c) => c.id === intake.id).priority, "critical");
  const staleJob = (await service.read("service_jobs")).find((j) => j.reportId === intake.id);
  await finderDb.write("attach_report_photo", {
    id: "second-photo",
    reportId: intake.id,
    storageKey: "pawsafe/" + finderId + "/second-photo",
  });
  await service.write("complete_matching_job", { id: staleJob.id, version: staleJob.version });
  assert.ok(
    (await service.read("service_jobs")).some((j) => j.id === staleJob.id && j.version > staleJob.version),
  );

  const shelterId = "domain-shelter";
  await ownerDb.write("register_shelter", {
    id: shelterId,
    name: "Test rescue",
    latitude: 32.9,
    longitude: -96.7,
  });
  const capacity = { shelterId, totalCapacity: 20, currentOccupancy: 10, acceptingAnimals: true };
  await assert.rejects(() => ownerDb.write("update_shelter_capacity", capacity));
  await ownerDb.write("request_shelter_verification", { shelterId, evidence: "Test request" });
  await assert.rejects(() => ownerDb.write("set_shelter_verification", { shelterId, status: "verified" }));
  await admin.write("set_shelter_verification", { shelterId, status: "verified" });
  await ownerDb.write("update_shelter_capacity", capacity);
  assert.equal((await finderDb.read("shelter", shelterId)).currentOccupancy, 10);
  await assert.rejects(() => finderDb.write("assign_rescue_case", { shelterId, caseId: intake.id }));
  assert.ok((await ownerDb.read("case_queue")).some((c) => c.id === intake.id));
  await ownerDb.write("assign_rescue_case", { shelterId, caseId: intake.id });
  assert.equal((await ownerDb.read("report", intake.id)).latitude, intake.latitude);
  await ownerDb.write("resolve_rescue_case", { caseId: intake.id, outcome: "Intake complete" });
  assert.ok((await finderDb.read("notifications")).some((n) => n.eventType === "SHELTER_CASE_ASSIGNED"));

  const venue = {
    id: "osm-node-550",
    name: "Test directory",
    latitude: 32,
    longitude: -96,
    sourceIds: ["osm-node-550"],
    directorySources: ["https://www.openstreetmap.org/node/550"],
    directoryConfidence: "medium",
  };
  await service.write("upsert_directory_shelter", venue);
  const rg = {
    ...venue,
    id: "rg-org-22",
    sourceIds: ["rg-org-22"],
    directorySources: ["https://rescuegroups.org/22"],
  };
  await service.write("upsert_directory_shelter", rg);
  await service.write("upsert_directory_shelter", {
    ...rg,
    sourceIds: [...rg.sourceIds, ...venue.sourceIds],
    directorySources: [...rg.directorySources, ...venue.directorySources],
    directoryConfidence: "high",
  });
  await service.write("upsert_directory_shelter", rg);
  const merged = (await ownerDb.read("shelters")).filter((v) => v.name === venue.name);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].directorySources.length, 2);
  assert.equal(merged[0].totalCapacity, undefined);

  const imported = {
    id: "domain-external",
    source: "partner",
    sourceRecordId: "sample",
    reportType: "found",
    sourceUrl: "https://example.org/record",
    photoUrls: ["https://example.org/pet.jpg"],
    processingAllowed: true,
    status: "new",
  };
  await service.write("upsert_external_report", imported);
  await admin.write("review_external_photos", {
    id: imported.id,
    animalCount: 1,
    photoUrls: imported.photoUrls,
  });
  const lost = (await ownerDb.read("reports")).find((r) => r.type === "lost").id;
  const proposal = {
    lostReportId: lost,
    candidateType: "external",
    candidateId: imported.id,
    evidence: { model: "test" },
    score: 0.8,
    notify: true,
  };
  await assert.rejects(() => finderDb.write("propose_match", proposal));
  await service.write("propose_match", proposal);
  await service.write("propose_match", proposal);
  const match = (await ownerDb.read("matches")).find((m) => m.candidateId === imported.id);
  await assert.rejects(() => finderDb.write("review_match", { matchId: match.id, status: "confirmed" }));
  await ownerDb.write("review_match", { matchId: match.id, status: "confirmed" });
  assert.equal(
    (await ownerDb.read("notifications")).filter(
      (n) => n.eventType === "POSSIBLE_PET_MATCH" && n.payload.matchId === match.id,
    ).length,
    1,
  );
  await service.write("remove_external_report", { id: imported.id });
  await service.write("upsert_external_report", imported);
  assert.ok(!(await service.read("service_external")).some((r) => r.id === imported.id));
  assert.ok(!(await ownerDb.read("matches")).some((m) => m.candidateId === imported.id));
  const purge = (await service.read("service_jobs")).find((j) => j.purgeExternalId === imported.id);
  assert.deepEqual(purge.photoUrls, imported.photoUrls);
  await service.write("complete_matching_job", { id: purge.id, version: purge.version });
  assert.ok(!(await service.read("service_jobs")).some((j) => j.purgeExternalId === imported.id));
  const listing = {
    ...imported,
    id: "domain-rg",
    source: "rescuegroups",
    sourceRecordId: "1234",
    ingestedAt: "2020-01-01T00:00:00Z",
  };
  await service.write("upsert_external_report", listing);
  await service.write("inactive_external_listing", { id: listing.id });
  await service.write("upsert_external_report", listing);
  assert.ok(!(await service.read("service_external")).some((r) => r.id === listing.id));
  await service.write("upsert_external_report", { ...listing, ingestedAt: "2099-01-01T00:00:00Z" });
  assert.equal(
    (await service.read("service_external")).find((r) => r.id === listing.id).processingAllowed,
    false,
  );
  const retired = (await service.read("service_jobs")).find((j) => j.purgeExternalId === listing.id);
  await service.write("complete_matching_job", { id: retired.id, version: retired.version });
  assert.equal(
    (await service.read("service_external")).find((r) => r.id === listing.id).processingAllowed,
    true,
  );
  await service.write("revoke_external_processing", { id: listing.id });
  await service.write("upsert_external_report", listing);
  const after = (await service.read("service_external")).find((r) => r.id === listing.id);
  assert.equal(after.processingAllowed, false);
  assert.deepEqual(after.photoUrls, []);
  await assert.rejects(() => ownerDb.write("grant_service_identity", { identity: ownerId }));
  await admin.write("set_shelter_verification", { shelterId, status: "rejected" });
  await finderDb.write("request_shelter_verification", { shelterId, evidence: "New operator" });
  await admin.write("set_shelter_verification", { shelterId, status: "verified" });
  await assert.rejects(() => ownerDb.write("update_shelter_capacity", capacity));
  await finderDb.write("update_shelter_capacity", capacity);
}
