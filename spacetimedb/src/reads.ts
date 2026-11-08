import { t } from "spacetimedb/server";
import db, {
  users,
  pets,
  petPhotos,
  reports,
  reportPhotos,
  cases,
  matches,
  runs,
  events,
  simulations,
  notifications,
  staff,
  verifications,
  type Ctx,
  type ReadCtx,
} from "./tables";
import { canReadReport, fail, isStaff, sender, service } from "./common";

function potentialMatchCount(ctx: ReadCtx, reportId: string) {
  const found = Array.from(ctx.db.matches.candidateId.filter(reportId))
    .filter((m) => m.candidateType === "report" && m.status === "pending");
  const lost = Array.from(ctx.db.matches.lostReportId.filter(reportId))
    .filter((m) => m.status === "pending");
  return new Set([...found, ...lost].map((m) => m.id)).size;
}

function verifiedMember(ctx: ReadCtx) {
  return [...ctx.db.staff.userId.filter(sender(ctx))].some((r) => isStaff(ctx, r.shelterId));
}

function incidentMember(ctx: ReadCtx, caseId: string) {
  const link = ctx.db.incidentCases.caseId.find(caseId);
  return !!link && ctx.db.incidents.id.find(link.incidentId)?.status === "active" && verifiedMember(ctx);
}

export const my_profile = db.view(
  { name: "my_profile", public: true },
  t.option(users.rowType),
  (ctx) => ctx.db.users.id.find(ctx.sender.toHexString()) ?? undefined,
);
export const my_pets = db.view({ name: "my_pets", public: true }, t.array(pets.rowType), (ctx) =>
  Array.from(ctx.db.pets.ownerId.filter(ctx.sender.toHexString())),
);
export const my_pet_photos = db.view(
  { name: "my_pet_photos", public: true },
  t.array(petPhotos.rowType),
  (ctx) => Array.from(ctx.db.petPhotos.ownerId.filter(ctx.sender.toHexString())),
);
export const my_reports = db.view({ name: "my_reports", public: true }, t.array(reports.rowType), (ctx) =>
  Array.from(ctx.db.reports.creatorId.filter(ctx.sender.toHexString())),
);
export const my_report_photos = db.view(
  { name: "my_report_photos", public: true },
  t.array(reportPhotos.rowType),
  (ctx) => Array.from(ctx.db.reportPhotos.ownerId.filter(ctx.sender.toHexString())),
);
export const my_notifications = db.view(
  { name: "my_notifications", public: true },
  t.array(notifications.rowType),
  (ctx) => Array.from(ctx.db.notifications.recipientId.filter(ctx.sender.toHexString())),
);
export const my_agent_runs = db.view({ name: "my_agent_runs", public: true }, t.array(runs.rowType), (ctx) =>
  Array.from(ctx.db.runs.userId.filter(ctx.sender.toHexString())),
);
export const my_simulation_runs = db.view(
  { name: "my_simulation_runs", public: true },
  t.array(simulations.rowType),
  (ctx) => Array.from(ctx.db.simulations.userId.filter(ctx.sender.toHexString())),
);
export const my_agent_tool_events = db.view(
  { name: "my_agent_tool_events", public: true },
  t.array(events.rowType),
  (ctx) =>
    Array.from(ctx.db.runs.userId.filter(ctx.sender.toHexString())).flatMap((r) =>
      Array.from(ctx.db.events.runId.filter(r.id)),
    ),
);
export const my_staff_roles = db.view(
  { name: "my_staff_roles", public: true },
  t.array(staff.rowType),
  (ctx) => Array.from(ctx.db.staff.userId.filter(ctx.sender.toHexString())),
);
export const my_shelter_verifications = db.view(
  { name: "my_shelter_verifications", public: true },
  t.array(verifications.rowType),
  (ctx) => Array.from(ctx.db.verifications.applicantId.filter(ctx.sender.toHexString())),
);

