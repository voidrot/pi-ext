import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { PiExtDatabaseHandles } from "../../core/database/manager";
import type { GlobalDatabase, ProjectDatabase } from "../../core/database/schema";
import type { MemoryScope, ProjectMemoryScope } from "./models";
import { createMemoryEmbedding, embeddingToSqliteVector, normalizeEmbedding } from "./vector";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  content: string;
  title?: string;
  tags: string[];
  importance: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
}

export interface CreateMemoryInput {
  content: string;
  title?: string;
  tags?: string[];
  importance?: number;
}

export interface MemorySearchResult extends MemoryRecord {
  distance: number;
}

export interface SearchMemoriesByTextOptions {
  query: string;
  sessionId?: string;
  scopes?: MemoryScope[];
  limit: number;
  embedding?: readonly number[] | Float32Array;
}

export interface CreateProjectMemoryInput extends CreateMemoryInput {
  scope: ProjectMemoryScope;
  sessionId?: string;
}

export interface PromptMemoryList {
  global: MemoryRecord[];
  project: MemoryRecord[];
  session: MemoryRecord[];
}

export type MemoryVectorJobScope = "global" | "project";

export interface MemoryVectorJob {
  dbScope: MemoryVectorJobScope;
  memoryId: string;
  scope: MemoryScope;
  sessionId?: string;
  text: string;
  sourceHash: string;
}

export interface CompleteMemoryVectorJobInput {
  provider: string;
  model?: string;
  dimensions: number;
  embedding: readonly number[] | Float32Array;
}

export async function createGlobalMemory(db: Kysely<GlobalDatabase>, input: CreateMemoryInput): Promise<MemoryRecord> {
  const id = randomUUID();
  const row = {
    id,
    content: input.content.trim(),
    title: normalizeOptionalString(input.title),
    tags_json: JSON.stringify(normalizeTags(input.tags)),
    importance: normalizeImportance(input.importance),
  };

  await db.insertInto("pi_ext_global_memories").values(row).execute();
  await markGlobalMemoryVectorPending(db, id, buildMemoryVectorText(row.title ?? undefined, row.content));
  const saved = await db.selectFrom("pi_ext_global_memories").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return mapGlobalRow(saved);
}

export async function createProjectMemory(db: Kysely<ProjectDatabase>, input: CreateProjectMemoryInput): Promise<MemoryRecord> {
  const id = randomUUID();
  const row = {
    id,
    scope: input.scope,
    session_id: input.scope === "session" ? input.sessionId ?? null : null,
    content: input.content.trim(),
    title: normalizeOptionalString(input.title),
    tags_json: JSON.stringify(normalizeTags(input.tags)),
    importance: normalizeImportance(input.importance),
  };

  await db.insertInto("pi_ext_project_memories").values(row).execute();
  await markProjectMemoryVectorPending(db, id, buildMemoryVectorText(row.title ?? undefined, row.content));
  const saved = await db.selectFrom("pi_ext_project_memories").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return mapProjectRow(saved);
}

export async function listStoredMemories(
  handles: PiExtDatabaseHandles,
  options: { sessionId?: string; limitPerScope: number },
): Promise<PromptMemoryList> {
  const globalRows = await handles.global.db
    .selectFrom("pi_ext_global_memories")
    .selectAll()
    .orderBy("importance", "desc")
    .orderBy("created_at", "desc")
    .limit(options.limitPerScope)
    .execute();

  const projectRows = handles.project
    ? await handles.project.db
      .selectFrom("pi_ext_project_memories")
      .selectAll()
      .where("scope", "=", "project")
      .orderBy("importance", "desc")
      .orderBy("created_at", "desc")
      .limit(options.limitPerScope)
      .execute()
    : [];

  const sessionRows = handles.project && options.sessionId
    ? await handles.project.db
      .selectFrom("pi_ext_project_memories")
      .selectAll()
      .where("scope", "=", "session")
      .where("session_id", "=", options.sessionId)
      .orderBy("importance", "desc")
      .orderBy("created_at", "desc")
      .limit(options.limitPerScope)
      .execute()
    : [];

  return {
    global: globalRows.map(mapGlobalRow),
    project: projectRows.map(mapProjectRow),
    session: sessionRows.map(mapProjectRow),
  };
}

export async function listMemoriesForPrompt(
  handles: PiExtDatabaseHandles,
  options: { sessionId?: string; limitPerScope: number },
): Promise<PromptMemoryList> {
  return listStoredMemories(handles, options);
}

