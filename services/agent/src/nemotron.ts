import { z } from "zod";
import { ApiError, setting } from "./db.js";

const answer = z.object({
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string().max(256),
        type: z.literal("function"),
        function: z.object({ name: z.string().max(80), arguments: z.string().max(12000) }),
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
export type Model = (messages: Message[], tools: ToolSpec[]) => Promise<Answer>;

export const nemotron: Model = async (messages, tools) => {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    redirect: "error",
    headers: { Authorization: `Bearer ${setting("NVIDIA_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: setting("NVIDIA_MODEL"),
      messages,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      temperature: 0.2,
      max_tokens: 1300,
      stream: false,
    }),
  });
  if (!response.ok) throw new ApiError(503, "Nemotron is unavailable (" + response.status + ")");
  const data = z
    .object({ choices: z.array(z.object({ message: answer })).nonempty() })
    .safeParse(await response.json());
  if (!data.success) throw new ApiError(502, "Nemotron returned an unreadable answer");
  return data.data.choices[0].message;
};
