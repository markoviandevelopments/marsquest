// 3D sign boards with editable text (custom mesh only — no chunk cube frame)
import * as THREE from 'three';
import { makeSignTextTexture } from './textures.js';
import { BlockTypes } from './blocks.js';

/** Facing: 0=+Z, 1=-X, 2=-Z, 3=+X — board front points this way (toward placer). */
export const FACING_YAW = [
  0,             // +Z
  Math.PI / 2,   // -X  (board was +Z-local; rotate so front points -X? see below)
  Math.PI,       // -Z
  -Math.PI / 2,  // +X
];

// Board geometry sits on local +Z; group.rotation.y turns that front to world facing.
// facing 0 → front +Z → yaw 0
// facing 1 → front -X → yaw +PI/2 (local +Z goes to +X... wait)
// THREE rotation.y positive = CCW from above: local +Z rotates toward +X? 
// Actually: rotating object by +Y applies: x' = x cos - z sin, z' = x sin + z cos
// Point (0,0,1) after yaw θ: ( -sin θ, 0, cos θ)
// θ=0 → (0,0,1) = +Z
// θ=π/2 → (-1,0,0) = -X
// θ=π → (0,0,-1) = -Z
// θ=-π/2 or 3π/2 → (1,0,0) = +X
// So FACING: 0=+Z→0, 1=-X→π/2, 2=-Z→π, 3=+X→-π/2 ✓

/**
 * Pick a 4-way facing so the sign front points toward the player (text faces them).
 * @param {THREE.Vector3} lookDir camera look direction
 * @returns {number} 0..3
 */
export function facingFromLookDir(lookDir) {
  // Front of sign should face the player ≈ opposite of look direction on XZ
  const fx = -lookDir.x;
  const fz = -lookDir.z;
  if (Math.abs(fx) > Math.abs(fz)) {
    return fx > 0 ? 3 : 1; // +X or -X
  }
  return fz > 0 ? 0 : 2; // +Z or -Z
}

export class SignManager {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./world.js').World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Map<string, THREE.Group>} */
    this.meshes = new Map();

    world.onSignChange = (x, y, z, data) => {
      if (data == null) this.remove(x, y, z);
      else this.upsert(x, y, z, data.text, data.facing ?? 0);
    };
  }

  key(x, y, z) {
    return `${x | 0},${y | 0},${z | 0}`;
  }

  upsert(x, y, z, text, facing = 0) {
    const k = this.key(x, y, z);
    this.remove(x, y, z);

    const group = new THREE.Group();
    group.position.set(x + 0.5, y, z + 0.5);
    group.rotation.y = FACING_YAW[((facing % 4) + 4) % 4];

    const woodMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });

    // Post (centered)
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), woodMat);
    post.position.y = 0.32;
    post.castShadow = true;
    group.add(post);

    // Thick board frame (wood slab) — text plane sits on the front face
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.48, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xa67c4a })
    );
    frame.position.set(0, 0.82, 0.02);
    frame.castShadow = true;
    group.add(frame);

    // Text on the front only (no full-block cube from chunk meshing)
    const tex = makeSignTextTexture(text);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.42),
      new THREE.MeshLambertMaterial({
        map: tex,
        transparent: false,
        side: THREE.FrontSide,
      })
    );
    board.position.set(0, 0.82, 0.055);
    group.add(board);

    this.scene.add(group);
    this.meshes.set(k, group);
  }

  remove(x, y, z) {
    const k = this.key(x, y, z);
    const g = this.meshes.get(k);
    if (!g) return;
    this.scene.remove(g);
    g.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this.meshes.delete(k);
  }

  /** Rebuild visible signs for currently loaded world data */
  syncFromWorld() {
    for (const [key, data] of this.world.signs) {
      const [x, y, z] = key.split(',').map(Number);
      if (this.world.getBlock(x, y, z) === BlockTypes.SIGN.id) {
        const text = typeof data === 'string' ? data : data.text;
        const facing = typeof data === 'object' ? (data.facing ?? 0) : 0;
        this.upsert(x, y, z, text, facing);
      }
    }
  }

  /**
   * Prompt the user for sign text.
   * @returns {Promise<string|null>}
   */
  static async promptText(defaultText = '') {
    const modal = document.getElementById('sign-modal');
    const input = document.getElementById('sign-input');
    const okBtn = document.getElementById('sign-ok');
    const cancelBtn = document.getElementById('sign-cancel');

    if (modal && input && okBtn && cancelBtn) {
      return new Promise((resolve) => {
        modal.classList.add('open');
        // Prefill existing text when editing; do not select-all so user can see content
        const initial = defaultText != null ? String(defaultText) : '';
        input.value = initial;
        input.focus();
        // Place caret at end when editing; select all only for brand-new empty signs
        if (initial) {
          const len = input.value.length;
          input.setSelectionRange(len, len);
        } else {
          input.select();
        }

        const cleanup = () => {
          modal.classList.remove('open');
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          input.removeEventListener('keydown', onKey);
        };
        const onOk = () => {
          // Allow longer multi-line; still cap for network
          const v = input.value.slice(0, 120);
          cleanup();
          resolve(v);
        };
        const onCancel = () => {
          cleanup();
          resolve(null);
        };
        const onKey = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onOk();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
      });
    }

    const v = window.prompt('Sign text:', defaultText ?? '');
    return v === null ? null : v.slice(0, 120);
  }
}
