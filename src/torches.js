// Torch meshes + point lights (custom, not chunk cubes)
import * as THREE from 'three';
import { BlockTypes } from './blocks.js';

const MAX_ACTIVE_LIGHTS = 12;
const LIGHT_RANGE = 10;
const LIGHT_INTENSITY_NIGHT = 1.15;
const LIGHT_INTENSITY_DAY = 0.35;

export class TorchManager {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Map<string, { group: THREE.Group, light: THREE.PointLight }>} */
    this.torches = new Map();

    world.onTorchChange = (x, y, z, on) => {
      if (on) this.add(x, y, z);
      else this.remove(x, y, z);
    };
  }

  key(x, y, z) {
    return `${x | 0},${y | 0},${z | 0}`;
  }

  add(x, y, z) {
    const k = this.key(x, y, z);
    if (this.torches.has(k)) return;

    const group = new THREE.Group();
    group.position.set(x + 0.5, y, z + 0.5);

    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.55, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b3e18 })
    );
    stick.position.y = 0.28;
    group.add(stick);

    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffaa33 })
    );
    flame.position.y = 0.58;
    flame.scale.y = 1.3;
    group.add(flame);

    const light = new THREE.PointLight(0xffaa55, LIGHT_INTENSITY_DAY, LIGHT_RANGE, 2);
    light.position.set(0, 0.6, 0);
    light.castShadow = false;
    group.add(light);

    this.scene.add(group);
    this.torches.set(k, { group, light, x, y, z });
  }

  remove(x, y, z) {
    const k = this.key(x, y, z);
    const t = this.torches.get(k);
    if (!t) return;
    this.scene.remove(t.group);
    t.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.torches.delete(k);
  }

  /** Sync from world blocks (after load) */
  rescanWorld(size = 100) {
    for (const [k] of [...this.torches]) {
      const [x, y, z] = k.split(',').map(Number);
      if (this.world.getBlock(x, y, z) !== BlockTypes.TORCH.id) this.remove(x, y, z);
    }
    // Scan overrides / loaded chunks for torches
    for (const [key, id] of this.world.overrides) {
      if (id !== BlockTypes.TORCH.id) continue;
      const [x, y, z] = key.split(',').map(Number);
      this.add(x, y, z);
    }
  }

  /**
   * Dim lights by day, bright at night; only enable closest lights for perf.
   * @param {{ x:number, y:number, z:number }} playerPos
   * @param {boolean} isNight
   */
  update(playerPos, isNight) {
    const list = [...this.torches.values()];
    list.sort((a, b) => {
      const da = (a.x - playerPos.x) ** 2 + (a.z - playerPos.z) ** 2;
      const db = (b.x - playerPos.x) ** 2 + (b.z - playerPos.z) ** 2;
      return da - db;
    });
    const intensity = isNight ? LIGHT_INTENSITY_NIGHT : LIGHT_INTENSITY_DAY;
    list.forEach((t, i) => {
      const active = i < MAX_ACTIVE_LIGHTS;
      t.light.visible = active;
      t.light.intensity = active ? intensity : 0;
    });
  }
}
