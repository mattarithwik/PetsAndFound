import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { type Job, type Report, type Store, systemStore } from "./db.js";
import { processJob } from "./matching.js";
import * as providers from "./providers/index.js";
import { ingestAnimals, ingestShelters, ingestSocial, species } from "./workflows.js";

export async function refreshSources(store: Store) {
  const imports =
    await store.read<(Omit<providers.ExternalPetReport, "status"> & { status: string })[]>(
      "service_external",
    );
  for (const row of imports) {
    if (row.processingAllowed && !providers.eligibleExternalPhotos(row).length)
      await store.write("revoke_external_processing", { id: row.id });
    if (row.source === "bluesky" && (await providers.checkBlueskyRecord(row.sourceRecordId)) === "removed")
      await store.write("remove_external_report", { id: row.id });
    if (
      row.source === "rescuegroups" &&
      (await providers.checkRescueGroupsRecord(row.sourceRecordId)) === "removed"
    )
      await store.write("inactive_external_listing", { id: row.id });
  }
  const reports = await store.read<Report[]>("service_reports");
  const areas = new Set<string>();
  for (const r of reports.filter((r) => r.type === "lost")) {
    const latitude = Math.round(r.latitude * 100) / 100,
      longitude = Math.round(r.longitude * 100) / 100;
    const key = [latitude, longitude, r.species, r.generalLocation, r.breed].join("/");
    if (areas.has(key)) continue;
    areas.add(key);
    const animal = species.safeParse(r.species);
    if (r.generalLocation && animal.success)
      await ingestSocial(store, { city: r.generalLocation, species: animal.data, breed: r.breed, limit: 15 });
    const point = { latitude, longitude, radiusKm: 50, limit: 20 };
    await ingestShelters(store, point);
    await ingestAnimals(store, { ...point, species: animal.success ? animal.data : undefined }, r.observedAt);
  }
}
type Retry = { version: number; delayMs: number; nextAt: number };
export async function drain(store: Store, process = processJob, retries = new Map<string, Retry>()) {
  const jobs = await store.read<Job[]>("service_jobs");
  const pending = new Set(jobs.map((job) => job.id));
  for (const id of retries.keys()) if (!pending.has(id)) retries.delete(id);
  let completed = 0;
  for (const job of jobs) {
    const retry = retries.get(job.id);
    if (retry && retry.version === job.version && retry.nextAt > Date.now()) continue;
    try {
      await process(store, job);
      retries.delete(job.id);
      completed++;
    } catch (e) {
      const delayMs = Math.min(300000, (retry?.delayMs || 5000) * 2);
      retries.set(job.id, { version: job.version, delayMs, nextAt: Date.now() + delayMs });
      console.error("Matching job remains pending:", job.id, e instanceof Error ? e.name : "error");
    }
  }
  return { completed, pending: jobs.length - completed };
}
async function run() {
  const store = systemStore();
  let closing = false;
  process.once("SIGTERM", () => {
    closing = true;
  });
  process.once("SIGINT", () => {
    closing = true;
  });
  const interval = Number(process.env.INGEST_INTERVAL_MS || 15 * 60 * 1000);
  if (!Number.isFinite(interval) || interval < 60000)
    throw new Error("INGEST_INTERVAL_MS must be at least 60000");
  let nextRefresh = 0;
  const retries = new Map<string, Retry>();
  while (!closing) {
    try {
      await drain(store, processJob, retries);
    } catch {
      console.error("Could not poll the matching queue");
    }
    if (Date.now() >= nextRefresh) {
      try {
        await refreshSources(store);
      } catch {
        console.error("Source refresh failed; the next cycle will retry");
      }
      nextRefresh = Date.now() + interval;
    }
    if (!closing) await delay(5000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
