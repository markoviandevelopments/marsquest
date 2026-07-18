// Procedural block texture atlas (Minecraft-style 16×16 tiles).
// Generated at runtime so we don't need image assets; ores get stone + speckles.
import * as THREE from 'three';

export const TILE_SIZE = 16;
/** Ordered list of atlas tile names — index = atlas slot */
export const TILE_NAMES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'cobble',
  'sand',
  'log_side',
  'log_top',
  'leaves',
  'planks',
  'glass',
  'bedrock',
  'coal_ore',
  'iron_ore',
  'gold_ore',
  'diamond_ore',
  'water',
  'sign',
  'torch',
  'chest',
  'bed',
  'code_px',
  'code_nx',
  'code_py',
  'code_ny',
  'code_pz',
  'code_nz',
  'led',
  'mars_portal',
  'earth_portal',
  'mars_rock',
  'mars_dust',
  'mars_ice',
  'mars_basalt',
  'mars_crystal',
  'mars_meteorite',
  'mars_magma',
  'mars_brick',
  'rust_ore',
  'alien_fungus',
  'anacharis',
  'cooked_anacharis',
  'furnace',
  'iron_ingot',
  'gold_ingot',
  'coal',
  'wheat',
  'pretzel',
  'missing',
];

const TILE_INDEX = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));

let atlasTexture = null;
let atlasCols = 1;
let atlasRows = 1;

function clampByte(n) {
  return Math.max(0, Math.min(255, n | 0));
}

function hexToRgb(hex) {
  const h = hex >>> 0;
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

function rgb(r, g, b, a = 255) {
  return [clampByte(r), clampByte(g), clampByte(b), clampByte(a)];
}

/** Deterministic 0–1 noise from integer coords */
function hash2(x, y, seed = 0) {
  let n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function setPx(data, size, x, y, col) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  data[i] = col[0];
  data[i + 1] = col[1];
  data[i + 2] = col[2];
  data[i + 3] = col[3] ?? 255;
}

function fillNoise(data, size, baseHex, variation = 18, seed = 0) {
  const [br, bg, bb] = hexToRgb(baseHex);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash2(x, y, seed);
      const n2 = hash2(x + 3, y + 7, seed + 1);
      const d = Math.floor((n - 0.5) * 2 * variation + (n2 - 0.5) * variation * 0.4);
      setPx(data, size, x, y, rgb(br + d, bg + d, bb + d));
    }
  }
}

function fillChecker(data, size, aHex, bHex, cell = 2) {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = ((x / cell) | 0) + ((y / cell) | 0);
      const c = on % 2 === 0 ? a : b;
      const n = (hash2(x, y, 9) - 0.5) * 12;
      setPx(data, size, x, y, rgb(c[0] + n, c[1] + n, c[2] + n));
    }
  }
}

function addSpeckles(data, size, colorHex, count, minSize = 1, maxSize = 2, seed = 0) {
  const col = hexToRgb(colorHex);
  for (let i = 0; i < count; i++) {
    const px = Math.floor(hash2(i, 1, seed) * size);
    const py = Math.floor(hash2(i, 2, seed) * size);
    const r = minSize + Math.floor(hash2(i, 3, seed) * (maxSize - minSize + 1));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r + 0.2) {
          const shade = (hash2(px + dx, py + dy, seed + 4) - 0.5) * 30;
          setPx(data, size, px + dx, py + dy, rgb(col[0] + shade, col[1] + shade, col[2] + shade));
        }
      }
    }
  }
}

function drawGrassTop(data, size) {
  fillNoise(data, size, 0x5d9b3b, 22, 1);
  // blade-ish darker pixels
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash2(i, 0, 11) * size);
    const y = Math.floor(hash2(i, 1, 11) * size);
    setPx(data, size, x, y, rgb(45 + hash2(i, 2, 11) * 40, 110 + hash2(i, 3, 11) * 50, 30));
  }
}

function drawGrassSide(data, size) {
  // dirt bottom + grass strip on top
  fillNoise(data, size, 0x8b6b42, 16, 2);
  const grassH = 4;
  for (let y = 0; y < grassH; y++) {
    for (let x = 0; x < size; x++) {
      const n = (hash2(x, y, 12) - 0.5) * 20;
      const g = y === grassH - 1 ? 0x4a7c2e : 0x5d9b3b;
      const [r, gch, b] = hexToRgb(g);
      setPx(data, size, x, y, rgb(r + n, gch + n, b + n));
    }
  }
  // ragged grass edge
  for (let x = 0; x < size; x++) {
    if (hash2(x, 0, 13) > 0.55) {
      setPx(data, size, x, grassH, rgb(70, 130, 40));
    }
  }
}

