import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import * as sqliteVec from "sqlite-vec";
import { ensureDatabaseDirectory } from "./paths";
import type { DatabaseScope, ScopedDatabase } from "./schema";

export interface OpenedSqliteDatabase<S extends DatabaseScope> {
  readonly scope: S;
  readonly path: string;
  readonly sqlite: BetterSqlite3.Database;
  readonly db: Kysely<ScopedDatabase<S>>;
  destroy(): Promise<void>;
}

export function openSqliteDatabase<S extends DatabaseScope>(scope: S, path: string): OpenedSqliteDatabase<S> {
  ensureDatabaseDirectory(path);
  const sqlite = new BetterSqlite3(path);
  sqliteVec.load(sqlite);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  const db = new Kysely<ScopedDatabase<S>>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  return {
    scope,
    path,
    sqlite,
    db,
    async destroy() {
      await db.destroy();
    },
  };
}
