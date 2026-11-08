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
  pets,
  petPhotos,
  petCareNotes,
  reportPhotos,
  reports,
  reportSummaries,
  requests,
  shelters,
  directoryAliases,
  staff,
  verifications,
  cases,
  external,
  matches,
  notifications,
  jobs,
  alerts,
  simulations,
  runs,
  events,
});
export type Ctx = ReducerCtx<InferSchema<typeof db>>;
export type ReadCtx = Pick<ViewCtx<InferSchema<typeof db>>, "db" | "sender">;
export default db;