function drawStone(data, size) {
  fillNoise(data, size, 0x7a7a7a, 20, 3);
  // cracks
  for (let i = 0; i < 8; i++) {
    let x = Math.floor(hash2(i, 0, 20) * size);
    let y = Math.floor(hash2(i, 1, 20) * size);
    const len = 3 + Math.floor(hash2(i, 2, 20) * 5);
    for (let s = 0; s < len; s++) {
      setPx(data, size, x, y, rgb(55, 55, 55));
      x += hash2(i, s, 21) > 0.5 ? 1 : 0;
      y += hash2(i, s, 22) > 0.4 ? 1 : 0;
    }
  }
}

function drawCobble(data, size) {
  fillNoise(data, size, 0x6e6e6e, 14, 4);
  // stone blob outlines
  const blobs = [
    [2, 2, 5, 4], [8, 1, 5, 5], [1, 8, 6, 5], [9, 9, 5, 5], [5, 6, 4, 3],
  ];
  for (const [bx, by, bw, bh] of blobs) {
    for (let y = by; y < by + bh && y < size; y++) {
      for (let x = bx; x < bx + bw && x < size; x++) {
        const edge = x === bx || y === by || x === bx + bw - 1 || y === by + bh - 1;
        const n = (hash2(x, y, 30) - 0.5) * 25;
        if (edge) setPx(data, size, x, y, rgb(40 + n, 40 + n, 40 + n));
        else setPx(data, size, x, y, rgb(130 + n, 130 + n, 128 + n));
      }
    }
  }
}

function drawLogSide(data, size) {
  // vertical bark stripes
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const stripe = Math.sin(x * 1.2) * 12;
      const n = (hash2(x, y, 40) - 0.5) * 18;
      setPx(data, size, x, y, rgb(100 + stripe + n, 70 + stripe * 0.5 + n, 35 + n));
    }
  }
}

function drawLogTop(data, size) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.sin(dist * 1.8) * 20;
      const n = (hash2(x, y, 41) - 0.5) * 10;
      if (dist < 2) setPx(data, size, x, y, rgb(60 + n, 40 + n, 20 + n));
      else setPx(data, size, x, y, rgb(160 + ring + n, 125 + ring + n, 70 + n));
    }
  }
}

function drawPlanks(data, size) {
  fillNoise(data, size, 0xc49a6c, 12, 5);
  // horizontal plank lines
  for (let y = 0; y < size; y++) {
    if (y % 4 === 0) {
      for (let x = 0; x < size; x++) {
        setPx(data, size, x, y, rgb(90, 65, 35));
      }
    }
    // grain
    for (let x = 0; x < size; x++) {
      if (hash2(x, y, 50) > 0.92) {
        const i = (y * size + x) * 4;
        data[i] = clampByte(data[i] - 25);
        data[i + 1] = clampByte(data[i + 1] - 20);
        data[i + 2] = clampByte(data[i + 2] - 15);
      }
    }
  }
}

function drawLeaves(data, size) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash2(x, y, 60);
      if (n < 0.22) {
        setPx(data, size, x, y, rgb(0, 0, 0, 0)); // holes
      } else {
        const g = 80 + n * 100;
        setPx(data, size, x, y, rgb(30 + n * 40, g, 30 + n * 20, 255));
      }
    }
  }
}

function drawGlass(data, size) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1
        || x === 1 || y === 1 || x === size - 2 || y === size - 2;
      if (edge) setPx(data, size, x, y, rgb(180, 220, 240, 180));
      else setPx(data, size, x, y, rgb(140, 200, 230, 60));
    }
  }
  // highlight
  for (let i = 2; i < 6; i++) {
    setPx(data, size, i, 3, rgb(255, 255, 255, 140));
    setPx(data, size, 3, i, rgb(255, 255, 255, 100));
  }
}

function drawBedrock(data, size) {
  fillChecker(data, size, 0x1a1a1a, 0x333333, 2);
  addSpeckles(data, size, 0x0a0a0a, 12, 1, 2, 70);
}

function drawOre(data, size, speckleHex, count = 14) {
  drawStone(data, size);
  addSpeckles(data, size, speckleHex, count, 1, 2, speckleHex & 255);
}

