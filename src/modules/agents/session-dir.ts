import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export function deriveSubagentSessionDir(parentSessionFile: string | undefined, cwd: string): string {
  if (parentSessionFile) {
    return join(dirname(parentSessionFile), basename(parentSessionFile, ".jsonl"), "tasks");
  }

  const encoded = cwd.replace(/[/\\]/g, "-").replace(/^[A-Za-z]:-/, "").replace(/^-+/, "") || "unknown-cwd";
  return join(tmpdir(), `pi-ext-subagents-${process.getuid?.() ?? 0}`, encoded, "tasks");
}
