import { EventBus } from "./event-bus.js";
import type {
  EventHandler,
  EventPayload,
  Interceptor,
  Unsubscribe,
} from "./events.js";
import {
  ServiceAlreadyProvidedError,
  ServiceNotFoundError,
  type ServiceKey,
} from "./service.js";

export interface Context {
  readonly runtimeId: string;

  get<T>(key: ServiceKey<T>): T;

  tryGet<T>(key: ServiceKey<T>): T | undefined;

  provide<T>(key: ServiceKey<T>, value: T): void;

  emit<TName extends string>(
    type: TName,
    payload: EventPayload<TName>,
  ): Promise<void>;

  on<TName extends string>(
    type: TName,
    handler: EventHandler<EventPayload<TName>>,
  ): Unsubscribe;

  intercept<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: Interceptor<TPayload, TResult>,
  ): Unsubscribe;

  waterfall<TPayload, TResult>(
    name: string,
    payload: TPayload,
    final: (payload: TPayload) => Promise<TResult>,
  ): Promise<TResult>;
}

export class RuntimeContext implements Context {
  private readonly services = new Map<string, unknown>();

  constructor(
    readonly runtimeId: string,
    private readonly bus: EventBus,
  ) {}

  get<T>(key: ServiceKey<T>): T {
    if (!this.services.has(key.id)) {
      throw new ServiceNotFoundError(key.id);
    }
    return this.services.get(key.id) as T;
  }

  tryGet<T>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key.id) as T | undefined;
  }

  provide<T>(key: ServiceKey<T>, value: T): void {
    if (this.services.has(key.id)) {
      throw new ServiceAlreadyProvidedError(key.id);
    }
    this.services.set(key.id, value);
  }

  async emit<TName extends string>(
    type: TName,
    payload: EventPayload<TName>,
  ): Promise<void> {
    await this.bus.emit(type, payload);
  }

  on<TName extends string>(
    type: TName,
    handler: EventHandler<EventPayload<TName>>,
  ): Unsubscribe {
    return this.bus.on(type, handler);
  }

  intercept<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: Interceptor<TPayload, TResult>,
  ): Unsubscribe {
    return this.bus.intercept(name, handler);
  }

  waterfall<TPayload, TResult>(
    name: string,
    payload: TPayload,
    final: (payload: TPayload) => Promise<TResult>,
  ): Promise<TResult> {
    return this.bus.waterfall(name, payload, final);
  }

  /** Internal: wipe service registry on stop. */
  clearServices(): void {
    this.services.clear();
  }
}
