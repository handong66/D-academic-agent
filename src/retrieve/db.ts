import Database from "better-sqlite3";

export type Db = Database.Database;

export function openDb(path = ":memory:"): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return db;
}
