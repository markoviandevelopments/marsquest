// Minecraft Clone - Main Entry Point
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  World,
  WORLD_CENTER,
  WORLD_SIZE,
  isOnMars,
  isOnEarth,
  MARS_Y_MIN,
} from './world.js';
import { Player } from './player.js';
import { BlockTypes } from './blocks.js';
import { Network } from './network.js';
import { RemotePlayers } from './remotePlayers.js';
import { MobileControls, isMobileDevice } from './mobileControls.js';
import { Chat } from './chat.js';
import { SignManager, facingFromLookDir } from './signs.js';
import { ToadWorld } from './toads.js';
import { getAtlasTexture } from './textures.js';
import { DayNightCycle } from './dayNight.js';
import { TorchManager } from './torches.js';
import { GameMode, MODE_CREATIVE, MODE_SURVIVAL, MAX_HEALTH, MAX_HUNGER, dropNameFromBlockId } from './gameMode.js';
import { ChickenWorld } from './chickens.js';
import { MarsMobWorld } from './marsMobs.js';
import { FishWorld } from './fish.js';
import {
  getFurnace,
  tickAllFurnaces,
  depositFuel,
  depositInput,
  takeOutput,
  renderFurnaceUI,
  isFuel,
  canSmelt,
} from './furnace.js';
import { GUIDE_SECTIONS } from './guidebook.js';
import { RECIPES, canCraft, craft } from './crafting.js';
import {
  deposit as chestDeposit,
  withdraw as chestWithdraw,
  getChest,
  getChestItemsSnapshot,
  setChestItems,
  removeChest,
  renderChestUI,
  CHEST_MAX_TYPES,
} from './chests.js';
import { CodeBlockStore, DEFAULT_CODE } from './codeBlocks.js';
import { LedManager } from './ledManager.js';
import {
  HOTBAR_SIZE,
  DEFAULT_HOTBAR,
  loadHotbarSlots,
  saveHotbarSlots,
  createInventoryUI,
} from './inventory.js';

// Warm procedural atlas so first chunk mesh has textures ready
getAtlasTexture();

// Game state
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// YXZ order so mobile look + pointer-lock both behave like FPS controls
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Skybox / fog (driven by day/night cycle)
const fog = new THREE.Fog(0x87CEEB, 20, 100);
scene.fog = fog;
scene.background = new THREE.Color(0x87CEEB);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff2d0, 0.85);
sunLight.position.set(100, 200, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -80;
sunLight.shadow.camera.right = 80;
sunLight.shadow.camera.top = 80;
sunLight.shadow.camera.bottom = -80;
scene.add(sunLight);
scene.add(sunLight.target);

// Controls
const controls = new PointerLockControls(camera, document.body);
const blockPreview = document.getElementById('block-preview');
const debugEl = document.getElementById('debug');
const hotbarEl = document.getElementById('hotbar');
const playersEl = document.getElementById('players');
const usernameEl = document.getElementById('username');
const helpEl = document.getElementById('help');

// Game objects
const world = new World(scene);
const player = new Player(camera, controls, world);
const remotePlayers = new RemotePlayers(scene);
const signManager = new SignManager(scene, world);
const torchManager = new TorchManager(scene, world);
const ledManager = new LedManager(scene, world);
const codeStore = new CodeBlockStore();
const toadWorld = new ToadWorld(scene, world);
const chickenWorld = new ChickenWorld(scene, world);
const marsMobs = new MarsMobWorld(scene, world);
const fishWorld = new FishWorld(scene, world);
const dayNight = new DayNightCycle({ scene, ambient: ambientLight, sun: sunLight, fog });
const gameMode = new GameMode();
const network = new Network();

// Hotbar: 10 configurable slots (defaults = common blocks). Full catalog is in inventory GUI.
/** @type {string[]} */
let hotbarSlots = loadHotbarSlots();
let selectedBlockIndex = 0;
let selectedBlockType = hotbarSlots[selectedBlockIndex] || DEFAULT_HOTBAR[0];
let portalCooldown = 0;

/** Cardinal + degrees from camera yaw (YXZ, radians) */
function facingLabel(yawRad) {
  // three.js: yaw 0 looks down -Z; positive yaw turns left (CCW from above)
  let deg = (-yawRad * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const dirs = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
  const idx = Math.round(deg / 45) % 8;
  return { deg, cardinal: dirs[idx] };
}

function syncCodeLedFromWorld() {
  // Ensure every CODE_BLOCK / LED override has client metadata + LED mesh
  for (const [key, id] of world.overrides) {
    const [x, y, z] = key.split(',').map(Number);
    if (id === BlockTypes.CODE_BLOCK.id) {
      if (!codeStore.getCode(x, y, z)) codeStore.setCode(x, y, z, DEFAULT_CODE);
    } else if (id === BlockTypes.LED.id) {
      const led = codeStore.getLed(x, y, z);
      codeStore.setLed(x, y, z, led?.color ?? 0xff0000, !!led?.lit);
      ledManager.set(x, y, z, led?.color ?? 0xff0000, !!led?.lit);
    }
  }
  // Drop orphaned LED overlays / code entries
  for (const [k, entry] of [...codeStore.codes]) {
    const id = world.overrides.get(k);
    if (id !== BlockTypes.CODE_BLOCK.id) codeStore.codes.delete(k);
  }
  for (const [k, entry] of [...codeStore.leds]) {
    const id = world.overrides.get(k);
    if (id !== BlockTypes.LED.id) {
      codeStore.leds.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      ledManager.remove(x, y, z);
    }
  }
  ledManager.rescanWorld();
}

let lastWorldSaveSent = 0;
const WORLD_SAVE_INTERVAL_MS = 12_000;
let wasOnGround = true;
/** Min seconds between sapling plants (prevents hold-RMB consuming many) */
const SAPLING_PLACE_COOLDOWN = 1.0;
let saplingCooldown = 0;

const modeBadgeEl = document.getElementById('mode-badge');
const heartsEl = document.getElementById('hearts');
const hungerEl = document.getElementById('hunger-cheese');
const cheeseInvEl = document.getElementById('cheese-inv') || document.getElementById('nugget-inv');
const gameOverEl = document.getElementById('game-over');
const gameOverReasonEl = document.getElementById('game-over-reason');
const btnRespawn = document.getElementById('btn-respawn');

/** Build matching-size icon pips for hearts / cheese bars */
function renderPips(container, filled, total, fullChar, emptyChar) {
  if (!container) return;
  const parts = [];
  for (let i = 0; i < total; i++) {
    const on = i < filled;
    parts.push(
      `<span class="pip${on ? '' : ' empty'}" aria-hidden="true">${on ? fullChar : emptyChar}</span>`
    );
  }
  container.innerHTML = parts.join('');
}

function refreshVitalsUI() {
  if (modeBadgeEl) {
    modeBadgeEl.textContent = `Mode: ${gameMode.mode.toUpperCase()}`;
  }
  document.body.classList.toggle('survival-mode', gameMode.isSurvival() && !gameMode.dead);
  const h = gameMode.isSurvival() ? gameMode.health : MAX_HEALTH;
  const u = gameMode.isSurvival() ? gameMode.hunger : MAX_HUNGER;
  // Same CSS .pip size for both rows
  renderPips(heartsEl, h, MAX_HEALTH, '❤️', '🖤');
  renderPips(hungerEl, u, MAX_HUNGER, '🧀', '⬜');
  if (cheeseInvEl) {
    const n = gameMode.getCount('CHEESE');
    const nLabel = n === Infinity ? '∞' : n;
    const cooked = gameMode.isCreative() ? '∞' : gameMode.getCount('COOKED_ANACHARIS');
    cheeseInvEl.innerHTML = `Cheese: <b>${nLabel}</b> · Cooked anacharis: <b>${cooked}</b> · <b>C</b> eat · <b>E</b> inv`;
  }
  refreshHotbarCounts();
}

function refreshHotbarCounts() {
  document.querySelectorAll('#hotbar .slot').forEach((slot) => {
    const i = parseInt(slot.dataset.index, 10);
    const type = hotbarSlots[i];
    const countEl = slot.querySelector('.count');
    if (!countEl || !type) return;
    if (gameMode.isCreative()) {
      countEl.textContent = '∞';
    } else {
      countEl.textContent = String(gameMode.getCount(type));
    }
  });
}

gameMode.onChange = () => refreshVitalsUI();

gameMode.onGameOver = (reason) => {
  uiBlocking = true;
  mouse.break = false;
  mouse.place = false;
  if (controls.isLocked) controls.unlock();
  if (gameOverReasonEl) gameOverReasonEl.textContent = reason || 'You died.';
  if (gameOverEl) gameOverEl.classList.add('open');
  document.body.classList.remove('survival-mode');
};

function respawnPlayer() {
  gameMode.respawn();
  if (gameOverEl) gameOverEl.classList.remove('open');
  // Respawn at world center surface (inventory cleared, world kept)
  const sy = world.getSurfaceHeight(WORLD_CENTER, WORLD_CENTER);
  player.position.set(WORLD_CENTER + 0.5, sy, WORLD_CENTER + 0.5);
  player.velocity.set(0, 0, 0);
  player.syncCamera();
  uiBlocking = false;
  refreshVitalsUI();
  if (!mobileMode) setTimeout(() => controls.lock(), 50);
  chat.system('Respawned in Survival with empty inventory.');
}

btnRespawn?.addEventListener('click', (e) => {
  e.preventDefault();
  respawnPlayer();
});

// ---- Pause / Guidebook / Craft ---------------------------------------------
const pauseMenuEl = document.getElementById('pause-menu');
const guidebookEl = document.getElementById('guidebook-panel');
const craftPanelEl = document.getElementById('craft-panel');
const guideNavEl = document.getElementById('guide-nav');
const guideBodyEl = document.getElementById('guide-body');
const craftListEl = document.getElementById('craft-list');
let pauseOpen = false;
let leafDecayTimer = 0;
let grassSpreadTimer = 0;
let anacharisTimer = 0;
let wheatTimer = 0;
let waterFlowTimer = 0;
let furnaceUiTimer = 0;

function anyMenuOpen() {
  return pauseOpen
    || guidebookEl?.classList.contains('open')
    || craftPanelEl?.classList.contains('open')
    || chestPanelEl?.classList.contains('open')
    || furnacePanelEl?.classList.contains('open')
    || codePanelEl?.classList.contains('open')
    || ledPanelEl?.classList.contains('open')
    || inventoryUI?.isOpen?.()
    || chat.isOpen()
    || gameOverEl?.classList.contains('open')
    || document.getElementById('sign-modal')?.classList.contains('open');
}

function openPauseMenu() {
  if (gameMode.dead) return;
  pauseOpen = true;
  uiBlocking = true;
  mouse.break = false;
  mouse.place = false;
  if (controls.isLocked) controls.unlock();
  pauseMenuEl?.classList.add('open');
  pauseMenuEl?.setAttribute('aria-hidden', 'false');
  guidebookEl?.classList.remove('open');
  craftPanelEl?.classList.remove('open');
  document.getElementById('crosshair').style.display = 'none';
}

function closePauseMenu(relock = true) {
  pauseOpen = false;
  pauseMenuEl?.classList.remove('open');
  pauseMenuEl?.setAttribute('aria-hidden', 'true');
  guidebookEl?.classList.remove('open');
  craftPanelEl?.classList.remove('open');
  if (!chat.isOpen() && !gameMode.dead) {
    uiBlocking = false;
    if (relock && !mobileMode) {
      setTimeout(() => {
        if (!anyMenuOpen() && !controls.isLocked) controls.lock();
      }, 40);
    }
  }
}

function openGuidebook() {
  pauseMenuEl?.classList.remove('open');
  craftPanelEl?.classList.remove('open');
  guidebookEl?.classList.add('open');
  buildGuidebook();
}

function openCraft() {
  pauseMenuEl?.classList.remove('open');
  guidebookEl?.classList.remove('open');
  craftPanelEl?.classList.add('open');
  buildCraftList();
}

function buildGuidebook() {
  if (!guideNavEl || !guideBodyEl) return;
  guideNavEl.innerHTML = '';
  GUIDE_SECTIONS.forEach((sec, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sec.title;
    b.dataset.id = sec.id;
    if (i === 0) b.classList.add('active');
    b.addEventListener('click', () => {
      guideNavEl.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      guideBodyEl.innerHTML = `<h3>${sec.title}</h3>${sec.body}`;
    });
    guideNavEl.appendChild(b);
  });
  const first = GUIDE_SECTIONS[0];
  if (first) guideBodyEl.innerHTML = `<h3>${first.title}</h3>${first.body}`;
}

function buildCraftList() {
  if (!craftListEl) return;
  craftListEl.innerHTML = '';
  for (const recipe of RECIPES) {
    const check = canCraft(gameMode, recipe);
    const div = document.createElement('div');
    div.className = 'recipe';
    const need = Object.entries(recipe.inputs)
      .map(([k, n]) => `${n}× ${BlockTypes[k]?.name || k} (have ${gameMode.isCreative() ? '∞' : gameMode.getCount(k)})`)
      .join(', ');
    div.innerHTML = `
      <h4>${recipe.name}</h4>
      <p>${recipe.description}</p>
      <div class="meta">Requires: ${need}</div>
    `;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = check.ok ? 'Craft' : 'Missing materials';
    btn.disabled = !check.ok;
    btn.addEventListener('click', () => {
      const result = craft(gameMode, recipe);
      chat.system(result.message);
      if (result.ok) {
        refreshHotbarCounts();
        selectBlock(selectedBlockIndex);
        buildCraftList();
        pushWorldSave(true);
      }
    });
    div.appendChild(btn);
    craftListEl.appendChild(div);
  }
}

document.getElementById('btn-resume')?.addEventListener('click', () => closePauseMenu(true));
document.getElementById('btn-guidebook')?.addEventListener('click', () => openGuidebook());
document.getElementById('btn-craft')?.addEventListener('click', () => openCraft());
document.getElementById('btn-menu-save')?.addEventListener('click', () => {
  pushWorldSave(true);
  chat.system('World saved.');
});
document.getElementById('btn-guide-back')?.addEventListener('click', () => {
  guidebookEl?.classList.remove('open');
  pauseMenuEl?.classList.add('open');
});
document.getElementById('btn-craft-back')?.addEventListener('click', () => {
  craftPanelEl?.classList.remove('open');
  pauseMenuEl?.classList.add('open');
});

// ---- Chest UI --------------------------------------------------------------
const chestPanelEl = document.getElementById('chest-panel');
const chestBodyEl = document.getElementById('chest-body');
let openChestPos = null; // { x, y, z }

function openChestAt(x, y, z) {
  openChestPos = { x: x | 0, y: y | 0, z: z | 0 };
  uiBlocking = true;
  mouse.break = false;
  mouse.place = false;
  pauseMenuEl?.classList.remove('open');
  pauseOpen = false;
  guidebookEl?.classList.remove('open');
  craftPanelEl?.classList.remove('open');
  // Mark open before unlock so pause menu does not steal focus
  chestPanelEl?.classList.add('open');
  chestPanelEl?.setAttribute('aria-hidden', 'false');
  if (controls.isLocked) controls.unlock();
  refreshChestUI();
}

function closeChest(relock = true) {
  openChestPos = null;
  chestPanelEl?.classList.remove('open');
  chestPanelEl?.setAttribute('aria-hidden', 'true');
  if (!chat.isOpen() && !gameMode.dead && !pauseOpen) {
    uiBlocking = false;
    if (relock && !mobileMode) {
      setTimeout(() => {
        if (!anyMenuOpen() && !controls.isLocked) controls.lock();
      }, 40);
    }
  }
  pushWorldSave(true);
}

// ---- Furnace UI ------------------------------------------------------------
const furnacePanelEl = document.getElementById('furnace-panel');
const furnaceBodyEl = document.getElementById('furnace-body');
let openFurnacePos = null; // { x, y, z }

function openFurnaceAt(x, y, z) {
  openFurnacePos = { x: x | 0, y: y | 0, z: z | 0 };
  getFurnace(world, x, y, z);
  uiBlocking = true;
  mouse.break = false;
  mouse.place = false;
  pauseMenuEl?.classList.remove('open');
  pauseOpen = false;
  chestPanelEl?.classList.remove('open');
  furnacePanelEl?.classList.add('open');
  furnacePanelEl?.setAttribute('aria-hidden', 'false');
  if (controls.isLocked) controls.unlock();
  refreshFurnaceUI();
}

function closeFurnace(relock = true) {
  openFurnacePos = null;
  furnacePanelEl?.classList.remove('open');
  furnacePanelEl?.setAttribute('aria-hidden', 'true');
  if (!chat.isOpen() && !gameMode.dead && !pauseOpen) {
    uiBlocking = false;
    if (relock && !mobileMode) {
      setTimeout(() => {
        if (!anyMenuOpen() && !controls.isLocked) controls.lock();
      }, 40);
    }
  }
}

function refreshFurnaceUI() {
  if (!openFurnacePos || !furnaceBodyEl) return;
  const f = getFurnace(world, openFurnacePos.x, openFurnacePos.y, openFurnacePos.z);
  furnaceBodyEl.innerHTML = renderFurnaceUI(f);
  furnaceBodyEl.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const act = btn.getAttribute('data-act');
      handleFurnaceAction(act);
    });
  });
}

