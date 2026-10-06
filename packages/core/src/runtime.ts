import { RuntimeContext, type Context } from "./context.js";
import { EventBus } from "./event-bus.js";
import type { EventHandler, EventPayload, Unsubscribe } from "./events.js";
import type { Plugin } from "./plugin.js";
import type { ServiceKey } from "./service.js";

export type RuntimeState = "idle" | "starting" | "running" | "stopping" | "stopped";

export interface RuntimeOptions {
  /** Stable id for observability; random uuid if omitted. */
  id?: string;
}

let runtimeSeq = 0;

function nextRuntimeId(): string {
  runtimeSeq += 1;
  return `runtime_${runtimeSeq}_${Date.now().toString(36)}`;
}

/**
 * Agent Runtime — first-class citizen.
 *
 * Plugins mount capabilities into a shared Context.
 * Nothing privileged: LLM, Tools, Session, Storage are all plugins.
 */
export class Runtime {
  readonly id: string;

  private readonly bus = new EventBus();
  private readonly plugins: Plugin[] = [];
  private readonly pluginNames = new Set<string>();
  private ctx: RuntimeContext;
  private state: RuntimeState = "idle";

  constructor(options: RuntimeOptions = {}) {
    this.id = options.id ?? nextRuntimeId();
    this.ctx = new RuntimeContext(this.id, this.bus);
  }

  getState(): RuntimeState {
    return this.state;
  }

  /**
   * Register a plugin. Must be called before start().
   * Duplicate names are rejected.
   */
  use(plugin: Plugin): this {
    if (this.state !== "idle") {
      throw new Error(
        `Cannot register plugin "${plugin.name}" after runtime has started (state=${this.state})`,
      );
    }
    if (this.pluginNames.has(plugin.name)) {
      throw new Error(`Duplicate plugin name: ${plugin.name}`);
    }
    this.pluginNames.add(plugin.name);
    this.plugins.push(plugin);
    return this;
  }

  /** Runtime-level subscribe (same bus as Context). */
  on<TName extends string>(
    type: TName,
    handler: EventHandler<EventPayload<TName>>,
  ): Unsubscribe {
    return this.bus.on(type, handler);
  }

  /** Convenience: resolve a service after start. */
  get<T>(key: ServiceKey<T>): T {
    this.assertRunning();
    return this.ctx.get(key);
  }

  context(): Context {
    return this.ctx;
  }

  async start(): Promise<void> {
    if (this.state === "running") return;
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Cannot start runtime from state=${this.state}`);
    }

    // Fresh context if restarting after stop
    if (this.state === "stopped") {
      this.bus.clear();
      this.ctx = new RuntimeContext(this.id, this.bus);
    }

    this.state = "starting";
    await this.bus.emit("runtime.starting", { runtimeId: this.id });

    try {
      for (const plugin of this.plugins) {
        await plugin.setup(this.ctx);
        await this.bus.emit("plugin.setup", { name: plugin.name });
      }
    } catch (err) {
      this.state = "idle";
      throw err;
    }

    this.state = "running";
    await this.bus.emit("runtime.started", { runtimeId: this.id });
  }

  async stop(): Promise<void> {
    if (this.state === "stopped" || this.state === "idle") return;
    if (this.state !== "running") {
      throw new Error(`Cannot stop runtime from state=${this.state}`);
    }

    this.state = "stopping";
    await this.bus.emit("runtime.stopping", { runtimeId: this.id });

    // Dispose in reverse registration order
    for (const plugin of [...this.plugins].reverse()) {
      if (plugin.dispose) {
        await plugin.dispose();
      }
      await this.bus.emit("plugin.dispose", { name: plugin.name });
    }

    this.ctx.clearServices();
    this.state = "stopped";
    await this.bus.emit("runtime.stopped", { runtimeId: this.id });
    // Clear after stopped so observers can still hear the final event.
    this.bus.clear();
  }

  private assertRunning(): void {
    if (this.state !== "running") {
      throw new Error(`Runtime is not running (state=${this.state})`);
    }
  }
}
