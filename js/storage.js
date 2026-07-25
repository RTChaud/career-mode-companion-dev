/**
 * storage.js
 * Thin wrapper around localStorage so the rest of the app never
 * touches the browser API directly. Swap this module out later
 * (e.g. for a backend sync) without touching anything else.
 *
 * Storage keys (do not rename without an automatic migration —
 * renaming silently would orphan everyone's existing saved squad):
 *   - PLAYERS_KEY:      'squadhub.players.v1'        (unchanged since v1)
 *   - SETTINGS_KEY:     'squadhub.settings.v1'        (new: small persisted preferences)
 *   - PRE_IMPORT_KEY:   'fc26_pre_import_backup'      (new: temporary safety copy, see importAppData)
 */
const Storage = (() => {
  const KEY = 'squadhub.players.v1'; // players — unchanged, see note above
  const SETTINGS_KEY = 'squadhub.settings.v1';
  const PRE_IMPORT_KEY = 'fc26_pre_import_backup';
  const LINEUPS_KEY = 'squadhub.lineups.v1';

  function isAvailable() {
    try {
      const t = '__squadhub_test__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  const available = isAvailable();

  function readJSON(key) {
    if (!available) return null;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error(`SquadHub: failed to read "${key}"`, e);
      return null;
    }
  }

  function writeJSON(key, value) {
    if (!available) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`SquadHub: failed to write "${key}"`, e);
      return false;
    }
  }

  // ---- Players (unchanged behaviour/signature from earlier versions) ----

  function load() {
    return readJSON(KEY);
  }

  function save(players) {
    return writeJSON(KEY, players);
  }

  // ---- Settings (new: small persisted preferences, e.g. last backup date) ----

  function loadSettings() {
    const settings = readJSON(SETTINGS_KEY);
    return (settings && typeof settings === 'object' && !Array.isArray(settings)) ? settings : {};
  }

  function saveSettings(settings) {
    return writeJSON(SETTINGS_KEY, settings || {});
  }

  // ---- Pre-import safety copy (new: written just before a backup import mutates data) ----

  function savePreImportBackup(players) {
    return writeJSON(PRE_IMPORT_KEY, players);
  }

  function loadPreImportBackup() {
    return readJSON(PRE_IMPORT_KEY);
  }

  function clearPreImportBackup() {
    if (!available) return;
    try { window.localStorage.removeItem(PRE_IMPORT_KEY); } catch (e) { /* non-fatal */ }
  }

  // ---- Lineups (new: saved starting XIs) ----

  function loadLineups() {
    return readJSON(LINEUPS_KEY);
  }

  function saveLineups(lineups) {
    return writeJSON(LINEUPS_KEY, lineups);
  }

  return {
    load, save,
    loadSettings, saveSettings,
    savePreImportBackup, loadPreImportBackup, clearPreImportBackup,
    loadLineups, saveLineups,
    available,
    PLAYERS_KEY: KEY, SETTINGS_KEY, PRE_IMPORT_KEY, LINEUPS_KEY,
  };
})();


/**
 * backup.js
 * Full-squad export/import. This is the ONLY place that reads/writes
 * the backup file format — everything else keeps using Players/Storage
 * as normal. Schema:
 *
 *   {
 *     "app": "Squad Hub",
 *     "schemaVersion": 1,
 *     "exportedAt": "2026-07-21T12:00:00.000Z",
 *     "data": {
 *       "players": [ ...same shape Players stores... ],
 *       "settings": { "lastBackupExportedAt": "..." }
 *     }
 *   }
 */