function handleFurnaceAction(act) {
  if (!openFurnacePos) return;
  const f = getFurnace(world, openFurnacePos.x, openFurnacePos.y, openFurnacePos.z);
  if (act === 'add-fuel') {
    if (!isFuel(selectedBlockType)) {
      chat.system('Select Oak Log or Oak Planks in the hotbar for fuel');
      return;
    }
    if (gameMode.isSurvival()) {
      if (!gameMode.canPlace(selectedBlockType) || !gameMode.consumeItem(selectedBlockType, 1)) {
        chat.system('No fuel in inventory');
        return;
      }
    }
    if (!depositFuel(f, selectedBlockType, 1)) {
      if (gameMode.isSurvival()) gameMode.addItem(selectedBlockType, 1);
      chat.system('Cannot mix fuel types — empty the furnace fuel first');
      return;
    }
    chat.system(`Added ${BlockTypes[selectedBlockType].name} as fuel`);
    refreshHotbarCounts();
  } else if (act === 'add-input') {
    if (!canSmelt(selectedBlockType)) {
      chat.system('Select anacharis, sand, or an ore to smelt');
      return;
    }
    if (gameMode.isSurvival()) {
      if (!gameMode.canPlace(selectedBlockType) || !gameMode.consumeItem(selectedBlockType, 1)) {
        chat.system('Nothing to cook in inventory');
        return;
      }
    }
    if (!depositInput(f, selectedBlockType, 1)) {
      if (gameMode.isSurvival()) gameMode.addItem(selectedBlockType, 1);
      chat.system('Cannot mix cook items — empty the input first');
      return;
    }
    chat.system(`Cooking ${BlockTypes[selectedBlockType].name}…`);
    refreshHotbarCounts();
  } else if (act === 'take-output') {
    const out = takeOutput(f);
    if (!out) {
      chat.system('Furnace output is empty');
      return;
    }
    if (gameMode.isSurvival()) gameMode.addItem(out.type, out.count);
    chat.system(`Took ${out.count}× ${BlockTypes[out.type]?.name || out.type}`);
    refreshHotbarCounts();
    refreshVitalsUI();
  }
  refreshFurnaceUI();
}

document.getElementById('btn-furnace-close')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeFurnace(true);
});

/** Push this chest's contents to the server so all players + saves stay in sync. */
function syncChestToServer(x, y, z) {
  network.sendChestSet(x, y, z, getChestItemsSnapshot(world, x, y, z));
}

