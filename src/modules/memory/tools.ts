import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import type { PiExtDatabaseHandles } from "../../core/database/manager";
import { createMemoryEmbedding } from "./vector";
import type { GlobalDatabase, ProjectDatabase } from "../../core/database/schema";
import {
  createGlobalMemory,
  createProjectMemory,
  searchMemoriesByText,
  type CreateMemoryInput,
  type CreateProjectMemoryInput,
  type MemoryRecord,
  type MemorySearchResult,
  type SearchMemoriesByTextOptions,
} from "./repository";

export interface RegisterMemoryToolsDeps {
  isEnabled(ctx: ExtensionContext): boolean;
  getDatabases(ctx: ExtensionContext): Promise<PiExtDatabaseHandles>;
  getVectorSearchLimit?: (ctx: ExtensionContext) => number;
  enqueueVectorWork?: (ctx: ExtensionContext, handles: PiExtDatabaseHandles) => void;
  embedText?: (ctx: ExtensionContext, text: string, signal?: AbortSignal) => Promise<Float32Array>;
  createGlobalMemory?: (db: Kysely<GlobalDatabase>, input: CreateMemoryInput) => Promise<MemoryRecord>;
  createProjectMemory?: (db: Kysely<ProjectDatabase>, input: CreateProjectMemoryInput) => Promise<MemoryRecord>;
  searchMemoriesByText?: (handles: PiExtDatabaseHandles, options: SearchMemoriesByTextOptions) => Promise<MemorySearchResult[]>;
}

const CreateMemoryParams = Type.Object({
  content: Type.String({ minLength: 1, description: "Memory content to save." }),
  title: Type.Optional(Type.String({ description: "Short optional title for the memory." })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for later grouping." })),
  importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Importance from 1 to 5. Defaults to 3." })),
});

const SearchMemoriesParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Text query to search memory vectors." }),
  scopes: Type.Optional(Type.Array(Type.Union([Type.Literal("global"), Type.Literal("project"), Type.Literal("session")]), { description: "Optional memory scopes to search." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum number of memories to return. Defaults to 8." })),
});

export function registerMemoryTools(pi: Pick<ExtensionAPI, "registerTool">, deps: RegisterMemoryToolsDeps): void {
  const saveGlobal = deps.createGlobalMemory ?? createGlobalMemory;
  const saveProject = deps.createProjectMemory ?? createProjectMemory;
  const search = deps.searchMemoriesByText ?? searchMemoriesByText;

  pi.registerTool({
    name: "create_global_memory",
    label: "create global memory",
    description: "Save a durable global memory in the user's global Pi Ext database.",
    parameters: CreateMemoryParams,
    promptSnippet: "create_global_memory: Save durable user-level facts or preferences that should apply across projects.",
    promptGuidelines: ["Use only for stable cross-project preferences or facts the user wants remembered."],
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!deps.isEnabled(ctx)) return textResult("Memory module is disabled.");
      const input = normalizeInput(params);
      const handles = await deps.getDatabases(ctx);
      const memory = await saveGlobal(handles.global.db, input);
      deps.enqueueVectorWork?.(ctx, handles);
      return textResult(`Created global memory ${memory.id}: ${memory.content}\nVector indexing has been queued in the background.`);
    },
  });

  pi.registerTool({
    name: "create_project_memory",
    label: "create project memory",
    description: "Save a durable project memory in this trusted project's Pi Ext database.",
    parameters: CreateMemoryParams,
    promptSnippet: "create_project_memory: Save durable facts or preferences that apply only to this project.",
    promptGuidelines: ["Use for repository-specific conventions, architecture facts, commands, or user preferences."],
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!deps.isEnabled(ctx)) return textResult("Memory module is disabled.");
      const handles = await deps.getDatabases(ctx);
      if (!handles.project) return textResult("Project memories require a trusted project with a project database.");
      const memory = await saveProject(handles.project.db, { ...normalizeInput(params), scope: "project" });
      deps.enqueueVectorWork?.(ctx, handles);
      return textResult(`Created project memory ${memory.id}: ${memory.content}\nVector indexing has been queued in the background.`);
    },
  });

  pi.registerTool({
    name: "search_memories",
    label: "search memories",
    description: "Search global, project, and session memories with sqlite-vec vector similarity.",
    parameters: SearchMemoriesParams,
    promptSnippet: "search_memories: Search saved memories semantically before relying only on prompt-injected memory summaries.",
    promptGuidelines: ["Use when you need a specific saved memory that may not be included in the current system prompt."],
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!deps.isEnabled(ctx)) return textResult("Memory module is disabled.");
      const handles = await deps.getDatabases(ctx);
      const query = String(params.query).trim();
      const embedding = deps.embedText ? await deps.embedText(ctx, query, signal) : createMemoryEmbedding(query);
      const results = await search(handles, {
        query,
        embedding,
        limit: typeof params.limit === "number" ? params.limit : deps.getVectorSearchLimit?.(ctx) ?? 8,
        sessionId: ctx.sessionManager.getSessionId(),
        scopes: Array.isArray(params.scopes) ? params.scopes : undefined,
      });
      if (results.length === 0) return textResult("No memories matched the query.");
      return textResult(formatSearchResults(results));
    },
  });

  pi.registerTool({
    name: "create_session_memory",
    label: "create session memory",
    description: "Save a memory scoped to the current session in this trusted project's Pi Ext database.",
    parameters: CreateMemoryParams,
    promptSnippet: "create_session_memory: Save facts or instructions that should apply only to the current session.",
    promptGuidelines: ["Use for session-only decisions, temporary constraints, or current task state."],
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!deps.isEnabled(ctx)) return textResult("Memory module is disabled.");
      const handles = await deps.getDatabases(ctx);
      if (!handles.project) return textResult("Session memories require a trusted project with a project database.");
      const sessionId = ctx.sessionManager.getSessionId();
      const memory = await saveProject(handles.project.db, { ...normalizeInput(params), scope: "session", sessionId });
      deps.enqueueVectorWork?.(ctx, handles);
      return textResult(`Created session memory ${memory.id}: ${memory.content}\nVector indexing has been queued in the background.`);
    },
  });
}

function normalizeInput(params: any): CreateMemoryInput {
  const input: CreateMemoryInput = { content: String(params.content).trim() };
  if (typeof params.title === "string") input.title = params.title.trim();
  if (Array.isArray(params.tags)) input.tags = params.tags.filter((tag: unknown): tag is string => typeof tag === "string");
  if (typeof params.importance === "number") input.importance = params.importance;
  return input;
}

function formatSearchResults(results: MemorySearchResult[]): string {
  return results
    .map((memory, index) => {
      const title = memory.title ? ` (${memory.title})` : "";
      const tags = memory.tags.length > 0 ? ` tags=${memory.tags.join(",")}` : "";
      return `${index + 1}. [${memory.scope}] ${memory.id}${title} distance=${memory.distance.toFixed(4)}${tags}\n${memory.content}`;
    })
    .join("\n\n");
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}
