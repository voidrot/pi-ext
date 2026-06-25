import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiExtDatabaseHandles } from "../../core/database/manager";
import {
  completeMemoryVectorJob,
  failMemoryVectorJob,
  listPendingMemoryVectorJobs,
  type MemoryVectorJob,
} from "./repository";
import type { EmbeddingProvider } from "./vector";

export interface MemoryVectorBackgroundWorkerOptions {
  getProvider(ctx: ExtensionContext): EmbeddingProvider;
  getBatchSize(ctx: ExtensionContext): number;
  onError?: (error: unknown, job?: MemoryVectorJob) => void;
}

interface QueueItem {
  ctx: ExtensionContext;
  handles: PiExtDatabaseHandles;
}

export class MemoryVectorBackgroundWorker {
  private readonly queue: QueueItem[] = [];
  private activeDrain: Promise<void> | undefined;

  constructor(private readonly options: MemoryVectorBackgroundWorkerOptions) {}

  enqueue(ctx: ExtensionContext, handles: PiExtDatabaseHandles): void {
    this.queue.push({ ctx, handles });
    if (!this.activeDrain) {
      this.activeDrain = this.drain().finally(() => {
        this.activeDrain = undefined;
      });
    }
  }

  async flush(ctx: ExtensionContext, handles: PiExtDatabaseHandles): Promise<void> {
    await this.activeDrain;
    await this.process(ctx, handles);
  }

  async embedText(ctx: ExtensionContext, text: string, signal?: AbortSignal): Promise<Float32Array> {
    return this.options.getProvider(ctx).embed(text, signal);
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      await this.process(item.ctx, item.handles);
    }
  }

  private async process(ctx: ExtensionContext, handles: PiExtDatabaseHandles): Promise<void> {
    const provider = this.options.getProvider(ctx);
    const jobs = await listPendingMemoryVectorJobs(handles, { limit: this.options.getBatchSize(ctx) });

    for (const job of jobs) {
      try {
        const embedding = await provider.embed(job.text);
        await completeMemoryVectorJob(handles, job, {
          provider: provider.name,
          model: provider.model,
          dimensions: provider.dimensions,
          embedding,
        });
      } catch (error) {
        await failMemoryVectorJob(handles, job, error);
        this.options.onError?.(error, job);
      }
    }
  }
}