function drawSand(data, size) {
  fillNoise(data, size, 0xe8d8a8, 14, 6);
  addSpeckles(data, size, 0xd4c48a, 20, 0, 1, 80);
}

function drawDirt(data, size) {
  fillNoise(data, size, 0x8b6b42, 18, 7);
  addSpeckles(data, size, 0x6b4f2e, 16, 1, 1, 81);
  addSpeckles(data, size, 0xa08050, 10, 0, 1, 82);
}

function drawWater(data, size) {
  // More transparent, clearer blue with soft wave variation
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wave = Math.sin(x * 0.7 + y * 0.35) * 12 + Math.cos(x * 0.4 - y * 0.5) * 8;
      const r = 30 + wave * 0.4;
      const g = 110 + wave * 0.6;
      const b = 210 + wave * 0.3;
      // Lower alpha so stacked water reads as see-through
      setPx(data, size, x, y, rgb(r, g, b, 95));
    }
  }
  // faint surface sparkle
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(hash2(i, 2, 91) * size);
    const y = Math.floor(hash2(i, 5, 92) * size);
    setPx(data, size, x, y, rgb(200, 230, 255, 140));
  }
}

function drawSign(data, size) {
  fillNoise(data, size, 0xb8956a, 10, 90);
  // frame
  for (let i = 0; i < size; i++) {
    setPx(data, size, i, 0, rgb(70, 50, 25));
    setPx(data, size, i, size - 1, rgb(70, 50, 25));
    setPx(data, size, 0, i, rgb(70, 50, 25));
    setPx(data, size, size - 1, i, rgb(70, 50, 25));
  }
}

function drawChest(data, size) {
  fillNoise(data, size, 0x8b5a2b, 12, 95);
  // darker border / frame
  for (let i = 0; i < size; i++) {
    setPx(data, size, i, 0, rgb(50, 30, 12));
    setPx(data, size, i, size - 1, rgb(50, 30, 12));
    setPx(data, size, 0, i, rgb(50, 30, 12));
    setPx(data, size, size - 1, i, rgb(50, 30, 12));
  }
  // latch
  for (let y = 6; y <= 9; y++) {
    for (let x = 6; x <= 9; x++) {
      setPx(data, size, x, y, rgb(200, 170, 40));
    }
  }
  // horizontal band
  for (let x = 1; x < size - 1; x++) {
    setPx(data, size, x, 4, rgb(60, 38, 15));
    setPx(data, size, x, 11, rgb(60, 38, 15));
  }
}

/** Code Block face with a label (e.g. "+X") on a circuit-board style background */
function drawCodeFace(data, size, label) {
  // dark PCB-like background
  fillNoise(data, size, 0x1a1a2e, 12, 110);
  // border
  for (let i = 0; i < size; i++) {
    setPx(data, size, i, 0, rgb(80, 200, 120));
    setPx(data, size, i, size - 1, rgb(80, 200, 120));
    setPx(data, size, 0, i, rgb(80, 200, 120));
    setPx(data, size, size - 1, i, rgb(80, 200, 120));
  }
  // chip body
  for (let y = 3; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      setPx(data, size, x, y, rgb(40, 42, 55));
    }
  }
  // simple 3×5 pixel font for face labels
  const glyphs = {
    '+': ['010', '010', '111', '010', '010'],
    '-': ['000', '000', '111', '000', '000'],
    X: ['101', '101', '010', '101', '101'],
    Y: ['101', '101', '010', '010', '010'],
    Z: ['111', '001', '010', '100', '111'],
  };
  const chars = String(label).toUpperCase().split('');
  const glyphW = 3;
  const gap = 1;
  const totalW = chars.length * glyphW + (chars.length - 1) * gap;
  let startX = Math.floor((size - totalW) / 2);
  const startY = Math.floor((size - 5) / 2);
  for (const ch of chars) {
    const g = glyphs[ch];
    if (g) {
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (g[gy][gx] === '1') {
            setPx(data, size, startX + gx, startY + gy, rgb(120, 255, 160));
          }
        }
      }
    }
    startX += glyphW + gap;
  }
}

