import {
  action,
  canReadReport,
  choice,
  enqueue,
  fail,
  id,
  now,
  notify,
  num,
  object,
  reviewer,
  sender,
  service,
  str,
  type Input,
} from "./common";
import type { Ctx } from "./tables";

export const save_agent_run = action((ctx, p) => {
  service(ctx);
  const userId = id(p, "userId"),
    key = id(p),
    old = ctx.db.runs.id.find(key),
    intent = str(p, "intent", 6000);
  if (!ctx.db.users.id.find(userId) || (old && (old.userId !== userId || old.intent !== intent)))
    fail("Run identity conflict");
  const status = choice(p, "status", ["running", "awaiting_confirmation", "completed", "failed"]);
  const row = {
    id: key,
    userId,
    intent,
    status,
    resultSummary: str(p, "resultSummary", 16000, false),
    pendingAction: JSON.stringify(p.pendingAction ?? null),
    result: JSON.stringify(object(p.result)),
  };
  if (!old) {
    ctx.db.runs.insert(row);
    return;
  }
  if (
    old.status === "awaiting_confirmation" &&
    status === "awaiting_confirmation" &&
    old.pendingAction !== row.pendingAction
  )
    fail("Confirmation already issued");
  if (old.status === "awaiting_confirmation" && !["completed", "awaiting_confirmation"].includes(status))
    fail("Invalid confirmation transition");
  if (old.status === "completed" || old.status === "failed") {
    if (old.status !== status || old.result !== row.result) fail("Run already ended");
    return;
  }
  ctx.db.runs.id.update(row);
});
export const record_tool_event = action((ctx, p) => {
  service(ctx);
  const key = id(p),
    runId = id(p, "runId");
  if (!ctx.db.runs.id.find(runId)) fail("Unknown run");
  const row = {
    id: key,
    runId,
    tool: str(p, "tool", 150),
    status: str(p, "status", 50),
    resourceId: str(p, "resourceId", 500, false),
    createdAt: now(ctx),
  };
  const old = ctx.db.events.id.find(key);
  if (!old) ctx.db.events.insert(row);
  else if (
    old.runId !== runId ||
    old.tool !== row.tool ||
    old.status !== row.status ||
    old.resourceId !== row.resourceId
  )
    fail("Tool event conflict");
});
export const record_simulation_result = action((ctx, p) => {
  service(ctx);
  const key = id(p),
    userId = id(p, "userId"),
    scenarioId = choice(p, "scenarioId", ["tornado", "flood", "wildfire", "heat", "winter_storm", "earthquake"]);
  if (!ctx.db.users.id.find(userId)) fail("Unknown simulation owner");
  const state = JSON.stringify(object(p.state)),
    score = num(p, "score", 0, 100);
  const revision = num(p, "expectedRevision", 0, 0xfffffffe, true) + 1;
  const old = ctx.db.simulations.id.find(key);
  if (old && (old.userId !== userId || old.scenarioId !== scenarioId)) fail("Run identity conflict");
  if (old?.revision === revision && old.score === score && old.state === state) return;
  if ((old?.revision ?? 0) !== revision - 1) fail("Simulation revision conflict");
  const row = { id: key, userId, scenarioId, state, score, revision };
  if (old) ctx.db.simulations.id.update(row);
  else ctx.db.simulations.insert(row);
});
export const set_photo_embedding = action((ctx, p) => {
  service(ctx);
  const key = id(p),
    embeddingRef = str(p, "embeddingRef", 500);
  const a = ctx.db.petPhotos.id.find(key),
    b = ctx.db.reportPhotos.id.find(key);
  if (a) ctx.db.petPhotos.id.update({ ...a, embeddingRef });
  else if (b) ctx.db.reportPhotos.id.update({ ...b, embeddingRef });
  else fail("Unknown photo");
});
export const complete_matching_job = action((ctx, p) => {
  service(ctx);
  const job = ctx.db.jobs.id.find(str(p, "id", 600));
  const version = num(p, "version", 1, 0xffffffff, true);
  if (job?.version !== version || !job.pending) return;
  ctx.db.jobs.id.update({ ...job, pending: false, photoUrls: [] });
  if (job.purgeExternalId) {
    const record = ctx.db.external.id.find(job.purgeExternalId);
    if (
      record &&
      ["new", "processed"].includes(record.status) &&
      JSON.parse(record.document).processingAllowed
    )
      enqueue(ctx, "external", record.id);
  }
});
function retireMedia(ctx: Ctx, key: string, urls: string[]) {
  if (urls.length) enqueue(ctx, "purgeExternal", key, urls);
  for (const m of Array.from(ctx.db.matches.candidateId.filter(key)))
    if (m.candidateType === "external") {
      ctx.db.matches.id.delete(m.id);
      ctx.db.notifications.id.delete("possible:" + m.id);
      ctx.db.notifications.id.delete("confirmed:" + m.id + ":" + m.ownerId);
    }
  const job = ctx.db.jobs.id.find("external:" + key);
  if (job) ctx.db.jobs.id.update({ ...job, pending: false, version: job.version + 1 });
}
function permittedUrls(source: Input): string[] {
  return source.processingAllowed && Array.isArray(source.photoUrls)
    ? source.photoUrls.filter((url): url is string => typeof url === "string")
    : [];
}
function removeExternal(ctx: Ctx, key: string) {
  const old = ctx.db.external.id.find(key);
  if (!old) fail("Unknown source record");
  if (old.status === "removed") return;
  retireMedia(ctx, key, permittedUrls(JSON.parse(old.document)));
  ctx.db.external.id.update({ ...old, status: "removed", document: "{}" });
}
export const revoke_external_processing = action((ctx, p) => {
  service(ctx);
  const r = ctx.db.external.id.find(id(p));
  if (!r || r.status === "removed") return;
  const source = object(JSON.parse(r.document));
  if (source.processingRevoked) return;
  retireMedia(ctx, r.id, permittedUrls(source));
  ctx.db.external.id.update({
    ...r,
    document: JSON.stringify({
      ...source,
      processingAllowed: false,
      processingRevoked: true,
      photoUrls: [],
      animalCount: undefined,
    }),
  });
});
export const remove_external_report = action((ctx, p) => {
  service(ctx);
  removeExternal(ctx, id(p));
});
export const inactive_external_listing = action((ctx, p) => {
  service(ctx);
  const r = ctx.db.external.id.find(id(p));
  if (!r || r.status === "removed" || r.status === "inactive") return;
  const source = object(JSON.parse(r.document));
  if (source.source !== "rescuegroups") fail("Only a shelter listing can become inactive");
  retireMedia(ctx, r.id, permittedUrls(source));
  const doc = {
    source: source.source,
    sourceRecordId: source.sourceRecordId,
    sourceUrl: source.sourceUrl,
    processingAllowed: false,
    processingRevoked: source.processingRevoked,
    photoUrls: [],
    inactiveAt: now(ctx),
  };
  ctx.db.external.id.update({ ...r, status: "inactive", document: JSON.stringify(doc) });
});
export const upsert_external_report = action((ctx, p) => {
  service(ctx);
  const key = id(p),
    source = choice(p, "source", ["bluesky", "rescuegroups", "dallas", "partner"]);
  const sourceKey = JSON.stringify([source, str(p, "sourceRecordId", 2000)]),
    old = ctx.db.external.id.find(key);
  if (old && old.sourceKey !== sourceKey) fail("Source identifier conflict");
  if (old?.status === "removed") return;
  if (p.status === "removed") {
    if (old) removeExternal(ctx, key);
    else ctx.db.external.insert({ id: key, sourceKey, status: "removed", document: "{}" });
    return;
  }
  const status = choice(p, "status", ["new", "processed", "dismissed"]);
  choice(p, "reportType", ["lost", "found", "shelter_listing", "unknown"]);
  if (
    typeof p.processingAllowed !== "boolean" ||
    !Array.isArray(p.photoUrls) ||
    p.photoUrls.length > 5 ||
    p.photoUrls.some((url) => typeof url !== "string" || url.length > 2048 || !/^https:\/\//i.test(url))
  )
    fail("Invalid source permissions or photos");
  const last: Input = old ? JSON.parse(old.document) : {};
  if (
    old?.status === "inactive" &&
    (typeof p.ingestedAt !== "string" || p.ingestedAt <= String(last.inactiveAt))
  )
    return;
  if (
    typeof p.sourceUpdatedAt === "string" &&
    typeof last.sourceUpdatedAt === "string" &&
    p.sourceUpdatedAt < last.sourceUpdatedAt
  )
    return;
  // A photographic review applies to these specific permitted photos only.
  const processingAllowed = p.processingAllowed && !last.processingRevoked && status !== "dismissed";
  const photoUrls = last.processingRevoked ? [] : p.photoUrls;
  const samePhotos = JSON.stringify(photoUrls) === JSON.stringify(last.photoUrls);
  const retired = permittedUrls(last).filter((url) => !processingAllowed || !photoUrls.includes(url));
  if (old && (!samePhotos || (last.processingAllowed && !processingAllowed))) retireMedia(ctx, key, retired);
  const document = JSON.stringify({
    ...p,
    processingAllowed,
    photoUrls,
    processingRevoked: last.processingRevoked || undefined,
    ingestedAt: last.ingestedAt ?? now(ctx),
    animalCount: processingAllowed && samePhotos ? last.animalCount : undefined,
  });
  if (old?.document === document) return;
  const row = { id: key, sourceKey, status, document };
  if (old) ctx.db.external.id.update(row);
  else ctx.db.external.insert(row);
  if (processingAllowed && photoUrls.length) enqueue(ctx, "external", key);
});
export const review_external_photos = action((ctx, p) => {
  reviewer(ctx);
  const r = ctx.db.external.id.find(id(p));
  if (!r || !["new", "processed"].includes(r.status)) fail("Source record unavailable");
  const source = object(JSON.parse(r.document));
  if (!source.processingAllowed || !Array.isArray(source.photoUrls) || !source.photoUrls.length)
    fail("Photo processing is not permitted");
  if (JSON.stringify(source.photoUrls) !== JSON.stringify(p.photoUrls))
    fail("Source photos changed since review");
  source.animalCount = num(p, "animalCount", 1, 100, true);
  ctx.db.external.id.update({ ...r, document: JSON.stringify(source) });
  enqueue(ctx, "external", r.id);
});
export const propose_match = action((ctx, p) => {
  service(ctx);
  const lostReportId = id(p, "lostReportId"),
    candidateId = id(p, "candidateId"),
    candidateType = choice(p, "candidateType", ["report", "external"]);
  const lost = ctx.db.reports.id.find(lostReportId);
  if (lost?.type !== "lost" || lost.status !== "open") fail("Open lost report required");
  let finderId = "";
  if (candidateType === "report") {
    const candidate = ctx.db.reports.id.find(candidateId);
    if (candidate?.type !== "found" || candidate.status !== "open") fail("Open found report required");
    finderId = candidate.creatorId;
  } else {
    const candidate = ctx.db.external.id.find(candidateId);
    if (
      !candidate ||
      !["new", "processed"].includes(candidate.status) ||
      ctx.db.jobs.id.find("purgeExternal:" + candidateId)?.pending
    )
      fail("Source record unavailable");
    const doc = JSON.parse(candidate.document);
    if (
      !doc.processingAllowed ||
      doc.animalCount !== 1 ||
      !["found", "shelter_listing"].includes(doc.reportType)
    )
      fail("Ineligible external candidate");
  }
  const key = lostReportId + ":" + candidateType + ":" + candidateId,
    old = ctx.db.matches.id.find(key);
  if (old && old.status !== "pending") return;
  const score = num(p, "score", 0, 1),
    evidence = JSON.stringify(object(p.evidence));
  const row = {
    id: key,
    ownerId: lost.creatorId,
    finderId,
    lostReportId,
    candidateId,
    candidateType,
    score,
    evidence,
    status: "pending",
    updatedAt: now(ctx),
  };
  if (!old) ctx.db.matches.insert(row);
  else ctx.db.matches.id.update(row);
  if (p.notify === true)
    notify(ctx, "possible:" + key, lost.creatorId, "POSSIBLE_PET_MATCH", {
      matchId: key,
      lostReportId,
      candidateId,
    });
});
export const review_match = action((ctx, p) => {
  const m = ctx.db.matches.id.find(str(p, "matchId", 680));
  if (!m) fail("Match not found");
  const lost = ctx.db.reports.id.find(m.lostReportId),
    candidate = m.candidateType === "report" ? ctx.db.reports.id.find(m.candidateId) : null;
  // A finder can view a proposal. Acceptance is reserved to the owner or verified staff handling the case.
  const staffOnCandidate = candidate && candidate.creatorId !== sender(ctx) && canReadReport(ctx, candidate);
  if (!lost || (!canReadReport(ctx, lost) && !staffOnCandidate)) fail("Relevant owner or staff required");
  const status = choice(p, "status", ["confirmed", "rejected"]);
  if (m.status === status) return;
  if (m.status !== "pending" || lost.status !== "open" || (candidate && candidate.status !== "open"))
    fail("Match cannot be reviewed");
  ctx.db.matches.id.update({ ...m, status, updatedAt: now(ctx) });
  if (status === "confirmed")
    for (const recipient of new Set([m.ownerId, m.finderId].filter(Boolean)))
      notify(ctx, "confirmed:" + m.id + ":" + recipient, recipient, "MATCH_CONFIRMED", { matchId: m.id });
});
export const create_notification = action((ctx, p) => {
  service(ctx);
  const event = choice(p, "eventType", [
    "DISASTER_ALERT",
    "POSSIBLE_PET_MATCH",
    "MATCH_CONFIRMED",
    "SHELTER_CASE_ASSIGNED",
    "SHELTER_CAPACITY_CHANGED",
    "REPORT_STATUS_CHANGED",
    "NEW_NEARBY_REPORT",
  ]);
  const payload = object(p.payload);
  if (event === "DISASTER_ALERT" && !ctx.db.alerts.id.find(str(payload, "alertId", 2000)))
    fail("Unknown official alert");
  notify(ctx, id(p), id(p, "recipientId"), event, payload);
});
export const mark_notification_read = action((ctx, p) => {
  const n = ctx.db.notifications.id.find(str(p, "id", 1024));
  if (!n || n.recipientId !== sender(ctx)) fail("Notification not found");
  if (!n.readAt) ctx.db.notifications.id.update({ ...n, readAt: now(ctx) });
});
export const upsert_disaster_alert = action((ctx, p) => {
  service(ctx);
  if (p.source !== "NWS") fail("Official NWS alert required");
  const key = str(p, "alertId", 2000);
  const row = { id: key, document: JSON.stringify(p) };
  if (ctx.db.alerts.id.find(key)) ctx.db.alerts.id.update(row);
  else ctx.db.alerts.insert(row);
});
