import type { Kysely } from "kysely";

export type DatabaseScope = "global" | "project";

export interface GlobalDatabase {}
export interface ProjectDatabase {}

export type ScopedDatabase<S extends DatabaseScope> = S extends "global" ? GlobalDatabase : ProjectDatabase;
export type ScopedKysely<S extends DatabaseScope> = Kysely<ScopedDatabase<S>>;

export interface TableModel<S extends DatabaseScope = DatabaseScope, Name extends string = string> {
  readonly scope: S;
  readonly tableName: Name;
}

export function defineTableModel<S extends DatabaseScope, Name extends string>(model: TableModel<S, Name>): TableModel<S, Name> {
  return model;
}
