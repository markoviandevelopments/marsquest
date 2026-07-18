// Day / night cycle with sun + moon lighting
// 5 minutes day, 3 minutes night (8 minute full cycle)
import * as THREE from 'three';

export const DAY_SECONDS = 5 * 60;
export const NIGHT_SECONDS = 3 * 60;
export const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS;

const DAY_SKY = new THREE.Color(0x87ceeb);
const NIGHT_SKY = new THREE.Color(0x0a0a1e);
const DUSK_SKY = new THREE.Color(0xff7a40);
const DAY_FOG = new THREE.Color(0x87ceeb);
const NIGHT_FOG = new THREE.Color(0x0a0a18);

export class DayNightCycle {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {THREE.AmbientLight} opts.ambient
   * @param {THREE.DirectionalLight} opts.sun
   * @param {THREE.Fog} opts.fog
   */
  constructor({ scene, ambient, sun, fog }) {
    this.scene = scene;
    this.ambient = ambient;
    this.sun = sun;
    this.fog = fog;
    /** Seconds into the cycle [0, CYCLE_SECONDS) */
    this.time = DAY_SECONDS * 0.25; // mid-morning start
    this._tmp = new THREE.Color();

    // Moon light (dim cool blue)
    this.moon = new THREE.DirectionalLight(0x6688cc, 0);
    this.moon.position.set(-100, 80, -50);
    scene.add(this.moon);
    scene.add(this.moon.target);

    // Visual sun / moon discs in the sky
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(8, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffee88 })
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xddeeff })
    );
    scene.add(this.sunMesh);
    scene.add(this.moonMesh);
  }

  /** 0..1 through the full day+night cycle */
  get phase() {
    return this.time / CYCLE_SECONDS;
  }

  /** true during the night portion */
  get isNight() {
    return this.time >= DAY_SECONDS;
  }

  /** Day factor 1 at noon, 0 deep night; used for ambient/sun intensity */
  get daylight() {
    if (this.time < DAY_SECONDS) {
      // Smooth day curve peaking at mid-day
      const t = this.time / DAY_SECONDS; // 0..1 through day
      return Math.sin(t * Math.PI) * 0.85 + 0.15;
    }
    // Night: very low ambient
    const t = (this.time - DAY_SECONDS) / NIGHT_SECONDS;
    // slight dusk/dawn at edges
    if (t < 0.08) return 0.15 * (1 - t / 0.08);
    if (t > 0.92) return 0.12 * ((t - 0.92) / 0.08);
    return 0.04;
  }

  /**
   * @param {number} dt
   * @param {{ x:number, y:number, z:number }} playerPos center lights/sun around player
   */
  update(dt, playerPos) {
    this.time = (this.time + dt) % CYCLE_SECONDS;
    const dl = this.daylight;
    const night = this.isNight;

    // Sun arc during day (0..DAY), moon arc during night
    const px = playerPos?.x ?? 50;
    const py = playerPos?.y ?? 40;
    const pz = playerPos?.z ?? 50;

    if (!night) {
      const t = this.time / DAY_SECONDS; // 0 sunrise .. 1 sunset
      const ang = t * Math.PI; // 0..PI
      const dist = 120;
      const sx = px + Math.cos(ang) * dist;
      const sy = py + Math.sin(ang) * dist * 0.9 + 20;
      const sz = pz + 40;
      this.sun.position.set(sx, sy, sz);
      this.sun.target.position.set(px, py, pz);
      this.sun.target.updateMatrixWorld();
      this.sun.intensity = 0.15 + dl * 0.95;
      this.sun.color.setHex(0xfff2d0);
      this.moon.intensity = 0;
      this.sunMesh.position.copy(this.sun.position);
      this.sunMesh.visible = true;
      this.moonMesh.visible = false;
    } else {
      const t = (this.time - DAY_SECONDS) / NIGHT_SECONDS;
      const ang = t * Math.PI;
      const dist = 110;
      const mx = px - Math.cos(ang) * dist;
      const my = py + Math.sin(ang) * dist * 0.85 + 15;
      const mz = pz - 30;
      this.moon.position.set(mx, my, mz);
      this.moon.target.position.set(px, py, pz);
      this.moon.target.updateMatrixWorld();
      this.moon.intensity = 0.12 + Math.sin(ang) * 0.18;
      this.sun.intensity = 0.02;
      this.sunMesh.visible = false;
      this.moonMesh.position.copy(this.moon.position);
      this.moonMesh.visible = true;
    }

    this.ambient.intensity = 0.08 + dl * 0.55;
    this.ambient.color.setHex(night ? 0x334466 : 0xffffff);

    // Sky / fog color
    let sky;
    if (!night) {
      const t = this.time / DAY_SECONDS;
      if (t < 0.12) sky = DUSK_SKY.clone().lerp(DAY_SKY, t / 0.12);
      else if (t > 0.88) sky = DAY_SKY.clone().lerp(DUSK_SKY, (t - 0.88) / 0.12);
      else sky = DAY_SKY.clone();
    } else {
      const t = (this.time - DAY_SECONDS) / NIGHT_SECONDS;
      if (t < 0.1) sky = DUSK_SKY.clone().lerp(NIGHT_SKY, t / 0.1);
      else if (t > 0.9) sky = NIGHT_SKY.clone().lerp(DUSK_SKY, (t - 0.9) / 0.1);
      else sky = NIGHT_SKY.clone();
    }
    this.scene.background.copy(sky);
    if (this.fog) {
      this.fog.color.copy(sky);
      this.fog.near = night ? 8 : 20;
      this.fog.far = night ? 55 : 100;
    }
  }

  /**
   * Skip the night and jump to morning (sunrise).
   * Safe to call during day (snaps to morning anyway).
   * @returns {{ skipped: boolean, message: string }}
   */
  skipToMorning() {
    const wasNight = this.isNight;
    // Early morning / sunrise
    this.time = DAY_SECONDS * 0.08;
    return {
      skipped: wasNight,
      message: wasNight
        ? 'You slept through the night — good morning!'
        : 'You rest a while — the sun is already up.',
    };
  }

  /** Set absolute cycle time (from network sync). */
  setTime(t) {
    if (typeof t !== 'number' || !Number.isFinite(t)) return;
    this.time = ((t % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  }

  serialize() {
    return { time: this.time };
  }

  loadState(data) {
    if (data && typeof data.time === 'number') {
      this.setTime(data.time);
    }
  }

  label() {
    if (!this.isNight) {
      const left = Math.ceil(DAY_SECONDS - this.time);
      return `Day (${left}s left)`;
    }
    const left = Math.ceil(CYCLE_SECONDS - this.time);
    return `Night (${left}s left)`;
  }
}
