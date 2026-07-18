// Disk persistence for shared multiplayer world state
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = path.resolve(__dirname, '../data');
const SAVE_PATH = path.join(SAVE_DIR, 'world-save.json');
const MARS_LEGACY_PATH = path.join(SAVE_DIR, 'mars-save.json');

/** Mars layer base (must match client src/world.js MARS_Y_MIN) */
export const MARS_Y_MIN = -200;

/**
 * @typedef {object} WorldSave
 * @property {number} version
 * @property {Array<{x:number,y:number,z:number,block:string}>} blocks
 * @property {Array<{x:number,y:number,z:number,text:string,facing:number}>} signs
 * @property {Array<{x:number,y:number,z:number,items:Record<string,number>}>} [chests]
 * @property {object|null} critters
 * @property {object|null} time
 * @property {number} savedAt
 */

export function getSavePath() {
  return SAVE_PATH;
}

/** @returns {Promise<WorldSave|null>} */
export async function loadWorldSave() {
  try {
    if (!existsSync(SAVE_PATH)) return null;
    const raw = await readFile(SAVE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (e) {
    console.error('[save] load failed:', e.message);
    return null;
  }
}

/**
 * One-time merge of legacy separate mars-save.json into the unified world.
 * Old Mars used earth-like Y (0–63); remap to MARS_Y_MIN + y.
 * Critters/signs from mars file are dropped (they belonged on Earth only).
 */
export async function migrateLegacyMarsSave(blockOverrides) {
  try {
    if (!existsSync(MARS_LEGACY_PATH)) return 0;
    const raw = await readFile(MARS_LEGACY_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.blocks)) return 0;
    let n = 0;
    for (const b of data.blocks) {
      if (!b || typeof b.block !== 'string') continue;
      // Skip pure terrain platform seeds if already generated; still import player builds
      const y = (b.y | 0) + MARS_Y_MIN;
      if (y < MARS_Y_MIN || y >= 0) continue;
      const key = `${b.x | 0},${y},${b.z | 0}`;
      // Don't overwrite earth blocks (y>=0 already skipped)
      if (!blockOverrides.has(key)) {
        blockOverrides.set(key, b.block);
        n++;
      }
    }
    if (n > 0) {
      console.log(`[save] migrated ${n} legacy Mars blocks into unified world (y += ${MARS_Y_MIN})`);
    }
    // Rename so we don't re-import
    const done = MARS_LEGACY_PATH + '.migrated';
    await writeFile(done, raw);
    await writeFile(MARS_LEGACY_PATH, JSON.stringify({
      migrated: true,
      note: 'Mars is now y≈-200 in world-save.json; this file is obsolete.',
      at: Date.now(),
    }));
    return n;
  } catch (e) {
    console.error('[save] mars migrate failed:', e.message);
    return 0;
  }
}

/**
 * @param {WorldSave} data
 */
export async function saveWorldSave(data) {
  try {
    await mkdir(SAVE_DIR, { recursive: true });
    const payload = {
      version: 2,
      layout: 'earth_y0_mars_y-200',
      savedAt: Date.now(),
      ...data,
    };
    await writeFile(SAVE_PATH, JSON.stringify(payload), 'utf-8');
  } catch (e) {
    console.error('[save] write failed:', e.message);
  }
}
