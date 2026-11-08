import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Actor, Job, Report, Store } from "../db.js";
import { message, confirm } from "../orchestrator.js";
import {
  feedback,
  hazards,
  play,
  startSimulation,
  step,
} from "../simulation.js";
import { rank } from "../matching.js";
import { drain } from "../worker.js";
import { downloadUrl, readImage, upload } from "../media.js";

function memory() {
  const runs = new Map<string, Record<string, unknown>>();
  const sims = new Map<string, Record<string, unknown>>();
  const reports = new Map<string, object>();
  const events = new Map<string, object>();
  const db: Store = {
    async read<T>(resource: string, key = "") {
      const value =
        resource === "agent_run"
          ? runs.get(key)
          : resource === "simulation_run"
            ? sims.get(key)
            : resource === "pet"
              ? { id: key, name: "Max", species: "dog" }
              : null;
      return (value || null) as T;
    },
    async write(op, payload) {
      const p = payload as Record<string, unknown>,
        id = String(p.id);
      if (op === "save_agent_run") runs.set(id, p);
      else if (op === "record_tool_event") events.set(id, p);
      else if (op === "create_lost_report" || op === "create_found_report")
        reports.set(id, p);
      else if (op === "record_simulation_result") {
        assert.equal(sims.get(id)?.revision || 0, p.expectedRevision);
        sims.set(id, { ...p, revision: Number(p.expectedRevision) + 1 });
      } else throw new Error("Unexpected operation " + op);
    },
  };
  const actor: Actor = { id: "a".repeat(64), db, system: db };
  return { actor, reports, events };
}
test("a report draft survives a new request and duplicate confirmations create one report", async () => {
  const { actor, reports, events } = memory();
  const input = {
    requestId: randomUUID(),
    message: "Max is missing",
    context: { location: { latitude: 32.9, longitude: -96.7 } },
  };
  const draft = await message(actor, input, async () => ({
    tool_calls: [
      {
        id: "call",
        type: "function",
        function: {
          name: "submit_lost_report",
          arguments: JSON.stringify({
            petId: "max",
            observedAt: "2026-01-12T12:00:00Z",
          }),
        },
      },
    ],
  }));
  assert.equal(draft.status, "awaiting_confirmation");
  assert.equal(reports.size, 0);
  assert.deepEqual(
    await message(actor, input, async () => {
      throw new Error("Unexpected model call");
    }),
    draft,
  );
  await assert.rejects(() =>
    confirm({ ...actor, id: "b".repeat(64) }, draft.runId),
  );
  const done = await confirm(actor, draft.runId);
  assert.equal(done.status, "completed");
  assert.deepEqual(await confirm(actor, draft.runId), done);
  assert.equal(events.size, 2);
  assert.equal(reports.size, 1);
});
test("untrusted tool arguments cannot create reports or select an identity", async () => {
  const { actor, reports } = memory();
  let calls = 0;
  const result = await message(
    actor,
    { requestId: randomUUID(), message: "file a report" },
    async () => {
      if (++calls === 1)
        return {
          tool_calls: [
            {
              id: "x",
              type: "function",
              function: {
                name: "submit_found_report",
                arguments: JSON.stringify({
                  species: "dog",
                  condition: "unknown",
                  observedAt: "2026-01-01T00:00:00Z",
                  userId: "other",
                }),
              },
            },
          ],
        };
      return { content: "Select a photo and location." };
    },
  );
  assert.equal(result.actions[0].status, "failed");
  assert.equal(reports.size, 0);
});
test("all simulated hazards branch and score locally; progress retries do not advance twice", async () => {
  for (const hazard of hazards) {
    const start = play(hazard, []);
    const outcomes = start.scene!.choices.map((c) => play(hazard, [c.id]));
    assert.notEqual(outcomes[0].scene?.id, outcomes[1].scene?.id);
    for (const c of start.scene!.choices) {
      const branch = play(hazard, [c.id]);
      for (const end of branch.scene!.choices)
        assert.equal(play(hazard, [c.id, end.id]).completed, true);
    }
  }
  const { actor } = memory(),
    id = randomUUID();
  const initial = await startSimulation(actor, { id, scenarioId: "flood" });
  const next = await step(actor, id, {
    choiceId: "leave",
    revision: initial.revision,
  });
  assert.deepEqual(
    await step(actor, id, { choiceId: "leave", revision: initial.revision }),
    next,
  );
  await assert.rejects(() =>
    step(actor, id, { choiceId: "delay", revision: initial.revision }),
  );
  assert.equal(
    (await step(actor, id, { choiceId: "turn", revision: next.revision }))
      .score,
    100,
  );
});
test("new drills coordinate a fourth response decision and legacy runs keep their original ending", async () => {
  for (const hazard of hazards) {
    for (const animal of ["dog", "cat", "snake", "bird", "rabbit"] as const) {
      const paths = (choices: string[]) => {
        const current = play(hazard, choices, animal, 3);
        assert.equal(current.animal, animal);
        if (current.completed) {
          assert.equal(choices.length, 4);
          assert.equal(current.history.length, 4);
          assert.ok(current.score >= 0 && current.score <= 100);
          assert.throws(() => play(hazard, [...choices, "extra"], animal, 3));
          return;
        }
        for (const option of current.scene!.choices)
          paths([...choices, option.id]);
      };
      paths([]);
    }
  }
  const { actor } = memory();
  const id = randomUUID();
  const initial = await startSimulation(actor, {
    id,
    scenarioId: "flood",
    animal: "bird",
  });
  assert.equal(initial.animal, "bird");
  assert.equal(initial.totalDecisions, 4);
  assert.deepEqual(
    await startSimulation(actor, { id, scenarioId: "flood", animal: "bird" }),
    initial,
  );
  await assert.rejects(() =>
    startSimulation(actor, { id, scenarioId: "flood", animal: "cat" }),
  );
  let run = initial;
  for (const choiceId of ["leave", "turn", "call", "coordinate"]) {
    run = await step(actor, id, { choiceId, revision: run.revision });
  }
  assert.equal(run.completed, true);
  assert.equal(run.score, 100);
  assert.equal(run.animal, "bird");
  assert.equal(play("flood", ["leave", "turn"]).completed, true);
  assert.equal(
    play("flood", ["leave", "turn", "call"], "dog", 2).completed,
    true,
  );
});

