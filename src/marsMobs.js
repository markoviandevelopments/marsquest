// Mars-only creatures: Rock Rovers, Dust Hoppers, Crystal Crawlers
import * as THREE from 'three';
import { MARS_Y_MIN, isOnMars } from './world.js';
import { BlockTypes } from './blocks.js';

const ROVER_TARGET = 10;
const ROVER_MAX = 16;
const HOPPER_TARGET = 18;
const HOPPER_MAX = 28;
const CRAWLER_TARGET = 8;
const CRAWLER_MAX = 12;

const GRAVITY = 18;

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

function makeRoverMesh() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8b5a3c });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x4a3020 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffaa33 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.4), bodyMat);
  body.position.y = 0.28;
  body.castShadow = true;
  g.add(body);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), darkMat);
  dome.scale.set(1.2, 0.7, 1);
  dome.position.set(0, 0.42, 0);
  g.add(dome);

  // Legs
  for (const [x, z] of [[-0.2, 0.12], [0.2, 0.12], [-0.2, -0.12], [0.2, -0.12]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 5), darkMat);
    leg.position.set(x, 0.12, z);
    g.add(leg);
  }

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), eyeMat);
  eyeL.position.set(-0.08, 0.4, 0.18);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.08;
  g.add(eyeL, eyeR);

  return g;
}

function makeHopperMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xd4a574 });
  const eye = new THREE.MeshBasicMaterial({ color: 0x222200 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 5), mat);
  body.scale.set(1.1, 0.85, 1.3);
  body.position.y = 0.14;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mat);
  head.position.set(0, 0.22, 0.12);
  g.add(head);

  for (const x of [-0.05, 0.05]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 4), eye);
    e.position.set(x, 0.24, 0.18);
    g.add(e);
  }

  return g;
}

function makeCrawlerMesh() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x6b3fa0 });
  const crystalMat = new THREE.MeshBasicMaterial({ color: 0xcc66ff });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), bodyMat);
  body.scale.set(1.4, 0.7, 1.1);
  body.position.y = 0.12;
  g.add(body);

  // Crystal shards on back
  for (let i = 0; i < 3; i++) {
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), crystalMat);
    shard.position.set((i - 1) * 0.08, 0.22, -0.02);
    shard.rotation.z = (i - 1) * 0.3;
    g.add(shard);
  }

  // Legs
  const legMat = new THREE.MeshLambertMaterial({ color: 0x4a2870 });
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const z = ((i % 3) - 1) * 0.1;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 4), legMat);
    leg.position.set(side * 0.16, 0.06, z);
    leg.rotation.z = side * 0.6;
    g.add(leg);
  }

  return g;
}