function drawLed(data, size) {
  // dark housing
  fillNoise(data, size, 0x2a1010, 8, 111);
  // bright dome
  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      const cx = x - 7.5;
      const cy = y - 7.5;
      const d = Math.sqrt(cx * cx + cy * cy);
      if (d < 5.5) {
        const t = 1 - d / 5.5;
        setPx(data, size, x, y, rgb(180 + t * 75, 40 + t * 40, 40 + t * 30));
      }
    }
  }
  // highlight
  setPx(data, size, 5, 5, rgb(255, 200, 200));
  setPx(data, size, 6, 5, rgb(255, 180, 180));
  setPx(data, size, 5, 6, rgb(255, 160, 160));
}

/** Flat "painting" of a bed — same on all faces */
function drawBed(data, size) {
  // wooden frame background
  fillNoise(data, size, 0x6b4423, 10, 96);
  // mattress / blanket body (red)
  for (let y = 3; y <= 11; y++) {
    for (let x = 2; x <= 13; x++) {
      const n = (hash2(x, y, 97) - 0.5) * 20;
      setPx(data, size, x, y, rgb(180 + n, 50 + n * 0.3, 60 + n * 0.2));
    }
  }
  // blanket fold line
  for (let x = 2; x <= 13; x++) {
    setPx(data, size, x, 7, rgb(140, 35, 45));
    setPx(data, size, x, 8, rgb(200, 70, 80));
  }
  // pillow (cream) at top
  for (let y = 3; y <= 6; y++) {
    for (let x = 3; x <= 12; x++) {
      const n = (hash2(x, y, 98) - 0.5) * 15;
      setPx(data, size, x, y, rgb(240 + n * 0.2, 230 + n * 0.2, 210 + n * 0.2));
    }
  }
  // pillow shadow
  for (let x = 3; x <= 12; x++) {
    setPx(data, size, x, 6, rgb(200, 190, 170));
  }
  // wooden posts / frame corners
  for (let y = 2; y <= 12; y++) {
    setPx(data, size, 1, y, rgb(90, 55, 25));
    setPx(data, size, 14, y, rgb(90, 55, 25));
  }
  for (let x = 1; x <= 14; x++) {
    setPx(data, size, x, 2, rgb(90, 55, 25));
    setPx(data, size, x, 12, rgb(70, 42, 18));
  }
  // headboard
  for (let y = 1; y <= 3; y++) {
    for (let x = 2; x <= 13; x++) {
      setPx(data, size, x, y, rgb(100, 60, 28));
    }
  }
}

function drawTorch(data, size) {
  // dark background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPx(data, size, x, y, rgb(20, 18, 15, 0));
    }
  }
  // stick
  for (let y = 4; y < size - 2; y++) {
    for (let x = 6; x <= 9; x++) {
      setPx(data, size, x, y, rgb(90, 55, 25));
    }
  }
  // flame
  for (let y = 1; y < 6; y++) {
    for (let x = 5; x <= 10; x++) {
      const d = Math.abs(x - 7.5) + y * 0.3;
      if (d < 3.5) setPx(data, size, x, y, rgb(255, 180 - y * 15, 40));
    }
  }
  setPx(data, size, 7, 0, rgb(255, 255, 180));
  setPx(data, size, 8, 0, rgb(255, 220, 80));
}

function drawMissing(data, size) {
  fillChecker(data, size, 0xff00ff, 0x000000, 4);
}

function drawMarsRock(data, size) {
  fillNoise(data, size, 0x8b4a32, 22, 201);
  addSpeckles(data, size, 0x5a2e1c, 10, 1, 2, 202);
}

function drawMarsDust(data, size) {
  fillNoise(data, size, 0xc47a4a, 16, 203);
  addSpeckles(data, size, 0xe0a070, 8, 1, 1, 204);
}

function drawPortal(data, size, baseHex, glowHex) {
  fillNoise(data, size, baseHex, 10, 210);
  // swirling frame
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x - 7.5;
      const cy = y - 7.5;
      const d = Math.sqrt(cx * cx + cy * cy);
      const ang = Math.atan2(cy, cx);
      if (d > 5.5 && d < 7.2) {
        const [r, g, b] = hexToRgb(glowHex);
        const n = Math.sin(ang * 4 + d) * 30;
        setPx(data, size, x, y, rgb(r + n, g + n * 0.5, b + n));
      } else if (d <= 5.5) {
        const t = 1 - d / 5.5;
        const [r, g, b] = hexToRgb(glowHex);
        setPx(data, size, x, y, rgb(r * t + 20, g * t * 0.6 + 10, b * t + 40, 200));
      }
    }
  }
  // corner bolts
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) {
    setPx(data, size, x, y, rgb(220, 220, 230));
  }
}

