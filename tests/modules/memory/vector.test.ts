import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMORY_VECTOR_DIMENSIONS,
  createMemoryEmbedding,
  createOllamaEmbeddingProvider,
  embeddingToSqliteVector,
  normalizeEmbedding,
} from "../../../src/modules/memory/vector";

test("creates deterministic normalized memory embeddings", () => {
  const first = createMemoryEmbedding("Use pnpm for package management.");
  const second = createMemoryEmbedding("Use pnpm for package management.");

  assert.equal(first.length, MEMORY_VECTOR_DIMENSIONS);
  assert.deepEqual(Array.from(first), Array.from(second));

  const magnitude = Math.sqrt(Array.from(first).reduce((sum, value) => sum + value * value, 0));
  assert(Math.abs(magnitude - 1) < 0.0001);
});

test("normalizes explicit embeddings and serializes them for sqlite-vec", () => {
  const embedding = normalizeEmbedding([3, 4], 2);
  const serialized = embeddingToSqliteVector(embedding);

  assert(Math.abs(embedding[0] - 0.6) < 0.0001);
  assert(Math.abs(embedding[1] - 0.8) < 0.0001);
  assert(serialized instanceof Buffer);
  assert.equal(serialized.byteLength, 2 * Float32Array.BYTES_PER_ELEMENT);
});

test("rejects explicit embeddings with the wrong dimension", () => {
  assert.throws(() => normalizeEmbedding([1, 2, 3], 2), /Expected 2-dimensional embedding/);
});

test("creates embeddings through the Ollama JS client", async () => {
  let host: string | undefined;
  let request: unknown;
  const provider = createOllamaEmbeddingProvider({
    endpoint: "http://ollama.example/",
    model: "nomic-embed-text",
    dimensions: 3,
    createClient: (options) => {
      host = options.host;
      return {
        async embed(input) {
          request = input;
          return {
            embeddings: [[3, 4, 0]],
            model: "nomic-embed-text",
            total_duration: 1,
            load_duration: 1,
            prompt_eval_count: 1,
          };
        },
        abort() {},
      };
    },
  });

  const embedding = await provider.embed("hello world");

  assert.equal(host, "http://ollama.example");
  assert.deepEqual(request, { model: "nomic-embed-text", input: "hello world", dimensions: 3 });
  assert(Math.abs(embedding[0] - 0.6) < 0.0001);
  assert(Math.abs(embedding[1] - 0.8) < 0.0001);
  assert.equal(embedding[2], 0);
});
