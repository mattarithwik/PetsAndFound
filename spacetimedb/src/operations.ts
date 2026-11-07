import {
  action,
  canReadReport,
  choice,
  fail,
  id,
  isStaff,
  now,
  num,
  notify,
  priority,
  reviewer,
  sender,
  service,
  str,
  user,
  type Input,
} from "./common";
import type { Ctx } from "./tables";

function directoryFields(p: Input) {
  return {
    name: str(p, "name", 240),
    address: str(p, "address", 500, false),
    latitude: num(p, "latitude", -90, 90),
    longitude: num(p, "longitude", -180, 180),
    website: str(p, "website", 2048, false),
    phone: str(p, "phone", 100, false),
  };
}
const unknownCapacity = {
  operatorVerified: false,
  acceptingAnimals: undefined,
  totalCapacity: undefined,
  currentOccupancy: undefined,
  capacityUpdatedAt: "",
};
export const register_shelter = action((ctx, p) => {
  const applicantId = user(ctx).id,
    key = id(p);
  if (ctx.db.shelters.id.find(key) || /^(rg-|osm-)/.test(key)) fail("Shelter ID already in use or reserved");
  ctx.db.shelters.insert({
    id: key,
    ...directoryFields(p),
    directorySources: "[]",
    directoryConfidence: "low",
    ...unknownCapacity,
  });
  ctx.db.staff.insert({ id: key + ":" + applicantId, shelterId: key, userId: applicantId, role: "manager" });
  ctx.db.verifications.insert({
    id: key,
    applicantId,
    status: "unverified",
    evidence: "",
    reviewedAt: "",
    reviewerId: "",
  });
});
export const request_shelter_verification = action((ctx, p) => {
  const key = id(p, "shelterId"),
    actor = user(ctx).id;
  if (!ctx.db.shelters.id.find(key)) fail("Shelter not found");
  const old = ctx.db.verifications.id.find(key);
  if (old?.status === "verified" || (old && old.status !== "rejected" && old.applicantId !== actor))
    fail("Verification unavailable");
  const request = {
    id: key,
    applicantId: actor,
    status: "pending_review",
    evidence: str(p, "evidence", 2000),
    reviewerId: "",
    reviewedAt: "",
  };
  if (old) ctx.db.verifications.id.update(request);
  else ctx.db.verifications.insert(request);
});
export const set_shelter_verification = action((ctx, p) => {
  reviewer(ctx);
  const key = id(p, "shelterId"),
    s = ctx.db.shelters.id.find(key),
    request = ctx.db.verifications.id.find(key);
  if (!s || !request) fail("Verification request not found");
  const status = choice(p, "status", ["verified", "rejected"]);
  if (request.status === status) return;
  if (request.status !== "pending_review" && !(status === "rejected" && request.status === "verified"))
    fail("Review requires submitted evidence");
  if (request.applicantId === sender(ctx)) fail("Independent reviewer required");
  ctx.db.verifications.id.update({ ...request, status, reviewedAt: now(ctx), reviewerId: sender(ctx) });
  ctx.db.shelters.id.update({
    ...s,
    ...(status === "rejected" ? unknownCapacity : {}),
    operatorVerified: status === "verified",
  });
  const staffId = key + ":" + request.applicantId;
  if (status === "rejected") {
    // Approval of a later applicant must never reactivate the previous operator's staff grants.
    for (const member of Array.from(ctx.db.staff.shelterId.filter(key))) ctx.db.staff.id.delete(member.id);
    for (const c of Array.from(ctx.db.cases.shelterId.filter(key))) {
      if (["resolved", "cancelled"].includes(c.status)) continue;
      ctx.db.cases.id.update({ ...c, shelterId: "", assigneeId: "", status: "open", updatedAt: now(ctx) });
      notify(ctx, "release:" + c.id + ":" + now(ctx), c.creatorId, "REPORT_STATUS_CHANGED", {
        caseId: c.id,
        status: "open",
      });
    }
  }
  if (status === "verified" && !ctx.db.staff.id.find(staffId))
    ctx.db.staff.insert({ id: staffId, userId: request.applicantId, shelterId: key, role: "manager" });
});
export const set_shelter_staff = action((ctx, p) => {
  const shelterId = id(p, "shelterId"),
    userId = id(p, "userId");
  if (!isStaff(ctx, shelterId) || ctx.db.staff.id.find(shelterId + ":" + sender(ctx))?.role !== "manager")
    fail("Shelter manager required");
  if (userId === sender(ctx) || !ctx.db.users.id.find(userId)) fail("Invalid staff member");
  const role = choice(p, "role", ["staff", "manager", "remove"]),
    key = shelterId + ":" + userId;
  if (role === "remove") {
    ctx.db.staff.id.delete(key);
    return;
  }
  const row = { id: key, shelterId, userId, role };
  if (ctx.db.staff.id.find(key)) ctx.db.staff.id.update(row);
  else ctx.db.staff.insert(row);
});
export const upsert_directory_shelter = action((ctx, p) => {
  service(ctx);
  const incoming = id(p);
  const sourceIds = new Set([incoming, ...stringsFromFeed(p.sourceIds, 200)]);
  const sources = new Set(stringsFromFeed(p.directorySources, 2048));
  const ids = new Set<string>();
  for (const alias of sourceIds) {
    const canonical = ctx.db.directoryAliases.id.find(alias)?.shelterId;
    if (canonical) ids.add(canonical);
    else if (ctx.db.shelters.id.find(alias)) ids.add(alias);
  }
  const claimed = [...ids].filter(
    (key) => ctx.db.verifications.id.find(key) || [...ctx.db.cases.shelterId.filter(key)].length,
  );
  if (claimed.length > 1) fail("Directory evidence overlaps multiple claimed shelters; review required");
  const key = claimed[0] ?? [...ids].sort()[0] ?? incoming;
  const old = ctx.db.shelters.id.find(key);
  // Provider subsets may change between syncs. Keep a stable canonical ID and all evidence.
  for (const previous of ids) {
    const record = ctx.db.shelters.id.find(previous);
    if (record) for (const url of JSON.parse(record.directorySources)) sources.add(url);
    if (previous === key) continue;
    for (const alias of Array.from(ctx.db.directoryAliases.shelterId.filter(previous))) {
      ctx.db.directoryAliases.id.update({ ...alias, shelterId: key });
    }
    ctx.db.shelters.id.delete(previous);
  }
  for (const alias of sourceIds)
    if (!ctx.db.directoryAliases.id.find(alias))
      ctx.db.directoryAliases.insert({ id: alias, shelterId: key });
  const directorySources = JSON.stringify([...sources].sort());
  const directoryConfidence =
    sources.size > 1 ? "high" : choice(p, "directoryConfidence", ["low", "medium", "high"]);
  if (old) {
    // Preserve fields attested by operators and all operational capacity state.
    const fields = old.operatorVerified ? {} : directoryFields(p);
    ctx.db.shelters.id.update({ ...old, ...fields, directorySources, directoryConfidence });
  } else
    ctx.db.shelters.insert({
      id: key,
      ...directoryFields(p),
      directorySources,
      directoryConfidence,
      ...unknownCapacity,
    });
});
function stringsFromFeed(field: unknown, max: number): string[] {
  if (field == null) return [];
  if (
    !Array.isArray(field) ||
    field.length > 50 ||
    field.some((s) => typeof s !== "string" || !s || s.length > max)
  )
    fail("Invalid directory sources");
  return field;
}
export const update_shelter_capacity = action((ctx, p) => {
  const key = id(p, "shelterId"),
    s = ctx.db.shelters.id.find(key);
  if (!s || !isStaff(ctx, key)) fail("Verified shelter staff required");
  const totalCapacity = num(p, "totalCapacity", 0, 1_000_000, true);
  const currentOccupancy = num(p, "currentOccupancy", 0, totalCapacity, true);
  if (typeof p.acceptingAnimals !== "boolean") fail("Invalid intake status");
  ctx.db.shelters.id.update({
    ...s,
    totalCapacity,
    currentOccupancy,
    acceptingAnimals: p.acceptingAnimals,
    capacityUpdatedAt: now(ctx),
  });
  for (const person of ctx.db.staff.shelterId.filter(key))
    notify(
      ctx,
      "capacity:" + key + ":" + now(ctx) + ":" + person.userId,
      person.userId,
      "SHELTER_CAPACITY_CHANGED",
      { shelterId: key },
    );
});
export const create_rescue_case = action((ctx, p) => {
  const reportId = id(p, "reportId"),
    r = ctx.db.reports.id.find(reportId);
  if (!r || r.status !== "open") fail("Open report required");
  if (ctx.db.grants.id.find(sender(ctx))?.role !== "service" && !canReadReport(ctx, r))
    fail("Report owner or assigned staff required");
  const shelterId = p.shelterId ? id(p, "shelterId") : "";
  if (shelterId && !ctx.db.shelters.id.find(shelterId)?.operatorVerified) fail("Verified shelter required");
  const old = ctx.db.cases.id.find(r.id);
  if (old) {
    if (shelterId && !old.shelterId && old.status === "open")
      ctx.db.cases.id.update({ ...old, shelterId, updatedAt: now(ctx) });
    return;
  }
  ctx.db.cases.insert({
    id: r.id,
    reportId,
    creatorId: r.creatorId,
    shelterId,
    assigneeId: "",
    priority: priority(r.condition),
    reason: r.condition,
    status: "open",
    updatedAt: now(ctx),
    outcome: "",
  });
});
function staffCase(ctx: Ctx, p: Input) {
  const c = ctx.db.cases.id.find(id(p, "caseId"));
  if (!c || !isStaff(ctx, c.shelterId) || ["cancelled", "resolved"].includes(c.status))
    fail("Active assigned shelter case required");
  if (
    c.assigneeId !== sender(ctx) &&
    ctx.db.staff.id.find(c.shelterId + ":" + sender(ctx))?.role !== "manager"
  )
    fail("Assigned staff or manager required");
  return c;
}
export const assign_rescue_case = action((ctx, p) => {
  const c = ctx.db.cases.id.find(id(p, "caseId")),
    shelterId = id(p, "shelterId"),
    assigneeId = p.assigneeId ? id(p, "assigneeId") : sender(ctx);
  if (
    !c ||
    !isStaff(ctx, shelterId) ||
    !isStaff(ctx, shelterId, assigneeId) ||
    (c.shelterId && c.shelterId !== shelterId)
  )
    fail("Shelter assignment unavailable");
  if (c.status === "assigned" && c.assigneeId === assigneeId) return;
  if (!["open", "under_review"].includes(c.status)) fail("Case already assigned");
  if (assigneeId !== sender(ctx) && ctx.db.staff.id.find(shelterId + ":" + sender(ctx))?.role !== "manager")
    fail("Manager required to assign a colleague");
  ctx.db.cases.id.update({ ...c, shelterId, assigneeId, status: "assigned", updatedAt: now(ctx) });
  notify(ctx, "assigned:" + c.id + ":" + now(ctx), c.creatorId, "SHELTER_CASE_ASSIGNED", {
    caseId: c.id,
    shelterId,
  });
});
export const transfer_rescue_case = action((ctx, p) => {
  const c = staffCase(ctx, p),
    shelterId = id(p, "shelterId");
  if (!ctx.db.shelters.id.find(shelterId)?.operatorVerified || shelterId === c.shelterId)
    fail("Verified destination shelter required");
  ctx.db.cases.id.update({ ...c, shelterId, assigneeId: "", status: "open", updatedAt: now(ctx) });
  notify(ctx, "transfer:" + c.id + ":" + now(ctx), c.creatorId, "SHELTER_CASE_ASSIGNED", {
    caseId: c.id,
    shelterId,
  });
});
export const resolve_rescue_case = action((ctx, p) => {
  const c = staffCase(ctx, p);
  if (!["assigned", "in_progress"].includes(c.status)) fail("Assign case before resolving");
  ctx.db.cases.id.update({ ...c, status: "resolved", outcome: str(p, "outcome", 1000), updatedAt: now(ctx) });
  notify(ctx, "resolved:" + c.id, c.creatorId, "REPORT_STATUS_CHANGED", { caseId: c.id, status: "resolved" });
});
export const update_case_status = action((ctx, p) => {
  const c = ctx.db.cases.id.find(id(p, "caseId"));
  if (!c || !isStaff(ctx, c.shelterId)) fail("Verified staff required for this case");
  const status = choice(p, "status", ["under_review", "in_progress", "cancelled"]);
  if (c.status === status) return;
  if (status === "under_review" && c.status !== "open") fail("Can only review open cases");
  if (status === "in_progress" && c.status !== "assigned") fail("Assignment required");
  if (status !== "under_review") staffCase(ctx, p);
  const outcome = status === "cancelled" ? str(p, "outcome", 1000) : c.outcome;
  ctx.db.cases.id.update({ ...c, status, outcome, updatedAt: now(ctx) });
  notify(ctx, "case-status:" + c.id + ":" + status, c.creatorId, "REPORT_STATUS_CHANGED", {
    caseId: c.id,
    status,
  });
});
