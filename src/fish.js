// Pear Gourami fish — steady-state ~20 in water (male & female variants)
import * as THREE from 'three';
import { BlockTypes } from './blocks.js';
import { isOnEarth } from './world.js';

const FISH_TARGET = 20;
const FISH_MAX = 32;
const FISH_START = 18;
const FISH_SPEED = 1.35;

// Mean-reverting pop near 20
const BIRTH_BASE = 0.22;
const DEATH_BASE = 0.0024;

function makeGouramiMesh(male) {
  const g = new THREE.Group();

  // Pear Gourami: male more orange/red with blue iridescence; female silvery-pink, smaller fins
  const bodyColor = male ? 0xe87840 : 0xc8b0a8;
  const finColor = male ? 0x5a8fd4 : 0xb0a0a8;
  const bellyColor = male ? 0xf0c080 : 0xe8d8d0;
  const eyeColor = 0x1a1a1a;

  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const finMat = new THREE.MeshLambertMaterial({ color: finColor, side: THREE.DoubleSide });
  const bellyMat = new THREE.MeshLambertMaterial({ color: bellyColor });
  const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });

  // Body (pear-shaped)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), bodyMat);
  body.scale.set(male ? 1.35 : 1.2, male ? 0.95 : 0.9, male ? 0.75 : 0.7);
  body.position.y = 0.02;
  g.add(body);

  // Belly
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bellyMat);
  belly.scale.set(1.1, 0.7, 0.85);
  belly.position.set(0, -0.04, 0.02);
  g.add(belly);

  // Head taper
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), bodyMat);
  head.scale.set(1.0, 0.9, 0.85);
  head.position.set(0.12, 0.02, 0);
  g.add(head);

  // Eye
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), eyeMat);
  eye.position.set(0.16, 0.05, 0.06);
  g.add(eye);
  const eye2 = eye.clone();
  eye2.position.z = -0.06;
  g.add(eye2);

  // Dorsal fin (male taller / more dramatic)
  const dorsal = new THREE.Mesh(
    new THREE.ConeGeometry(male ? 0.08 : 0.05, male ? 0.2 : 0.12, 4),
    finMat
  );
  dorsal.rotation.z = Math.PI;
  dorsal.position.set(-0.02, male ? 0.16 : 0.12, 0);
  g.add(dorsal);

  // Caudal (tail) fin
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(male ? 0.1 : 0.07, male ? 0.16 : 0.12, 4),
    finMat
  );
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-0.18, 0.02, 0);
  g.add(tail);

  // Ventral filaments (male elongated)
  if (male) {
    const threadMat = new THREE.MeshLambertMaterial({ color: 0xd46040 });
    for (const z of [-0.04, 0.04]) {
      const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4), threadMat);
      thread.rotation.z = 0.9;
      thread.position.set(0.02, -0.12, z);
      g.add(thread);
    }
  } else {
    const vFin = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), finMat);
    vFin.rotation.z = 0.5;
    vFin.position.set(0.02, -0.1, 0);
    g.add(vFin);
  }

  // Pectoral fins
  for (const z of [-1, 1]) {
    const pec = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 4), finMat);
    pec.rotation.x = z * 0.9;
    pec.rotation.y = z * 0.4;
    pec.position.set(0.04, 0, z * 0.1);
    g.add(pec);
  }

  // Subtle scale
  g.scale.setScalar(male ? 1.05 : 0.92);
  return g;
}