export async function listPendingMemoryVectorJobs(
  handles: PiExtDatabaseHandles,
  options: { limit: number },
): Promise<MemoryVectorJob[]> {
  const limit = normalizeJobLimit(options.limit);
  const jobs: MemoryVectorJob[] = [];

  const globalRows = await handles.global.db
    .selectFrom("pi_ext_global_memory_vector_metadata as meta")
    .innerJoin("pi_ext_global_memories as m", "m.id", "meta.memory_id")
    .select(["m.id", "m.title", "m.content", "meta.source_hash"])
    .where("meta.status", "=", "pending")
    .orderBy("meta.updated_at", "asc")
    .limit(limit)
    .execute();

  jobs.push(...globalRows.map((row) => ({
    dbScope: "global" as const,
    memoryId: row.id,
    scope: "global" as const,
    text: buildMemoryVectorText(row.title ?? undefined, row.content),
    sourceHash: row.source_hash,
  })));

  if (handles.project && jobs.length < limit) {
    const projectRows = await handles.project.db
      .selectFrom("pi_ext_project_memory_vector_metadata as meta")
      .innerJoin("pi_ext_project_memories as m", "m.id", "meta.memory_id")
      .select(["m.id", "m.scope", "m.session_id", "m.title", "m.content", "meta.source_hash"])
      .where("meta.status", "=", "pending")
      .orderBy("meta.updated_at", "asc")
      .limit(limit - jobs.length)
      .execute();

    jobs.push(...projectRows.map((row) => ({
      dbScope: "project" as const,
      memoryId: row.id,
      scope: row.scope,
      sessionId: row.session_id ?? undefined,
      text: buildMemoryVectorText(row.title ?? undefined, row.content),
      sourceHash: row.source_hash,
    })));
  }

  return jobs;
}

export async function completeMemoryVectorJob(
  handles: PiExtDatabaseHandles,
  job: MemoryVectorJob,
  input: CompleteMemoryVectorJobInput,
): Promise<void> {
  const embedding = normalizeEmbedding(input.embedding, input.dimensions);
  if (job.dbScope === "global") {
    await storeGlobalMemoryVector(handles.global.db, job.memoryId, embedding, input);
    return;
  }
  if (!handles.project) throw new Error("Project vector job requires a project database.");
  await storeProjectMemoryVector(handles.project.db, job.memoryId, embedding, input);
}

export async function failMemoryVectorJob(handles: PiExtDatabaseHandles, job: MemoryVectorJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (job.dbScope === "global") {
    await handles.global.db
      .updateTable("pi_ext_global_memory_vector_metadata")
      .set({ status: "failed", error: message, updated_at: sql`CURRENT_TIMESTAMP` })
      .where("memory_id", "=", job.memoryId)
      .execute();
    return;
  }
  if (!handles.project) return;
  await handles.project.db
    .updateTable("pi_ext_project_memory_vector_metadata")
    .set({ status: "failed", error: message, updated_at: sql`CURRENT_TIMESTAMP` })
    .where("memory_id", "=", job.memoryId)
    .execute();
}

export async function searchMemoriesByText(
  handles: PiExtDatabaseHandles,
  options: SearchMemoriesByTextOptions,
): Promise<MemorySearchResult[]> {
  const queryEmbedding = embeddingToSqliteVector(options.embedding ? normalizeEmbedding(options.embedding) : createMemoryEmbedding(options.query));
  const scopes = new Set(options.scopes ?? ["global", "project", "session"]);
  const limit = normalizeSearchLimit(options.limit);
  const searchK = Math.min(limit * 10, 200);
  const results: MemorySearchResult[] = [];

  if (scopes.has("global")) {
    const rows = await sql<any>`
      select m.*, v.distance as distance
      from pi_ext_global_memory_vectors v
      join pi_ext_global_memories m on m.id = v.memory_id
      join pi_ext_global_memory_vector_metadata meta on meta.memory_id = m.id
      where v.embedding match ${queryEmbedding} and k = ${searchK} and meta.status = 'completed'
      order by v.distance
    `.execute(handles.global.db);
    results.push(...rows.rows.map((row: any) => ({ ...mapGlobalRow(row), distance: Number(row.distance) })));
  }

  if (handles.project && scopes.has("project")) {
    const rows = await sql<any>`
      select m.*, v.distance as distance
      from pi_ext_project_memory_vectors v
      join pi_ext_project_memories m on m.id = v.memory_id
      join pi_ext_project_memory_vector_metadata meta on meta.memory_id = m.id
      where v.embedding match ${queryEmbedding} and k = ${searchK} and m.scope = 'project' and meta.status = 'completed'
      order by v.distance
    `.execute(handles.project.db);
    results.push(...rows.rows.map((row: any) => ({ ...mapProjectRow(row), distance: Number(row.distance) })));
  }

  if (handles.project && scopes.has("session") && options.sessionId) {
    const rows = await sql<any>`
      select m.*, v.distance as distance
      from pi_ext_project_memory_vectors v
      join pi_ext_project_memories m on m.id = v.memory_id
      join pi_ext_project_memory_vector_metadata meta on meta.memory_id = m.id
      where v.embedding match ${queryEmbedding} and k = ${searchK} and m.scope = 'session' and m.session_id = ${options.sessionId} and meta.status = 'completed'
      order by v.distance
    `.execute(handles.project.db);
    results.push(...rows.rows.map((row: any) => ({ ...mapProjectRow(row), distance: Number(row.distance) })));
  }

  return results.toSorted((left, right) => left.distance - right.distance).slice(0, limit);
}

