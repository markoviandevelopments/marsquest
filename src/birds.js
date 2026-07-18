// Birds — fly around above the Earth surface. Steady-state population ~20.
// Free 3D wandering (like fish, but in air instead of water), with
// mean-reverting births/deaths so the flock settles near BIRD_TARGET.
import * as THREE from 'three';
import { BlockTypes } from './blocks.js';
import { isOnEarth } from './world.js';

const BIRD_TARGET = 20;       // steady-state population target
const BIRD_MAX = 34;          // hard cap
const BIRD_START = 18;        // initial flock near target
const BIRD_SPEED = 2.4;       // a bit faster than ground critters
const BIRD_MIN_HEIGHT = 3;    // stay at least this many blocks above surface
const BIRD_MAX_HEIGHT = 22;   // ceiling for wandering

// Mean-reverting rates (tuned so E[births] ≈ E[deaths] near TARGET)
const BIRTH_BASE = 0.22;
const DEATH_BASE = 0.0024;

// A few simple bird color variants
const BIRD_COLORS = [
  0x2c3e50, // dark slate
  0x8e44ad, // purple
  0x16a085, // teal
  0xc0392b, // red
  0x2980b9, // blue
  0xd35400, // orange
  0x7f8c8d, // grey
];

function makeBirdMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const wingMat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const beakMat = new THREE.MeshLambertMaterial({ color: 0xf1c40f });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  // Body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), bodyMat);
  body.scale.set(1.0, 0.8, 1.5);
  g.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), bodyMat);
  head.position.set(0, 0.05, 0.18);
  g.add(head);

  // Beak
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.04, 0.28);
  g.add(beak);

  // Eyes
  for (const z of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), eyeMat);
    eye.position.set(0.05, 0.08, 0.2 + z * 0.04);
    g.add(eye);
  }

  // Wings (pivot at body so we can flap)
  const wingGeo = new THREE.BoxGeometry(0.04, 0.02, 0.22);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(-0.12, 0.02, 0);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.position.set(0.12, 0.02, 0);
  g.add(wingL, wingR);
  g.userData.wingL = wingL;
  g.userData.wingR = wingR;

  // Tail
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.12), bodyMat);
  tail.position.set(0, 0, -0.22);
  g.add(tail);

  return g;
}

export class BirdWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Array<any>} */
    this.birds = [];
    this._spawned = false;
    this._popTimer = 0;
  }

  /** Height above the surface a bird should fly at (randomized per spawn). */
  flyHeight(wx, wz) {
    const surf = this.world.getSurfaceHeight(Math.floor(wx), Math.floor(wz), 'earth');
    const h = BIRD_MIN_HEIGHT + Math.random() * (BIRD_MAX_HEIGHT - BIRD_MIN_HEIGHT);
    return surf + h;
  }

  ensureSpawned() {
    if (this._spawned) return;
    this._spawned = true;
    for (let i = 0; i < BIRD_START; i++) this.spawnBird();
  }

  spawnBird() {
    if (this.birds.length >= BIRD_MAX) return null;
    const { x, z } = this.world.randomPosXZ();
    const y = this.flyHeight(x, z);
    const color = BIRD_COLORS[Math.floor(Math.random() * BIRD_COLORS.length)];
    const mesh = makeBirdMesh(color);
    const b = {
      x,
      y,
      z,
      yaw: Math.random() * Math.PI * 2,
      pitch: (Math.random() - 0.5) * 0.3,
      speed: BIRD_SPEED * (0.7 + Math.random() * 0.5),
      turnT: Math.random() * 2,
      flap: Math.random() * Math.PI * 2,
      mesh,
    };
    mesh.position.set(b.x, b.y, b.z);
    this.scene.add(mesh);
    this.birds.push(b);
    return b;
  }

  removeAt(i) {
    if (i < 0 || i >= this.birds.length) return;
    const b = this.birds[i];
    this.scene.remove(b.mesh);
    b.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.birds.splice(i, 1);
  }

  tickPopulation(dt) {
    const n = this.birds.length;
    if (n < BIRD_MAX) {
      const slack = Math.max(0, (BIRD_TARGET + 4 - n) / BIRD_TARGET);
      const birthRate = BIRTH_BASE * Math.max(0.1, slack);
      if (Math.random() < birthRate * dt) this.spawnBird();
    }
    const nNow = this.birds.length;
    if (nNow > 0) {
      const pressure = 0.5 + nNow / BIRD_TARGET;
      const deathPer = DEATH_BASE * pressure;
      for (let i = this.birds.length - 1; i >= 0; i--) {
        if (Math.random() < deathPer * dt) this.removeAt(i);
      }
    }
    // Soft rescue if the flock collapses
    if (this.birds.length === 0 && Math.random() < 0.5 * dt) this.spawnBird();
  }

  update(dt) {
    this.ensureSpawned();
    this.tickPopulation(dt);

    for (const b of this.birds) {
      b.turnT -= dt;
      b.flap += dt * 14;

      if (b.turnT <= 0) {
        b.turnT = 0.8 + Math.random() * 2.2;
        b.yaw += (Math.random() - 0.5) * 1.6;
        b.pitch = (Math.random() - 0.5) * 0.5;
      }

      const spd = b.speed;
      const dx = Math.cos(b.yaw) * Math.cos(b.pitch) * spd * dt;
      const dy = Math.sin(b.pitch) * spd * dt * 0.6;
      const dz = Math.sin(b.yaw) * Math.cos(b.pitch) * spd * dt;

      let nx = b.x + dx;
      let ny = b.y + dy;
      let nz = b.z + dz;

      // Keep birds above the surface and below the ceiling
      const surf = this.world.getSurfaceHeight(Math.floor(nx), Math.floor(nz), 'earth');
      const minY = surf + BIRD_MIN_HEIGHT;
      const maxY = surf + BIRD_MAX_HEIGHT;
      if (ny < minY) {
        ny = minY;
        b.pitch = Math.abs(b.pitch) * 0.5; // climb
      } else if (ny > maxY) {
        ny = maxY;
        b.pitch = -Math.abs(b.pitch) * 0.5; // descend
      }

      // World border clamp (100×100)
      const cl = this.world.clampXZ(nx, nz, 0.3);
      b.x = cl.x;
      b.y = ny;
      b.z = cl.z;

      // Wing flap animation
      const flapAngle = Math.sin(b.flap) * 0.9;
      if (b.mesh.userData.wingL) b.mesh.userData.wingL.rotation.z = flapAngle;
      if (b.mesh.userData.wingR) b.mesh.userData.wingR.rotation.z = -flapAngle;

      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.y = -b.yaw + Math.PI / 2;
      b.mesh.rotation.x = b.pitch * 0.5;
    }
  }

  setVisible(visible) {
    for (const b of this.birds) b.mesh.visible = visible;
  }

  count() {
    return this.birds.length;
  }

  stats() {
    return { total: this.birds.length };
  }
}