function refreshChestUI() {
  if (!openChestPos || !chestBodyEl) return;
  const { x, y, z } = openChestPos;
  renderChestUI(chestBodyEl, world, x, y, z, gameMode, {
    onDeposit: (amount) => {
      const type = selectedBlockType;
      if (!type || type === 'AIR') {
        chat.system('Select a hotbar item to deposit');
        return;
      }
      if (type === 'CHEESE') {
        // allow cheese
      }
      let n;
      if (gameMode.isCreative()) {
        n = amount === 'all' ? 64 : 1;
      } else {
        const have = gameMode.getCount(type);
        if (have <= 0) {
          chat.system(`No ${BlockTypes[type]?.name || type} to deposit`);
          return;
        }
        n = amount === 'all' ? have : Math.min(1, have);
      }
      const res = chestDeposit(world, x, y, z, type, n);
      if (!res.ok) {
        chat.system(res.message);
        return;
      }
      if (gameMode.isSurvival()) gameMode.consumeItem(type, res.deposited);
      refreshChestUI();
      refreshHotbarCounts();
      selectBlock(selectedBlockIndex);
      syncChestToServer(x, y, z);
    },
    onWithdraw: (type, amount) => {
      const res = chestWithdraw(world, x, y, z, type, amount);
      if (!res.ok || res.taken <= 0) {
        chat.system(res.message || 'Nothing taken');
        return;
      }
      if (gameMode.isSurvival()) {
        gameMode.addItem(type, res.taken);
      }
      // Creative: still add to tracked bag for feedback (counts ignored when placing)
      else {
        gameMode.addItem(type, res.taken);
      }
      chat.system(res.message);
      refreshChestUI();
      refreshHotbarCounts();
      selectBlock(selectedBlockIndex);
      syncChestToServer(x, y, z);
    },
  });
}

document.getElementById('btn-chest-close')?.addEventListener('click', () => closeChest(true));

// ---- Code Block + LED GUIs -------------------------------------------------
const codePanelEl = document.getElementById('code-panel');
const codeInputEl = document.getElementById('code-input');
const ledPanelEl = document.getElementById('led-panel');
const ledColorEl = document.getElementById('led-color');
let openCodePos = null;
let openLedPos = null;

function openCodeEditor(x, y, z) {
  openCodePos = { x: x | 0, y: y | 0, z: z | 0 };
  uiBlocking = true;
  mouse.break = false;
  mouse.place = false;
  pauseMenuEl?.classList.remove('open');
  pauseOpen = false;
  const existing = codeStore.getCode(x, y, z);
  if (codeInputEl) codeInputEl.value = existing?.code || DEFAULT_CODE;
  codePanelEl?.classList.add('open');
  codePanelEl?.setAttribute('aria-hidden', 'false');
  if (controls.isLocked) controls.unlock();
  setTimeout(() => codeInputEl?.focus(), 40);
}

function closeCodeEditor(relock = true) {
  openCodePos = null;
  codePanelEl?.classList.remove('open');
  codePanelEl?.setAttribute('aria-hidden', 'true');
  if (!chat.isOpen() && !gameMode.dead && !pauseOpen) {
    uiBlocking = false;
    if (relock && !mobileMode) {
      setTimeout(() => {
        if (!anyMenuOpen() && !controls.isLocked) controls.lock();
      }, 40);
    }
  }
}

function openLedEditor(x, y, z) {
  openLedPos = { x: x | 0, y: y | 0, z: z | 0 };
  uiBlocking = true;
  mouse.break = false;
  mouse.place = false;
  pauseMenuEl?.classList.remove('open');
  pauseOpen = false;
  const existing = codeStore.getLed(x, y, z);
  if (ledColorEl) ledColorEl.value = codeStore.colorToHex(existing?.color ?? 0xff0000);
  ledPanelEl?.classList.add('open');
  ledPanelEl?.setAttribute('aria-hidden', 'false');
  if (controls.isLocked) controls.unlock();
}

function closeLedEditor(relock = true) {
  openLedPos = null;
  ledPanelEl?.classList.remove('open');
  ledPanelEl?.setAttribute('aria-hidden', 'true');
  if (!chat.isOpen() && !gameMode.dead && !pauseOpen) {
    uiBlocking = false;
    if (relock && !mobileMode) {
      setTimeout(() => {
        if (!anyMenuOpen() && !controls.isLocked) controls.lock();
      }, 40);
    }
  }
}

document.getElementById('btn-code-cancel')?.addEventListener('click', () => closeCodeEditor(true));
document.getElementById('btn-code-save')?.addEventListener('click', () => {
  if (!openCodePos) return;
  const { x, y, z } = openCodePos;
  const code = codeInputEl?.value ?? '';
  codeStore.setCode(x, y, z, code);
  network.sendCodeSet(x, y, z, code);
  chat.system(`Code Block saved at (${x}, ${y}, ${z}) — script running`);
  closeCodeEditor(true);
});
document.getElementById('btn-led-cancel')?.addEventListener('click', () => closeLedEditor(true));
document.getElementById('btn-led-save')?.addEventListener('click', () => {
  if (!openLedPos) return;
  const { x, y, z } = openLedPos;
  const color = codeStore.hexToColor(ledColorEl?.value || '#ff0000');
  codeStore.setLed(x, y, z, color, codeStore.getLed(x, y, z)?.lit);
  ledManager.set(x, y, z, color, !!codeStore.getLed(x, y, z)?.lit);
  network.sendLedSet(x, y, z, color);
  chat.system(`LED color set to ${codeStore.colorToHex(color)}`);
  closeLedEditor(true);
});

// Input state
const keys = { forward: false, backward: false, left: false, right: false, jump: false, sprint: false };
const mouse = { break: false, place: false };
let uiBlocking = false; // chat / sign modal open — pause dig & look lock

// Mobile / touch controls (auto-enabled on phones & tablets; force with ?mobile=1)
const mobileMode = isMobileDevice();
const mobileControlsEl = document.getElementById('mobile-controls');
const mobileControls = new MobileControls(mobileControlsEl, {
  camera,
  keys,
  mouse,
  onSelectBlock: (delta) => {
    const next = (selectedBlockIndex + delta + HOTBAR_SIZE) % HOTBAR_SIZE;
    selectBlock(next);
  },
});
if (mobileMode) {
  mobileControls.enable();
  document.getElementById('crosshair').style.display = 'block';
  if (helpEl) {
    helpEl.innerHTML =
      'Joystick move · Drag to look · Jump / Sprint<br>' +
      'Mine ⛏ · Place ▣ · 💬 chat · Place Sign to write';
  }
}

/** True when the player can dig/place/move with full controls */
function isPlaying() {
  return !uiBlocking && !gameMode.dead && !pauseOpen && (mobileMode || controls.isLocked)
    && !guidebookEl?.classList.contains('open')
    && !craftPanelEl?.classList.contains('open')
    && !chestPanelEl?.classList.contains('open');
}

// --- Chat -------------------------------------------------------------------
/** Chat command help lines */
const CHAT_HELP = [
  '/help — list commands',
  '/survival — survival mode (health, hunger, mine for items)',
  '/creative — creative mode (unlimited blocks)',
  '/foodrateincrease — spawn food more often',
  '/foodratedecrease — spawn food less often',
  '/foodrate — show food spawn rate',
  '/toadmetincrease — more toads / faster breeding',
  '/toadmetdecrease — fewer toads / slower breeding',
  '/toadmet — show toad population rate',
  '/summontoads — summon 100 toads',
  '/summontoadsN — summon N toads (e.g. /summontoads50)',
  '/cleartoads — remove all toads',
  '/time — show day/night status',
  '/save — force save world state to server',
];

/**
 * @param {string} cmd normalized lowercase command
 * @returns {boolean} true if handled
 */
function handleChatCommand(cmd) {
  if (cmd === '/help' || cmd === '/?' || cmd === '/commands') {
    chat.system('Commands:');
    for (const line of CHAT_HELP) chat.system('  ' + line);
    return true;
  }
  if (cmd === '/foodrateincrease' || cmd === '/foodrateinc') {
    chat.system(toadWorld.increaseFoodRate().label);
    pushWorldSave(true);
    return true;
  }
  if (cmd === '/foodratedecrease' || cmd === '/foodratedec' || cmd === '/foodratedecrase') {
    chat.system(toadWorld.decreaseFoodRate().label);
    pushWorldSave(true);
    return true;
  }
  if (cmd === '/foodrate' || cmd === '/foodrateinfo') {
    chat.system(toadWorld.foodRateInfo().label);
    return true;
  }
  if (
    cmd === '/toadmetincrease' ||
    cmd === '/toadmetinc' ||
    cmd === '/toadrateincrease'
  ) {
    chat.system(toadWorld.increaseToadMet().label);
    pushWorldSave(true);
    return true;
  }
  if (
    cmd === '/toadmetdecrease' ||
    cmd === '/toadmetdecrase' ||
    cmd === '/toadmetdec' ||
    cmd === '/toadratedecrease'
  ) {
    chat.system(toadWorld.decreaseToadMet().label);
    pushWorldSave(true);
    return true;
  }
  if (cmd === '/toadmet' || cmd === '/toadmetinfo' || cmd === '/toadrate') {
    chat.system(toadWorld.toadMetInfo().label);
    return true;
  }
  {
    const m = cmd.match(/^\/summontoads(\d+)?$/);
    if (m) {
      const n = m[1] != null ? parseInt(m[1], 10) : 100;
      const spawned = toadWorld.summonToads(n);
      chat.system(`Summoned ${spawned} toad(s) (now ${toadWorld.toads.length} total)`);
      pushWorldSave(true);
      return true;
    }
  }
  if (cmd === '/cleartoads' || cmd === '/killtoads') {
    const n = toadWorld.toads.length;
    toadWorld.clearAllToadsAndFood();
    toadWorld._spawned = true;
    chat.system(`Cleared ${n} toad(s) and all food`);
    pushWorldSave(true);
    return true;
  }
  if (cmd === '/time' || cmd === '/daynight') {
    chat.system(dayNight.label());
    return true;
  }
  if (cmd === '/save') {
    pushWorldSave(true);
    chat.system('World state saved to server');
    return true;
  }
  if (cmd === '/survival') {
    const msg = gameMode.setMode(MODE_SURVIVAL);
    if (gameOverEl) gameOverEl.classList.remove('open');
    uiBlocking = false;
    chat.system(msg);
    return true;
  }
  if (cmd === '/creative') {
    const msg = gameMode.setMode(MODE_CREATIVE);
    if (gameOverEl) gameOverEl.classList.remove('open');
    uiBlocking = false;
    chat.system(msg);
    return true;
  }
  if (cmd.startsWith('/')) {
    chat.system(`Unknown command: ${cmd} — type /help`);
    return true;
  }
  return false;
}

