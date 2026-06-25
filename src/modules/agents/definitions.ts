import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentsChildExtensionMode } from "../../core/config";

export type AgentSource = "user";
export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: AgentThinkingLevel;
  maxTurns?: number;
  extensionMode?: AgentsChildExtensionMode;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export interface AgentDiscoveryDiagnostic {
  filePath: string;
  reason: string;
}

export interface AgentDiscoveryResult {
  agents: AgentDefinition[];
  agentsDir: string;
  diagnostics: AgentDiscoveryDiagnostic[];
}

const THINKING_LEVELS = new Set<AgentThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

export function discoverAgentDefinitions(agentDir: string): AgentDiscoveryResult {
  const agentsDir = join(agentDir, "agents");
  const agents = new Map<string, AgentDefinition>();
  const diagnostics: AgentDiscoveryDiagnostic[] = [];

  if (!existsSync(agentsDir)) return { agents: [], agentsDir, diagnostics };

  let entries;
  try {
    entries = readdirSync(agentsDir, { withFileTypes: true });
  } catch (error) {
    diagnostics.push({ filePath: agentsDir, reason: `Cannot read agents directory: ${String(error)}` });
    return { agents: [], agentsDir, diagnostics };
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = join(agentsDir, entry.name);
    try {
      const parsed = parseAgentDefinition(filePath, readFileSync(filePath, "utf8"));
      if (parsed) agents.set(parsed.name, parsed);
      else diagnostics.push({ filePath, reason: "Missing required name or description frontmatter" });
    } catch (error) {
      diagnostics.push({ filePath, reason: String(error) });
    }
  }

  return { agents: [...agents.values()].sort((a, b) => a.name.localeCompare(b.name)), agentsDir, diagnostics };
}

export function parseAgentDefinition(filePath: string, content: string): AgentDefinition | undefined {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  const name = stringField(frontmatter.name);
  const description = stringField(frontmatter.description);
  if (!name || !description) return undefined;

  return {
    name,
    description,
    tools: toolsField(frontmatter.tools),
    model: stringField(frontmatter.model),
    thinking: thinkingField(frontmatter.thinking),
    maxTurns: positiveIntField(frontmatter.max_turns),
    extensionMode: extensionModeField(frontmatter.extensions),
    systemPrompt: body.trim(),
    source: "user",
    filePath,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toolsField(value: unknown): string[] {
  if (value == null) return [...DEFAULT_TOOLS];
  if (Array.isArray(value)) return value.map(String).map((part) => part.trim()).filter(Boolean);
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "none") return [];
  return text.split(",").map((part) => part.trim()).filter(Boolean);
}

function thinkingField(value: unknown): AgentThinkingLevel | undefined {
  const text = stringField(value);
  return text && THINKING_LEVELS.has(text as AgentThinkingLevel) ? (text as AgentThinkingLevel) : undefined;
}

function positiveIntField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function extensionModeField(value: unknown): AgentsChildExtensionMode | undefined {
  return value === "inherit-safe" || value === "none" ? value : undefined;
}
