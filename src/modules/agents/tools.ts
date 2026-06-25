import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentsModuleConfig } from "../../core/config";
import type { AgentDefinition, AgentDiscoveryResult } from "./definitions";
import type { SubagentRunManager } from "./run-manager";
import type { SubagentRunRecord } from "./records";

const TaskSchema = Type.Object({
  agent: Type.String({ description: "Subagent name" }),
  prompt: Type.String({ description: "Task prompt" }),
});

const RunSubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Agent name for single mode" })),
  prompt: Type.Optional(Type.String({ description: "Task prompt for single mode" })),
  tasks: Type.Optional(Type.Array(TaskSchema, { description: "Independent tasks to run in parallel" })),
  chain: Type.Optional(Type.Array(TaskSchema, { description: "Sequential tasks; prompts may include {previous}" })),
  background: Type.Optional(Type.Boolean({ description: "Start tasks and notify the parent later instead of waiting" })),
});

const GetResultParams = Type.Object({
  taskId: Type.String({ description: "Subagent task id returned by run_subagent" }),
});

const SteerParams = Type.Object({
  taskId: Type.String({ description: "Live subagent task id" }),
  message: Type.String({ description: "Steering message to send to the subagent" }),
});

export interface AgentToolsDeps {
  isEnabled(ctx: ExtensionContext): boolean;
  discover(): AgentDiscoveryResult;
  manager: SubagentRunManager;
  getConfig(ctx: ExtensionContext): Pick<AgentsModuleConfig, "maxParallel" | "defaultBackground"> | { maxParallel: number; defaultBackground?: boolean };
}

export function registerAgentTools(pi: Pick<ExtensionAPI, "registerTool">, deps: AgentToolsDeps): void {
  pi.registerTool({
    name: "run_subagent",
    label: "run subagent",
    description: "Delegate work to specialized in-process Pi subagents discovered from ~/.pi/agent/agents.",
    promptSnippet: "run_subagent: Delegate isolated tasks to specialized in-process agents discovered from ~/.pi/agent/agents.",
    promptGuidelines: [
      "Use run_subagent when work can be split into independent investigation, planning, review, or implementation subtasks.",
      "Keep the main session as orchestrator: delegate narrow tasks, then synthesize subagent results for the user.",
      "Use background mode for long-running tasks; completion, failure, abort, and stall notifications will return as follow-up messages.",
    ],
    parameters: RunSubagentParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!deps.isEnabled(ctx)) return textResult("The agents module is disabled.");
      const config = deps.getConfig(ctx);
      const discovery = deps.discover();
      const mode = getRunMode(params);
      if (typeof mode === "string") return textResult(mode);

      const tasks = mode.tasks;
      const unknown = tasks.map((task) => task.agent).filter((name) => !findAgent(discovery.agents, name));
      if (unknown.length > 0) return textResult(`Unknown agent(s): ${unknown.join(", ")}\n\n${formatCatalog(discovery)}`);
      if (mode.kind === "parallel" && tasks.length > config.maxParallel) {
        return textResult(`Too many parallel subagent tasks: ${tasks.length}. maxParallel is ${config.maxParallel}.`);
      }

      const background = params.background ?? config.defaultBackground ?? false;
      if (background) {
        const records = await Promise.all(tasks.map((task) => deps.manager.startBackground(buildRequest(task, ctx, true, signal))));
        return textResult(`Subagent task(s) started in background:\n${records.map(formatRecordLine).join("\n")}\n\nUse get_subagent_result with a task id for full output. Completion/stall/failure will also notify this session.`);
      }

      if (mode.kind === "chain") {
        const results: SubagentRunRecord[] = [];
        let previous = "";
        for (const task of tasks) {
          const result = await deps.manager.runForeground(buildRequest({ ...task, prompt: task.prompt.replaceAll("{previous}", previous) }, ctx, false, signal));
          results.push(result);
          if (result.status !== "completed") break;
          previous = result.output ?? "";
        }
        return textResult(formatResults(results));
      }

      const results = await Promise.all(tasks.map((task) => deps.manager.runForeground(buildRequest(task, ctx, false, signal))));
      return textResult(formatResults(results));
    },
  });

  pi.registerTool({
    name: "get_subagent_result",
    label: "get subagent result",
    description: "Retrieve full output and transcript metadata for a subagent task by id.",
    promptSnippet: "get_subagent_result: Retrieve full output for a background subagent task by id.",
    parameters: GetResultParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!deps.isEnabled(ctx)) return textResult("The agents module is disabled.");
      const record = deps.manager.get(params.taskId);
      if (!record) return textResult(`Unknown subagent task: ${params.taskId}`);
      return textResult(formatResults([record], false));
    },
  });

  pi.registerTool({
    name: "steer_subagent",
    label: "steer subagent",
    description: "Send a steering message to a live background subagent.",
    promptSnippet: "steer_subagent: Nudge or redirect a live background subagent task.",
    parameters: SteerParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!deps.isEnabled(ctx)) return textResult("The agents module is disabled.");
      try {
        await deps.manager.steer(params.taskId, params.message);
        return textResult(`Steered subagent task ${params.taskId}.`);
      } catch (error) {
        return textResult(String(error));
      }
    },
  });
}

