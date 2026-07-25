/**
 * players.js
 * Player data: the squad roster itself, plus First Team/Academy
 * grouping. Depends on storage.js (Storage.load/save) for persistence.
 */
const Players = (() => {

  const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'CM', 'CAM', 'RW', 'LW', 'ST'];

  // Empty string ('') is always a valid "no role selected" value — see NO_ROLE.
  const TACTICAL_ROLES = [
    'Goalkeeper', 'Sweeper Keeper',
    'Fullback', 'Wingback',
    'Defender', 'Stopper', 'Ball-Playing Defender',
    'Holding Midfielder', 'Deep-Lying Playmaker', 'Box-to-Box', 'Playmaker',
    'Shadow Striker',
    'Winger', 'Inside Forward',
    'Advanced Forward', 'Target Forward'
  ];
  const NO_ROLE = ''; // sentinel for "tactical role left blank"

  const PLAYSTYLES = [
    'Acrobatic', 'Aerial Fortress', 'Anticipate', 'Block', 'Bruiser',
    'Chip Shot', 'Cross Claimer', 'Dead Ball', 'Deflector', 'Enforcer',
    'Far Reach', 'Far Throw', 'Finesse Shot', 'First Touch', 'Footwork',
    'Game Changer', 'Incisive Pass', 'Intercept', 'Inventive', 'Jockey',
    'Long Ball Pass', 'Long Throw', 'Low Driven Shot', 'Pinged Pass', 'Power Shot',
    'Precision Header', 'Press Proven', 'Quick Step', 'Rapid', 'Relentless',
    'Rush Out', 'Slide Tackle', 'Technical', 'Tiki Taka', 'Trickster',
    'Whipped Pass'
  ].sort((a, b) => a.localeCompare(b));

  const SORT_FIELDS = [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'age', label: 'Age', type: 'number' },
    { key: 'overall', label: 'Overall', type: 'number' },
    { key: 'potential', label: 'Potential', type: 'number' },
    { key: 'position', label: 'Position', type: 'string' },
    { key: 'role', label: 'Tactical Role', type: 'string' },
    { key: 'playstyleCount', label: 'PlayStyles', type: 'number' },
  ];

  /**
   * The squad is split into sections (First Team, Academy, and — later —
   * things like Loaned Players or a Transfer Shortlist). Every player
   * belongs to exactly one section, stored as `player.playerGroup`.
   * Adding a new section later is just adding an entry here: the
   * segmented control, the default-group logic, the schema migration,
   * and the query filter all read from this one list.
   */
  const GROUPS = [
    { id: 'squad', label: 'First Team' },
    { id: 'academy', label: 'Academy' },
    { id: 'shortlist', label: 'Shortlist' },
  ];
  const DEFAULT_GROUP = GROUPS[0].id; // new players land here unless told otherwise

  function isValidGroup(id) {
    return GROUPS.some(g => g.id === id);
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  let players = [];

  function init() {
    const saved = Storage.load();
    players = (saved && Array.isArray(saved))
      ? saved.map(migrateLegacyPlayer)
      : [];
    persist();
    return players;
  }

  /**
   * Upgrades players saved by older versions of the app to the current
   * schema, so existing localStorage data never breaks or gets discarded
   * when the app evolves. Safe to run on an already-current player too.
   */
  function migrateLegacyPlayer(p) {
    const player = { ...p };

    // v1 stored `playstyles` as a plain count (number). Convert it into
    // a list of generic placeholder entries so the total count is preserved.
    if (typeof player.playstyles === 'number') {
      const count = player.playstyles;
      player.playstyles = Array.from({ length: count }, (_, i) => `Unlisted PlayStyle ${i + 1}`);
    }
    if (!Array.isArray(player.playstyles)) player.playstyles = [];

    if (!Array.isArray(player.playstylesPlus)) player.playstylesPlus = [];

    // v1 stored Value in £ millions (e.g. 4.5 for £4.5m). v2 stores it
    // directly in whole pounds (e.g. 4500000). Convert existing saved
    // values exactly once — the `valueUnit` marker (set on every player
    // from here on) prevents a later load from re-multiplying data that's
    // already been migrated.
    if (typeof player.value === 'number' && !Number.isNaN(player.value) && player.valueUnit !== 'GBP') {
      player.value = player.value * 1_000_000;
    }
    player.valueUnit = 'GBP';

    if (typeof player.value !== 'number' || Number.isNaN(player.value)) {
      player.value = null;
    }

    if (typeof player.role !== 'string') player.role = NO_ROLE;

    if (!isValidGroup(player.playerGroup)) {
      player.playerGroup = DEFAULT_GROUP;
    }

    if (!player.id) player.id = uid();

    return player;
  }

  function persist() {
    Storage.save(players);
  }

  function getAll() {
    return players.slice();
  }

  function getById(id) {
    return players.find(p => p.id === id) || null;
  }

  function add(data) {
    const player = {
      id: uid(),
      playerGroup: isValidGroup(data.playerGroup) ? data.playerGroup : DEFAULT_GROUP,
      ...normalize(data),
    };
    players.push(player);
    persist();
    return player;
  }

  function update(id, data) {
    const idx = players.findIndex(p => p.id === id);
    if (idx === -1) return null;
    // playerGroup is only changed when explicitly provided and valid (e.g.
    // from the Add/Edit form's required Squad section field, or via
    // setPlayerGroup below) — editing other fields never resets it.
    const playerGroup = (data.playerGroup !== undefined && isValidGroup(data.playerGroup))
      ? data.playerGroup
      : players[idx].playerGroup;
    players[idx] = { ...players[idx], ...normalize(data), playerGroup };
    persist();
    return players[idx];
  }

  /**
   * Moves a player to a different section (e.g. First Team <-> Academy)
   * without touching any other field — a plain shallow-copy-and-patch,
   * deliberately kept separate from update()/normalize() so a promote/
   * move action can never accidentally wipe or reset the rest of the
   * player's data.
   */
  function setPlayerGroup(id, groupId) {
    const idx = players.findIndex(p => p.id === id);
    if (idx === -1) return null;
    players[idx] = { ...players[idx], playerGroup: isValidGroup(groupId) ? groupId : DEFAULT_GROUP };
    persist();
    return players[idx];
  }

  /**
   * "Sign Player": moves a Shortlist player to First Team and clears
   * their shortlist Price, preserving every other field. Kept as its
   * own targeted function (like setPlayerGroup) rather than going
   * through update()/normalize(), so it can never accidentally touch
   * anything else about the player.
   */
  function signPlayer(id) {
    const idx = players.findIndex(p => p.id === id);
    if (idx === -1) return null;
    players[idx] = { ...players[idx], playerGroup: DEFAULT_GROUP, value: null };
    persist();
    return players[idx];
  }

  function remove(id) {
    players = players.filter(p => p.id !== id);
    persist();
  }

  /**
   * Normalised key used to detect "likely duplicate" players when an
   * imported record has no ID to match against (e.g. a very old backup,
   * or a record from outside this app). Intentionally coarse: name + age
   * + position, case/whitespace-insensitive.
   */
  function duplicateKey(p) {
    const name = String(p.name != null ? p.name : '').trim().toLowerCase();
    const age = Number.isFinite(Number(p.age)) ? Number(p.age) : '';
    const position = String(p.position != null ? p.position : '').trim().toUpperCase();
    return `${name}|${age}|${position}`;
  }

  /**
   * Counts how many players in `incoming` look like duplicates of players
   * already in the squad (matched by stable ID first, then by the
   * name+age+position key above). Read-only — used to preview an import
   * before anything is changed.
   */
  function countLikelyDuplicates(incoming) {
    const existingIds = new Set(players.map(p => p.id));
    const existingKeys = new Set(players.map(duplicateKey));
    return incoming.filter(p => (p.id && existingIds.has(p.id)) || existingKeys.has(duplicateKey(p))).length;
  }

  /**
   * Wholesale replace — used by "Replace current data" on import.
   * Keeps whatever IDs the backup already had, since this is meant to be
   * an exact restore rather than a fresh set of players.
   */
  function replaceAll(newPlayers) {
    players = newPlayers.map(p => ({ ...p, id: p.id || uid() }));
    persist();
    return { imported: players.length, duplicatesSkipped: 0, duplicatesReplaced: 0, duplicatesAdded: 0 };
  }

  /**
   * Adds `incoming` players to the existing squad, using a single
   * duplicate-handling strategy for the whole import:
   *   'keep-current'  – skip the imported player, leave the existing one
   *   'use-imported'  – overwrite the existing player with the imported one
   *   'keep-both'     – add the imported player alongside as a new player
   */
  function mergeAll(incoming, strategy) {
    let imported = 0, duplicatesSkipped = 0, duplicatesReplaced = 0, duplicatesAdded = 0;
    const existingIds = new Set(players.map(p => p.id));
    const existingByKey = new Map(players.map(p => [duplicateKey(p), p]));

    incoming.forEach(incomingPlayer => {
      const idMatch = incomingPlayer.id ? players.find(p => p.id === incomingPlayer.id) : null;
      const keyMatch = !idMatch ? existingByKey.get(duplicateKey(incomingPlayer)) : null;
      const duplicate = idMatch || keyMatch;

      if (!duplicate) {
        const newId = (incomingPlayer.id && !existingIds.has(incomingPlayer.id)) ? incomingPlayer.id : uid();
        const newPlayer = { ...incomingPlayer, id: newId };
        existingIds.add(newId);
        players.push(newPlayer);
        imported++;
        return;
      }

      if (strategy === 'use-imported') {
        const idx = players.findIndex(p => p.id === duplicate.id);
        if (idx > -1) {
          players[idx] = { ...incomingPlayer, id: duplicate.id };
          duplicatesReplaced++;
        }
      } else if (strategy === 'keep-both') {
        const newId = uid();
        players.push({ ...incomingPlayer, id: newId });
        existingIds.add(newId);
        duplicatesAdded++;
      } else { // 'keep-current' (default/safest)
        duplicatesSkipped++;
      }
    });

    persist();
    return { imported, duplicatesSkipped, duplicatesReplaced, duplicatesAdded };
  }

  function normalize(data) {
    return {
      name: (data.name || '').trim(),
      age: Number(data.age),
      overall: Number(data.overall),
      potential: Number(data.potential),
      position: data.position,
      role: data.role || NO_ROLE,
      value: (data.value === '' || data.value === null || data.value === undefined || Number.isNaN(Number(data.value)))
        ? null
        : Number(data.value),
      valueUnit: 'GBP',
      playstyles: Array.isArray(data.playstyles) ? data.playstyles.slice() : [],
      playstylesPlus: Array.isArray(data.playstylesPlus) ? data.playstylesPlus.slice() : [],
      notes: (data.notes || '').trim(),
    };
  }

  function playstyleCount(p) {
    return (p.playstyles ? p.playstyles.length : 0) + (p.playstylesPlus ? p.playstylesPlus.length : 0);
  }

  function formatValue(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** Same grouping/decimals as formatValue, but without the £ symbol — used
   *  to display the Value field's contents (e.g. on blur, or when opening
   *  the edit form) while it isn't being actively typed into. */
  function formatValueForInput(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '';
    return value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Pure query pipeline: search -> filter -> sort.
   * Takes the full list plus a query descriptor, returns a new array.
   */
  function query(list, { search = '', positions = [], roles = [], group = null, sortKey = 'name', sortDir = 'asc' } = {}) {
    let result = list.slice();

    if (group) {
      result = result.filter(p => (isValidGroup(p.playerGroup) ? p.playerGroup : DEFAULT_GROUP) === group);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q));
    }

    if (positions.length) {
      result = result.filter(p => positions.includes(p.position));
    }

    if (roles.length) {
      result = result.filter(p => roles.includes(p.role));
    }

    const field = SORT_FIELDS.find(f => f.key === sortKey) || SORT_FIELDS[0];
    result.sort((a, b) => {
      let av, bv;
      if (field.key === 'playstyleCount') {
        av = playstyleCount(a);
        bv = playstyleCount(b);
      } else if (field.key === 'position') {
        // Pitch order (GK, RB, CB, LB, CM, CAM, RW, LW, ST), not alphabetical.
        av = POSITIONS.indexOf(a.position);
        bv = POSITIONS.indexOf(b.position);
        return av - bv;
      } else {
        av = a[field.key];
        bv = b[field.key];
      }
      if (field.type === 'string') {
        av = (av || '').toLowerCase();
        bv = (bv || '').toLowerCase();
        return av.localeCompare(bv);
      }
      return av - bv;
    });

    if (sortDir === 'desc') result.reverse();

    return result;
  }

  return {
    POSITIONS, TACTICAL_ROLES, PLAYSTYLES, NO_ROLE, SORT_FIELDS,
    GROUPS, DEFAULT_GROUP,
    init, getAll, getById, add, update, remove, setPlayerGroup, signPlayer, query,
    playstyleCount, formatValue, formatValueForInput,
    migrateLegacyPlayer, replaceAll, mergeAll, countLikelyDuplicates,
  };
})();
