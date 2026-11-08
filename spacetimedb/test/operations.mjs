import assert from "node:assert/strict";
import { generateResponsePlan } from "../../services/agent/dist/response.js";

export async function verifyOperations({ admin, service, ownerDb, finderDb, finderId }) {
  const shelterId = "ops-shelter", caseId = "ops-found";
  await ownerDb.write("register_shelter", { id: shelterId, name: "Operations rescue", latitude: 35, longitude: -96 });
  await ownerDb.write("request_shelter_verification", { shelterId, evidence: "Operations integration fixture" });
  await admin.write("set_shelter_verification", { shelterId, status: "verified" });
  const report = { id: caseId, idempotencyKey: caseId, observedAt: "2026-01-01T12:00:00Z", latitude: 35, longitude: -96,
    species: "dog", condition: "healthy", description: "Private reporter note",
    photos: [{ id: "ops-photo", storageKey: "pawsafe/" + finderId + "/ops-photo", animalCount: 1 }] };
  await finderDb.write("create_found_report", report);
  await finderDb.write("create_found_report", report);
  let job = await service.read("service_operation_job", caseId);
  assert.equal(job.version, 1, "Report retries should not create new operation versions");
  assert.equal(job.trigger, "found_report");
  assert.ok((await service.read("service_operation_jobs")).some((j) => j.caseId === caseId), "Found cases must queue without an incident");
  await assert.rejects(() => finderDb.write("claim_operation_job", { caseId, version: 1, runId: "ops-unauthorized" }));
  await assert.rejects(() => finderDb.read("service_operation_jobs"));
  await service.write("claim_operation_job", { caseId, version: 1, runId: "ops-old" });
  await assert.rejects(() => finderDb.write("renew_operation_lease", { runId: "ops-old" }));
  await service.write("renew_operation_lease", { runId: "ops-old" });
  assert.ok((await service.read("service_operation_job", caseId)).leaseUntil > new Date().toISOString());
  await assert.rejects(() => service.write("claim_operation_job", { caseId, version: 1, runId: "ops-duplicate" }));
  await service.write("record_operation_step", { runId: "ops-old", tool: "inspect_case", status: "success", requestedBy: "nemotron",
    startedAt: new Date().toISOString(), summary: "Read found report", result: JSON.stringify({ description: "Private reporter note", priority: "normal" }) });
  assert.equal((await finderDb.read("case_operations", caseId)).runs[0].steps[0].result.description, "Private reporter note");
  assert.equal((await ownerDb.read("case_operations", caseId)).runs[0].steps[0].result.description, undefined, "Unassigned staff should not get private report content");
  const capacity = { shelterId, totalCapacity: 5, currentOccupancy: 0, acceptingAnimals: true };
  await ownerDb.write("update_shelter_capacity", capacity);
  job = await service.read("service_operation_job", caseId);
  assert.equal(job.version, 2);
  assert.equal(job.trigger, "capacity_changed");
  await service.write("renew_operation_lease", { runId: "ops-old" });
  assert.equal((await service.read("service_operation_job", caseId)).leaseUntil, "", "A superseded worker must not renew the new job's lease");
  const recommendation = { urgency: "normal", possibleMatch: null, suggestedDestination: null, reasons: ["No confirmed intake"], missingInformation: ["Call shelter"], nextAction: "Confirm availability with staff" };
  const finish = (runId) => ({ runId, status: "completed", recommendation: JSON.stringify(recommendation), suggestedShelterId: "", reason: "No confirmed intake", steps: ["Call shelter"], evidence: JSON.stringify({ recommendation, trace: [] }) });
  await service.write("finish_operation_run", finish("ops-old"));
  assert.equal(await finderDb.read("response_plan", caseId), null, "An older run must not publish after capacity changes");
  assert.equal((await finderDb.read("case_operations", caseId)).runs[0].status, "superseded");
  await service.write("claim_operation_job", { caseId, version: 2, runId: "ops-current" });
  await service.write("finish_operation_run", finish("ops-current"));
  assert.equal((await service.read("service_operation_job", caseId)).status, "done");
  assert.equal((await finderDb.read("case_operations", caseId)).runs[0].recommendation.nextAction, recommendation.nextAction);
  assert.ok(await finderDb.read("response_plan", caseId));
  await ownerDb.write("review_response_plan", { caseId, status: "accepted" });
  await ownerDb.write("update_shelter_capacity", { ...capacity, currentOccupancy: 5 });
  assert.equal((await finderDb.read("response_plan", caseId)).status, "stale", "Reviewed plans must be reconsidered after capacity changes");
  job = await service.read("service_operation_job", caseId);
  assert.equal(job.version, 3, "A case with no suggested destination must be reconsidered");
  await ownerDb.write("update_shelter_capacity", capacity);
  assert.equal((await service.read("service_operation_job", caseId)).version, 4);
  await ownerDb.write("register_shelter_animal", { id: "ops-intake", shelterId, species: "dog", description: "Intake" });
  assert.equal((await service.read("service_operation_job", caseId)).version, 5);
  await ownerDb.write("discharge_shelter_animal", { id: "ops-intake", status: "reunited", outcome: "Returned to owner" });
  assert.equal((await service.read("service_operation_job", caseId)).version, 6);
  await service.write("claim_operation_job", { caseId, version: 6, runId: "ops-failed" });
  await service.write("finish_operation_run", { runId: "ops-failed", status: "failed", error: "Source temporarily unavailable" });
  job = await service.read("service_operation_job", caseId);
  assert.equal(job.status, "pending");
  assert.ok(job.retryAt > new Date().toISOString());
  assert.ok(!(await service.read("service_operation_jobs")).some((j) => j.caseId === caseId), "Failed runs use backoff");
  await ownerDb.write("update_shelter_resources", { shelterId, species: "dog", supplies: "Food and crates", foodUnits: 10, crates: 3, medicalKits: 2 });
  await service.write("queue_response_plan", { caseId });
  let modelTurn = 0, matchingExecuted = false;
  const completed = await generateResponsePlan(service, caseId, async () => {
    const tool = (name, args = {}) => ({ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } });
    if (modelTurn++ === 0) return { tool_calls: ["inspect_case", "check_matches", "find_shelter_capacity", "check_weather"].map((name) => tool(name)) };
    assert.equal(matchingExecuted, true);
    return { tool_calls: [tool("save_recommendation", { urgency: "normal", possibleMatchId: null, suggestedShelterId: shelterId,
      reasons: ["Shelter has fresh reported capacity and supplies."], missingInformation: ["Confirm transport with staff."], nextAction: "Call Operations rescue to confirm intake." })] };
  }, async () => ({ items: [], sources: [] }), async () => { matchingExecuted = true; return []; });
  assert.equal(completed.recommendation.suggestedDestination.id, shelterId);
  const savedRun = (await finderDb.read("case_operations", caseId)).runs[0];
  assert.equal(savedRun.status, "completed");
  assert.equal(savedRun.steps.length, 5);
  assert.deepEqual(savedRun.recommendation, completed.recommendation);
  assert.equal((await finderDb.read("response_plan", caseId)).evidence.runId, completed.runId);
  await service.write("queue_response_plan", { caseId });
  job = await service.read("service_operation_job", caseId);
  await service.write("claim_operation_job", { caseId, version: job.version, runId: "ops-closed" });
  await finderDb.write("update_report", { reportId: caseId, status: "closed" });
  await service.write("finish_operation_run", finish("ops-closed"));
  assert.equal((await finderDb.read("case_operations", caseId)).runs[0].status, "superseded", "Closed cases must not receive new plans");
}