function pushWorldSave(force = false) {
  const now = performance.now();
  if (!force && now - lastWorldSaveSent < WORLD_SAVE_INTERVAL_MS) return;
  if (!network.connected) return;
  lastWorldSaveSent = now;
  // Critters are Earth-only — never push toad/food state while standing on Mars
  // (prevents frozen copies leaking into saves)
  const critters = isOnEarth(player.getPosition().y)
    ? toadWorld.serialize()
    : null;
  network.sendWorldState(
    critters,
    dayNight.serialize(),
    world.serializeEdits()
  );
}

const chat = new Chat({
  panel: document.getElementById('chat-panel'),
  log: document.getElementById('chat-log'),
  input: document.getElementById('chat-input'),
  getUsername: () => network.username || 'You',
  onSend: (text) => {
    const cmd = text.trim().toLowerCase().replace(/\s+/g, '');
    if (handleChatCommand(cmd)) return;
    network.sendChat(text);
  },
  onOpen: () => {
    uiBlocking = true;
    mouse.break = false;
    mouse.place = false;
    if (controls.isLocked) controls.unlock();
  },
  onClose: () => {
    uiBlocking = false;
    if (!mobileMode) {
      setTimeout(() => {
        if (!uiBlocking && !chat.isOpen()) controls.lock();
      }, 50);
    }
  },
});

document.getElementById('chat-send')?.addEventListener('click', () => chat.submit());
document.getElementById('btn-chat')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  chat.toggle();
});

// Target highlight (wireframe box on the block under the crosshair)
const highlightGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
const highlightEdges = new THREE.EdgesGeometry(highlightGeo);
const highlightMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
const highlight = new THREE.LineSegments(highlightEdges, highlightMat);
highlight.visible = false;
scene.add(highlight);

// Initialize hotbar (tappable on mobile) — always 10 slots
function initHotbar() {
  if (!hotbarEl) return;
  hotbarEl.innerHTML = '';
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const type = hotbarSlots[i] || DEFAULT_HOTBAR[i];
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === selectedBlockIndex ? ' selected' : '');
    slot.dataset.index = String(i);
    const label = BlockTypes[type]?.name || type;
    slot.innerHTML = `<span>${label}</span><span class="count">∞</span>`;
    const pick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectBlock(i);
    };
    slot.addEventListener('click', pick);
    slot.addEventListener('touchend', pick, { passive: false });
    hotbarEl.appendChild(slot);
  }
  refreshVitalsUI();
}
initHotbar();

// Tabbed inventory GUI (E key)
const inventoryUI = createInventoryUI({
  panel: document.getElementById('inventory-panel'),
  tabsEl: document.getElementById('inv-tabs'),
  gridEl: document.getElementById('inv-grid'),
  hotbarPreviewEl: document.getElementById('inv-hotbar-preview'),
  getSlots: () => hotbarSlots,
  setSlots: (slots) => {
    hotbarSlots = slots;
    if (!hotbarSlots[selectedBlockIndex]) selectedBlockIndex = 0;
    selectedBlockType = hotbarSlots[selectedBlockIndex];
  },
  onChange: () => {
    initHotbar();
    selectBlock(selectedBlockIndex);
  },
  onOpen: () => {
    uiBlocking = true;
    mouse.break = false;
    mouse.place = false;
    if (controls.isLocked) controls.unlock();
  },
  onClose: (relock = true) => {
    if (!anyMenuOpen() && !gameMode.dead) {
      uiBlocking = false;
      if (relock && !mobileMode) {
        setTimeout(() => {
          if (!anyMenuOpen() && !controls.isLocked) controls.lock();
        }, 40);
      }
    }
  },
});

