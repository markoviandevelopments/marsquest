// LED Block visuals: emissive tint + point light when powered by a Code Block face
import * as THREE from 'three';
import { BlockTypes } from './blocks.js';

const MAX_ACTIVE_LIGHTS = 16;
const LIGHT_RANGE = 8;

export class LedManager {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Map<string, { group: THREE.Group, light: THREE.PointLight, mat: THREE.MeshBasicMaterial, color: number, lit: boolean, x:number, y:number, z:number }>} */
    this.leds = new Map();
  }

  key(x, y, z) {
    return `${x | 0},${y | 0},${z | 0}`;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} color hex 0xRRGGBB
   * @param {boolean} lit
   */
  set(x, y, z, color, lit) {
    const k = this.key(x, y, z);
    let entry = this.leds.get(k);
    const col = (color | 0) & 0xffffff;
    if (!entry) {
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: lit ? 0.85 : 0.25,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);

      const light = new THREE.PointLight(col, 0, LIGHT_RANGE, 2);
      light.position.set(x + 0.5, y + 0.5, z + 0.5);
      light.castShadow = false;

      const group = new THREE.Group();
      group.add(mesh);
      this.scene.add(group);
      this.scene.add(light);

      entry = { group, light, mat, mesh, color: col, lit: !!lit, x: x | 0, y: y | 0, z: z | 0 };
      this.leds.set(k, entry);
    } else {
      entry.color = col;
      entry.mat.color.setHex(col);
      entry.light.color.setHex(col);
    }
    entry.lit = !!lit;
    entry.mat.opacity = entry.lit ? 0.9 : 0.22;
    entry.light.intensity = entry.lit ? 1.2 : 0;
    this._budgetLights();
  }

  remove(x, y, z) {
    const k = this.key(x, y, z);
    const e = this.leds.get(k);
    if (!e) return;
    this.scene.remove(e.group);
    this.scene.remove(e.light);
    e.mat.dispose();
    e.mesh.geometry.dispose();
    this.leds.delete(k);
  }

  /** Apply a batch of led_state updates */
  applyStates(leds) {
    if (!Array.isArray(leds)) return;
    for (const l of leds) {
      if (!l) continue;
      if (l.removed) {
        this.remove(l.x, l.y, l.z);
        continue;
      }
      this.set(l.x, l.y, l.z, l.color ?? 0xff0000, !!l.lit);
    }
  }

  /** After world load: create entries for LED blocks in overrides */
  rescanWorld() {
    // Drop LEDs that no longer exist as blocks
    for (const [k, e] of [...this.leds]) {
      if (this.world.getBlock(e.x, e.y, e.z) !== BlockTypes.LED.id) {
        this.remove(e.x, e.y, e.z);
      }
    }
    for (const [key, id] of this.world.overrides) {
      if (id !== BlockTypes.LED.id) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!this.leds.has(key)) {
        this.set(x, y, z, 0xff0000, false);
      }
    }
  }

  _budgetLights() {
    // Only the nearest-ish lit LEDs keep full intensity (cap GPU lights)
    const lit = [...this.leds.values()].filter((e) => e.lit);
    if (lit.length <= MAX_ACTIVE_LIGHTS) return;
    // Sort by key for stability; dim extras
    lit.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
    lit.forEach((e, i) => {
      e.light.intensity = i < MAX_ACTIVE_LIGHTS ? 1.2 : 0;
    });
  }

  update(_playerPos) {
    // reserved for distance culling later
  }
}
