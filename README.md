# PetsAndFound · PawSafe backend

PawSafe stores owner profiles, pets, reports, matches, shelter operations, notifications and simulation runs in SpacetimeDB. The TypeScript agent serves the authenticated HTTP API. A separate worker imports public records and processes persistent matching jobs. The Python vision service runs DINOv2 Base and keeps its derived vectors in a persistent SQLite index.

## Start locally

Use Node 24.22.1 or a compatible newer version, the SpacetimeDB 2.14.1 CLI, and either Docker or Python 3.12. Run from the repository root.

```sh
npm ci --prefix spacetimedb
npm ci --prefix services/agent
npm run build
spacetime start
```

In another terminal publish the database to the running local server. Keep the publisher identity available for granting service and reviewer access.

```sh
spacetime publish pawsafe --module-path spacetimedb --server local
```

Copy `.env.example` to `.env`. Create a dedicated worker identity on the **same SpacetimeDB instance**. In PowerShell, the following requests a new identity without printing its bearer token.

```powershell
$service = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/v1/identity'
$service.identity
```

Grant that identity the service role using the **publisher's** credentials. The following example uses the HTTP API with the publisher token supplied through the current shell environment.

```powershell
$payload = @{ identity = $service.identity } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/v1/database/pawsafe/call/grant_service_identity' -Headers @{ Authorization = "Bearer $env:SPACETIME_PUBLISHER_TOKEN" } -ContentType 'application/json' -Body (ConvertTo-Json -InputObject @($payload) -Compress)
$env:SPACETIME_SERVICE_TOKEN = $service.token
```

Set `SPACETIME_SERVICE_TOKEN` in the API and worker environments. Give both services the same strong `INTERNAL_SERVICE_SECRET` as vision. Configure NVIDIA for chat, Cloudinary for photo uploads and RescueGroups for its directory and animal feed. Set `PROVIDER_USER_AGENT` to an application name and monitored contact for public APIs.

Build the vision image and mount a named volume. The first inference downloads the pinned model and persists it in that volume. For offline hosting, point `DINO_MODEL_DIR` at a mounted copy of the model.

```sh
docker build -t pawsafe-vision services/vision
docker run --rm -p 127.0.0.1:8000:8000 -e INTERNAL_SERVICE_SECRET --mount source=pawsafe-vision-data,target=/data pawsafe-vision
```

With Python, install `services/vision/requirements.txt`, export `INTERNAL_SERVICE_SECRET`, and run `python -m uvicorn main:app --port 8000` from `services/vision`. Set `VISION_INDEX_PATH` to a persistent path. Start the API and worker in separate terminals.

```sh
node --env-file=.env services/agent/dist/server.js
node --env-file=.env services/agent/dist/worker.js
```

The API defaults to port 8080. Both services expose `GET /health` for liveness. Each source search returns its own availability and provenance. Cloudinary, NVIDIA, and source credentials belong in the backend environment.

If Bluesky requires an authenticated search, set `BSKY_PDS_URL` and a server-side `BSKY_ACCESS_JWT` issued for that PDS. Review externally licensed photos with `review_external_photos` before using them for automatic comparisons.

The Expo app lives in `app/`. From the repository root, run `npm run app` (or `npm run app:web`) after `npm install` inside `app/`.

## Client integration

Use the SpacetimeDB SDK for registration, ordinary writes and subscriptions. Generate client bindings from the published module with `spacetime generate --lang typescript --out-dir <client-bindings> --module-path spacetimedb`. Each reducer's `payload` argument is a JSON-encoded object. For HTTP calls, POST an array containing that one string to `/v1/database/<database>/call/<reducer>`. The `api_read` procedure takes two strings (resource and key) and returns JSON text.

