import {
  asDate,
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
  JsonObject,
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
function rescueGroupsHeaders() {
  const key = process.env.RESCUEGROUPS_API_KEY;
  if (!key) throw new ProviderError("RescueGroups API key is not configured");
  return { Authorization: key, "Content-Type": "application/vnd.api+json" };
}
async function rescueGroups(path: string, input: Near, include?: string) {
  const { latitude, longitude, radiusKm, limit } = bounds(input);
  const url = new URL("https://api.rescuegroups.org/v5/public/" + path);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "distance");
  if (include) url.searchParams.set("include", include);
  return object(
    await request(url, {
      method: "POST",
      headers: rescueGroupsHeaders(),
      body: JSON.stringify({
        data: {
          filterRadius: { lat: latitude, lon: longitude, kilometers: radiusKm },
        },
      }),
    }),
  );
}
function related(
  animal: JsonObject,
  type: string,
  included: Map<string, JsonObject>,
) {
  const relation = object(object(animal.relationships)[type]).data;
  return (Array.isArray(relation) ? relation : relation ? [relation] : [])
    .map(object)
    .map((ref) => {
      const item = included.get(String(ref.type) + "/" + ref.id);
      return { id: String(ref.id), attributes: object(item?.attributes) };
    });
}
function imageUrl(attribute: unknown) {
  return typeof attribute === "string" ? attribute : object(attribute).url;
}
export async function checkRescueGroupsRecord(
  id: string,
): Promise<"present" | "removed" | "unavailable"> {
  if (!/^\d{1,32}$/.test(id)) return "unavailable";
  const url = new URL("https://api.rescuegroups.org/v5/public/animals/" + id);
  url.searchParams.set("include", "statuses");
  try {
    const body = object(await request(url, { headers: rescueGroupsHeaders() }));
    const animals = Array.isArray(body.data)
      ? rows(body.data)
      : [object(body.data)];
    if (
      animals.length !== 1 ||
      animals[0].type !== "animals" ||
      String(animals[0].id) !== id
    )
      return "unavailable";
    const relation = object(object(animals[0].relationships).statuses).data;
    const refs = Array.isArray(relation) ? rows(relation) : [object(relation)];
    if (refs.length !== 1 || refs[0].type !== "statuses" || !refs[0].id)
      return "unavailable";
    const matches = rows(body.included).filter(
      (item) =>
        item.type === "statuses" && String(item.id) === String(refs[0].id),
    );
    if (matches.length !== 1) return "unavailable";
    const name = asText(object(matches[0].attributes).name)?.toLowerCase();
    if (!name) return "unavailable";
    // RescueGroups defines its available view as statuses.name == "Available".
    return name === "available" ? "present" : "removed";
  } catch (e) {
    // RescueGroups documents a missing entity as 404 with an empty data object.
    // A CDN error page or an empty search page provides no evidence of removal.
    return e instanceof ProviderError && e.status === 404 && e.emptyData
      ? "removed"
      : "unavailable";
  }
}
export async function searchShelterAnimals(
  input: Near & { species?: Species },
) {
  bounds(input);
  return sourced<ExternalPetReport>("rescuegroups", async () => {
    const view =
      input.species === "cat" || input.species === "dog"
        ? input.species + "s/"
        : "";
    const data = await rescueGroups(
      "animals/search/available/" + view,
      input,
      "species,colors,pictures,locations,orgs",
    );
    const included = new Map(
      rows(data.included ?? []).map((r) => [String(r.type) + "/" + r.id, r]),
    );
    const reports: ExternalPetReport[] = [];
    for (const animal of rows(data.data)) {
      const a = object(animal.attributes),
        animalId = String(animal.id || "");
      if (!/^\d+$/.test(animalId)) continue;
      const spec = asText(
        related(animal, "species", included)[0]?.attributes.singular,
      )?.toLowerCase();
      const species =
        spec === "dog" || spec === "cat" ? spec : spec ? "other" : undefined;
      if (input.species && species !== input.species) continue;
      const org = related(animal, "orgs", included)[0],
        loc =
          related(animal, "locations", included)[0]?.attributes ??
          org?.attributes ??
          {};
      const point = asPoint(loc.lat, loc.lon);
      const sourceUrl = publicUrl(a.url) || publicUrl(org?.attributes.url);
      const photos = related(animal, "pictures", included).map(
        ({ attributes: p }) => imageUrl(p.large) || imageUrl(p.original),
      );
      if (!photos.length && a.pictureThumbnailUrl)
        photos.push(a.pictureThumbnailUrl);
      const permitted = permittedPhotos(
        org ? "rescuegroups:" + org.id : "",
        photos,
      );
      reports.push({
        id: recordId("rescuegroups", animalId),
        source: "rescuegroups",
        sourceRecordId: animalId,
        sourceUrl:
          sourceUrl ||
          "https://api.rescuegroups.org/v5/public/animals/" + animalId,
        reportType: a.isFound === true ? "found" : "shelter_listing",
        species,
        breed: asText(a.breedString) || asText(a.breedPrimary),
        colors: related(animal, "colors", included).flatMap(
          ({ attributes: c }) => asText(c.name) || [],
        ),
        markings: asText(a.distinguishingMarks, 400),
        location: point ? { ...point, confidence: "approximate" } : undefined,
        locationLabel: asText(loc.citystate) || asText(loc.city),
        processingPrincipal: org ? "rescuegroups:" + org.id : undefined,
        ...permitted,
        postedAt: asDate(a.createdDate),
        observedAt: asDate(a.foundDate),
        sourceUpdatedAt: asDate(a.updatedDate),
        ingestedAt: new Date().toISOString(),
        status: "new",
      });
    }
    return unique(reports);
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
async function osm(input: Near) {
  const { latitude, longitude, radiusKm } = bounds(input);
  const url = new URL(process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter");
  const query =
    '[out:json][timeout:8];nwr["amenity"="animal_shelter"](around:' +
    Math.round(radiusKm * 1000) +
    "," +
    latitude +
    "," +
    longitude +
    ");out center;";
  const data = object(
    await request(url, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
    }),
  );
  if (data.remark)
    throw new ProviderError("Overpass returned an incomplete response");
  return rows(data.elements).flatMap((el) => {
    if (
      !["node", "way", "relation"].includes(String(el.type)) ||
      !/^\d+$/.test(String(el.id))
    )
      return [];
    const tags = object(el.tags),
      center = object(el.center);
    const point = asPoint(el.lat ?? center.lat, el.lon ?? center.lon),
      key = el.type + "/" + el.id;
    const street = [tags["addr:housenumber"], tags["addr:street"]]
      .map((x) => asText(x))
      .filter(Boolean)
      .join(" ");
    return directoryRow(
      "osm-" + el.type + "-" + el.id,
      "https://www.openstreetmap.org/" + key,
      tags.name,
      point,
      [street, tags["addr:city"], tags["addr:state"], tags["addr:postcode"]],
      tags.website || tags["contact:website"],
      tags.phone || tags["contact:phone"],
    );
  });
}
async function organizations(input: Near) {
  const data = await rescueGroups("orgs/search/", input);
  return rows(data.data).flatMap((row) => {
    if (!/^\d+$/.test(String(row.id))) return [];
    const a = object(row.attributes),
      url = "https://api.rescuegroups.org/v5/public/orgs/" + row.id;
    return directoryRow(
      "rg-org-" + row.id,
      url,
      a.name,
      asPoint(a.lat, a.lon),
      [a.street, a.city, a.state, a.postalcode],
      a.url,
      a.phone,
    );
  });
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
    sourced("rescuegroups", () => organizations(input)),
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
