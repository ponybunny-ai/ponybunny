import type { AgentATickInput } from '../app/agents/agent-a/types.js';

export interface AgentATickRunnerDeps {
  tick: (input: AgentATickInput) => Promise<void>;
  now?: () => Date;
  intervalMs: number;
  inputFactory: (now: Date) => AgentATickInput;
  onError?: (error: unknown) => void;
}

export class AgentATickRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private nowFn: () => Date;

  constructor(private deps: AgentATickRunnerDeps) {
    this.nowFn = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.deps.intervalMs);
    void this.runOnce();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.inFlight) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  private async runOnce(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const now = this.nowFn();
      await this.deps.tick(this.deps.inputFactory(now));
    } catch (error) {
      this.deps.onError?.(error);
    } finally {
      this.inFlight = false;
    }
  }
}
