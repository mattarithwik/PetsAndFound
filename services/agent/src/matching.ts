import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, setting, type Job, type Photo, type Report, type Store } from "./db.js";
import { readImage, downloadUrl } from "./media.js";
import { eligibleExternalPhotos } from "./providers/index.js";

type External = {
  id: string;
  source: string;
  sourceUrl: string;
  reportType: string;
  species?: string;
  breed?: string;
  colors?: string[];
  photoUrls: string[];
  location?: { latitude: number; longitude: number };
  processingAllowed: boolean;
  processingPrincipal?: string;
  animalCount?: number;
  observedAt?: string;
  status: string;
};
export function externalPhotoId(reportId: string, url: string) {
  return (
    "ext-" +
    createHash("sha256")
      .update(reportId + "\0" + url)
      .digest("hex")
  );
}
export async function forgetExternalPhotos(row: { id: string; photoUrls: string[] }) {
  for (const url of new Set(row.photoUrls)) {
    const photoId = externalPhotoId(row.id, url);
    const response = await fetch(setting("VISION_SERVICE_URL").replace(/\/$/, "") + "/v1/images/" + photoId, {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: "Bearer " + setting("INTERNAL_SERVICE_SECRET") },
    });
    if (!response.ok && response.status !== 404)
      throw new ApiError(502, "Could not remove retired source photo");
  }
}
type Found = {
  id: string;
  type: "report" | "external";
  photoIds: string[];
  species?: string;
  latitude?: number;
  longitude?: number;
  observedAt?: string;
  breed?: string;
  colors?: string[];
  sourceUrl?: string;
};
type Candidate = {
  petId: string;
  candidatePhotoId: string;
  matchingPhotoId: string;
  visualSimilarity: number;
  combinedScore: number;
  components: unknown;
};
export type Inference = <T>(path: string, input: object) => Promise<T>;
export const vision: Inference = async <T>(path: string, input: object) => {
  const response = await fetch(setting("VISION_SERVICE_URL").replace(/\/$/, "") + path, {
    method: "POST",
    signal: AbortSignal.timeout(180000),
    redirect: "error",
    headers: {
      Authorization: "Bearer " + setting("INTERNAL_SERVICE_SECRET"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new ApiError(502, "Vision service failed (" + response.status + ")");
  return (await response.json()) as T;
};
async function embedPhoto(store: Store, photo: Photo, species?: string) {
  if (photo.embeddingRef) return;
  const imageBase64 = await readImage(
    downloadUrl(photo.storageKey),
    new Set(["api.cloudinary.com", "res.cloudinary.com"]),
  );
  const result = await vision<{ embeddingRef: string }>("/v1/images/embed", {
    photoId: photo.id,
    petId: photo.petId || undefined,
    view: photo.angle || undefined,
    animalCount: photo.animalCount || undefined,
    species,
    imageBase64,
  });
  await store.write("set_photo_embedding", { id: photo.id, embeddingRef: result.embeddingRef });
}
type Coverage = { failures: number };
async function readyPhotos(store: Store, r: Report, coverage: Coverage) {
  const ready: Photo[] = [];
  for (const photo of await store.read<Photo[]>("service_photos", r.id)) {
    try {
      await embedPhoto(store, photo, r.species);
      ready.push(photo);
    } catch {
      coverage.failures++;
    }
  }
  return ready;
}
async function native(store: Store, r: Report, coverage: Coverage): Promise<Found> {
  const photos = await readyPhotos(store, r, coverage);
  return {
    id: r.id,
    type: "report",
    photoIds: photos.map((p) => p.id),
    species: r.species,
    latitude: r.latitude,
    longitude: r.longitude,
    observedAt: r.observedAt,
    breed: r.breed,
    colors: r.colors,
  };
}
async function externalCandidate(r: External, coverage: Coverage): Promise<Found> {
  const ids: string[] = [];
  const approved = new Set(
    (process.env.EXTERNAL_IMAGE_HOSTS || "")
      .toLowerCase()
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  );
  if (r.processingAllowed && approved.size && ["found", "shelter_listing"].includes(r.reportType)) {
    for (const url of eligibleExternalPhotos(r).slice(0, 5)) {
      if (!approved.has(new URL(url).hostname)) continue;
      const id = externalPhotoId(r.id, url);
      try {
        const imageBase64 = await readImage(url, approved);
        await vision("/v1/images/embed", {
          photoId: id,
          species: r.species,
          animalCount: r.animalCount || undefined,
          imageBase64,
        });
        ids.push(id);
      } catch {
        coverage.failures++;
      }
    }
  }
  return {
    id: r.id,
    type: "external",
    photoIds: ids,
    species: r.species,
    ...r.location,
    observedAt: r.observedAt,
    colors: r.colors,
    breed: r.breed,
    sourceUrl: r.sourceUrl,
  };
}
function attributes(entity: { breed?: string; colors?: string[] }) {
  const values: Record<string, string> = {};
  if (entity.breed) values.breed = entity.breed;
  if (entity.colors?.length) values.colors = entity.colors.join(", ");
  return values;
}
export function notificationThreshold() {
  const raw = process.env.MATCH_NOTIFY_THRESHOLD?.trim();
  if (!raw) return undefined;
  const threshold = Number(raw);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
    throw new ApiError(503, "Invalid MATCH_NOTIFY_THRESHOLD");
  return threshold;
}
async function scoreCandidates(
  store: Store,
  found: Found,
  lost: Report[],
  infer: Inference,
  coverage: Coverage,
) {
  if (!found.photoIds.length || !lost.length) return [];
  // Search per lost report so the correct timeline and location are retained even when a pet has multiple reports.
  const results = [];
  for (const r of lost) {
    if (!r.petId || (r.species && found.species && r.species !== found.species)) continue;
    const refs = await readyPhotos(store, r, coverage);
    if (!refs.some((p) => p.petId === r.petId)) continue;
    const response = await infer<{ candidates: Candidate[]; model: string }>("/v1/pets/search", {
      candidatePhotoIds: found.photoIds,
      species: found.species,
      latitude: found.latitude,
      longitude: found.longitude,
      observedAt: found.observedAt,
      attributes: attributes(found),
      radiusKm: 50,
      topK: 1,
      references: [
        {
          petId: r.petId,
          photoIds: refs.filter((p) => p.petId === r.petId).map((p) => p.id),
          species: r.species,
          latitude: r.latitude,
          longitude: r.longitude,
          missingSince: r.observedAt,
          attributes: attributes(r),
        },
      ],
    }).catch(() => {
      coverage.failures++;
      return undefined;
    });
    if (!response) continue;
    for (const c of response.candidates) {
      if (
        c.petId !== r.petId ||
        !found.photoIds.includes(c.candidatePhotoId) ||
        !refs.some((p) => p.id === c.matchingPhotoId) ||
        !Number.isFinite(c.combinedScore) ||
        c.combinedScore < 0 ||
        c.combinedScore > 1
      )
        continue;
      const evidence = {
        candidatePhotoId: c.candidatePhotoId,
        matchingPhotoId: c.matchingPhotoId,
        visualSimilarity: c.visualSimilarity,
        components: c.components,
        model: response.model,
        sourceUrl: found.sourceUrl,
      };
      results.push({
        lostReportId: r.id,
        candidateId: found.id,
        candidateType: found.type,
        score: c.combinedScore,
        evidence,
      });
    }
  }
  return results;
}
async function publishShortlist(store: Store, proposals: Awaited<ReturnType<typeof scoreCandidates>>) {
  const threshold = notificationThreshold();
  const best = proposals
    .sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId))
    .slice(0, 5);
  for (const proposal of best) {
    await store.write("propose_match", {
      ...proposal,
      notify: threshold !== undefined && proposal.score >= threshold,
    });
  }
  return best;
}
export async function rank(
  store: Store,
  found: Found,
  lost: Report[],
  infer: Inference = vision,
  coverage: Coverage = { failures: 0 },
) {
  return publishShortlist(store, await scoreCandidates(store, found, lost, infer, coverage));
}
export async function matchReport(store: Store, id: string, coverage: Coverage = { failures: 0 }) {
  const reports = await store.read<Report[]>("service_reports");
  const target = reports.find((r) => r.id === id);
  if (!target) return [];
  if (target.type === "found")
    return rank(
      store,
      await native(store, target, coverage),
      reports.filter((r) => r.type === "lost"),
      vision,
      coverage,
    );
  await native(store, target, coverage);
  const results = [];
  for (const candidate of reports.filter((r) => r.type === "found"))
    results.push(
      ...(await scoreCandidates(store, await native(store, candidate, coverage), [target], vision, coverage)),
    );
  for (const row of await store.read<External[]>("service_external")) {
    if (row.processingAllowed && !["dismissed", "removed"].includes(row.status))
      results.push(
        ...(await scoreCandidates(store, await externalCandidate(row, coverage), [target], vision, coverage)),
      );
  }
  return publishShortlist(store, results);
}
export async function processJob(store: Store, job: Job) {
  const coverage = { failures: 0 };
  if (job.purgeExternalId) {
    await forgetExternalPhotos({ id: job.purgeExternalId, photoUrls: job.photoUrls || [] });
  } else if (job.externalId) {
    const row = (await store.read<External[]>("service_external")).find((r) => r.id === job.externalId);
    if (row)
      await rank(
        store,
        await externalCandidate(row, coverage),
        (await store.read<Report[]>("service_reports")).filter((r) => r.type === "lost"),
        vision,
        coverage,
      );
  } else if (job.photoId) {
    const photo = await store.read<Photo | null>("service_photo", job.photoId);
    if (photo) await embedPhoto(store, photo);
  } else await matchReport(store, job.reportId, coverage);
  if (coverage.failures) throw new ApiError(503, "Part of the matching job needs a retry");
  await store.write("complete_matching_job", { id: job.id, version: job.version });
}
export const reportQuery = z.object({ reportId: z.string().min(1).max(128) }).strict();
