import { SQLiteDatabase, openDatabaseSync } from "expo-sqlite";

const DB_NAME = "terminalsync.db";
const STORE_ID = 1;

export interface ConnectionInfo {
  host: string;
  port: string;
  token: string;
}

let db: SQLiteDatabase | null = null;

function getDb(): SQLiteDatabase {
  if (!db) {
    db = openDatabaseSync(DB_NAME);
    db.execSync(
      `CREATE TABLE IF NOT EXISTS connection (id INTEGER PRIMARY KEY, host TEXT NOT NULL, port TEXT NOT NULL, token TEXT NOT NULL)`
    );
  }
  return db;
}

export function saveConnection(info: ConnectionInfo): void {
  const d = getDb();
  d.runSync(
    `INSERT OR REPLACE INTO connection (id, host, port, token) VALUES (?, ?, ?, ?)`,
    STORE_ID,
    info.host,
    info.port,
    info.token
  );
}

export function loadConnection(): ConnectionInfo | null {
  const d = getDb();
  const row = d.getFirstSync<{ host: string; port: string; token: string }>(
    `SELECT host, port, token FROM connection WHERE id = ?`,
    STORE_ID
  );
  return row ?? null;
}
