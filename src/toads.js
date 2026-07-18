// Toads: wander, eat food on grass, hunger bars, genetic color, breeding
import * as THREE from 'three';
import { BlockTypes } from './blocks.js';
const FOOD_SPAWN_INTERVAL_DEFAULT = 2.2; // high baseline — supports ~50 toads
const FOOD_SPAWN_CHANCE = 0.85;
const FOOD_MAX = 120;
const FOOD_INTERVAL_MIN = 0.4;
const FOOD_INTERVAL_MAX = 30;

const TOAD_COUNT_START = 12;
const TOAD_MAX = 50;
const TOAD_SPEED = 1.35;
const TOAD_GRAVITY = 22;
const TOAD_JUMP_SPEED = 6.2;
const TOAD_HUNGER_DRAIN = 0.012;    // lower metabolism
const TOAD_EAT_GAIN = 0.55;         // hunger restored per food
const TOAD_RESERVE_GAIN = 0.4;      // breeding reserve per food
const BREED_DIST = 1.6;
const BREED_RESERVE_NEED = 0.5;
const BREED_COOLDOWN = 14;          // seconds
const SEEK_FOOD_HUNGER = 0.7;       // start seeking food below this hunger
const TOAD_MET_MIN = 0.25;
const TOAD_MET_MAX = 4;

// Pure green ↔ pure brown genetic endpoints
const GENE_GREEN = new THREE.Color(0x3a9e3a);
const GENE_BROWN = new THREE.Color(0x6b4423);

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function geneColor(gene) {
  const c = GENE_GREEN.clone().lerp(GENE_BROWN, clamp01(gene));
  // slight brightness variation from gene hash
  const b = 0.92 + (gene * 7.13 % 1) * 0.12;
  return c.multiplyScalar(b);
}

function makeHungerSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 12;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.55, 0.1, 1);
  sprite.position.y = 0.55;
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = ctx;
  sprite.userData.tex = tex;
  return sprite;
}

function updateHungerSprite(sprite, hunger, reserve) {
  const ctx = sprite.userData.ctx;
  const canvas = sprite.userData.canvas;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  // background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, w, h);
  // hunger bar (green→red)
  const hw = Math.floor((w - 4) * clamp01(hunger));
  const r = Math.floor(255 * (1 - hunger));
  const g = Math.floor(200 * hunger);
  ctx.fillStyle = `rgb(${r},${g},40)`;
  ctx.fillRect(2, 2, hw, h - 4);
  // reserve tick (gold line)
  const rx = 2 + Math.floor((w - 4) * clamp01(reserve));
  ctx.fillStyle = '#ffd866';
  ctx.fillRect(rx - 1, 1, 2, h - 2);
  sprite.userData.tex.needsUpdate = true;
}

function makeFoodMesh() {
  const group = new THREE.Group();
  // berry / mushroom-ish
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.08, 6),
    new THREE.MeshLambertMaterial({ color: 0xf5f0e0 })
  );
  stem.position.y = 0.04;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xe74c3c })
  );
  cap.position.y = 0.12;
  cap.scale.y = 0.7;
  group.add(stem, cap);
  return group;
}

function makeToadMesh(gene) {
  const color = geneColor(gene);
  const mat = new THREE.MeshLambertMaterial({ color });
  const group = new THREE.Group();

  // body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat);
  body.scale.set(1.15, 0.75, 1.0);
  body.position.y = 0.14;
  body.castShadow = true;
  group.add(body);

  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat.clone());
  head.position.set(0, 0.22, 0.14);
  group.add(head);

  // eyes
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
  eyeL.position.set(-0.06, 0.28, 0.22);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.06;
  group.add(eyeL, eyeR);

  // back bumps
  for (let i = 0; i < 3; i++) {
    const bump = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 5, 5),
      mat.clone()
    );
    bump.position.set((i - 1) * 0.07, 0.26, -0.02 - i * 0.01);
    group.add(bump);
  }

  const hunger = makeHungerSprite();
  group.add(hunger);
  group.userData.hungerSprite = hunger;
  group.userData.bodyMats = [mat, head.material];

  return group;
}

function applyGeneColor(mesh, gene) {
  const c = geneColor(gene);
  for (const m of mesh.userData.bodyMats || []) {
    m.color.copy(c);
  }
}