test("simulation feedback requests a short direct Nemotron answer grounded in the recorded decisions", async () => {
  const { actor } = memory();
  const id = randomUUID();
  let run = await startSimulation(actor, {
    id,
    scenarioId: "flood",
    animal: "dog",
  });
  for (const choiceId of ["leave", "turn", "call", "coordinate"]) {
    run = await step(actor, id, { choiceId, revision: run.revision });
  }
  const text =
    "You scored 100 out of 100 in this drill. Your decisions kept your dog with you and used official updates.";
  const result = await feedback(actor, id, async (messages, tools, options) => {
    assert.deepEqual(tools, []);
    assert.deepEqual(options, { maxTokens: 256, timeoutMs: 15000 });
    const evidence = JSON.parse(messages[1].content!);
    assert.equal(evidence.score, run.score);
    assert.equal(evidence.animal, "dog");
    assert.deepEqual(evidence.decisions, run.history);
    return { content: ` ${text} ` };
  });
  assert.equal(result.generatedBy, "nemotron");
  assert.equal(result.source, run.source);
  assert.equal(result.feedback, text);
  await assert.rejects(
    () => feedback(actor, id, async () => ({ content: null })),
    /no simulation feedback/,
  );
  await assert.rejects(
    () =>
      feedback(actor, id, async () => {
        throw new Error("Model unavailable");
      }),
    /Model unavailable/,
  );
});