// --- Multiplayer wiring -----------------------------------------------------
function refreshPlayerList() {
  if (!playersEl) return;
  const others = remotePlayers.list();
  const me = network.username ? [{ username: network.username, self: true }] : [];
  const all = [
    ...me,
    ...others.map((p) => ({ username: p.username, self: false })),
  ];
  playersEl.innerHTML = all.map((p) =>
    `<div class="player-row${p.self ? ' self' : ''}">${p.self ? '★ ' : ''}${escapeHtml(p.username)}</div>`
  ).join('') || '<div class="player-row muted">Connecting…</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

network.on('welcome', (msg) => {
  if (usernameEl) usernameEl.textContent = msg.username;
  // Unified world: Earth y≥0 + Mars y≈-200 already generated
  world.loadEdits(msg.blocks, msg.signs, msg.chests);
  torchManager.rescanWorld();
  codeStore.loadFromWelcome(msg);
  if (Array.isArray(msg.leds)) ledManager.applyStates(msg.leds);
  syncCodeLedFromWorld();
  // Critters stay on Earth only
  if (msg.critters) {
    toadWorld.loadState(msg.critters);
  } else {
    toadWorld.ensureInitialToads();
  }
  if (msg.time) dayNight.loadState(msg.time);
  if (Array.isArray(msg.chat)) {
    for (const c of msg.chat) {
      if (c.system) chat.system(c.text);
      else chat.append({ username: c.username, text: c.text });
    }
  }
  chat.system(`Connected as ${msg.username}`);
  chat.system('E = inventory · Mars is far below Earth — use a Mars Portal · /help');
  if (typeof remotePlayers.clear === 'function') remotePlayers.clear();
  if (Array.isArray(msg.players)) {
    for (const p of msg.players) remotePlayers.add(p);
  }
  refreshPlayerList();
  world.updateChunks(player.getPosition().x, player.getPosition().z);
  pushWorldSave(true);
});

/** Sky / fog based on which layer the player is on */
function applyLayerAtmosphere(onMars) {
  if (onMars) {
    scene.background.setHex(0xc4784a);
    fog.color.setHex(0xb86840);
    fog.near = 12;
    fog.far = 85;
    ambientLight.intensity = 0.42;
    sunLight.color.setHex(0xffccaa);
    sunLight.intensity = 0.7;
  } else {
    fog.near = 20;
    fog.far = 100;
    ambientLight.intensity = 0.55;
    sunLight.color.setHex(0xfff2d0);
  }
}

/**
 * Portal travel: same XZ, jump between Earth surface and Mars surface.
 * Both layers always exist — no world reload, so signs/mobs stay put.
 */
function usePortal(target) {
  if (portalCooldown > 0) return;
  const px = player.getPosition().x;
  const pz = player.getPosition().z;
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  let sy;
  if (target === 'mars') {
    sy = world.getSurfaceHeight(ix, iz, 'mars');
    chat.system('Stepping through to Mars (far below)…');
  } else {
    sy = world.getSurfaceHeight(ix, iz, 'earth');
    chat.system('Returning to Earth…');
  }
  player.position.set(px, sy + 0.05, pz);
  player.velocity.set(0, 0, 0);
  player.syncCamera();
  portalCooldown = 1.2;
  applyLayerAtmosphere(target === 'mars');
  world.updateChunks(px, pz);
}

network.on('player_join', (msg) => {
  if (msg.player) remotePlayers.add(msg.player);
  refreshPlayerList();
});

network.on('player_leave', (msg) => {
  remotePlayers.remove(msg.id);
  refreshPlayerList();
});

network.on('player_move', (msg) => {
  remotePlayers.update(msg);
});

network.on('block_change', (msg) => {
  // Apply remote dig/place (including our own echo — idempotent)
  world.setBlock(msg.x, msg.y, msg.z, msg.block);
  world.updateChunks(player.getPosition().x, player.getPosition().z);

  // Keep Code/LED metadata strictly tied to the actual block at this cell
  if (msg.block === 'CODE_BLOCK') {
    if (!codeStore.getCode(msg.x, msg.y, msg.z)) {
      codeStore.setCode(msg.x, msg.y, msg.z, DEFAULT_CODE);
    }
  } else {
    codeStore.removeCode(msg.x, msg.y, msg.z);
  }

  if (msg.block === 'LED') {
    const led = codeStore.getLed(msg.x, msg.y, msg.z);
    codeStore.setLed(msg.x, msg.y, msg.z, led?.color ?? 0xff0000, !!led?.lit);
    ledManager.set(msg.x, msg.y, msg.z, led?.color ?? 0xff0000, !!led?.lit);
  } else {
    codeStore.removeLed(msg.x, msg.y, msg.z);
    ledManager.remove(msg.x, msg.y, msg.z);
  }
});

network.on('code_block', (msg) => {
  if (!msg || msg.x == null) return;
  codeStore.setCode(msg.x, msg.y, msg.z, msg.code, msg.faces);
  if (world.getBlock(msg.x, msg.y, msg.z) !== BlockTypes.CODE_BLOCK.id) {
    world.setBlock(msg.x, msg.y, msg.z, 'CODE_BLOCK');
    world.updateChunks(player.getPosition().x, player.getPosition().z);
  }
});

network.on('code_faces', (msg) => {
  if (!msg || msg.x == null) return;
  codeStore.setFaces(msg.x, msg.y, msg.z, msg.faces || {});
});

network.on('led_state', (msg) => {
  if (!msg) return;
  const list = Array.isArray(msg.leds) ? msg.leds : [msg];
  for (const l of list) {
    if (!l || l.x == null) continue;
    if (l.removed) {
      codeStore.removeLed(l.x, l.y, l.z);
      ledManager.remove(l.x, l.y, l.z);
      continue;
    }
    codeStore.setLed(l.x, l.y, l.z, l.color, l.lit);
    ledManager.set(l.x, l.y, l.z, l.color ?? 0xff0000, !!l.lit);
  }
});

network.on('sign', (msg) => {
  if (msg.text == null) {
    world.setSignText(msg.x, msg.y, msg.z, '');
  } else {
    // Ensure SIGN block exists then set text + facing
    if (world.getBlock(msg.x, msg.y, msg.z) !== BlockTypes.SIGN.id) {
      world.setBlock(msg.x, msg.y, msg.z, 'SIGN');
      world.updateChunks(player.getPosition().x, player.getPosition().z);
    }
    world.setSignText(msg.x, msg.y, msg.z, msg.text, msg.facing ?? 0);
  }
});

// Shared chest inventory — any player / late joiner sees the same contents
network.on('chest_update', (msg) => {
  if (!msg || msg.x == null) return;
  const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
  if (msg.items == null) {
    removeChest(world, x, y, z);
  } else {
    setChestItems(world, x, y, z, msg.items);
    // Ensure CHEST block if inventory exists (recovered from network)
    if (world.getBlock(x, y, z) !== BlockTypes.CHEST.id) {
      world.setBlock(x, y, z, 'CHEST');
      world.updateChunks(player.getPosition().x, player.getPosition().z);
    }
  }
  // Live-refresh UI if this chest is open (including our own deposit echo)
  if (
    openChestPos &&
    openChestPos.x === x &&
    openChestPos.y === y &&
    openChestPos.z === z &&
    chestPanelEl?.classList.contains('open')
  ) {
    refreshChestUI();
  }
});

network.on('chat', (msg) => {
  if (msg.system) chat.system(msg.text);
  else chat.append({ username: msg.username, text: msg.text });
});

network.on('skip_night', (msg) => {
  if (msg && typeof msg.time === 'number') {
    dayNight.setTime(msg.time);
  } else {
    dayNight.skipToMorning();
  }
  // Apply lighting immediately
  dayNight.update(0, player.getPosition());
});

network.on('close', () => {
  if (usernameEl) usernameEl.textContent = 'Reconnecting…';
  chat.system('Disconnected — reconnecting…');
});

network.connect();

// Event listeners — desktop pointer-lock (skipped on mobile; mobile uses on-screen UI)
if (!mobileMode) {
  document.addEventListener('click', (e) => {
    // Don't steal clicks from HUD / chat / modals
    if (isUiTarget(e.target)) return;
    if (uiBlocking || chat.isOpen() || anyMenuOpen()) return;
    if (!controls.isLocked) controls.lock();
  });

  controls.addEventListener('lock', () => {
    document.getElementById('crosshair').style.display = 'block';
    // Entering game closes pause UI
    if (pauseOpen || guidebookEl?.classList.contains('open') || craftPanelEl?.classList.contains('open')) {
      closePauseMenu(false);
    }
  });

  controls.addEventListener('unlock', () => {
    mouse.break = false;
    mouse.place = false;
    document.getElementById('crosshair').style.display = 'none';
    // Esc / unlock → pause menu (unless another modal owns the unlock)
    if (
      !chat.isOpen()
      && !gameMode.dead
      && !document.getElementById('sign-modal')?.classList.contains('open')
      && !guidebookEl?.classList.contains('open')
      && !craftPanelEl?.classList.contains('open')
      && !chestPanelEl?.classList.contains('open')
      && !furnacePanelEl?.classList.contains('open')
      && !codePanelEl?.classList.contains('open')
      && !ledPanelEl?.classList.contains('open')
      && !inventoryUI?.isOpen?.()
    ) {
      openPauseMenu();
    }
  });
}

function isUiTarget(target) {
  return !!(target && target.closest && target.closest(
    '#hotbar, #hud-right, #mobile-controls, .mobile-btn, #chat-panel, #chat-input, #btn-chat, #sign-modal, #pause-menu, #guidebook-panel, #craft-panel, #chest-panel, #furnace-panel, #code-panel, #led-panel, #inventory-panel, #game-over'
  ));
}

window.addEventListener('keydown', (e) => {
  // Escape handling for menus
  if (e.code === 'Escape') {
    if (chat.isOpen()) {
      chat.close();
      e.preventDefault();
      return;
    }
    if (inventoryUI?.isOpen?.()) {
      inventoryUI.hide(true);
      e.preventDefault();
      return;
    }
    if (codePanelEl?.classList.contains('open')) {
      closeCodeEditor(true);
      e.preventDefault();
      return;
    }
    if (ledPanelEl?.classList.contains('open')) {
      closeLedEditor(true);
      e.preventDefault();
      return;
    }
    if (chestPanelEl?.classList.contains('open')) {
      closeChest(true);
      e.preventDefault();
      return;
    }
    if (furnacePanelEl?.classList.contains('open')) {
      closeFurnace(true);
      e.preventDefault();
      return;
    }
    if (craftPanelEl?.classList.contains('open') || guidebookEl?.classList.contains('open')) {
      guidebookEl?.classList.remove('open');
      craftPanelEl?.classList.remove('open');
      pauseMenuEl?.classList.add('open');
      pauseOpen = true;
      e.preventDefault();
      return;
    }
    if (pauseOpen) {
      closePauseMenu(true);
      e.preventDefault();
      return;
    }
    // Pointer lock unlock will open pause; on mobile open directly
    if (mobileMode && !gameMode.dead) {
      openPauseMenu();
      e.preventDefault();
    }
    return;
  }

  // E toggles inventory even when a menu/uiBlocking (but not while typing chat)
  if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey && !chat.isOpen() && !gameMode.dead) {
    if (
      !codePanelEl?.classList.contains('open')
      && !ledPanelEl?.classList.contains('open')
      && !chestPanelEl?.classList.contains('open')
      && !document.getElementById('sign-modal')?.classList.contains('open')
    ) {
      e.preventDefault();
      inventoryUI.toggle();
      return;
    }
  }

  // While typing in chat / sign / menus, ignore game keys
  if (chat.isOpen() || uiBlocking || pauseOpen
    || guidebookEl?.classList.contains('open')
    || craftPanelEl?.classList.contains('open')
    || chestPanelEl?.classList.contains('open')
    || furnacePanelEl?.classList.contains('open')
    || codePanelEl?.classList.contains('open')
    || ledPanelEl?.classList.contains('open')
    || inventoryUI?.isOpen?.()) {
    return;
  }

  // T opens chat
  if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    chat.show();
    return;
  }

  // C eats food (cooked anacharis or cheese) in survival
  if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (gameMode.isSurvival() && !gameMode.dead) {
      const r = gameMode.eatFood();
      if (r.ok) {
        const labels = {
          PRETZEL: 'a pretzel',
          COOKED_ANACHARIS: 'cooked anacharis',
          CHEESE: 'cheese',
        };
        chat.system(`Ate ${labels[r.food] || r.food} (+${r.heal} hunger)`);
        refreshVitalsUI();
      } else {
        chat.system('No food — craft pretzels from wheat, cook anacharis, or get cheese');
      }
    }
    return;
  }

  // On mobile, hardware keyboards (rare) still work
  switch (e.code) {
    case 'KeyW': keys.forward = true; break;
    case 'KeyS': keys.backward = true; break;
    case 'KeyA': keys.left = true; break;
    case 'KeyD': keys.right = true; break;
    case 'Space': keys.jump = true; e.preventDefault(); break;
    case 'ShiftLeft': keys.sprint = true; break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
    case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
      selectBlock(parseInt(e.code.replace('Digit', ''), 10) - 1);
      break;
    case 'Digit0':
      selectBlock(9); // 10th hotbar slot
      break;
  }
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': keys.forward = false; break;
    case 'KeyS': keys.backward = false; break;
    case 'KeyA': keys.left = false; break;
    case 'KeyD': keys.right = false; break;
    case 'Space': keys.jump = false; break;
    case 'ShiftLeft': keys.sprint = false; break;
  }
});

// Dig / place input.
// IMPORTANT: PointerLockControls locks the *body*, so mouse events often do not
// hit the WebGL canvas. Listen on document (capture) so LMB/RMB always register.
function onPointerDown(e) {
  if (isUiTarget(e.target)) return;
  if (uiBlocking || chat.isOpen()) return;
  if (!isPlaying()) return;

  // Ignore non-primary buttons except right-click (place)
  if (e.button === 0) {
    mouse.break = true;
    mouse.place = false;
    // Act immediately on click (don't wait for next animation frame)
    attemptBreak();
  } else if (e.button === 2) {
    mouse.place = true;
    mouse.break = false;
    attemptPlace();
  }
}

function onPointerUp(e) {
  if (e.button === 0) mouse.break = false;
  if (e.button === 2) mouse.place = false;
}

document.addEventListener('mousedown', onPointerDown, true);
document.addEventListener('mouseup', onPointerUp, true);
// pointerup can fire outside the window while pointer-locked
window.addEventListener('blur', () => {
  mouse.break = false;
  mouse.place = false;
});

document.addEventListener('contextmenu', (e) => {
  if (isPlaying() || mobileMode) e.preventDefault();
});

window.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 1 : -1;
  selectBlock((selectedBlockIndex + delta + HOTBAR_SIZE) % HOTBAR_SIZE);
}, { passive: false });

function selectBlock(index) {
  selectedBlockIndex = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  selectedBlockType = hotbarSlots[selectedBlockIndex] || DEFAULT_HOTBAR[selectedBlockIndex];
  document.querySelectorAll('#hotbar .slot').forEach((slot, i) => {
    slot.classList.toggle('selected', i === selectedBlockIndex);
  });
  const name = BlockTypes[selectedBlockType]?.name || selectedBlockType;
  const cnt = gameMode.isCreative() ? '∞' : gameMode.getCount(selectedBlockType);
  if (blockPreview) blockPreview.textContent = `Selected: ${name} (${cnt})`;
}

