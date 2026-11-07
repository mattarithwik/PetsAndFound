import {
  asDate,
  asText,
  boundedLimit,
  ProviderError,
  recordId,
  request,
  rows,
  sourced,
  unique,
} from "./common.js";
import type { ExternalPetReport, Species } from "./common.js";

// These are the city's published FY 2023–2026 datasets. Select only the fields needed for
// matching. The full rows can contain street addresses and operational notes.
const feeds = [
  {
    id: "uyte-zi7f",
    type: "intake",
    date: "intake_date",
    fields:
      "animal_id,animal_type,animal_breed,intake_date,intake_time,intake_type,impound_number",
  },
  {
    id: "pxcj-qffj",
    type: "field",
    date: "call_date_time",
    fields:
      "activity_number,activity_sequence,animal_type,activity_type,activity_subtype,city,call_date_time",
  },
] as const;

function speciesOf(value: unknown): Species | undefined {
  const name = asText(value)?.toLowerCase();
  if (!name || name === "unknown") return;
  return name === "dog" || name === "cat" ? name : "other";
}
const centralTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  timeZoneName: "shortOffset",
});
function fromDallasTime(value: unknown) {
  const s = asText(value);
  if (!s || /(?:Z|[+-]\d{2}:\d{2})$/i.test(s)) return asDate(s);
  // Socrata floating timestamps use local wall time. Convert using Central's offset
  // at that date rather than the process timezone.
  const wall = Date.parse(s + "Z");
  if (!Number.isFinite(wall)) return;
  const offset = centralTime
    .formatToParts(new Date(wall + 6 * 3600000))
    .find((p) => p.type === "timeZoneName")?.value;
  const hours = Number(offset?.replace("GMT", ""));
  return Number.isFinite(hours)
    ? new Date(wall - hours * 3600000).toISOString()
    : undefined;
}
export async function searchDallas(input: {
  species?: Species;
  since?: string;
  limit?: number;
}) {
  const limit = boundedLimit(input.limit);
  const since = input.since ? asDate(input.since) : undefined;
  if (input.since && !since) throw new Error("Invalid start date");
  const results = await Promise.all(
    feeds.map((feed) =>
      sourced<ExternalPetReport>("dallas_" + feed.type, async () => {
        const datasetUrl =
          "https://www.dallasopendata.com/resource/" + feed.id + ".json";
        const url = new URL(datasetUrl);
        url.searchParams.set("$select", ":id as row_id," + feed.fields);
        const sort =
          feed.type === "intake"
            ? "intake_date DESC, intake_time DESC"
            : "call_date_time DESC";
        url.searchParams.set("$order", sort + ", :id ASC");
        url.searchParams.set("$limit", String(limit));
        const filters: string[] = [];
        if (input.species === "dog" || input.species === "cat")
          filters.push(
            "upper(animal_type)='" + input.species.toUpperCase() + "'",
          );
        if (input.species === "other")
          filters.push("upper(animal_type) not in ('DOG','CAT')");
        // Fetch the local calendar day containing since, then apply the exact instant below.
        if (since) {
          const day = new Date(Date.parse(since) - 86400000)
            .toISOString()
            .slice(0, 10);
          filters.push(feed.date + " >= '" + day + "T00:00:00'");
        }
        if (filters.length)
          url.searchParams.set("$where", filters.join(" AND "));
        const data = rows(await request(url));
        const out: ExternalPetReport[] = [];
        for (const row of data) {
          const rowId = String(row.row_id ?? "");
          if (!/^[A-Za-z0-9:_.~-]{1,120}$/.test(rowId))
            throw new ProviderError("Dallas returned an invalid row ID");
          const intakeClock = asText(row.intake_time);
          const localTime =
            feed.type === "intake" &&
            intakeClock &&
            /^\d\d:\d\d:\d\d$/.test(intakeClock)
              ? String(row.intake_date).slice(0, 10) + "T" + intakeClock
              : row[feed.date];
          const observedAt = fromDallasTime(localTime);
          if (since && (!observedAt || observedAt < since)) continue;
          const link = new URL(datasetUrl);
          link.search = new URLSearchParams({
            $select: feed.fields,
            $where: ":id='" + rowId + "'",
          }).toString();
          const sourceRecordId = feed.id + "/" + rowId;
          const intake = feed.type === "intake";
          const type = String(row.intake_type || "").toUpperCase();
          out.push({
            id: recordId("dallas", sourceRecordId),
            source: "dallas",
            sourceRecordId,
            sourceUrl: link.href,
            reportType:
              intake && /STRAY|FOUND/.test(type) ? "found" : "unknown",
            species: speciesOf(row.animal_type),
            breed: asText(row.animal_breed),
            photoUrls: [],
            locationLabel: asText(row.city) || "Dallas",
            observedAt,
            ingestedAt: new Date().toISOString(),
            processingAllowed: false,
            status: "new",
          });
        }
        return out;
      }),
    ),
  );
  const items = unique(results.flatMap((r) => r.items)).sort((a, b) =>
    (b.observedAt || "").localeCompare(a.observedAt || ""),
  );
  return {
    items: items.slice(0, limit),
    sources: results.flatMap((r) => r.sources),
  };
}