export class FishWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Array<any>} */
    this.fish = [];
    this._spawned = false;
    this._popTimer = 0;
    this._waterCache = [];
    this._waterCacheT = 0;
  }

  isWater(x, y, z) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return id === BlockTypes.WATER.id;
  }

  /** Sample water cells on Earth for spawning */
  refreshWaterCache() {
    this._waterCache = [];
    // Scan a subset of the map for water columns (ponds)
    for (let i = 0; i < 400 && this._waterCache.length < 120; i++) {
      const { x, z } = this.world.randomBlockXZ();
      for (let y = 1; y < 24; y++) {
        if (this.isWater(x + 0.5, y, z + 0.5)) {
          this._waterCache.push({ x: x + 0.5, y: y + 0.4, z: z + 0.5 });
        }
      }
    }
  }

  pickWaterPos() {
    if (this._waterCache.length === 0) this.refreshWaterCache();
    if (this._waterCache.length === 0) return null;
    // Prefer still-valid water
    for (let attempt = 0; attempt < 12; attempt++) {
      const p = this._waterCache[Math.floor(Math.random() * this._waterCache.length)];
      if (this.isWater(p.x, p.y, p.z)) return { ...p };
    }
    this.refreshWaterCache();
    if (this._waterCache.length === 0) return null;
    return { ...this._waterCache[Math.floor(Math.random() * this._waterCache.length)] };
  }

  ensureSpawned() {
    if (this._spawned) return;
    this._spawned = true;
    this.refreshWaterCache();
    for (let i = 0; i < FISH_START; i++) this.spawnFish();
  }

  spawnFish(male = Math.random() < 0.45) {
    if (this.fish.length >= FISH_MAX) return null;
    const pos = this.pickWaterPos();
    if (!pos) return null;

    const mesh = makeGouramiMesh(male);
    const f = {
      male,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: Math.random() * Math.PI * 2,
      pitch: 0,
      speed: FISH_SPEED * (0.7 + Math.random() * 0.5),
      turnT: Math.random() * 2,
      bob: Math.random() * Math.PI * 2,
      mesh,
    };
    mesh.position.set(f.x, f.y, f.z);
    this.scene.add(mesh);
    this.fish.push(f);
    return f;
  }

  removeAt(i) {
    if (i < 0 || i >= this.fish.length) return;
    const f = this.fish[i];
    this.scene.remove(f.mesh);
    f.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.fish.splice(i, 1);
  }

  tickPopulation(dt) {
    const n = this.fish.length;
    if (n < FISH_MAX) {
      const slack = Math.max(0, (FISH_TARGET + 4 - n) / FISH_TARGET);
      const birthRate = BIRTH_BASE * Math.max(0.1, slack);
      if (Math.random() < birthRate * dt) this.spawnFish();
    }
    const nNow = this.fish.length;
    if (nNow > 0) {
      const pressure = 0.5 + nNow / FISH_TARGET;
      const deathPer = DEATH_BASE * pressure;
      for (let i = this.fish.length - 1; i >= 0; i--) {
        if (Math.random() < deathPer * dt) this.removeAt(i);
      }
    }
    if (this.fish.length === 0 && Math.random() < 0.5 * dt) this.spawnFish();
  }

  update(dt) {
    this.ensureSpawned();
    this._waterCacheT += dt;
    if (this._waterCacheT > 12) {
      this._waterCacheT = 0;
      this.refreshWaterCache();
    }
    this.tickPopulation(dt);

    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      f.turnT -= dt;
      f.bob += dt * 3;

      if (f.turnT <= 0) {
        f.turnT = 0.8 + Math.random() * 2.2;
        f.yaw += (Math.random() - 0.5) * 1.8;
        f.pitch = (Math.random() - 0.5) * 0.5;
      }

      const spd = f.speed;
      const dx = Math.cos(f.yaw) * Math.cos(f.pitch) * spd * dt;
      const dy = Math.sin(f.pitch) * spd * dt * 0.6;
      const dz = Math.sin(f.yaw) * Math.cos(f.pitch) * spd * dt;

      const nx = f.x + dx;
      const ny = f.y + dy;
      const nz = f.z + dz;

      if (this.isWater(nx, ny, nz)) {
        f.x = nx;
        f.y = ny;
        f.z = nz;
      } else {
        // Bounce / find water
        f.yaw += Math.PI * 0.6 + (Math.random() - 0.5);
        f.pitch *= -0.5;
        // If stranded, teleport to water
        if (!this.isWater(f.x, f.y, f.z)) {
          const p = this.pickWaterPos();
          if (p) {
            f.x = p.x;
            f.y = p.y;
            f.z = p.z;
          } else {
            this.removeAt(i);
            continue;
          }
        }
      }

      const cl = this.world.clampXZ(f.x, f.z, 0.3);
      f.x = cl.x;
      f.z = cl.z;

      f.mesh.position.set(f.x, f.y + Math.sin(f.bob) * 0.03, f.z);
      f.mesh.rotation.y = -f.yaw + Math.PI / 2;
      f.mesh.rotation.x = f.pitch * 0.5;
    }
  }

  count() {
    return this.fish.length;
  }

  stats() {
    let males = 0;
    let females = 0;
    for (const f of this.fish) {
      if (f.male) males++;
      else females++;
    }
    return { total: this.fish.length, males, females };
  }

  setVisible(visible) {
    for (const f of this.fish) f.mesh.visible = visible;
  }
}
