// Multiplayer game server — WebSocket hub for players + block edits.
// Single shared world: Earth at y≥0, Mars far below at y≈-200 (same XZ).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadWorldSave, saveWorldSave, getSavePath, migrateLegacyMarsSave, MARS_Y_MIN } from './world-save.js';
import { createCodeRuntime } from './code-runtime.js';

const DAY_SECONDS = 5 * 60;
const MORNING_TIME = DAY_SECONDS * 0.08;

/** Match client vertical bounds */
const WORLD_Y_MIN = MARS_Y_MIN; // -200
const WORLD_Y_MAX = 64;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3010);
const IS_PROD = process.env.NODE_ENV === 'production';
const PUBLIC_HOSTS = (process.env.PUBLIC_HOSTS || 'blockworld.immenseaccumulationonline.online')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);
const WS_PING_MS = 30_000;
const SAVE_DEBOUNCE_MS = 2500;
const CHEST_MAX_TYPES = 30;
const CHAT_HISTORY_MAX = 40;
const YELL_RADIUS = 20; // blocks — players within this distance hear a yell

const ADJECTIVES = [
  'Swift', 'Lucky', 'Brave', 'Clever', 'Mighty', 'Silent', 'Fuzzy', 'Cosmic',
  'Rusty', 'Golden', 'Sneaky', 'Happy', 'Wild', 'Tiny', 'Giant', 'Neon',
  'Stormy', 'Icy', 'Sunny', 'Dusty', 'Pixel', 'Crafty', 'Blocky', 'Miney',
];
const NOUNS = [
  'Creeper', 'Miner', 'Builder', 'Explorer', 'Digger', 'Crafter', 'Nomad',
  'Fox', 'Wolf', 'Panda', 'Steve', 'Alex', 'Golem', 'Ender', 'Phantom',
  'Pickaxe', 'Torch', 'Cobble', 'Diamond', 'Emerald', 'Beacon', 'Portal',
];

function randomUsername(used) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const n = Math.floor(Math.random() * 90) + 10;
    const name = `${adj}${noun}${n}`;
    if (!used.has(name)) return name;
  }
  return `Player${Math.floor(Math.random() * 9000) + 1000}`;
}

function randomColor() {
  const palette = [
    0xe74c3c, 0xe67e22, 0xf1c40f, 0x2ecc71, 0x1abc9c,
    0x3498db, 0x9b59b6, 0xe91e63, 0x00bcd4, 0xff5722,
  ];
  return palette[Math.floor(Math.random() * palette.length)];
}

let nextId = 1;
/** @type {Map<number, any>} */
const players = new Map();
const blockOverrides = new Map();
const signTexts = new Map();
let critterState = null;
let timeState = null;
/** @type {Map<string, { items: Record<string, number> }>} */
const chestInventories = new Map();
const chatHistory = [];
let saveTimer = null;
let saveInFlight = false;
/** @type {ReturnType<typeof createCodeRuntime>|null} */
let codeRuntime = null;
let restoreCodeData = { codeBlocks: [], leds: [] };

function blockKey(x, y, z) {
  return `${x | 0},${y | 0},${z | 0}`;
}

function inY(y) {
  return y >= WORLD_Y_MIN && y < WORLD_Y_MAX;
}

function sanitizeChestItems(raw) {
  const items = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return items;
  for (const [t, n] of Object.entries(raw)) {
    if (typeof t !== 'string' || !t) continue;
    if (t === 'AIR' || t === 'BEDROCK') continue;
    const count = Math.floor(Number(n));
    if (!Number.isFinite(count) || count <= 0) continue;
    items[t] = Math.min(count, 1e9);
    if (Object.keys(items).length >= CHEST_MAX_TYPES) break;
  }
  return items;
}

function chestsToArray() {
  return [...chestInventories.entries()].map(([key, data]) => {
    const [x, y, z] = key.split(',').map(Number);
    return { x, y, z, items: { ...(data.items || {}) } };
  });
}

function setChestInventory(x, y, z, rawItems) {
  const key = blockKey(x, y, z);
  const items = sanitizeChestItems(rawItems);
  chestInventories.set(key, { items });
  return items;
}

function clearChestInventory(x, y, z) {
  const key = blockKey(x, y, z);
  if (!chestInventories.has(key)) return false;
  chestInventories.delete(key);
  return true;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flushSave(); }, SAVE_DEBOUNCE_MS);
}

