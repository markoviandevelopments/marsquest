// Player - First-person controller with physics & collision
import * as THREE from 'three';
import { BlockTypes } from './blocks.js';

const GRAVITY = 28;          // blocks per second^2
const JUMP_SPEED = 9;        // initial upward velocity
const SWIM_UP_SPEED = 6.2;   // vertical boost while holding jump in water
const SWIM_MAX_UP = 7.5;
const WALK_SPEED = 5;        // blocks per second
const SWIM_SPEED_MULT = 0.72;
const SPRINT_MULT = 1.6;     // sprint multiplier
const PLAYER_HEIGHT = 1.8;   // eye height
const PLAYER_WIDTH = 0.6;    // half-width for collision (radius)
const PLAYER_HALF = 0.3;     // half of body width

export class Player {
  constructor(camera, controls, world) {
    this.camera = camera;
    this.controls = controls;
    this.world = world;

    // Position is the player's feet; camera sits at feet + eye height
    this.position = new THREE.Vector3(0, 40, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.onGround = false;
    this.inWater = false;

    this._tmp = new THREE.Vector3();
    this.syncCamera();
  }

  getPosition() {
    return this.position;
  }

  getVelocity() {
    return this.velocity;
  }

  syncCamera() {
    this.camera.position.set(
      this.position.x,
      this.position.y + PLAYER_HEIGHT,
      this.position.z
    );
  }

  // AABB collision check against solid blocks
  isSolidAt(x, y, z) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const type = this.world.getBlockType ? this.world.getBlockType(id) : null;
    if (type) return type.solid;
    // Fallback: treat any non-zero block as solid
    return id !== 0;
  }

  isLiquidAt(x, y, z) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const type = this.world.getBlockType ? this.world.getBlockType(id) : null;
    return !!(type && type.liquid);
  }

  /** True if feet or torso is in a liquid block */
  checkInWater() {
    const x = this.position.x;
    const z = this.position.z;
    const y = this.position.y;
    // feet, mid, and eye-ish samples
    return (
      this.isLiquidAt(x, y + 0.15, z)
      || this.isLiquidAt(x, y + 0.9, z)
      || this.isLiquidAt(x, y + 1.4, z)
    );
  }

  collidesAt(pos) {
    const r = PLAYER_HALF;
    const minX = Math.floor(pos.x - r);
    const maxX = Math.floor(pos.x + r);
    const minY = Math.floor(pos.y);
    const maxY = Math.floor(pos.y + PLAYER_HEIGHT - 0.001);
    const minZ = Math.floor(pos.z - r);
    const maxZ = Math.floor(pos.z + r);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolidAt(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  update(dt, keys) {
    this.inWater = this.checkInWater();

    // Build movement direction from camera yaw
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (keys.forward) move.add(forward);
    if (keys.backward) move.sub(forward);
    if (keys.right) move.add(right);
    if (keys.left) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize();
      let speed = WALK_SPEED * (keys.sprint ? SPRINT_MULT : 1);
      if (this.inWater) speed *= SWIM_SPEED_MULT;
      this.velocity.x = move.x * speed;
      this.velocity.z = move.z * speed;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // Jump / swim
    if (keys.jump) {
      if (this.inWater) {
        // Hold space to swim up continuously (not only when "on ground")
        this.velocity.y = Math.min(SWIM_MAX_UP, Math.max(this.velocity.y, SWIM_UP_SPEED));
        this.onGround = false;
      } else if (this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // Gravity (reduced in water + light buoyancy)
    if (this.inWater) {
      this.velocity.y -= GRAVITY * 0.18 * dt;
      this.velocity.y += 3.5 * dt; // buoyancy
      // Cap sink / rise speeds underwater
      if (this.velocity.y < -3.5) this.velocity.y = -3.5;
      if (this.velocity.y > SWIM_MAX_UP) this.velocity.y = SWIM_MAX_UP;
      // Light drag
      this.velocity.y *= (1 - Math.min(1, 2.5 * dt));
    } else {
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -50) this.velocity.y = -50;
    }

    this.moveAxis(this.velocity.x * dt, 0, 0);
    this.moveAxis(0, this.velocity.y * dt, 0);
    this.moveAxis(0, 0, this.velocity.z * dt);

    // Clamp to fixed world bounds if the world defines them
    if (this.world && typeof this.world.clampXZ === 'function') {
      const c = this.world.clampXZ(this.position.x, this.position.z, 0.35);
      if (c.x !== this.position.x) {
        this.position.x = c.x;
        this.velocity.x = 0;
      }
      if (c.z !== this.position.z) {
        this.position.z = c.z;
        this.velocity.z = 0;
      }
    }

    this.syncCamera();
  }

  // Move along a single axis with collision resolution
  moveAxis(dx, dy, dz) {
    const next = this._tmp.copy(this.position);
    next.x += dx;
    next.y += dy;
    next.z += dz;

    if (!this.collidesAt(next)) {
      this.position.copy(next);
      if (dy < 0) this.onGround = false;
      return;
    }

    // Collision: try to resolve per-axis so we can slide along walls
    if (dx !== 0) {
      const tryX = this._tmp.copy(this.position);
      tryX.x += dx;
      if (!this.collidesAt(tryX)) this.position.x = tryX.x;
    }
    if (dy !== 0) {
      const tryY = this._tmp.copy(this.position);
      tryY.y += dy;
      if (!this.collidesAt(tryY)) {
        this.position.y = tryY.y;
      } else {
        if (dy < 0) {
          this.onGround = true;
          this.velocity.y = 0;
        } else {
          this.velocity.y = 0;
        }
      }
    }
    if (dz !== 0) {
      const tryZ = this._tmp.copy(this.position);
      tryZ.z += dz;
      if (!this.collidesAt(tryZ)) this.position.z = tryZ.z;
    }
  }
}
