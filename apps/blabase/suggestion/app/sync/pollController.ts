export type PollControllerStatus =
  | "stopped"
  | "idle"
  | "polling"
  | "backoff";

export type PollControllerState = {
  status: PollControllerStatus;
  consecutiveFailures: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  nextRetryAt: number | null;
};

export type PollScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

export type PollControllerOptions<T> = {
  execute: () => Promise<T>;
  onResult: (result: T) => void;
  onError?: (error: unknown) => void;
  onStateChange?: (state: PollControllerState) => void;
  intervalMs: number;
  maxBackoffMs: number;
  scheduler?: PollScheduler;
  initiallyVisible?: boolean;
};

const defaultScheduler: PollScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) =>
    globalThis.clearTimeout(
      timer as ReturnType<typeof globalThis.setTimeout>
    )
};

export class PollController<T> {
  private readonly options: PollControllerOptions<T>;
  private readonly scheduler: PollScheduler;
  private timer: unknown | null = null;
  private running = false;
  private visible: boolean;
  private inFlight = false;
  private runAgain = false;
  private generation = 0;
  private state: PollControllerState = {
    status: "stopped",
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    nextRetryAt: null
  };

  constructor(options: PollControllerOptions<T>) {
    if (options.intervalMs <= 0 || options.maxBackoffMs <= 0) {
      throw new Error("Polling intervals must be positive.");
    }
    this.options = options;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.visible = options.initiallyVisible ?? true;
  }

  getState(): PollControllerState {
    return { ...this.state };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.updateState({
      status: "idle",
      nextRetryAt: null
    });
    if (this.visible) this.schedule(0);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    this.runAgain = false;
    this.clearScheduledTimer();
    this.updateState({
      status: "stopped",
      nextRetryAt: null
    });
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!this.running) return;

    if (!visible) {
      this.clearScheduledTimer();
      this.updateState({
        status: this.inFlight ? "polling" : "idle",
        nextRetryAt: null
      });
      return;
    }

    this.wake();
  }

  wake(): void {
    if (!this.running || !this.visible) return;
    if (this.inFlight) {
      this.runAgain = true;
      return;
    }
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (!this.running || !this.visible) return;
    this.clearScheduledTimer();
    const now = this.scheduler.now();
    this.updateState({
      status: delayMs > 0 ? this.state.status : "idle",
      nextRetryAt: delayMs > 0 ? now + delayMs : null
    });
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (!this.running || !this.visible) return;
    if (this.inFlight) {
      this.runAgain = true;
      return;
    }

    const generation = this.generation;
    const attemptedAt = this.scheduler.now();
    this.inFlight = true;
    this.updateState({
      status: "polling",
      lastAttemptAt: attemptedAt,
      nextRetryAt: null
    });

    try {
      const result = await this.options.execute();
      if (!this.running || generation !== this.generation) return;

      this.options.onResult(result);
      this.updateState({
        status: "idle",
        consecutiveFailures: 0,
        lastSuccessAt: this.scheduler.now(),
        nextRetryAt: null
      });
    } catch (error) {
      if (!this.running || generation !== this.generation) return;

      const consecutiveFailures =
        this.state.consecutiveFailures + 1;
      const delayMs = Math.min(
        this.options.maxBackoffMs,
        this.options.intervalMs *
          2 ** Math.max(0, consecutiveFailures - 1)
      );
      this.options.onError?.(error);
      this.updateState({
        status: "backoff",
        consecutiveFailures,
        lastFailureAt: this.scheduler.now(),
        nextRetryAt: this.visible
          ? this.scheduler.now() + delayMs
          : null
      });
    } finally {
      this.inFlight = false;
      if (generation !== this.generation) {
        if (this.running && this.visible && this.runAgain) {
          this.runAgain = false;
          this.schedule(0);
        }
        return;
      }
      if (!this.running) return;
      if (!this.visible) {
        this.updateState({
          status: "idle",
          nextRetryAt: null
        });
        return;
      }
      if (this.runAgain) {
        this.runAgain = false;
        this.schedule(0);
        return;
      }
      if (this.state.status === "backoff") {
        const retryDelay = Math.max(
          0,
          (this.state.nextRetryAt ?? this.scheduler.now()) -
            this.scheduler.now()
        );
        this.schedule(retryDelay);
      } else {
        this.schedule(this.options.intervalMs);
      }
    }
  }

  private clearScheduledTimer(): void {
    if (this.timer === null) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private updateState(
    update: Partial<PollControllerState>
  ): void {
    this.state = { ...this.state, ...update };
    this.options.onStateChange?.(this.getState());
  }
}