const DRAWERS = {
  grass_top: drawGrassTop,
  grass_side: drawGrassSide,
  dirt: drawDirt,
  stone: drawStone,
  cobble: drawCobble,
  sand: drawSand,
  log_side: drawLogSide,
  log_top: drawLogTop,
  leaves: drawLeaves,
  planks: drawPlanks,
  glass: drawGlass,
  bedrock: drawBedrock,
  coal_ore: (d, s) => drawOre(d, s, 0x1a1a1a, 18),
  iron_ore: (d, s) => drawOre(d, s, 0xd4a574, 16),
  gold_ore: (d, s) => drawOre(d, s, 0xffd700, 16),
  diamond_ore: (d, s) => drawOre(d, s, 0x4cf0e8, 14),
  water: drawWater,
  sign: drawSign,
  torch: drawTorch,
  chest: drawChest,
  bed: drawBed,
  code_px: (d, s) => drawCodeFace(d, s, '+X'),
  code_nx: (d, s) => drawCodeFace(d, s, '-X'),
  code_py: (d, s) => drawCodeFace(d, s, '+Y'),
  code_ny: (d, s) => drawCodeFace(d, s, '-Y'),
  code_pz: (d, s) => drawCodeFace(d, s, '+Z'),
  code_nz: (d, s) => drawCodeFace(d, s, '-Z'),
  led: drawLed,
  mars_portal: (d, s) => drawPortal(d, s, 0x3a1810, 0xff6a30),
  earth_portal: (d, s) => drawPortal(d, s, 0x0a1a30, 0x40a0ff),
  mars_rock: drawMarsRock,
  mars_dust: drawMarsDust,
  mars_ice: (d, s) => {
    fillNoise(d, s, 0xb8d8e8, 12, 220);
    addSpeckles(d, s, 0xffffff, 12, 1, 2, 221);
    // cracks
    for (let i = 0; i < 6; i++) {
      const x = 2 + Math.floor(hash2(i, 3, 222) * 12);
      for (let y = 2; y < 14; y++) {
        if (hash2(x, y, 223) > 0.4) setPx(d, s, x, y, rgb(90, 120, 140));
      }
    }
  },
  mars_basalt: (d, s) => {
    fillNoise(d, s, 0x2e2422, 14, 224);
    addSpeckles(d, s, 0x1a1412, 20, 1, 2, 225);
    // columnar hints
    for (let x = 2; x < 14; x += 3) {
      for (let y = 0; y < s; y++) {
        setPx(d, s, x, y, rgb(40 + (hash2(x, y, 226) * 20), 32, 30));
      }
    }
  },
  mars_crystal: (d, s) => {
    fillNoise(d, s, 0x2a1040, 8, 227);
    for (let y = 1; y < 15; y++) {
      for (let x = 3; x < 13; x++) {
        const cx = Math.abs(x - 7.5);
        const tip = y / 15;
        if (cx < 3.5 * (1 - tip * 0.7)) {
          const t = 1 - cx / 4;
          setPx(d, s, x, y, rgb(140 + t * 80, 60 + t * 40, 220 + t * 30));
        }
      }
    }
    setPx(d, s, 7, 2, rgb(255, 200, 255));
    setPx(d, s, 8, 3, rgb(255, 180, 255));
  },
  mars_meteorite: (d, s) => {
    fillNoise(d, s, 0x2a2a30, 16, 228);
    addSpeckles(d, s, 0x8a7a60, 14, 1, 2, 229);
    addSpeckles(d, s, 0xc0a060, 6, 1, 1, 230);
  },
  mars_magma: (d, s) => {
    fillNoise(d, s, 0x401000, 10, 231);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const n = hash2(x, y, 232);
        if (n > 0.55) setPx(d, s, x, y, rgb(255, 80 + n * 100, 20));
        else if (n > 0.35) setPx(d, s, x, y, rgb(200, 40, 10));
      }
    }
  },
  mars_brick: (d, s) => {
    fillNoise(d, s, 0x7a3828, 8, 233);
    // brick lines
    for (let y = 0; y < s; y++) {
      if (y % 4 === 0) {
        for (let x = 0; x < s; x++) setPx(d, s, x, y, rgb(50, 25, 18));
      }
    }
    for (let y = 0; y < s; y++) {
      const row = Math.floor(y / 4);
      const off = (row % 2) * 4;
      for (let x = off; x < s; x += 8) {
        for (let yy = row * 4 + 1; yy < row * 4 + 4 && yy < s; yy++) {
          setPx(d, s, x, yy, rgb(50, 25, 18));
        }
      }
    }
  },
  rust_ore: (d, s) => {
    fillNoise(d, s, 0x6b3a28, 12, 234);
    addSpeckles(d, s, 0xd2691e, 18, 1, 2, 235);
    addSpeckles(d, s, 0xff8c40, 8, 1, 1, 236);
  },
  alien_fungus: (d, s) => {
    // transparent-ish plant on dark
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) setPx(d, s, x, y, rgb(20, 10, 15, 0));
    }
    // stem
    for (let y = 4; y < 12; y++) {
      setPx(d, s, 7, y, rgb(40, 80, 50));
      setPx(d, s, 8, y, rgb(50, 100, 60));
    }
    // cap
    for (let y = 2; y < 7; y++) {
      for (let x = 4; x < 12; x++) {
        const cx = Math.abs(x - 7.5);
        if (cx < 4 - (y - 2) * 0.5) {
          setPx(d, s, x, y, rgb(80 + hash2(x, y, 237) * 40, 255, 140));
        }
      }
    }
    setPx(d, s, 6, 3, rgb(200, 255, 200));
  },
  anacharis: (d, s) => {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) setPx(d, s, x, y, rgb(10, 30, 40, 0));
    }
    // feathery underwater stems
    for (let i = 0; i < 5; i++) {
      const baseX = 3 + i * 2;
      for (let y = 1; y < 15; y++) {
        const wobble = Math.floor(Math.sin(y * 0.6 + i) * 1.2);
        const x = baseX + wobble;
        if (x >= 0 && x < s) {
          setPx(d, s, x, y, rgb(30 + i * 8, 120 + y * 4, 50));
          if (y % 2 === 0 && x + 1 < s) setPx(d, s, x + 1, y, rgb(40, 160, 70));
        }
      }
    }
  },
  cooked_anacharis: (d, s) => {
    fillNoise(d, s, 0x5a7020, 10, 240);
    addSpeckles(d, s, 0x8a9a40, 10, 1, 2, 241);
    // grill lines
    for (let y = 4; y < 12; y += 2) {
      for (let x = 2; x < 14; x++) setPx(d, s, x, y, rgb(40, 50, 15));
    }
  },
  furnace: (d, s) => {
    fillNoise(d, s, 0x5a5a5a, 10, 242);
    // stone frame
    for (let i = 0; i < s; i++) {
      setPx(d, s, i, 0, rgb(40, 40, 40));
      setPx(d, s, i, 15, rgb(40, 40, 40));
      setPx(d, s, 0, i, rgb(40, 40, 40));
      setPx(d, s, 15, i, rgb(40, 40, 40));
    }
    // fire mouth
    for (let y = 4; y < 11; y++) {
      for (let x = 4; x < 12; x++) {
        const n = hash2(x, y, 243);
        setPx(d, s, x, y, rgb(20, 15, 10));
        if (n > 0.55) setPx(d, s, x, y, rgb(255, 100 + n * 80, 20));
        else if (n > 0.35) setPx(d, s, x, y, rgb(200, 60, 10));
      }
    }
  },
  iron_ingot: (d, s) => {
    fillNoise(d, s, 0x3a3a40, 6, 244);
    for (let y = 5; y < 11; y++) {
      for (let x = 2; x < 14; x++) {
        const n = (hash2(x, y, 245) - 0.5) * 20;
        setPx(d, s, x, y, rgb(180 + n, 180 + n, 190 + n));
      }
    }
    // bevel
    for (let x = 2; x < 14; x++) {
      setPx(d, s, x, 5, rgb(220, 220, 230));
      setPx(d, s, x, 10, rgb(100, 100, 110));
    }
  },
  gold_ingot: (d, s) => {
    fillNoise(d, s, 0x3a3010, 6, 246);
    for (let y = 5; y < 11; y++) {
      for (let x = 2; x < 14; x++) {
        const n = (hash2(x, y, 247) - 0.5) * 25;
        setPx(d, s, x, y, rgb(240 + n * 0.3, 200 + n * 0.3, 40));
      }
    }
    for (let x = 2; x < 14; x++) {
      setPx(d, s, x, 5, rgb(255, 240, 120));
      setPx(d, s, x, 10, rgb(160, 120, 20));
    }
  },
  coal: (d, s) => {
    fillNoise(d, s, 0x1a1a1a, 14, 248);
    addSpeckles(d, s, 0x333333, 12, 1, 2, 249);
    addSpeckles(d, s, 0x0a0a0a, 8, 1, 1, 250);
  },
  wheat: (d, s) => {
    // transparent crop stalks
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) setPx(d, s, x, y, rgb(20, 30, 10, 0));
    }
    // green base stems
    for (let i = 0; i < 6; i++) {
      const sx = 3 + i * 2;
      for (let y = 2; y < 11; y++) {
        const wob = Math.floor(Math.sin(y * 0.5 + i) * 0.8);
        const x = sx + wob;
        if (x >= 0 && x < s) {
          setPx(d, s, x, y, rgb(60 + i * 5, 120 + y * 2, 30));
        }
      }
      // golden heads
      for (let y = 10; y < 15; y++) {
        const x = sx + Math.floor(Math.sin(y + i) * 0.6);
        if (x >= 1 && x < s - 1) {
          setPx(d, s, x, y, rgb(210, 180, 60));
          setPx(d, s, x - 1, y, rgb(190, 160, 50));
          setPx(d, s, x, y - 1, rgb(230, 200, 80));
        }
      }
    }
  },
  pretzel: (data, s) => {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) setPx(data, s, x, y, rgb(30, 20, 10, 0));
    }
    // twisted pretzel ring
    const ring = (cx, cy, rOuter, rInner, col) => {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= rOuter && dist >= rInner) {
            setPx(data, s, x, y, rgb(col[0], col[1], col[2]));
          }
        }
      }
    };
    ring(10, 9, 5.2, 3.2, [200, 130, 50]);
    ring(10, 9, 5.0, 3.5, [160, 95, 35]);
    // salt dots
    for (const [x, y] of [[7, 7], [12, 7], [8, 11], [11, 11], [10, 6], [9, 12]]) {
      setPx(data, s, x, y, rgb(255, 255, 240));
    }
    // bottom twist bar
    for (let x = 6; x <= 14; x++) {
      setPx(data, s, x, 13, rgb(160, 95, 35));
      setPx(data, s, x, 14, rgb(180, 110, 40));
    }
  },
  missing: drawMissing,
};