function relevantCases(ctx: ReadCtx) {
  const actor = sender(ctx);
  const rows = Array.from(ctx.db.cases.creatorId.filter(actor));
  for (const role of ctx.db.staff.userId.filter(actor))
    if (ctx.db.shelters.id.find(role.shelterId)?.operatorVerified)
      rows.push(...ctx.db.cases.shelterId.filter(role.shelterId));
  return [...new Map(rows.map((c) => [c.id, c])).values()];
}
function relevantMatches(ctx: ReadCtx) {
  const actor = sender(ctx),
    rows = [...ctx.db.matches.ownerId.filter(actor), ...ctx.db.matches.finderId.filter(actor)];
  for (const role of ctx.db.staff.userId.filter(actor))
    if (isStaff(ctx, role.shelterId))
      for (const c of ctx.db.cases.shelterId.filter(role.shelterId)) {
        rows.push(...ctx.db.matches.lostReportId.filter(c.reportId));
        for (const m of ctx.db.matches.candidateId.filter(c.reportId))
          if (m.candidateType === "report") rows.push(m);
      }
  return [...new Map(rows.map((m) => [m.id, m])).values()];
}
export const my_cases = db.view({ name: "my_cases", public: true }, t.array(cases.rowType), relevantCases);
export const my_available_cases = db.view(
  { name: "my_available_cases", public: true },
  t.array(t.object("AvailableCase", { id: t.string(), priority: t.string() })),
  (ctx) => {
    if (![...ctx.db.staff.userId.filter(sender(ctx))].some((r) => isStaff(ctx, r.shelterId))) return [];
    return Array.from(ctx.db.cases.shelterId.filter(""))
      .filter((c) => c.status === "open")
      .map(({ id, priority }) => ({ id, priority }));
  },
);
export const my_matches = db.view(
  { name: "my_matches", public: true },
  t.array(matches.rowType),
  relevantMatches,
);
function read(ctx: Ctx, resource: string, key: string): unknown {
  const actor = sender(ctx);
  if (resource.startsWith("service_")) service(ctx);
  const photo = () => ctx.db.petPhotos.id.find(key) ?? ctx.db.reportPhotos.id.find(key);
  const simulation = (r: { state: string }) => ({ ...r, state: JSON.parse(r.state) });
  const run = (r: { pendingAction: string; result: string }) => ({
    ...r,
    pendingAction: JSON.parse(r.pendingAction),
    result: JSON.parse(r.result),
  });
  const shelter = (s: { directorySources: string }) => ({
    ...s,
    directorySources: JSON.parse(s.directorySources),
  });
  switch (resource) {
    case "identity":
      return actor;
    case "profile":
      return ctx.db.users.id.find(actor);
    case "account_username":
      return Array.from(ctx.db.credentials.identity.filter(actor))[0]?.username ?? "";
    case "service_credentials":
      return ctx.db.credentials.username.find(key.toLowerCase()) ?? null;
    case "pets":
      return Array.from(ctx.db.pets.ownerId.filter(actor));
    case "pet": {
      const r = ctx.db.pets.id.find(key);
      return r?.ownerId === actor ? { ...r, healthNotes: ctx.db.petCareNotes.petId.find(key)?.text ?? "" } : null;
    }
    case "pet_photos":
      return ctx.db.pets.id.find(key)?.ownerId === actor
        ? Array.from(ctx.db.petPhotos.petId.filter(key))
        : [];
    case "photo": {
      const r = photo();
      if (!r) return null;
      if (r.ownerId === actor) return r;
      if ("reportId" in r) {
        const report = ctx.db.reports.id.find(r.reportId);
        if (report && canReadReport(ctx, report)) return r;
        if (report && incidentMember(ctx, r.reportId)) return r;
      }
      for (const m of relevantMatches(ctx))
        if (m.status !== "rejected") {
          const evidence = JSON.parse(m.evidence);
          if (
            ("petId" in r &&
              evidence.matchingPhotoId === r.id &&
              ctx.db.reports.id.find(m.lostReportId)?.petId === r.petId) ||
            ("reportId" in r && m.lostReportId === r.reportId && evidence.matchingPhotoId === r.id) ||
            ("reportId" in r &&
              m.candidateType === "report" &&
              m.candidateId === r.reportId &&
              evidence.candidatePhotoId === r.id)
          )
            return r;
        }
      return null;
    }
    case "reports":
      return Array.from(ctx.db.reports.creatorId.filter(actor));
    case "report": {
      const r = ctx.db.reports.id.find(key);
      return r && canReadReport(ctx, r) ? r : null;
    }
    case "report_photos": {
      const r = ctx.db.reports.id.find(key);
      return r && canReadReport(ctx, r) ? Array.from(ctx.db.reportPhotos.reportId.filter(key)) : [];
    }
    case "scene_assessment": {
      const report = ctx.db.reports.id.find(key);
      if (!report || !canReadReport(ctx, report)) return null;
      const assessment = ctx.db.sceneAssessments.reportId.find(key);
      return assessment ? { ...assessment, visibleConcerns: JSON.parse(assessment.visibleConcerns) } : null;
    }
    case "public_reports":
      return Array.from(ctx.db.reportSummaries.status.filter("open"));
    case "public_report": {
      const summary = ctx.db.reportSummaries.id.find(key);
      return summary?.status === "open" ? summary : null;
    }
    case "shelters":
      return Array.from(ctx.db.shelters.iter(), shelter);
    case "shelter": {
      const r = ctx.db.shelters.id.find(ctx.db.directoryAliases.id.find(key)?.shelterId ?? key);
      return r ? shelter(r) : null;
    }
    case "access":
      return {
        identity: actor,
        role: ctx.db.grants.id.find(actor)?.role ?? "",
        staff: Array.from(ctx.db.staff.userId.filter(actor), (r) => {
          const s = ctx.db.shelters.id.find(r.shelterId);
          return {
            shelterId: r.shelterId,
            role: r.role,
            shelter: s ? shelter(s) : null,
            verification: ctx.db.verifications.id.find(r.shelterId)?.status ?? "unverified",
          };
        }),
        applications: Array.from(ctx.db.verifications.applicantId.filter(actor), (v) => {
          const s = ctx.db.shelters.id.find(v.id);
          return { shelterId: v.id, status: v.status, reviewedAt: v.reviewedAt, shelter: s ? shelter(s) : null };
        }),
      };
    case "shelter_staff":
      if (!ctx.db.staff.id.find(key + ":" + actor)) fail("Shelter staff required");
      return Array.from(ctx.db.staff.shelterId.filter(key), (r) => ({
        userId: r.userId,
        role: r.role,
        name: ctx.db.users.id.find(r.userId)?.name ?? "",
      }));
    case "cases":
      return relevantCases(ctx).map((c) => ({ ...c, potentialMatchCount: potentialMatchCount(ctx, c.reportId) }));
    case "case": {
      const c = ctx.db.cases.id.find(key);
      if (!c) return null;
      const queued =
        !c.shelterId &&
        c.status === "open" &&
        [...ctx.db.staff.userId.filter(actor)].some((r) => isStaff(ctx, r.shelterId));
      const incidentAccess = incidentMember(ctx, c.id);
      if (!queued && !incidentAccess && !relevantCases(ctx).some((r) => r.id === c.id)) return null;
      const r = ctx.db.reports.id.find(c.reportId);
      const readable = !!r && canReadReport(ctx, r);
      return {
        ...c,
        summary: ctx.db.reportSummaries.id.find(c.reportId) ?? null,
        report: readable ? r : null,
        photos: readable || incidentAccess ? Array.from(ctx.db.reportPhotos.reportId.filter(c.reportId)) : [],
        assessment: readable && ctx.db.sceneAssessments.reportId.find(c.reportId)
          ? { ...ctx.db.sceneAssessments.reportId.find(c.reportId)!, visibleConcerns: JSON.parse(ctx.db.sceneAssessments.reportId.find(c.reportId)!.visibleConcerns) }
          : null,
      };
    }
    case "case_queue": {
      if (![...ctx.db.staff.userId.filter(actor)].some((r) => isStaff(ctx, r.shelterId)))
        fail("Verified shelter staff required");
      return Array.from(ctx.db.cases.shelterId.filter(""))
        .filter((c) => c.status === "open")
        .map((c) => ({ id: c.id, priority: c.priority, potentialMatchCount: potentialMatchCount(ctx, c.reportId), report: ctx.db.reportSummaries.id.find(c.reportId) }));
    }
    case "incidents":
      if (!verifiedMember(ctx)) fail("Verified shelter staff required");
      return Array.from(ctx.db.incidents.iter());
    case "incident_board": {
      if (!verifiedMember(ctx)) fail("Verified shelter staff required");
      const incident = ctx.db.incidents.id.find(key);
      if (!incident) return null;
      const rows = Array.from(ctx.db.incidentCases.incidentId.filter(key)).flatMap((link) => {
        const c = ctx.db.cases.id.find(link.caseId);
        if (!c) return [];
        const plan = ctx.db.responsePlans.caseId.find(c.id);
        const report = ctx.db.reports.id.find(c.reportId);
        const firstPhoto = Array.from(ctx.db.reportPhotos.reportId.filter(c.reportId))[0];
        const visualMatchCount = potentialMatchCount(ctx, c.reportId);
        return [{ id: c.id, reportId: c.reportId, shelterId: c.shelterId, priority: c.priority,
          status: c.status, updatedAt: c.updatedAt, createdAt: report?.createdAt ?? c.updatedAt,
          firstReviewedAt: ctx.db.caseFirstReviews.caseId.find(c.id)?.reviewedAt ?? "",
          photoId: firstPhoto?.id ?? "", visualMatchCount,
          duplicateKey: report ? `${report.species}:${Math.round(report.latitude * 10000)}:${Math.round(report.longitude * 10000)}:${Math.floor(Date.parse(report.observedAt) / 900000)}` : "",
          summary: ctx.db.reportSummaries.id.find(c.reportId) ?? null,
          plan: plan ? { status: plan.status, suggestedShelterId: plan.suggestedShelterId, reason: plan.reason } : null }];
      });
      const firstByKey = new Map<string, string>();
      const cases = rows.map(({ duplicateKey, ...row }) => {
        const possibleDuplicateOf = duplicateKey ? firstByKey.get(duplicateKey) ?? "" : "";
        if (duplicateKey && !possibleDuplicateOf) firstByKey.set(duplicateKey, row.id);
        return { ...row, possibleDuplicateOf };
      });
      return { incident, cases };
    }
    case "case_operations": {
      const c = ctx.db.cases.id.find(key);
      if (!c || (c.creatorId !== actor && !isStaff(ctx, c.shelterId) &&
        !(!c.shelterId && c.status === "open" && verifiedMember(ctx)) && !incidentMember(ctx, c.id))) return null;
      const job = ctx.db.operationJobs.caseId.find(key);
      const fullEvidence = c.creatorId === actor || isStaff(ctx, c.shelterId);
      const runs = Array.from(ctx.db.operationRuns.caseId.filter(key))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10)
        .map((r) => ({ ...r, status: r.status === "running" && job?.version !== r.version ? "superseded" : r.status,
          steps: (JSON.parse(r.steps) as { tool: string; result: unknown }[]).map((step) =>
            !fullEvidence && step.tool === "inspect_case" ? { ...step, result: { priority: c.priority, reportedCondition: c.reason } } : step),
          recommendation: r.recommendation ? JSON.parse(r.recommendation) : null }));
      return { job: job ? { status: job.status, trigger: job.trigger, requestedAt: job.requestedAt, retryAt: job.retryAt } : null, runs };
    }
    case "service_operation_job":
      return ctx.db.operationJobs.caseId.find(key) ?? null;
    case "service_operation_jobs":
      return Array.from(ctx.db.operationJobs.iter())
        .filter((j) => j.status !== "done" && j.retryAt <= ctx.timestamp.toDate().toISOString() &&
          (j.status !== "running" || j.leaseUntil <= ctx.timestamp.toDate().toISOString()))
        .sort((a, b) => {
          const rank = (caseId: string) => ({ critical: 0, urgent: 1, normal: 2 }[ctx.db.cases.id.find(caseId)?.priority ?? "normal"] ?? 2);
          return rank(a.caseId) - rank(b.caseId) || a.requestedAt.localeCompare(b.requestedAt);
        }).slice(0, 20);
    case "response_plan": {
      const c = ctx.db.cases.id.find(key);
      if (!c || (c.creatorId !== actor && !verifiedMember(ctx))) return null;
      const plan = ctx.db.responsePlans.caseId.find(key);
      return plan ? { ...plan, steps: JSON.parse(plan.steps), evidence: JSON.parse(plan.evidence) } : null;
    }
    case "shelter_resources": {
      const row = ctx.db.shelterResources.shelterId.find(key);
      return row && isStaff(ctx, key) ? row : null;
    }
    case "shelter_animals":
      if (!isStaff(ctx, key)) fail("Verified shelter staff required");
      return Array.from(ctx.db.shelterAnimals.shelterId.filter(key));
    case "case_messages": {
      const c = ctx.db.cases.id.find(key);
      if (!c || (c.creatorId !== actor && !isStaff(ctx, c.shelterId))) fail("Case access required");
      return Array.from(ctx.db.caseMessages.caseId.filter(key));
    }
    case "match_messages": {
      const match = ctx.db.matches.id.find(key);
      if (!match || match.status !== "confirmed" || !relevantMatches(ctx).some((m) => m.id === key))
        fail("Confirmed match access required");
      return Array.from(ctx.db.matchMessages.matchId.filter(key));
    }
    case "service_case": {
      const c = ctx.db.cases.id.find(key);
      const report = c ? ctx.db.reports.id.find(c.reportId) : null;
      return c && report ? { ...c, report, assessment: ctx.db.sceneAssessments.reportId.find(c.reportId) ?? null,
        matches: [...ctx.db.matches.lostReportId.filter(c.reportId), ...ctx.db.matches.candidateId.filter(c.reportId)] } : null;
    }
    case "service_response_plan":
      return ctx.db.responsePlans.caseId.find(key) ?? null;
    case "service_shelter_resources":
      return Array.from(ctx.db.shelterResources.iter());
    case "service_incident_cases":
      return Array.from(ctx.db.incidentCases.iter());
    case "service_plan_candidates":
      return Array.from(ctx.db.cases.iter())
        .filter((c) => !["resolved", "cancelled"].includes(c.status))
        .filter((c) => !ctx.db.responsePlans.caseId.find(c.id) || ctx.db.responsePlans.caseId.find(c.id)?.status === "stale")
        .sort((a, b) => ({ critical: 0, urgent: 1, normal: 2 }[a.priority as "critical" | "urgent" | "normal"] ?? 3) -
          ({ critical: 0, urgent: 1, normal: 2 }[b.priority as "critical" | "urgent" | "normal"] ?? 3) ||
          a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, 20)
        .map((c) => c.id);
    case "service_pending_push": {
      const rows = [];
      for (const notification of ctx.db.notifications.iter()) {
        if (notification.readAt || ctx.timestamp.toDate().getTime() - Date.parse(notification.createdAt) > 24 * 3600000 || !["POSSIBLE_PET_MATCH", "MATCH_CONFIRMED", "DISASTER_ALERT", "SHELTER_CASE_ASSIGNED", "REPORT_STATUS_CHANGED", "CASE_MESSAGE", "RESPONSE_PLAN_READY", "URGENT_CASE", "CASE_OVERDUE", "MATCH_MESSAGE"].includes(notification.eventType)) continue;
        for (const device of ctx.db.pushDevices.ownerId.filter(notification.recipientId)) {
          if (ctx.db.pushDeliveries.id.find(notification.id + ":" + device.id)) continue;
          rows.push({ notificationId: notification.id, deviceId: device.id, token: device.token,
            eventType: notification.eventType, payload: JSON.parse(notification.payload) });
          if (rows.length >= 50) return rows;
        }
      }
      return rows;
    }
    case "service_push_receipts":
      return Array.from(ctx.db.pushDeliveries.iter())
        .filter((row) => row.status === "accepted" && row.ticketId && ctx.timestamp.toDate().getTime() - Date.parse(row.updatedAt) >= 15 * 60_000)
        .slice(0, 50);
    case "shelter_verifications": {
      const role = ctx.db.grants.id.find(actor)?.role;
      return role === "admin" || role === "reviewer"
        ? Array.from(ctx.db.verifications.iter())
        : Array.from(ctx.db.verifications.applicantId.filter(actor));
    }
    case "matches":
      return relevantMatches(ctx).map((r) => {
        const reportId = r.candidateType === "report" ? r.candidateId : r.lostReportId;
        const caseRow = ctx.db.cases.id.find(reportId);
        const contact = caseRow?.shelterId && r.status !== "rejected" ? ctx.db.shelters.id.find(caseRow.shelterId) : null;
        return {
          ...r, evidence: JSON.parse(r.evidence),
          ...(contact?.operatorVerified ? { handlingShelter: { name: contact.name, phone: contact.phone, website: contact.website } } : {}),
        };
      });
    case "matched_external_photo": {
      const match = relevantMatches(ctx).find((m) =>
        m.candidateType === "external" && m.status !== "rejected" && JSON.parse(m.evidence).candidatePhotoId === key);
      if (!match) return null;
      const source = ctx.db.external.id.find(match.candidateId);
      if (!source || !["new", "processed"].includes(source.status) || ctx.db.jobs.id.find("purgeExternal:" + source.id)?.pending) return null;
      const { source: provider, processingPrincipal, processingAllowed, photoUrls } = JSON.parse(source.document);
      return processingAllowed ? { id: source.id, source: provider, processingPrincipal, processingAllowed, photoUrls } : null;
    }
    case "notifications":
      return Array.from(ctx.db.notifications.recipientId.filter(actor), (r) => ({
        ...r,
        payload: JSON.parse(r.payload),
      }));
    case "alert_location":
      return ctx.db.alertLocations.ownerId.find(actor) ?? null;
    case "service_alert_locations":
      return Array.from(ctx.db.alertLocations.iter());
    case "simulation_runs":
      return Array.from(ctx.db.simulations.userId.filter(actor), simulation);
    case "service_simulation_run":
    case "simulation_run": {
      const r = ctx.db.simulations.id.find(key);
      return r && (r.userId === actor || resource.startsWith("service_")) ? simulation(r) : null;
    }
    case "agent_runs":
      return Array.from(ctx.db.runs.userId.filter(actor), run);
    case "agent_run": {
      const r = ctx.db.runs.id.find(key);
      return r?.userId === actor ? run(r) : null;
    }
    case "tool_events":
      return ctx.db.runs.id.find(key)?.userId === actor ? Array.from(ctx.db.events.runId.filter(key)) : [];
    case "service_jobs":
      return Array.from(ctx.db.jobs.pending.filter(true));
    case "service_reports":
      return Array.from(ctx.db.reports.status.filter("open"));
    case "service_photo":
      return photo();
    case "service_photos": {
      const r = ctx.db.reports.id.find(key);
      if (!r) return [];
      const own = Array.from(ctx.db.reportPhotos.reportId.filter(key));
      if (!r.petId) return own;
      return [
        ...ctx.db.petPhotos.petId.filter(r.petId),
        ...own.map((photo) => ({ ...photo, petId: r.petId })),
      ];
    }
    case "service_external":
      return Array.from(ctx.db.external.iter())
        .filter((r) => ["new", "processed"].includes(r.status))
        .map((r) => {
          const source = JSON.parse(r.document);
          if (ctx.db.jobs.id.find("purgeExternal:" + r.id)?.pending)
            return {
              ...source,
              processingAllowed: false,
              photoUrls: [],
              animalCount: undefined,
              purgePending: true,
            };
          return source;
        });
    default:
      return fail("Unknown resource");
  }
}
export const api_read = db.procedure(
  { resource: t.string(), key: t.string() },
  t.string(),
  (ctx, { resource, key }) => ctx.withTx((tx) => JSON.stringify(read(tx, resource, key) ?? null)),
);
