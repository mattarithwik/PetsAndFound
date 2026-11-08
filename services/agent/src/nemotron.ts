import { z } from "zod";
import { ApiError, setting } from "./db.js";

const answer = z.object({
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string().max(256),
        type: z.literal("function"),
        function: z.object({
          name: z.string().max(80),
          arguments: z.string().max(12000),
        }),
      }),
    )
    .max(8)
    .optional(),
});
export type Answer = z.infer<typeof answer>;
export type Message = {
  role: "system" | "assistant" | "user" | "tool";
  content: string | null;
  tool_calls?: Answer["tool_calls"];
  tool_call_id?: string;
};
export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};
type ModelOptions = { maxTokens?: number; timeoutMs?: number };
export type Model = (
  messages: Message[],
  tools: ToolSpec[],
  options?: ModelOptions,
) => Promise<Answer>;

export const nemotron: Model = async (messages, tools, options = {}) => {
  const response = await fetch(
    "https://integrate.api.nvidia.com/v1/chat/completions",
    {
      method: "POST",
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
      redirect: "error",
      headers: {
        Authorization: `Bearer ${setting("NVIDIA_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: setting("NVIDIA_MODEL"),
        messages,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        temperature: 0.2,
        // Thinking tokens share max_tokens with the answer. Direct mode keeps the
        // bounded tool and feedback calls from spending their entire budget on reasoning.
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: options.maxTokens ?? 1300,
        stream: false,
      }),
    },
  );
  if (!response.ok)
    throw new ApiError(
      503,
      "Nemotron is unavailable (" + response.status + ")",
    );
  const data = z
    .object({
      choices: z
        .array(
          z.object({ message: answer, finish_reason: z.string().nullish() }),
        )
        .nonempty(),
    })
    .safeParse(await response.json());
  if (!data.success)
    throw new ApiError(502, "Nemotron returned an unreadable answer");
  const choice = data.data.choices[0];
  if (choice.finish_reason === "length")
    throw new ApiError(
      502,
      "Nemotron reached its output limit before completing the answer",
    );
  return choice.message;
};
