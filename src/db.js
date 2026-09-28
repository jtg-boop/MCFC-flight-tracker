import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'DEN',
  depart_from TEXT NOT NULL,
  depart_to TEXT NOT NULL,
  return_from TEXT NOT NULL,
  return_to TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  cabin TEXT NOT NULL DEFAULT 'economy',
  preferred_airline TEXT NOT NULL DEFAULT 'UA',
  max_stops INTEGER NOT NULL DEFAULT 1,
  include_lhr_rail INTEGER NOT NULL DEFAULT 1,
  include_man INTEGER NOT NULL DEFAULT 1,
  target_price_usd REAL,
  match_date TEXT,
  match_label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_alert_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL,
  error TEXT,
  flight_provider TEXT,
  best_preferred_usd REAL,
  best_any_usd REAL
);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  depart_date TEXT NOT NULL,
  return_date TEXT NOT NULL,
  route TEXT NOT NULL,
  is_preferred INTEGER NOT NULL,
  carrier TEXT,
  flight_usd REAL,
  rail_usd REAL,
  transfer_usd REAL,
  total_usd REAL NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_trip ON runs(trip_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_options_run ON options(run_id);
`;

const TRIP_FIELDS = [
  'name', 'origin', 'depart_from', 'depart_to', 'return_from', 'return_to', 'adults', 'cabin',
  'preferred_airline', 'max_stops', 'include_lhr_rail', 'include_man', 'target_price_usd',
  'match_date', 'match_label', 'active',
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return createRepo(db);
}

function createRepo(db) {
  const parseOption = (row) => ({ ...row, is_preferred: !!row.is_preferred, details: row.details ? JSON.parse(row.details) : null });

  return {
    db,

    listTrips() {
      return db.prepare(`
        SELECT t.*,
          (SELECT checked_at FROM runs r WHERE r.trip_id = t.id ORDER BY r.id DESC LIMIT 1) AS last_checked_at,
          (SELECT best_preferred_usd FROM runs r WHERE r.trip_id = t.id AND r.status = 'ok' ORDER BY r.id DESC LIMIT 1) AS latest_preferred_usd,
          (SELECT best_any_usd FROM runs r WHERE r.trip_id = t.id AND r.status = 'ok' ORDER BY r.id DESC LIMIT 1) AS latest_any_usd,
          (SELECT MIN(best_preferred_usd) FROM runs r WHERE r.trip_id = t.id) AS lowest_preferred_usd
        FROM trips t ORDER BY COALESCE(t.match_date, t.depart_from)
      `).all();
    },

    getTrip(id) {
      return db.prepare('SELECT * FROM trips WHERE id = ?').get(id);
    },

    createTrip(trip) {
      const fields = TRIP_FIELDS.filter((f) => trip[f] !== undefined);
      const sql = `INSERT INTO trips (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`;
      const { lastInsertRowid } = db.prepare(sql).run(...fields.map((f) => trip[f]));
      return this.getTrip(Number(lastInsertRowid));
    },

    updateTrip(id, changes) {
      const fields = [...TRIP_FIELDS, 'last_alert_usd'].filter((f) => changes[f] !== undefined);
      if (!fields.length) return this.getTrip(id);
      db.prepare(`UPDATE trips SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...fields.map((f) => changes[f]), id);
      return this.getTrip(id);
    },

    deleteTrip(id) {
      return db.prepare('DELETE FROM trips WHERE id = ?').run(id).changes > 0;
    },

    saveRun({ tripId, status, error = null, flightProvider, options = [] }) {
      const preferred = options.filter((o) => o.isPreferred).map((o) => o.totalUsd);
      const all = options.map((o) => o.totalUsd);
      db.exec('BEGIN');
      try {
        const { lastInsertRowid } = db.prepare(
          'INSERT INTO runs (trip_id, status, error, flight_provider, best_preferred_usd, best_any_usd) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(tripId, status, error, flightProvider, preferred.length ? Math.min(...preferred) : null, all.length ? Math.min(...all) : null);
        const insert = db.prepare(`
          INSERT INTO options (run_id, depart_date, return_date, route, is_preferred, carrier, flight_usd, rail_usd, transfer_usd, total_usd, details)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const o of options) {
          insert.run(lastInsertRowid, o.departDate, o.returnDate, o.route, o.isPreferred ? 1 : 0, o.carrier, o.flightUsd, o.railUsd, o.transferUsd, o.totalUsd, JSON.stringify(o.details));
        }
        db.exec('COMMIT');
        return Number(lastInsertRowid);
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    latestRun(tripId) {
      const run = db.prepare('SELECT * FROM runs WHERE trip_id = ? ORDER BY id DESC LIMIT 1').get(tripId);
      if (!run) return null;
      const options = db.prepare('SELECT * FROM options WHERE run_id = ? ORDER BY total_usd').all(run.id).map(parseOption);
      return { ...run, options };
    },

    // Cheapest total per route/airline group for each successful run: drives the history chart.
    history(tripId) {
      return db.prepare(`
        SELECT r.id AS run_id, r.checked_at, o.route, o.is_preferred, MIN(o.total_usd) AS total_usd
        FROM runs r JOIN options o ON o.run_id = r.id
        WHERE r.trip_id = ? AND r.status = 'ok'
        GROUP BY r.id, o.route, o.is_preferred
        ORDER BY r.id
      `).all(tripId).map((row) => ({ ...row, is_preferred: !!row.is_preferred }));
    },
  };
}
