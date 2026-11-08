import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  checkBlueskyRecord,
  checkRescueGroupsRecord,
  findNearbyShelters,
  getDisasterHistory,
  getWeatherAlerts,
  searchBluesky,
  searchDallas,
  searchShelterAnimals,
} from "./index.js";
import { permittedPhotos, eligibleExternalPhotos } from "./common.js";

function intercept(
  t: TestContext,
  handler: (url: URL, init: RequestInit) => unknown,
) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const result = handler(new URL(String(input)), init || {});
    return result instanceof Response
      ? result
      : new Response(JSON.stringify(result));
  };
  t.after(() => {
    globalThis.fetch = original;
  });
}
function env(t: TestContext, key: string, value: string) {
  const before = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  });
}
const uri = "at://did:plc:example/app.bsky.feed.post/abc";
const checkPoint = { latitude: 32.78, longitude: -96.8 };
test("configured Bluesky search uses the account PDS and AppView proxy, and preserves rejected access", async (t) => {
  env(t, "BSKY_PDS_URL", "https://pds.example.org");
  env(t, "BSKY_ACCESS_JWT", "example-token");
  intercept(t, (url, init) => {
    assert.equal(url.origin, "https://pds.example.org");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), "Bearer example-token");
    assert.equal(
      headers.get("atproto-proxy"),
      "did:web:api.bsky.app#bsky_appview",
    );
    return new Response(null, { status: 403 });
  });
  const result = await searchBluesky({ city: "Dallas", species: "cat" });
  assert.equal(result.sources[0].status, "unavailable");
  assert.equal(result.sources[0].detail, "Upstream HTTP 403");
});
test("social discovery deduplicates posts, classifies from their text and retains no private contact text or guessed coordinates", async (t) => {
  env(t, "EXTERNAL_IMAGE_RIGHTSHOLDERS", "");
  const post = {
    uri,
    author: { did: "did:plc:example" },
    record: {
      text: "Found a black dog in Dallas. Text me at 555-0101.",
      createdAt: "2026-02-01T12:00:00Z",
    },
    embed: {
      $type: "app.bsky.embed.images#view",
      images: [{ fullsize: "https://cdn.bsky.app/abc" }],
    },
  };
  intercept(t, () => ({
    posts: [
      post,
      { ...post, uri: uri + "2", record: { text: "Found dog in Austin" } },
      { ...post, uri: uri + "3", labels: [{ val: "!no-unauthenticated" }] },
    ],
  }));
  const result = await searchBluesky({
    species: "dog",
    city: "Dallas",
    breed: "lab",
  });
  assert.equal(result.sources[0].status, "ok");
  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.sourceRecordId, uri);
  assert.equal(item.reportType, "found");
  assert.equal(item.breed, undefined);
  assert.equal(item.processingAllowed, false);
  assert.equal(item.location, undefined);
  assert.equal(item.locationLabel, "Dallas");
  assert(!JSON.stringify(item).includes("555-0101"));
});
test("removal requires an explicit result for the requested public post", async (t) => {
  let payload: unknown = new Response("", { status: 503 });
  intercept(t, () => payload);
  assert.equal(await checkBlueskyRecord(uri), "unavailable");
  payload = {
    thread: {
      $type: "app.bsky.feed.defs#notFoundPost",
      uri: uri + "different",
    },
  };
  assert.equal(await checkBlueskyRecord(uri), "unavailable");
  payload = {
    thread: { $type: "app.bsky.feed.defs#threadViewPost", post: { uri } },
  };
  assert.equal(await checkBlueskyRecord(uri), "present");
  payload = { thread: { $type: "app.bsky.feed.defs#notFoundPost", uri } };
  assert.equal(await checkBlueskyRecord(uri), "removed");
});
test("processing needs publisher permission and an exact HTTPS host", (t) => {
  env(t, "EXTERNAL_IMAGE_RIGHTSHOLDERS", "rescuegroups:12");
  env(t, "EXTERNAL_IMAGE_HOSTS", "images.example.org");
  const urls = [
    "https://images.example.org/photo.jpg",
    "https://images.example.org.evil.invalid/a",
    "http://images.example.org/b",
    "https://images.example.org:444/c",
  ];
  assert.equal(
    permittedPhotos("rescuegroups:123", urls).processingAllowed,
    false,
  );
  assert.deepEqual(permittedPhotos("rescuegroups:12", urls), {
    photoUrls: [urls[0]],
    processingAllowed: true,
  });
  assert.deepEqual(
    eligibleExternalPhotos({
      source: "bluesky",
      processingPrincipal: "rescuegroups:12",
      photoUrls: urls,
      processingAllowed: true,
    }),
    [],
  );
  assert.deepEqual(
    eligibleExternalPhotos({
      source: "rescuegroups",
      processingPrincipal: "rescuegroups:12",
      photoUrls: urls,
      processingAllowed: true,
    }),
    [urls[0]],
  );
});
test("RescueGroups joins JSON:API included rows by type and id; a listing does not establish a found sighting", async (t) => {
  env(t, "RESCUEGROUPS_API_KEY", "example-key");
  env(t, "EXTERNAL_IMAGE_RIGHTSHOLDERS", "rescuegroups:11");
  env(t, "EXTERNAL_IMAGE_HOSTS", "cdn.example.org");
  intercept(t, (url, init) => {
    assert.equal(new Headers(init.headers).get("authorization"), "example-key");
    assert.equal(url.pathname, "/v5/public/animals/search/available/dogs/");
    assert.deepEqual(JSON.parse(String(init.body)).data.filterRadius, {
      lat: 32.78,
      lon: -96.8,
      kilometers: 30,
    });
    return {
      data: [
        {
          id: "45",
          attributes: {
            url: "https://shelter.example.org/pets/45",
            breedString: "Lab",
          },
          relationships: {
            species: { data: [{ type: "species", id: "1" }] },
            orgs: { data: [{ type: "orgs", id: "11" }] },
            pictures: { data: [{ type: "pictures", id: "1" }] },
          },
        },
      ],
      included: [
        { type: "species", id: "1", attributes: { singular: "Dog" } },
        {
          type: "pictures",
          id: "1",
          attributes: { large: { url: "https://cdn.example.org/45.jpg" } },
        },
        {
          type: "orgs",
          id: "11",
          attributes: { lat: "32.78", lon: "-96.8", city: "Dallas" },
        },
      ],
    };
  });
  const [item] = (await searchShelterAnimals({ ...checkPoint, species: "dog" }))
    .items;
  assert.equal(item.reportType, "shelter_listing");
  assert.equal(item.processingAllowed, true);
  assert.equal(item.location?.confidence, "approximate");
  assert.equal(item.observedAt, undefined);
});
test("directory corroborates independent sources, keeps co-located organizations separate, and preserves successes on partial outage", async (t) => {
  env(t, "RESCUEGROUPS_API_KEY", "example-key");
  let outage = false;
  intercept(t, (url) => {
    if (url.hostname === "photon.komoot.io")
      return {
        features: [
          {
            geometry: { type: "Point", coordinates: [-96.8, 32.78] },
            properties: {
              osm_type: "N",
              osm_id: 1,
              name: "Shelter One",
              housenumber: "1",
              street: "Main St",
              city: "Dallas",
              state: "TX",
              postcode: "75201",
            },
          },
          {
            geometry: { type: "Point", coordinates: [-96.8, 32.78] },
            properties: { osm_type: "W", osm_id: 2, name: "Another Rescue" },
          },
        ],
      };
    if (outage) return new Response(null, { status: 503 });
    return {
      data: [
        {
          id: "42",
          attributes: {
            name: "Shelter One",
            lat: "32.78",
            lon: "-96.8",
            street: "1 Main St",
            city: "Dallas",
            state: "TX",
            postalcode: "75201",
          },
        },
      ],
    };
  });
  const merged = await findNearbyShelters(checkPoint);
  assert.equal(merged.items.length, 2);
  const shelter = merged.items.find((s) => s.name === "Shelter One")!;
  assert.deepEqual(shelter.sourceIds, ["osm-node-1", "rg-org-42"]);
  assert.equal(shelter.directoryConfidence, "high");
  assert.equal(shelter.operatorVerified, false);
  assert(!("acceptingAnimals" in shelter));
  outage = true;
  const partial = await findNearbyShelters(checkPoint);
  assert.equal(partial.items.length, 2);
  assert.deepEqual(
    partial.sources.map((s) => s.status),
    ["ok", "unavailable"],
  );
});
test("Dallas rows keep distinct feeds, convert Central wall time, and discard operational and street details", async (t) => {
  intercept(t, (url) => {
    assert(!url.searchParams.get("$select")?.includes("address"));
    if (url.pathname.includes("uyte"))
      return [
        {
          row_id: "row-g96p.grwj.kkju",
          intake_date: "2024-01-15T00:00:00",
          intake_time: "15:15:00",
          animal_type: "DOG",
          intake_type: "STRAY",
        },
      ];
    return [
      {
        row_id: "row-gz7s.fgyt~tw4y",
        call_date_time: "2024-07-01T12:00:00",
        city: "Dallas",
        animal_type: "DOG",
        street_address: "123 Private Street",
      },
    ];
  });
  const r = await searchDallas({
    species: "dog",
    since: "2024-01-01T00:00:00Z",
  });
  assert.equal(r.items.length, 2);
  assert.notEqual(r.items[0].id, r.items[1].id);
  assert.equal(r.items[0].observedAt, "2024-07-01T17:00:00.000Z");
  assert.equal(r.items[0].reportType, "unknown");
  assert.equal(r.items[1].observedAt, "2024-01-15T21:15:00.000Z");
  assert.equal(r.items[1].reportType, "found");
  assert(!JSON.stringify(r).includes("Private Street"));
});
test("point alerts suppress test, expired and cancelled records and coalesce nearby requests to the same point", async (t) => {
  const effective = new Date(Date.now() - 60000).toISOString(),
    expires = new Date(Date.now() + 60000).toISOString();
  const active = {
    id: "urn:oid:abc",
    status: "Actual",
    messageType: "Alert",
    event: "Flood Warning",
    effective,
    expires,
  };
  let calls = 0;
  intercept(t, (url) => {
    calls++;
    assert.equal(url.searchParams.get("point"), "32.7812,-96.8000");
    return {
      features: [
        active,
        { ...active, status: "Test" },
        { ...active, expires: effective },
        { ...active, messageType: "Cancel" },
      ].map((properties) => ({ properties })),
    };
  });
  const point = { latitude: 32.7812, longitude: -96.8 };
  const [a, b] = await Promise.all([
    getWeatherAlerts(point),
    getWeatherAlerts(point),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.items.length, 1);
  assert.deepEqual(a, b);
  assert.equal(a.items[0].source, "NWS");
});
test("historical declarations retain dates and FEMA attribution", async (t) => {
  intercept(t, (url) => {
    assert.match(
      url.searchParams.get("$filter")!,
      /state eq 'TX' and incidentType eq 'Flood'/,
    );
    return {
      DisasterDeclarationsSummaries: [
        {
          id: "abc",
          state: "TX",
          disasterNumber: 1234,
          incidentType: "Flood",
          declarationDate: "1999-08-01T00:00:00Z",
        },
      ],
    };
  });
  const [row] = (
    await getDisasterHistory({ state: "tx", incidentType: "Flood" })
  ).items;
  assert.equal(row.category, "historical");
  assert.equal(row.sourceUrl, "https://www.fema.gov/disaster/1234");
});
test("RescueGroups withdrawal checks require the exact entity and its related status or a documented entity 404", async (t) => {
  env(t, "RESCUEGROUPS_API_KEY", "example-key");
  const status = { type: "statuses", id: "2" };
  const animal = {
    type: "animals",
    id: "123",
    relationships: { statuses: { data: [status] } },
  };
  const document = (name: string) => ({
    data: [animal],
    included: [{ ...status, attributes: { name } }],
  });
  let response: unknown = document("Available");
  let calls = 0;
  intercept(t, (url, init) => {
    calls++;
    assert.equal(url.pathname, "/v5/public/animals/123");
    assert.equal(url.searchParams.get("include"), "statuses");
    assert.equal(new Headers(init.headers).get("authorization"), "example-key");
    return response;
  });
  assert.equal(await checkRescueGroupsRecord("../123"), "unavailable");
  assert.equal(calls, 0);
  assert.equal(await checkRescueGroupsRecord("123"), "present");
  response = document("Adopted");
  assert.equal(await checkRescueGroupsRecord("123"), "removed");
  response = { ...document("Adopted"), data: { ...animal, id: "4" } };
  assert.equal(await checkRescueGroupsRecord("123"), "unavailable");
  response = {
    data: animal,
    included: [
      { type: "statuses", id: "999", attributes: { name: "Adopted" } },
    ],
  };
  assert.equal(await checkRescueGroupsRecord("123"), "unavailable");
  response = { data: [] };
  assert.equal(await checkRescueGroupsRecord("123"), "unavailable");
  response = new Response(JSON.stringify({ data: {} }), { status: 404 });
  assert.equal(await checkRescueGroupsRecord("123"), "removed");
  for (const code of [404, 401, 403, 502, 429]) {
    response = new Response("upstream unavailable", { status: code });
    assert.equal(await checkRescueGroupsRecord("123"), "unavailable");
  }
});