async function flushSave() {
  if (saveInFlight) {
    scheduleSave();
    return;
  }
  saveInFlight = true;
  try {
    const codeData = codeRuntime ? codeRuntime.serialize() : { codeBlocks: [], leds: [] };
    // Critters are Earth-only — strip any that somehow have y < 0
    let critters = critterState;
    if (critters && typeof critters === 'object') {
      critters = { ...critters };
      if (Array.isArray(critters.toads)) {
        critters.toads = critters.toads.filter((t) => !t || (t.y ?? 0) >= 0);
      }
      if (Array.isArray(critters.foods)) {
        critters.foods = critters.foods.filter((f) => !f || (f.by ?? f.y ?? 0) >= 0);
      }
    }
    // Signs only where SIGN blocks exist (or y>=0 default earth signs)
    await saveWorldSave({
      blocks: [...blockOverrides.entries()].map(([key, block]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, block };
      }),
      signs: [...signTexts.entries()].map(([key, data]) => {
        const [x, y, z] = key.split(',').map(Number);
        if (typeof data === 'string') return { x, y, z, text: data, facing: 0 };
        return { x, y, z, text: data.text, facing: data.facing ?? 0 };
      }),
      critters,
      time: timeState,
      chests: chestsToArray(),
      codeBlocks: codeData.codeBlocks,
      leds: codeData.leds,
    });
  } finally {
    saveInFlight = false;
  }
}

async function restoreFromDisk() {
  const data = await loadWorldSave();
  if (!data) {
    console.log('[save] no existing save at', getSavePath());
  } else {
    if (Array.isArray(data.blocks)) {
      for (const b of data.blocks) {
        if (b && typeof b.block === 'string') {
          blockOverrides.set(blockKey(b.x, b.y, b.z), b.block);
        }
      }
    }
    if (Array.isArray(data.signs)) {
      for (const s of data.signs) {
        if (s && s.text) {
          // Drop signs that were incorrectly saved on Mars (y < 0) without a real placement intent
          // Keep only signs with y >= 0 (Earth) or explicitly on Mars if SIGN block present after migrate
          signTexts.set(blockKey(s.x, s.y, s.z), {
            text: String(s.text).slice(0, 120),
            facing: ((s.facing | 0) % 4 + 4) % 4,
          });
        }
      }
    }
    if (data.critters) {
      // Earth-only critters
      const c = data.critters;
      if (Array.isArray(c.toads)) c.toads = c.toads.filter((t) => !t || (t.y ?? 0) >= 0);
      if (Array.isArray(c.foods)) c.foods = c.foods.filter((f) => !f || (f.by ?? f.y ?? 0) >= 0);
      critterState = c;
    }
    if (data.time) timeState = data.time;
    if (Array.isArray(data.chests)) {
      chestInventories.clear();
      for (const c of data.chests) {
        if (!c) continue;
        setChestInventory(c.x | 0, c.y | 0, c.z | 0, c.items);
      }
    }
    restoreCodeData = {
      codeBlocks: Array.isArray(data.codeBlocks) ? data.codeBlocks : [],
      leds: Array.isArray(data.leds) ? data.leds : [],
    };
    console.log(
      `[save] restored ${blockOverrides.size} blocks, ${signTexts.size} signs,` +
      ` chests=${chestInventories.size}, code=${restoreCodeData.codeBlocks.length},` +
      ` leds=${restoreCodeData.leds.length}`
    );
  }

  // Merge legacy separate Mars file (player builds only; no critters/signs)
  await migrateLegacyMarsSave(blockOverrides);

  // Strip Earth signs that have no SIGN block override (cleanup junk)
  for (const [key, data] of [...signTexts]) {
    const block = blockOverrides.get(key);
    if (block && block !== 'SIGN' && block !== 'AIR') {
      // leave
    }
    // If y < 0 and no SIGN block, remove (copied earth sign metadata)
    const [, ys] = key.split(',');
    const y = Number(ys);
    if (y < 0 && block !== 'SIGN') {
      signTexts.delete(key);
    }
  }
}

function applyBlockOverride(x, y, z, nameBlock) {
  const key = blockKey(x, y, z);
  const prev = blockOverrides.get(key);
  blockOverrides.set(key, nameBlock);
  if (!codeRuntime) return;
  if (nameBlock === 'CODE_BLOCK') {
    codeRuntime.ensureCodeBlock(x, y, z);
  } else if (nameBlock === 'LED') {
    codeRuntime.ensureLed(x, y, z, 0xff0000);
  } else {
    if (prev === 'CODE_BLOCK' || codeRuntime.getCode(x, y, z)) {
      codeRuntime.onBlockBroken(x, y, z, 'CODE_BLOCK');
    }
    if (prev === 'LED' || codeRuntime.getLed(x, y, z)) {
      codeRuntime.onBlockBroken(x, y, z, 'LED');
    }
  }
}