test("matching limits evidence to enrolled photos and never assumes a notification threshold", async () => {
  const writes: Record<string, unknown>[] = [];
  const db: Store = {
    async read<T>() {
      return [{ id: "reference", petId: "pet", embeddingRef: "stored" }] as T;
    },
    async write(_, payload) {
      writes.push(payload as Record<string, unknown>);
    },
  };
  const r: Report = {
    id: "lost",
    type: "lost",
    status: "open",
    species: "dog",
    creatorId: "owner",
    latitude: 32,
    longitude: -96,
    petId: "pet",
    observedAt: "2026-01-01T00:00:00Z",
  };
  const before = process.env.MATCH_NOTIFY_THRESHOLD;
  delete process.env.MATCH_NOTIFY_THRESHOLD;
  try {
    const candidate = {
      petId: "pet",
      candidatePhotoId: "photo",
      matchingPhotoId: "reference",
      visualSimilarity: 0.9,
      combinedScore: 0.8,
      components: {},
    };
    await rank(
      db,
      { id: "found", type: "report", photoIds: ["photo"], species: "dog" },
      [r],
      async <T>() =>
        ({
          model: "test",
          candidates: [
            candidate,
            { ...candidate, matchingPhotoId: "private-other" },
          ],
        }) as T,
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].notify, false);
  } finally {
    if (before !== undefined) process.env.MATCH_NOTIFY_THRESHOLD = before;
  }
});
test("failed jobs remain pending while independent jobs can complete", async () => {
  const db: Store = {
    async read<T>() {
      return [{ id: "a" }, { id: "b" }] as T;
    },
    async write() {},
  };
  const seen: string[] = [];
  const stats = await drain(db, async (_, job: Job) => {
    seen.push(job.id);
    if (job.id === "a") throw new Error("offline");
  });
  assert.deepEqual(seen, ["a", "b"]);
  assert.deepEqual(stats, { completed: 1, pending: 1 });
});
test("one missing reference cannot prevent the other owner's proposal", async () => {
  const writes: object[] = [];
  const store: Store = {
    async read<T>(_resource: string, key = "") {
      return [{ id: "ref-" + key, petId: key, embeddingRef: "stored" }] as T;
    },
    async write(_, payload) {
      writes.push(payload);
    },
  };
  const lost = (id: string): Report => ({
    id,
    petId: id,
    type: "lost",
    status: "open",
    creatorId: id,
    species: "dog",
    latitude: 32,
    longitude: -96,
    observedAt: "2026-01-01T12:00:00Z",
  });
  const coverage = { failures: 0 };
  await rank(
    store,
    { type: "report", id: "found", species: "dog", photoIds: ["intake-photo"] },
    [lost("missing"), lost("ready")],
    async <T>(_path: string, input: object) => {
      const petId = (input as { references: { petId: string }[] }).references[0]
        .petId;
      if (petId === "missing") throw new Error("Image unavailable");
      return {
        model: "test",
        candidates: [
          {
            petId,
            matchingPhotoId: "ref-ready",
            candidatePhotoId: "intake-photo",
            visualSimilarity: 0.9,
            combinedScore: 0.9,
            components: {},
          },
        ],
      } as T;
    },
    coverage,
  );
  assert.equal(writes.length, 1);
  assert.equal(coverage.failures, 1);
});
test("private image upload signs an owner-scoped key and short-lived download", async () => {
  const { actor } = memory();
  Object.assign(process.env, {
    CLOUDINARY_API_KEY: "test",
    CLOUDINARY_API_SECRET: "unit-test-only",
    CLOUDINARY_CLOUD_NAME: "test-cloud",
  });
  const signed = upload(actor);
  assert.match(signed.storageKey, new RegExp("^pawsafe/" + actor.id + "/"));
  assert.equal(signed.fields.type, "authenticated");
  assert.equal(signed.fields.overwrite, "false");
  assert.match(new URL(downloadUrl(signed.storageKey)).search, /expires_at=/);
  await assert.rejects(() =>
    readImage("http://127.0.0.1/image", new Set(["res.cloudinary.com"])),
  );
});
