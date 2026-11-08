import { schema, t, table, type InferSchema, type ReducerCtx, type ViewCtx } from "spacetimedb/server";

const pk = () => t.string().primaryKey();
const ix = () => t.string().index("btree");
const s = () => t.string();
export const grants = table({ name: "grants" }, { id: pk(), role: s() });
export const users = table(
  { name: "users" },
  {
    id: pk(),
    name: s(),
    generalLocation: s(),
    contactPreferences: s(),
    emergencyContact: s(),
  },
);
// Private: only the service identity may read or write credential records.
export const credentials = table(
  { name: "credentials" },
  { username: pk(), identity: ix(), appRole: s(), passwordHash: s(), salt: s(), token: s() },
);
export const pets = table(
  { name: "pets" },
  {
    id: pk(),
    ownerId: ix(),
    name: s(),
    species: s(),
    breed: s(),
    colors: t.array(s()),
    markings: s(),
    age: s(),
    size: s(),
    microchip: s(),
    gender: t.string().default("unknown"),
  },
);
const photoFields = () => ({
  id: pk(),
  ownerId: ix(),
  storageKey: s(),
  angle: s(),
  animalCount: t.u32(),
  embeddingRef: s(),
});
export const petPhotos = table({ name: "pet_photos" }, { ...photoFields(), petId: ix() });
const petCareNotes = table({ name: "pet_care_notes" }, { petId: pk(), text: s() });
export const reportPhotos = table({ name: "report_photos" }, { ...photoFields(), reportId: ix() });
export const sceneAssessments = table({ name: "scene_assessments" }, {
  reportId: pk(), environment: s(), visibleConcerns: s(), uncertainty: s(), createdAt: s(),
});
export const reports = table(
  { name: "reports" },
  {
    id: pk(),
    creatorId: ix(),
    petId: ix(),
    type: s(),
    status: ix(),
    species: s(),
    breed: s(),
    colors: t.array(s()),
    latitude: t.f64(),
    longitude: t.f64(),
    observedAt: ix(),
    generalLocation: s(),
    description: s(),
    condition: s(),
    createdAt: s(),
    updatedAt: s(),
  },
);
// A public projection contains no sender identity, private description, photo key or precise coordinate.
export const reportSummaries = table(
  { name: "report_summaries", public: true },
  {
    id: pk(),
    type: s(),
    species: s(),
    latitude: t.f64(),
    longitude: t.f64(),
    observedAt: s(),
    status: ix(),
  },
);
export const requests = table({ name: "submission_requests" }, { id: pk(), reportId: s(), body: s() });
export const shelters = table(
  { name: "shelters", public: true },
  {
    id: pk(),
    name: s(),
    address: s(),
    latitude: t.f64(),
    longitude: t.f64(),
    phone: s(),
    website: s(),
    directorySources: s(),
    directoryConfidence: s(),
    operatorVerified: t.bool(),
    totalCapacity: t.u32().optional(),
    currentOccupancy: t.u32().optional(),
    acceptingAnimals: t.bool().optional(),
    capacityUpdatedAt: s(),
  },
);
export const staff = table({ name: "shelter_staff" }, { id: pk(), shelterId: ix(), userId: ix(), role: s() });
export const directoryAliases = table({ name: "directory_aliases" }, { id: pk(), shelterId: ix() });
export const verifications = table(
  { name: "shelter_verifications" },
  {
    id: pk(),
    applicantId: ix(),
    status: s(),
    evidence: s(),
    reviewedAt: s(),
    reviewerId: s(),
  },
);
export const cases = table(
  { name: "rescue_cases" },
  {
    id: pk(),
    reportId: ix(),
    creatorId: ix(),
    shelterId: ix(),
    assigneeId: s(),
    priority: s(),
    reason: s(),
    status: ix(),
    updatedAt: s(),
    outcome: s(),
  },
);
export const caseFirstReviews = table(
  { name: "case_first_reviews" },
  { caseId: pk(), reviewedAt: s(), reviewerId: s() },
);
export const incidents = table(
  { name: "incidents" },
  { id: pk(), title: s(), hazard: s(), latitude: t.f64(), longitude: t.f64(), radiusKm: t.f64(), status: s(), createdBy: s(), createdAt: s() },
);
export const incidentCases = table(
  { name: "incident_cases" },
  { caseId: pk(), incidentId: ix(), linkedAt: s() },
);
export const responsePlans = table(
  { name: "response_plans" },
  { caseId: pk(), status: s(), suggestedShelterId: s(), reason: s(), steps: s(), evidence: s(), generatedAt: s(), reviewedBy: s(), reviewedAt: s() },
);
export const operationJobs = table({ name: "operation_jobs" }, {
  caseId: pk(), version: t.u32(), trigger: s(), status: s(), runId: s(),
  requestedAt: s(), leaseUntil: s(), retryAt: s(), attempts: t.u32(),
});
export const operationRuns = table({ name: "operation_runs" }, {
  id: pk(), caseId: ix(), version: t.u32(), trigger: s(), status: s(),
  startedAt: s(), completedAt: s(), steps: s(), recommendation: s(), error: s(),
});
export const shelterResources = table(
  { name: "shelter_resources" },
  { shelterId: pk(), species: s(), supplies: s(), foodUnits: t.u32(), crates: t.u32(), medicalKits: t.u32(), updatedAt: s() },
);
export const shelterAnimals = table(
  { name: "shelter_animals" },
  { id: pk(), shelterId: ix(), caseId: s(), species: s(), description: s(), status: s(), arrivedAt: s(), departedAt: s(), outcome: s() },
);
export const caseMessages = table(
  { name: "case_messages" },
  { id: pk(), caseId: ix(), senderId: s(), body: s(), createdAt: s() },
);
export const matchMessages = table(
  { name: "match_messages" },
  { id: pk(), matchId: ix(), senderId: s(), body: s(), createdAt: s() },
);
export const external = table(
  { name: "external_reports" },
  {
    id: pk(),
    sourceKey: t.string().unique(),
    status: ix(),
    document: s(),
  },
);
export const matches = table(
  { name: "matches" },
  {
    id: pk(),
    lostReportId: ix(),
    ownerId: ix(),
    finderId: ix(),
    candidateId: ix(),
    candidateType: s(),
    score: t.f64(),
    evidence: s(),
    status: ix(),
    updatedAt: s(),
  },
);
export const notifications = table(
  { name: "notifications" },
  {
    id: pk(),
    recipientId: ix(),
    eventType: s(),
    payload: s(),
    createdAt: s(),
    readAt: s(),
  },
);
export const pushDevices = table(
  { name: "push_devices" },
  { id: pk(), ownerId: ix(), token: s() },
);
export const pushDeliveries = table(
  { name: "push_deliveries" },
  { id: pk(), notificationId: ix(), deviceId: s(), status: s(), ticketId: s(), updatedAt: s() },
);
export const jobs = table(
  { name: "matching_jobs" },
  {
    id: pk(),
    photoId: s(),
    reportId: s(),
    externalId: s(),
    purgeExternalId: s(),
    photoUrls: t.array(s()),
    version: t.u32(),
    pending: t.bool().index("btree"),
  },
);
export const alerts = table({ name: "disaster_alerts" }, { id: pk(), document: s() });
export const alertLocations = table({ name: "alert_locations" }, { ownerId: pk(), latitude: t.f64(), longitude: t.f64(), updatedAt: s() });
export const simulations = table(
  { name: "simulation_runs" },
  {
    id: pk(),
    userId: ix(),
    scenarioId: s(),
    state: s(),
    score: t.f64(),
    revision: t.u32(),
  },
);
export const runs = table(
  { name: "agent_runs" },
  {
    id: pk(),
    userId: ix(),
    intent: s(),
    status: s(),
    resultSummary: s(),
    pendingAction: s(),
    result: s(),
  },
);
export const events = table(
  { name: "agent_tool_events" },
  {
    id: pk(),
    runId: ix(),
    tool: s(),
    status: s(),
    resourceId: s(),
    createdAt: s(),
  },
);
const db = schema({
  grants,
  users,
  credentials,
  pets,
  petPhotos,
  petCareNotes,
  reportPhotos,
  sceneAssessments,
  reports,
  reportSummaries,
  requests,
  shelters,
  directoryAliases,
  staff,
  verifications,
  cases,
  caseFirstReviews,
  incidents,
  incidentCases,
  responsePlans,
  operationJobs,
  operationRuns,
  shelterResources,
  shelterAnimals,
  caseMessages,
  matchMessages,
  external,
  matches,
  notifications,
  pushDevices,
  pushDeliveries,
  jobs,
  alerts,
  alertLocations,
  simulations,
  runs,
  events,
});
export type Ctx = ReducerCtx<InferSchema<typeof db>>;
export type ReadCtx = Pick<ViewCtx<InferSchema<typeof db>>, "db" | "sender">;
export default db;
