import type { SubagentRunStatus } from "./records";

export const AGENTS_CHILD_QUEUED = "pi-ext:agents:child:queued";
export const AGENTS_CHILD_SPAWNING = "pi-ext:agents:child:spawning";
export const AGENTS_CHILD_SESSION_CREATED = "pi-ext:agents:child:session-created";
export const AGENTS_CHILD_RUNNING = "pi-ext:agents:child:running";
export const AGENTS_CHILD_PROGRESS = "pi-ext:agents:child:progress";
export const AGENTS_CHILD_STALLED = "pi-ext:agents:child:stalled";
export const AGENTS_CHILD_COMPLETED = "pi-ext:agents:child:completed";
export const AGENTS_CHILD_FAILED = "pi-ext:agents:child:failed";
export const AGENTS_CHILD_ABORTED = "pi-ext:agents:child:aborted";
export const AGENTS_CHILD_DISPOSED = "pi-ext:agents:child:disposed";

export interface AgentsChildEvent {
  taskId: string;
  agentName: string;
  status: SubagentRunStatus;
  sessionId?: string;
  transcriptPath?: string;
  output?: string;
  error?: string;
  idleMs?: number;
}

export type AgentsLifecycleEmit = (channel: string, data: unknown) => void;

export interface AgentsLifecyclePublisher {
  queued(event: AgentsChildEvent): void;
  spawning(event: AgentsChildEvent): void;
  sessionCreated(event: AgentsChildEvent): void;
  running(event: AgentsChildEvent): void;
  progress(event: AgentsChildEvent): void;
  stalled(event: AgentsChildEvent): void;
  completed(event: AgentsChildEvent): void;
  failed(event: AgentsChildEvent): void;
  aborted(event: AgentsChildEvent): void;
  disposed(event: AgentsChildEvent): void;
}

export function createAgentsLifecyclePublisher(emit: AgentsLifecycleEmit): AgentsLifecyclePublisher {
  return {
    queued: (event) => emit(AGENTS_CHILD_QUEUED, event),
    spawning: (event) => emit(AGENTS_CHILD_SPAWNING, event),
    sessionCreated: (event) => emit(AGENTS_CHILD_SESSION_CREATED, event),
    running: (event) => emit(AGENTS_CHILD_RUNNING, event),
    progress: (event) => emit(AGENTS_CHILD_PROGRESS, event),
    stalled: (event) => emit(AGENTS_CHILD_STALLED, event),
    completed: (event) => emit(AGENTS_CHILD_COMPLETED, event),
    failed: (event) => emit(AGENTS_CHILD_FAILED, event),
    aborted: (event) => emit(AGENTS_CHILD_ABORTED, event),
    disposed: (event) => emit(AGENTS_CHILD_DISPOSED, event),
  };
}
