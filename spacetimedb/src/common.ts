import { SenderError, t } from "spacetimedb/server";
import db, { type Ctx, type ReadCtx } from "./tables";

export type Input = Record<string, unknown>;
export function fail(message: string): never {
  throw new SenderError(message);
}
export function object(value: unknown): Input {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("Expected an object");
  return value as Input;
}
export function parse(payload: string): Input {
  if (payload.length > 96_000) fail("Payload too large");
  return object(JSON.parse(payload));
}
export const action = (fn: (ctx: Ctx, input: Input) => void) =>
  db.reducer({ payload: t.string() }, (ctx, { payload }) => fn(ctx, parse(payload)));
export function str(p: Input, key: string, max = 240, required = true): string {
  const v = p[key];
  if (!required && v == null) return "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) fail("Invalid " + key);
  return v.trim();
}
export function id(p: Input, key = "id") {
  const value = str(p, key, 200);
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) fail("Invalid " + key);
  return value;
}
export function strings(p: Input, key: string) {
  const a = p[key] ?? [];
  if (!Array.isArray(a) || a.length > 20 || a.some((v) => typeof v !== "string" || v.length > 100))
    fail("Invalid " + key);
  return a as string[];
}
export function num(p: Input, key: string, min: number, max: number, int = false) {
  const v = p[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v)))
    fail("Invalid " + key);
  return v;
}
export function choice(p: Input, key: string, values: string[]) {
  const value = str(p, key);
  if (!values.includes(value)) fail("Invalid " + key);
  return value;
}
export function date(p: Input, key: string) {
  const v = str(p, key, 64);
  if (!/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v)))
    fail("Invalid " + key);
  return new Date(v).toISOString();
}
export const sender = (ctx: Pick<Ctx, "sender">) => ctx.sender.toHexString();
export const now = (ctx: Ctx) => ctx.timestamp.toDate().toISOString();
export function user(ctx: Ctx) {
  return ctx.db.users.id.find(sender(ctx)) ?? fail("Profile required");
}
export function service(ctx: Ctx) {
  if (ctx.db.grants.id.find(sender(ctx))?.role !== "service") fail("Service identity required");
}
export function reviewer(ctx: Ctx) {
  const role = ctx.db.grants.id.find(sender(ctx))?.role;
  if (role !== "admin" && role !== "reviewer") fail("Reviewer identity required");
}
export function isStaff(ctx: ReadCtx, shelter: string, actor = sender(ctx)) {
  return (
    !!ctx.db.shelters.id.find(shelter)?.operatorVerified && !!ctx.db.staff.id.find(shelter + ":" + actor)
  );
}
export function canReadReport(ctx: Ctx, r: { id: string; creatorId: string }) {
  return (
    sender(ctx) === r.creatorId ||
    [...ctx.db.cases.reportId.filter(r.id)].some((c) => isStaff(ctx, c.shelterId))
  );
}
export function enqueue(
  ctx: Ctx,
  kind: "photo" | "report" | "external" | "purgeExternal",
  target: string,
  urls: string[] = [],
) {
  const key = kind + ":" + target;
  const prev = ctx.db.jobs.id.find(key);
  const next = {
    id: key,
    version: (prev?.version ?? 0) + 1,
    pending: true,
    photoId: "",
    reportId: "",
    externalId: "",
    purgeExternalId: "",
    photoUrls: [...new Set([...(prev?.photoUrls ?? []), ...urls])],
    [kind + "Id"]: target,
  };
  if (prev) ctx.db.jobs.id.update(next);
  else ctx.db.jobs.insert(next);
}
export function notify(ctx: Ctx, id: string, recipientId: string, eventType: string, payload: unknown) {
  if (!ctx.db.users.id.find(recipientId)) fail("Unknown recipient");
  const old = ctx.db.notifications.id.find(id);
  if (old) {
    if (old.recipientId !== recipientId || old.eventType !== eventType) fail("Notification ID conflict");
    return;
  }
  ctx.db.notifications.insert({
    id,
    recipientId,
    eventType,
    payload: JSON.stringify(payload),
    createdAt: now(ctx),
    readAt: "",
  });
}
export function priority(condition: string) {
  // Only a reporter's explicit assessment can raise priority.
  if (["severe injury", "trapped", "immediate danger"].includes(condition.toLowerCase())) return "critical";
  if (["injured", "needs care"].includes(condition.toLowerCase())) return "urgent";
  return "normal";
}
