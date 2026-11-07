import {
  asDate,
  asText,
  boundedLimit,
  object,
  permittedPhotos,
  ProviderError,
  recordId,
  request,
  rows,
  sourced,
  unique,
} from "./common.js";
import type { ExternalPetReport, JsonObject, Species } from "./common.js";

const xrpc = "https://public.api.bsky.app/xrpc/app.bsky.feed.";
const postUri =
  /^at:\/\/(did:[a-z]+:[a-zA-Z0-9.:%_-]+)\/app\.bsky\.feed\.post\/([a-zA-Z0-9._~:-]{1,512})$/;
type SocialQuery = {
  species: Species;
  city: string;
  breed?: string;
  since?: string;
  limit?: number;
};
function hasLabel(post: JsonObject) {
  const labels = [post.labels, object(post.author).labels].flatMap((v) =>
    Array.isArray(v) ? v.map(object) : [],
  );
  return labels.some(
    (l) =>
      !l.neg &&
      [
        "!hide",
        "!no-unauthenticated",
        "!warn",
        "porn",
        "sexual",
        "gore",
        "graphic-media",
      ].includes(String(l.val)),
  );
}
function normalize(
  post: JsonObject,
  input: SocialQuery,
): ExternalPetReport | undefined {
  const uri = asText(post.uri, 1000),
    parts = uri && postUri.exec(uri);
  const record = object(post.record),
    message = String(record.text || "").toLowerCase();
  if (!parts || !uri || parts[1] !== object(post.author).did || hasLabel(post))
    return;
  const city = input.city.split(",")[0].trim().toLowerCase();
  if (!city || !message.includes(city)) return;
  const dog = /\b(dog|dogs|puppy|canine)\b/.test(message),
    cat = /\b(cat|cats|kitten|feline)\b/.test(message);
  const mentionsBreed =
    !!input.breed?.trim() && message.includes(input.breed.trim().toLowerCase());
  if (
    !(
      dog ||
      cat ||
      mentionsBreed ||
      /\b(pet|bird|rabbit|parrot|turtle)\b/.test(message)
    )
  )
    return;
  const species =
    dog !== cat
      ? dog
        ? "dog"
        : "cat"
      : mentionsBreed
        ? input.species
        : undefined;
  if (species && species !== input.species) return;
  const lost = /\b(lost|missing|escaped)\b/.test(message),
    found = /\b(found|stray|sighted|spotted)\b/.test(message);
  if (
    (!lost && !found) ||
    /\b(reunited|back home|returned home)\b/.test(message)
  )
    return;
  const embed = object(post.embed);
  const media =
    embed.$type === "app.bsky.embed.recordWithMedia#view"
      ? object(embed.media)
      : embed;
  const images =
    media.$type === "app.bsky.embed.images#view" && Array.isArray(media.images)
      ? media.images.map((i) => object(i).fullsize)
      : [];
  return {
    id: recordId("bluesky", uri),
    source: "bluesky",
    sourceRecordId: uri,
    sourceUrl: "https://bsky.app/profile/" + parts[1] + "/post/" + parts[2],
    reportType: lost === found ? "unknown" : lost ? "lost" : "found",
    species,
    breed: mentionsBreed ? input.breed : undefined,
    locationLabel: input.city.split(",")[0].trim(),
    postedAt: asDate(record.createdAt),
    sourceUpdatedAt: asDate(post.indexedAt),
    processingPrincipal: "bluesky:" + parts[1],
    ...permittedPhotos("bluesky:" + parts[1], images),
    ingestedAt: new Date().toISOString(),
    status: "new",
  };
}
export async function searchBluesky(input: SocialQuery) {
  const limit = boundedLimit(input.limit),
    city = asText(input.city, 120);
  if (!city || !["dog", "cat", "other"].includes(input.species))
    throw new Error("Invalid social search");
  const pet = input.species === "other" ? "pet" : input.species;
  const queries = [
    ...new Set([
      "found " + (asText(input.breed, 80) || pet) + " " + city,
      "found " + pet + " " + city,
      "stray " + pet + " " + city,
    ]),
  ];
  const reports: ExternalPetReport[] = [];
  const result = await sourced("bluesky", async () => {
    let origin = "https://public.api.bsky.app";
    const headers = new Headers();
    if (process.env.BSKY_ACCESS_JWT || process.env.BSKY_PDS_URL) {
      const pds = new URL(process.env.BSKY_PDS_URL || "");
      if (
        !process.env.BSKY_ACCESS_JWT ||
        pds.protocol !== "https:" ||
        pds.username ||
        pds.password ||
        pds.pathname !== "/" ||
        pds.search ||
        pds.hash
      ) {
        throw new ProviderError(
          "Configure a Bluesky session JWT and its HTTPS PDS origin",
        );
      }
      origin = pds.origin;
      headers.set("Authorization", "Bearer " + process.env.BSKY_ACCESS_JWT);
      headers.set("atproto-proxy", "did:web:api.bsky.app#bsky_appview");
    }
    for (const query of queries) {
      const url = new URL("/xrpc/app.bsky.feed.searchPosts", origin);
      url.searchParams.set("q", query);
      url.searchParams.set("sort", "latest");
      url.searchParams.set("limit", String(limit));
      if (input.since) url.searchParams.set("since", input.since);
      const data = object(await request(url, { headers }));
      for (const p of rows(data.posts)) {
        const report = normalize(p, input);
        if (report) reports.push(report);
      }
      if (unique(reports).length >= limit) break;
    }
    return reports;
  });
  return { items: unique(reports).slice(0, limit), sources: result.sources };
}
export async function checkBlueskyRecord(
  uri: string,
): Promise<"present" | "removed" | "unavailable"> {
  if (!postUri.test(uri)) return "unavailable";
  const url = new URL(xrpc + "getPostThread");
  url.search = new URLSearchParams({
    uri,
    depth: "0",
    parentHeight: "0",
  }).toString();
  try {
    const thread = object(object(await request(url)).thread);
    if (
      thread.uri === uri &&
      thread.$type === "app.bsky.feed.defs#notFoundPost"
    )
      return "removed";
    const post = object(thread.post);
    if (
      thread.$type === "app.bsky.feed.defs#threadViewPost" &&
      post.uri === uri &&
      !hasLabel(post)
    )
      return "present";
  } catch (e) {
    if (
      e instanceof ProviderError &&
      [400, 404].includes(e.status || 0) &&
      e.code === "NotFound"
    )
      return "removed";
  }
  return "unavailable";
}