/**
 * Build (once) and return the shared atlas texture.
 * @returns {THREE.Texture}
 */
export function getAtlasTexture() {
  if (atlasTexture) return atlasTexture;

  const n = TILE_NAMES.length;
  atlasCols = Math.ceil(Math.sqrt(n));
  atlasRows = Math.ceil(n / atlasCols);
  const w = atlasCols * TILE_SIZE;
  const h = atlasRows * TILE_SIZE;
  const pixels = new Uint8Array(w * h * 4);

  TILE_NAMES.forEach((name, index) => {
    const col = index % atlasCols;
    const row = Math.floor(index / atlasCols);
    const tile = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    const drawer = DRAWERS[name] || drawMissing;
    drawer(tile, TILE_SIZE);
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const src = (y * TILE_SIZE + x) * 4;
        const dst = ((row * TILE_SIZE + y) * w + (col * TILE_SIZE + x)) * 4;
        pixels[dst] = tile[src];
        pixels[dst + 1] = tile[src + 1];
        pixels[dst + 2] = tile[src + 2];
        pixels[dst + 3] = tile[src + 3];
      }
    }
  });

  // Prefer canvas in browsers (better sRGB); DataTexture for headless tests
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);
    atlasTexture = new THREE.CanvasTexture(canvas);
  } else {
    atlasTexture = new THREE.DataTexture(pixels, w, h);
    atlasTexture.flipY = false;
  }

  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  if ('colorSpace' in atlasTexture) {
    atlasTexture.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
  }
  atlasTexture.needsUpdate = true;
  return atlasTexture;
}

