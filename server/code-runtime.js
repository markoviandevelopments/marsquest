// Code Block + LED runtime: Python workers, face signals, LED lighting.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'code_worker.py');

const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];
const FACE_DELTA = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};
const OPPOSITE = {
  '+x': '-x',
  '-x': '+x',
  '+y': '-y',
  '-y': '+y',
  '+z': '-z',
  '-z': '+z',
};

const DEFAULT_CODE = `# Faces: +x -x +y -y +z -z  (aliases: east west up down south north)
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

function blockKey(x, y, z) {
  return `${x | 0},${y | 0},${z | 0}`;
}

function emptyFaces() {
  return { '+x': false, '-x': false, '+y': false, '-y': false, '+z': false, '-z': false };
}

function parseColor(c) {
  if (typeof c === 'number' && Number.isFinite(c)) {
    return Math.max(0, Math.min(0xffffff, c | 0));
  }
  if (typeof c === 'string') {
    let s = c.trim();
    if (s.startsWith('#')) s = s.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      return parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16);
    }
  }
  return 0xff0000; // default red
}

function findPython() {
  // Prefer PATH python3; fall back to common locations
  return process.env.PYTHON || process.env.PYTHON3 || 'python3';
}

/**
 * @param {{ broadcast: Function, scheduleSave: Function, getBlock: (x,y,z)=>string|null, playerCount: ()=>number }} hooks
 */
export function createCodeRuntime(hooks) {
  /** @type {Map<string, { x:number,y:number,z:number, code:string, faces:Record<string,boolean>, proc:import('child_process').ChildProcess|null, buf:string }>} */
  const codeBlocks = new Map();
  /** @type {Map<string, { x:number,y:number,z:number, color:number, lit:boolean }>} */
  const ledBlocks = new Map();

  let scriptsEnabled = false;
  const pythonBin = findPython();

  function getFaceState(key, face) {
    const cb = codeBlocks.get(key);
    if (!cb) return false;
    return !!cb.faces[face];
  }

  function setFaceState(key, face, value) {
    const cb = codeBlocks.get(key);
    if (!cb || !FACES.includes(face)) return false;
    const on = !!value;
    if (cb.faces[face] === on) return false;
    cb.faces[face] = on;
    return true;
  }

  function neighborKey(x, y, z, face) {
    const d = FACE_DELTA[face];
    if (!d) return null;
    return {
      x: (x | 0) + d[0],
      y: (y | 0) + d[1],
      z: (z | 0) + d[2],
      face,
      opp: OPPOSITE[face],
    };
  }

  function recomputeLedsNear(x, y, z) {
    // Recompute LEDs adjacent to this code block (and the block itself if LED)
    const positions = [[x, y, z]];
    for (const f of FACES) {
      const n = neighborKey(x, y, z, f);
      if (n) positions.push([n.x, n.y, n.z]);
    }
    const changed = [];
    for (const [lx, ly, lz] of positions) {
      const k = blockKey(lx, ly, lz);
      const led = ledBlocks.get(k);
      if (!led) continue;
      const lit = isLedPowered(lx, ly, lz);
      if (led.lit !== lit) {
        led.lit = lit;
        changed.push({ x: lx, y: ly, z: lz, color: led.color, lit: led.lit });
      }
    }
    if (changed.length) {
      hooks.broadcast({ type: 'led_state', leds: changed });
    }
  }

  function isLedPowered(lx, ly, lz) {
    // Lit if any adjacent Code Block has the face pointing toward this LED active
    for (const face of FACES) {
      const n = neighborKey(lx, ly, lz, face);
      if (!n) continue;
      const nk = blockKey(n.x, n.y, n.z);
      // Neighbor's face that touches us is the opposite of the direction we looked
      if (getFaceState(nk, n.opp)) return true;
    }
    return false;
  }

  function recomputeAllLeds() {
    const changed = [];
    for (const led of ledBlocks.values()) {
      const lit = isLedPowered(led.x, led.y, led.z);
      if (led.lit !== lit) {
        led.lit = lit;
        changed.push({ x: led.x, y: led.y, z: led.z, color: led.color, lit: led.lit });
      } else {
        // Still send current state on full recompute for clients joining mid-run
        changed.push({ x: led.x, y: led.y, z: led.z, color: led.color, lit: led.lit });
      }
    }
    if (changed.length) {
      hooks.broadcast({ type: 'led_state', leds: changed });
    }
  }

  function sendToWorker(cb, obj) {
    if (!cb.proc || !cb.proc.stdin || cb.proc.stdin.destroyed) return;
    try {
      cb.proc.stdin.write(JSON.stringify(obj) + '\n');
    } catch {
      // ignore
    }
  }

  function handleWorkerLine(cb, line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.cmd === 'print' || msg.cmd === 'error') {
      const prefix = msg.cmd === 'error' ? '[Code error]' : '[Code]';
      hooks.broadcast({
        type: 'chat',
        system: true,
        text: `${prefix} (${cb.x},${cb.y},${cb.z}) ${String(msg.text || '').slice(0, 200)}`,
      });
      return;
    }

    if (msg.cmd === 'exited') return;

    // Request/response API
    if (msg.id == null) return;
    const rid = msg.id | 0;
    let value = null;

    if (msg.cmd === 'set_face') {
      const face = String(msg.face || '');
      const changed = setFaceState(blockKey(cb.x, cb.y, cb.z), face, !!msg.value);
      value = true;
      if (changed) {
        hooks.broadcast({
          type: 'code_faces',
          x: cb.x,
          y: cb.y,
          z: cb.z,
          faces: { ...cb.faces },
        });
        recomputeLedsNear(cb.x, cb.y, cb.z);
      }
    } else if (msg.cmd === 'get_face') {
      value = getFaceState(blockKey(cb.x, cb.y, cb.z), String(msg.face || ''));
    } else if (msg.cmd === 'read_neighbor') {
      const face = String(msg.face || '');
      const n = neighborKey(cb.x, cb.y, cb.z, face);
      if (n) {
        // Neighbor code block's face touching us
        value = getFaceState(blockKey(n.x, n.y, n.z), n.opp);
      } else {
        value = false;
      }
    }

    sendToWorker(cb, { type: 'reply', id: rid, value });
  }

  function stopWorker(cb) {
    if (!cb) return;
    if (cb.proc) {
      try {
        sendToWorker(cb, { type: 'stop' });
      } catch { /* */ }
      try {
        cb.proc.kill('SIGTERM');
      } catch { /* */ }
      // Force kill shortly after
      const p = cb.proc;
      setTimeout(() => {
        try { p.kill('SIGKILL'); } catch { /* */ }
      }, 400).unref?.();
      cb.proc = null;
    }
    cb.buf = '';
    // Clear faces when halted
    cb.faces = emptyFaces();
  }

  function startWorker(cb) {
    if (!scriptsEnabled) return;
    if (!existsSync(WORKER_PATH)) {
      console.error('[code] worker missing:', WORKER_PATH);
      return;
    }
    stopWorker(cb);
    cb.faces = emptyFaces();
    cb.buf = '';

    let proc;
    try {
      proc = spawn(pythonBin, [WORKER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
    } catch (e) {
      console.error('[code] failed to spawn python:', e.message);
      hooks.broadcast({
        type: 'chat',
        system: true,
        text: `[Code] Python not available (${pythonBin}). Install python3 to run Code Blocks.`,
      });
      return;
    }

    cb.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    proc.stdout.on('data', (chunk) => {
      cb.buf += chunk;
      let idx;
      while ((idx = cb.buf.indexOf('\n')) >= 0) {
        const line = cb.buf.slice(0, idx);
        cb.buf = cb.buf.slice(idx + 1);
        if (line.trim()) handleWorkerLine(cb, line.trim());
      }
    });

    proc.stderr.on('data', (chunk) => {
      const t = String(chunk).trim().slice(0, 200);
      if (t) console.warn(`[code ${cb.x},${cb.y},${cb.z} stderr]`, t);
    });

    proc.on('exit', (code, signal) => {
      if (cb.proc === proc) cb.proc = null;
      // If scripts still enabled and process died unexpectedly, restart after delay
      if (scriptsEnabled && codeBlocks.get(blockKey(cb.x, cb.y, cb.z)) === cb) {
        setTimeout(() => {
          if (scriptsEnabled && codeBlocks.get(blockKey(cb.x, cb.y, cb.z)) === cb && !cb.proc) {
            startWorker(cb);
          }
        }, 1500).unref?.();
      }
    });

    // Start with code
    try {
      proc.stdin.write(JSON.stringify({ type: 'start', code: cb.code || DEFAULT_CODE }) + '\n');
    } catch (e) {
      console.error('[code] stdin write failed', e.message);
    }
  }

  function ensureCodeBlock(x, y, z, code) {
    const key = blockKey(x, y, z);
    let cb = codeBlocks.get(key);
    if (!cb) {
      cb = {
        x: x | 0,
        y: y | 0,
        z: z | 0,
        code: typeof code === 'string' ? code : DEFAULT_CODE,
        faces: emptyFaces(),
        proc: null,
        buf: '',
      };
      codeBlocks.set(key, cb);
    } else if (typeof code === 'string') {
      cb.code = code;
    }
    return cb;
  }

  function removeCodeBlock(x, y, z) {
    const key = blockKey(x, y, z);
    const cb = codeBlocks.get(key);
    if (!cb) return;
    stopWorker(cb);
    codeBlocks.delete(key);
    recomputeLedsNear(x, y, z);
  }

  function ensureLed(x, y, z, color) {
    const key = blockKey(x, y, z);
    let led = ledBlocks.get(key);
    if (!led) {
      led = {
        x: x | 0,
        y: y | 0,
        z: z | 0,
        color: parseColor(color ?? 0xff0000),
        lit: false,
      };
      ledBlocks.set(key, led);
    } else if (color != null) {
      led.color = parseColor(color);
    }
    led.lit = isLedPowered(led.x, led.y, led.z);
    return led;
  }

  function removeLed(x, y, z) {
    const key = blockKey(x, y, z);
    if (!ledBlocks.has(key)) return;
    ledBlocks.delete(key);
    hooks.broadcast({
      type: 'led_state',
      leds: [{ x: x | 0, y: y | 0, z: z | 0, color: 0, lit: false, removed: true }],
    });
  }

  function setCode(x, y, z, code, restart = true) {
    const cb = ensureCodeBlock(x, y, z, String(code ?? '').slice(0, 20000));
    if (restart && scriptsEnabled) {
      startWorker(cb);
    }
    hooks.scheduleSave();
    hooks.broadcast({
      type: 'code_block',
      x: cb.x,
      y: cb.y,
      z: cb.z,
      code: cb.code,
      faces: { ...cb.faces },
    });
    return cb;
  }

  function setLedColor(x, y, z, color) {
    const led = ensureLed(x, y, z, color);
    led.lit = isLedPowered(led.x, led.y, led.z);
    hooks.scheduleSave();
    hooks.broadcast({
      type: 'led_state',
      leds: [{ x: led.x, y: led.y, z: led.z, color: led.color, lit: led.lit }],
    });
    return led;
  }

  function onBlockPlaced(x, y, z, block) {
    if (block === 'CODE_BLOCK') {
      ensureCodeBlock(x, y, z);
      if (scriptsEnabled) {
        const cb = codeBlocks.get(blockKey(x, y, z));
        if (cb && !cb.proc) startWorker(cb);
      }
      hooks.broadcast({
        type: 'code_block',
        x: x | 0,
        y: y | 0,
        z: z | 0,
        code: codeBlocks.get(blockKey(x, y, z))?.code || DEFAULT_CODE,
        faces: emptyFaces(),
      });
      hooks.scheduleSave();
    } else if (block === 'LED') {
      const led = ensureLed(x, y, z, 0xff0000);
      hooks.broadcast({
        type: 'led_state',
        leds: [{ x: led.x, y: led.y, z: led.z, color: led.color, lit: led.lit }],
      });
      hooks.scheduleSave();
    } else {
      // Replaced something
      if (codeBlocks.has(blockKey(x, y, z))) removeCodeBlock(x, y, z);
      if (ledBlocks.has(blockKey(x, y, z))) removeLed(x, y, z);
    }
  }

  function onBlockBroken(x, y, z, prevBlock) {
    if (prevBlock === 'CODE_BLOCK' || codeBlocks.has(blockKey(x, y, z))) {
      removeCodeBlock(x, y, z);
      hooks.scheduleSave();
    }
    if (prevBlock === 'LED' || ledBlocks.has(blockKey(x, y, z))) {
      removeLed(x, y, z);
      hooks.scheduleSave();
    }
  }

  /** Enable scripts when players are present */
  function enableScripts() {
    if (scriptsEnabled) return;
    scriptsEnabled = true;
    console.log(`[code] starting ${codeBlocks.size} Code Block script(s)`);
    for (const cb of codeBlocks.values()) {
      startWorker(cb);
    }
    // LED recompute after faces settle a bit
    setTimeout(() => recomputeAllLeds(), 200).unref?.();
  }

  /** Halt all scripts when world is empty */
  function haltAllScripts() {
    if (!scriptsEnabled && ![...codeBlocks.values()].some((c) => c.proc)) {
      scriptsEnabled = false;
      return;
    }
    console.log('[code] halting all Code Block scripts (no players)');
    scriptsEnabled = false;
    for (const cb of codeBlocks.values()) {
      stopWorker(cb);
    }
    // Clear LED lit states
    const leds = [];
    for (const led of ledBlocks.values()) {
      led.lit = false;
      leds.push({ x: led.x, y: led.y, z: led.z, color: led.color, lit: false });
    }
    if (leds.length) hooks.broadcast({ type: 'led_state', leds });
    // Broadcast cleared faces
    for (const cb of codeBlocks.values()) {
      hooks.broadcast({
        type: 'code_faces',
        x: cb.x,
        y: cb.y,
        z: cb.z,
        faces: emptyFaces(),
      });
    }
  }

  function onPlayerCountChanged(count) {
    if (count <= 0) haltAllScripts();
    else enableScripts();
  }

  function serialize() {
    return {
      codeBlocks: [...codeBlocks.values()].map((c) => ({
        x: c.x,
        y: c.y,
        z: c.z,
        code: c.code,
      })),
      leds: [...ledBlocks.values()].map((l) => ({
        x: l.x,
        y: l.y,
        z: l.z,
        color: l.color,
      })),
    };
  }

  function load(data) {
    codeBlocks.clear();
    ledBlocks.clear();
    if (data && Array.isArray(data.codeBlocks)) {
      for (const c of data.codeBlocks) {
        if (!c) continue;
        ensureCodeBlock(c.x, c.y, c.z, c.code);
      }
    }
    if (data && Array.isArray(data.leds)) {
      for (const l of data.leds) {
        if (!l) continue;
        ensureLed(l.x, l.y, l.z, l.color);
      }
    }
  }

  function snapshotForClient() {
    return {
      codeBlocks: [...codeBlocks.values()].map((c) => ({
        x: c.x,
        y: c.y,
        z: c.z,
        code: c.code,
        faces: { ...c.faces },
      })),
      leds: [...ledBlocks.values()].map((l) => ({
        x: l.x,
        y: l.y,
        z: l.z,
        color: l.color,
        lit: l.lit,
      })),
    };
  }

  function getCode(x, y, z) {
    return codeBlocks.get(blockKey(x, y, z)) || null;
  }

  function getLed(x, y, z) {
    return ledBlocks.get(blockKey(x, y, z)) || null;
  }

  return {
    DEFAULT_CODE,
    ensureCodeBlock,
    ensureLed,
    setCode,
    setLedColor,
    onBlockPlaced,
    onBlockBroken,
    onPlayerCountChanged,
    enableScripts,
    haltAllScripts,
    serialize,
    load,
    snapshotForClient,
    getCode,
    getLed,
    recomputeAllLeds,
  };
}

export { DEFAULT_CODE, parseColor, FACES };
