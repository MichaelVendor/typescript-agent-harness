export type EventHandler<TPayload = unknown> = (
  payload: TPayload,
) => void | Promise<void>;

export type Unsubscribe = () => void;

/** Waterfall handler: call `next` to delegate, or return without it to short-circuit. */
export type Interceptor<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  next: (payload: TPayload) => Promise<TResult>,
) => Promise<TResult>;

export interface RuntimeEventMap {
  "runtime.starting": { runtimeId: string };
  "runtime.started": { runtimeId: string };
  "runtime.stopping": { runtimeId: string };
  "runtime.stopped": { runtimeId: string };
  "plugin.setup": { name: string };
  "plugin.dispose": { name: string };
}

export type KnownEventName = keyof RuntimeEventMap;

export type EventPayload<TName extends string> =
  TName extends KnownEventName ? RuntimeEventMap[TName] : unknown;

/**
 * Discriminated runtime events used by emit().
 * Built-in names are typed; custom names accept any payload.
 */
export type RuntimeEvent =
  | {
      [K in KnownEventName]: {
        type: K;
        payload: RuntimeEventMap[K];
      };
    }[KnownEventName]
  | {
      type: string;
      payload?: unknown;
    };