export function buildMemoryVectorText(title: string | undefined, content: string): string {
  return [title, content].filter(Boolean).join("\n");
}

async function markGlobalMemoryVectorPending(db: Kysely<GlobalDatabase>, id: string, text: string): Promise<void> {
  await db.insertInto("pi_ext_global_memory_vector_metadata")
    .values({ memory_id: id, dimensions: 256, source_hash: hashVectorSource(text), status: "pending" })
    .onConflict((oc) => oc.column("memory_id").doUpdateSet({
      source_hash: hashVectorSource(text),
      status: "pending",
      error: null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }))
    .execute();
}

async function markProjectMemoryVectorPending(db: Kysely<ProjectDatabase>, id: string, text: string): Promise<void> {
  await db.insertInto("pi_ext_project_memory_vector_metadata")
    .values({ memory_id: id, dimensions: 256, source_hash: hashVectorSource(text), status: "pending" })
    .onConflict((oc) => oc.column("memory_id").doUpdateSet({
      source_hash: hashVectorSource(text),
      status: "pending",
      error: null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }))
    .execute();
}

async function storeGlobalMemoryVector(
  db: Kysely<GlobalDatabase>,
  id: string,
  embedding: Float32Array,
  input: CompleteMemoryVectorJobInput,
): Promise<void> {
  await sql`delete from pi_ext_global_memory_vectors where memory_id = ${id}`.execute(db);
  await sql`insert into pi_ext_global_memory_vectors(memory_id, embedding) values (${id}, ${embeddingToSqliteVector(embedding)})`.execute(db);
  await db.updateTable("pi_ext_global_memory_vector_metadata")
    .set({
      provider: input.provider,
      model: input.model ?? null,
      dimensions: input.dimensions,
      status: "completed",
      error: null,
      generated_at: sql`CURRENT_TIMESTAMP`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where("memory_id", "=", id)
    .execute();
}

async function storeProjectMemoryVector(
  db: Kysely<ProjectDatabase>,
  id: string,
  embedding: Float32Array,
  input: CompleteMemoryVectorJobInput,
): Promise<void> {
  await sql`delete from pi_ext_project_memory_vectors where memory_id = ${id}`.execute(db);
  await sql`insert into pi_ext_project_memory_vectors(memory_id, embedding) values (${id}, ${embeddingToSqliteVector(embedding)})`.execute(db);
  await db.updateTable("pi_ext_project_memory_vector_metadata")
    .set({
      provider: input.provider,
      model: input.model ?? null,
      dimensions: input.dimensions,
      status: "completed",
      error: null,
      generated_at: sql`CURRENT_TIMESTAMP`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where("memory_id", "=", id)
    .execute();
}

function hashVectorSource(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeSearchLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 50) : 8;
}

function normalizeJobLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : 10;
}

function mapGlobalRow(row: any): MemoryRecord {
  return {
    id: row.id,
    scope: "global",
    content: row.content,
    title: row.title ?? undefined,
    tags: parseTags(row.tags_json),
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectRow(row: any): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    title: row.title ?? undefined,
    tags: parseTags(row.tags_json),
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionId: row.session_id ?? undefined,
  };
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function normalizeImportance(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 1 && value! <= 5 ? value! : 3;
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
