// Chest storage: up to 30 item types, unlimited count per type
import { BlockTypes } from './blocks.js';

export const CHEST_MAX_TYPES = 30;

/**
 * @param {import('./world.js').World} world
 */
export function ensureChestStorage(world) {
  if (!world.chests) world.chests = new Map();
}

export function chestKey(x, y, z) {
  return `${x | 0},${y | 0},${z | 0}`;
}

/**
 * @returns {{ items: Record<string, number> }}
 */
export function getChest(world, x, y, z) {
  ensureChestStorage(world);
  const k = chestKey(x, y, z);
  let c = world.chests.get(k);
  if (!c) {
    c = { items: {} };
    world.chests.set(k, c);
  }
  return c;
}

export function removeChest(world, x, y, z) {
  ensureChestStorage(world);
  world.chests.delete(chestKey(x, y, z));
}

/**
 * Sanitize raw items object (network / save).
 * @param {unknown} raw
 * @returns {Record<string, number>}
 */
export function sanitizeItems(raw) {
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

/**
 * Replace chest inventory at a position (from network sync).
 * @returns {Record<string, number>}
 */
export function setChestItems(world, x, y, z, rawItems) {
  ensureChestStorage(world);
  const items = sanitizeItems(rawItems);
  world.chests.set(chestKey(x, y, z), { items });
  return items;
}

/** Snapshot of items for network (plain object copy). */
export function getChestItemsSnapshot(world, x, y, z) {
  const chest = getChest(world, x, y, z);
  const items = {};
  for (const [t, n] of Object.entries(chest.items || {})) {
    if (n > 0) items[t] = n;
  }
  return items;
}

export function chestTypeCount(chest) {
  return Object.keys(chest.items).filter((k) => (chest.items[k] || 0) > 0).length;
}

/**
 * Deposit amount of itemType into chest.
 * @returns {{ ok: boolean, message: string, deposited: number }}
 */
export function deposit(world, x, y, z, itemType, amount) {
  if (!itemType || amount <= 0) return { ok: false, message: 'Nothing to deposit', deposited: 0 };
  if (itemType === 'AIR' || itemType === 'BEDROCK') {
    return { ok: false, message: 'Cannot store that', deposited: 0 };
  }
  const chest = getChest(world, x, y, z);
  const has = (chest.items[itemType] || 0) > 0;
  if (!has && chestTypeCount(chest) >= CHEST_MAX_TYPES) {
    return { ok: false, message: `Chest is full (${CHEST_MAX_TYPES} item types max)`, deposited: 0 };
  }
  chest.items[itemType] = (chest.items[itemType] || 0) + amount;
  return { ok: true, message: `Deposited ${amount}× ${itemType}`, deposited: amount };
}

/**
 * Withdraw amount of itemType from chest.
 * @returns {{ ok: boolean, message: string, taken: number }}
 */
export function withdraw(world, x, y, z, itemType, amount) {
  const chest = getChest(world, x, y, z);
  const have = chest.items[itemType] || 0;
  if (have <= 0) return { ok: false, message: 'Empty slot', taken: 0 };
  const take = Math.min(have, amount);
  const left = have - take;
  if (left <= 0) delete chest.items[itemType];
  else chest.items[itemType] = left;
  return { ok: true, message: `Took ${take}× ${itemType}`, taken: take };
}

export function serializeChests(world) {
  ensureChestStorage(world);
  const out = [];
  for (const [key, chest] of world.chests) {
    const [x, y, z] = key.split(',').map(Number);
    const items = {};
    for (const [t, n] of Object.entries(chest.items || {})) {
      if (n > 0) items[t] = n;
    }
    if (Object.keys(items).length === 0) {
      // still save empty chests so structure exists? optional — only if block is chest
      out.push({ x, y, z, items });
    } else {
      out.push({ x, y, z, items });
    }
  }
  return out;
}

export function loadChests(world, list) {
  ensureChestStorage(world);
  world.chests.clear();
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!c) continue;
    const items = {};
    if (c.items && typeof c.items === 'object') {
      for (const [t, n] of Object.entries(c.items)) {
        if (typeof n === 'number' && n > 0) items[t] = n;
      }
    }
    // Enforce max 30 types
    const keys = Object.keys(items);
    if (keys.length > CHEST_MAX_TYPES) {
      for (const k of keys.slice(CHEST_MAX_TYPES)) delete items[k];
    }
    world.chests.set(chestKey(c.x, c.y, c.z), { items });
  }
}

/**
 * Build chest UI list into a container element.
 */
export function renderChestUI(container, world, x, y, z, gameMode, callbacks) {
  const chest = getChest(world, x, y, z);
  const types = Object.entries(chest.items)
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const used = types.length;
  container.innerHTML = `
    <p class="chest-meta">Types: <b>${used}</b> / ${CHEST_MAX_TYPES} · stacks unlimited</p>
    <div class="chest-slots" id="chest-slots"></div>
    <div class="chest-actions">
      <button type="button" id="chest-deposit-one">Deposit 1 selected</button>
      <button type="button" id="chest-deposit-all">Deposit all selected</button>
    </div>
    <p class="chest-hint">Select a hotbar block, then deposit. Click a stack to take items out.</p>
  `;

  const slots = container.querySelector('#chest-slots');
  if (types.length === 0) {
    slots.innerHTML = '<div class="chest-empty">Chest is empty</div>';
  } else {
    for (const [type, count] of types) {
      const name = BlockTypes[type]?.name || (type === 'CHEESE' ? 'Cheese' : type);
      const row = document.createElement('div');
      row.className = 'chest-row';
      row.innerHTML = `
        <span class="chest-item-name">${name}</span>
        <span class="chest-item-count">×${count}</span>
        <button type="button" data-take="1" data-type="${type}">Take 1</button>
        <button type="button" data-take="64" data-type="${type}">Take 64</button>
        <button type="button" data-take="all" data-type="${type}">Take all</button>
      `;
      slots.appendChild(row);
    }
  }

  slots?.querySelectorAll('button[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const mode = btn.getAttribute('data-take');
      const have = chest.items[type] || 0;
      const amount = mode === 'all' ? have : Math.min(have, parseInt(mode, 10) || 1);
      if (callbacks.onWithdraw) callbacks.onWithdraw(type, amount);
    });
  });

  container.querySelector('#chest-deposit-one')?.addEventListener('click', () => {
    if (callbacks.onDeposit) callbacks.onDeposit(1);
  });
  container.querySelector('#chest-deposit-all')?.addEventListener('click', () => {
    if (callbacks.onDeposit) callbacks.onDeposit('all');
  });
}
