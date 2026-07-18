// Tabbed inventory → 10 hotbar slots
import { BlockTypes } from './blocks.js';

export const HOTBAR_SIZE = 10;

/** Default 10 quick-slots (most common placeables) */
export const DEFAULT_HOTBAR = [
  'GRASS',
  'DIRT',
  'STONE',
  'COBBLESTONE',
  'PLANKS',
  'WOOD',
  'GLASS',
  'TORCH',
  'SAND',
  'WATER',
];

/** Catalog tabs for the inventory GUI */
export const INVENTORY_TABS = [
  {
    id: 'natural',
    label: 'Natural',
    items: [
      'GRASS', 'DIRT', 'STONE', 'SAND', 'WATER', 'LEAVES', 'WOOD', 'SAPLING',
      'ANACHARIS', 'WHEAT', 'POPPY', 'DANDELION', 'BLUE_ORCHID', 'PINK_TULIP',
    ],
  },
  {
    id: 'building',
    label: 'Building',
    items: ['COBBLESTONE', 'PLANKS', 'GLASS', 'CHEST', 'BED', 'SIGN', 'TORCH', 'FURNACE'],
  },
  {
    id: 'ores',
    label: 'Ores',
    items: ['COAL_ORE', 'IRON_ORE', 'GOLD_ORE', 'DIAMOND_ORE', 'COAL', 'IRON_INGOT', 'GOLD_INGOT'],
  },
  {
    id: 'food',
    label: 'Food',
    items: ['ANACHARIS', 'COOKED_ANACHARIS', 'WHEAT', 'PRETZEL'],
  },
  {
    id: 'tech',
    label: 'Tech',
    items: ['CODE_BLOCK', 'LED', 'MARS_PORTAL', 'EARTH_PORTAL'],
  },
  {
    id: 'mars',
    label: 'Mars',
    items: [
      'MARS_ROCK', 'MARS_DUST', 'MARS_ICE', 'MARS_BASALT', 'MARS_BRICK',
      'MARS_CRYSTAL', 'MARS_METEORITE', 'MARS_MAGMA', 'RUST_ORE', 'ALIEN_FUNGUS',
      'VENUS_FLYTRAP', 'SUNDEW_ROUND', 'SUNDEW_THREAD', 'SUNDEW_CAPE',
      'PITCHER_PLANT', 'HELIAMPHORA',
      'MARS_PORTAL', 'EARTH_PORTAL',
    ],
  },
];

const STORAGE_KEY = 'mc_clone_hotbar_v1';

function isPlaceable(key) {
  const t = BlockTypes[key];
  // Food items can sit in inventory/hotbar but aren't world blocks to place
  if (t?.isFood) return true;
  return t && key !== 'AIR' && key !== 'BEDROCK';
}

export function loadHotbarSlots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length === HOTBAR_SIZE) {
        return arr.map((k, i) => (isPlaceable(k) ? k : DEFAULT_HOTBAR[i]));
      }
    }
  } catch {
    // ignore
  }
  return [...DEFAULT_HOTBAR];
}

export function saveHotbarSlots(slots) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // ignore
  }
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {HTMLElement} opts.tabsEl
 * @param {HTMLElement} opts.gridEl
 * @param {HTMLElement} opts.hotbarPreviewEl
 * @param {() => string[]} opts.getSlots
 * @param {(slots: string[]) => void} opts.setSlots
 * @param {() => void} opts.onChange  // rebuild main hotbar UI
 * @param {() => void} [opts.onOpen]
 * @param {() => void} [opts.onClose]
 */
export function createInventoryUI(opts) {
  const {
    panel,
    tabsEl,
    gridEl,
    hotbarPreviewEl,
    getSlots,
    setSlots,
    onChange,
    onOpen,
    onClose,
  } = opts;

  let open = false;
  let activeTab = INVENTORY_TABS[0].id;
  /** Which hotbar slot (0-9) is waiting to be filled from the grid */
  let assignSlot = 0;

  function isOpen() {
    return open;
  }

  function shortName(key) {
    return BlockTypes[key]?.name || key;
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = INVENTORY_TABS.map(
      (t) =>
        `<button type="button" class="inv-tab${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
    ).join('');
    tabsEl.querySelectorAll('.inv-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        activeTab = btn.dataset.tab;
        renderTabs();
        renderGrid();
      });
    });
  }

  function renderHotbarPreview() {
    if (!hotbarPreviewEl) return;
    const slots = getSlots();
    hotbarPreviewEl.innerHTML = slots
      .map((key, i) => {
        const sel = i === assignSlot ? ' selected' : '';
        return `<button type="button" class="inv-hot-slot${sel}" data-slot="${i}" title="Slot ${i + 1}: ${shortName(key)}">
          <span class="inv-slot-num">${i === 9 ? 0 : i + 1}</span>
          <span class="inv-slot-name">${shortName(key)}</span>
        </button>`;
      })
      .join('');
    hotbarPreviewEl.querySelectorAll('.inv-hot-slot').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        assignSlot = parseInt(btn.dataset.slot, 10) || 0;
        renderHotbarPreview();
        renderGrid();
      });
    });
  }

  function renderGrid() {
    if (!gridEl) return;
    const tab = INVENTORY_TABS.find((t) => t.id === activeTab) || INVENTORY_TABS[0];
    const items = tab.items.filter(isPlaceable);
    gridEl.innerHTML = items
      .map((key) => {
        const inHot = getSlots().includes(key);
        return `<button type="button" class="inv-item${inHot ? ' in-hotbar' : ''}" data-type="${key}">
          <span class="inv-item-name">${shortName(key)}</span>
          ${inHot ? '<span class="inv-item-badge">hotbar</span>' : ''}
        </button>`;
      })
      .join('');
    gridEl.querySelectorAll('.inv-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const type = btn.dataset.type;
        if (!isPlaceable(type)) return;
        const slots = [...getSlots()];
        slots[assignSlot] = type;
        setSlots(slots);
        saveHotbarSlots(slots);
        // Advance to next slot for faster filling
        assignSlot = (assignSlot + 1) % HOTBAR_SIZE;
        renderHotbarPreview();
        renderGrid();
        onChange?.();
      });
    });
  }

  function renderAll() {
    renderTabs();
    renderHotbarPreview();
    renderGrid();
  }

  function show() {
    if (!panel) return;
    open = true;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    renderAll();
    onOpen?.();
  }

  function hide(relock = true) {
    if (!panel) return;
    open = false;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    onClose?.(relock);
  }

  function toggle() {
    if (open) hide();
    else show();
  }

  panel?.querySelector('#btn-inv-close')?.addEventListener('click', (e) => {
    e.preventDefault();
    hide();
  });
  panel?.querySelector('#btn-inv-reset')?.addEventListener('click', (e) => {
    e.preventDefault();
    setSlots([...DEFAULT_HOTBAR]);
    saveHotbarSlots(getSlots());
    assignSlot = 0;
    renderAll();
    onChange?.();
  });

  return { show, hide, toggle, isOpen, renderAll };
}
