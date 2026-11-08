import { z } from "zod";
import { ApiError, setting } from "./db.js";

export const sceneInput = z.object({
  imageBase64: z.string().min(100).max(2_000_000).regex(/^[A-Za-z0-9+/=]+$/),
  condition: z.enum(["unknown", "healthy", "needs care", "injured", "severe injury", "trapped", "immediate danger"]),
}).strict();

const result = z.object({
  environment: z.string().max(400),
  visibleConcerns: z.array(z.string().max(200)).max(5),
  uncertainty: z.string().max(400),
});

export async function assessScene(input: z.infer<typeof sceneInput>) {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${setting("NVIDIA_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: setting("NVIDIA_VISION_MODEL"), max_tokens: 400, temperature: 0.1, stream: false,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: "system", content: 'You inspect a single camera frame for a pet finder. Return only one JSON object with exactly this shape: {"environment":"string","visibleConcerns":["string"],"uncertainty":"string"}. environment must be a single string of at most 400 characters describing visible surroundings and hazards. visibleConcerns must be an array of at most 5 strings, each at most 200 characters, containing observations, not diagnoses. uncertainty must be a single string of at most 400 characters describing what cannot be established from this frame. Never infer an animal\'s medical condition or recommend treatment. Never claim help has been dispatched.' },
        { role: "user", content: [
          { type: "text", text: `Describe visible conditions in this frame. The reporter selected: ${input.condition}. Do not override their assessment.` },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.imageBase64}` } },
        ] },
      ],
    }),
  });
  if (!response.ok) throw new ApiError(503, `Scene analysis unavailable (${response.status})`);
  const payload = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).nonempty() }).safeParse(await response.json());
  if (!payload.success) throw new ApiError(502, "Scene analysis returned an unreadable response");
  let parsed: unknown;
  try { parsed = JSON.parse(payload.data.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch { throw new ApiError(502, "Scene analysis returned invalid JSON"); }
  const observation = result.safeParse(parsed);
  if (!observation.success) throw new ApiError(502, "Scene analysis returned invalid observations");
  const urgent = ["injured", "severe injury", "trapped", "immediate danger"].includes(input.condition);
  return {
    ...observation.data,
    reportedCondition: input.condition,
    nextSteps: urgent
      ? ["Keep a safe distance from a distressed animal and avoid putting yourself in danger.", "Contact local animal control or emergency services if people or the animal face immediate danger.", "Submit a found-animal report so verified shelters can review the location and condition."]
      : ["Observe from a safe distance and avoid approaching traffic, floodwater, fire, or unstable debris.", "Submit a found-animal report with the location and a clear photo if it is safe to do so."],
  };
}