export class MarsMobWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Array<any>} */
    this.mobs = [];
    this._spawned = false;
    this._popTimer = 0;
  }

  ensureSpawned() {
    if (this._spawned) return;
    this._spawned = true;
    for (let i = 0; i < ROVER_TARGET; i++) this.spawnKind('rover');
    for (let i = 0; i < HOPPER_TARGET; i++) this.spawnKind('hopper');
    for (let i = 0; i < CRAWLER_TARGET; i++) this.spawnKind('crawler');
  }

  countKind(kind) {
    return this.mobs.filter((m) => m.kind === kind).length;
  }

  spawnKind(kind) {
    const max = kind === 'rover' ? ROVER_MAX : kind === 'hopper' ? HOPPER_MAX : CRAWLER_MAX;
    if (this.countKind(kind) >= max) return null;

    const { x, z } = this.world.randomPosXZ();
    const clamped = this.world.clampXZ(x, z, 0.5);
    const surf = this.world.getSurfaceHeight(
      Math.floor(clamped.x),
      Math.floor(clamped.z),
      'mars'
    );
    // Don't spawn inside portal shrine too often
    if (Math.abs(clamped.x - 50) < 4 && Math.abs(clamped.z - 50) < 4 && Math.random() < 0.7) {
      return null;
    }

    let mesh;
    let speed;
    let hp;
    let drop;
    if (kind === 'rover') {
      mesh = makeRoverMesh();
      speed = 0.9;
      hp = 3;
      drop = 'RUST_ORE';
    } else if (kind === 'hopper') {
      mesh = makeHopperMesh();
      speed = 1.6;
      hp = 1;
      drop = 'MARS_DUST';
    } else {
      mesh = makeCrawlerMesh();
      speed = 1.15;
      hp = 2;
      drop = 'MARS_CRYSTAL';
    }

    const m = {
      kind,
      x: clamped.x,
      y: surf,
      z: clamped.z,
      yaw: Math.random() * Math.PI * 2,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      wanderT: Math.random() * 2,
      hopCd: Math.random(),
      speed,
      hp,
      drop,
      mesh,
    };
    mesh.position.set(m.x, m.y, m.z);
    this.scene.add(mesh);
    this.mobs.push(m);
    return m;
  }

  removeAt(index) {
    if (index < 0 || index >= this.mobs.length) return null;
    const m = this.mobs[index];
    this.scene.remove(m.mesh);
    disposeMesh(m.mesh);
    this.mobs.splice(index, 1);
    return m;
  }

  isSolid(x, y, z) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const t = this.world.getBlockType(id);
    return !!(t && t.solid && !t.liquid);
  }

  groundY(x, z) {
    return this.world.getSurfaceHeight(Math.floor(x), Math.floor(z), 'mars');
  }

  /**
   * Attack nearest Mars mob along look ray.
   * @returns {{ drop: string, kind: string } | null}
   */
  tryAttack(origin, direction) {
    const dir = direction.clone().normalize();
    let best = null;
    let bestT = 3.2;
    for (let i = 0; i < this.mobs.length; i++) {
      const m = this.mobs[i];
      const to = new THREE.Vector3(m.x - origin.x, m.y + 0.2 - origin.y, m.z - origin.z);
      const t = to.dot(dir);
      if (t < 0 || t > bestT) continue;
      const closest = origin.clone().addScaledVector(dir, t);
      const dist = closest.distanceTo(new THREE.Vector3(m.x, m.y + 0.2, m.z));
      const hitR = m.kind === 'rover' ? 0.55 : m.kind === 'crawler' ? 0.4 : 0.3;
      if (dist < hitR) {
        bestT = t;
        best = i;
      }
    }
    if (best == null) return null;
    const m = this.mobs[best];
    m.hp -= 1;
    // knockback
    m.vx += dir.x * 3;
    m.vz += dir.z * 3;
    m.vy = 2.5;
    m.onGround = false;
    if (m.hp <= 0) {
      const drop = m.drop;
      const kind = m.kind;
      this.removeAt(best);
      return { drop, kind };
    }
    return { drop: null, kind: m.kind, wounded: true };
  }

  update(dt) {
    this.ensureSpawned();
    this._popTimer += dt;
    if (this._popTimer > 4) {
      this._popTimer = 0;
      if (this.countKind('rover') < ROVER_TARGET && Math.random() < 0.5) this.spawnKind('rover');
      if (this.countKind('hopper') < HOPPER_TARGET && Math.random() < 0.65) this.spawnKind('hopper');
      if (this.countKind('crawler') < CRAWLER_TARGET && Math.random() < 0.4) this.spawnKind('crawler');
      // Soft cull if too many
      while (this.countKind('hopper') > HOPPER_MAX) {
        const i = this.mobs.findIndex((m) => m.kind === 'hopper');
        if (i >= 0) this.removeAt(i);
        else break;
      }
    }

    for (const m of this.mobs) {
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 1.2 + Math.random() * 2.5;
        m.yaw = Math.random() * Math.PI * 2;
        if (m.kind === 'hopper') m.yaw += (Math.random() - 0.5) * 1.5;
      }

      const spd = m.speed * (m.kind === 'hopper' && !m.onGround ? 1.3 : 1);
      m.vx = Math.sin(m.yaw) * spd * 0.85 + m.vx * 0.1;
      m.vz = Math.cos(m.yaw) * spd * 0.85 + m.vz * 0.1;

      // Hop
      m.hopCd -= dt;
      if (m.onGround && m.hopCd <= 0) {
        if (m.kind === 'hopper' || (m.kind === 'crawler' && Math.random() < 0.3)) {
          m.vy = m.kind === 'hopper' ? 5.5 : 3.2;
          m.onGround = false;
        }
        m.hopCd = m.kind === 'hopper' ? 0.6 + Math.random() * 0.8 : 1.5 + Math.random();
      }

      m.vy -= GRAVITY * dt;
      if (m.vy < -30) m.vy = -30;

      // Integrate with simple collision
      const nx = m.x + m.vx * dt;
      const nz = m.z + m.vz * dt;
      const c = this.world.clampXZ(nx, nz, 0.4);
      if (!this.isSolid(c.x, m.y + 0.1, c.z) && !this.isSolid(c.x, m.y + 0.5, c.z)) {
        m.x = c.x;
        m.z = c.z;
      } else {
        m.yaw += Math.PI * 0.6;
        m.vx *= -0.3;
        m.vz *= -0.3;
      }

      m.y += m.vy * dt;
      const gy = this.groundY(m.x, m.z);
      if (m.y <= gy) {
        m.y = gy;
        m.vy = 0;
        m.onGround = true;
      } else {
        m.onGround = false;
      }

      // Keep on Mars layer
      if (m.y < MARS_Y_MIN + 1) m.y = gy;

      m.mesh.position.set(m.x, m.y, m.z);
      m.mesh.rotation.y = m.yaw;
      // Bob hoppers
      if (m.kind === 'hopper') {
        m.mesh.position.y += Math.sin(performance.now() * 0.01 + m.x) * 0.02;
      }
    }
  }

  count() {
    return this.mobs.length;
  }

  stats() {
    return {
      total: this.mobs.length,
      rovers: this.countKind('rover'),
      hoppers: this.countKind('hopper'),
      crawlers: this.countKind('crawler'),
    };
  }

  /** Hide meshes when player is on Earth (optional perf / clarity) */
  setVisible(visible) {
    for (const m of this.mobs) {
      m.mesh.visible = visible;
    }
  }
}
