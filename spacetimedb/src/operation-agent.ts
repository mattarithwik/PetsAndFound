import { action, choice, fail, id, now, notify, num, object, service, str, type Input } from "./common";
import type { Ctx } from "./tables";

const active = (ctx: Ctx, caseId: string) => {
  const c = ctx.db.cases.id.find(caseId);
  return c && !["resolved", "cancelled"].includes(c.status) &&
    ctx.db.reports.id.find(c.reportId)?.status === "open";
};

// Coalesce repeated events per case. A version change fences off an older in-flight run.
export function enqueueOperation(ctx: Ctx, caseId: string, trigger: string) {
  if (!active(ctx, caseId)) return;
  const old = ctx.db.operationJobs.caseId.find(caseId);
  const row = { caseId, version: (old?.version ?? 0) + 1, trigger, status: "pending",
    runId: "", requestedAt: now(ctx), leaseUntil: "", retryAt: "", attempts: 0 };
  if (old) ctx.db.operationJobs.caseId.update(row);
  else ctx.db.operationJobs.insert(row);
  const plan = ctx.db.responsePlans.caseId.find(caseId);
  if (plan) ctx.db.responsePlans.caseId.update({ ...plan, status: "stale" });
}

export function replanForShelter(ctx: Ctx, shelterId: string, trigger = "capacity_changed") {
  const shelter = ctx.db.shelters.id.find(shelterId);
  if (!shelter) return;
  for (const c of ctx.db.cases.iter()) {
    const report = ctx.db.reports.id.find(c.reportId);
    const plan = ctx.db.responsePlans.caseId.find(c.id);
    if (!report || report.type !== "found") continue;
    // Also reconsider cases with no destination when a nearby shelter gains space.
    const rad = Math.PI / 180;
    const h = Math.sin((report.latitude - shelter.latitude) * rad / 2) ** 2 +
      Math.cos(report.latitude * rad) * Math.cos(shelter.latitude * rad) *
      Math.sin((report.longitude - shelter.longitude) * rad / 2) ** 2;
    const near = 12742 * Math.asin(Math.sqrt(Math.min(1, h))) <= 50;
    if (near || c.shelterId === shelterId || plan?.suggestedShelterId === shelterId)
      enqueueOperation(ctx, c.id, trigger);
  }
}

export const queue_response_plan = action((ctx, p) => {
  service(ctx);
  const caseId = id(p, "caseId");
  if (!active(ctx, caseId)) fail("Active case required");
  enqueueOperation(ctx, caseId, "manual_refresh");
});

export const ensure_operation_jobs = action((ctx) => {
  service(ctx);
  for (const c of ctx.db.cases.iter())
    if (!ctx.db.operationJobs.caseId.find(c.id) && ctx.db.reports.id.find(c.reportId)?.type === "found")
      enqueueOperation(ctx, c.id, "found_report");
});

export const claim_operation_job = action((ctx, p) => {
  service(ctx);
  const caseId = id(p, "caseId"), runId = id(p, "runId");
  const job = ctx.db.operationJobs.caseId.find(caseId);
  if (!job || job.version !== num(p, "version", 1, 0xffffffff, true)) fail("Job changed");
  if (!active(ctx, caseId)) {
    ctx.db.operationJobs.caseId.update({ ...job, status: "done" });
    return;
  }
  if (job.status === "done" || job.retryAt > now(ctx) ||
    (job.status === "running" && job.leaseUntil > now(ctx))) fail("Job already claimed");
  if (ctx.db.operationRuns.id.find(runId)) fail("Run ID already used");
  if (job.runId) {
    const previous = ctx.db.operationRuns.id.find(job.runId);
    if (previous?.status === "running") ctx.db.operationRuns.id.update({ ...previous,
      status: "failed", completedAt: now(ctx), error: "Worker lease expired; retrying" });
  }
  ctx.db.operationJobs.caseId.update({ ...job, status: "running", runId, attempts: job.attempts + 1,
    leaseUntil: new Date(ctx.timestamp.toDate().getTime() + 10 * 60_000).toISOString() });
  ctx.db.operationRuns.insert({ id: runId, caseId, version: job.version, trigger: job.trigger,
    status: "running", startedAt: now(ctx), completedAt: "", steps: "[]", recommendation: "", error: "" });
});

