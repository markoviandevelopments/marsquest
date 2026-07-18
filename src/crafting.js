// Simple crafting recipes (survival inventory / creative free craft)

/** @typedef {{ id: string, name: string, inputs: Record<string, number>, output: string, outputCount?: number, description: string }} Recipe */

/** @type {Recipe[]} */
export const RECIPES = [
  {
    id: 'log_to_planks',
    name: 'Oak Planks',
    inputs: { WOOD: 1 },
    output: 'PLANKS',
    outputCount: 5,
    description: '1 Oak Log → 5 Oak Planks.',
  },
  {
    id: 'planks_to_sign',
    name: 'Oak Sign',
    inputs: { PLANKS: 5 },
    output: 'SIGN',
    outputCount: 1,
    description: '5 Oak Planks → 1 Sign. Place and write a message.',
  },
  {
    id: 'planks_to_torch',
    name: 'Torch',
    inputs: { PLANKS: 5 },
    output: 'TORCH',
    outputCount: 1,
    description: '5 Oak Planks → 1 Torch. Lights up the night.',
  },
  {
    id: 'planks_to_chest',
    name: 'Chest',
    inputs: { PLANKS: 10 },
    output: 'CHEST',
    outputCount: 1,
    description: '10 Oak Planks → 1 Chest. Stores up to 30 item types (unlimited stacks).',
  },
  {
    id: 'planks_to_bed',
    name: 'Bed',
    inputs: { PLANKS: 10 },
    output: 'BED',
    outputCount: 1,
    description: '10 Oak Planks → 1 Bed. Right-click at night to skip to morning for everyone.',
  },
  {
    id: 'cobble_to_furnace',
    name: 'Furnace',
    inputs: { COBBLESTONE: 8 },
    output: 'FURNACE',
    outputCount: 1,
    description: '8 Cobblestone → 1 Furnace. Fuel with Oak Log or Planks; smelt ores, sand, anacharis.',
  },
  {
    id: 'wheat_to_pretzel',
    name: 'Pretzel',
    inputs: { WHEAT: 3 },
    output: 'PRETZEL',
    outputCount: 1,
    description: '3 Wheat → 1 Pretzel. Farm wheat on grass, harvest, craft, and eat (C).',
  },
];

/**
 * @param {import('./gameMode.js').GameMode} gameMode
 * @param {Recipe} recipe
 * @returns {{ ok: boolean, message: string }}
 */
export function canCraft(gameMode, recipe) {
  if (gameMode.isCreative()) return { ok: true, message: 'Creative craft' };
  for (const [item, need] of Object.entries(recipe.inputs)) {
    if (gameMode.getCount(item) < need) {
      return {
        ok: false,
        message: `Need ${need}× ${item} (have ${gameMode.getCount(item)})`,
      };
    }
  }
  return { ok: true, message: 'OK' };
}

/**
 * @param {import('./gameMode.js').GameMode} gameMode
 * @param {Recipe} recipe
 * @returns {{ ok: boolean, message: string }}
 */
export function craft(gameMode, recipe) {
  const check = canCraft(gameMode, recipe);
  if (!check.ok) return check;
  if (gameMode.isSurvival()) {
    for (const [item, need] of Object.entries(recipe.inputs)) {
      if (!gameMode.consumeItem(item, need)) {
        return { ok: false, message: 'Not enough materials' };
      }
    }
  }
  const n = recipe.outputCount ?? 1;
  if (gameMode.isSurvival()) {
    gameMode.addItem(recipe.output, n);
  } else {
    // Creative: still grant for hotbar feedback if inventory tracking used; creative ignores counts
    gameMode.addItem(recipe.output, n);
  }
  return {
    ok: true,
    message: `Crafted ${n}× ${recipe.name}`,
  };
}
