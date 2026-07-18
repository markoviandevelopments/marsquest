// Furnace: fuel (oak log / planks) + smelt ores, sand, anacharis
import { BlockTypes } from './blocks.js';

/** Seconds of burn per fuel item */
export const FUEL_SECONDS = {
  WOOD: 8,
  PLANKS: 4,
};

/** input type → { output, cookSeconds } */
export const SMELT_RECIPES = {
  ANACHARIS: { output: 'COOKED_ANACHARIS', cookSeconds: 4 },
  IRON_ORE: { output: 'IRON_INGOT', cookSeconds: 6 },
  GOLD_ORE: { output: 'GOLD_INGOT', cookSeconds: 6 },
  COAL_ORE: { output: 'COAL', cookSeconds: 5 },
  RUST_ORE: { output: 'IRON_INGOT', cookSeconds: 7 },
  SAND: { output: 'GLASS', cookSeconds: 5 },
  MARS_METEORITE: { output: 'IRON_INGOT', cookSeconds: 8 },
};

/**
 * @typedef {{
 *   fuelType: string|null,
 *   fuelCount: number,
 *   burnLeft: number,
 *   inputType: string|null,
 *   inputCount: number,
 *   outputType: string|null,
 *   outputCount: number,
 *   cookProgress: number,
 * }} FurnaceState
 */

export function emptyFurnace() {
  return {
    fuelType: null,
    fuelCount: 0,
    burnLeft: 0,
    inputType: null,
    inputCount: 0,
    outputType: null,
    outputCount: 0,
    cookProgress: 0,
  };
}

export function furnaceKey(x, y, z) {
  return `${x | 0},${y | 0},${z | 0}`;
}

/**
 * @param {import('./world.js').World} world
 * @returns {FurnaceState}
 */
export function getFurnace(world, x, y, z) {
  if (!world.furnaces) world.furnaces = new Map();
  const k = furnaceKey(x, y, z);
  let f = world.furnaces.get(k);
  if (!f) {
    f = emptyFurnace();
    world.furnaces.set(k, f);
  }
  return f;
}

export function removeFurnace(world, x, y, z) {
  if (!world.furnaces) return;
  world.furnaces.delete(furnaceKey(x, y, z));
}

export function isFuel(type) {
  return type === 'WOOD' || type === 'PLANKS';
}

export function canSmelt(type) {
  return !!(type && SMELT_RECIPES[type]);
}

/**
 * Advance one furnace by dt seconds.
 * @param {FurnaceState} f
 * @param {number} dt
 * @returns {boolean} true if state changed meaningfully
 */
export function tickFurnace(f, dt) {
  if (!f || dt <= 0) return false;
  let changed = false;

  const recipe = f.inputType ? SMELT_RECIPES[f.inputType] : null;
  const canOutput =
    recipe &&
    f.inputCount > 0 &&
    (f.outputCount === 0 || f.outputType === recipe.output);

  // Consume fuel if burning needed
  if (canOutput && f.burnLeft <= 0 && f.fuelCount > 0 && isFuel(f.fuelType)) {
    f.burnLeft = FUEL_SECONDS[f.fuelType] || 4;
    f.fuelCount -= 1;
    if (f.fuelCount <= 0) {
      f.fuelCount = 0;
      f.fuelType = null;
    }
    changed = true;
  }

  if (canOutput && f.burnLeft > 0) {
    f.burnLeft = Math.max(0, f.burnLeft - dt);
    f.cookProgress += dt;
    changed = true;
    const need = recipe.cookSeconds || 5;
    if (f.cookProgress >= need) {
      // Produce one output
      f.cookProgress = 0;
      f.inputCount -= 1;
      if (f.inputCount <= 0) {
        f.inputCount = 0;
        f.inputType = null;
      }
      f.outputType = recipe.output;
      f.outputCount = (f.outputCount || 0) + 1;
      changed = true;
    }
  } else if (!canOutput) {
    if (f.cookProgress !== 0) {
      f.cookProgress = 0;
      changed = true;
    }
    // Still burn down leftover fuel without cooking
    if (f.burnLeft > 0 && !canOutput) {
      f.burnLeft = Math.max(0, f.burnLeft - dt * 0.25);
      changed = true;
    }
  }

  return changed;
}

