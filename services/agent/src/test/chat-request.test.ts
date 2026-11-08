import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requestChat, pendingChat } from '../chat-request.js';
import type { Actor } from '../db.js';

test('slow chat returns a polling handle, deduplicates retries, and protects the run owner', async () => {
  const actor = { id: 'owner' } as Actor;
  const input = { requestId: randomUUID(), message: 'Find accepting shelters' };
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  let calls = 0;
  const execute = async () => {
    calls++;
    await blocked;
    return { runId: 'done', status: 'completed', summary: 'Checked shelters', actions: [], possibleMatchIds: [] };
  };
  try {
    const pending = await requestChat(actor, input, execute, 1);
    assert.equal(pending.status, 'running');
    assert.equal(pendingChat(actor, pending.runId)?.status, 'running');
    assert.equal(pendingChat({ id: 'stranger' } as Actor, pending.runId), undefined);
    await assert.rejects(requestChat(actor, { ...input, message: 'Different request' }, execute, 1), /Request ID already used/);
    const retry = requestChat(actor, input, execute, 1000);
    finish();
    assert.equal((await retry).status, 'completed');
    assert.equal(calls, 1);
    assert.equal(pendingChat(actor, pending.runId), undefined);
  } finally { finish(); }
});

test('chat execution errors propagate and release the in-flight request', async () => {
  const actor = { id: 'owner' } as Actor;
  const input = { requestId: randomUUID(), message: 'Hello' };
  await assert.rejects(requestChat(actor, input, async () => { throw new Error('Database offline'); }), /Database offline/);
  const result = await requestChat(actor, input, async () => ({ runId: 'retry', status: 'completed', summary: 'Ready', actions: [], possibleMatchIds: [] }));
  assert.equal(result.status, 'completed');
});