/**
 * Raycast from the camera through the voxel grid.
 * Returns break target + adjacent place cell.
 */
function getTargetBlock() {
  const origin = camera.position.clone();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return world.raycast(origin, direction, 6);
}

function breakBlock(target) {
  if (!target) return false;
  if (gameMode.dead) return false;
  if (!world.canBreak(target.x, target.y, target.z)) return false;

  const dropKey = dropNameFromBlockId(target.blockId);
  const wasLeaves = dropKey === 'LEAVES';
  const changed = world.setBlock(target.x, target.y, target.z, 'AIR');
  if (changed) {
    if (gameMode.isSurvival()) {
      if (wasLeaves) {
        // Oak leaves: chance to drop a sapling instead of (or in addition to) leaves
        if (Math.random() < 0.18) {
          gameMode.addItem('SAPLING', 1);
          chat.system('Oak Sapling dropped!');
        }
        // Small chance of leaf item too
        if (Math.random() < 0.08) gameMode.onMined('LEAVES');
      } else {
        gameMode.onMined(dropKey);
      }
    } else if (wasLeaves && Math.random() < 0.18) {
      // Creative still can pick up saplings into inventory tracking if we want — skip
    }
    network.sendBreak(target.x, target.y, target.z);
    world.updateChunks(player.getPosition().x, player.getPosition().z);
    pushWorldSave(true);
  }
  return changed;
}

/** Sleep in bed — skip to morning for all players on the server */
function useBed() {
  mouse.place = false;
  const result = dayNight.skipToMorning();
  dayNight.update(0, player.getPosition());
  network.sendSkipNight();
  pushWorldSave(true);
  chat.system(result.message);
}

function tryAttackChicken() {
  if (gameMode.dead) return false;
  const origin = camera.position.clone();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  // Mars creatures when below Earth
  if (isOnMars(player.getPosition().y)) {
    const hit = marsMobs.tryAttack(origin, direction);
    if (hit) {
      if (hit.drop) {
        if (gameMode.isSurvival()) {
          gameMode.addItem(hit.drop, 1);
          chat.system(`Mars ${hit.kind} down! +1 ${BlockTypes[hit.drop]?.name || hit.drop}`);
        } else {
          chat.system(`Mars ${hit.kind} defeated (+${BlockTypes[hit.drop]?.name || hit.drop})`);
        }
        refreshHotbarCounts();
      } else if (hit.wounded) {
        chat.system(`Hit Mars ${hit.kind}!`);
      }
      return true;
    }
    return false;
  }

  const cheese = chickenWorld.tryAttack(origin, direction);
  if (cheese > 0) {
    if (gameMode.isSurvival()) {
      gameMode.addItem('CHEESE', cheese);
      chat.system(`Got ${cheese} cheese wedge(s)! Press C to eat.`);
    } else {
      chat.system(`Chicken defeated (+${cheese} cheese — survival only uses them)`);
    }
    return true;
  }
  return false;
}

/**
 * Plant a decorative flower on top of a grass block only.
 * @param {string} flowerKey e.g. 'POPPY'
 */
function plantFlower(target, flowerKey) {
  if (!target) return false;
  const def = BlockTypes[flowerKey];
  if (!def?.isFlower) return false;

  const grassId = BlockTypes.GRASS.id;
  const lookId = world.getBlock(target.x, target.y, target.z);

  let px;
  let py;
  let pz;
  // Aim at grass → plant on top
  if (lookId === grassId) {
    px = target.x | 0;
    py = (target.y | 0) + 1;
    pz = target.z | 0;
  } else {
    px = target.placeX | 0;
    py = target.placeY | 0;
    pz = target.placeZ | 0;
  }

  // If place cell is grass, shift up onto it
  const placeId = world.getBlock(px, py, pz);
  if (placeId === grassId) {
    py += 1;
  }

  const below = world.getBlock(px, py - 1, pz);
  if (below !== grassId) {
    chat.system(`${def.name} can only be placed on grass`);
    mouse.place = false;
    return false;
  }

  const spaceId = world.getBlock(px, py, pz);
  const spaceType = world.getBlockType(spaceId);
  // Replace air or other non-solid plants/flowers in the cell
  const spaceOk = spaceId === 0
    || (spaceType && !spaceType.solid && !spaceType.liquid);
  if (!spaceOk) {
    chat.system('No room for a flower here');
    mouse.place = false;
    return false;
  }

  if (gameMode.isSurvival()) {
    if (!gameMode.canPlace(flowerKey) || !gameMode.consumeItem(flowerKey, 1)) {
      chat.system(`No ${def.name} in inventory`);
      mouse.place = false;
      return false;
    }
  }

  mouse.place = false;
  world.setBlock(px, py, pz, flowerKey);
  network.sendPlace(px, py, pz, flowerKey);
  world.updateChunks(player.getPosition().x, player.getPosition().z);
  pushWorldSave(true);
  refreshHotbarCounts();
  return true;
}

/**
 * Plant wheat on grass (or dirt): crop sits in the air/space above the soil.
 * Grows to 2 blocks tall over time; each segment can be harvested for wheat.
 */
function plantWheat(target) {
  if (!target) return false;
  const grassId = BlockTypes.GRASS.id;
  const dirtId = BlockTypes.DIRT.id;
  const lookId = world.getBlock(target.x, target.y, target.z);

  let px;
  let py;
  let pz;
  // Aim at grass/dirt → plant on top
  if (lookId === grassId || lookId === dirtId) {
    px = target.x | 0;
    py = (target.y | 0) + 1;
    pz = target.z | 0;
  } else {
    px = target.placeX | 0;
    py = target.placeY | 0;
    pz = target.placeZ | 0;
  }

  // If place cell is soil, shift up
  const placeId = world.getBlock(px, py, pz);
  if (placeId === grassId || placeId === dirtId) {
    py += 1;
  }

  const below = world.getBlock(px, py - 1, pz);
  if (below !== grassId && below !== dirtId) {
    chat.system('Plant wheat on grass (or dirt)');
    mouse.place = false;
    return false;
  }

  const spaceId = world.getBlock(px, py, pz);
  const spaceType = world.getBlockType(spaceId);
  const spaceOk = spaceId === 0
    || spaceId === BlockTypes.WHEAT?.id
    || (spaceType && !spaceType.solid && !spaceType.liquid);
  if (!spaceOk) {
    chat.system('No room to plant wheat here');
    mouse.place = false;
    return false;
  }

  if (gameMode.isSurvival()) {
    if (!gameMode.canPlace('WHEAT') || !gameMode.consumeItem('WHEAT', 1)) {
      chat.system('No wheat to plant — harvest a crop or craft later');
      mouse.place = false;
      return false;
    }
  }

  mouse.place = false;
  world.setBlock(px, py, pz, 'WHEAT');
  network.sendPlace(px, py, pz, 'WHEAT');
  world.updateChunks(player.getPosition().x, player.getPosition().z);
  pushWorldSave(true);
  refreshHotbarCounts();
  chat.system('Planted wheat — it will grow a second stalk. Break either block to collect.');
  return true;
}

/**
 * Plant anacharis in a water block (ponds). Prefers the water cell under the crosshair,
 * or the place cell if it is water. Needs solid (or more anacharis) below.
 */
function plantAnacharis(target) {
  if (!target) return false;
  const waterId = BlockTypes.WATER.id;
  let px;
  let py;
  let pz;
  const lookId = world.getBlock(target.x, target.y, target.z);
  if (lookId === waterId || lookId === BlockTypes.ANACHARIS?.id) {
    px = target.x | 0;
    py = target.y | 0;
    pz = target.z | 0;
  } else {
    px = target.placeX | 0;
    py = target.placeY | 0;
    pz = target.placeZ | 0;
  }

  const cell = world.getBlock(px, py, pz);
  if (cell !== waterId && cell !== 0 && cell !== BlockTypes.ANACHARIS?.id) {
    chat.system('Plant anacharis in water (aim at a pond)');
    mouse.place = false;
    return false;
  }
  // Prefer bottom of water column: walk down through water
  while (py > 1 && world.getBlock(px, py - 1, pz) === waterId) {
    py -= 1;
  }
  // If we walked to floor+1 water, stay; if still air, fail
  const here = world.getBlock(px, py, pz);
  if (here !== waterId && here !== 0 && here !== BlockTypes.ANACHARIS?.id) {
    chat.system('Need open water for anacharis');
    mouse.place = false;
    return false;
  }
  const below = world.getBlock(px, py - 1, pz);
  const belowType = world.getBlockType(below);
  const okFloor = below !== 0 && (
    below === BlockTypes.ANACHARIS?.id
    || (belowType && belowType.solid && !belowType.liquid)
  );
  if (!okFloor) {
    chat.system('Anacharis needs a solid floor under the water');
    mouse.place = false;
    return false;
  }

  if (gameMode.isSurvival()) {
    if (!gameMode.canPlace('ANACHARIS') || !gameMode.consumeItem('ANACHARIS', 1)) {
      chat.system('No anacharis in inventory');
      mouse.place = false;
      return false;
    }
  }

  mouse.place = false;
  world.setBlock(px, py, pz, 'ANACHARIS');
  network.sendPlace(px, py, pz, 'ANACHARIS');
  world.updateChunks(player.getPosition().x, player.getPosition().z);
  pushWorldSave(true);
  refreshHotbarCounts();
  chat.system('Planted anacharis — it will grow upward in water over time');
  return true;
}

/**
 * Plant an oak sapling: right-click dirt/grass (or the air above it) to grow a full tree.
 * Does not require free space outside the player body — trees can grow at your feet.
 */
