import { z } from "zod";
import { ApiError, type Actor } from "./db.js";
import { nemotron, type Model } from "./nemotron.js";

export const hazards = ["tornado", "flood", "wildfire", "heat"] as const;
type Hazard = (typeof hazards)[number];
type Choice = {
  id: string;
  label: string;
  next?: string;
  points: [number, number, number];
  feedback: string;
};
type Scene = { title: string; choices: Choice[] };
type Scenario = { title: string; source: string; nodes: Record<string, Scene> };

function choice(
  id: string,
  label: string,
  feedback: string,
  points: Choice["points"],
  next?: string,
): Choice {
  return { id, label, feedback, points, next };
}
// A choice changes both the learning path and the three independent scoring dimensions.
function scenario(title: string, source: string, first: Scene, planned: Scene, recovery: Scene): Scenario {
  return { title, source, nodes: { start: first, planned, recovery } };
}
const scenarios: Record<Hazard, Scenario> = {
  tornado: scenario(
    "Tornado shelter practice",
    "https://www.weather.gov/safety/tornado-during",
    {
      title: "In this drill, a tornado warning arrives while your dog is with you.",
      choices: [
        choice(
          "shelter",
          "Bring your dog to an interior shelter area",
          "Move together to the safest available shelter area.",
          [1, 1, 1],
          "planned",
        ),
        choice(
          "watch",
          "Go outside to watch the sky",
          "Going outside delays sheltering and increases exposure.",
          [0, 0, 0],
          "recovery",
        ),
      ],
    },
    {
      title: "Your dog is startled in the shelter area.",
      choices: [
        choice(
          "secure",
          "Keep your dog secured beside you",
          "A leash or carrier helps prevent separation.",
          [1, 1, 1],
        ),
        choice(
          "release",
          "Open the door to let your dog run",
          "An unsecured pet can bolt into danger.",
          [0, 0, 0],
        ),
      ],
    },
    {
      title: "You return indoors with your dog as the storm approaches.",
      choices: [
        choice(
          "interior",
          "Move together to a small interior room away from windows",
          "An interior shelter area reduces exposure to wind and debris.",
          [1, 1, 1],
        ),
        choice(
          "window",
          "Wait at the front window",
          "Glass and debris can injure people and pets.",
          [0, 0, 0],
        ),
      ],
    },
  ),
  flood: scenario(
    "Flood evacuation practice",
    "https://www.weather.gov/safety/flood-during",
    {
      title: "Your area receives an evacuation order in this flood exercise.",
      choices: [
        choice(
          "leave",
          "Take your carrier and kit and follow the evacuation route",
          "Leaving with your pet and supplies reduces the risk of separation.",
          [1, 1, 1],
          "planned",
        ),
        choice(
          "delay",
          "Delay departure to collect extra belongings",
          "Delaying can narrow your safe travel options.",
          [0, 0.25, 0],
          "recovery",
        ),
      ],
    },
    {
      title: "Water covers part of your planned route.",
      choices: [
        choice(
          "turn",
          "Turn around and follow official route updates",
          "Floodwater depth and road damage can be hidden.",
          [1, 1, 1],
        ),
        choice(
          "cross",
          "Drive through the flooded stretch",
          "Moving water can carry vehicles away.",
          [0, 0, 0],
        ),
      ],
    },
    {
      title: "Floodwater is now blocking the road.",
      choices: [
        choice(
          "guidance",
          "Keep your pet with you and seek official instructions for a safe route",
          "Use current instructions and avoid entering floodwaters.",
          [1, 1, 1],
        ),
        choice(
          "walk",
          "Carry your pet through moving water",
          "Moving floodwater is dangerous even on foot.",
          [0, 0, 0],
        ),
      ],
    },
  ),
  wildfire: scenario(
    "Wildfire evacuation practice",
    "https://www.ready.gov/wildfires",
    {
      title: "An evacuation order arrives during a fictional wildfire.",
      choices: [
        choice(
          "depart",
          "Secure your pet and leave using the advised route",
          "Prepared transport helps you follow evacuation directions quickly.",
          [1, 1, 1],
          "planned",
        ),
        choice(
          "pack",
          "Stay to pack nonessential items",
          "Delaying departure increases exposure to changing conditions.",
          [0, 0.25, 0],
          "recovery",
        ),
      ],
    },
    {
      title: "You need a place to stay with your pet.",
      choices: [
        choice(
          "confirm",
          "Contact your planned destination to confirm pet arrangements",
          "Checking arrangements helps you keep your pet with you.",
          [1, 1, 1],
        ),
        choice(
          "assume",
          "Assume any shelter can accept your pet",
          "Pet accommodations vary between facilities.",
          [0.5, 0, 0],
        ),
      ],
    },
    {
      title: "Smoke is increasing while your carrier is still packed away.",
      choices: [
        choice(
          "secure",
          "Secure your pet for transport and follow current evacuation directions",
          "Having the carrier ready beforehand saves time.",
          [1, 0.5, 1],
        ),
        choice(
          "wait",
          "Wait for the smoke to clear",
          "Conditions can change quickly during a wildfire.",
          [0, 0, 0],
        ),
      ],
    },
  ),
  heat: scenario(
    "Extreme heat practice",
    "https://www.weather.gov/mqt/petsafety",
    {
      title: "A fictional heat advisory coincides with your usual afternoon walk.",
      choices: [
        choice(
          "cool",
          "Keep your pet cool and postpone strenuous exercise",
          "Adjusting activity and providing water reduces heat exposure.",
          [1, 1, 1],
          "planned",
        ),
        choice(
          "usual",
          "Keep the usual strenuous afternoon outing",
          "High temperatures increase the risk of overheating.",
          [0, 0, 0],
          "recovery",
        ),
      ],
    },
    {
      title: "A stop on an errand would leave your pet in the car.",
      choices: [
        choice(
          "home",
          "Leave your pet at a cool, safe location with water",
          "A parked vehicle can heat rapidly.",
          [1, 1, 1],
        ),
        choice(
          "car",
          "Leave your pet in the car with the windows cracked",
          "Cracked windows do not protect a pet from dangerous vehicle temperatures.",
          [0, 0, 0],
        ),
      ],
    },
    {
      title: "Your pet shows signs of heat distress in the exercise.",
      choices: [
        choice(
          "vet",
          "Move to a cooler place and seek urgent veterinary advice",
          "Suspected heat illness needs prompt professional attention.",
          [1, 0.5, 1],
        ),
        choice("continue", "Continue the outing", "Continued exposure can worsen heat illness.", [0, 0, 0]),
      ],
    },
  ),
};
type State = { choices: string[] };
type Run = { id: string; scenarioId: Hazard; revision: number; state: State; score: number };
export function play(hazard: Hazard, choices: string[]) {
  const def = scenarios[hazard];
  let next: string | undefined = "start";
  const totals = [0, 0, 0];
  const history = [];
  for (const id of choices) {
    const action: Choice | undefined = next ? def.nodes[next].choices.find((c) => c.id === id) : undefined;
    if (!action) throw new ApiError(409, "Choice does not belong to the current scene");
    history.push({ label: action.label, feedback: action.feedback });
    action.points.forEach((points, i) => {
      totals[i] += points;
    });
    next = action.next;
  }
  const [petSafety, preparedness, decisionQuality] = totals.map((x) =>
    Math.round((x * 100) / Math.max(1, choices.length)),
  );
  const scene = next ? def.nodes[next] : undefined;
  return {
    category: "simulation",
    title: def.title,
    source: def.source,
    completed: !next,
    history,
    scene: scene && {
      id: next,
      title: scene.title,
      choices: scene.choices.map(({ id, label }) => ({ id, label })),
    },
    metrics: { petSafety, preparedness, decisionQuality },
    score: Math.round(0.5 * petSafety + 0.3 * preparedness + 0.2 * decisionQuality),
  };
}
export const listScenarios = () =>
  hazards.map((id) => ({ id, category: "simulation", title: scenarios[id].title }));
export const startInput = z.object({ id: z.string().uuid(), scenarioId: z.enum(hazards) }).strict();
export async function startSimulation(actor: Actor, input: z.infer<typeof startInput>) {
  const { id, scenarioId } = input;
  const existing = await actor.db.read<Run | null>("simulation_run", id);
  if (existing && existing.scenarioId !== scenarioId) throw new ApiError(409, "Run ID already used");
  if (!existing)
    await actor.system.write("record_simulation_result", {
      id,
      userId: actor.id,
      scenarioId,
      state: { choices: [] },
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
    ...play(run.scenarioId, run.state.choices),
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
  const outcome = play(run.scenarioId, choices);
  await actor.system.write("record_simulation_result", {
    id,
    userId: actor.id,
    scenarioId: run.scenarioId,
    state: { choices },
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
