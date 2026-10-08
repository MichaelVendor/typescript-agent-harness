import type { EventHandler, Interceptor, Unsubscribe } from "./events.js";

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly interceptors = new Map<string, Interceptor[]>();

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

  /** Register a waterfall interceptor. Earlier registrations run outermost. */
  intercept<TPayload = unknown, TResult = unknown>(
    event: string,
    handler: Interceptor<TPayload, TResult>,
  ): Unsubscribe {
    let list = this.interceptors.get(event);
    if (!list) {
      list = [];
      this.interceptors.set(event, list);
    }
    list.push(handler as Interceptor);

    return () => {
      const i = list!.indexOf(handler as Interceptor);
      if (i >= 0) list!.splice(i, 1);
      if (list!.length === 0) this.interceptors.delete(event);
    };
  }

  /** Run `final` wrapped by every interceptor of `event`, in registration order. */
  async waterfall<TPayload, TResult>(
    event: string,
    payload: TPayload,
    final: (payload: TPayload) => Promise<TResult>,
  ): Promise<TResult> {
    const chain = [...(this.interceptors.get(event) ?? [])] as Interceptor<
      TPayload,
      TResult
    >[];
    const dispatch = (i: number, p: TPayload): Promise<TResult> =>
      i < chain.length ? chain[i]!(p, (next) => dispatch(i + 1, next)) : final(p);
    return dispatch(0, payload);
  }

  clear(): void {
    this.handlers.clear();
    this.interceptors.clear();
  }
}