function publicPlayer(p) {
  return {
    id: p.id,
    username: p.username,
    color: p.color,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === 1) p.ws.send(data);
  }
}

function usedNames() {
  return new Set([...players.values()].map((p) => p.username));
}

async function createApp() {
  await restoreFromDisk();

  codeRuntime = createCodeRuntime({
    broadcast: (msg, exceptId = null) => broadcast(msg, exceptId),
    scheduleSave,
    getBlock: (x, y, z) => blockOverrides.get(blockKey(x, y, z)) || null,
    playerCount: () => players.size,
  });
  codeRuntime.load(restoreCodeData);
  for (const [key, block] of blockOverrides) {
    const [x, y, z] = key.split(',').map(Number);
    if (block === 'CODE_BLOCK') codeRuntime.ensureCodeBlock(x, y, z);
    if (block === 'LED') codeRuntime.ensureLed(x, y, z, 0xff0000);
  }

  setInterval(() => {
    if (players.size > 0) flushSave();
  }, 30_000).unref?.();

  process.on('SIGINT', async () => { await flushSave(); process.exit(0); });
  process.on('SIGTERM', async () => { await flushSave(); process.exit(0); });

  let vite = null;
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      root: ROOT,
      server: {
        middlewareMode: true,
        allowedHosts: [
          ...PUBLIC_HOSTS,
          '.immenseaccumulationonline.online',
          'localhost',
          '127.0.0.1',
        ],
        hmr: false,
      },
      appType: 'custom',
    });
  }

  const server = createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (url === '/health' || url.startsWith('/health?')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          players: players.size,
          layout: 'earth_y0_mars_y-200',
          publicHosts: PUBLIC_HOSTS,
          wsPath: '/ws',
        }));
        return;
      }
      if (!IS_PROD && vite) {
        vite.middlewares(req, res, async () => {
          try {
            let html = await readFile(path.join(ROOT, 'index.html'), 'utf-8');
            html = await vite.transformIndexHtml(url, html);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
          } catch (e) {
            vite.ssrFixStacktrace?.(e);
            res.writeHead(500);
            res.end(e.message);
          }
        });
        return;
      }
      const dist = path.join(ROOT, 'dist');
      let filePath = path.join(dist, url === '/' ? 'index.html' : url.split('?')[0]);
      if (!filePath.startsWith(dist)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!existsSync(filePath) || filePath.endsWith('/')) {
        filePath = path.join(dist, 'index.html');
      }
      const ext = path.extname(filePath);
      const types = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      };
      try {
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(await readFile(path.join(dist, 'index.html')));
      }
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

  const pingTimer = setInterval(() => {
    for (const p of players.values()) {
      if (p.ws.readyState === 1) {
        try {
          p.ws.ping();
          send(p.ws, { type: 'ping', t: Date.now() });
        } catch { /* ignore */ }
      }
    }
  }, WS_PING_MS);
  pingTimer.unref?.();

  wss.on('connection', (ws, req) => {
    const id = nextId++;
    const username = randomUsername(usedNames());
    const color = randomColor();
    const player = {
      id, username, color,
      x: 50, y: 40, z: 50, yaw: 0, pitch: 0, ws,
    };
    players.set(id, player);

    send(ws, {
      type: 'welcome',
      id,
      username,
      color,
      players: [...players.values()].filter((p) => p.id !== id).map(publicPlayer),
      blocks: [...blockOverrides.entries()].map(([key, block]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, block };
      }),
      signs: [...signTexts.entries()].map(([key, data]) => {
        const [x, y, z] = key.split(',').map(Number);
        if (typeof data === 'string') return { x, y, z, text: data, facing: 0 };
        return { x, y, z, text: data.text, facing: data.facing ?? 0 };
      }),
      chat: chatHistory.slice(-CHAT_HISTORY_MAX),
      critters: critterState,
      time: timeState,
      chests: chestsToArray(),
      ...(codeRuntime ? codeRuntime.snapshotForClient() : { codeBlocks: [], leds: [] }),
    });

    broadcast({ type: 'player_join', player: publicPlayer(player) }, id);
    broadcast({ type: 'chat', system: true, text: `${username} joined the game` });
    const via = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[+] ${username} (#${id}) — ${players.size} online (via ${via})`);
    codeRuntime?.onPlayerCountChanged(players.size);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'pong':
        case 'ping':
          if (msg.type === 'ping') send(ws, { type: 'pong', t: msg.t || Date.now() });
          break;
        case 'move': {
          if (typeof msg.x === 'number' && typeof msg.y === 'number' && typeof msg.z === 'number') {
            player.x = msg.x;
            player.y = msg.y;
            player.z = msg.z;
            if (typeof msg.yaw === 'number') player.yaw = msg.yaw;
            if (typeof msg.pitch === 'number') player.pitch = msg.pitch;
            broadcast({
              type: 'player_move',
              id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
            }, id);
          }
          break;
        }
        case 'break': {
          const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
          // Unbreakable: earth bedrock y=0 and mars bedrock y=MARS_Y_MIN
          if (y === 0 || y === WORLD_Y_MIN) break;
          if (!inY(y)) break;
          const key = blockKey(x, y, z);
          const prevBlock = blockOverrides.get(key)
            || (codeRuntime?.getCode(x, y, z) ? 'CODE_BLOCK' : null)
            || (codeRuntime?.getLed(x, y, z) ? 'LED' : null);
          blockOverrides.set(key, 'AIR');
          if (signTexts.has(key)) {
            signTexts.delete(key);
            broadcast({ type: 'sign', x, y, z, text: null, by: id });
          }
          if (prevBlock === 'CHEST' || chestInventories.has(key)) {
            clearChestInventory(x, y, z);
            broadcast({ type: 'chest_update', x, y, z, items: null, by: id });
          }
          if (codeRuntime) codeRuntime.onBlockBroken(x, y, z, prevBlock);
          broadcast({ type: 'block_change', x, y, z, block: 'AIR', by: id });
          scheduleSave();
          break;
        }
        case 'place': {
          const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
          const block = typeof msg.block === 'string' ? msg.block : 'STONE';
          if (!inY(y)) break;
          if (block === 'AIR' || block === 'BEDROCK') break;
          const key = blockKey(x, y, z);
          const prevBlock = blockOverrides.get(key);
          blockOverrides.set(key, block);
          if (block !== 'SIGN' && signTexts.has(key)) {
            signTexts.delete(key);
            broadcast({ type: 'sign', x, y, z, text: null, by: id });
          }
          if (prevBlock === 'CHEST' && block !== 'CHEST') {
            clearChestInventory(x, y, z);
            broadcast({ type: 'chest_update', x, y, z, items: null, by: id });
          }
          if (block === 'CHEST' && !chestInventories.has(key)) setChestInventory(x, y, z, {});
          if (codeRuntime) {
            if (prevBlock === 'CODE_BLOCK' && block !== 'CODE_BLOCK') {
              codeRuntime.onBlockBroken(x, y, z, 'CODE_BLOCK');
            }
            if (prevBlock === 'LED' && block !== 'LED') {
              codeRuntime.onBlockBroken(x, y, z, 'LED');
            }
            codeRuntime.onBlockPlaced(x, y, z, block);
          }
          broadcast({ type: 'block_change', x, y, z, block, by: id });
          scheduleSave();
          break;
        }
        case 'code_set': {
          const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
          if (!inY(y) || !codeRuntime) break;
          blockOverrides.set(blockKey(x, y, z), 'CODE_BLOCK');
          codeRuntime.setCode(x, y, z, String(msg.code ?? '').slice(0, 20000), true);
          broadcast({ type: 'block_change', x, y, z, block: 'CODE_BLOCK', by: id });
          scheduleSave();
          break;
        }
        case 'led_set': {
          const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
          if (!inY(y) || !codeRuntime) break;
          blockOverrides.set(blockKey(x, y, z), 'LED');
          codeRuntime.setLedColor(x, y, z, msg.color);
          broadcast({ type: 'block_change', x, y, z, block: 'LED', by: id });
          scheduleSave();
          break;
        }
        case 'chest_set': {
          const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
          if (!inY(y)) break;
          blockOverrides.set(blockKey(x, y, z), 'CHEST');
          const items = setChestInventory(x, y, z, msg.items);
          broadcast({ type: 'chest_update', x, y, z, items, by: id, username: player.username });
          scheduleSave();
          break;
        }
        case 'sign': {
          const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
          const key = blockKey(x, y, z);
          if (msg.text == null || msg.text === '') {
            signTexts.delete(key);
            broadcast({ type: 'sign', x, y, z, text: null, by: id });
          } else {
            const text = String(msg.text).slice(0, 120);
            const facing = ((msg.facing | 0) % 4 + 4) % 4;
            signTexts.set(key, { text, facing });
            blockOverrides.set(key, 'SIGN');
            broadcast({ type: 'block_change', x, y, z, block: 'SIGN', by: id });
            broadcast({ type: 'sign', x, y, z, text, facing, by: id });
          }
          scheduleSave();
          break;
        }
        case 'skip_night': {
          timeState = { time: MORNING_TIME };
          broadcast({ type: 'skip_night', time: MORNING_TIME, by: id, username: player.username });
          broadcast({ type: 'chat', system: true, text: `${player.username} slept in a bed — it is morning!` });
          scheduleSave();
          break;
        }
        case 'world_state': {
          if (Array.isArray(msg.blocks)) {
            for (const b of msg.blocks) {
              if (!b || b.block == null) continue;
              const x = b.x | 0, y = b.y | 0, z = b.z | 0;
              if (!inY(y)) continue;
              const name = String(b.block);
              if (name === 'BEDROCK') continue;
              applyBlockOverride(x, y, z, name);
            }
          }
          if (Array.isArray(msg.signs)) {
            for (const s of msg.signs) {
              if (!s || !s.text) continue;
              const x = s.x | 0, y = s.y | 0, z = s.z | 0;
              // Do not accept Earth story signs onto Mars via bad client snapshots
              // Only store sign if y matches a SIGN placement
              signTexts.set(blockKey(x, y, z), {
                text: String(s.text).slice(0, 120),
                facing: ((s.facing | 0) % 4 + 4) % 4,
              });
              blockOverrides.set(blockKey(x, y, z), 'SIGN');
            }
          }
          // Critters: Earth-only. Ignore snapshots that would place mobs on Mars.
          if (msg.critters && typeof msg.critters === 'object') {
            const c = { ...msg.critters };
            if (Array.isArray(c.toads)) {
              c.toads = c.toads.filter((t) => t && (t.y ?? 0) >= 0);
            }
            if (Array.isArray(c.foods)) {
              c.foods = c.foods.filter((f) => f && (f.by ?? f.y ?? 0) >= 0);
            }
            critterState = c;
          }
          if (msg.time && typeof msg.time === 'object') timeState = msg.time;
          scheduleSave();
          break;
        }
        case 'yell': {
          // A player yells — nearby players (within YELL_RADIUS blocks) hear it,
          // including the yeller themselves.
          const radius = Number(msg.radius) || YELL_RADIUS;
          const r2 = radius * radius;
          const origin = { x: player.x, y: player.y, z: player.z };
          const payload = {
            type: 'yell',
            id,
            username: player.username,
            x: origin.x,
            y: origin.y,
            z: origin.z,
            radius,
          };
          const data = JSON.stringify(payload);
          for (const p of players.values()) {
            if (p.ws.readyState !== 1) continue;
            // The yeller always hears their own yell; others only if within radius.
            if (p.id === id) {
              p.ws.send(data);
              continue;
            }
            const dx = p.x - origin.x;
            const dy = p.y - origin.y;
            const dz = p.z - origin.z;
            if (dx * dx + dy * dy + dz * dz <= r2) {
              p.ws.send(data);
            }
          }
          break;
        }
        case 'chat': {
          const text = String(msg.text || '').trim().slice(0, 200);
          if (!text) break;
          const entry = {
            type: 'chat', id, username: player.username, text, t: Date.now(),
          };
          chatHistory.push(entry);
          if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.shift();
          broadcast(entry);
          break;
        }
        // Ignore legacy dimension protocol
        case 'change_dimension':
          send(ws, {
            type: 'chat',
            system: true,
            text: 'Mars is now far below Earth in the same world — use a Mars Portal (right-click).',
          });
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      players.delete(id);
      broadcast({ type: 'player_leave', id });
      broadcast({ type: 'chat', system: true, text: `${username} left the game` });
      console.log(`[-] ${username} (#${id}) — ${players.size} online`);
      codeRuntime?.onPlayerCountChanged(players.size);
      if (players.size === 0) flushSave();
    });

    ws.on('error', () => {});
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Minecraft clone server on http://0.0.0.0:${PORT} (ws path /ws, prod=${IS_PROD})`);
    console.log('  layout: Earth y≥0 · Mars y≈-200 (same XZ, both always present)');
    for (const h of PUBLIC_HOSTS) {
      console.log(`  public: https://${h}`);
    }
  });
}

createApp().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
