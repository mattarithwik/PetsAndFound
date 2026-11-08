export const hazards = ["tornado", "wildfire", "winter_storm", "earthquake", "flood", "heat"] as const;
export type DrillHazard = (typeof hazards)[number];
export const animals = ["dog", "cat", "snake", "bird", "rabbit"] as const;
export type Animal = (typeof animals)[number];
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
const scenarios: Record<DrillHazard, Scenario> = {
  tornado: scenario(
    "Tornado shelter practice",
    "https://www.weather.gov/safety/tornado-during",
    {
      title: "In this drill, a tornado warning arrives while your pet is with you.",
      choices: [
        choice(
          "shelter",
          "Bring your pet to an interior shelter area",
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
      title: "Your pet is startled in the shelter area.",
      choices: [
        choice(
          "secure",
          "Keep your pet secured beside you",
          "Transport equipment suited to your pet helps prevent separation.",
          [1, 1, 1],
        ),
        choice(
          "release",
          "Open the door to let your pet run",
          "An unsecured pet can bolt into danger.",
          [0, 0, 0],
        ),
      ],
    },
    {
      title: "You return indoors with your pet as the storm approaches.",
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
  winter_storm: scenario(
    "Winter storm shelter practice",
    "https://www.weather.gov/safety/winter-before",
    {
      title: "Snow is forecast to close roads overnight. Your pet is at home.",
      choices: [
        choice(
          "stock",
          "Prepare an indoor space, water and pet supplies",
          "Supplies at home help you avoid a trip on icy roads.",
          [1, 1, 1],
          "planned",
        ),
        choice(
          "later",
          "Plan to shop after the storm arrives",
          "Snow and ice may cut off access to supplies.",
          [0.5, 0, 0],
          "recovery",
        ),
      ],
    },
    {
      title: "The power fails and your home is getting cold.",
      choices: [
        choice(
          "garage",
          "Run a generator in the attached garage",
          "A generator in a garage can expose the entire household to carbon monoxide.",
          [0, 0, 0],
        ),
        choice(
          "warm",
          "Contact your planned warm destination about arrangements for your pet",
          "Knowing where your pet can stay helps you respond to a prolonged outage.",
          [1, 1, 1],
        ),
      ],
    },
    {
      title: "Roads have closed. You have enough pet supplies for tonight.",
      choices: [
        choice(
          "drive",
          "Set out now on the closed roads",
          "Driving onto closed roads puts you and your pet at risk.",
          [0, 0, 0],
        ),
        choice(
          "shelter",
          "Stay sheltered and check official local updates",
          "Shelter and reliable information reduce exposure while roads are unsafe.",
          [1, 0.5, 1],
        ),
      ],
    },
  ),
  earthquake: scenario(
    "Earthquake shelter practice",
    "https://www.cdc.gov/earthquakes/safety/stay-safe-during-an-earthquake.html",
    {
      title: "You are indoors near a sturdy table with your pet. The floor starts shaking.",
      choices: [
        choice(
          "run",
          "Run across the room to fetch the carrier",
          "Moving through the room during shaking exposes you to falling objects.",
          [0, 0, 0],
          "recovery",
        ),
        choice(
          "cover",
          "Drop, take cover under the table and hold on",
          "Protecting yourself where you are helps you care for your pet after the shaking.",
          [1, 1, 1],
          "planned",
        ),
      ],
    },
    {
      title: "The shaking stops. Your pet is nearby and the front gate has fallen.",
      choices: [
        choice(
          "secure",
          "Secure your pet before opening the door",
          "Damaged gates and unfamiliar surroundings can lead to separation.",
          [1, 1, 1],
        ),
        choice(
          "loose",
          "Let your pet explore outside alone",
          "Your pet can escape through the damaged gate.",
          [0, 0, 0],
        ),
      ],
    },
    {
      title: "An aftershock begins before you reach the carrier.",
      choices: [
        choice(
          "sprint",
          "Sprint to the front door",
          "Running during shaking increases your exposure to debris.",
          [0, 0, 0],
        ),
        choice(
          "protect",
          "Drop, cover and hold on again",
          "Take protective action again when shaking resumes.",
          [1, 0.5, 1],
        ),
      ],
    },
  ),
  heat: scenario(
    "Extreme heat practice",
    "https://www.weather.gov/mqt/petsafety",
    {
      title: "The forecast in this exercise calls for extreme afternoon heat.",
      choices: [
        choice(
          "cool",
          "Arrange a safe temperature-controlled place for your pet",
          "Species-appropriate temperatures and access to water help protect your pet.",
          [1, 1, 1],
          "planned",
        ),
        choice(
          "usual",
          "Leave your pet in direct afternoon sun",
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
// Runs created before the third decision was introduced replay with their original scores.
export type Edition = 1 | 2 | 3;
const coordination: Scene = {
  title: "After the disaster, a pet is missing. A neighbor has a possible sighting, and the nearest shelter may be full.",
  choices: [
    choice("coordinate", "Share the sighting and photo, then confirm space with a verified shelter",
      "A verified report, human review of possible matches and confirmed intake keep the owner and shelter informed.", [1, 1, 1]),
    choice("assume", "Declare a match and send the animal to the nearest shelter without checking",
      "A similar photo cannot establish identity, and shelter capacity can change. Confirm both before a handoff.", [0, 0, 0]),
  ],
};
const after: Record<DrillHazard, Scene> = {
  tornado: {
    title: "The warning ends. Outside, the gate is down and debris covers the yard.",
    choices: [
      choice(
        "roam",
        "Let your pet explore the yard alone",
        "Damaged fencing can leave an escape route for a frightened animal.",
        [0, 0, 0],
      ),
      choice(
        "check",
        "Keep your pet secured and check local updates before going outside",
        "Securing your pet prevents separation while you check conditions and damaged fencing.",
        [1, 1, 1],
      ),
    ],
  },
  wildfire: {
    title: "Your pet-friendly host asks how to identify your pet if you are separated.",
    choices: [
      choice(
        "records",
        "Share a current photo and check your carrier's contact label",
        "A current photo and contact details help someone reunite you with your pet.",
        [1, 1, 1],
      ),
      choice(
        "guess",
        "Rely on a description from memory",
        "A written description, current photo and contact information are easier to verify.",
        [0.5, 0, 0.25],
      ),
    ],
  },
  winter_storm: {
    title: "You can stay warm indoors. The snow has stopped, but local roads remain closed.",
    choices: [
      choice(
        "wait",
        "Check official travel updates before heading out",
        "Road closures and icy conditions can persist after snowfall ends.",
        [1, 1, 1],
      ),
      choice(
        "ignore",
        "Set out immediately to test the road",
        "Clear skies do not tell you whether the road is safe.",
        [0, 0, 0],
      ),
    ],
  },
  earthquake: {
    title: "Shaking has stopped and officials advise leaving the building.",
    choices: [
      choice(
        "alone",
        "Open the door and let your pet follow on its own",
        "A frightened pet can disappear into unfamiliar or damaged surroundings.",
        [0, 0, 0],
      ),
      choice(
        "transport",
        "Secure your pet for transport and follow local directions",
        "A suitable carrier or restraint helps you leave together.",
        [1, 1, 1],
      ),
    ],
  },
  flood: {
    title: "You have a dry route. The first evacuation shelter may have limited pet space.",
    choices: [
      choice(
        "release",
        "Leave your pet outside the shelter entrance",
        "An unattended animal can escape or become separated from you.",
        [0, 0, 0],
      ),
      choice(
        "call",
        "Check pet arrangements and contact your backup destination",
        "A confirmed pet-friendly destination keeps you and your pet together.",
        [1, 1, 1],
      ),
    ],
  },
  heat: {
    title: "You are planning for another hot day tomorrow.",
    choices: [
      choice(
        "plan",
        "Arrange appropriate temperatures, water and a backup place to stay",
        "A backup plan helps protect your pet if cooling at home fails.",
        [1, 1, 1],
      ),
      choice(
        "carwait",
        "Use a parked car as a backup place to wait",
        "A parked vehicle can become dangerously hot in a short time.",
        [0, 0, 0],
      ),
    ],
  },
};
export function playDrill(
  hazard: DrillHazard,
  choices: string[],
  animal: Animal = "dog",
  edition: Edition = 1,
) {
  const def = scenarios[hazard];
  let next: string | undefined = "start";
  const personalize = (line: string) =>
    line.replace(/your pet\b/gi, (words) => (words.startsWith("Y") ? "Your " + animal : "your " + animal));
  const node = (id: string) => (id === "after" ? after[hazard] : id === "coordination" ? coordination : def.nodes[id]);
  const totals = [0, 0, 0];
  const history = [];
  for (const id of choices) {
    const action: Choice | undefined = next ? node(next).choices.find((c) => c.id === id) : undefined;
    if (!action) throw new Error("Choice does not belong to the current scene");
    history.push({ label: personalize(action.label), feedback: personalize(action.feedback) });
    action.points.forEach((points, i) => {
      totals[i] += points;
    });
    next = action.next ?? (edition >= 2 && history.length === 2 ? "after" : edition === 3 && history.length === 3 ? "coordination" : undefined);
  }
  const [petSafety, preparedness, decisionQuality] = totals.map((x) =>
    Math.round((x * 100) / Math.max(1, choices.length)),
  );
  const scene = next ? node(next) : undefined;
  return {
    animal,
    totalDecisions: edition === 3 ? 4 : edition === 2 ? 3 : 2,
    category: "simulation",
    title: def.title,
    source: def.source,
    completed: !next,
    history,
    scene: scene && {
      id: next,
      title: personalize(scene.title),
      choices: scene.choices.map(({ id, label }) => ({ id, label: personalize(label) })),
    },
    metrics: { petSafety, preparedness, decisionQuality },
    score: Math.round(0.5 * petSafety + 0.3 * preparedness + 0.2 * decisionQuality),
  };
}
export const listScenarios = () =>
  hazards.map((id) => ({ id, category: "simulation", title: scenarios[id].title }));
