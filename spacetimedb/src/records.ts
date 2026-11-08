import { enqueueOperation } from "./operation-agent";
import db, { type Ctx } from "./tables";
import {
  action,
  canReadReport,
  choice,
  date,
  enqueue,
  fail,
  id,
  isStaff,
  now,
  num,
  object,
  priority,
  sender,
  service,
  str,
  strings,
  user,
  type Input,
  notify,
} from "./common";
import { linkMatchingIncident, notifyNearbyStaff } from "./incident";

export const init = db.init((ctx) => {
  ctx.db.grants.insert({ id: sender(ctx), role: "admin" });
});
function grant(ctx: Ctx, p: Input, role: string) {
  if (ctx.db.grants.id.find(sender(ctx))?.role !== "admin") fail("Publisher required");
  const identity = str(p, "identity", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(identity) || identity === sender(ctx)) fail("Invalid delegated identity");
  const old = ctx.db.grants.id.find(identity);
  if (role === "none") ctx.db.grants.id.delete(identity);
  else if (old) ctx.db.grants.id.update({ id: identity, role });
  else ctx.db.grants.insert({ id: identity, role });
}
export const grant_service_identity = action((ctx, p) => grant(ctx, p, "service"));
export const grant_reviewer_identity = action((ctx, p) => grant(ctx, p, "reviewer"));
export const revoke_identity_grant = action((ctx, p) => grant(ctx, p, "none"));
export const register_user = action((ctx, p) => {
  const row = {
    id: sender(ctx),
    name: str(p, "name", 120),
    generalLocation: str(p, "generalLocation", 120, false),
    contactPreferences: str(p, "contactPreferences", 240, false),
    emergencyContact: str(p, "emergencyContact", 240, false),
  };
  if (ctx.db.users.id.find(row.id)) ctx.db.users.id.update(row);
  else ctx.db.users.insert(row);
});
export const save_credentials = action((ctx, p) => {
  service(ctx);
  const username = str(p, "username", 32).toLowerCase();
  const identity = str(p, "identity", 64).toLowerCase();
  const appRole = choice(p, "appRole", ["owner", "shelter"]);
  const passwordHash = str(p, "passwordHash", 128);
  const salt = str(p, "salt", 32);
  const token = str(p, "token", 4096);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) ||
      !/^[a-f0-9]{64}$/.test(identity) ||
      !/^[a-f0-9]{128}$/.test(passwordHash) ||
      !/^[a-f0-9]{32}$/.test(salt) ||
      !ctx.db.users.id.find(identity)) fail("Invalid credentials");
  const claimed = ctx.db.credentials.username.find(username);
  if (claimed && claimed.identity !== identity) fail("Username is taken");
  const previous = Array.from(ctx.db.credentials.identity.filter(identity))[0];
  if (previous && previous.username !== username) ctx.db.credentials.username.delete(previous.username);
  const row = { username, identity, appRole, passwordHash, salt, token };
  if (claimed) ctx.db.credentials.username.update(row);
  else ctx.db.credentials.insert(row);
});
function petDetails(p: Input) {
  const age = typeof p.age === "number" ? String(num(p, "age", 0, 150)) : str(p, "age", 60, false);
  return {
    name: str(p, "name", 120),
    species: choice(p, "species", ["dog", "cat", "other"]),
    breed: str(p, "breed", 120, false),
    colors: strings(p, "colors"),
    markings: str(p, "markings", 500, false),
    age,
    gender: choice({ gender: p.gender ?? "unknown" }, "gender", ["female", "male", "unknown"]),
    size: str(p, "size", 60, false),
    microchip: str(p, "microchip", 120, false),
  };
}
function setCareNotes(ctx: Ctx, petId: string, p: Input) {
  if (p.healthNotes === undefined) return;
  const text = str(p, "healthNotes", 1000, false);
  const existing = ctx.db.petCareNotes.petId.find(petId);
  if (existing && !text) ctx.db.petCareNotes.petId.delete(petId);
  else if (existing) ctx.db.petCareNotes.petId.update({ petId, text });
  else if (text) ctx.db.petCareNotes.insert({ petId, text });
}
export const register_pet = action((ctx, p) => {
  const row = { id: id(p), ownerId: user(ctx).id, ...petDetails(p) };
  const old = ctx.db.pets.id.find(row.id);
  if (old && Object.entries(row).some(([key, value]) => JSON.stringify(old[key as keyof typeof row]) !== JSON.stringify(value))) fail("Pet ID already used");
  if (!old) {
    ctx.db.pets.insert(row);
    setCareNotes(ctx, row.id, p);
  }
  const photos = p.photos ?? [];
  if (!Array.isArray(photos) || photos.length > 5) fail("At most five photos per submission");
  for (const item of photos) addPetPhoto(ctx, { ...object(item), petId: row.id });
});
export const update_pet = action((ctx, p) => {
  const old = ctx.db.pets.id.find(id(p));
  if (!old || old.ownerId !== user(ctx).id) fail("Pet not found");
  ctx.db.pets.id.update({ ...old, ...petDetails({ ...old, ...p }) });
  setCareNotes(ctx, old.id, p);
});
function photo(ctx: Ctx, p: Input) {
  const ownerId = user(ctx).id;
  const key = id(p);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key) || p.storageKey !== "pawsafe/" + ownerId + "/" + key)
    fail("Invalid storage key");
  const angle = p.angle ? choice(p, "angle", ["front", "left", "right", "marking", "other"]) : "other";
  return {
    id: key,
    ownerId,
    storageKey: p.storageKey as string,
    angle,
    animalCount: p.animalCount == null ? 0 : num(p, "animalCount", 1, 100, true),
    embeddingRef: "",
  };
}
function addPetPhoto(ctx: Ctx, p: Input) {
  const pet = ctx.db.pets.id.find(id(p, "petId"));
  if (!pet || pet.ownerId !== user(ctx).id) fail("Pet not found");
  const row = { ...photo(ctx, p), petId: pet.id };
  const old = ctx.db.petPhotos.id.find(row.id);
  if (old?.petId === pet.id && old.animalCount === row.animalCount && old.angle === row.angle) return;
  if (old || ctx.db.reportPhotos.id.find(row.id)) fail("Photo already attached");
  ctx.db.petPhotos.insert(row);
  enqueue(ctx, "photo", row.id);
  for (const r of ctx.db.reports.petId.filter(pet.id)) if (r.status === "open") enqueue(ctx, "report", r.id);
}
export const attach_pet_photo = action(addPetPhoto);
function addReportPhoto(ctx: Ctx, p: Input, reportId: string) {
  const row = { ...photo(ctx, p), reportId };
  const old = ctx.db.reportPhotos.id.find(row.id);
  if (old?.reportId === reportId && row.animalCount === old.animalCount && row.angle === old.angle)
    return false;
  if (old || ctx.db.petPhotos.id.find(row.id)) fail("Photo already attached");
  ctx.db.reportPhotos.insert(row);
  return true;
}
export const attach_report_photo = action((ctx, p) => {
  const r = ctx.db.reports.id.find(id(p, "reportId"));
  if (!r || r.creatorId !== user(ctx).id || r.status !== "open") fail("Open report required");
  if (addReportPhoto(ctx, p, r.id)) enqueue(ctx, "report", r.id);
});
// Use a stable key even if a client reserializes a request with a different property order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * radians;
  const dlon = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dlon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function report(ctx: Ctx, p: Input, type: "lost" | "found") {
  const creatorId = user(ctx).id;
  const reportId = id(p);
  const requestId = creatorId + ":" + id(p, "idempotencyKey");
  const body = JSON.stringify([type, canonical(p)]);
  const prior = ctx.db.requests.id.find(requestId);
  if (prior) {
    if (prior.body !== body) fail("Submission key already used for a different report");
    return;
  }
  const pet = type === "lost" ? ctx.db.pets.id.find(id(p, "petId")) : null;
  if (type === "lost" && (!pet || pet.ownerId !== creatorId)) fail("Registered pet required");
  const photos = p.photos ?? [];
  if (!Array.isArray(photos) || photos.length > 5) fail("At most five photos per submission");
  const r = ctx.db.reports.insert({
    id: reportId,
    type,
    creatorId,
    petId: pet?.id ?? "",
    status: "open",
    latitude: num(p, "latitude", -90, 90),
    longitude: num(p, "longitude", -180, 180),
    observedAt: date(p, "observedAt"),
    species: pet?.species ?? choice(p, "species", ["dog", "cat", "other"]),
    breed: pet?.breed ?? str(p, "breed", 120, false),
    colors: pet?.colors ?? strings(p, "colors"),
    generalLocation: str(p, "generalLocation", 120, false),
    description: str(p, "description", 1500, false),
    condition: str(p, "condition", 500, false),
    createdAt: now(ctx),
    updatedAt: now(ctx),
  });
  for (const raw of photos) addReportPhoto(ctx, object(raw), r.id);
  const summary = ctx.db.reportSummaries.insert({
    id: r.id,
    type,
    species: r.species,
    status: "open",
    observedAt: r.observedAt,
    latitude: Math.round(r.latitude * 10) / 10,
    longitude: Math.round(r.longitude * 10) / 10,
  });
  // Use only the public rounded coordinates to select recipients and construct their notification.
  for (const candidate of ctx.db.reportSummaries.status.filter("open")) {
    if (
      candidate.type === type ||
      candidate.species !== summary.species ||
      distanceKm(summary, candidate) > 50
    )
      continue;
    const recipient = ctx.db.reports.id.find(candidate.id)?.creatorId;
    if (recipient && recipient !== creatorId)
      notify(ctx, "nearby:" + r.id + ":" + recipient, recipient, "NEW_NEARBY_REPORT", {
        reportId: r.id,
        type,
        species: r.species,
        latitude: summary.latitude,
        longitude: summary.longitude,
      });
  }
  if (type === "found") {
    ctx.db.cases.insert({
      id: r.id,
      reportId: r.id,
      creatorId,
      shelterId: "",
      assigneeId: "",
      priority: priority(r.condition),
      reason: r.condition,
      status: "open",
      updatedAt: now(ctx),
      outcome: "",
    });
    enqueueOperation(ctx, r.id, "found_report");
    linkMatchingIncident(ctx, r.id, r);
    if (priority(r.condition) !== "normal") notifyNearbyStaff(ctx, r.id, summary, "URGENT_CASE");
  }
  ctx.db.requests.insert({ id: requestId, reportId, body });
  enqueue(ctx, "report", r.id);
}
export const create_lost_report = action((ctx, p) => report(ctx, p, "lost"));
export const create_found_report = action((ctx, p) => report(ctx, p, "found"));
export const update_report = action((ctx, p) => {
  const r = ctx.db.reports.id.find(id(p, "reportId"));
  if (!r || !canReadReport(ctx, r)) fail("Report not found");
  const status = p.status == null ? r.status : choice(p, "status", ["open", "closed", "reunited"]);
  if (
    status === "reunited" &&
    ![...ctx.db.matches.lostReportId.filter(r.id), ...ctx.db.matches.candidateId.filter(r.id)].some(
      (m) => m.status === "confirmed" && (m.lostReportId === r.id || m.candidateType === "report"),
    )
  )
    fail("A reviewed match is required");
  const next = {
    ...r,
    status,
    description: p.description == null ? r.description : str(p, "description", 1500, false),
    condition: p.condition == null ? r.condition : str(p, "condition", 500, false),
    updatedAt: now(ctx),
  };
  ctx.db.reports.id.update(next);
  const summary = ctx.db.reportSummaries.id.find(r.id)!;
  ctx.db.reportSummaries.id.update({ ...summary, status });
  if (r.status !== status)
    notify(ctx, "report:" + r.id + ":" + status + ":" + now(ctx), r.creatorId, "REPORT_STATUS_CHANGED", {
      reportId: r.id,
      status,
    });
  if (status === "open") enqueue(ctx, "report", r.id);
  for (const c of ctx.db.cases.reportId.filter(r.id))
    if (!["cancelled", "resolved"].includes(c.status)) {
      ctx.db.cases.id.update({
        ...c,
        priority: priority(next.condition),
        reason: next.condition,
        status: status === "open" ? c.status : "resolved",
        outcome: status === "open" ? c.outcome : "Report " + status,
        updatedAt: now(ctx),
      });
      if (status === "open") enqueueOperation(ctx, c.id, "report_updated");
    }
});
