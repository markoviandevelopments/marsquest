// Creative vs Survival: health, hunger, inventory
import { BlockTypes, BlockIdToType } from './blocks.js';

export const MODE_CREATIVE = 'creative';
export const MODE_SURVIVAL = 'survival';

export const MAX_HEALTH = 10;
export const MAX_HUNGER = 10;
export const HUNGER_DRAIN_SECONDS = 4 * 60; // 1 hunger every 4 minutes
export const CHEESE_HEAL_HUNGER = 3; // eating a cheese wedge
/** @deprecated use CHEESE_HEAL_HUNGER */
export const NUGGET_HEAL_HUNGER = CHEESE_HEAL_HUNGER;
export const FALL_DAMAGE_THRESHOLD = 4; // blocks fallen before damage
/** Inventory key for food from chickens */
export const FOOD_ITEM = 'CHEESE';

/** Blocks that cannot be collected / placed as inventory in survival */
const NON_INVENTORY = new Set(['AIR', 'BEDROCK', 'WATER']);

export class GameMode {
  constructor() {
    this.mode = MODE_CREATIVE;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    /** @type {Map<string, number>} block type name -> count; special key CHEESE for food */
    this.inventory = new Map();
    this.hungerTimer = 0;
    this._fallStartY = null;
    this.onGameOver = null;
    this.onChange = null;
    this.dead = false;
  }

  isCreative() {
    return this.mode === MODE_CREATIVE;
  }

  isSurvival() {
    return this.mode === MODE_SURVIVAL;
  }

  notify() {
    if (this.onChange) this.onChange();
  }

  setMode(mode) {
    if (mode === MODE_SURVIVAL) {
      this.mode = MODE_SURVIVAL;
      this.health = MAX_HEALTH;
      this.hunger = MAX_HUNGER;
      this.hungerTimer = 0;
      this.dead = false;
      this.inventory.clear(); // start with nothing
      this.notify();
      return 'Survival mode — mine blocks, watch health & hunger. Chickens drop cheese (E to eat).';
    }
    if (mode === MODE_CREATIVE) {
      this.mode = MODE_CREATIVE;
      this.dead = false;
      this.health = MAX_HEALTH;
      this.hunger = MAX_HUNGER;
      this.notify();
      return 'Creative mode — unlimited blocks, no health/hunger.';
    }
    return 'Unknown mode';
  }

  getCount(type) {
    if (this.isCreative()) return Infinity;
    // Legacy inventory key
    if (type === FOOD_ITEM || type === 'CHEESE') {
      return (this.inventory.get(FOOD_ITEM) || 0) + (this.inventory.get('NUGGET') || 0);
    }
    return this.inventory.get(type) || 0;
  }

  addItem(type, n = 1) {
    if (!type || type === 'AIR' || type === 'BEDROCK') return;
    if (this.isCreative()) return;
    // Normalize food drops
    if (type === 'NUGGET') type = FOOD_ITEM;
    const cur = this.inventory.get(type) || 0;
    this.inventory.set(type, cur + n);
    this.notify();
  }

  /** @returns {boolean} whether consume succeeded */
  consumeItem(type, n = 1) {
    if (this.isCreative()) return true;
    if (type === 'NUGGET') type = FOOD_ITEM;
    // Prefer CHEESE, fall back to legacy NUGGET stack
    if (type === FOOD_ITEM) {
      const cheese = this.inventory.get(FOOD_ITEM) || 0;
      const legacy = this.inventory.get('NUGGET') || 0;
      if (cheese + legacy < n) return false;
      let left = n;
      if (cheese > 0) {
        const take = Math.min(cheese, left);
        if (cheese === take) this.inventory.delete(FOOD_ITEM);
        else this.inventory.set(FOOD_ITEM, cheese - take);
        left -= take;
      }
      if (left > 0) {
        if (legacy === left) this.inventory.delete('NUGGET');
        else this.inventory.set('NUGGET', legacy - left);
      }
      this.notify();
      return true;
    }
    const cur = this.inventory.get(type) || 0;
    if (cur < n) return false;
    if (cur === n) this.inventory.delete(type);
    else this.inventory.set(type, cur - n);
    this.notify();
    return true;
  }

  canPlace(type) {
    if (this.isCreative()) return true;
    return this.getCount(type) > 0;
  }