function plantSapling(target) {
  if (saplingCooldown > 0) return false;

  const lookId = world.getBlock(target.x, target.y, target.z);
  const lookIsSoil = lookId === BlockTypes.GRASS.id || lookId === BlockTypes.DIRT.id;

  // Prefer the top of the dirt/grass block you are aiming at
  let plantX;
  let plantY;
  let plantZ;
  if (lookIsSoil) {
    plantX = target.x | 0;
    plantY = (target.y | 0) + 1;
    plantZ = target.z | 0;
  } else {
    // Aiming at something else (e.g. leaves) — use adjacent place cell
    plantX = target.placeX | 0;
    plantY = target.placeY | 0;
    plantZ = target.placeZ | 0;
  }

  // If place cell is soil, grow on top of it instead
  const placeId = world.getBlock(plantX, plantY, plantZ);
  if (placeId === BlockTypes.GRASS.id || placeId === BlockTypes.DIRT.id) {
    plantY += 1;
  }

  const below = world.getBlock(plantX, plantY - 1, plantZ);
  const isSoil = below === BlockTypes.DIRT.id || below === BlockTypes.GRASS.id;
  if (!isSoil) {
    chat.system('Plant saplings on dirt or grass (aim at the soil)');
    mouse.place = false;
    return false;
  }

  // Need replaceable space for the trunk base
  const spaceId = world.getBlock(plantX, plantY, plantZ);
  const spaceType = world.getBlockType(spaceId);
  const spaceOk = spaceId === 0
    || spaceId === BlockTypes.LEAVES.id
    || spaceId === BlockTypes.SAPLING.id
    || spaceId === BlockTypes.WATER.id
    || (spaceType && !spaceType.solid);
  if (!spaceOk) {
    chat.system('Not enough space above soil to grow a tree');
    mouse.place = false;
    return false;
  }

  if (gameMode.isSurvival()) {
    if (!gameMode.canPlace('SAPLING') || !gameMode.consumeItem('SAPLING', 1)) {
      chat.system('No oak saplings in inventory — break oak leaves for a chance to get one');
      mouse.place = false;
      return false;
    }
  }

  // One-shot place — stop hold-to-place from burning through the stack
  mouse.place = false;
  saplingCooldown = SAPLING_PLACE_COOLDOWN;
  actionCooldown = SAPLING_PLACE_COOLDOWN;

  const grew = typeof world.growTreeAt === 'function'
    ? world.growTreeAt(plantX, plantY, plantZ)
    : false;
  if (!grew) {
    if (gameMode.isSurvival()) gameMode.addItem('SAPLING', 1);
    chat.system('Tree could not grow here');
    refreshHotbarCounts();
    return false;
  }

  const playerPos = player.getPosition();
  world.updateChunks(playerPos.x, playerPos.z);
  pushWorldSave(true);
  refreshHotbarCounts();
  selectBlock(selectedBlockIndex);
  chat.system('Sapling grew into an oak tree!');
  return true;
}

function placeBlock(target) {
  if (!target) return false;
  if (gameMode.dead) return false;

  // Right-clicking an existing chest opens it (does not place adjacent)
  const lookType = target.blockType;
  if (lookType && (lookType.isChest || lookType.name === 'Chest')) {
    openChestAt(target.x, target.y, target.z);
    return true;
  }

  // Right-click existing sign → edit text (prefilled with current message)
  if (lookType && (lookType.isSign || lookType.name === 'Sign')) {
    editSignAt(target.x, target.y, target.z);
    mouse.place = false;
    return true;
  }

  // Right-click furnace → smelt UI
  if (lookType && (lookType.isFurnace || lookType.name === 'Furnace')) {
    openFurnaceAt(target.x, target.y, target.z);
    mouse.place = false;
    return true;
  }

  // Right-click bed → skip night for everyone
  if (lookType && (lookType.isBed || lookType.name === 'Bed')) {
    useBed();
    return true;
  }

  // Right-click portal → teleport between Earth (y≥0) and Mars (y≈-200)
  if (lookType && lookType.isPortal && lookType.portalTarget) {
    mouse.place = false;
    const dest = lookType.portalTarget;
    const onMars = isOnMars(player.getPosition().y);
    if (dest === 'mars' && onMars) {
      chat.system('Already on Mars.');
      return true;
    }
    if (dest === 'earth' && !onMars) {
      chat.system('Already on Earth.');
      return true;
    }
    usePortal(dest);
    return true;
  }

  // Right-click Code Block → open Python editor
  if (lookType && (lookType.isCodeBlock || lookType.name === 'Code Block')) {
    openCodeEditor(target.x, target.y, target.z);
    mouse.place = false;
    return true;
  }

  // Right-click LED → color picker
  if (lookType && (lookType.isLed || lookType.name === 'LED Block')) {
    openLedEditor(target.x, target.y, target.z);
    mouse.place = false;
    return true;
  }

  // Oak sapling: plant on dirt/grass → instant oak tree (handled before player-overlap
  // checks so looking at the ground at your feet still works)
  if (selectedBlockType === 'SAPLING') {
    return plantSapling(target);
  }

  // Cooked anacharis is food — eat instead of placing
  if (selectedBlockType === 'COOKED_ANACHARIS' || BlockTypes[selectedBlockType]?.isFood) {
    mouse.place = false;
    if (gameMode.isSurvival()) {
      const r = gameMode.eatFood();
      if (r.ok) {
        chat.system(`Ate ${BlockTypes[r.food]?.name || r.food} (+${r.heal} hunger)`);
        refreshVitalsUI();
        refreshHotbarCounts();
      } else chat.system('No food to eat');
    } else {
      chat.system('Food is for Survival mode (C key)');
    }
    return true;
  }

  // Anacharis: plant in water (pond bottom / water column)
  if (selectedBlockType === 'ANACHARIS') {
    return plantAnacharis(target);
  }

  // Wheat: plant on grass/dirt
  if (selectedBlockType === 'WHEAT') {
    return plantWheat(target);
  }

  // Decorative flowers: grass only
  if (BlockTypes[selectedBlockType]?.isFlower) {
    return plantFlower(target, selectedBlockType);
  }

  const px = target.placeX;
  const py = target.placeY;
  const pz = target.placeZ;

  // Don't place inside the local player
  const playerPos = player.getPosition();
  const dx = Math.abs(px + 0.5 - playerPos.x);
  const dy = py - playerPos.y; // place cell bottom vs feet
  const dz = Math.abs(pz + 0.5 - playerPos.z);
  // Player AABB roughly covers [feet, feet+1.8] and ±0.3 horizontally
  if (dx < 0.8 && dz < 0.8 && dy > -1.8 && dy < 1.8) {
    return false;
  }

  // Don't overwrite existing solid blocks
  const existing = world.getBlock(px, py, pz);
  const existingType = world.getBlockType(existing);
  if (existing !== 0 && existingType.solid) return false;

  // Survival: must have the block in inventory
  if (gameMode.isSurvival()) {
    if (!gameMode.canPlace(selectedBlockType)) {
      chat.system(`No ${BlockTypes[selectedBlockType]?.name || selectedBlockType} in inventory — mine some first`);
      return false;
    }
  }

  // Signs: prompt for text, then place + sync
  if (selectedBlockType === 'SIGN') {
    if (gameMode.isSurvival() && !gameMode.consumeItem('SIGN', 1)) return false;
    placeSignAt(px, py, pz);
    return true; // async path handles the rest
  }

  if (gameMode.isSurvival()) {
    if (!gameMode.consumeItem(selectedBlockType, 1)) return false;
  }

  // Always record locally + notify server
  world.setBlock(px, py, pz, selectedBlockType);
  if (selectedBlockType === 'CHEST') {
    getChest(world, px, py, pz); // ensure empty storage exists
    // Register empty shared inventory on the server for all players
    syncChestToServer(px, py, pz);
  }
  if (selectedBlockType === 'CODE_BLOCK') {
    codeStore.setCode(px, py, pz, DEFAULT_CODE);
    // Ensure server runtime + clients get code immediately (prevents "disappearing" metadata)
    network.sendCodeSet(px, py, pz, DEFAULT_CODE);
  }
  if (selectedBlockType === 'LED') {
    codeStore.setLed(px, py, pz, 0xff0000, false);
    ledManager.set(px, py, pz, 0xff0000, false);
    network.sendLedSet(px, py, pz, 0xff0000);
  }
  network.sendPlace(px, py, pz, selectedBlockType);
  world.updateChunks(playerPos.x, playerPos.z);
  pushWorldSave(true);
  refreshHotbarCounts();
  selectBlock(selectedBlockIndex);
  return true;
}

/** Async sign placement with text prompt; faces the player (4-way). */
async function placeSignAt(px, py, pz) {
  mouse.break = false;
  mouse.place = false;
  uiBlocking = true;
  if (controls.isLocked) controls.unlock();

  // Capture facing before modal (player look direction)
  const look = new THREE.Vector3();
  camera.getWorldDirection(look);
  const facing = facingFromLookDir(look);

  const text = await SignManager.promptText('');
  uiBlocking = false;

  if (text === null) {
    // cancelled — refund sign in survival
    if (gameMode.isSurvival()) gameMode.addItem('SIGN', 1);
    if (!mobileMode) setTimeout(() => controls.lock(), 50);
    return;
  }

  const finalText = text.trim() || 'Hello!';
  const changed = world.setBlock(px, py, pz, 'SIGN');
  if (changed) {
    world.setSignText(px, py, pz, finalText, facing);
    network.sendPlace(px, py, pz, 'SIGN');
    network.sendSign(px, py, pz, finalText, facing);
    world.updateChunks(player.getPosition().x, player.getPosition().z);
    pushWorldSave(true);
  } else if (gameMode.isSurvival()) {
    gameMode.addItem('SIGN', 1);
  }

  if (!mobileMode) setTimeout(() => controls.lock(), 50);
}

/** Edit an already-placed sign; modal is prefilled with current text. */
async function editSignAt(x, y, z) {
  mouse.break = false;
  mouse.place = false;
  uiBlocking = true;
  if (controls.isLocked) controls.unlock();

  const existing = world.getSignText(x, y, z) || '';
  const facing = world.getSignFacing(x, y, z);
  const text = await SignManager.promptText(existing);
  uiBlocking = false;

  if (text === null) {
    if (!mobileMode) setTimeout(() => controls.lock(), 50);
    return;
  }

  const finalText = text.trim() || existing || 'Hello!';
  // Ensure SIGN block still present
  if (world.getBlock(x, y, z) !== BlockTypes.SIGN.id) {
    world.setBlock(x, y, z, 'SIGN');
    network.sendPlace(x, y, z, 'SIGN');
  }
  world.setSignText(x, y, z, finalText, facing);
  network.sendSign(x, y, z, finalText, facing);
  pushWorldSave(true);
  chat.system('Sign updated.');

  if (!mobileMode) setTimeout(() => controls.lock(), 50);
}

