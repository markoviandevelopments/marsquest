// World Management - Chunk-based voxel world
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { BlockTypes, BlockIdToType, getBlockType, isSolid, isTransparent } from './blocks.js';
import {
  getSolidMaterial,
  getTransparentMaterial,
  getWaterMaterial,
  getPlantMaterial,
  getTileUV,
  tileForFace,
} from './textures.js';

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;

/** Fixed world footprint: [WORLD_MIN, WORLD_MAX) on X and Z (100×100 blocks). */
export const WORLD_SIZE = 100;
export const WORLD_MIN = 0;
export const WORLD_MAX = WORLD_SIZE; // exclusive upper bound
export const WORLD_CENTER = WORLD_SIZE / 2; // 50

/**
 * Vertical layout (single shared world — both planets always exist):
 *   Mars  : y ∈ [MARS_Y_MIN, MARS_Y_MAX)   far below
 *   Void  : gap between Mars ceiling and Earth bedrock
 *   Earth : y ∈ [0, EARTH_Y_MAX)
 */
export const MARS_Y_MIN = -200;
export const MARS_Y_MAX = -136; // 64-block tall Mars slab
export const EARTH_Y_MIN = 0;
export const EARTH_Y_MAX = 64;
export const WORLD_Y_MIN = MARS_Y_MIN;
export const WORLD_Y_MAX = EARTH_Y_MAX;
/** Chunk column height covering Mars + void + Earth */
export const CHUNK_HEIGHT = WORLD_Y_MAX - WORLD_Y_MIN; // 264

/** Convert world Y → chunk-local Y index */
export function worldToLocalY(wy) {
  return (wy | 0) - WORLD_Y_MIN;
}

/** Convert chunk-local Y → world Y */
export function localToWorldY(ly) {
  return (ly | 0) + WORLD_Y_MIN;
}

export function isOnMars(wy) {
  return wy < EARTH_Y_MIN;
}

export function isOnEarth(wy) {
  return wy >= EARTH_Y_MIN;
}

