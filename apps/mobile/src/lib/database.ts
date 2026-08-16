import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { MobileCache } from "@/state/types";

let database: Promise<SQLiteDatabase> | null = null;
const getDatabase = async () => {
  if (!database) {
    database = openDatabaseAsync("xinyun-mobile.db").then(async (db) => {
      await db.execAsync("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL);");
      return db;
    });
  }
  return database;
};

export async function loadCache(): Promise<MobileCache | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM cache WHERE key='workspace'");
  if (!row) return null;
  try { return JSON.parse(row.value) as MobileCache; } catch { return null; }
}

export async function saveCache(cache: MobileCache): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("INSERT INTO cache(key,value,updated_at) VALUES('workspace',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", JSON.stringify(cache), Date.now());
}

export async function clearCache(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM cache WHERE key='workspace'");
}
