import { Ollama, type EmbedRequest, type EmbedResponse } from "ollama";
import type { MemoryModuleConfig } from "../../core/config";

export const MEMORY_VECTOR_DIMENSIONS = 256;

export interface EmbeddingProvider {
  readonly name: string;
  readonly model?: string;
  readonly dimensions: number;
  embed(text: string, signal?: AbortSignal): Promise<Float32Array>;
}

export interface OllamaEmbeddingClient {
  embed(request: EmbedRequest): Promise<EmbedResponse>;
  abort?(): void;
}

export interface OllamaEmbeddingClientOptions {
  host: string;
  fetch?: typeof fetch;
}

export interface OllamaEmbeddingProviderOptions {
  endpoint: string;
  model: string;
  dimensions?: number;
  timeoutMs?: number;
  keepAlive?: string;
  fetch?: typeof fetch;
  createClient?: (options: OllamaEmbeddingClientOptions) => OllamaEmbeddingClient;
}

export function createMemoryEmbedding(text: string, dimensions = MEMORY_VECTOR_DIMENSIONS): Float32Array {
  const vector = new Float32Array(dimensions);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % dimensions;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  return normalizeFloat32Vector(vector);
}

export function createLocalEmbeddingProvider(dimensions = MEMORY_VECTOR_DIMENSIONS): EmbeddingProvider {
  return {
    name: "local",
    dimensions,
    async embed(text: string) {
      return createMemoryEmbedding(text, dimensions);
    },
  };
}

export function createOllamaEmbeddingProvider(options: OllamaEmbeddingProviderOptions): EmbeddingProvider {
  const dimensions = options.dimensions ?? MEMORY_VECTOR_DIMENSIONS;
  const endpoint = options.endpoint.replace(/\/+$/u, "");
  const createClient = options.createClient ?? ((clientOptions: OllamaEmbeddingClientOptions) => new Ollama(clientOptions));

  return {
    name: "ollama",
    model: options.model,
    dimensions,
    async embed(text: string, signal?: AbortSignal) {
      const timeout = createTimeoutSignal(options.timeoutMs, signal);
      const client = createClient({
        host: endpoint,
        fetch: createSignalAwareFetch(options.fetch, timeout.signal),
      });

      try {
        const request: EmbedRequest = {
          model: options.model,
          input: text,
          dimensions,
          ...(options.keepAlive ? { keep_alive: options.keepAlive } : {}),
        };
        const payload = await client.embed(request);
        const embedding = extractOllamaEmbedding(payload);
        return normalizeEmbedding(embedding, dimensions);
      } finally {
        client.abort?.();
        timeout.cleanup();
      }
    },
  };
}

export function createEmbeddingProvider(config: MemoryModuleConfig["vector"]): EmbeddingProvider {
  if (config.provider === "ollama") {
    return createOllamaEmbeddingProvider({
      endpoint: config.ollama.endpoint,
      model: config.ollama.model,
      dimensions: config.dimensions,
      timeoutMs: config.ollama.timeoutMs,
      keepAlive: config.ollama.keepAlive,
    });
  }
  return createLocalEmbeddingProvider(config.dimensions);
}

export function normalizeEmbedding(value: readonly number[] | Float32Array, dimensions = MEMORY_VECTOR_DIMENSIONS): Float32Array {
  if (value.length !== dimensions) {
    throw new Error(`Expected ${dimensions}-dimensional embedding, received ${value.length}.`);
  }

  const vector = value instanceof Float32Array ? new Float32Array(value) : Float32Array.from(value);
  for (const item of vector) {
    if (!Number.isFinite(item)) throw new Error("Embedding values must be finite numbers.");
  }
  return normalizeFloat32Vector(vector);
}

export function embeddingToSqliteVector(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength));
}

function extractOllamaEmbedding(payload: { embeddings?: unknown; embedding?: unknown }): readonly number[] {
  if (Array.isArray(payload.embeddings) && Array.isArray(payload.embeddings[0])) {
    return payload.embeddings[0].filter((value): value is number => typeof value === "number");
  }
  if (Array.isArray(payload.embedding)) {
    return payload.embedding.filter((value): value is number => typeof value === "number");
  }
  throw new Error("Ollama embedding response did not include an embedding array.");
}

function createSignalAwareFetch(fetchImpl: typeof fetch | undefined, signal?: AbortSignal): typeof fetch | undefined {
  if (!signal && !fetchImpl) return undefined;
  const baseFetch = fetchImpl ?? fetch;
  return (input, init) => baseFetch(input, { ...init, signal: signal ?? init?.signal });
}

function createTimeoutSignal(timeoutMs: number | undefined, parent?: AbortSignal): { signal?: AbortSignal; cleanup(): void } {
  if (!timeoutMs && !parent) return { signal: undefined, cleanup() {} };

  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  const timer = timeoutMs ? setTimeout(() => controller.abort(new Error("Embedding request timed out.")), timeoutMs) : undefined;

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

function normalizeFloat32Vector(vector: Float32Array): Float32Array {
  let magnitudeSquared = 0;
  for (const value of vector) magnitudeSquared += value * value;
  if (magnitudeSquared === 0) return vector;

  const magnitude = Math.sqrt(magnitudeSquared);
  for (let index = 0; index < vector.length; index++) vector[index] = vector[index] / magnitude;
  return vector;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_+#.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