1. Call `register_user` with `{name,generalLocation}`, then `register_pet` with a client-generated ID, name and species.
2. Call `POST /v1/uploads/sign` with `{}`. Send the returned fields and image file as multipart form data to `uploadUrl`. On successful upload, call `attach_pet_photo` with `{id,petId,storageKey,angle,animalCount}`. Use the returned photo ID. Supply an animal count only when someone has checked the image. An authorized client can obtain a short-lived delivery URL from `GET /v1/photos/<photoId>/url`.
3. Use the report reducers directly after confirmation, or use the agent flow below. The worker compares eligible images with open lost reports. The match includes the candidate and reference photo IDs, numerical evidence and review status. Owners and authorized staff can review the proposal.
4. For shelter operations, register an organization, submit it for review, then have an authorized reviewer verify it. Verified staff can manage capacity, assignments and case resolution. External directory syncs cannot confer staff privileges or set capacity.

Send the SpacetimeDB user token as `Authorization: Bearer <token>` on the Node API. POST requests use JSON.

| Endpoint | Request |
| --- | --- |
| `POST /v1/agent/message` | `{requestId,message,previousRunId?,context?}`. Supply a fresh UUID for each message. Context can contain `location:{latitude,longitude}`, city, uploaded photos or an authorized report ID. |
| `POST /v1/agent/confirm-action` | `{runId,confirmed:true}` after showing the complete returned pending action to the user. Reuse the same run ID on retry. |
| `GET /v1/agent/runs/<id>` | Owner-scoped run, tool outcomes and pending or completed actions. |
| `POST /v1/matching/search` | `{reportId}` for a report the caller can access. |
| `POST /v1/ingestion/bluesky/search` | `{city,species,breed?,since?,limit?}`. |
| `POST /v1/ingestion/shelters/sync` | `{latitude,longitude,radiusKm?,limit?}`. |
| `POST /v1/ingestion/animals/search` | Same location parameters, with optional species. |
| `GET /v1/weather/alerts` | `latitude` and `longitude` query parameters. Official NWS records include timestamps. |
| `GET /v1/disasters/history` | Two-letter `state` and optional `incidentType` and ISO `since`. |
| `GET /v1/scenarios` | Available educational scenarios. |
| `POST /v1/simulations` | `{id,scenarioId}` with a client-generated UUID and `tornado`, `flood`, `wildfire` or `heat`. |
| `GET /v1/simulations/<id>` | Current scene, choices, revision and scores. |
| `POST /v1/simulations/<id>/choices` | `{choiceId,revision}` from the current scene. |
| `POST /v1/simulations/<id>/feedback` | `{}` for a completed run. Nemotron explains the predefined outcomes. |

### Matching and source permissions

Public posts and shelter listings retain source links. External image processing requires both an approved rights holder in `EXTERNAL_IMAGE_RIGHTSHOLDERS` (for example `rescuegroups:123`) and an exact HTTPS CDN hostname in `EXTERNAL_IMAGE_HOSTS`. New source matches and animal identities require human review. The worker records possible matches by default. Set `MATCH_NOTIFY_THRESHOLD` after evaluating labeled photo pairs to enable score-triggered owner notifications.

### Verification

```sh
npm test
npm run build
spacetime build --module-path spacetimedb
node scripts/verify-backend.mjs spacetimedb/dist/bundle.js
```

The verification script uses an isolated database on a loopback SpacetimeDB instance and removes that database when finished. Set `TEST_SPACETIME_URI` to use another local port. Set `TEST_IMAGE` to a local test photo and point `VISION_SERVICE_URL` and `INTERNAL_SERVICE_SECRET` at a local vision instance to also exercise real embedding, matching, persistence and worker acknowledgement.

From `services/vision`, run `python -m pip install -r requirements-test.txt` and `python -m unittest -v` for vision API tests. Run `python evaluate.py evaluation-sample.json --fetch` to exercise the ranking metrics with the labeled sample. Use representative labeled data, including animals absent from the gallery, before choosing a notification threshold.

The [database API reference](spacetimedb/README.md) lists reducer payloads, authorization rules, and subscription views. The [architecture plan](PLAN.md) describes the product workflows.