/**
 * Tick all furnaces in the world (slow cook even when UI closed).
 * @param {import('./world.js').World} world
 * @param {number} dt
 */
export function tickAllFurnaces(world, dt) {
  if (!world.furnaces) return;
  for (const f of world.furnaces.values()) {
    tickFurnace(f, dt);
  }
}

/**
 * @param {FurnaceState} f
 * @param {string} type
 * @param {number} n
 * @returns {boolean}
 */
export function depositFuel(f, type, n = 1) {
  if (!isFuel(type) || n <= 0) return false;
  if (f.fuelType && f.fuelType !== type && f.fuelCount > 0) return false;
  f.fuelType = type;
  f.fuelCount += n;
  return true;
}

/**
 * @param {FurnaceState} f
 * @param {string} type
 * @param {number} n
 * @returns {boolean}
 */
export function depositInput(f, type, n = 1) {
  if (!canSmelt(type) || n <= 0) return false;
  if (f.inputType && f.inputType !== type && f.inputCount > 0) return false;
  f.inputType = type;
  f.inputCount += n;
  return true;
}

/**
 * Take output into inventory callback.
 * @returns {{ type: string, count: number } | null}
 */
export function takeOutput(f) {
  if (!f.outputType || f.outputCount <= 0) return null;
  const type = f.outputType;
  const count = f.outputCount;
  f.outputType = null;
  f.outputCount = 0;
  return { type, count };
}

export function itemName(type) {
  return BlockTypes[type]?.name || type || '—';
}

/**
 * Render furnace UI HTML.
 * @param {FurnaceState} f
 */
export function renderFurnaceUI(f) {
  const recipe = f.inputType ? SMELT_RECIPES[f.inputType] : null;
  const need = recipe?.cookSeconds || 1;
  const pct = Math.min(100, Math.floor((f.cookProgress / need) * 100));
  const burning = f.burnLeft > 0;

  return `
    <p class="furnace-hint">
      Fuel: <b>Oak Log</b> or <b>Oak Planks</b>. Smelts ores → metals, sand → glass, anacharis → cooked.
    </p>
    <div class="furnace-grid">
      <div class="furnace-slot" data-slot="fuel">
        <div class="furnace-slot-label">Fuel ${burning ? '🔥' : ''}</div>
        <div class="furnace-slot-item">${f.fuelCount > 0 ? `${itemName(f.fuelType)} ×${f.fuelCount}` : 'empty'}</div>
        <div class="furnace-slot-sub">${f.burnLeft > 0 ? `Burn ${f.burnLeft.toFixed(1)}s` : ''}</div>
      </div>
      <div class="furnace-arrow">→</div>
      <div class="furnace-slot" data-slot="input">
        <div class="furnace-slot-label">Cook</div>
        <div class="furnace-slot-item">${f.inputCount > 0 ? `${itemName(f.inputType)} ×${f.inputCount}` : 'empty'}</div>
        <div class="furnace-progress"><div class="furnace-progress-bar" style="width:${pct}%"></div></div>
      </div>
      <div class="furnace-arrow">→</div>
      <div class="furnace-slot" data-slot="output">
        <div class="furnace-slot-label">Result</div>
        <div class="furnace-slot-item">${f.outputCount > 0 ? `${itemName(f.outputType)} ×${f.outputCount}` : 'empty'}</div>
      </div>
    </div>
    <div class="furnace-actions">
      <button type="button" data-act="add-fuel">+ Fuel (selected hotbar)</button>
      <button type="button" data-act="add-input">+ Item to cook</button>
      <button type="button" data-act="take-output">Take result</button>
    </div>
  `;
}
