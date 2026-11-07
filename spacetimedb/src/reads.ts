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
    case "pets":
      return Array.from(ctx.db.pets.ownerId.filter(actor));
    case "pet": {
      const r = ctx.db.pets.id.find(key);
      return r?.ownerId === actor ? r : null;
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
    case "public_reports":
      return Array.from(ctx.db.reportSummaries.status.filter("open"));
    case "shelters":
      return Array.from(ctx.db.shelters.iter(), shelter);
    case "shelter": {
      const r = ctx.db.shelters.id.find(ctx.db.directoryAliases.id.find(key)?.shelterId ?? key);
      return r ? shelter(r) : null;
    }
    case "cases":
      return relevantCases(ctx);
    case "case_queue": {
      if (![...ctx.db.staff.userId.filter(actor)].some((r) => isStaff(ctx, r.shelterId)))
        fail("Verified shelter staff required");
      return Array.from(ctx.db.cases.shelterId.filter(""))
        .filter((c) => c.status === "open")
        .map((c) => ({ id: c.id, priority: c.priority, report: ctx.db.reportSummaries.id.find(c.reportId) }));
    }
    case "shelter_verifications": {
      const role = ctx.db.grants.id.find(actor)?.role;
      return role === "admin" || role === "reviewer"
        ? Array.from(ctx.db.verifications.iter())
        : Array.from(ctx.db.verifications.applicantId.filter(actor));
    }
    case "matches":
      return relevantMatches(ctx).map((r) => ({ ...r, evidence: JSON.parse(r.evidence) }));
    case "notifications":
      return Array.from(ctx.db.notifications.recipientId.filter(actor), (r) => ({
        ...r,
        payload: JSON.parse(r.payload),
      }));
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
