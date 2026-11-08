import {
  asDate,
  asPoint,
  asText,
  boundedLimit,
  object,
  request,
  rows,
  sourced,
} from "./common.js";
import type { Point, Result, Species } from "./common.js";

interface WeatherAlert {
  source: "NWS";
  alertId: string;
  sourceUrl: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  description: string;
  instruction?: string;
  effectiveAt: string;
  expiresAt?: string;
}
const alertRequests = new Map<
  string,
  { expires: number; response: Promise<Result<WeatherAlert>> }
>();
export async function getWeatherAlerts(point: Point) {
  if (!asPoint(point.latitude, point.longitude))
    throw new Error("Invalid weather coordinates");
  const key = point.latitude.toFixed(4) + "," + point.longitude.toFixed(4);
  let entry = alertRequests.get(key);
  if (!entry || Date.now() >= entry.expires) {
    const response = sourced<WeatherAlert>("nws", async () => {
      const url = new URL("https://api.weather.gov/alerts/active");
      url.search = new URLSearchParams({
        point: key,
        status: "actual",
      }).toString();
      const data = object(
        await request(url, { headers: { Accept: "application/geo+json" } }),
      );
      const alerts: WeatherAlert[] = [];
      for (const feature of rows(data.features)) {
        const p = object(feature.properties);
        if (
          p.status !== "Actual" ||
          (p.messageType !== "Alert" && p.messageType !== "Update")
        )
          continue;
        const alertId = asText(p.id, 1000),
          event = asText(p.event),
          effectiveAt = asDate(p.effective),
          expiresAt = asDate(p.expires);
        if (!alertId || !event || !effectiveAt)
          throw new Error("Incomplete official weather alert");
        alerts.push({
          source: "NWS",
          alertId,
          sourceUrl:
            "https://api.weather.gov/alerts/" + encodeURIComponent(alertId),
          event,
          severity: asText(p.severity) || "Unknown",
          urgency: asText(p.urgency) || "Unknown",
          headline: asText(p.headline, 2000) || event,
          description: asText(p.description, 60000) || "",
          instruction: asText(p.instruction, 60000),
          effectiveAt,
          expiresAt,
        });
      }
      return alerts;
    });
    entry = { response, expires: Date.now() + 30000 };
    if (alertRequests.size >= 1000)
      alertRequests.delete(alertRequests.keys().next().value!);
    alertRequests.set(key, entry);
  }
  const result = await entry.response;
  return {
    ...result,
    items: result.items.filter(
      (a) =>
        Date.parse(a.effectiveAt) <= Date.now() &&
        (!a.expiresAt || Date.parse(a.expiresAt) > Date.now()),
    ),
  };
}

export async function getDisasterHistory(input: {
  state: string;
  incidentType?: string;
  since?: string;
  limit?: number;
}) {
  const state = input.state.toUpperCase(),
    limit = boundedLimit(input.limit);
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Expected a two-letter state");
  const filters = ["state eq '" + state + "'"];
  if (input.incidentType) {
    if (!/^[A-Za-z][A-Za-z /-]{0,79}$/.test(input.incidentType))
      throw new Error("Invalid incident type");
    filters.push("incidentType eq '" + input.incidentType + "'");
  }
  if (input.since) {
    const since = asDate(input.since);
    if (!since) throw new Error("Invalid start date");
    filters.push("declarationDate ge '" + since + "'");
  }
  return sourced("fema", async () => {
    const url = new URL(
      "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries",
    );
    url.search = new URLSearchParams({
      $filter: filters.join(" and "),
      $orderby: "declarationDate desc",
      $top: String(limit),
      $select:
        "id,disasterNumber,state,declarationTitle,incidentType,designatedArea,declarationDate,incidentBeginDate,incidentEndDate",
    }).toString();
    const data = object(await request(url));
    return rows(data.DisasterDeclarationsSummaries).flatMap((row) => {
      if (!/^\d+$/.test(String(row.disasterNumber)) || row.state !== state)
        return [];
      return [
        {
          category: "historical",
          source: "FEMA",
          sourceUrl: "https://www.fema.gov/disaster/" + row.disasterNumber,
          id: asText(row.id),
          disasterNumber: Number(row.disasterNumber),
          state,
          title: asText(row.declarationTitle),
          incidentType: asText(row.incidentType),
          area: asText(row.designatedArea),
          declarationDate: asDate(row.declarationDate),
          incidentBeginDate: asDate(row.incidentBeginDate),
          incidentEndDate: asDate(row.incidentEndDate),
        },
      ];
    });
  });
}

const guidance = {
  tornado: {
    url: "https://www.weather.gov/safety/tornado-during",
    tip: "Identify a basement or a small interior room on the lowest floor of a sturdy building. Keep your pet’s carrier near your shelter area.",
  },
  flood: {
    url: "https://www.weather.gov/safety/flood-turn-around-dont-drown",
    tip: "Plan a route to higher ground with your pets. Choose another route if floodwater covers the road.",
  },
  wildfire: {
    url: "https://www.usfa.fema.gov/wui/outreach/wildfire-evacuation.html",
    tip: "Practice evacuating with your pets and keep supplies ready to take. Follow evacuation instructions from local officials.",
  },
  winter_storm: {
    url: "https://www.weather.gov/safety/winter-before",
    tip: "Arrange warm shelter for your pets and stock food and water before snow or ice makes roads unsafe.",
  },
  earthquake: {
    url: "https://www.cdc.gov/earthquakes/safety/stay-safe-during-an-earthquake.html",
    tip: "Practice dropping, taking cover and holding on. Keep your pet's transport equipment accessible for use after the shaking stops.",
  },
  heat: {
    url: "https://www.weather.gov/wrn/summer-article-keep-your-pets-cool",
    tip: "Arrange a cool place and fresh drinking water for your pet. Take your pet with you whenever you leave a parked vehicle.",
  },
} as const;
export function getPreparednessGuidance(input: {
  hazard: keyof typeof guidance;
  species?: Species;
}) {
  const hazard = guidance[input.hazard];
  if (!hazard) throw new Error("Unsupported hazard");
  const supply =
    input.species === "cat"
      ? "Pack a secure carrier and litter supplies for your cat."
      : input.species === "dog"
        ? "Pack a leash, identification and a suitable carrier for your dog."
        : "Prepare a carrier and transport supplies suited to your pet.";
  return {
    category: "preparedness",
    hazard: input.hazard,
    items: [
      hazard.tip,
      supply,
      "Keep pet food, water, medications and a copy of your pet’s records together.",
    ],
    sourceUrls: [
      hazard.url,
      "https://www.fema.gov/fact-sheet/are-you-petpared-disasters",
    ],
  };
}
