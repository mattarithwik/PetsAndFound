import {
  animals,
  hazards,
  playDrill,
  type Animal,
  type DrillHazard,
  type Edition,
} from '../../../services/agent/src/drills/rules';

export { animals, hazards, type Animal, type DrillHazard };

export const sceneArt: Record<DrillHazard, { title: string; image: number }> = {
  tornado: { title: 'Tornado', image: require('@/assets/drills/tornado.png') },
  wildfire: { title: 'Wildfire', image: require('@/assets/drills/wildfire.png') },
  winter_storm: { title: 'Winter storm', image: require('@/assets/drills/winter_storm.png') },
  earthquake: { title: 'Earthquake', image: require('@/assets/drills/earthquake.png') },
  flood: { title: 'Flood', image: require('@/assets/drills/flood.png') },
  heat: { title: 'Extreme heat', image: require('@/assets/drills/heat.png') },
};

export const companions: Record<Animal, { image: number; gear: string }> = {
  dog: {
    image: require('@/assets/drills/dog.png'),
    gear: 'Pack a familiar leash and check the contact details on your dog’s tag.',
  },
  cat: {
    image: require('@/assets/drills/cat.png'),
    gear: 'Keep a secure carrier somewhere your cat can explore before an emergency.',
  },
  snake: {
    image: require('@/assets/drills/snake.png'),
    gear: 'Plan secure transport and ask your reptile vet how to maintain suitable temperatures.',
  },
  bird: {
    image: require('@/assets/drills/bird.png'),
    gear: 'Practice using a secure travel cage and pack your bird’s usual food.',
  },
  rabbit: {
    image: require('@/assets/drills/rabbit.png'),
    gear: 'Keep a secure carrier nearby and include your rabbit’s usual food in the kit.',
  },
};

export type DrillRecord = {
  id: string;
  scenarioId: DrillHazard;
  state: { choices: string[]; animal?: Animal; edition?: Edition };
};

export type ActiveDrill = ReturnType<typeof playDrill> & {
  id: string;
  revision: number;
  scenarioId: DrillHazard;
};

export function replay(record: DrillRecord): ActiveDrill {
  return {
    id: record.id,
    scenarioId: record.scenarioId,
    revision: record.state.choices.length + 1,
    ...playDrill(record.scenarioId, record.state.choices, record.state.animal, record.state.edition),
  };
}
