/**
 * Typed service keys. Plugins provide/consume capabilities without importing each other.
 *
 *   const LLM = createServiceKey<LLMService>("llm");
 *   ctx.provide(LLM, impl);
 *   const llm = ctx.get(LLM);
 */
export interface ServiceKey<T> {
  readonly id: string;
  readonly __type?: T;
}

export function createServiceKey<T>(id: string): ServiceKey<T> {
  return { id };
}

export class ServiceNotFoundError extends Error {
  constructor(readonly keyId: string) {
    super(`Service not found: ${keyId}`);
    this.name = "ServiceNotFoundError";
  }
}

export class ServiceAlreadyProvidedError extends Error {
  constructor(readonly keyId: string) {
    super(`Service already provided: ${keyId}`);
    this.name = "ServiceAlreadyProvidedError";
  }
}