class Chunk {
  constructor(cx, cz, world) {
    this.cx = cx;
    this.cz = cz;
    this.world = world;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.transparentMesh = null;
    this.waterMesh = null;
    this.plantMesh = null;
    this.dirty = true;
    this.generated = false;
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      // Shared atlas materials — do not dispose
      this.world.scene.remove(this.mesh);
      this.mesh = null;
    }
    if (this.transparentMesh) {
      this.transparentMesh.geometry.dispose();
      this.world.scene.remove(this.transparentMesh);
      this.transparentMesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      this.world.scene.remove(this.waterMesh);
      this.waterMesh = null;
    }
    if (this.plantMesh) {
      this.plantMesh.geometry.dispose();
      this.world.scene.remove(this.plantMesh);
      this.plantMesh = null;
    }
  }

  /** Local indices: x,z in [0,CHUNK_SIZE), ly in [0, CHUNK_HEIGHT) */
  getIndex(x, ly, z) {
    return (ly * CHUNK_SIZE + z) * CHUNK_SIZE + x;
  }

  setBlock(x, ly, z, blockId) {
    if (x < 0 || x >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return false;
    }
    // Accept either a numeric id or a block name string (e.g. 'STONE', 'AIR')
    let id = blockId;
    if (typeof id === 'string') {
      const t = BlockTypes[id];
      id = t ? t.id : 0;
    } else {
      id = id | 0;
    }
    const idx = this.getIndex(x, ly, z);
    if (this.blocks[idx] !== id) {
      this.blocks[idx] = id;
      this.dirty = true;
      return true;
    }
    return false;
  }

  getBlock(x, ly, z) {
    if (x < 0 || x >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return 0;
    }
    return this.blocks[this.getIndex(x, ly, z)];
  }

  getWorldBlock(wx, wy, wz) {
    const lx = wx - this.cx * CHUNK_SIZE;
    const ly = worldToLocalY(wy);
    const lz = wz - this.cz * CHUNK_SIZE;
    return this.getBlock(lx, ly, lz);
  }

  setWorldBlock(wx, wy, wz, blockId) {
    const lx = wx - this.cx * CHUNK_SIZE;
    const ly = worldToLocalY(wy);
    const lz = wz - this.cz * CHUNK_SIZE;
    return this.setBlock(lx, ly, lz, blockId);
  }

  /** Set by world Y (converts to local index) */
  setWorldY(x, worldY, z, blockId) {
    return this.setBlock(x, worldToLocalY(worldY), z, blockId);
  }

  generateTerrain() {
    if (this.generated) return;
    this.generated = true;
    this.generateEarthTerrain();
    this.generateMarsTerrain();
  }

  generateEarthTerrain() {
    const worldX = this.cx * CHUNK_SIZE;
    const worldZ = this.cz * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = worldX + x;
        const wz = worldZ + z;

        const n1 = this.noise2D(wx * 0.008, wz * 0.008);
        const n2 = this.noise2D(wx * 0.03, wz * 0.03);
        const n3 = this.noise2D(wx * 0.08, wz * 0.08);
        const height = Math.max(1, Math.floor(22 + n1 * 9 + n2 * 3 + n3 * 1.2));

        for (let y = 0; y <= height; y++) {
          let blockId;
          if (y === 0) {
            blockId = BlockTypes.BEDROCK.id;
          } else if (y === height) {
            blockId = BlockTypes.GRASS.id;
          } else if (y > height - 4) {
            blockId = BlockTypes.DIRT.id;
          } else {
            blockId = BlockTypes.STONE.id;
          }

          if (y < height - 4 && y > 2) {
            const oreNoise = this.noise3D(wx * 0.1, y * 0.1, wz * 0.1);
            if (oreNoise > 0.95) blockId = BlockTypes.DIAMOND_ORE.id;
            else if (oreNoise > 0.9) blockId = BlockTypes.GOLD_ORE.id;
            else if (oreNoise > 0.8) blockId = BlockTypes.IRON_ORE.id;
            else if (oreNoise > 0.6) blockId = BlockTypes.COAL_ORE.id;
          }

          this.setWorldY(x, y, z, blockId);
        }

        if (height > 6 && this.noise2D(wx * 0.15 + 100, wz * 0.15 + 100) > 0.82) {
          this.generateTree(x, height + 1, z);
        }

        if (height < 10) {
          for (let y = height + 1; y <= 10; y++) {
            this.setWorldY(x, y, z, BlockTypes.WATER.id);
          }
        } else {
          // Wildflowers on grass above the waterline (air only — skip tree trunks)
          const above = this.getBlock(x, worldToLocalY(height + 1), z);
          if (above === 0) {
            const fn = this.noise2D(wx * 0.32 + 17, wz * 0.32 + 41);
            if (fn > 0.74) {
              const flowers = [
                BlockTypes.POPPY?.id,
                BlockTypes.DANDELION?.id,
                BlockTypes.BLUE_ORCHID?.id,
                BlockTypes.PINK_TULIP?.id,
              ].filter((id) => id != null);
              if (flowers.length) {
                const pick = Math.floor(
                  ((this.noise2D(wx * 0.91 + 3, wz * 0.91 + 9) + 1) * 0.5) * flowers.length
                ) % flowers.length;
                this.setWorldY(x, height + 1, z, flowers[pick]);
              }
            }
          }
        }
      }
    }
  }

  /** Rich Mars layer: varied geology, polar ice, magma, structures */
  generateMarsTerrain() {
    const worldX = this.cx * CHUNK_SIZE;
    const worldZ = this.cz * CHUNK_SIZE;
    const ox = 9000;
    const oz = 4200;
    const base = MARS_Y_MIN;
    const dust = BlockTypes.MARS_DUST?.id ?? BlockTypes.SAND.id;
    const rock = BlockTypes.MARS_ROCK?.id ?? BlockTypes.STONE.id;
    const basalt = BlockTypes.MARS_BASALT?.id ?? rock;
    const ice = BlockTypes.MARS_ICE?.id ?? BlockTypes.GLASS.id;
    const rust = BlockTypes.RUST_ORE?.id ?? BlockTypes.IRON_ORE.id;
    const meteor = BlockTypes.MARS_METEORITE?.id ?? BlockTypes.STONE.id;
    const magma = BlockTypes.MARS_MAGMA?.id ?? BlockTypes.LAVA?.id ?? 0;
    const crystal = BlockTypes.MARS_CRYSTAL?.id ?? BlockTypes.GLASS.id;
    const fungus = BlockTypes.ALIEN_FUNGUS?.id ?? 0;
    const brick = BlockTypes.MARS_BRICK?.id ?? rock;

    // Surface heights for structure pass
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = worldX + x;
        const wz = worldZ + z;
        const n1 = this.noise2D((wx + ox) * 0.01, (wz + oz) * 0.01);
        const n2 = this.noise2D((wx + ox) * 0.04, (wz + oz) * 0.04);
        const n3 = this.noise2D((wx + ox) * 0.09, (wz + oz) * 0.09);
        // Polar ice caps near Z edges
        const polar = Math.max(0, 1 - Math.min(wz, WORLD_SIZE - 1 - wz) / 14);
        // Crater: lower bowl near certain noise valleys
        const crater = this.noise2D((wx + ox) * 0.05 + 50, (wz + oz) * 0.05 + 50);
        let relH = Math.max(1, Math.floor(16 + n1 * 12 + n2 * 4 + n3 * 1.8 - polar * 4));
        if (crater < -0.55) relH = Math.max(2, relH - 6);
        if (crater > 0.7) relH = Math.min(30, relH + 4); // mesas
        const height = base + relH;
        heights[z * CHUNK_SIZE + x] = height;

        const isPolar = polar > 0.55;
        const isVolcanic = this.noise2D(wx * 0.07 + 3, wz * 0.07 + 3) > 0.62;

        for (let y = base; y <= height; y++) {
          let blockId;
          if (y === base) {
            blockId = BlockTypes.BEDROCK.id;
          } else if (y === height) {
            if (isPolar) blockId = ice;
            else if (isVolcanic) blockId = basalt;
            else blockId = dust;
          } else if (y > height - 3) {
            blockId = isVolcanic ? basalt : rock;
          } else if (y > height - 8 && isVolcanic) {
            blockId = basalt;
          } else {
            blockId = BlockTypes.STONE.id;
          }

          if (y < height - 3 && y > base + 2) {
            const oreNoise = this.noise3D((wx + ox) * 0.12, y * 0.12, (wz + oz) * 0.12);
            if (oreNoise > 0.93) blockId = BlockTypes.IRON_ORE.id;
            else if (oreNoise > 0.9) blockId = rust;
            else if (oreNoise > 0.87) blockId = BlockTypes.GOLD_ORE.id;
            else if (oreNoise > 0.84) blockId = meteor;
            else if (oreNoise > 0.78) blockId = BlockTypes.COAL_ORE.id;
          }

          // Magma pockets in low crater floors
          if (crater < -0.6 && y > base + 1 && y <= height && y >= height - 1) {
            if (y === height) blockId = magma || dust;
            else if (y === height - 1) blockId = basalt;
          }

          this.setWorldY(x, y, z, blockId);
        }

        // Alien fungus on dust flats
        if (!isPolar && fungus && crater > -0.2 && crater < 0.4) {
          if (this.noise2D(wx * 0.2 + 9, wz * 0.2 + 9) > 0.78) {
            this.setWorldY(x, height + 1, z, fungus);
          }
        }

        // Surface crystal spikes
        if (crystal && this.noise2D(wx * 0.18 + 1, wz * 0.18 + 1) > 0.88) {
          const h = 2 + Math.floor(this.noise2D(wx, wz) * 3);
          for (let i = 1; i <= h; i++) {
            this.setWorldY(x, height + i, z, crystal);
          }
        }
      }
    }

    // Structures (local to this chunk; cross-chunk pieces when origin in-chunk)
    this.placeMarsStructures(worldX, worldZ, heights, {
      dust, rock, basalt, ice, rust, meteor, magma, crystal, fungus, brick,
    });
  }

  /**
   * Deterministic Mars landmarks: ruins, pillars, meteor impacts, portal shrine.
   * @param {Int16Array} heights surface world-Y per local x,z
   */
  placeMarsStructures(worldX, worldZ, heights, ids) {
    const { rock, basalt, brick, meteor, crystal, ice } = ids;

    const setW = (wx, wy, wz, id) => {
      if (wx < worldX || wx >= worldX + CHUNK_SIZE) return;
      if (wz < worldZ || wz >= worldZ + CHUNK_SIZE) return;
      if (wy < MARS_Y_MIN || wy >= MARS_Y_MAX) return;
      const lx = wx - worldX;
      const lz = wz - worldZ;
      this.setWorldY(lx, wy, lz, id);
    };

    const surfAt = (wx, wz) => {
      if (wx < worldX || wx >= worldX + CHUNK_SIZE || wz < worldZ || wz >= worldZ + CHUNK_SIZE) {
        // Approximate for out-of-chunk structure anchors
        return MARS_Y_MIN + 18;
      }
      return heights[(wz - worldZ) * CHUNK_SIZE + (wx - worldX)];
    };

    // --- Portal shrine at world center ---
    if (
      worldX <= WORLD_CENTER && WORLD_CENTER < worldX + CHUNK_SIZE &&
      worldZ <= WORLD_CENTER && WORLD_CENTER < worldZ + CHUNK_SIZE
    ) {
      const cx = WORLD_CENTER;
      const cz = WORLD_CENTER;
      const sy = surfAt(cx, cz);
      // Platform
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          setW(cx + dx, sy, cz + dz, brick);
          setW(cx + dx, sy + 1, cz + dz, 0); // clear
          setW(cx + dx, sy + 2, cz + dz, 0);
          setW(cx + dx, sy + 3, cz + dz, 0);
        }
      }
      // Pillars
      for (const [dx, dz] of [[-3, -3], [-3, 3], [3, -3], [3, 3]]) {
        for (let y = 1; y <= 4; y++) setW(cx + dx, sy + y, cz + dz, basalt);
        setW(cx + dx, sy + 5, cz + dz, crystal);
      }
      // Portal
      setW(cx, sy + 1, cz, BlockTypes.EARTH_PORTAL?.id ?? brick);
      // Ring of ice lamps
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const rx = cx + Math.round(Math.cos(ang) * 2);
        const rz = cz + Math.round(Math.sin(ang) * 2);
        setW(rx, sy + 1, rz, ice);
      }
    }

    // --- Ruined habitats (grid of seeds) ---
    for (let gx = 0; gx < WORLD_SIZE; gx += 18) {
      for (let gz = 0; gz < WORLD_SIZE; gz += 18) {
        const seed = this.noise2D(gx * 0.3 + 2, gz * 0.3 + 2);
        if (seed < 0.55) continue;
        const ox = gx + 4 + Math.floor(((seed + 1) * 0.5) * 6);
        const oz = gz + 4 + Math.floor(((seed + 1) * 0.5) * 5);
        if (ox < worldX - 4 || ox > worldX + CHUNK_SIZE + 4) continue;
        if (oz < worldZ - 4 || oz > worldZ + CHUNK_SIZE + 4) continue;
        // Skip near portal
        if (Math.abs(ox - WORLD_CENTER) < 8 && Math.abs(oz - WORLD_CENTER) < 8) continue;

        const sy = surfAt(
          Math.max(worldX, Math.min(worldX + CHUNK_SIZE - 1, ox)),
          Math.max(worldZ, Math.min(worldZ + CHUNK_SIZE - 1, oz))
        );
        const w = 5;
        const d = 4;
        const h = 3;
        for (let dx = 0; dx < w; dx++) {
          for (let dz = 0; dz < d; dz++) {
            setW(ox + dx, sy, oz + dz, brick); // floor
            for (let dy = 1; dy <= h; dy++) {
              const edge = dx === 0 || dx === w - 1 || dz === 0 || dz === d - 1;
              const door = dz === 0 && dx === 2 && dy <= 2;
              if (edge && !door) {
                // Broken walls
                if (this.noise3D(ox + dx, dy, oz + dz) > 0.25) {
                  setW(ox + dx, sy + dy, oz + dz, brick);
                }
              } else if (!edge) {
                setW(ox + dx, sy + dy, oz + dz, 0);
              }
            }
            // partial roof
            if (this.noise2D(ox + dx, oz + dz) > 0.35) {
              setW(ox + dx, sy + h + 1, oz + dz, basalt);
            }
          }
        }
        // Chest-like loot block inside (meteorite + crystal)
        setW(ox + 2, sy + 1, oz + 2, meteor);
        setW(ox + 1, sy + 1, oz + 2, crystal);
      }
    }

    // --- Basalt pillars ---
    for (let i = 0; i < 8; i++) {
      const px = worldX + Math.floor(this.noise2D(this.cx * 3 + i, this.cz * 3 + 1) * 0.5 * CHUNK_SIZE + CHUNK_SIZE * 0.25);
      const pz = worldZ + Math.floor(this.noise2D(this.cx * 3 + 2, this.cz * 3 + i) * 0.5 * CHUNK_SIZE + CHUNK_SIZE * 0.25);
      if (px < worldX || px >= worldX + CHUNK_SIZE || pz < worldZ || pz >= worldZ + CHUNK_SIZE) continue;
      if (Math.abs(px - WORLD_CENTER) < 6 && Math.abs(pz - WORLD_CENTER) < 6) continue;
      const n = this.noise2D(px * 0.4, pz * 0.4);
      if (n < 0.45) continue;
      const sy = surfAt(px, pz);
      const tall = 4 + Math.floor((n + 1) * 3);
      for (let y = 1; y <= tall; y++) {
        setW(px, sy + y, pz, basalt);
        if (y > 2 && this.noise2D(px + y, pz) > 0.7) setW(px + 1, sy + y, pz, basalt);
      }
      if (n > 0.7) setW(px, sy + tall + 1, pz, crystal);
    }

    // --- Meteor impact crater (chunk-local rare) ---
    const impact = this.noise2D(this.cx * 1.7 + 11, this.cz * 1.7 + 13);
    if (impact > 0.72) {
      const mx = worldX + 8;
      const mz = worldZ + 8;
      const sy = surfAt(mx, mz);
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > 3.2) continue;
          const dig = dist < 1.5 ? 2 : 1;
          for (let k = 0; k < dig; k++) {
            setW(mx + dx, sy - k, mz + dz, dist < 1.2 ? meteor : rock);
          }
          if (dist < 1.1) setW(mx + dx, sy + 1, mz + dz, meteor);
        }
      }
    }
  }

  generateTree(x, worldY, z) {
    const trunkHeight = 4 + Math.floor(this.noise2D(x * 10, z * 10) * 3);

    for (let i = 0; i < trunkHeight; i++) {
      const wy = worldY + i;
      if (wy < EARTH_Y_MAX) {
        this.setWorldY(x, wy, z, BlockTypes.WOOD.id);
      }
    }

    const leafY = worldY + trunkHeight;
    for (let lx = -2; lx <= 2; lx++) {
      for (let lz = -2; lz <= 2; lz++) {
        for (let ly = -1; ly <= 1; ly++) {
          const dist = Math.abs(lx) + Math.abs(lz) + Math.abs(ly);
          if (dist <= 3 && this.noise3D(lx * 5, ly * 5, lz * 5) > 0.3) {
            const bx = x + lx;
            const by = leafY + ly;
            const bz = z + lz;
            if (bx >= 0 && bx < CHUNK_SIZE && bz >= 0 && bz < CHUNK_SIZE && by < EARTH_Y_MAX && by >= 0) {
              this.setWorldY(bx, by, bz, BlockTypes.LEAVES.id);
            }
          }
        }
      }
    }
  }

  rebuildMesh() {
    if (!this.dirty) return;
    this.dirty = false;

    // Dispose old meshes (shared materials — only dispose geometry)
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.world.scene.remove(this.mesh);
      this.mesh = null;
    }
    if (this.transparentMesh) {
      this.transparentMesh.geometry.dispose();
      this.world.scene.remove(this.transparentMesh);
      this.transparentMesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      this.world.scene.remove(this.waterMesh);
      this.waterMesh = null;
    }
    if (this.plantMesh) {
      this.plantMesh.geometry.dispose();
      this.world.scene.remove(this.plantMesh);
      this.plantMesh = null;
    }

    const solidGeometries = [];
    const transparentGeometries = [];
    const waterGeometries = [];
    const plantGeometries = [];

    const worldX = this.cx * CHUNK_SIZE;
    const worldZ = this.cz * CHUNK_SIZE;

    // Face definitions for corner-based blocks occupying [x,x+1) × [y,y+1) × [z,z+1).
    // Each entry: outward normal + 4 local corner offsets (unit cube).
    const FACE_DEFS = [
      { // +X
        normal: [1, 0, 0],
        corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
      },
      { // -X
        normal: [-1, 0, 0],
        corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
      },
      { // +Y
        normal: [0, 1, 0],
        corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
      },
      { // -Y
        normal: [0, -1, 0],
        corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      },
      { // +Z
        normal: [0, 0, 1],
        corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
      },
      { // -Z
        normal: [0, 0, -1],
        corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
      },
    ];

    // Greedy meshing would be better, but simple face culling for now
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const blockId = this.getBlock(x, y, z);
          if (blockId === 0) continue;

          const blockType = getBlockType(blockId);
          if (!blockType) continue;
          // Signs / torches / saplings use custom or plant meshes — skip full cube for some
          if (blockType.isSign || blockType.isTorch) continue;

          const wx = worldX + x;
          const wy = localToWorldY(y); // mesh vertices use world Y
          const wz = worldZ + z;

          // Flowers: two crossed planes (Minecraft-style) instead of a full cube
          if (blockType.isFlower) {
            this.addPlantCross(plantGeometries, wx, wy, wz, blockType);
            continue;
          }

          // Check 6 neighbors (local indices inside chunk)
          const neighbors = [
            this.getBlock(x + 1, y, z),     // +X
            this.getBlock(x - 1, y, z),     // -X
            this.getBlock(x, y + 1, z),     // +Y
            this.getBlock(x, y - 1, z),     // -Y
            this.getBlock(x, y, z + 1),     // +Z
            this.getBlock(x, y, z - 1),     // -Z
          ];

          // Also check neighbor chunks (world Y)
          if (x === CHUNK_SIZE - 1) neighbors[0] = this.world.getBlock(wx + 1, wy, wz);
          if (x === 0) neighbors[1] = this.world.getBlock(wx - 1, wy, wz);
          if (y === CHUNK_HEIGHT - 1) neighbors[2] = this.world.getBlock(wx, wy + 1, wz);
          if (y === 0) neighbors[3] = this.world.getBlock(wx, wy - 1, wz);
          if (z === CHUNK_SIZE - 1) neighbors[4] = this.world.getBlock(wx, wy, wz + 1);
          if (z === 0) neighbors[5] = this.world.getBlock(wx, wy, wz - 1);

          for (let i = 0; i < 6; i++) {
            const neighborId = neighbors[i];
            const neighborType = getBlockType(neighborId);

            // Hide faces into fully opaque solids
            const neighborOpaque = neighborType && isSolid(neighborType) && !isTransparent(neighborType);
            // Cull glass-glass / leaves-leaves
            const neighborSolidTransparent = neighborType && isSolid(neighborType) && isTransparent(neighborType);
            const bothSolidTransparent = isTransparent(blockType) && neighborSolidTransparent;
            // Cull water-water (and liquid-liquid) to reduce murky overdraw
            const bothLiquid = !!(blockType.liquid && neighborType?.liquid);
            const hideFace = neighborOpaque || bothSolidTransparent || bothLiquid;

            if (!hideFace) {
              this.addFace(solidGeometries, transparentGeometries, waterGeometries, wx, wy, wz, FACE_DEFS[i], blockType);
            }
          }
        }
      }
    }

    // Create meshes with shared textured materials
    if (solidGeometries.length > 0) {
      const geometry = this.mergeGeometries(solidGeometries);
      if (geometry) {
        this.mesh = new THREE.Mesh(geometry, getSolidMaterial());
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.userData.chunk = this;
        this.world.scene.add(this.mesh);
      }
    }

    if (transparentGeometries.length > 0) {
      const geometry = this.mergeGeometries(transparentGeometries);
      if (geometry) {
        this.transparentMesh = new THREE.Mesh(geometry, getTransparentMaterial());
        this.transparentMesh.userData.chunk = this;
        this.world.scene.add(this.transparentMesh);
      }
    }

    if (waterGeometries.length > 0) {
      const geometry = this.mergeGeometries(waterGeometries);
      if (geometry) {
        this.waterMesh = new THREE.Mesh(geometry, getWaterMaterial());
        this.waterMesh.userData.chunk = this;
        this.waterMesh.renderOrder = 1; // draw after opaque
        this.world.scene.add(this.waterMesh);
      }
    }

    if (plantGeometries.length > 0) {
      const geometry = this.mergeGeometries(plantGeometries);
      if (geometry) {
        this.plantMesh = new THREE.Mesh(geometry, getPlantMaterial());
        this.plantMesh.userData.chunk = this;
        this.plantMesh.renderOrder = 2;
        this.world.scene.add(this.plantMesh);
      }
    }
  }

  /**
   * Two crossed vertical quads for flowers (X shape when viewed from above).
   * Uses the block texture as a cutout sprite on both diagonals.
   */
  addPlantCross(plantGeos, x, y, z, blockType) {
    const tileName = blockType.texture || 'missing';
    const { u0, v0, u1, v1 } = getTileUV(tileName);
    const shade = 1.0;
    // Slight inset so edges don't z-fight with adjacent cubes
    const inset = 0.05;
    const planes = [
      // diagonal from (0,0)-(1,1) in XZ
      [
        [inset, 0, inset],
        [inset, 1, inset],
        [1 - inset, 1, 1 - inset],
        [1 - inset, 0, 1 - inset],
      ],
      // diagonal from (1,0)-(0,1) in XZ
      [
        [1 - inset, 0, inset],
        [1 - inset, 1, inset],
        [inset, 1, 1 - inset],
        [inset, 0, 1 - inset],
      ],
    ];
    // Flower tile art is drawn with stem at low image-Y (top of canvas) and
    // bloom at high image-Y. CanvasTexture flipY maps image-top → high V, so
    // plant quads must invert V vs cube sides: mesh bottom uses v1, top uses v0.
    const faceUVs = [
      [u0, v1], // bottom
      [u0, v0], // top
      [u1, v0], // top
      [u1, v1], // bottom
    ];

    for (const corners of planes) {
      const geo = new THREE.BufferGeometry();
      const vertices = [];
      const colors = [];
      const uvs = [];
      const normals = [];
      const indices = [];
      // Approximate outward normal for lighting (horizontal)
      const nx = corners[2][0] - corners[0][0];
      const nz = corners[2][2] - corners[0][2];
      const len = Math.hypot(nx, nz) || 1;
      const nnx = -nz / len;
      const nnz = nx / len;

      for (let i = 0; i < 4; i++) {
        const [ox, oy, oz] = corners[i];
        vertices.push(x + ox, y + oy, z + oz);
        colors.push(shade, shade, shade);
        normals.push(nnx, 0, nnz);
        uvs.push(faceUVs[i][0], faceUVs[i][1]);
      }
      indices.push(0, 1, 2, 0, 2, 3);
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      plantGeos.push(geo);
    }
  }

  addFace(solidGeos, transparentGeos, waterGeos, x, y, z, face, blockType) {
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const uvs = [];
    const normals = [];
    const indices = [];

    const { normal, corners } = face;
    const nx = normal[0], ny = normal[1], nz = normal[2];

    // Vertex colors act as a light tint over the atlas texture (keep near-white
    // so textures show their true colors; only mild per-block variation).
    const h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    const variation = 0.92 + ((h & 255) / 255) * 0.12;
    // Slight face shading so sides aren't flat
    const faceShade = ny === 1 ? 1.0 : ny === -1 ? 0.72 : 0.88;
    const shade = variation * faceShade;
    const cr = shade;
    const cg = shade;
    const cb = shade;

    // Atlas UVs for this block face (pass full normal for labeled faces)
    const tileName = tileForFace(blockType, ny, nx, nz);
    const { u0, v0, u1, v1 } = getTileUV(tileName);
    // Match corner winding: 0,1,2,3 → (u0,v0),(u0,v1),(u1,v1),(u1,v0)
    const faceUVs = [
      [u0, v0],
      [u0, v1],
      [u1, v1],
      [u1, v0],
    ];

    for (let i = 0; i < 4; i++) {
      const [ox, oy, oz] = corners[i];
      vertices.push(x + ox, y + oy, z + oz);
      colors.push(cr, cg, cb);
      normals.push(nx, ny, nz);
      uvs.push(faceUVs[i][0], faceUVs[i][1]);
    }

    // CCW winding when viewed along the outward normal
    indices.push(0, 1, 2, 0, 2, 3);

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    if (blockType.liquid) {
      waterGeos.push(geo);
    } else if (isTransparent(blockType)) {
      transparentGeos.push(geo);
    } else {
      solidGeos.push(geo);
    }
  }

  mergeGeometries(geometries) {
    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];
    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    return merged;
  }

  // Smooth value noise: hash lattice points, then bilinearly interpolate.
  // This avoids the white-noise spikes of the old per-point hash.
  _hash(x, z) {
    let h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return (h - Math.floor(h)) * 2 - 1;
  }

  noise2D(x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    // Smoothstep for C1-continuous interpolation
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const a = this._hash(x0, z0);
    const b = this._hash(x0 + 1, z0);
    const c = this._hash(x0, z0 + 1);
    const d = this._hash(x0 + 1, z0 + 1);
    const top = a + (b - a) * u;
    const bot = c + (d - c) * u;
    return top + (bot - top) * v;
  }

  noise3D(x, y, z) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 43.758) * 43758.5453;
    return n - Math.floor(n);
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.collidableMeshes = [];
    /** Persistent edits so unloaded chunks keep dig/place state when reloaded */
    this.overrides = new Map(); // "x,y,z" -> block id
    /** Sign text by block key "x,y,z" */
    this.signs = new Map(); // key -> { text, facing }
    /** Optional callback when a sign is set/cleared: (x,y,z,data|null) */
    this.onSignChange = null;
    /** Optional callback when a torch is placed/removed: (x,y,z,on:boolean) */
    this.onTorchChange = null;
    /** Chest inventories: key "x,y,z" -> { items: Record<string,number> } */
    this.chests = new Map();
  }

  _overrideKey(wx, wy, wz) {
    return `${wx|0},${wy|0},${wz|0}`;
  }

  getSignText(wx, wy, wz) {
    const d = this.signs.get(this._overrideKey(wx, wy, wz));
    if (!d) return '';
    return typeof d === 'string' ? d : (d.text || '');
  }

  getSignFacing(wx, wy, wz) {
    const d = this.signs.get(this._overrideKey(wx, wy, wz));
    if (!d || typeof d === 'string') return 0;
    return d.facing ?? 0;
  }

  /**
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {string} text
   * @param {number} [facing] 0=+Z, 1=-X, 2=-Z, 3=+X
   */
  setSignText(wx, wy, wz, text, facing = 0) {
    const key = this._overrideKey(wx, wy, wz);
    const cleaned = String(text || '').slice(0, 120);
    if (!cleaned) {
      this.signs.delete(key);
      if (this.onSignChange) this.onSignChange(wx | 0, wy | 0, wz | 0, null);
      return;
    }
    const data = { text: cleaned, facing: ((facing % 4) + 4) % 4 };
    this.signs.set(key, data);
    if (this.onSignChange) this.onSignChange(wx | 0, wy | 0, wz | 0, data);
  }

  getChunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  getChunkCoords(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    return { x: cx, z: cz };
  }

  getChunk(cx, cz) {
    const key = this.getChunkKey(cx, cz);
    return this.chunks.get(key);
  }

  getOrCreateChunk(cx, cz) {
    const key = this.getChunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz, this);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** True if block column is inside the 100×100 playable area */
  inBounds(wx, wz) {
    return wx >= WORLD_MIN && wx < WORLD_MAX && wz >= WORLD_MIN && wz < WORLD_MAX;
  }

  /** Clamp a world XZ position into the playable area (with small inset). */
  clampXZ(x, z, inset = 0.3) {
    const lo = WORLD_MIN + inset;
    const hi = WORLD_MAX - inset;
    return {
      x: Math.max(lo, Math.min(hi, x)),
      z: Math.max(lo, Math.min(hi, z)),
    };
  }

  /** Random integer block column inside the world */
  randomBlockXZ() {
    const x = WORLD_MIN + Math.floor(Math.random() * WORLD_SIZE);
    const z = WORLD_MIN + Math.floor(Math.random() * WORLD_SIZE);
    return { x, z };
  }

  /** Random float position centered in a random column */
  randomPosXZ() {
    const { x, z } = this.randomBlockXZ();
    return { x: x + 0.5, z: z + 0.5 };
  }

  getBlock(wx, wy, wz) {
    if (wy < WORLD_Y_MIN || wy >= WORLD_Y_MAX) return 0;
    // Outside the fixed world: treat as unbreakable wall (bedrock)
    if (!this.inBounds(wx, wz)) return BlockTypes.BEDROCK.id;
    const { x: cx, z: cz } = this.getChunkCoords(wx, wz);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return 0;
    return chunk.getWorldBlock(wx, wy, wz);
  }

  getBlockType(id) {
    return getBlockType(id);
  }

  /**
   * Highest solid block + 1 in a column.
   * @param {'earth'|'mars'|'auto'} [layer]
   */
  getSurfaceHeight(wx, wz, layer = 'earth') {
    let yTop;
    let yBot;
    if (layer === 'mars') {
      yTop = MARS_Y_MAX - 1;
      yBot = MARS_Y_MIN;
    } else if (layer === 'auto') {
      yTop = WORLD_Y_MAX - 1;
      yBot = WORLD_Y_MIN;
    } else {
      yTop = EARTH_Y_MAX - 1;
      yBot = EARTH_Y_MIN;
    }
    for (let y = yTop; y >= yBot; y--) {
      const id = this.getBlock(wx, y, wz);
      const type = getBlockType(id);
      if (id !== 0 && type.solid && !type.liquid) return y + 1;
    }
    return layer === 'mars' ? MARS_Y_MIN + 20 : 1;
  }

  setBlock(wx, wy, wz, blockType) {
    if (wy < WORLD_Y_MIN || wy >= WORLD_Y_MAX) return false;
    wx = wx | 0;
    wy = wy | 0;
    wz = wz | 0;
    if (!this.inBounds(wx, wz)) return false;
    // Accept block type name string (e.g. 'STONE', 'AIR') or numeric id
    let blockId = 0;
    if (typeof blockType === 'number') {
      blockId = blockType | 0;
    } else if (typeof blockType === 'string') {
      blockId = BlockTypes[blockType]?.id ?? 0;
    }

    const prevKey = this._overrideKey(wx, wy, wz);
    const prevId = this.getBlock(wx, wy, wz);

    // Always record the override so chunk reloads keep the edit
    this.overrides.set(prevKey, blockId);

    // Clear sign text when the block is destroyed or replaced by a non-sign
    if (blockId !== BlockTypes.SIGN.id) {
      if (this.signs.has(prevKey)) {
        this.signs.delete(prevKey);
        if (this.onSignChange) this.onSignChange(wx, wy, wz, null);
      }
    }
    // Clear chest inventory when chest is removed
    if (blockId !== BlockTypes.CHEST.id && this.chests.has(prevKey)) {
      this.chests.delete(prevKey);
    }
    // Clear furnace state when furnace is removed
    if (blockId !== BlockTypes.FURNACE?.id && this.furnaces?.has(prevKey)) {
      this.furnaces.delete(prevKey);
    }

    const { x: cx, z: cz } = this.getChunkCoords(wx, wz);
    const chunk = this.getOrCreateChunk(cx, cz);
    if (!chunk.generated) {
      chunk.generateTerrain();
      this._applyOverridesToChunk(chunk);
    }
    const changed = chunk.setWorldBlock(wx, wy, wz, blockId);
    // Always dirty when an override is recorded so remesh cannot miss player builds
    this.markChunkDirty(cx, cz);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    if (lx === 0) this.markChunkDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cz);
    if (lz === 0) this.markChunkDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markChunkDirty(cx, cz + 1);

    // Torch lights
    if (this.onTorchChange) {
      if (blockId === BlockTypes.TORCH.id) this.onTorchChange(wx, wy, wz, true);
      else if (prevId === BlockTypes.TORCH.id && blockId !== BlockTypes.TORCH.id) {
        this.onTorchChange(wx, wy, wz, false);
      }
    }
    return changed;
  }

  /**
   * Grow a full oak tree at world coordinates (cross-chunk).
   * Used when a sapling is planted. Overwrites air/leaves/saplings; keeps bedrock/solid builds.
   * @returns {boolean}
   */
  growTreeAt(wx, wy, wz) {
    wx |= 0;
    wy |= 0;
    wz |= 0;
    if (!this.inBounds(wx, wz)) return false;
    if (wy < 1 || wy >= EARTH_Y_MAX - 2) return false;

    const canReplace = (id) => {
      if (id === 0) return true;
      if (id === BlockTypes.LEAVES.id || id === BlockTypes.SAPLING.id) return true;
      if (id === BlockTypes.WATER.id) return true;
      const t = getBlockType(id);
      // Replace non-solid (plants, etc.) but not solid player builds / stone / logs
      return !!(t && !t.solid && !t.unbreakable);
    };

    const trunkHeight = 4 + Math.floor(Math.random() * 3);
    let placed = 0;
    for (let i = 0; i < trunkHeight; i++) {
      const y = wy + i;
      if (y >= EARTH_Y_MAX) break;
      const id = this.getBlock(wx, y, wz);
      if (id === BlockTypes.BEDROCK.id) break;
      // Base of tree always plants; higher trunk only through replaceable blocks
      if (i === 0 || canReplace(id) || id === BlockTypes.WOOD.id) {
        this.setBlock(wx, y, wz, 'WOOD');
        placed++;
      } else {
        break;
      }
    }
    if (placed === 0) return false;

    const leafY = wy + Math.max(2, placed - 1);
    for (let lx = -2; lx <= 2; lx++) {
      for (let lz = -2; lz <= 2; lz++) {
        for (let ly = -1; ly <= 2; ly++) {
          const dist = Math.abs(lx) + Math.abs(lz) + Math.abs(ly);
          if (dist > 4) continue;
          if (dist >= 3 && Math.random() < 0.35) continue;
          const bx = wx + lx;
          const by = leafY + ly;
          const bz = wz + lz;
          if (!this.inBounds(bx, bz) || by < 0 || by >= EARTH_Y_MAX) continue;
          // Keep trunk column as wood
          if (bx === wx && bz === wz && by >= wy && by < wy + placed) continue;
          const id = this.getBlock(bx, by, bz);
          if (canReplace(id) || id === BlockTypes.LEAVES.id) {
            this.setBlock(bx, by, bz, 'LEAVES');
          }
        }
      }
    }
    return true;
  }

  /** True if an oak log exists within Chebyshev distance `range` of (wx,wy,wz). */
  hasLogNearby(wx, wy, wz, range = 4) {
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        for (let dz = -range; dz <= range; dz++) {
          if (this.getBlock(wx + dx, wy + dy, wz + dz) === BlockTypes.WOOD.id) return true;
        }
      }
    }
    return false;
  }

  /**
   * Occasionally decay orphan oak leaves far from logs.
   * Samples a limited number of leaf blocks near the player each call.
   */
  tickLeafDecay(playerX, playerZ, samples = 40) {
    let decayed = 0;
    const baseX = Math.floor(playerX);
    const baseZ = Math.floor(playerZ);
    for (let i = 0; i < samples; i++) {
      const wx = baseX + Math.floor((Math.random() - 0.5) * 48);
      const wz = baseZ + Math.floor((Math.random() - 0.5) * 48);
      if (!this.inBounds(wx, wz)) continue;
      const wy = Math.floor(Math.random() * Math.min(EARTH_Y_MAX, 48));
      if (this.getBlock(wx, wy, wz) !== BlockTypes.LEAVES.id) continue;
      if (this.hasLogNearby(wx, wy, wz, 4)) continue;
      if (Math.random() < 0.18) {
        this.setBlock(wx, wy, wz, 'AIR');
        decayed++;
      }
    }
    return decayed;
  }

  /**
   * True if a grass block is beside (wx,wy,wz) — 4 horizontal neighbors,
   * plus same offsets one block up/down (so slopes can spread).
   */
  hasGrassBeside(wx, wy, wz) {
    const grass = BlockTypes.GRASS.id;
    const offsets = [
      [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
      [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
      [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
    ];
    for (const [dx, dy, dz] of offsets) {
      if (this.getBlock(wx + dx, wy + dy, wz + dz) === grass) return true;
    }
    return false;
  }

  /**
   * Dirt → grass spread: sample dirt near the player; if air is directly above
   * and a grass block is beside it, chance to become grass.
   * @returns {Array<{x:number,y:number,z:number}>} positions that became grass
   */
  tickGrassSpread(playerX, playerZ, samples = 36, chance = 0.22) {
    /** @type {Array<{x:number,y:number,z:number}>} */
    const converted = [];
    const baseX = Math.floor(playerX);
    const baseZ = Math.floor(playerZ);
    const dirt = BlockTypes.DIRT.id;
    // Bias toward surface heights where dirt/grass actually exist
    for (let i = 0; i < samples; i++) {
      const wx = baseX + Math.floor((Math.random() - 0.5) * 40);
      const wz = baseZ + Math.floor((Math.random() - 0.5) * 40);
      if (!this.inBounds(wx, wz)) continue;

      // Prefer near-surface column samples (more dirt tops than random y)
      let wy;
      if (Math.random() < 0.75) {
        const surface = this.getSurfaceHeight(wx, wz);
        // Check a few layers around the surface (player-placed dirt mounds, etc.)
        wy = surface - 1 + Math.floor(Math.random() * 3) - 1;
      } else {
        wy = Math.floor(Math.random() * Math.min(EARTH_Y_MAX - 1, 40)) + 1;
      }
      if (wy < 1 || wy >= EARTH_Y_MAX - 1) continue;

      if (this.getBlock(wx, wy, wz) !== dirt) continue;
      // Air directly above required
      if (this.getBlock(wx, wy + 1, wz) !== 0) continue;
      if (!this.hasGrassBeside(wx, wy, wz)) continue;
      if (Math.random() >= chance) continue;

      this.setBlock(wx, wy, wz, 'GRASS');
      converted.push({ x: wx, y: wy, z: wz });
    }
    return converted;
  }

  /**
   * Water flow: sample water near the player; if a side or below neighbor is air,
   * convert it to water (does not flow upward).
   * @param {number} playerX
   * @param {number} playerY
   * @param {number} playerZ
   * @returns {Array<{x:number,y:number,z:number}>} new water positions
   */
  tickWaterFlow(playerX, playerY, playerZ, samples = 56, chance = 0.6) {
    /** @type {Array<{x:number,y:number,z:number}>} */
    const flowed = [];
    const waterId = BlockTypes.WATER.id;
    // Sides + below only (no +Y / above)
    const sideDirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    const baseX = Math.floor(playerX);
    const baseY = Math.floor(playerY);
    const baseZ = Math.floor(playerZ);

    for (let i = 0; i < samples; i++) {
      const wx = baseX + Math.floor((Math.random() - 0.5) * 48);
      const wz = baseZ + Math.floor((Math.random() - 0.5) * 48);
      if (!this.inBounds(wx, wz)) continue;
      // Sample near player height and common pond band
      let wy;
      if (Math.random() < 0.65) {
        wy = baseY + Math.floor((Math.random() - 0.5) * 12);
      } else {
        wy = 2 + Math.floor(Math.random() * 14);
      }
      if (wy < WORLD_Y_MIN + 1 || wy >= WORLD_Y_MAX - 1) continue;
      if (this.getBlock(wx, wy, wz) !== waterId) continue;
      if (Math.random() > chance) continue;

      // Prefer flowing down first, then sides (random order)
      /** @type {number[][]} */
      let order;
      if (Math.random() < 0.65) {
        order = [[0, -1, 0], ...sideDirs];
        // slight shuffle of sides
        for (let j = order.length - 1; j > 1; j--) {
          const k = 1 + Math.floor(Math.random() * j);
          [order[j], order[k]] = [order[k], order[j]];
        }
      } else {
        order = [...sideDirs, [0, -1, 0]];
        for (let j = order.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [order[j], order[k]] = [order[k], order[j]];
        }
      }

      for (const [dx, dy, dz] of order) {
        const nx = wx + dx;
        const ny = wy + dy;
        const nz = wz + dz;
        if (ny < WORLD_Y_MIN || ny >= WORLD_Y_MAX) continue;
        if (!this.inBounds(nx, nz)) continue;
        if (this.getBlock(nx, ny, nz) !== 0) continue; // only into air
        this.setBlock(nx, ny, nz, 'WATER');
        flowed.push({ x: nx, y: ny, z: nz });
        break; // one spread per source sample
      }
      if (flowed.length >= 28) break;
    }
    return flowed;
  }

  /**
   * Wheat grows upward into air when planted on grass (max 2 blocks tall).
   * Bottom crop on grass; second block appears above when it matures.
   * @returns {Array<{x:number,y:number,z:number}>} new wheat positions
   */
  tickWheatGrowth(playerX, playerZ, samples = 36, chance = 0.18) {
    /** @type {Array<{x:number,y:number,z:number}>} */
    const grew = [];
    const wheatId = BlockTypes.WHEAT?.id;
    const grassId = BlockTypes.GRASS.id;
    if (!wheatId) return grew;
    const baseX = Math.floor(playerX);
    const baseZ = Math.floor(playerZ);
    for (let i = 0; i < samples; i++) {
      const wx = baseX + Math.floor((Math.random() - 0.5) * 40);
      const wz = baseZ + Math.floor((Math.random() - 0.5) * 40);
      if (!this.inBounds(wx, wz)) continue;
      // Prefer near surface
      const surf = this.getSurfaceHeight(wx, wz, 'earth');
      const wy = surf; // crop sits on grass, so y = surface height (block above grass top)
      // Check a few y near surface for wheat planted on grass
      for (const tryY of [wy, wy - 1, wy + 1, 1 + Math.floor(Math.random() * 20)]) {
        if (tryY < 1 || tryY >= EARTH_Y_MAX - 1) continue;
        if (this.getBlock(wx, tryY, wz) !== wheatId) continue;
        // Must have grass (or dirt) under the bottom stalk — if this is already the top
        // of a 2-tall crop, skip (already fully grown)
        const below = this.getBlock(wx, tryY - 1, wz);
        const belowIsWheat = below === wheatId;
        const belowIsSoil = below === grassId || below === BlockTypes.DIRT.id;
        if (belowIsWheat) continue; // this is the upper block — no further growth
        if (!belowIsSoil) continue;
        // Grow into air above (second block)
        if (this.getBlock(wx, tryY + 1, wz) !== 0) continue;
        if (Math.random() >= chance) continue;
        this.setBlock(wx, tryY + 1, wz, 'WHEAT');
        grew.push({ x: wx, y: tryY + 1, z: wz });
        break;
      }
      if (grew.length >= 16) break;
    }
    return grew;
  }

  /**
   * Anacharis grows upward into water occasionally.
   * Samples plant blocks near the player; if WATER is directly above, chance to grow.
   * @returns {Array<{x:number,y:number,z:number}>} new anacharis positions
   */
  tickAnacharisGrowth(playerX, playerZ, samples = 28, chance = 0.14) {
    /** @type {Array<{x:number,y:number,z:number}>} */
    const grew = [];
    const plantId = BlockTypes.ANACHARIS?.id;
    const waterId = BlockTypes.WATER.id;
    if (!plantId) return grew;
    const baseX = Math.floor(playerX);
    const baseZ = Math.floor(playerZ);
    for (let i = 0; i < samples; i++) {
      const wx = baseX + Math.floor((Math.random() - 0.5) * 36);
      const wz = baseZ + Math.floor((Math.random() - 0.5) * 36);
      if (!this.inBounds(wx, wz)) continue;
      // Prefer pond heights (water often y=1..12)
      const wy = 1 + Math.floor(Math.random() * 14);
      if (this.getBlock(wx, wy, wz) !== plantId) continue;
      if (this.getBlock(wx, wy + 1, wz) !== waterId) continue;
      // Cap height: don't grow more than 6 tall from solid floor
      let floorY = wy;
      while (floorY > 0 && this.getBlock(wx, floorY - 1, wz) === plantId) floorY--;
      if (wy - floorY >= 5) continue;
      if (Math.random() >= chance) continue;
      this.setBlock(wx, wy + 1, wz, 'ANACHARIS');
      grew.push({ x: wx, y: wy + 1, z: wz });
    }
    return grew;
  }

  _applyOverridesToChunk(chunk) {
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;
    for (const [key, blockId] of this.overrides) {
      const [x, y, z] = key.split(',').map(Number);
      if (x >= baseX && x < baseX + CHUNK_SIZE && z >= baseZ && z < baseZ + CHUNK_SIZE) {
        chunk.setWorldBlock(x, y, z, blockId);
      }
    }
  }

  /** Re-stamp every saved edit onto generated chunks and mark them dirty for remesh. */
  reapplyAllOverrides() {
    for (const chunk of this.chunks.values()) {
      if (!chunk.generated) continue;
      this._applyOverridesToChunk(chunk);
      chunk.dirty = true;
    }
  }

  /**
   * Snapshot of all player edits for server persistence.
   */
  serializeEdits() {
    const blocks = [];
    for (const [key, blockId] of this.overrides) {
      const [x, y, z] = key.split(',').map(Number);
      if (!this.inBounds(x, z)) continue;
      const name = BlockIdToType[blockId] || 'AIR';
      blocks.push({ x, y, z, block: name });
    }
    const signs = [];
    for (const [key, data] of this.signs) {
      const [x, y, z] = key.split(',').map(Number);
      const text = typeof data === 'string' ? data : data?.text;
      const facing = typeof data === 'object' ? (data.facing ?? 0) : 0;
      if (!text) continue;
      signs.push({ x, y, z, text, facing });
    }
    const chests = [];
    for (const [key, chest] of this.chests) {
      const [x, y, z] = key.split(',').map(Number);
      const items = {};
      for (const [t, n] of Object.entries(chest.items || {})) {
        if (n > 0) items[t] = n;
      }
      chests.push({ x, y, z, items });
    }
    return { blocks, signs, chests };
  }

  /**
   * Load a batch of network/save block edits (after terrain exists).
   * Always re-applies overrides so meshes match the save.
   */
  loadEdits(blocks, signs, chests) {
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (!b || b.block == null) continue;
        this.setBlock(b.x | 0, b.y | 0, b.z | 0, b.block);
      }
    }
    if (Array.isArray(signs)) {
      for (const s of signs) {
        if (!s || !s.text) continue;
        // Ensure SIGN block exists for the sign text overlay
        if (this.getBlock(s.x, s.y, s.z) !== BlockTypes.SIGN.id) {
          this.setBlock(s.x | 0, s.y | 0, s.z | 0, 'SIGN');
        }
        this.setSignText(s.x | 0, s.y | 0, s.z | 0, s.text, s.facing ?? 0);
      }
    }
    if (Array.isArray(chests)) {
      this.chests.clear();
      for (const c of chests) {
        if (!c) continue;
        const items = {};
        if (c.items && typeof c.items === 'object') {
          const keys = Object.keys(c.items).filter((k) => (c.items[k] || 0) > 0);
          for (const k of keys.slice(0, 30)) {
            items[k] = c.items[k];
          }
        }
        this.chests.set(`${c.x|0},${c.y|0},${c.z|0}`, { items });
        if (this.getBlock(c.x, c.y, c.z) !== BlockTypes.CHEST.id) {
          this.setBlock(c.x | 0, c.y | 0, c.z | 0, 'CHEST');
        }
      }
    }
    this.reapplyAllOverrides();
  }

  /**
   * Voxel DDA raycast through integer block cells.
   * Blocks occupy [x,x+1) × [y,y+1) × [z,z+1), matching getBlock/collision.
   * Returns { x, y, z, placeX, placeY, placeZ, normal, blockId, blockType } or null.
   */
  raycast(origin, direction, maxDistance = 6) {
    const dir = direction.clone();
    if (dir.lengthSq() === 0) return null;
    dir.normalize();

    // Current voxel cell
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

    // Distance along ray to first voxel boundary
    let tMaxX = stepX !== 0
      ? ((stepX > 0 ? (x + 1 - origin.x) : (origin.x - x)) / Math.abs(dir.x))
      : Infinity;
    let tMaxY = stepY !== 0
      ? ((stepY > 0 ? (y + 1 - origin.y) : (origin.y - y)) / Math.abs(dir.y))
      : Infinity;
    let tMaxZ = stepZ !== 0
      ? ((stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z)) / Math.abs(dir.z))
      : Infinity;

    let nx = 0, ny = 0, nz = 0;
    let traveled = 0;

    // If we start inside a solid block, step out first without hitting it
    // (so we can always mine the block in front of us)
    const maxSteps = Math.ceil(maxDistance * 3) + 3;

    for (let i = 0; i < maxSteps; i++) {
      if (traveled > maxDistance) return null;

      // Skip the cell we are currently standing inside on the first step only
      // when the origin is inside a non-target block; still allow breaking when
      // looking at neighbors.
      if (i > 0 || this._isMineableAt(x, y, z)) {
        const id = this.getBlock(x, y, z);
        const type = getBlockType(id);
        if (this._isMineableType(type)) {
          return {
            x, y, z,
            placeX: x + nx,
            placeY: y + ny,
            placeZ: z + nz,
            normal: new THREE.Vector3(nx, ny, nz),
            blockId: id,
            blockType: type,
          };
        }
      }

      // Step to next voxel
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          traveled = tMaxX;
          x += stepX;
          tMaxX += tDeltaX;
          nx = -stepX; ny = 0; nz = 0;
        } else {
          traveled = tMaxZ;
          z += stepZ;
          tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          traveled = tMaxY;
          y += stepY;
          tMaxY += tDeltaY;
          nx = 0; ny = -stepY; nz = 0;
        } else {
          traveled = tMaxZ;
          z += stepZ;
          tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      }
    }
    return null;
  }

  _isMineableType(type) {
    if (!type || type.id === 0) return false;
    if (type.liquid) return false;
    if (type.unbreakable) return false;
    // Solids, leaves, glass, etc. — anything that isn't air/liquid/bedrock
    return true;
  }

  _isMineableAt(x, y, z) {
    return this._isMineableType(getBlockType(this.getBlock(x, y, z)));
  }

  canBreak(wx, wy, wz) {
    const id = this.getBlock(wx, wy, wz);
    return this._isMineableType(getBlockType(id));
  }

  markChunkDirty(cx, cz) {
    const chunk = this.getChunk(cx, cz);
    if (chunk) chunk.dirty = true;
  }

  /** Chunk index range covering the fixed 100×100 world */
  getWorldChunkRange() {
    const minC = Math.floor(WORLD_MIN / CHUNK_SIZE);
    const maxC = Math.floor((WORLD_MAX - 1) / CHUNK_SIZE);
    return { minC, maxC };
  }

  /** Generate every chunk in the 100×100 world (call once at startup). */
  generateFullWorld() {
    const { minC, maxC } = this.getWorldChunkRange();
    for (let cx = minC; cx <= maxC; cx++) {
      for (let cz = minC; cz <= maxC; cz++) {
        const chunk = this.getOrCreateChunk(cx, cz);
        if (!chunk.generated) {
          chunk.generateTerrain();
          this._applyOverridesToChunk(chunk);
          chunk.dirty = true;
        }
      }
    }
  }

  generateAround(px, pz, radius) {
    const { x: cx, z: cz } = this.getChunkCoords(px, pz);
    const { minC, maxC } = this.getWorldChunkRange();
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        if (x < minC || x > maxC || z < minC || z > maxC) continue;
        const chunk = this.getOrCreateChunk(x, z);
        if (!chunk.generated) {
          chunk.generateTerrain();
          this._applyOverridesToChunk(chunk);
          chunk.dirty = true;
        }
      }
    }
  }

  updateChunks(playerX, playerZ) {
    const { x: cx, z: cz } = this.getChunkCoords(playerX, playerZ);
    const { minC, maxC } = this.getWorldChunkRange();

    // Ensure chunks near the player exist (full world usually already generated)
    for (let x = cx - RENDER_DISTANCE; x <= cx + RENDER_DISTANCE; x++) {
      for (let z = cz - RENDER_DISTANCE; z <= cz + RENDER_DISTANCE; z++) {
        if (x < minC || x > maxC || z < minC || z > maxC) continue;
        const chunk = this.getOrCreateChunk(x, z);
        if (!chunk.generated) {
          chunk.generateTerrain();
          this._applyOverridesToChunk(chunk);
          chunk.dirty = true;
        }
      }
    }

    // Rebuild dirty meshes
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty) {
        chunk.rebuildMesh();
      }
    }

    // Dispose meshes far from the player to save GPU, but KEEP chunk block data
    // so the fixed 100×100 world stays consistent for toads / food / edits.
    const maxD = RENDER_DISTANCE + 1;
    for (const chunk of this.chunks.values()) {
      const far = Math.abs(chunk.cx - cx) > maxD || Math.abs(chunk.cz - cz) > maxD;
      if (far) {
        if (chunk.mesh || chunk.transparentMesh || chunk.waterMesh || chunk.plantMesh) {
          chunk.dispose();
          chunk.dirty = true; // remesh when player returns
        }
      } else if (
        !chunk.mesh && !chunk.transparentMesh && !chunk.waterMesh && !chunk.plantMesh
        && chunk.generated
      ) {
        // Remesh if we disposed earlier and player walked back
        chunk.dirty = true;
        chunk.rebuildMesh();
      }
    }
  }

  getCollidableMeshes() {
    const meshes = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) meshes.push(chunk.mesh);
      if (chunk.transparentMesh) meshes.push(chunk.transparentMesh);
      if (chunk.waterMesh) meshes.push(chunk.waterMesh);
      if (chunk.plantMesh) meshes.push(chunk.plantMesh);
    }
    return meshes;
  }

  getBlockCount() {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      for (let i = 0; i < chunk.blocks.length; i++) {
        if (chunk.blocks[i] !== 0) count++;
      }
    }
    return count;
  }

  getLoadedChunks() {
    return this.chunks.size;
  }
}