import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiExtRuntime } from "./runtime";

export type ModuleId = "dcp";

export interface ModuleApi {
  pi: ExtensionAPI;
  getRuntime(ctx: ExtensionContext): PiExtRuntime;
  isEnabled(ctx: ExtensionContext, moduleId: ModuleId): boolean;
}

export interface PiExtModule {
  id: ModuleId;
  label: string;
  register(api: ModuleApi): void;
}
