import { action, choice, fail, id, isStaff, now, num, notify, sender, service, str } from "./common";
import type { Ctx } from "./tables";
import { enqueueOperation, replanForShelter, saveResponsePlan } from "./operation-agent";

function verifiedStaff(ctx: Ctx) {
  if (![...ctx.db.staff.userId.filter(sender(ctx))].some((r) => isStaff(ctx, r.shelterId)))
    fail("Verified shelter staff required");
}

function staffNear(ctx: Ctx, location: { latitude: number; longitude: number }, radiusKm: number) {
  return [...ctx.db.staff.userId.filter(sender(ctx))].some((role) => {
    const shelter = ctx.db.shelters.id.find(role.shelterId);
    return !!shelter && isStaff(ctx, shelter.id) && km(shelter, location) <= radiusKm;
  });
}

function caseAccess(ctx: Ctx, caseId: string) {
  const c = ctx.db.cases.id.find(caseId);
  if (!c || (c.creatorId !== sender(ctx) && !isStaff(ctx, c.shelterId))) fail("Case access required");
  return c;
}

function km(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad, dlon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function notifyNearbyStaff(ctx: Ctx, caseId: string, location: { latitude: number; longitude: number }, eventType: string) {
  for (const shelter of ctx.db.shelters.iter()) {
    if (!shelter.operatorVerified || km(shelter, location) > 50) continue;
    for (const member of ctx.db.staff.shelterId.filter(shelter.id))
      notify(ctx, `${eventType}:${caseId}:${member.userId}`, member.userId, eventType, { caseId });
  }
}

export function linkMatchingIncident(ctx: Ctx, caseId: string, report: { latitude: number; longitude: number }) {
  const incident = Array.from(ctx.db.incidents.iter())
    .filter((row) => row.status === "active" && km(row, report) <= row.radiusKm)
    .sort((a, b) => km(a, report) - km(b, report))[0];
  if (!incident || ctx.db.incidentCases.caseId.find(caseId)) return;
  ctx.db.incidentCases.insert({ caseId, incidentId: incident.id, linkedAt: now(ctx) });
}

export const create_incident = action((ctx, p) => {
  verifiedStaff(ctx);
  const key = id(p);
  if (ctx.db.incidents.id.find(key)) fail("Incident ID already exists");
  const latitude = num(p, "latitude", -90, 90), longitude = num(p, "longitude", -180, 180);
  if (!staffNear(ctx, { latitude, longitude }, 50)) fail("Incident must be near your verified shelter");
  ctx.db.incidents.insert({
    id: key,
    title: str(p, "title", 160),
    hazard: choice(p, "hazard", ["tornado", "wildfire", "winter_storm", "earthquake", "flood", "heat", "other"]),
    latitude,
    longitude,
    radiusKm: num(p, "radiusKm", 1, 500),
    status: "active",
    createdBy: sender(ctx),
    createdAt: now(ctx),
  });
  for (const c of ctx.db.cases.iter()) {
    const report = ctx.db.reports.id.find(c.reportId);
    if (report && !ctx.db.incidentCases.caseId.find(c.id)) linkMatchingIncident(ctx, c.id, report);
  }
});

export const close_incident = action((ctx, p) => {
  verifiedStaff(ctx);
  const row = ctx.db.incidents.id.find(id(p, "incidentId"));
  if (!row) fail("Incident not found");
  if (row.createdBy !== sender(ctx) && !staffNear(ctx, row, row.radiusKm)) fail("Local incident staff required");
  ctx.db.incidents.id.update({ ...row, status: "closed" });
});

export const link_incident_case = action((ctx, p) => {
  verifiedStaff(ctx);
  const caseId = id(p, "caseId"), incidentId = id(p, "incidentId");
  const incident = ctx.db.incidents.id.find(incidentId);
  const report = ctx.db.reports.id.find(caseId);
  if (!ctx.db.cases.id.find(caseId) || !incident || incident.status !== "active" || !report)
    fail("Active case and incident required");
  if (!staffNear(ctx, incident, incident.radiusKm) || km(incident, report) > incident.radiusKm)
    fail("Case must be inside a local incident");
  const old = ctx.db.incidentCases.caseId.find(caseId);
  if (old) ctx.db.incidentCases.caseId.update({ ...old, incidentId, linkedAt: now(ctx) });
  else ctx.db.incidentCases.insert({ caseId, incidentId, linkedAt: now(ctx) });
});

export const save_response_plan = action((ctx, p) => {
  service(ctx);
  saveResponsePlan(ctx, p);
});

export const review_response_plan = action((ctx, p) => {
  verifiedStaff(ctx);
  const caseId = id(p, "caseId"), plan = ctx.db.responsePlans.caseId.find(caseId), c = ctx.db.cases.id.find(caseId);
  if (!plan || !c) fail("Plan not found");
  const report = ctx.db.reports.id.find(c.reportId);
  if (c.shelterId ? !isStaff(ctx, c.shelterId) : !report || !staffNear(ctx, report, 50))
    fail("Staff for this case required");
  const status = choice(p, "status", ["accepted", "declined"]);
  ctx.db.responsePlans.caseId.update({ ...plan, status, reviewedBy: sender(ctx), reviewedAt: now(ctx) });
});

export const update_shelter_resources = action((ctx, p) => {
  const shelterId = id(p, "shelterId");
  if (!isStaff(ctx, shelterId)) fail("Verified shelter staff required");
  const row = { shelterId, species: str(p, "species", 160, false), supplies: str(p, "supplies", 1000, false),
    foodUnits: num(p, "foodUnits", 0, 100000, true), crates: num(p, "crates", 0, 100000, true),
    medicalKits: num(p, "medicalKits", 0, 100000, true), updatedAt: now(ctx) };
  if (ctx.db.shelterResources.shelterId.find(shelterId)) ctx.db.shelterResources.shelterId.update(row);
  else ctx.db.shelterResources.insert(row);
  replanForShelter(ctx, shelterId, "resources_changed");
});

export const register_shelter_animal = action((ctx, p) => {
  const shelterId = id(p, "shelterId");
  if (!isStaff(ctx, shelterId)) fail("Verified shelter staff required");
  const key = id(p), caseId = p.caseId ? id(p, "caseId") : "";
  if (caseId && ctx.db.cases.id.find(caseId)?.shelterId !== shelterId) fail("Shelter case required");
  if (ctx.db.shelterAnimals.id.find(key)) fail("Animal ID already exists");
  const shelter = ctx.db.shelters.id.find(shelterId)!;
  if (typeof shelter.totalCapacity === "number" && typeof shelter.currentOccupancy === "number") {
    if (shelter.currentOccupancy >= shelter.totalCapacity) fail("Shelter is at reported capacity");
    ctx.db.shelters.id.update({ ...shelter, currentOccupancy: shelter.currentOccupancy + 1, capacityUpdatedAt: now(ctx) });
    replanForShelter(ctx, shelterId);
  }
  ctx.db.shelterAnimals.insert({
    id: key, shelterId, caseId, species: choice(p, "species", ["dog", "cat", "other"]),
    description: str(p, "description", 1000), status: "in_care", arrivedAt: now(ctx), departedAt: "", outcome: "",
  });
});

export const discharge_shelter_animal = action((ctx, p) => {
  const row = ctx.db.shelterAnimals.id.find(id(p, "id"));
  if (!row || !isStaff(ctx, row.shelterId) || row.status !== "in_care") fail("Active shelter animal required");
  ctx.db.shelterAnimals.id.update({ ...row, status: choice(p, "status", ["reunited", "transferred", "other"]), departedAt: now(ctx), outcome: str(p, "outcome", 1000) });
  const shelter = ctx.db.shelters.id.find(row.shelterId);
  if (shelter && typeof shelter.currentOccupancy === "number" && shelter.currentOccupancy > 0)
    ctx.db.shelters.id.update({ ...shelter, currentOccupancy: shelter.currentOccupancy - 1, capacityUpdatedAt: now(ctx) });
  replanForShelter(ctx, row.shelterId);
});

export const send_case_message = action((ctx, p) => {
  const caseId = id(p, "caseId"), c = caseAccess(ctx, caseId), key = id(p);
  if (!c.shelterId) fail("A shelter must accept the case before messaging");
  if (ctx.db.caseMessages.id.find(key)) return;
  const body = str(p, "body", 1000);
  ctx.db.caseMessages.insert({ id: key, caseId, senderId: sender(ctx), body, createdAt: now(ctx) });
  const recipients = sender(ctx) === c.creatorId
    ? [...ctx.db.staff.shelterId.filter(c.shelterId)].map((r) => r.userId)
    : [c.creatorId];
  for (const recipient of recipients) if (recipient !== sender(ctx))
    notify(ctx, "message:" + key + ":" + recipient, recipient, "CASE_MESSAGE", { caseId });
});

export const save_scene_assessment = action((ctx, p) => {
  const reportId = id(p, "reportId"), report = ctx.db.reports.id.find(reportId);
  if (!report || report.creatorId !== sender(ctx) || report.type !== "found" || report.status !== "open")
    fail("Open found report required");
  const concerns = p.visibleConcerns;
  if (!Array.isArray(concerns) || concerns.length > 5 || concerns.some((v) => typeof v !== "string" || v.length > 200))
    fail("Invalid visual observations");
  const row = { reportId, environment: str(p, "environment", 400), visibleConcerns: JSON.stringify(concerns),
    uncertainty: str(p, "uncertainty", 400), createdAt: now(ctx) };
  if (ctx.db.sceneAssessments.reportId.find(reportId)) ctx.db.sceneAssessments.reportId.update(row);
  else ctx.db.sceneAssessments.insert(row);
  enqueueOperation(ctx, reportId, "report_updated");
});

function canMessageMatch(ctx: Ctx, match: { ownerId: string; finderId: string; lostReportId: string; candidateId: string; candidateType: string }) {
  if (match.ownerId === sender(ctx) || match.finderId === sender(ctx)) return true;
  const cases = [ctx.db.cases.id.find(match.lostReportId),
    match.candidateType === "report" ? ctx.db.cases.id.find(match.candidateId) : null];
  return cases.some((c) => c && isStaff(ctx, c.shelterId));
}

export const send_match_message = action((ctx, p) => {
  const matchId = str(p, "matchId", 680), match = ctx.db.matches.id.find(matchId);
  if (!match || match.status !== "confirmed" || !canMessageMatch(ctx, match)) fail("Confirmed match access required");
  const key = id(p);
  if (ctx.db.matchMessages.id.find(key)) return;
  ctx.db.matchMessages.insert({ id: key, matchId, senderId: sender(ctx), body: str(p, "body", 1000), createdAt: now(ctx) });
  const recipients = new Set([match.ownerId, match.finderId]);
  for (const caseId of [match.lostReportId, match.candidateType === "report" ? match.candidateId : ""]) {
    const c = ctx.db.cases.id.find(caseId);
    if (c?.shelterId) for (const member of ctx.db.staff.shelterId.filter(c.shelterId)) recipients.add(member.userId);
  }
  for (const recipient of recipients) if (recipient && recipient !== sender(ctx))
    notify(ctx, `match-message:${key}:${recipient}`, recipient, "MATCH_MESSAGE", { matchId });
});

export const escalate_unattended_cases = action((ctx) => {
  service(ctx);
  const current = ctx.timestamp.toDate().getTime();
  for (const c of ctx.db.cases.shelterId.filter("")) {
    if (c.status !== "open" || current - Date.parse(c.updatedAt) < 15 * 60_000) continue;
    const summary = ctx.db.reportSummaries.id.find(c.reportId);
    if (summary) notifyNearbyStaff(ctx, c.id, summary, "CASE_OVERDUE");
  }
});
