import type { PiExtConfig } from "./config";
import type { ModuleId } from "./modules";

export interface OwnedTool {
  name: string;
  moduleId: ModuleId;
  enabled(config: PiExtConfig): boolean;
}

export const ownedTools: OwnedTool[] = [
  {
    name: "compress",
    moduleId: "dcp",
    enabled: (config) => config.enabled && config.modules.dcp.enabled && config.modules.dcp.tools.compress.enabled,
  },
];

export function reconcileActiveTools(activeTools: string[], config: PiExtConfig): string[] {
  const ownedNames = new Set(ownedTools.map((tool) => tool.name));
  const next = new Set(activeTools.filter((name) => !ownedNames.has(name)));

  for (const tool of ownedTools) {
    if (tool.enabled(config)) next.add(tool.name);
  }

  return [...next];
}
