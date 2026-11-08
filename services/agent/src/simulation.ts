import { z } from "zod";
import { ApiError, type Actor } from "./db.js";
import { nemotron, type Model } from "./nemotron.js";

import { animals, hazards, playDrill, type Animal, type DrillHazard, type Edition } from "./drills/rules.js";
export { hazards, listScenarios } from "./drills/rules.js";

type State = { choices: string[]; animal?: Animal; edition?: Edition };
type Run = { id: string; scenarioId: DrillHazard; revision: number; state: State; score: number };

export function play(hazard: DrillHazard, choices: string[], animal: Animal = "dog", edition: Edition = 1) {
  try {
    return playDrill(hazard, choices, animal, edition);
  } catch {
    throw new ApiError(409, "Choice does not belong to the current scene");
  }
}
export const startInput = z
  .object({ id: z.string().uuid(), scenarioId: z.enum(hazards), animal: z.enum(animals).optional() })
  .strict();
export async function startSimulation(actor: Actor, input: z.infer<typeof startInput>) {
  const { id, scenarioId, animal = "dog" } = input;
  const existing = await actor.db.read<Run | null>("simulation_run", id);
  if (existing && (existing.scenarioId !== scenarioId || (existing.state.animal ?? "dog") !== animal))
    throw new ApiError(409, "Run ID already used");
  if (!existing)
    await actor.system.write("record_simulation_result", {
      id,
      userId: actor.id,
      scenarioId,
      state: { choices: [], animal, edition: 3 },
      score: 0,
      expectedRevision: 0,
    });
  return simulation(actor, id);
}
export async function simulation(actor: Actor, id: string) {
  const run = await actor.db.read<Run | null>("simulation_run", id);
  if (!run) throw new ApiError(404, "Simulation run not found");
  return {
    id,
    revision: run.revision,
    scenarioId: run.scenarioId,
    ...play(run.scenarioId, run.state.choices, run.state.animal, run.state.edition),
  };
}
export const stepInput = z
  .object({ choiceId: z.string().min(1).max(32), revision: z.number().int().positive() })
  .strict();
export async function step(actor: Actor, id: string, input: z.infer<typeof stepInput>) {
  const run = await actor.db.read<Run | null>("simulation_run", id);
  if (!run) throw new ApiError(404, "Simulation run not found");
  if (run.revision !== input.revision) {
    if (run.state.choices[input.revision - 1] === input.choiceId) return simulation(actor, id);
    throw new ApiError(409, "Simulation has advanced; reload the current scene");
  }
  const choices = [...run.state.choices, input.choiceId];
  const outcome = play(run.scenarioId, choices, run.state.animal, run.state.edition);
  await actor.system.write("record_simulation_result", {
    id,
    userId: actor.id,
    scenarioId: run.scenarioId,
    state: { ...run.state, choices },
    score: outcome.score,
    expectedRevision: run.revision,
  });
  return simulation(actor, id);
}
export async function feedback(actor: Actor, id: string, model: Model = nemotron) {
  const result = await simulation(actor, id);
  if (!result.completed) throw new ApiError(409, "Finish the simulation before requesting feedback");
  const answer = await model(
    [
      {
        role: "system",
        content:
          "Explain these predefined educational outcomes in two sentences. This is a fictional pet safety simulation. Use only the supplied choice feedback and scores.",
      },
      { role: "user", content: JSON.stringify(result) },
    ],
    [],
  );
  if (!answer.content?.trim()) throw new ApiError(502, "Nemotron returned no simulation feedback");
  return { category: "simulation", score: result.score, feedback: answer.content, source: result.source };
}
