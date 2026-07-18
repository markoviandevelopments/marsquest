// Client-side Code Block / LED metadata cache

export const DEFAULT_CODE = `# Faces: +x -x +y -y +z -z  (aliases: east west up down south north)
# activate(face) / deactivate(face) / set_face(face, on)
# get_face(face)  — this block's face
# read_neighbor(face) — neighboring Code Block face touching us
# time.sleep(seconds)  — max 60s per call (no import needed)

# Blink +x (east) every half second
while True:
    activate("+x")
    time.sleep(0.5)
    deactivate("+x")
    time.sleep(0.5)
`;

/**
 * @typedef {{ x:number, y:number, z:number, code:string, faces?: Record<string, boolean> }} CodeBlockState
 * @typedef {{ x:number, y:number, z:number, color:number, lit?: boolean }} LedState
 */

export class CodeBlockStore {
  constructor() {
    /** @type {Map<string, CodeBlockState>} */
    this.codes = new Map();
    /** @type {Map<string, LedState>} */
    this.leds = new Map();
  }

  key(x, y, z) {
    return `${x | 0},${y | 0},${z | 0}`;
  }

  getCode(x, y, z) {
    return this.codes.get(this.key(x, y, z)) || null;
  }

  setCode(x, y, z, code, faces) {
    const k = this.key(x, y, z);
    const prev = this.codes.get(k);
    this.codes.set(k, {
      x: x | 0,
      y: y | 0,
      z: z | 0,
      code: typeof code === 'string' ? code : (prev?.code || DEFAULT_CODE),
      faces: faces || prev?.faces || {
        '+x': false, '-x': false, '+y': false, '-y': false, '+z': false, '-z': false,
      },
    });
  }

  setFaces(x, y, z, faces) {
    const k = this.key(x, y, z);
    const prev = this.codes.get(k);
    if (!prev) {
      this.setCode(x, y, z, DEFAULT_CODE, faces);
      return;
    }
    prev.faces = { ...faces };
  }

  removeCode(x, y, z) {
    this.codes.delete(this.key(x, y, z));
  }

  getLed(x, y, z) {
    return this.leds.get(this.key(x, y, z)) || null;
  }

  setLed(x, y, z, color, lit) {
    this.leds.set(this.key(x, y, z), {
      x: x | 0,
      y: y | 0,
      z: z | 0,
      color: (color ?? 0xff0000) | 0,
      lit: !!lit,
    });
  }

  removeLed(x, y, z) {
    this.leds.delete(this.key(x, y, z));
  }

  loadFromWelcome(msg) {
    this.codes.clear();
    this.leds.clear();
    if (Array.isArray(msg.codeBlocks)) {
      for (const c of msg.codeBlocks) {
        if (!c) continue;
        this.setCode(c.x, c.y, c.z, c.code, c.faces);
      }
    }
    if (Array.isArray(msg.leds)) {
      for (const l of msg.leds) {
        if (!l) continue;
        this.setLed(l.x, l.y, l.z, l.color, l.lit);
      }
    }
  }

  colorToHex(color) {
    const n = (color ?? 0xff0000) | 0;
    return `#${n.toString(16).padStart(6, '0')}`;
  }

  hexToColor(hex) {
    let s = String(hex || '#ff0000').trim();
    if (s.startsWith('#')) s = s.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
    return 0xff0000;
  }
}