let actionCooldown = 0; // seconds until next dig/place

function attemptBreak() {
  if (actionCooldown > 0) return false;
  if (!isPlaying()) return false;
  // Prefer attacking a chicken if one is in range
  if (tryAttackChicken()) {
    actionCooldown = 0.25;
    return true;
  }
  const target = getTargetBlock();
  if (!target) return false;
  if (breakBlock(target)) {
    actionCooldown = 0.15;
    refreshHotbarCounts();
    selectBlock(selectedBlockIndex);
    return true;
  }
  return false;
}

function attemptPlace() {
  if (actionCooldown > 0) return false;
  if (!isPlaying()) return false;
  const target = getTargetBlock();
  if (!target) return false;
  if (placeBlock(target)) {
    actionCooldown = 0.15;
    return true;
  }
  return false;
}

// Game loop
let lastTime = performance.now();
const fixedTimeStep = 1 / 60;
let accumulator = 0;

function animate(time) {
  requestAnimationFrame(animate);

  const delta = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  accumulator += delta;
  while (accumulator >= fixedTimeStep) {
    player.update(fixedTimeStep, keys);
    accumulator -= fixedTimeStep;
  }

  // Fall damage when landing
  if (player.onGround && !wasOnGround) {
    gameMode.onLanded(player.position.y);
  }
  wasOnGround = player.onGround;

  remotePlayers.tick(delta);
  if (mobileMode) mobileControls.update();

  // Earth fauna y≥0; Mars fauna y<0
  const ppos = player.getPosition();
  if (isOnEarth(ppos.y)) {
    toadWorld.update(delta, ppos.x, ppos.z);
    chickenWorld.update(delta);
    fishWorld.update(delta);
    fishWorld.setVisible(true);
    marsMobs.setVisible(false);
  } else {
    marsMobs.update(delta);
    marsMobs.setVisible(true);
    fishWorld.setVisible(false);
  }

  // Furnaces cook in the background
  tickAllFurnaces(world, delta);
  if (openFurnacePos) {
    furnaceUiTimer += delta;
    if (furnaceUiTimer >= 0.2) {
      furnaceUiTimer = 0;
      refreshFurnaceUI();
    }
  }

  // Survival vitals
  gameMode.update(delta, ppos.y);

  // Oak leaf decay (orphan leaves far from logs) — Earth layer
  leafDecayTimer += delta;
  if (leafDecayTimer >= 1.25 && isOnEarth(ppos.y)) {
    leafDecayTimer = 0;
    const n = world.tickLeafDecay(ppos.x, ppos.z, 48);
    if (n > 0) world.updateChunks(ppos.x, ppos.z);
  }

  // Dirt → grass: Earth only
  grassSpreadTimer += delta;
  if (grassSpreadTimer >= 1.5 && isOnEarth(ppos.y)) {
    grassSpreadTimer = 0;
    const converted = world.tickGrassSpread(ppos.x, ppos.z, 40, 0.22);
    if (converted.length > 0) {
      world.updateChunks(ppos.x, ppos.z);
      for (const b of converted) {
        network.sendPlace(b.x, b.y, b.z, 'GRASS');
      }
      pushWorldSave(false);
    }
  }

  // Anacharis grows up through water
  anacharisTimer += delta;
  if (anacharisTimer >= 2.2 && isOnEarth(ppos.y)) {
    anacharisTimer = 0;
    const grew = world.tickAnacharisGrowth(ppos.x, ppos.z, 32, 0.16);
    if (grew.length > 0) {
      world.updateChunks(ppos.x, ppos.z);
      for (const b of grew) {
        network.sendPlace(b.x, b.y, b.z, 'ANACHARIS');
      }
      pushWorldSave(false);
    }
  }

  // Wheat grows to 2 blocks tall on grass
  wheatTimer += delta;
  if (wheatTimer >= 2.0 && isOnEarth(ppos.y)) {
    wheatTimer = 0;
    const grew = world.tickWheatGrowth(ppos.x, ppos.z, 40, 0.2);
    if (grew.length > 0) {
      world.updateChunks(ppos.x, ppos.z);
      for (const b of grew) {
        network.sendPlace(b.x, b.y, b.z, 'WHEAT');
      }
      pushWorldSave(false);
    }
  }

  // Water flows into air on sides and below (not up)
  waterFlowTimer += delta;
  if (waterFlowTimer >= 0.35) {
    waterFlowTimer = 0;
    const flowed = world.tickWaterFlow(ppos.x, ppos.y, ppos.z, 64, 0.65);
    if (flowed.length > 0) {
      world.updateChunks(ppos.x, ppos.z);
      for (const b of flowed) {
        network.sendPlace(b.x, b.y, b.z, 'WATER');
      }
      pushWorldSave(false);
    }
  }

  // Day/night on Earth; fixed dusty sky on Mars
  if (isOnEarth(ppos.y)) {
    dayNight.update(delta, ppos);
  } else {
    applyLayerAtmosphere(true);
  }
  torchManager.update(ppos, isOnMars(ppos.y) ? true : dayNight.isNight);
  ledManager.update(ppos);
  portalCooldown = Math.max(0, portalCooldown - delta);

  // Persist world state to server periodically
  pushWorldSave(false);

  // Block targeting + hold-to-mine / hold-to-place
  actionCooldown = Math.max(0, actionCooldown - delta);
  saplingCooldown = Math.max(0, saplingCooldown - delta);
  let target = null;
  if (isPlaying()) {
    target = getTargetBlock();

    if (target) {
      highlight.visible = true;
      highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else {
      highlight.visible = false;
    }

    if (actionCooldown <= 0) {
      if (mouse.break) attemptBreak();
      else if (mouse.place) attemptPlace();
    }
  } else {
    highlight.visible = false;
  }

  // Broadcast local movement
  if (network.connected) {
    const pos = player.getPosition();
    // Camera yaw/pitch from the camera quaternion
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    network.sendMove(pos.x, pos.y, pos.z, euler.y, euler.x);
  }

  // Update debug info
  const pos = player.getPosition();
  const vel = player.getVelocity();

  // Generate/rebuild chunks around the player
  world.updateChunks(pos.x, pos.z);

  const chunk = world.getChunkCoords(pos.x, pos.z);
  const look = target
    ? `Look: ${target.blockType.name} @ ${target.x},${target.y},${target.z}`
    : 'Look: —';

  const critters = toadWorld.stats();
  const marsStats = marsMobs.stats();
  const modeLine = gameMode.isSurvival()
    ? `Survival · HP ${gameMode.health}/${MAX_HEALTH} · Hunger ${gameMode.hunger}/${MAX_HUNGER}`
    : 'Creative';
  const eulerHud = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const face = facingLabel(eulerHud.y);
  const onMars = isOnMars(pos.y);
  const layer = onMars ? 'Mars' : 'Earth';
  const fishStats = fishWorld.stats();
  const faunaLine = onMars
    ? `Rovers: ${marsStats.rovers} · Hoppers: ${marsStats.hoppers} · Crawlers: ${marsStats.crawlers}`
    : `Toads: ${critters.toads} · Food: ${critters.food} · Chickens: ${chickenWorld.count()} · Fish: ${fishStats.total} (♂${fishStats.males}/♀${fishStats.females})`;
  debugEl.innerHTML = `
    XYZ: ${pos.x.toFixed(2)} / ${pos.y.toFixed(2)} / ${pos.z.toFixed(2)}<br>
    Angle: ${face.deg.toFixed(1)}°<br>
    Facing: ${face.cardinal}<br>
    Layer: ${layer} · Vel: ${vel.x.toFixed(1)} / ${vel.y.toFixed(1)} / ${vel.z.toFixed(1)}<br>
    Chunk: ${chunk.x}, ${chunk.z} · World: ${WORLD_SIZE}×${WORLD_SIZE}<br>
    ${modeLine}<br>
    Players: ${1 + remotePlayers.players.size}<br>
    ${faunaLine}<br>
    ${dayNight.label()} · Torches: ${torchManager.torches.size}<br>
    ${look}<br>
    FPS: ${(1 / Math.max(delta, 0.001)).toFixed(0)}
  `;

  renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Fixed 100×100 world — generate all columns, then mesh near spawn
world.generateFullWorld();
world.updateChunks(WORLD_CENTER, WORLD_CENTER);

// Spawn the player at the center of the map
const surfaceY = world.getSurfaceHeight(WORLD_CENTER, WORLD_CENTER);
player.position.set(WORLD_CENTER + 0.5, surfaceY, WORLD_CENTER + 0.5);
player.velocity.set(0, 0, 0);
player.syncCamera();

// Critters: wait for welcome to restore save; fallback after a short delay if offline
setTimeout(() => {
  if (!toadWorld._spawned) toadWorld.ensureInitialToads();
  marsMobs.ensureSpawned();
  marsMobs.setVisible(false);
  fishWorld.ensureSpawned();
}, 1500);

// Save on leave
window.addEventListener('beforeunload', () => {
  pushWorldSave(true);
});

// Start
blockPreview.textContent = `Selected: ${BlockTypes[selectedBlockType].name}`;
refreshVitalsUI();
if (helpEl && !mobileMode) {
  helpEl.innerHTML =
    'Click to play · WASD move · Space jump/swim · Shift sprint<br>' +
    'LMB mine · RMB place · <b>1–9/0</b> hotbar · <b>E</b> inventory · <b>C</b> food<br>' +
    '<b>Esc</b> menu · Hold Space in water to swim up';
}
animate(performance.now());
