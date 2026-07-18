// Chickens — kill for cheese wedges (survival food)
// Population: random births & deaths that settle near ~20 birds.
import * as THREE from 'three';

const CHICKEN_TARGET = 20;       // steady-state population target
const CHICKEN_MAX = 36;          // hard cap
const CHICKEN_START = 18;        // initial flock near target
const CHICKEN_SPEED = 1.1;
const CHICKEN_GRAVITY = 22;
const ATTACK_RANGE = 2.8;

// Mean-reverting rates (tuned so E[births] ≈ E[deaths] near TARGET)
// births/sec ≈ BIRTH_BASE * max(0, (TARGET + slack - n) / TARGET)
// deaths/sec ≈ n * DEATH_BASE * (0.5 + n / TARGET)
const BIRTH_BASE = 0.28;         // ~0.07 births/s at n=20
const DEATH_BASE = 0.0028;       // ~0.08 deaths/s total at n=20

function makeChickenMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f0 });
  const combMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
  const beakMat = new THREE.MeshLambertMaterial({ color: 0xf39c12 });
  const legMat = new THREE.MeshLambertMaterial({ color: 0xe67e22 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bodyMat);
  body.scale.set(1.1, 0.9, 1.3);
  body.position.y = 0.22;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), bodyMat);
  head.position.set(0, 0.38, 0.16);
  group.add(head);

  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.1), combMat);
  comb.position.set(0, 0.48, 0.16);
  group.add(comb);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 4), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.36, 0.26);
  group.add(beak);

  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 4), legMat);
  legL.position.set(-0.06, 0.08, 0.02);
  const legR = legL.clone();
  legR.position.x = 0.06;
  group.add(legL, legR);

  return group;
}

export class ChickenWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Array<any>} */
    this.chickens = [];
    this._spawned = false;
    this._popTimer = 0;
  }

  ensureSpawned() {
    if (this._spawned) return;
    this._spawned = true;
    for (let i = 0; i < CHICKEN_START; i++) {
      const { x, z } = this.world.randomPosXZ();
      this.spawnChicken(x, z);
    }
  }

  spawnChicken(wx, wz) {
    if (this.chickens.length >= CHICKEN_MAX) return null;
    const clamped = this.world.clampXZ(wx, wz, 0.5);
    const surf = this.world.getSurfaceHeight(Math.floor(clamped.x), Math.floor(clamped.z));
    const mesh = makeChickenMesh();
    const c = {
      x: clamped.x,
      y: surf,
      z: clamped.z,
      yaw: Math.random() * Math.PI * 2,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      wanderT: 0,
      hopCd: Math.random(),
      mesh,
    };
    mesh.position.set(c.x, c.y, c.z);
    this.scene.add(mesh);
    this.chickens.push(c);
    return c;
  }

  removeChickenAt(index) {
    if (index < 0 || index >= this.chickens.length) return;
    const c = this.chickens[index];
    this.scene.remove(c.mesh);
    c.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.chickens.splice(index, 1);
  }

  isSolid(x, y, z) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const t = this.world.getBlockType(id);
    return !!(t && t.solid && !t.liquid);
  }

  /**
   * Density-dependent births & deaths aiming for ~CHICKEN_TARGET birds.
   * Uses Poisson-ish Bernoulli trials each frame from continuous rates.
   */
  tickPopulation(dt) {
    const n = this.chickens.length;

    // Births: more when below target, rare trickle near/above target, none at hard max
    if (n < CHICKEN_MAX) {
      const slack = Math.max(0, (CHICKEN_TARGET + 4 - n) / CHICKEN_TARGET);
      // floor so population never fully dies out
      const birthRate = BIRTH_BASE * Math.max(0.08, slack);
      if (Math.random() < birthRate * dt) {
        const { x, z } = this.world.randomPosXZ();
        this.spawnChicken(x, z);
      }
    }

    // Deaths: each bird has a small chance; rises as population exceeds target
    const nNow = this.chickens.length;
    if (nNow > 0) {
      const pressure = 0.45 + nNow / CHICKEN_TARGET; // ~1.45 at target, higher above
      const deathPerChicken = DEATH_BASE * pressure;
      // Iterate backward so removals are safe
      for (let i = this.chickens.length - 1; i >= 0; i--) {
        if (Math.random() < deathPerChicken * dt) {
          this.removeChickenAt(i);
        }
      }
    }

    // Soft rescue if flock collapses (e.g. player cull + bad luck)
    if (this.chickens.length === 0 && Math.random() < 0.4 * dt) {
      const { x, z } = this.world.randomPosXZ();
      this.spawnChicken(x, z);
    }
  }

  update(dt) {
    this.ensureSpawned();
    this.tickPopulation(dt);

    for (const c of this.chickens) {
      c.wanderT -= dt;
      c.hopCd = Math.max(0, c.hopCd - dt);

      if (c.wanderT <= 0) {
        c.wanderT = 0.8 + Math.random() * 2;
        const ang = Math.random() * Math.PI * 2;
        const spd = CHICKEN_SPEED * (0.4 + Math.random() * 0.7);
        c.vx = Math.sin(ang) * spd;
        c.vz = Math.cos(ang) * spd;
        c.yaw = ang;
        if (c.onGround && Math.random() < 0.5) {
          c.vy = 4 + Math.random() * 2;
          c.onGround = false;
        }
      }

      if (!c.onGround) {
        c.vy -= CHICKEN_GRAVITY * dt;
      }

      let nx = c.x + c.vx * dt;
      let nz = c.z + c.vz * dt;
      let ny = c.y + c.vy * dt;

      const bodyOk = (x, z) =>
        !this.isSolid(x, c.y + 0.1, z) && !this.isSolid(x, c.y + 0.35, z);

      if (bodyOk(nx, c.z)) c.x = nx;
      else {
        c.vx *= -0.5;
        c.wanderT = 0;
      }
      if (bodyOk(c.x, nz)) c.z = nz;
      else {
        c.vz *= -0.5;
        c.wanderT = 0;
      }

      const cl = this.world.clampXZ(c.x, c.z, 0.4);
      c.x = cl.x;
      c.z = cl.z;

      const surf = this.world.getSurfaceHeight(Math.floor(c.x), Math.floor(c.z));
      if (ny <= surf && c.vy <= 0) {
        c.y = surf;
        c.vy = 0;
        c.onGround = true;
      } else {
        c.y = ny;
        c.onGround = false;
      }

      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.y = c.yaw;
    }
  }

  /**
   * Attack nearest chicken in front of camera. Returns cheese wedges gained (0 or 1+).
   * Does not auto-respawn — natural population dynamics refill the flock.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction
   */
  tryAttack(origin, direction) {
    let best = null;
    let bestD = ATTACK_RANGE;
    const dir = direction.clone().normalize();

    for (let i = 0; i < this.chickens.length; i++) {
      const c = this.chickens[i];
      const to = new THREE.Vector3(c.x - origin.x, c.y + 0.3 - origin.y, c.z - origin.z);
      const dist = to.length();
      if (dist > ATTACK_RANGE || dist < 0.01) continue;
      const nd = to.normalize().dot(dir);
      if (nd < 0.55) continue; // must be roughly looking at it
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }

    if (best == null) return 0;
    this.removeChickenAt(best);

    // 1–2 cheese wedges
    return 1 + (Math.random() < 0.35 ? 1 : 0);
  }

  count() {
    return this.chickens.length;
  }
}
