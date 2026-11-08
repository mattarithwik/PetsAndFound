# PawSafe database API

The TypeScript module targets SpacetimeDB 2.14.1. Run `npm ci` and `npm run build` here to type-check it. Run `spacetime build --module-path spacetimedb` from the repository root to produce the JavaScript module. The root README covers the local server and integration test.

## Wire format

Pass the caller's SpacetimeDB bearer token to `POST /v1/database/{database}/call/{reducer}`. Every reducer takes a single string argument containing a JSON object. For example, registering a pet sends the following HTTP JSON body.

```json
["{\"id\":\"max\",\"name\":\"Max\",\"species\":\"dog\",\"colors\":[\"gold\"]}"]
```

For reads, call the `api_read` procedure with two strings such as `["pet","max"]` or `["pets",""]`. Decode the HTTP JSON result and then parse its JSON string. A missing or inaccessible detail returns null. Use the public sender-scoped SQL views for subscriptions. View columns containing structured documents, including match evidence, notification payloads and simulation state, use JSON strings. The HTTP read procedure decodes them.

Application IDs for pets, reports, submissions and shelters are caller-generated strings of 1–200 letters, digits, underscores, full stops or hyphens. User IDs are the lowercase 64-character identity hex supplied by SpacetimeDB. Incident timestamps must include a timezone. A successful reducer invocation commits all its changes together.

## Owner and reporter reducers

| Reducer | JSON object fields |
| --- | --- |
| `register_user` | `name`, optional `generalLocation`, `contactPreferences`, `emergencyContact`. Creates or updates the caller's profile. |
| `register_pet` | `id, name, species` and optional `breed, colors[], markings, size, age, microchip`. Species is `dog`, `cat` or `other`. |
| `attach_pet_photo` | `id, petId, storageKey`, optional `angle` and `animalCount`. Use the photo ID and storage key returned by the authenticated upload endpoint. |
| `create_lost_report` | `id, idempotencyKey, petId, latitude, longitude, observedAt`. Optional `generalLocation, condition, description, photos[]`. |
| `create_found_report` | Same report fields, with `species` in place of `petId`. Optional `breed, colors[]`. Creates an intake case. Each submitted photo has `id, storageKey` and optional `angle, animalCount`. |
| `attach_report_photo` | `reportId, id, storageKey`, optional `animalCount, angle`. |
| `update_report` | `reportId` and any of `status, description, condition`. Status is `open`, `closed` or `reunited`. Reunification requires a confirmed match. |
| `review_match` | `matchId, status` with `confirmed` or `rejected`. The lost-report owner or verified staff assigned to a related report can review. |
| `mark_notification_read` | `id` of a notification addressed to the caller. |

Reuse both the report ID and submission key on a retry. An identical submission succeeds once. Changing the payload while reusing a key fails. Public summaries expose species, report type and status, observation time and coordinates rounded to 0.1 degree. Nearby alerts use these same public coordinates and a 50 km radius.

## Shelter and case reducers

| Reducer | JSON object fields |
| --- | --- |
| `register_shelter` | `id, name, latitude, longitude`, optional `address, phone, website`. Registers an unverified operator. |
| `request_shelter_verification` | `shelterId, evidence`. Claims an existing directory entry or submits a registered organization for review. |
| `set_shelter_verification` | `shelterId, status` with `verified` or `rejected`. Requires an independent reviewer or database publisher. |
| `set_shelter_staff` | `shelterId, userId, role` with `manager`, `staff` or `remove`. Requires the verified shelter's manager. |
| `update_shelter_capacity` | `shelterId, totalCapacity, currentOccupancy, acceptingAnimals`. Unknown capacity is represented by absent values. |
| `create_rescue_case` | `reportId`, optional `shelterId`. A case uses its report ID. |
| `assign_rescue_case` | `caseId, shelterId`, optional `assigneeId`. A verified staff member can take an open case. A manager can assign another member. |
| `update_case_status` | `caseId, status` with `under_review`, `in_progress` or `cancelled`. Cancellation also requires `outcome`. |
| `transfer_rescue_case` | `caseId, shelterId` of the verified destination. The destination staff accept the reopened case. |
| `resolve_rescue_case` | `caseId, outcome`. Requires the assignee or a manager at the assigned shelter. |

