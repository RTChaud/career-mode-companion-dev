/**
 * lineups.js
 * Starting XIs: a formation (a fixed set of named slots, e.g. "RCB") plus,
 * per saved lineup, which player id (if any) occupies each slot. Designed
 * so more formations can be added later without touching anything else —
 * every slot carries its own tactical role, so the pitch/label rendering
 * never needs position-specific logic beyond "read the slot".
 */
const Lineups = (() => {
  const FORMATIONS = {
    '4-3-3-attack': {
      id: '4-3-3-attack',
      label: '4-3-3 Attack',
      slots: [
        { key: 'GK',  position: 'GK',  label: 'GK',  role: 'Sweeper Keeper',        focus: 'Build Up', x: 50, y: 88 },
        { key: 'RB',  position: 'RB',  label: 'RB',  role: 'Fullback',              focus: 'Balanced', x: 83, y: 59 },
        { key: 'RCB', position: 'CB',  label: 'RCB', role: 'Ball-Playing Defender', focus: 'Defend',   x: 61, y: 65 },
        { key: 'LCB', position: 'CB',  label: 'LCB', role: 'Defender',              focus: 'Defend',   x: 39, y: 65 },
        { key: 'LB',  position: 'LB',  label: 'LB',  role: 'Fullback',              focus: 'Balanced', x: 17, y: 59 },
        { key: 'RCM', position: 'CM',  label: 'RCM', role: 'Holding Midfielder',    focus: 'Defend',   x: 67, y: 41 },
        { key: 'LCM', position: 'CM',  label: 'LCM', role: 'Box-to-Box',            focus: 'Balanced', x: 33, y: 41 },
        { key: 'CAM', position: 'CAM', label: 'CAM', role: 'Shadow Striker',        focus: 'Attack',   x: 50, y: 26 },
        { key: 'RW',  position: 'RW',  label: 'RW',  role: 'Inside Forward',        focus: 'Attack',   x: 81, y: 10 },
        { key: 'ST',  position: 'ST',  label: 'ST',  role: 'Advanced Forward',      focus: 'Attack',   x: 50, y: 5  },
        { key: 'LW',  position: 'LW',  label: 'LW',  role: 'Inside Forward',        focus: 'Attack',   x: 19, y: 10 },
      ],
    },
  };
  const DEFAULT_FORMATION_ID = '4-3-3-attack';

  function getFormation(formationId) {
    return FORMATIONS[formationId] || FORMATIONS[DEFAULT_FORMATION_ID];
  }

  let lineups = [];

  function uid() {
    return 'ln_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeLineup(l) {
    const formationId = (l && FORMATIONS[l.formationId]) ? l.formationId : DEFAULT_FORMATION_ID;
    const validKeys = new Set(getFormation(formationId).slots.map(s => s.key));
    const rawSlots = (l && l.slots && typeof l.slots === 'object' && !Array.isArray(l.slots)) ? l.slots : {};
    const slots = {};
    for (const key of Object.keys(rawSlots)) {
      if (validKeys.has(key) && typeof rawSlots[key] === 'string' && rawSlots[key]) {
        slots[key] = rawSlots[key];
      }
    }
    return {
      id: (l && typeof l.id === 'string' && l.id) ? l.id : uid(),
      name: (l && typeof l.name === 'string' && l.name.trim()) ? l.name.trim() : 'Untitled Lineup',
      formationId,
      slots,
      createdAt: (l && typeof l.createdAt === 'string') ? l.createdAt : new Date().toISOString(),
    };
  }

  function persist() {
    Storage.saveLineups(lineups);
  }

  function init() {
    const saved = Storage.loadLineups();
    lineups = (saved && Array.isArray(saved)) ? saved.map(normalizeLineup) : [];
    persist();
    return lineups;
  }

  function getAll() {
    return lineups.slice();
  }

  function getById(id) {
    return lineups.find(l => l.id === id) || null;
  }

  /** A fresh, unsaved working lineup — id is null until first saved. */
  function createBlank(formationId) {
    return { id: null, name: '', formationId: (formationId && FORMATIONS[formationId]) ? formationId : DEFAULT_FORMATION_ID, slots: {} };
  }

  /**
   * Creates a new saved lineup, or updates an existing one if `data.id`
   * matches one already saved.
   */
  function save(data) {
    const idx = data.id ? lineups.findIndex(l => l.id === data.id) : -1;
    if (idx === -1) {
      const record = normalizeLineup({ ...data, id: uid(), createdAt: new Date().toISOString() });
      lineups.push(record);
      persist();
      return record;
    }
    const record = normalizeLineup({ ...lineups[idx], name: data.name, formationId: data.formationId, slots: data.slots });
    lineups[idx] = record;
    persist();
    return record;
  }

  function remove(id) {
    lineups = lineups.filter(l => l.id !== id);
    persist();
  }

  function duplicate(id) {
    const original = getById(id);
    if (!original) return null;
    const copy = normalizeLineup({
      ...original,
      id: uid(),
      name: `${original.name} (Copy)`,
      createdAt: new Date().toISOString(),
    });
    lineups.push(copy);
    persist();
    return copy;
  }

  /** Number of slots with a player assigned. */
  function filledCount(lineup) {
    return Object.keys(lineup.slots || {}).filter(k => lineup.slots[k]).length;
  }

  /**
   * Called whenever a player is deleted from the squad: clears that
   * player out of every slot in every saved lineup, leaving the slot
   * empty. Lineups themselves are never removed by this.
   */
  function removePlayerEverywhere(playerId) {
    let changed = false;
    lineups = lineups.map(l => {
      const hasPlayer = Object.values(l.slots || {}).includes(playerId);
      if (!hasPlayer) return l;
      changed = true;
      const slots = { ...l.slots };
      for (const key of Object.keys(slots)) {
        if (slots[key] === playerId) delete slots[key];
      }
      return { ...l, slots };
    });
    if (changed) persist();
    return changed;
  }

  function replaceAll(newLineups) {
    lineups = (Array.isArray(newLineups) ? newLineups : []).map(normalizeLineup);
    persist();
    return lineups;
  }

  /** Adds imported lineups alongside existing ones, never overwriting by id collision. */
  function mergeAll(newLineups) {
    const incoming = (Array.isArray(newLineups) ? newLineups : []).map(normalizeLineup);
    const existingIds = new Set(lineups.map(l => l.id));
    for (const l of incoming) {
      lineups.push(existingIds.has(l.id) ? { ...l, id: uid() } : l);
    }
    persist();
    return lineups;
  }

  return {
    FORMATIONS, DEFAULT_FORMATION_ID, getFormation,
    init, getAll, getById, createBlank, save, remove, duplicate,
    filledCount, removePlayerEverywhere, replaceAll, mergeAll,
  };
})();