export class ToadWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Map<string, { mesh: THREE.Group, x:number, y:number, z:number }>} */
    this.foods = new Map();
    /** @type {Array<any>} */
    this.toads = [];
    this.nextId = 1;
    this.foodTimer = 2;
    this._spawned = false;
    /** Seconds between food spawn attempts (lower = more food). Adjustable via chat. */
    this.foodSpawnInterval = FOOD_SPAWN_INTERVAL_DEFAULT;
    /**
     * Toad population multiplier (breeding + max + replenish).
     * Adjustable via /toadmetincrease and /toadmetdecrease.
     */
    this.toadMet = 1;
  }

  maxToads() {
    return Math.max(2, Math.round(TOAD_MAX * this.toadMet));
  }

  breedCooldown() {
    return BREED_COOLDOWN / Math.max(0.35, this.toadMet);
  }

  breedReserveNeed() {
    // Easier breeding at high toad met, harder at low
    return clamp01(BREED_RESERVE_NEED / Math.sqrt(Math.max(0.35, this.toadMet)));
  }

  /** @returns {{ interval: number, label: string }} */
  increaseFoodRate() {
    // Faster spawns: shorter interval
    this.foodSpawnInterval = Math.max(FOOD_INTERVAL_MIN, this.foodSpawnInterval * 0.7);
    this.foodTimer = Math.min(this.foodTimer, this.foodSpawnInterval);
    return this.foodRateInfo();
  }

  /** @returns {{ interval: number, label: string }} */
  decreaseFoodRate() {
    // Slower spawns: longer interval
    this.foodSpawnInterval = Math.min(FOOD_INTERVAL_MAX, this.foodSpawnInterval / 0.7);
    return this.foodRateInfo();
  }

  foodRateInfo() {
    const base = FOOD_SPAWN_INTERVAL_DEFAULT;
    const mult = base / this.foodSpawnInterval;
    return {
      interval: this.foodSpawnInterval,
      mult,
      label: `Food rate ×${mult.toFixed(2)} (every ~${this.foodSpawnInterval.toFixed(1)}s)`,
    };
  }

  increaseToadMet() {
    this.toadMet = Math.min(TOAD_MET_MAX, this.toadMet / 0.7);
    return this.toadMetInfo();
  }

  decreaseToadMet() {
    this.toadMet = Math.max(TOAD_MET_MIN, this.toadMet * 0.7);
    return this.toadMetInfo();
  }

  toadMetInfo() {
    return {
      mult: this.toadMet,
      maxToads: this.maxToads(),
      label: `Toad met ×${this.toadMet.toFixed(2)} (max toads ${this.maxToads()}, breed CD ~${this.breedCooldown().toFixed(1)}s)`,
    };
  }

  key(x, y, z) {
    return `${x | 0},${y | 0},${z | 0}`;
  }

  /** Random XZ inside the fixed world (not tied to the player). */
  randomWorldXZ() {
    return this.world.randomPosXZ();
  }

  /** Call once the full world is generated — scatter toads across the map */
  ensureInitialToads() {
    if (this._spawned) return;
    this._spawned = true;
    for (let i = 0; i < TOAD_COUNT_START; i++) {
      const { x: ox, z: oz } = this.randomWorldXZ();
      const gene = 0.15 + Math.random() * 0.7; // mix of green/brown
      this.spawnToad(ox, oz, gene, 0.75 + Math.random() * 0.2, 0.2);
    }
  }

  spawnToad(wx, wz, gene, hunger = 0.8, reserve = 0.15, force = false) {
    if (!force && this.toads.length >= this.maxToads()) return null;
    // Keep toads inside the 100×100 world
    const clamped = this.world.clampXZ(wx, wz, 0.5);
    wx = clamped.x;
    wz = clamped.z;
    const surf = this.world.getSurfaceHeight(Math.floor(wx), Math.floor(wz));
    const toad = {
      id: this.nextId++,
      x: wx,
      y: surf,
      z: wz,
      yaw: Math.random() * Math.PI * 2,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      jumpCd: Math.random() * 1.5,
      hunger: clamp01(hunger),
      reserve: clamp01(reserve),
      gene: clamp01(gene),
      breedCd: 3 + Math.random() * 4,
      state: 'wander',
      target: null,
      wanderT: 0,
      mesh: makeToadMesh(gene),
    };
    applyGeneColor(toad.mesh, toad.gene);
    toad.mesh.position.set(toad.x, toad.y, toad.z);
    this.scene.add(toad.mesh);
    this.toads.push(toad);
    return toad;
  }

  removeFood(key) {
    const f = this.foods.get(key);
    if (!f) return;
    this.scene.remove(f.mesh);
    f.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.foods.delete(key);
  }

  /** Spawn food on a random grass block anywhere in the 100×100 world */
  trySpawnFoodAnywhere() {
    if (this.foods.size >= FOOD_MAX) return;
    for (let attempt = 0; attempt < 24; attempt++) {
      const { x, z } = this.world.randomBlockXZ();
      const surf = this.world.getSurfaceHeight(x, z);
      const below = this.world.getBlock(x, surf - 1, z);
      if (below !== BlockTypes.GRASS.id) continue;
      const air = this.world.getBlock(x, surf, z);
      if (air !== 0) continue;
      const k = this.key(x, surf, z);
      if (this.foods.has(k)) continue;

      const mesh = makeFoodMesh();
      mesh.position.set(x + 0.5, surf, z + 0.5);
      this.scene.add(mesh);
      this.foods.set(k, { mesh, x: x + 0.5, y: surf, z: z + 0.5, bx: x, by: surf, bz: z });
      return;
    }
  }

  isSolidWorld(x, y, z) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const t = this.world.getBlockType(id);
    return !!(t && t.solid && !t.liquid);
  }

  /**
   * True if a 1-block step ahead is higher ground the toad should jump onto,
   * or a short wall is blocking horizontal movement.
   */
  shouldJumpObstacle(toad) {
    const lookX = toad.x + Math.sin(toad.yaw) * 0.55;
    const lookZ = toad.z + Math.cos(toad.yaw) * 0.55;
    const feetY = toad.y;
    // Wall at body height but free above → jump
    const blockedBody = this.isSolidWorld(lookX, feetY + 0.25, lookZ);
    const freeHead = !this.isSolidWorld(lookX, feetY + 0.95, lookZ);
    if (blockedBody && freeHead) return true;
    // Step up onto a higher surface (1 block)
    const aheadSurf = this.world.getSurfaceHeight(Math.floor(lookX), Math.floor(lookZ));
    if (aheadSurf > feetY + 0.2 && aheadSurf <= feetY + 1.15) return true;
    return false;
  }

  tryJump(toad, force = false) {
    if (!toad.onGround) return false;
    if (!force && toad.jumpCd > 0) return false;
    toad.vy = TOAD_JUMP_SPEED * (0.85 + Math.random() * 0.3);
    toad.onGround = false;
    toad.jumpCd = 0.35 + Math.random() * 0.5;
    return true;
  }

  moveToad(toad, dt) {
    toad.jumpCd = Math.max(0, toad.jumpCd - dt);

    // Gravity
    if (!toad.onGround) {
      toad.vy -= TOAD_GRAVITY * dt;
      if (toad.vy < -18) toad.vy = -18;
    }

    let nx = toad.x + toad.vx * dt;
    let nz = toad.z + toad.vz * dt;
    let ny = toad.y + toad.vy * dt;

    // Horizontal collision — jump if blocked by a step
    const bodyClear = (x, z) =>
      !this.isSolidWorld(x, toad.y + 0.15, z) && !this.isSolidWorld(x, toad.y + 0.4, z);

    if (bodyClear(nx, toad.z)) {
      toad.x = nx;
    } else {
      if (toad.onGround && this.shouldJumpObstacle(toad)) this.tryJump(toad, true);
      else {
        toad.vx *= -0.4;
        toad.wanderT = 0;
      }
    }
    if (bodyClear(toad.x, nz)) {
      toad.z = nz;
    } else {
      if (toad.onGround && this.shouldJumpObstacle(toad)) this.tryJump(toad, true);
      else {
        toad.vz *= -0.4;
        toad.wanderT = 0;
      }
    }

    // World border clamp (100×100)
    const clamped = this.world.clampXZ(toad.x, toad.z, 0.4);
    if (clamped.x !== toad.x || clamped.z !== toad.z) {
      toad.x = clamped.x;
      toad.z = clamped.z;
      toad.vx *= -0.5;
      toad.vz *= -0.5;
      toad.wanderT = 0;
    }

    // Vertical movement + ground collision
    const surf = this.world.getSurfaceHeight(Math.floor(toad.x), Math.floor(toad.z));
    if (ny <= surf && toad.vy <= 0) {
      toad.y = surf;
      toad.vy = 0;
      toad.onGround = true;
    } else {
      // Ceiling check
      if (toad.vy > 0 && this.isSolidWorld(toad.x, ny + 0.45, toad.z)) {
        toad.vy = 0;
        ny = Math.floor(ny + 0.45) - 0.45;
      }
      toad.y = ny;
      toad.onGround = false;
    }

    // Crouch/stretch body slightly while jumping for juice
    const stretch = toad.onGround ? 1 : 1 + Math.min(0.25, Math.abs(toad.vy) * 0.03);
    toad.mesh.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    toad.mesh.position.set(toad.x, toad.y, toad.z);
    toad.mesh.rotation.y = toad.yaw;
  }

  nearestFood(toad) {
    let best = null;
    let bestD = Infinity;
    for (const f of this.foods.values()) {
      const dx = f.x - toad.x;
      const dz = f.z - toad.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best ? { food: best, dist: Math.sqrt(bestD) } : null;
  }

  /**
   * Nearest other toad that is also ready to breed (reserve + cooldown + not starving).
   * @returns {{ mate: any, dist: number } | null}
   */
  nearestMate(toad) {
    const need = this.breedReserveNeed();
    let best = null;
    let bestD = Infinity;
    for (const other of this.toads) {
      if (other === toad || other.id === toad.id) continue;
      if (other.breedCd > 0) continue;
      if (other.reserve < need) continue;
      if (other.hunger < 0.3) continue;
      const dx = other.x - toad.x;
      const dz = other.z - toad.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    return best ? { mate: best, dist: Math.sqrt(bestD) } : null;
  }

  /** Ready to seek a partner instead of food */
  canSeekMate(toad) {
    return (
      toad.breedCd <= 0 &&
      toad.reserve >= this.breedReserveNeed() &&
      toad.hunger >= 0.3
    );
  }

  update(dt, _playerX, _playerZ) {
    this.ensureInitialToads();

    // Food spawn anywhere in the world (not near the player)
    this.foodTimer -= dt;
    if (this.foodTimer <= 0) {
      const jitter = 0.75 + Math.random() * 0.5;
      this.foodTimer = this.foodSpawnInterval * jitter;
      if (Math.random() < FOOD_SPAWN_CHANCE) {
        this.trySpawnFoodAnywhere();
      }
      // At high rates, try a second berry occasionally
      if (this.foodSpawnInterval < 4 && Math.random() < 0.4) {
        this.trySpawnFoodAnywhere();
      }
    }

    // Drop food that no longer sits on grass/air
    for (const [k, f] of [...this.foods.entries()]) {
      const below = this.world.getBlock(f.bx, f.by - 1, f.bz);
      const here = this.world.getBlock(f.bx, f.by, f.bz);
      if (below !== BlockTypes.GRASS.id || here !== 0) {
        this.removeFood(k);
      }
    }

    // Toad AI
    for (const toad of this.toads) {
      toad.hunger = clamp01(toad.hunger - TOAD_HUNGER_DRAIN * dt);
      toad.breedCd = Math.max(0, toad.breedCd - dt);

      // Die of starvation (remove gently)
      if (toad.hunger <= 0.02) {
        toad.hunger = 0;
        // stay still, slowly "despawn" reserve
        toad.vx = 0;
        toad.vz = 0;
        continue;
      }

      // Priority: (1) seek mate if above reproduction threshold
      //           (2) seek food if hungry
      //           (3) wander
      // Critical hunger still overrides mate-seeking so they don't starve.
      const criticallyHungry = toad.hunger < 0.25;
      const mateHit = !criticallyHungry && this.canSeekMate(toad) ? this.nearestMate(toad) : null;
      const foodHit = this.nearestFood(toad);

      if (mateHit) {
        toad.state = 'seek_mate';
        const dx = mateHit.mate.x - toad.x;
        const dz = mateHit.mate.z - toad.z;
        const len = Math.hypot(dx, dz) || 1;
        const spd = TOAD_SPEED * 1.25;
        toad.vx = (dx / len) * spd;
        toad.vz = (dz / len) * spd;
        toad.yaw = Math.atan2(dx, dz);

        if (toad.onGround && (this.shouldJumpObstacle(toad) || mateHit.mate.y > toad.y + 0.3)) {
          this.tryJump(toad);
        }
        // Breeding itself is handled in tryBreed() when close enough
      } else if ((criticallyHungry || toad.hunger < SEEK_FOOD_HUNGER) && foodHit) {
        toad.state = 'seek_food';
        const dx = foodHit.food.x - toad.x;
        const dz = foodHit.food.z - toad.z;
        const len = Math.hypot(dx, dz) || 1;
        toad.vx = (dx / len) * TOAD_SPEED * 1.15;
        toad.vz = (dz / len) * TOAD_SPEED * 1.15;
        toad.yaw = Math.atan2(dx, dz);

        // Jump toward food if it's on higher ground or we're hopping over
        if (toad.onGround && (this.shouldJumpObstacle(toad) || foodHit.food.y > toad.y + 0.3)) {
          this.tryJump(toad);
        }

        // Eat (must be near and roughly on the ground)
        if (foodHit.dist < 0.5 && Math.abs(toad.y - foodHit.food.y) < 0.8) {
          const k = this.key(foodHit.food.bx, foodHit.food.by, foodHit.food.bz);
          this.removeFood(k);
          toad.hunger = clamp01(toad.hunger + TOAD_EAT_GAIN);
          toad.reserve = clamp01(toad.reserve + TOAD_RESERVE_GAIN);
          toad.state = 'wander';
          toad.wanderT = 0;
        }
      } else {
        // Wander with periodic hops
        toad.state = 'wander';
        toad.wanderT -= dt;
        if (toad.wanderT <= 0) {
          toad.wanderT = 1.2 + Math.random() * 2.5;
          const ang = Math.random() * Math.PI * 2;
          const spd = TOAD_SPEED * (0.4 + Math.random() * 0.6);
          toad.vx = Math.sin(ang) * spd;
          toad.vz = Math.cos(ang) * spd;
          toad.yaw = ang;
          // Often start a hop when picking a new direction
          if (Math.random() < 0.65) this.tryJump(toad, true);
        }
        // Random idle hops while walking
        if (toad.onGround && toad.jumpCd <= 0 && Math.random() < dt * 0.55) {
          this.tryJump(toad);
        }
        if (toad.onGround && this.shouldJumpObstacle(toad)) {
          this.tryJump(toad, true);
        }
      }

      this.moveToad(toad, dt);
      updateHungerSprite(toad.mesh.userData.hungerSprite, toad.hunger, toad.reserve);
    }

    // Remove fully starved toads after a moment
    for (let i = this.toads.length - 1; i >= 0; i--) {
      const t = this.toads[i];
      if (t.hunger > 0.02) continue;
      t._starveT = (t._starveT || 0) + dt;
      if (t._starveT > 4) {
        this.scene.remove(t.mesh);
        t.mesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
        });
        this.toads.splice(i, 1);
      }
    }

    // Breeding
    this.tryBreed(dt);

    // Keep / grow population based on toad met — spawn anywhere in the world
    const minPop = Math.max(2, Math.round(2 * this.toadMet));
    if (this.toads.length < minPop) {
      const tries = this.toadMet >= 1.5 ? 2 : 1;
      for (let t = 0; t < tries; t++) {
        if (this.toads.length >= this.maxToads()) break;
        const { x, z } = this.randomWorldXZ();
        this.spawnToad(x, z, 0.2 + Math.random() * 0.5, 0.7, 0.1);
      }
    }
  }

  tryBreed() {
    if (this.toads.length >= this.maxToads()) return;
    const need = this.breedReserveNeed();
    const cd = this.breedCooldown();
    for (let i = 0; i < this.toads.length; i++) {
      const a = this.toads[i];
      if (a.breedCd > 0 || a.reserve < need || a.hunger < 0.3) continue;
      for (let j = i + 1; j < this.toads.length; j++) {
        const b = this.toads[j];
        if (b.breedCd > 0 || b.reserve < need || b.hunger < 0.3) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > BREED_DIST) continue;

        // Offspring gene: blend + mutation
        const blend = (a.gene + b.gene) / 2;
        const mutation = (Math.random() - 0.5) * 0.12; // slight mutation
        const childGene = clamp01(blend + mutation);

        // Parents pass portion of reserve
        a.reserve = clamp01(a.reserve - 0.4);
        b.reserve = clamp01(b.reserve - 0.4);
        a.breedCd = cd;
        b.breedCd = cd;

        const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 0.5;
        const mz = (a.z + b.z) / 2 + (Math.random() - 0.5) * 0.5;
        const child = this.spawnToad(mx, mz, childGene, 0.7, 0.1);
        if (child) {
          child.breedCd = cd * 0.5;
        }
        return; // one birth per frame max
      }
    }
  }


  /** Summon N toads at random world positions (can exceed soft max when force). */
  summonToads(n = 100) {
    const count = Math.max(0, Math.min(200, n | 0));
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const { x, z } = this.randomWorldXZ();
      const gene = 0.1 + Math.random() * 0.8;
      const t = this.spawnToad(x, z, gene, 0.85, 0.25, true);
      if (t) spawned++;
    }
    return spawned;
  }

  serialize() {
    return {
      foodSpawnInterval: this.foodSpawnInterval,
      toadMet: this.toadMet,
      nextId: this.nextId,
      toads: this.toads.map((t) => ({
        id: t.id,
        x: t.x,
        y: t.y,
        z: t.z,
        yaw: t.yaw,
        hunger: t.hunger,
        reserve: t.reserve,
        gene: t.gene,
        breedCd: t.breedCd,
      })),
      foods: [...this.foods.values()].map((f) => ({
        bx: f.bx, by: f.by, bz: f.bz,
      })),
    };
  }

  clearAllToadsAndFood() {
    for (const t of this.toads) {
      this.scene.remove(t.mesh);
      t.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    this.toads = [];
    for (const k of [...this.foods.keys()]) this.removeFood(k);
  }

  loadState(data) {
    if (!data) return;
    this.clearAllToadsAndFood();
    this._spawned = true;
    if (typeof data.foodSpawnInterval === 'number') this.foodSpawnInterval = data.foodSpawnInterval;
    if (typeof data.toadMet === 'number') this.toadMet = data.toadMet;
    if (typeof data.frogMet === 'number') this.toadMet = data.frogMet; // legacy
    if (typeof data.nextId === 'number') this.nextId = data.nextId;
    if (Array.isArray(data.foods)) {
      for (const f of data.foods) {
        const x = f.bx | 0, y = f.by | 0, z = f.bz | 0;
        const k = this.key(x, y, z);
        if (this.foods.has(k)) continue;
        const mesh = makeFoodMesh();
        mesh.position.set(x + 0.5, y, z + 0.5);
        this.scene.add(mesh);
        this.foods.set(k, { mesh, x: x + 0.5, y, z: z + 0.5, bx: x, by: y, bz: z });
      }
    }
    if (Array.isArray(data.toads)) {
      for (const td of data.toads) {
        const t = this.spawnToad(td.x, td.z, td.gene ?? 0.4, td.hunger ?? 0.8, td.reserve ?? 0.2, true);
        if (!t) continue;
        if (typeof td.id === 'number') t.id = td.id;
        t.y = td.y ?? t.y;
        t.yaw = td.yaw ?? t.yaw;
        t.breedCd = td.breedCd ?? 0;
        t.mesh.position.set(t.x, t.y, t.z);
        t.mesh.rotation.y = t.yaw;
      }
      const maxId = this.toads.reduce((m, t) => Math.max(m, t.id), 0);
      this.nextId = Math.max(this.nextId, maxId + 1);
    }
  }

  stats() {
    return {
      toads: this.toads.length,
      food: this.foods.size,
      foodInterval: this.foodSpawnInterval,
      foodMult: FOOD_SPAWN_INTERVAL_DEFAULT / this.foodSpawnInterval,
      toadMet: this.toadMet,
    };
  }
}
