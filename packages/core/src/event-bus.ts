import type { EventHandler, Unsubscribe } from "./events.js";

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  on<TPayload = unknown>(
    event: string,
    handler: EventHandler<TPayload>,
  ): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);

    return () => {
      set!.delete(handler as EventHandler);
      if (set!.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  /**
   * Emit an event and await all handlers sequentially.
   * Sequential await keeps plugin side-effects predictable in Phase 1.
   */
  async emit(event: string, payload?: unknown): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    for (const handler of [...set]) {
      await handler(payload);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
