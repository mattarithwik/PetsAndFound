import assert from "node:assert/strict";

// Run against a fresh test module through scripts/verify-backend.mjs.
export async function verifyDomain({ admin, service, ownerDb, finderDb, ownerId, finderId }) {
  const pet = {
    id: "domain-daisy", name: "Daisy", species: "dog", healthNotes: "Bring her medication",
    photos: [{ id: "domain-portrait", storageKey: "pawsafe/" + ownerId + "/domain-portrait", angle: "front", animalCount: 1 }],
  };
  await assert.rejects(() => ownerDb.write("register_pet", { ...pet, photos: [...pet.photos, { id: "unfinished" }] }));
  assert.equal(await ownerDb.read("pet", pet.id), null);
  await ownerDb.write("register_pet", pet);
  await ownerDb.write("register_pet", pet);
  assert.equal((await ownerDb.read("pet_photos", pet.id)).length, 1);
  await ownerDb.write("update_pet", { id: pet.id, age: "4 years" });
  let updated = await ownerDb.read("pet", pet.id);
  assert.equal(updated.healthNotes, pet.healthNotes);
  assert.equal(updated.age, "4 years");
  assert.equal(updated.name, pet.name);
  assert.equal(await finderDb.read("pet", pet.id), null);
  await assert.rejects(() => finderDb.write("update_pet", { id: pet.id, age: "5 years" }));
  await ownerDb.write("update_pet", { id: pet.id, healthNotes: "" });
  updated = await ownerDb.read("pet", pet.id);
  assert.equal(updated.healthNotes, "");
  assert.equal(updated.age, "4 years");
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
  await finderDb.write("save_scene_assessment", { reportId: intake.id, environment: "Wet road nearby", visibleConcerns: ["Traffic close to the animal"], uncertainty: "Cannot tell whether the animal is injured" });
  assert.equal((await finderDb.read("scene_assessment", intake.id)).visibleConcerns[0], "Traffic close to the animal");
  assert.equal(await ownerDb.read("scene_assessment", intake.id), null);
  const nearby = (await ownerDb.read("notifications")).filter(
    (n) => n.eventType === "NEW_NEARBY_REPORT" && n.payload.reportId === intake.id,
  );
  assert.equal(nearby.length, 1);
  assert.notEqual(nearby[0].payload.latitude, intake.latitude);
  const publicIntake = await ownerDb.read("public_report", intake.id);
  assert.equal(publicIntake.latitude, nearby[0].payload.latitude);
  assert.equal(publicIntake.description, undefined);
  assert.equal(publicIntake.creatorId, undefined);
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
  const details = { shelterId, name: "Updated test rescue", address: "Rescue center", latitude: 32.9, longitude: -96.7 };
  await assert.rejects(() => ownerDb.write("update_shelter_details", details));
  await assert.rejects(() => ownerDb.write("update_shelter_capacity", capacity));
  await ownerDb.write("request_shelter_verification", { shelterId, evidence: "Test request" });
  await assert.rejects(() => ownerDb.write("set_shelter_verification", { shelterId, status: "verified" }));
  await admin.write("set_shelter_verification", { shelterId, status: "verified" });
  await ownerDb.write("update_shelter_capacity", capacity);
  await ownerDb.write("update_shelter_details", details);
  await assert.rejects(() => finderDb.write("update_shelter_details", details));
  assert.equal((await finderDb.read("shelter", shelterId)).name, details.name);
  assert.equal((await finderDb.read("shelter", shelterId)).currentOccupancy, 10);
  await ownerDb.write("create_incident", { id: "domain-incident", title: "Simulated flood", hazard: "flood", latitude: 32.9, longitude: -96.7, radiusKm: 30 });
  const initialBoardCase = (await ownerDb.read("incident_board", "domain-incident")).cases.find((c) => c.id === intake.id);
  assert.ok(initialBoardCase);
  assert.equal(initialBoardCase.firstReviewedAt, "");
  assert.ok(Date.parse(initialBoardCase.createdAt));
  assert.equal(initialBoardCase.photoId, "intake-photo");
  assert.equal((await ownerDb.read("photo", "intake-photo")).id, "intake-photo");
  assert.ok((await service.read("service_plan_candidates")).includes(intake.id));
  await ownerDb.write("update_shelter_resources", { shelterId, species: "dog, cat", supplies: "bandages", foodUnits: 10, crates: 4, medicalKits: 2 });
  assert.equal((await ownerDb.read("shelter_resources", shelterId)).medicalKits, 2);
  assert.equal(await finderDb.read("shelter_resources", shelterId), null);
  await service.write("save_response_plan", { caseId: intake.id, suggestedShelterId: shelterId, reason: "Staff should confirm intake", steps: ["Review report", "Call shelter"], evidence: JSON.stringify({ trace: ["inspect_case"] }) });
  assert.equal((await finderDb.read("response_plan", intake.id)).suggestedShelterId, shelterId);
  await assert.rejects(() => finderDb.write("review_response_plan", { caseId: intake.id, status: "accepted" }));
  await ownerDb.write("review_response_plan", { caseId: intake.id, status: "accepted" });
  await finderDb.write("set_alert_location", { latitude: intake.latitude, longitude: intake.longitude });
  assert.equal((await finderDb.read("alert_location")).latitude, intake.latitude);
  await finderDb.write("remove_alert_location", {});
  assert.equal(await finderDb.read("alert_location"), null);
  await assert.rejects(() => finderDb.write("assign_rescue_case", { shelterId, caseId: intake.id }));
  assert.ok((await ownerDb.read("case_queue")).some((c) => c.id === intake.id));
  await ownerDb.write("update_shelter_capacity", { ...capacity, currentOccupancy: 20 });
  await assert.rejects(() => ownerDb.write("assign_rescue_case", { shelterId, caseId: intake.id }));
  await ownerDb.write("update_shelter_capacity", capacity);
  await ownerDb.write("assign_rescue_case", { shelterId, caseId: intake.id });
  const reviewedBoardCase = (await ownerDb.read("incident_board", "domain-incident")).cases.find((c) => c.id === intake.id);
  assert.ok(Date.parse(reviewedBoardCase.firstReviewedAt) >= Date.parse(reviewedBoardCase.createdAt));
  await ownerDb.write("release_rescue_case", { caseId: intake.id });
  assert.equal((await ownerDb.read("case", intake.id)).shelterId, "");
  assert.equal((await ownerDb.read("incident_board", "domain-incident")).cases.find((c) => c.id === intake.id).firstReviewedAt, reviewedBoardCase.firstReviewedAt);
  await ownerDb.write("assign_rescue_case", { shelterId, caseId: intake.id });
  assert.equal((await ownerDb.read("case", intake.id)).assessment.environment, "Wet road nearby");
  await finderDb.write("register_push_device", { deviceId: "domain-device", token: "ExpoPushToken[example123]" });
  const pendingPush = (await service.read("service_pending_push")).find((p) => p.deviceId === "domain-device");
  assert.ok(pendingPush);
  await service.write("record_push_delivery", { notificationId: pendingPush.notificationId, deviceId: "domain-device", status: "accepted", ticketId: "ticket-1" });
  assert.ok(!(await service.read("service_pending_push")).some((p) => p.notificationId === pendingPush.notificationId && p.deviceId === "domain-device"));
  await finderDb.write("unregister_push_device", { deviceId: "domain-device" });
  await finderDb.write("send_case_message", { id: "domain-message", caseId: intake.id, body: "The animal is still near the park." });
  assert.equal((await ownerDb.read("case_messages", intake.id))[0].body, "The animal is still near the park.");
  await ownerDb.write("register_shelter_animal", { id: "domain-animal", shelterId, caseId: intake.id, species: "dog", description: "Brown dog with white paws" });
  assert.equal((await ownerDb.read("shelter", shelterId)).currentOccupancy, 11);
  await ownerDb.write("discharge_shelter_animal", { id: "domain-animal", status: "reunited", outcome: "Owner verified in person" });
  assert.equal((await ownerDb.read("shelter", shelterId)).currentOccupancy, 10);
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
    evidence: { model: "test", candidatePhotoId: "domain-external-photo" },
    score: 0.8,
    notify: true,
  };
  await assert.rejects(() => finderDb.write("propose_match", proposal));
  await service.write("propose_match", proposal);
  await service.write("propose_match", proposal);
  const match = (await ownerDb.read("matches")).find((m) => m.candidateId === imported.id);
  assert.deepEqual((await ownerDb.read("matched_external_photo", "domain-external-photo")).photoUrls, imported.photoUrls);
  assert.equal(await finderDb.read("matched_external_photo", "domain-external-photo"), null);
  await assert.rejects(() => finderDb.write("review_match", { matchId: match.id, status: "confirmed" }));
  await ownerDb.write("review_match", { matchId: match.id, status: "confirmed" });
  await service.write("propose_match", { lostReportId: lost, candidateType: "report", candidateId: intake.id,
    evidence: { model: "test", candidatePhotoId: "intake-photo" }, score: 0.8, notify: false });
  const reportMatch = (await ownerDb.read("matches")).find((m) => m.candidateId === intake.id);
  await ownerDb.write("review_match", { matchId: reportMatch.id, status: "confirmed" });
  await finderDb.write("send_match_message", { id: "domain-match-message", matchId: reportMatch.id, body: "Can meet at the shelter for verification." });
  assert.equal((await ownerDb.read("match_messages", reportMatch.id))[0].body, "Can meet at the shelter for verification.");
  assert.equal(
    (await ownerDb.read("notifications")).filter(
      (n) => n.eventType === "POSSIBLE_PET_MATCH" && n.payload.matchId === match.id,
    ).length,
    1,
  );
  await service.write("remove_external_report", { id: imported.id });
  assert.equal(await ownerDb.read("matched_external_photo", "domain-external-photo"), null);
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
