import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  external: [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "typebox",
    "tiktoken",
    "better-sqlite3",
    "kysely",
    "hono",
    "@hono/node-server",
    "clsx",
    "tailwind-merge",
    "class-variance-authority"
  ]
});