const Backup = (() => {
  const SCHEMA_VERSION = 1;
  const APP_NAME = 'Squad Hub';

  function exportAppData() {
    return {
      app: APP_NAME,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        players: Players.getAll(),
        lineups: Lineups.getAll(),
        settings: Storage.loadSettings(),
      },
    };
  }

  /**
   * Checks that parsed JSON looks like a Squad Hub backup, without being
   * so strict that a slightly-older or slightly-different-but-plausible
   * backup gets rejected outright. Never runs/evaluates anything in the
   * file — this is a pure structural check.
   */
  function validateBackup(raw) {
    if (raw === null || typeof raw !== 'object') {
      return { valid: false, error: 'This file isn\u2019t a valid backup (not a JSON object).' };
    }

    // Be lenient: a bare array of player-like objects is treated as a
    // minimal/legacy-style backup rather than rejected outright.
    let backup = Array.isArray(raw) ? { schemaVersion: 0, data: { players: raw, settings: {} } } : raw;

    if (backup.data === null || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
      return { valid: false, error: 'This file doesn\u2019t look like a Squad Hub backup (no "data" section).' };
    }

    if (!Array.isArray(backup.data.players)) {
      return { valid: false, error: 'This file doesn\u2019t look like a Squad Hub backup (no player list).' };
    }

    if (backup.schemaVersion !== undefined && typeof backup.schemaVersion !== 'number') {
      return { valid: false, error: 'This backup\u2019s version information is invalid.' };
    }

    if (typeof backup.schemaVersion === 'number' && backup.schemaVersion > SCHEMA_VERSION) {
      return { valid: false, error: 'This backup was created by a newer version of the app and can\u2019t be safely imported here.' };
    }

    // Drop anything that isn't at least a plain object — everything else
    // (missing optional fields, unknown extra fields) is handled by
    // migrateBackupData()/Players.migrateLegacyPlayer() rather than failing here.
    const players = backup.data.players.filter(p => p !== null && typeof p === 'object' && !Array.isArray(p));

    const settings = (backup.data.settings && typeof backup.data.settings === 'object' && !Array.isArray(backup.data.settings))
      ? backup.data.settings
      : {};

    // Older backups won't have a lineups array at all — that's fine,
    // it just means an empty lineup list.
    const lineups = Array.isArray(backup.data.lineups)
      ? backup.data.lineups.filter(l => l !== null && typeof l === 'object' && !Array.isArray(l))
      : [];

    return {
      valid: true,
      backup: {
        app: typeof backup.app === 'string' ? backup.app : APP_NAME,
        schemaVersion: typeof backup.schemaVersion === 'number' ? backup.schemaVersion : 0,
        exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : null,
        data: { players, lineups, settings },
      },
    };
  }

  /**
   * Upgrades an already-validated backup's player records to the current
   * schema. Reuses the exact same per-player migration the app already
   * applies to its own localStorage data, so backups and normal app
   * storage are always brought up to date the same way.
   */
  function migrateBackupData(backup) {
    return {
      players: backup.data.players.map(Players.migrateLegacyPlayer),
      lineups: backup.data.lineups || [],
      settings: backup.data.settings || {},
    };
  }

  /**
   * Applies a validated backup. Always takes an in-memory + best-effort
   * on-disk safety copy of the current squad first, and rolls back if
   * anything throws partway through — the database is never left
   * half-imported.
   *
   * @param {object} backup   result of validateBackup(...).backup
   * @param {'replace'|'merge'} mode
   * @param {'keep-current'|'use-imported'|'keep-both'} [duplicateStrategy] only used for 'merge'
   */
  function importAppData(backup, mode, duplicateStrategy) {
    const migrated = migrateBackupData(backup);
    const previousPlayers = Players.getAll(); // in-memory safety copy
    const previousLineups = Lineups.getAll();
    Storage.savePreImportBackup(previousPlayers); // best-effort on-disk safety copy

    try {
      const result = (mode === 'replace')
        ? Players.replaceAll(migrated.players)
        : Players.mergeAll(migrated.players, duplicateStrategy || 'keep-current');

      if (mode === 'replace') {
        Lineups.replaceAll(migrated.lineups);
      } else {
        Lineups.mergeAll(migrated.lineups);
      }

      // Settings are merged in (imported values win) rather than replacing
      // the whole settings object, so unrelated local preferences survive.
      Storage.saveSettings({ ...Storage.loadSettings(), ...migrated.settings });

      Storage.clearPreImportBackup();
      return { success: true, mode, ...result };
    } catch (err) {
      console.error('SquadHub: import failed, restoring previous squad', err);
      Players.replaceAll(previousPlayers);
      Lineups.replaceAll(previousLineups);
      Storage.clearPreImportBackup();
      return { success: false, error: 'Import failed — your previous squad has been restored.' };
    }
  }

  return { exportAppData, validateBackup, migrateBackupData, importAppData, SCHEMA_VERSION };
})();