/**
 * UV quad for a named tile (three.js: v=0 at bottom).
 * Returns [u0, v0, u1, v1] in 0–1 atlas space.
 */
export function getTileUV(tileName) {
  getAtlasTexture();
  const index = TILE_INDEX[tileName] ?? TILE_INDEX.missing;
  const col = index % atlasCols;
  const row = Math.floor(index / atlasCols);
  // inset half a texel to reduce bleeding
  const inset = 0.5 / (atlasCols * TILE_SIZE);
  const u0 = col / atlasCols + inset;
  const u1 = (col + 1) / atlasCols - inset;
  // flip V: atlas row 0 is top of canvas, three.js v0 is bottom
  const v1 = 1 - row / atlasRows - inset;
  const v0 = 1 - (row + 1) / atlasRows + inset;
  return { u0, v0, u1, v1 };
}

/**
 * Pick the texture tile name for a block face.
 * @param {object} blockType
 * @param {number} ny face normal Y (-1, 0, 1)
 * @param {number} [nx=0] face normal X
 * @param {number} [nz=0] face normal Z
 */
export function tileForFace(blockType, ny, nx = 0, nz = 0) {
  if (!blockType) return 'missing';
  // Per-face atlas tiles (Code Block labels)
  if (blockType.faceTextures) {
    let key = null;
    if (nx === 1) key = '+x';
    else if (nx === -1) key = '-x';
    else if (ny === 1) key = '+y';
    else if (ny === -1) key = '-y';
    else if (nz === 1) key = '+z';
    else if (nz === -1) key = '-z';
    if (key && blockType.faceTextures[key]) return blockType.faceTextures[key];
  }
  if (blockType.textures) {
    if (ny === 1) return blockType.textures.top || blockType.textures.side || blockType.texture || 'missing';
    if (ny === -1) return blockType.textures.bottom || blockType.textures.side || blockType.texture || 'missing';
    return blockType.textures.side || blockType.texture || 'missing';
  }
  return blockType.texture || 'missing';
}