The publisher may call `grant_service_identity`, `grant_reviewer_identity` and `revoke_identity_grant`, each with `{"identity":"<64 hex digits>"}`. Revoking a shelter's verification clears its reported capacity and staff grants, reopens active cases, and permits a new applicant to submit evidence.

## Reads and subscriptions

| Audience | Resources exposed by `api_read` |
| --- | --- |
| Public | `identity`, `public_reports`, `shelters`, `shelter` by ID |
| Owner | `profile`, `pets`, `pet` by ID, `pet_photos` by pet ID, `reports`, `report` and `report_photos` by report ID |
| Authorized participant | `photo` by photo ID, `matches`, `notifications`, `cases`, `case_queue` for verified staff, `shelter_verifications` for applicant or reviewer |
| Agent and simulation owner | `agent_runs`, `agent_run`, `tool_events` by run ID, `simulation_runs`, `simulation_run` |
| Granted service identity | `service_jobs`, `service_reports`, `service_photos` by report ID, `service_photo` by photo ID, `service_external`, `service_simulation_run` |

Subscribers can query `report_summaries` and `shelters` directly, and subscribe to `my_profile`, `my_pets`, `my_pet_photos`, `my_reports`, `my_report_photos`, `my_matches`, `my_cases`, `my_staff_roles`, `my_shelter_verifications`, `my_notifications`, `my_simulation_runs`, `my_agent_runs` or `my_agent_tool_events`. Private tables stay inaccessible to regular SQL clients.

## Service writes

| Reducer | JSON object fields |
| --- | --- |
| `save_agent_run` | `id,userId,intent,status,resultSummary,result`, optional `pendingAction`. Terminal results and pending confirmation actions are protected against replacement. |
| `record_tool_event` | `id,runId,tool,status`, optional `resourceId`. |
| `record_simulation_result` | `id,userId,scenarioId,state,score,expectedRevision`. Start with revision 0. Each accepted update advances the revision. |
| `set_photo_embedding` | `id,embeddingRef`. |
| `complete_matching_job` | `id,version` from the durable queue. A stale acknowledgment keeps the newer job pending. |
| `propose_match` | `lostReportId,candidateId,candidateType,score,evidence,notify`. Candidate type is `report` or `external`. Creates a pending review. |
| `upsert_external_report` | Provider record including `id,source,sourceRecordId,sourceUrl,reportType,photoUrls,processingAllowed,status`. |
| `remove_external_report` | `id`. Scrubs source data and related matches and notifications. A tombstone prevents stale imports from restoring it. |
| `inactive_external_listing` | `id` of a RescueGroups listing. A fresh import with a later `ingestedAt` may reactivate the listing. |
| `revoke_external_processing` | `id`. Withdraws photo permissions, clears review and derived matches, and preserves attribution. Later imports cannot override this revocation. |
| `upsert_directory_shelter` | Normalized listing with `id,name,latitude,longitude,sourceIds,directorySources,directoryConfidence`, optional address/contact details. |
| `upsert_disaster_alert` | Official alert object with `source: "NWS"` and `alertId`. |
| `create_notification` | `id,recipientId,eventType,payload`. Disaster notifications must reference a persisted official alert. |

Reviewers may call `review_external_photos` with `id,photoUrls,animalCount` after inspecting each permitted photo in a listing. The URLs must exactly match the current source record. Unknown and multi-animal subjects are held for review by the matching service.

Removal, revocation, and media changes enqueue a durable purge with `purgeExternalId` and retired `photoUrls`. After deleting those vectors, the service acknowledges the job version to erase the retired URLs. Refreshed images become eligible for matching after the purge completes.
