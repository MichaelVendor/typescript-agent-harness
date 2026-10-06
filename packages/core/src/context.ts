import { EventBus } from "./event-bus.js";
import type {
  EventHandler,
  EventPayload,
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

  /** Internal: wipe service registry on stop. */
  clearServices(): void {
    this.services.clear();
  }
}
