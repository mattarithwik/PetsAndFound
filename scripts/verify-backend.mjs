/**
 * Publishes a fresh, unnamed test module to a loopback SpacetimeDB instance.
 * Supply a bundled dist/bundle.js and run after building the agent.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { database, authenticate } from "../services/agent/dist/db.js";
import { startSimulation, step } from "../services/agent/dist/simulation.js";
import { message, confirm } from "../services/agent/dist/orchestrator.js";
import { makeServer } from "../services/agent/dist/server.js";
import { processJob } from "../services/agent/dist/matching.js";
import { verifyDomain } from "../spacetimedb/test/domain.mjs";
import { verifyOperations } from "../spacetimedb/test/operations.mjs";

const base = new URL(process.env.TEST_SPACETIME_URI || "http://127.0.0.1:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  throw new Error("Run the integration check against a local instance.");
const moduleBytes = await readFile(process.argv[2] || "spacetimedb/dist/bundle.js");
const identity = async () => {
  const res = await fetch(new URL("/v1/identity", base), { method: "POST" });
  assert.equal(res.status, 200);
  return res.json();
};
const [publisher, worker, owner, finder] = await Promise.all(Array.from({ length: 4 }, identity));
const published = await fetch(new URL("/v1/database?host_type=Js", base), {
  method: "POST",
  headers: { Authorization: "Bearer " + publisher.token, "Content-Type": "application/octet-stream" },
  body: moduleBytes,
});
const publishBody = await published.text();
assert.ok(published.ok, "Test publish failed: " + publishBody);
const dbId = JSON.parse(publishBody).Success.database_identity;
assert.match(dbId, /^[a-f0-9]{64}$/);
process.env.SPACETIME_DATABASE = dbId;
process.env.SPACETIME_URI = base.origin;
process.env.SPACETIME_SERVICE_TOKEN = worker.token;
let http;
try {
  const admin = database(publisher.token),
    ownerDb = database(owner.token),
    finderDb = database(finder.token);
  const service = database(worker.token);
  await admin.write("grant_service_identity", { identity: worker.identity });
  await ownerDb.write("register_user", { name: "Test owner", generalLocation: "Richardson" });
  await finderDb.write("register_user", { name: "Test finder" });
  const actor = await authenticate("Bearer " + owner.token);
  assert.equal(actor.id, owner.identity);
  await assert.rejects(() => authenticate("Bearer invalid"));
  await ownerDb.write("register_pet", {
    id: "max",
    name: "Max",
    species: "dog",
    breed: "retriever",
    colors: ["gold"],
  });
  assert.equal((await ownerDb.read("pets")).length, 1);
  assert.deepEqual(await finderDb.read("pets"), []);
  const select = (token, table) =>
    fetch(new URL("/v1/database/" + dbId + "/sql", base), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "text/plain" },
      body: "SELECT * FROM " + table,
    });
  assert.equal((await (await select(owner.token, "my_pets")).json())[0].rows.length, 1);
  assert.equal((await (await select(finder.token, "my_pets")).json())[0].rows.length, 0);
  assert.equal((await select(finder.token, "pets")).ok, false);
  assert.equal((await select(finder.token, "credentials")).ok, false);
  await assert.rejects(() => finderDb.read("service_jobs"));
  await assert.rejects(() => finderDb.read("service_credentials", "testowner"));
  const query = {
    requestId: randomUUID(),
    message: "Max is missing",
    context: { location: { latitude: 32.9481, longitude: -96.7299 }, city: "Richardson" },
  };
  const date = new Date(Date.now() - 60_000).toISOString();
  const draft = await message(actor, query, async () => ({
    tool_calls: [
      {
        id: "test-call",
        type: "function",
        function: {
          name: "submit_lost_report",
          arguments: JSON.stringify({ petId: "max", observedAt: date }),
        },
      },
    ],
  }));
  assert.equal(draft.status, "awaiting_confirmation", JSON.stringify(draft));
  assert.equal((await ownerDb.read("reports")).length, 0);
  const result = await confirm(actor, draft.runId);
  assert.equal(result.status, "completed");
  await confirm(actor, draft.runId);
  const reports = await ownerDb.read("reports");
  assert.equal(reports.length, 1);
  assert.equal(await finderDb.read("report", reports[0].id), null);
  const summary = (await finderDb.read("public_reports"))[0];
  assert.ok(summary);
  assert.notEqual(summary.latitude, reports[0].latitude);
  assert.equal(summary.microchip, undefined);
  assert.ok((await service.read("service_jobs")).length);
  assert.equal(await finderDb.read("agent_run", draft.runId), null);
  if (process.env.TEST_IMAGE) {
    const endpoint = new URL(process.env.VISION_SERVICE_URL);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname));
    const bytes = await readFile(process.env.TEST_IMAGE);
    const reference = randomUUID(),
      foundPhoto = randomUUID(),
      foundReport = randomUUID();
    // One fixture image exercises the transport and ranking path. It is not a calibration dataset.
    Object.assign(process.env, {
      CLOUDINARY_CLOUD_NAME: "e2e",
      CLOUDINARY_API_KEY: "test",
      CLOUDINARY_API_SECRET: "test-only",
      MATCH_NOTIFY_THRESHOLD: "0.8",
    });
    const realFetch = globalThis.fetch;
    const permittedKeys = new Set([
      "pawsafe/" + owner.identity + "/" + reference,
      "pawsafe/" + finder.identity + "/" + foundPhoto,
    ]);
    // Only Cloudinary delivery is substituted. The worker runs its normal download and embedding code.
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname !== "api.cloudinary.com") return realFetch(input, init);
      assert.equal(url.pathname, "/v1_1/e2e/image/download");
      assert.equal(url.searchParams.get("type"), "authenticated");
      assert.ok(permittedKeys.has(url.searchParams.get("public_id")));
      return Promise.resolve(new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
    };
    try {
      await ownerDb.write("attach_pet_photo", {
        id: reference,
        petId: "max",
        angle: "front",
        animalCount: 1,
        storageKey: "pawsafe/" + owner.identity + "/" + reference,
      });
      await finderDb.write("create_found_report", {
        id: foundReport,
        idempotencyKey: foundReport,
        species: "dog",
        latitude: 32.95,
        longitude: -96.73,
        observedAt: new Date().toISOString(),
        condition: "unknown",
        photos: [
          { id: foundPhoto, animalCount: 1, storageKey: "pawsafe/" + finder.identity + "/" + foundPhoto },
        ],
      });
      for (const job of await service.read("service_jobs")) await processJob(service, job);
      const matches = await ownerDb.read("matches");
      assert.equal(matches.length, 1);
      assert.equal(matches[0].candidateId, foundReport);
      assert.ok(matches[0].score > 0.8);
      assert.equal(matches[0].evidence.model, "facebook/dinov2-base");
      assert.equal(
        (await ownerDb.read("notifications")).filter((n) => n.eventType === "POSSIBLE_PET_MATCH").length,
        1,
      );
      assert.equal((await ownerDb.read("photo", foundPhoto)).id, foundPhoto);
      await ownerDb.write("review_match", { matchId: matches[0].id, status: "confirmed" });
      assert.equal((await service.read("service_jobs")).length, 0);
      console.log(
        "Passed real DINOv2 enrollment, found-report matching, proposal and worker acknowledgement.",
      );
    } finally {
      globalThis.fetch = realFetch;
      for (const photoId of [reference, foundPhoto])
        await fetch(new URL("/v1/images/" + photoId, endpoint), {
          method: "DELETE",
          headers: { Authorization: "Bearer " + process.env.INTERNAL_SERVICE_SECRET },
        });
    }
  }
  const runId = randomUUID();
  let sim = await startSimulation(actor, { id: runId, scenarioId: "tornado" });
  sim = await step(actor, runId, { revision: sim.revision, choiceId: "shelter" });
  sim = await step(actor, runId, { revision: sim.revision, choiceId: "secure" });
  assert.equal(sim.scene.id, "after");
  sim = await step(actor, runId, { revision: sim.revision, choiceId: "check" });
  assert.equal(sim.scene.id, "coordination");
  sim = await step(actor, runId, { revision: sim.revision, choiceId: "coordinate" });
  assert.equal(sim.score, 100);
  assert.equal(sim.completed, true);
  assert.equal(await finderDb.read("simulation_run", runId), null);

  http = makeServer();
  await new Promise((resolve, reject) => http.once("error", reject).listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + http.address().port;
  const register = (token, username) => fetch(url + "/v1/auth/register", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "test-password-123", role: "owner" }),
  });
  assert.equal((await register(owner.token, "testowner")).status, 200);
  assert.equal(await ownerDb.read("account_username"), "testowner");
  assert.equal((await service.read("service_credentials", "testowner")).identity, owner.identity);
  assert.equal((await register(finder.token, "testowner")).status, 409);
  await assert.rejects(() => finderDb.write("save_credentials", { username: "another", identity: finder.identity }));
  const login = (password) => fetch(url + "/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "testowner", password }),
  });
  assert.equal((await login("incorrect-password")).status, 401);
  const signedIn = await login("test-password-123");
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), { token: owner.token, role: "owner" });
  const missingUser = await fetch(url + "/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "unknownuser", password: "incorrect-password" }),
  });
  assert.equal(missingUser.status, 401);
  assert.deepEqual(await missingUser.json(), { error: "Incorrect username or password" });
  for (let i = 0; i < 5; i++) assert.equal((await login("incorrect-password")).status, 401);
  assert.equal((await login("test-password-123")).status, 429);
  assert.equal((await fetch(url + "/v1/scenarios")).status, 401);
  const fromApi = await fetch(url + "/v1/simulations/" + runId, {
    headers: { Authorization: "Bearer " + owner.token },
  });
  assert.equal((await fromApi.json()).score, 100);
  await verifyDomain({
    admin,
    service,
    ownerDb,
    finderDb,
    ownerId: owner.identity,
    finderId: finder.identity,
  });
  await verifyOperations({
    admin,
    service,
    ownerDb,
    finderDb,
    ownerId: owner.identity,
    finderId: finder.identity,
  });
  console.log(
    "Passed live registration, access control, agent confirmation, replay, matching queue, PawTricia operations, simulation and HTTP checks.",
  );
} finally {
  if (http) {
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  }
  // Only the unnamed database created above can be removed here.
  const deleted = await fetch(new URL("/v1/database/" + dbId, base), {
    method: "DELETE",
    headers: { Authorization: "Bearer " + publisher.token },
  });
  if (!deleted.ok) console.error("Temporary test database cleanup returned HTTP " + deleted.status);
}
