import test from "node:test";
import assert from "node:assert/strict";
import { generateResponsePlan, type OperationJob } from "../response.js";
import { drainOperations } from "../worker.js";
import type { Model } from "../nemotron.js";
import type { Store } from "../db.js";

function fixture(priority = "urgent") {
  const timestamp = new Date().toISOString();
  let job: OperationJob = { caseId: "case-1", version: 3, trigger: "capacity_changed", status: "pending", runId: "" };
  const values: Record<string, unknown> = {
    service_case: { id: "case-1", reportId: "case-1", priority, status: "open", shelterId: "", reason: "injured",
      report: { species: "dog", latitude: 32, longitude: -96, condition: "injured", observedAt: timestamp, description: "Limping" },
      matches: [{ id: "match-1", score: 0.8, status: "proposed" }] },
    shelters: [
      { id: "near", name: "Near", latitude: 32, longitude: -96, operatorVerified: true, acceptingAnimals: true, totalCapacity: 5, currentOccupancy: 4, capacityUpdatedAt: timestamp },
      { id: "ready", name: "Ready", latitude: 32.1, longitude: -96, operatorVerified: true, acceptingAnimals: true, totalCapacity: 5, currentOccupancy: 2, capacityUpdatedAt: timestamp },
    ],
    service_shelter_resources: [
      { shelterId: "near", species: "dog", supplies: "", foodUnits: 3, crates: 1, medicalKits: 0, updatedAt: timestamp },
      { shelterId: "ready", species: "dog", supplies: "bandages", foodUnits: 3, crates: 1, medicalKits: 2, updatedAt: timestamp },
    ],
  };
  const writes: { operation: string; payload: Record<string, unknown> }[] = [];
  const store: Store = {
    async read<T>(resource: string) {
      return (resource === "service_operation_job" ? job : resource === "service_operation_jobs" ? [job] : values[resource]) as T;
    },
    async write(operation, payload) {
      const p = payload as Record<string, unknown>;
      if (operation === "claim_operation_job") job = { ...job, runId: String(p.runId), status: "running" };
      writes.push({ operation, payload: p });
    },
  };
  return { store, values, writes, getJob: () => job };
}
const call = (name: string, args: object = {}) => ({ tool_calls: [{ id: name, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] });
const clearWeather = async () => ({ items: [], sources: [] });

test("PawTricia executes tools on request and saves all six recommendation fields and step results", async () => {
  const { store, writes } = fixture();
  const requested = ["inspect_case", "check_matches", "find_shelter_capacity", "check_weather"];
  let turn = 0, matched = false, weatherChecked = false;
  const model: Model = async (messages) => {
    if (turn === 1) assert.equal(matched, false);
    if (turn < requested.length) return call(requested[turn++]);
    assert.equal(matched, true);
    assert.equal(weatherChecked, true);
    assert.ok(messages.some((m) => m.role === "tool" && m.tool_call_id === "check_matches"));
    return call("save_recommendation", { urgency: "urgent", possibleMatchId: "match-1", suggestedShelterId: "ready",
      reasons: ["Ready reports open capacity and medical supplies."], missingInformation: ["Confirm transport."], nextAction: "Call Ready to confirm intake." });
  };
  const plan = await generateResponsePlan(store, "case-1", model, async () => { weatherChecked = true; return clearWeather(); }, async (_, reportId) => {
    assert.equal(reportId, "case-1"); matched = true; return [];
  });
  assert.ok(plan);
  assert.equal(plan.suggestedShelterId, "ready");
  assert.equal(plan.recommendation.urgency, "urgent");
  assert.equal(plan.recommendation.possibleMatch?.id, "match-1");
  assert.equal(plan.recommendation.suggestedDestination?.spaces, 3);
  assert.ok(plan.recommendation.reasons.length);
  assert.ok(plan.recommendation.missingInformation.includes("Confirm transport."));
  assert.equal(plan.recommendation.nextAction, "Call Ready to confirm intake.");
  assert.deepEqual(plan.evidence.agentToolCalls, [...requested, "save_recommendation"]);
  const recorded = writes.filter((w) => w.operation === "record_operation_step");
  assert.equal(recorded.length, 5);
  assert.equal(JSON.parse(String(recorded[1].payload.result)).matches[0].id, "match-1");
  assert.equal(writes.at(-1)?.operation, "finish_operation_run");
  assert.equal(writes.at(-1)?.payload.status, "completed");
});

test("ordinary found cases execute required checks when Nemotron is down and retain explicit missing data", async () => {
  const { store, writes, values } = fixture("normal");
  values.shelters = [];
  let matched = false;
  const plan = await generateResponsePlan(store, "case-1", async () => { throw new Error("offline"); }, async () => { throw new Error("NWS offline"); }, async (_, __, coverage) => {
    matched = true; coverage!.failures++; return [];
  });
  assert.ok(plan);
  assert.equal(matched, true);
  assert.equal(plan.recommendation.suggestedDestination, null);
  assert.ok(plan.recommendation.missingInformation.some((s) => s.includes("weather")));
  assert.ok(plan.recommendation.missingInformation.some((s) => s.includes("photos")));
  assert.deepEqual(plan.evidence.trace.slice(0, 4), ["inspect_case", "check_matches", "find_shelter_capacity", "check_weather"]);
  assert.equal(writes.at(-1)?.payload.status, "degraded");
  assert.equal(writes.filter((w) => w.operation === "record_operation_step" && w.payload.status === "failed").length, 1);
});

test("unsupported destinations and lower urgency are rejected; future, stale and distant capacity is excluded", async () => {
  const { store, writes, values } = fixture("critical");
  const shelters = values.shelters as Record<string, unknown>[];
  values.shelters = [
    { ...shelters[1], capacityUpdatedAt: new Date(Date.now() + 3600000).toISOString() },
    { ...shelters[1], id: "old", capacityUpdatedAt: "2020-01-01T00:00:00Z" },
    { ...shelters[1], id: "far", latitude: 40 },
  ];
  let turn = 0;
  const plan = await generateResponsePlan(store, "case-1", async () => {
    if (turn++ === 0) return { tool_calls: ["inspect_case", "check_matches", "find_shelter_capacity", "check_weather"].flatMap((name) => call(name).tool_calls) };
    if (turn === 2) return call("save_recommendation", { urgency: "normal", possibleMatchId: "fake", suggestedShelterId: "far", reasons: ["Invented"], missingInformation: [], nextAction: "Transfer" });
    if (turn === 3) return call("save_recommendation", { urgency: "critical", possibleMatchId: "match-1", suggestedShelterId: "far", reasons: ["Invented"], missingInformation: [], nextAction: "Transfer" });
    if (turn === 4) return call("save_recommendation", { urgency: "critical", possibleMatchId: "fake", suggestedShelterId: null, reasons: ["Invented"], missingInformation: [], nextAction: "Transfer" });
    return { content: "A chat answer cannot replace the saved workflow result." };
  }, clearWeather, async () => []);
  assert.ok(plan);
  assert.equal(plan.recommendation.urgency, "critical");
  assert.equal(plan.recommendation.suggestedDestination, null);
  const failures = writes.filter((w) => w.operation === "record_operation_step" && w.payload.tool === "save_recommendation" && w.payload.status === "failed");
  assert.equal(failures.length, 3);
  assert.ok(failures.some((w) => String(w.payload.summary).includes("Shelter ID")));
  assert.ok(failures.some((w) => String(w.payload.summary).includes("Match ID")));
});

test("the worker backfills existing cases and passes queue versions into each operation", async () => {
  const { store, writes, getJob } = fixture();
  let called = 0;
  const results = await drainOperations(store, async (_, caseId, _model, _weather, _matcher, job) => {
    called++;
    assert.equal(caseId, "case-1");
    assert.equal(job?.version, getJob().version);
    return null;
  });
  assert.equal(writes[0].operation, "ensure_operation_jobs");
  assert.equal(called, 1);
  assert.equal(results[0].status, "fulfilled");
});
