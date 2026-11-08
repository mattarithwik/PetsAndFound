import test from "node:test";
import assert from "node:assert/strict";
import { nemotron } from "../nemotron.js";

test("Nemotron disables thinking so the output budget reaches the final text or tool call", async (t) => {
  const previous = {
    key: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL,
  };
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
  t.after(() => {
    if (previous.key === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previous.key;
    if (previous.model === undefined) delete process.env.NVIDIA_MODEL;
    else process.env.NVIDIA_MODEL = previous.model;
  });
  const bodies: Record<string, unknown>[] = [];
  let truncated = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: truncated ? null : "Completed drill feedback.",
              },
              finish_reason: truncated ? "length" : "stop",
            },
          ],
        }),
        { status: 200 },
      );
    },
  );
  const messages = [
    { role: "user" as const, content: "Explain the recorded score." },
  ];
  assert.equal(
    (await nemotron(messages, [], { maxTokens: 256, timeoutMs: 15000 }))
      .content,
    "Completed drill feedback.",
  );
  assert.deepEqual(bodies[0].chat_template_kwargs, { enable_thinking: false });
  assert.equal(bodies[0].max_tokens, 256);
  assert.equal(bodies[0].tools, undefined);

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "inspect_case",
        description: "Read a case",
        parameters: { type: "object" },
      },
    },
  ];
  await nemotron(messages, tools);
  assert.deepEqual(bodies[1].tools, tools);
  assert.equal(bodies[1].tool_choice, "auto");
  assert.equal(bodies[1].max_tokens, 1300);
  assert.deepEqual(bodies[1].chat_template_kwargs, { enable_thinking: false });

  truncated = true;
  await assert.rejects(() => nemotron(messages, []), /output limit/);
});