interface ToolTask {
  agent: string;
  prompt: string;
}

type RunMode = { kind: "single" | "parallel" | "chain"; tasks: ToolTask[] };

function getRunMode(params: { agent?: string; prompt?: string; tasks?: ToolTask[]; chain?: ToolTask[] }): RunMode | string {
  const hasSingle = Boolean(params.agent && params.prompt);
  const hasTasks = Boolean(params.tasks?.length);
  const hasChain = Boolean(params.chain?.length);
  const count = [hasSingle, hasTasks, hasChain].filter(Boolean).length;
  if (count !== 1) return "Provide exactly one run_subagent mode: agent+prompt, tasks, or chain.";
  if (hasSingle) return { kind: "single", tasks: [{ agent: params.agent!, prompt: params.prompt! }] };
  if (hasChain) return { kind: "chain", tasks: params.chain! };
  return { kind: "parallel", tasks: params.tasks! };
}

function buildRequest(task: ToolTask, ctx: ExtensionContext, background: boolean, signal?: AbortSignal) {
  return {
    agent: task.agent,
    prompt: task.prompt,
    cwd: ctx.cwd,
    background,
    parentModel: ctx.model,
    modelRegistry: ctx.modelRegistry,
    parentSessionFile: ctx.sessionManager.getSessionFile?.(),
    parentSessionId: ctx.sessionManager.getSessionId?.(),
    signal,
  };
}

function findAgent(agents: AgentDefinition[], name: string): AgentDefinition | undefined {
  return agents.find((agent) => agent.name === name);
}

function formatCatalog(discovery: AgentDiscoveryResult): string {
  const lines = discovery.agents.map((agent) => `- ${agent.name}: ${agent.description}`);
  return `Available agents from ${discovery.agentsDir}:\n${lines.length ? lines.join("\n") : "(none found)"}`;
}

function formatResults(records: SubagentRunRecord[], compact = true): string {
  return records.map((record) => {
    const body = compact ? firstLines(record.output ?? record.error ?? "", 16) : (record.output ?? record.error ?? "");
    const transcript = record.transcriptPath ? `\nTranscript: ${record.transcriptPath}` : "";
    return `## ${record.agent} (${record.status}, ${record.turnCount} turns, task ${record.id})${transcript}\n${body || "No output."}`;
  }).join("\n\n");
}

function formatRecordLine(record: SubagentRunRecord): string {
  return `- ${record.id}: ${record.agent} (${record.status})${record.transcriptPath ? ` transcript: ${record.transcriptPath}` : ""}`;
}

function firstLines(text: string, count: number): string {
  const lines = text.split("\n");
  return lines.length > count ? `${lines.slice(0, count).join("\n")}\n...(truncated)` : text;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}