export const record_operation_step = action((ctx, p) => {
  service(ctx);
  const run = ctx.db.operationRuns.id.find(id(p, "runId"));
  if (!run || run.status !== "running") fail("Running operation required");
  const steps = JSON.parse(run.steps) as unknown[];
  if (steps.length >= 16) fail("Tool limit reached");
  const step = { tool: str(p, "tool", 80), status: choice(p, "status", ["success", "partial", "failed"]),
    requestedBy: choice(p, "requestedBy", ["nemotron", "workflow"]),
    startedAt: str(p, "startedAt", 64), completedAt: now(ctx),
    summary: str(p, "summary", 600), result: JSON.parse(str(p, "result", 6000)) };
  ctx.db.operationRuns.id.update({ ...run, steps: JSON.stringify([...steps, step]) });
  const job = ctx.db.operationJobs.caseId.find(run.caseId);
  if (job?.runId === run.id) ctx.db.operationJobs.caseId.update({ ...job,
    leaseUntil: new Date(ctx.timestamp.toDate().getTime() + 10 * 60_000).toISOString() });
});

export const renew_operation_lease = action((ctx, p) => {
  service(ctx);
  const run = ctx.db.operationRuns.id.find(id(p, "runId"));
  if (!run || run.status !== "running") return;
  const job = ctx.db.operationJobs.caseId.find(run.caseId);
  if (job?.runId === run.id && job.version === run.version && active(ctx, run.caseId))
    ctx.db.operationJobs.caseId.update({ ...job,
      leaseUntil: new Date(ctx.timestamp.toDate().getTime() + 10 * 60_000).toISOString() });
});

// This reducer publishes the recommendation and acknowledges the queue version atomically.
export const finish_operation_run = action((ctx, p) => {
  service(ctx);
  const run = ctx.db.operationRuns.id.find(id(p, "runId"));
  if (!run || run.status !== "running") fail("Running operation required");
  const job = ctx.db.operationJobs.caseId.find(run.caseId);
  const current = job?.runId === run.id && job.version === run.version && active(ctx, run.caseId);
  const status = choice(p, "status", ["completed", "degraded", "failed"]);
  const recommendation = p.recommendation == null ? "" : str(p, "recommendation", 8000);
  if (status !== "failed") {
    const rec = object(JSON.parse(recommendation));
    choice(rec, "urgency", ["normal", "urgent", "critical"]);
    str(rec, "nextAction", 300);
    for (const key of ["reasons", "missingInformation"]) {
      const values = rec[key];
      if (!Array.isArray(values) || values.length > 12 || values.some((v) => typeof v !== "string" || v.length > 600))
        fail("Invalid " + key);
    }
    if (current) saveResponsePlan(ctx, { ...p, caseId: run.caseId });
  }
  ctx.db.operationRuns.id.update({ ...run, status: current ? status : "superseded",
    completedAt: now(ctx), recommendation, error: str(p, "error", 600, false) });
  if (current && job) ctx.db.operationJobs.caseId.update({ ...job,
    status: status === "failed" ? "pending" : "done", leaseUntil: "",
    retryAt: status === "failed" ? new Date(ctx.timestamp.toDate().getTime() +
      Math.min(300_000, 5000 * 2 ** Math.min(job.attempts, 6))).toISOString() : "" });
  else if (job?.runId === run.id && !active(ctx, run.caseId))
    ctx.db.operationJobs.caseId.update({ ...job, status: "done", leaseUntil: "", retryAt: "" });
});

// Kept compatible with existing response-plan readers and review actions.
export function saveResponsePlan(ctx: Ctx, p: Input) {
  const caseId = id(p, "caseId"), c = ctx.db.cases.id.find(caseId);
  if (!c || !active(ctx, caseId)) fail("Active case required");
  const shelterId = p.suggestedShelterId ? id(p, "suggestedShelterId") : "";
  if (shelterId && !ctx.db.shelters.id.find(shelterId)?.operatorVerified) fail("Verified shelter required");
  const steps = p.steps;
  if (!Array.isArray(steps) || steps.length > 10 || steps.some((v) => typeof v !== "string" || v.length > 300))
    fail("Invalid plan steps");
  const old = ctx.db.responsePlans.caseId.find(caseId);
  const row = { caseId, status: "proposed", suggestedShelterId: shelterId,
    reason: str(p, "reason", 1200), steps: JSON.stringify(steps),
    evidence: str(p, "evidence", 24000), generatedAt: now(ctx), reviewedBy: "", reviewedAt: "" };
  if (old) ctx.db.responsePlans.caseId.update(row);
  else ctx.db.responsePlans.insert(row);
  if (c.shelterId) for (const member of ctx.db.staff.shelterId.filter(c.shelterId))
    notify(ctx, "plan:" + caseId + ":" + row.generatedAt + ":" + member.userId, member.userId,
      "RESPONSE_PLAN_READY", { caseId });
}
