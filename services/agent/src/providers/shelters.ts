import {
  asPoint,
  asText,
  bounds,
  object,
  permittedPhotos,
  ProviderError,
  publicUrl,
  recordId,
  request,
  rows,
  sourced,
  unique,
} from "./common.js";
import type {
  ExternalPetReport,
  Near,
  Point,
  Species,
} from "./common.js";

interface Shelter extends Point {
  id: string;
  name: string;
  address: string;
  website?: string;
  phone?: string;
  sourceIds: string[];
  directorySources: string[];
  directoryConfidence: "medium" | "high";
  operatorVerified: false;
}
type Group = Point & { id: string; name: string; address: string; city: string };
// A public feed belongs to one shelter. These coordinates locate the organization,
// not an individual animal (which may be in foster care).
const dallasGroups: Group[] = [{
  id: "3451",
  name: "Dallas Pets Alive",
  address: "3110 Commonwealth Dr, Dallas, TX 75247",
  city: "Dallas, TX",
  latitude: 32.8109082,
  longitude: -96.8616349,
}];
function groups(): Group[] {
  const raw = process.env.SHELTERLUV_GROUPS;
  if (!raw) return dallasGroups;
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 20) throw new ProviderError("Invalid SHELTERLUV_GROUPS");
  return value.map((item) => {
    const g = object(item);
    const point = asPoint(g.latitude, g.longitude);
    if (!/^\d{1,12}$/.test(String(g.id)) || !point || !asText(g.name) || !asText(g.city))
      throw new ProviderError("Invalid SHELTERLUV_GROUPS");
    return { id: String(g.id), name: asText(g.name)!, city: asText(g.city)!, address: asText(g.address) || "", ...point };
  });
}
function nearbyGroups(input: Near) {
  const { radiusKm } = bounds(input);
  return groups().filter((g) => distance(g, input) <= radiusKm);
}
const feedCache = new Map<string, { until: number; promise: Promise<ReturnType<typeof rows>> }>();
async function availableAnimals(group: Group, species?: Species) {
  const key = `${group.id}:${species || "all"}`;
  const cached = feedCache.get(key);
  if (cached && cached.until > Date.now()) return cached.promise;
  const url = new URL(`https://new.shelterluv.com/api/v3/available-animals/${group.id}`);
  if (species === "dog" || species === "cat")
    url.searchParams.set("animalType", species === "dog" ? "Dog" : "Cat");
  const promise = request(url).then((data) => rows(object(data).animals));
  feedCache.set(key, { until: Date.now() + 60000, promise });
  promise.catch(() => feedCache.delete(key));
  return promise;
}
export async function checkShelterluvRecord(id: string): Promise<"present" | "removed" | "unavailable"> {
  const [groupId, animalId] = id.split(":");
  if (!/^\d{1,12}$/.test(groupId || "") || !/^\d{1,16}$/.test(animalId || "")) return "unavailable";
  const group = groups().find((g) => g.id === groupId);
  if (!group) return "unavailable";
  try {
    const animals = await availableAnimals(group);
    return animals.some((animal) => String(animal.nid) === animalId) ? "present" : "removed";
  } catch {
    return "unavailable";
  }
}
export async function searchShelterAnimals(input: Near & { species?: Species }) {
  bounds(input);
  return sourced<ExternalPetReport>("shelterluv", async () => {
    const reports: ExternalPetReport[] = [];
    for (const group of nearbyGroups(input)) {
      const animals = await availableAnimals(group, input.species);
      for (const animal of animals) {
        const animalId = String(animal.nid || "");
        if (!/^\d{1,16}$/.test(animalId)) continue;
        const kind = asText(animal.species)?.toLowerCase();
        const species = kind === "dog" || kind === "cat" ? kind : kind ? "other" : undefined;
        if (input.species && species !== input.species) continue;
        const sourceRecordId = `${group.id}:${animalId}`;
        const photoRows = Array.isArray(animal.photos)
          ? animal.photos
          : Object.values(object(animal.photos));
        const photos = photoRows.map((p) => object(p).url);
        const permitted = permittedPhotos(`shelterluv:${group.id}`, photos);
        reports.push({
          id: recordId("shelterluv", sourceRecordId),
          source: "shelterluv",
          sourceRecordId,
          sourceUrl: publicUrl(animal.public_url, true) || `https://new.shelterluv.com/embed/${group.id}`,
          reportType: "shelter_listing",
          species,
          breed: asText(animal.breed),
          colors: [animal.primary_color, animal.secondary_color].flatMap((v) => asText(v) || []),
          location: { latitude: group.latitude, longitude: group.longitude, confidence: "approximate" },
          locationLabel: group.city,
          processingPrincipal: `shelterluv:${group.id}`,
          ...permitted,
          ingestedAt: new Date().toISOString(),
          status: "new",
        });
      }
    }
    return unique(reports).slice(0, bounds(input).limit);
  });
}
export function distance(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((a.latitude - b.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((a.longitude - b.longitude) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function directoryRow(
  id: string,
  url: string,
  name: unknown,
  point: Point | undefined,
  addressParts: unknown[],
  website: unknown,
  phone: unknown,
): Shelter[] {
  const label = asText(name);
  if (!label || !point) return [];
  return [
    {
      id,
      ...point,
      name: label,
      address: addressParts
        .map((x) => asText(x))
        .filter(Boolean)
        .join(", "),
      phone: asText(phone, 64),
      website: publicUrl(website),
      directorySources: [url],
      sourceIds: [id],
      directoryConfidence: "medium",
      operatorVerified: false,
    },
  ];
}
const osmTypes: Record<string, string> = { N: "node", W: "way", R: "relation" };
async function osm(input: Near) {
  const { latitude, longitude } = bounds(input);
  const url = new URL(process.env.PHOTON_URL || "https://photon.komoot.io/api/");
  url.search = new URLSearchParams({
    q: "animal shelter",
    lat: String(latitude),
    lon: String(longitude),
    osm_tag: "amenity:animal_shelter",
    limit: "50",
  }).toString();
  const data = object(await request(url));
  return rows(data.features).flatMap((feature) => {
    const p = object(feature.properties),
      type = osmTypes[String(p.osm_type)];
    if (!type || !/^\d+$/.test(String(p.osm_id))) return [];
    const [lon, lat] = Array.isArray(object(feature.geometry).coordinates)
      ? (object(feature.geometry).coordinates as unknown[])
      : [];
    const street = [p.housenumber, p.street]
      .map((x) => asText(x))
      .filter(Boolean)
      .join(" ");
    return directoryRow(
      "osm-" + type + "-" + p.osm_id,
      "https://www.openstreetmap.org/" + type + "/" + p.osm_id,
      p.name,
      asPoint(lat, lon),
      [street, p.city, p.state, p.postcode],
      undefined,
      undefined,
    );
  });
}
async function organizations(input: Near) {
  return nearbyGroups(input).flatMap((g) => directoryRow(
    "shelterluv-org-" + g.id,
    `https://new.shelterluv.com/embed/${g.id}`,
    g.name,
    { latitude: g.latitude, longitude: g.longitude },
    [g.address],
    undefined,
    undefined,
  ));
}
function normalized(s = "") {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function sameOrganization(a: Shelter, b: Shelter) {
  if (a.sourceIds.includes(b.id)) return true;
  const phone = (s?: string) => s?.replace(/\D/g, "").slice(-10) || "";
  const website = (s?: string) =>
    s
      ?.replace(/^https?:\/\/(www\.)?/i, "")
      .replace(/\/$/, "")
      .toLowerCase() || "";
  const sharedPhone =
    phone(a.phone).length >= 10 && phone(a.phone) === phone(b.phone);
  const sharedWebsite =
    !!a.website && website(a.website) === website(b.website);
  const sameName = normalized(a.name) === normalized(b.name);
  const sameAddress =
    !!a.address && normalized(a.address) === normalized(b.address);
  const km = distance(a, b);
  // A shared street address, contact center, or brand can serve several distinct organizations/sites.
  return (
    km <= 3 &&
    ((sameName && (sharedPhone || sharedWebsite || sameAddress)) ||
      (sharedPhone && sharedWebsite && km <= 0.5))
  );
}
export async function findNearbyShelters(input: Near) {
  const { radiusKm, limit } = bounds(input);
  const results = await Promise.all([
    sourced("osm", () => osm(input)),
    sourced("shelterluv", () => organizations(input)),
  ]);
  const shelters: Shelter[] = [];
  for (const s of unique(results.flatMap((r) => r.items))) {
    if (distance(input, s) > radiusKm) continue;
    const matches = shelters.filter((other) => sameOrganization(other, s));
    if (matches.length !== 1) {
      shelters.push(s);
      continue;
    }
    const match = matches[0];
    match.sourceIds.push(s.id);
    match.directorySources.push(...s.directorySources);
    match.directoryConfidence = "high";
    match.website ??= s.website;
    match.phone ??= s.phone;
    match.address ||= s.address;
  }
  return {
    items: shelters
      .sort((a, b) => distance(input, a) - distance(input, b))
      .slice(0, limit),
    sources: results.flatMap((r) => r.sources),
  };
}
