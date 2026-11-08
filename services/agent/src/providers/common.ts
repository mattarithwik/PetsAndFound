import { createHash } from "node:crypto";

export type Species = "cat" | "dog" | "other";
export interface Point {
  latitude: number;
  longitude: number;
}
export interface Near extends Point {
  radiusKm?: number;
  limit?: number;
}
export type SourceStatus = {
  source: string;
  status: "ok" | "unavailable";
  detail?: string;
};
export interface Result<T> {
  items: T[];
  sources: SourceStatus[];
}
export interface ExternalPetReport {
  id: string;
  source: "bluesky" | "rescuegroups" | "dallas";
  sourceRecordId: string;
  sourceUrl: string;
  reportType: "lost" | "found" | "shelter_listing" | "unknown";
  species?: Species;
  breed?: string;
  colors?: string[];
  markings?: string;
  location?: Point & { confidence: "exact" | "approximate" | "inferred" };
  locationLabel?: string;
  photoUrls: string[];
  postedAt?: string;
  observedAt?: string;
  sourceUpdatedAt?: string;
  ingestedAt: string;
  processingAllowed: boolean;
  processingPrincipal?: string;
  status: "new";
}

export function recordId(source: string, id: string) {
  return source + "-" + createHash("sha256").update(id).digest("hex");
}
export function asText(value: unknown, max = 250) {
  return typeof value === "string"
    ? value.trim().slice(0, max) || undefined
    : undefined;
}
export function asDate(value: unknown) {
  const string = asText(value);
  if (!string) return undefined;
  const timestamp = Date.parse(string);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}
export function asPoint(lat: unknown, lon: unknown): Point | undefined {
  if (
    ![lat, lon].every(
      (n) =>
        typeof n === "number" || (typeof n === "string" && n.trim() !== ""),
    )
  )
    return;
  const latitude = Number(lat),
    longitude = Number(lon);
  if (
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  )
    return { latitude, longitude };
}
export function bounds(input: Near) {
  if (!asPoint(input.latitude, input.longitude))
    throw new Error("Invalid search coordinates");
  const radiusKm = input.radiusKm ?? 30;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100)
    throw new Error("Invalid search radius");
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    radiusKm,
    limit: boundedLimit(input.limit),
  };
}
export function boundedLimit(value = 20) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error("Invalid limit");
  return value;
}
export function publicUrl(
  value: unknown,
  httpsOnly = false,
): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const u = new URL(value);
    if (
      !u.username &&
      !u.password &&
      (u.protocol === "https:" || (!httpsOnly && u.protocol === "http:"))
    )
      return u.href;
  } catch {
    /* This feed item has no usable link. */
  }
}
export function permittedPhotos(principal: string, candidates: unknown[]) {
  const hosts = new Set(
    (process.env.EXTERNAL_IMAGE_HOSTS || "")
      .toLowerCase()
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  const rights = new Set(
    (process.env.EXTERNAL_IMAGE_RIGHTSHOLDERS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  const photoUrls = [
    ...new Set(
      candidates.map((v) => publicUrl(v, true)).filter((v): v is string => !!v),
    ),
  ];
  const approved = rights.has(principal)
    ? photoUrls.filter((url) => {
        const u = new URL(url);
        return !u.port && hosts.has(u.hostname.toLowerCase());
      })
    : [];
  // An approval applies to a publisher and exact media hosts. Never pass unrelated images to inference.
  return {
    photoUrls: approved.length ? approved.slice(0, 5) : photoUrls.slice(0, 5),
    processingAllowed: approved.length > 0,
  };
}
export function eligibleExternalPhotos(row: {
  source: string;
  processingPrincipal?: string;
  processingAllowed: boolean;
  photoUrls: string[];
}) {
  const principal = row.processingPrincipal;
  if (
    !row.processingAllowed ||
    !principal ||
    !principal.startsWith(row.source + ":")
  )
    return [];
  const checked = permittedPhotos(principal, row.photoUrls);
  return checked.processingAllowed ? checked.photoUrls : [];
}

export type JsonObject = Record<string, unknown>;
export function object(v: unknown): JsonObject {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as JsonObject)
    : {};
}
export function rows(v: unknown): JsonObject[] {
  if (!Array.isArray(v)) throw new Error("Invalid provider response");
  return v.map(object);
}
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly emptyData = false,
  ) {
    super(message);
  }
}
const retryAfter = new Map<string, number>();
export async function request(
  url: URL,
  init: RequestInit = {},
): Promise<unknown> {
  const until = retryAfter.get(url.origin);
  if (until && Date.now() < until)
    throw new ProviderError("Provider rate limit is active", 429);
  if (until) retryAfter.delete(url.origin);
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent"))
    headers.set("User-Agent", process.env.PROVIDER_USER_AGENT || "PawSafe/1.0");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    if (response.status === 429) {
      const wait = response.headers.get("retry-after");
      const resume =
        wait && /^\d+$/.test(wait)
          ? Date.now() + Number(wait) * 1000
          : Date.parse(wait || "");
      retryAfter.set(
        url.origin,
        Number.isFinite(resume) && resume > Date.now()
          ? resume
          : Date.now() + 60000,
      );
    }
    const body = object(await response.json().catch(() => undefined));
    throw new ProviderError(
      "Upstream HTTP " + response.status,
      response.status,
      asText(body.error, 60),
      Object.hasOwn(body, "data") &&
        (body.data === null ||
          (typeof body.data === "object" &&
            Object.keys(body.data).length === 0)),
    );
  }
  return response.json();
}
export async function sourced<T>(
  source: string,
  read: () => Promise<T[]>,
): Promise<Result<T>> {
  try {
    return { items: await read(), sources: [{ source, status: "ok" }] };
  } catch (e) {
    return {
      items: [],
      sources: [
        {
          source,
          status: "unavailable",
          detail:
            e instanceof ProviderError
              ? e.message
              : "Provider request failed or returned an invalid response",
        },
      ],
    };
  }
}
export function unique<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
