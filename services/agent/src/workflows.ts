import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, type Actor, type Report, type Store } from "./db.js";
import * as providers from "./providers/index.js";
import { distance } from "./providers/shelters.js";
import { matchReport } from "./matching.js";

export const id = z.string().min(1).max(200);
export const species = z.enum(["dog", "cat", "other"]);
export const point = z
  .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
  .strict();
export const near = point.extend({
  radiusKm: z.number().positive().max(100).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const socialInput = z
  .object({
    city: z.string().trim().min(1).max(120),
    species,
    breed: z.string().max(80).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export function stableId(...parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export async function ingestSocial(store: Store, input: z.infer<typeof socialInput>) {
  const result = await providers.searchBluesky(input);
  for (const r of result.items) await store.write("upsert_external_report", r);
  return result;
}
export async function ingestShelters(store: Store, input: z.infer<typeof near>) {
  const result = await providers.findNearbyShelters(input);
  for (const s of result.items) await store.write("upsert_directory_shelter", s);
  // Include registered shelters even when a directory provider is down.
  const rows = await store.read<
    {
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      address?: string;
      phone?: string;
      website?: string;
      directorySources?: unknown;
      directoryConfidence?: string;
      operatorVerified?: boolean;
      acceptingAnimals?: boolean;
      totalCapacity?: number;
      currentOccupancy?: number;
      capacityUpdatedAt?: string;
    }[]
  >("shelters");
  const items = rows
    .map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
      phone: s.phone,
      website: s.website,
      directorySources: s.directorySources,
      directoryConfidence: s.directoryConfidence,
      operatorVerified: !!s.operatorVerified,
      // Operational state is only meaningful when reported by verified staff.
      ...(s.operatorVerified
        ? {
            acceptingAnimals: s.acceptingAnimals,
            totalCapacity: s.totalCapacity,
            currentOccupancy: s.currentOccupancy,
            capacityUpdatedAt: s.capacityUpdatedAt,
          }
        : {}),
      distanceKm: distance(input, s),
    }))
    .filter((s) => s.distanceKm <= (input.radiusKm ?? 30))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, input.limit ?? 20);
  return { items, sources: [...result.sources, { source: "pawsafe", status: "ok" }] };
}
export async function ingestAnimals(
  store: Store,
  input: z.infer<typeof near> & { species?: "dog" | "cat" | "other" },
  since?: string,
) {
  const sources = [providers.searchShelterAnimals(input)];
  if (Math.abs(input.latitude - 32.78) < 0.6 && Math.abs(input.longitude + 96.8) < 0.65)
    sources.push(providers.searchDallas({ species: input.species, limit: input.limit, since }));
  const results = await Promise.all(sources);
  const items = results.flatMap((result) => result.items);
  for (const item of items) await store.write("upsert_external_report", item);
  return { items, sources: results.flatMap((result) => result.sources) };
}
export async function officialAlerts(actor: Actor, location: z.infer<typeof point>) {
  const result = await providers.getWeatherAlerts(location);
  for (const alert of result.items) {
    await actor.system.write("upsert_disaster_alert", alert);
    await actor.system.write("create_notification", {
      id: stableId(actor.id, "NWS", alert.alertId),
      recipientId: actor.id,
      eventType: "DISASTER_ALERT",
      payload: { alertId: alert.alertId, event: alert.event, expiresAt: alert.expiresAt },
    });
  }
  return result;
}
export async function ownReport(actor: Actor, reportId: string) {
  const report = await actor.db.read<Report | null>("report", reportId);
  if (!report) throw new ApiError(404, "Report not found");
  return report;
}
export async function searchMatches(actor: Actor, reportId: string) {
  const report = await ownReport(actor, reportId);
  if (report.status !== "open") throw new ApiError(409, "Report is no longer open");
  const coverage = { failures: 0 };
  await matchReport(actor.system, reportId, coverage);
  const matches =
    await actor.db.read<
      { id: string; score: number; status: string; lostReportId: string; candidateId: string }[]
    >("matches");
  return {
    items: matches
      .filter((m) => m.status !== "rejected" && (m.lostReportId === reportId || m.candidateId === reportId))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 5),
    coverage: coverage.failures ? "partial" : "complete",
  };
}
