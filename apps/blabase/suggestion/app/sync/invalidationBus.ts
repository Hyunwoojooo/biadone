export type SyncInvalidationTarget =
  | "github"
  | "codex"
  | "notion"
  | "google_calendar"
  | "attention"
  | "timeline";

export type SyncInvalidationReason =
  | "snapshot_revision_changed"
  | "manual_refresh"
  | "disconnect"
  | "connection_changed"
  | "context_changed";

export type SyncInvalidationEvent = {
  sequence: number;
  emittedAt: string;
  reason: SyncInvalidationReason;
  targets: readonly SyncInvalidationTarget[];
  revision: string | null;
};

type InvalidationListener = (event: SyncInvalidationEvent) => void;

export class SyncInvalidationBus {
  private sequence = 0;
  private readonly listeners = new Set<{
    targets: ReadonlySet<SyncInvalidationTarget>;
    listener: InvalidationListener;
  }>();

  subscribe(
    targets: readonly SyncInvalidationTarget[],
    listener: InvalidationListener
  ): () => void {
    const subscription = {
      targets: new Set(targets),
      listener
    };
    this.listeners.add(subscription);
    return () => {
      this.listeners.delete(subscription);
    };
  }

  invalidate(input: {
    reason: SyncInvalidationReason;
    targets: readonly SyncInvalidationTarget[];
    revision?: string | null;
    emittedAt?: string;
  }): SyncInvalidationEvent {
    const event: SyncInvalidationEvent = {
      sequence: ++this.sequence,
      emittedAt: input.emittedAt ?? new Date().toISOString(),
      reason: input.reason,
      targets: Array.from(new Set(input.targets)),
      revision: input.revision ?? null
    };

    for (const subscription of this.listeners) {
      if (
        event.targets.some((target) =>
          subscription.targets.has(target)
        )
      ) {
        subscription.listener(event);
      }
    }

    return event;
  }
}

export const syncInvalidationBus = new SyncInvalidationBus();

export function invalidateSourceConsumers(
  source:
    | "github"
    | "codex"
    | "notion"
    | "google_calendar",
  reason: Exclude<
    SyncInvalidationReason,
    "snapshot_revision_changed"
  >
): SyncInvalidationEvent {
  return syncInvalidationBus.invalidate({
    reason,
    targets: [source, "attention", "timeline"]
  });
}
