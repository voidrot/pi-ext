export interface ToolCallSignatureInput {
  id: string;
  toolName: string;
  args: unknown;
  protected?: boolean;
}

export function findDuplicateToolResultIds(
  calls: ToolCallSignatureInput[],
): string[] {
  const groups = new Map<string, string[]>();
  for (const call of calls) {
    if (call.protected) continue;
    const signature = `${call.toolName}::${stableJson(call.args)}`;
    const ids = groups.get(signature) ?? [];
    ids.push(call.id);
    groups.set(signature, ids);
  }
  return Array.from(groups.values()).flatMap((ids) =>
    ids.length > 1 ? ids.slice(0, -1) : [],
  );
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((key) => obj[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}
