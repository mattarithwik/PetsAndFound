import { setTimeout, clearTimeout } from 'node:timers';
import { ApiError, type Actor } from './db.js';
import { message, messageInput } from './orchestrator.js';
import { stableId } from './workflows.js';
import type { z } from 'zod';

type Input = z.infer<typeof messageInput>;
const active = new Map<string, { owner: string; intent: string; work: ReturnType<typeof message> }>();
export function pendingChat(actor: Actor, runId: string) {
  const entry = active.get(runId);
  return entry?.owner === actor.id ? {
    runId, status: 'running', summary: 'Pawtricia is checking your request.', actions: [], possibleMatchIds: [],
  } : undefined;
}
export async function requestChat(actor: Actor, input: Input, execute = message, waitMs = 3000) {
  const runId = stableId(actor.id, input.requestId);
  let entry = active.get(runId);
  if (entry && entry.intent !== input.message) throw new ApiError(409, 'Request ID already used');
  if (!entry) {
    const work = Promise.resolve().then(() => execute(actor, input));
    entry = { owner: actor.id, intent: input.message, work };
    active.set(runId, entry);
    // Attach both handlers so a disconnected client cannot cause an unhandled rejection.
    void work.then(() => active.delete(runId), () => active.delete(runId));
  }
  const pending = pendingChat(actor, runId)!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    entry.work,
    new Promise<typeof pending>((resolve) => { timer = setTimeout(() => resolve(pending), waitMs); }),
  ]).finally(() => clearTimeout(timer));
}