/** Shared materials used by chunk meshes */
let solidMat = null;
let transparentMat = null;
let waterMat = null;

export function getSolidMaterial() {
  if (!solidMat) {
    solidMat = new THREE.MeshLambertMaterial({
      map: getAtlasTexture(),
      vertexColors: true,
      side: THREE.FrontSide,
    });
  }
  return solidMat;
}

export function getTransparentMaterial() {
  if (!transparentMat) {
    transparentMat = new THREE.MeshLambertMaterial({
      map: getAtlasTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      side: THREE.FrontSide,
      depthWrite: false,
      alphaTest: 0.02,
    });
  }
  return transparentMat;
}

/** Dedicated water material — more transparent, no depth write (reads clearer underwater) */
export function getWaterMaterial() {
  if (!waterMat) {
    waterMat = new THREE.MeshLambertMaterial({
      map: getAtlasTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      alphaTest: 0.01,
    });
  }
  return waterMat;
}

/**
 * Word-wrap text to fit maxWidth (canvas units), respecting explicit newlines.
 * Long words are hard-broken. Caps at maxLines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} [maxLines=4]
 * @returns {string[]}
 */
export function wrapSignLines(ctx, text, maxWidth, maxLines = 4) {
  const paragraphs = String(text || '').replace(/\r\n/g, '\n').split('\n');
  /** @type {string[]} */
  const lines = [];

  const pushHardBroken = (word) => {
    let rest = word;
    while (rest && lines.length < maxLines) {
      if (ctx.measureText(rest).width <= maxWidth) {
        lines.push(rest);
        return;
      }
      let i = rest.length;
      while (i > 1 && ctx.measureText(rest.slice(0, i)).width > maxWidth) i--;
      lines.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
  };

  for (const para of paragraphs) {
    if (lines.length >= maxLines) break;
    // Preserve empty lines from intentional Enter presses
    if (para === '') {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    let current = '';
    for (const word of words) {
      if (lines.length >= maxLines) break;
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) {
          lines.push(current);
          current = '';
        }
        if (lines.length >= maxLines) break;
        if (ctx.measureText(word).width > maxWidth) {
          pushHardBroken(word);
          current = '';
        } else {
          current = word;
        }
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
  }

  if (lines.length === 0) lines.push('');
  return lines.slice(0, maxLines);
}

/**
 * Create a canvas texture for sign text (for 3D sign boards).
 * Wraps long lines so they fit the board (up to 4 lines).
 * @param {string} text
 * @returns {THREE.CanvasTexture}
 */
export function makeSignTextTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // wood board
  ctx.fillStyle = '#b8956a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#5a3d1e';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  // subtle grain
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.04})`;
    ctx.fillRect(0, Math.random() * canvas.height, canvas.width, 1);
  }

  const padX = 16;
  const maxWidth = canvas.width - padX * 2;
  ctx.font = 'bold 20px monospace';
  const lines = wrapSignLines(ctx, text, maxWidth, 4);

  ctx.fillStyle = '#1a1208';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineH = 24;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line || ' ', canvas.width / 2, startY + i * lineH, maxWidth);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
