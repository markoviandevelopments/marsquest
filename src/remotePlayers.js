// Remote player avatars + nametags
import * as THREE from 'three';

const BODY_HEIGHT = 1.8;
const BODY_WIDTH = 0.6;
const BODY_DEPTH = 0.4;

function makeNameSprite(username, colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const padX = 12;
  ctx.font = 'bold 28px monospace';
  const textW = ctx.measureText(username).width;
  const bw = Math.min(canvas.width - 8, textW + padX * 2);
  const bh = 40;
  const bx = (canvas.width - bw) / 2;
  const by = (canvas.height - bh) / 2;
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fill();

  // Colored accent bar
  ctx.fillStyle = `#${(colorHex >>> 0).toString(16).padStart(6, '0')}`;
  ctx.fillRect(bx, by + bh - 4, bw, 4);

  // Name
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(username, canvas.width / 2, canvas.height / 2 - 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = BODY_HEIGHT + 0.35;
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<number, { group:THREE.Group, target:THREE.Vector3, yaw:number }>} */
    this.players = new Map();
  }

  /** Remove all remote avatars (e.g. dimension change) */
  clear() {
    for (const id of [...this.players.keys()]) {
      this.remove(id);
    }
  }

  add(player) {
    if (this.players.has(player.id)) {
      this.update(player);
      return;
    }

    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(BODY_WIDTH, BODY_HEIGHT * 0.55, BODY_DEPTH);
    const bodyMat = new THREE.MeshLambertMaterial({ color: player.color || 0x3498db });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = BODY_HEIGHT * 0.35;
    body.castShadow = true;
    group.add(body);

    // Head
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xf5cba7 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = BODY_HEIGHT * 0.75;
    head.castShadow = true;
    group.add(head);

    // Legs (simple)
    const legGeo = new THREE.BoxGeometry(0.22, BODY_HEIGHT * 0.4, 0.28);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.14, BODY_HEIGHT * 0.2, 0);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.14, BODY_HEIGHT * 0.2, 0);
    group.add(leftLeg, rightLeg);

    const nametag = makeNameSprite(player.username || `P${player.id}`, player.color || 0x3498db);
    group.add(nametag);

    group.position.set(player.x || 0, player.y || 0, player.z || 0);
    this.scene.add(group);

    this.players.set(player.id, {
      group,
      target: new THREE.Vector3(player.x || 0, player.y || 0, player.z || 0),
      yaw: player.yaw || 0,
      username: player.username,
    });
  }

  update(data) {
    const entry = this.players.get(data.id);
    if (!entry) {
      this.add(data);
      return;
    }
    if (typeof data.x === 'number') {
      entry.target.set(data.x, data.y, data.z);
    }
    if (typeof data.yaw === 'number') entry.yaw = data.yaw;
  }

  remove(id) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    entry.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this.players.delete(id);
  }

  /** Smoothly interpolate avatars toward their network targets */
  tick(dt) {
    const lerp = 1 - Math.pow(0.001, dt);
    for (const entry of this.players.values()) {
      entry.group.position.lerp(entry.target, Math.min(1, lerp * 12));
      // Yaw: rotate body around Y
      const current = entry.group.rotation.y;
      let diff = entry.yaw - current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      entry.group.rotation.y = current + diff * Math.min(1, lerp * 10);
    }
  }

  list() {
    return [...this.players.entries()].map(([id, e]) => ({
      id,
      username: e.username,
      x: e.group.position.x,
      y: e.group.position.y,
      z: e.group.position.z,
    }));
  }
}