  /** Called when a block is successfully broken — grant drop */
  onMined(blockTypeKey) {
    if (this.isCreative()) return;
    if (!blockTypeKey || blockTypeKey === 'AIR' || blockTypeKey === 'BEDROCK') return;
    // Liquids don't drop
    const t = BlockTypes[blockTypeKey];
    if (t?.liquid) return;
    this.addItem(blockTypeKey, 1);
  }

  /** Eat one cheese wedge from inventory */
  eatCheese() {
    if (!this.isSurvival() || this.dead) return false;
    if (!this.consumeItem(FOOD_ITEM, 1)) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + CHEESE_HEAL_HUNGER);
    this.notify();
    return true;
  }

  /**
   * Eat food: pretzel → cooked anacharis → cheese.
   * @returns {{ ok: boolean, food?: string, heal?: number }}
   */
  eatFood() {
    if (!this.isSurvival() || this.dead) return { ok: false };
    const foods = ['PRETZEL', 'COOKED_ANACHARIS'];
    for (const key of foods) {
      if (this.getCount(key) > 0) {
        if (!this.consumeItem(key, 1)) continue;
        const heal = BlockTypes[key]?.foodHeal ?? 2;
        this.hunger = Math.min(MAX_HUNGER, this.hunger + heal);
        this.notify();
        return { ok: true, food: key, heal };
      }
    }
    if (this.eatCheese()) {
      return { ok: true, food: 'CHEESE', heal: CHEESE_HEAL_HUNGER };
    }
    return { ok: false };
  }

  /** @deprecated use eatCheese */
  eatNugget() {
    return this.eatCheese();
  }

  takeDamage(amount) {
    if (!this.isSurvival() || this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.notify();
    if (this.health <= 0) this.triggerGameOver('You ran out of hearts!');
  }

  update(dt, playerY) {
    if (!this.isSurvival() || this.dead) {
      this._fallStartY = playerY;
      return;
    }

    // Hunger drain: 1 point every 4 minutes
    this.hungerTimer += dt;
    if (this.hungerTimer >= HUNGER_DRAIN_SECONDS) {
      const steps = Math.floor(this.hungerTimer / HUNGER_DRAIN_SECONDS);
      this.hungerTimer -= steps * HUNGER_DRAIN_SECONDS;
      this.hunger = Math.max(0, this.hunger - steps);
      this.notify();
      if (this.hunger <= 0) {
        this.triggerGameOver('You starved!');
        return;
      }
    }

    // Simple fall damage
    if (playerY != null) {
      if (this._fallStartY == null) this._fallStartY = playerY;
      // track peak when rising
      if (playerY > this._fallStartY) this._fallStartY = playerY;
    }
  }

  /** Call when player lands (onGround became true) */
  onLanded(playerY) {
    if (!this.isSurvival() || this.dead) {
      this._fallStartY = playerY;
      return;
    }
    if (this._fallStartY != null) {
      const fallen = this._fallStartY - playerY;
      if (fallen > FALL_DAMAGE_THRESHOLD) {
        const dmg = Math.floor(fallen - FALL_DAMAGE_THRESHOLD);
        if (dmg > 0) this.takeDamage(dmg);
      }
    }
    this._fallStartY = playerY;
  }

  triggerGameOver(reason) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.notify();
    if (this.onGameOver) this.onGameOver(reason || 'Game over');
  }

  /** Respawn after game over — empty inventory, full vitals, world untouched */
  respawn() {
    this.dead = false;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.hungerTimer = 0;
    this.inventory.clear();
    this._fallStartY = null;
    this.notify();
  }

  serialize() {
    return {
      mode: this.mode,
      health: this.health,
      hunger: this.hunger,
      hungerTimer: this.hungerTimer,
      inventory: Object.fromEntries(this.inventory),
      dead: this.dead,
    };
  }

  loadState(data) {
    if (!data) return;
    if (data.mode === MODE_SURVIVAL || data.mode === MODE_CREATIVE) this.mode = data.mode;
    if (typeof data.health === 'number') this.health = data.health;
    if (typeof data.hunger === 'number') this.hunger = data.hunger;
    if (typeof data.hungerTimer === 'number') this.hungerTimer = data.hungerTimer;
    this.inventory.clear();
    if (data.inventory && typeof data.inventory === 'object') {
      for (const [k, v] of Object.entries(data.inventory)) {
        if (typeof v === 'number' && v > 0) this.inventory.set(k, v);
      }
    }
    this.dead = !!data.dead;
    this.notify();
  }
}

export function dropNameFromBlockId(id) {
  return BlockIdToType[id] || null;
}
