import type { RuntimeService } from "./service";

export class RuntimeContainer {
  private readonly services: RuntimeService[] = [];
  private started = false;

  register(service: RuntimeService): void {
    if (this.started) {
      throw new Error("Cannot register runtime services after startup");
    }

    if (this.services.some((candidate) => candidate.name === service.name)) {
      throw new Error(`Runtime service already registered: ${service.name}`);
    }

    this.services.push(service);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const startedServices: RuntimeService[] = [];

    try {
      for (const service of this.services) {
        await service.start();
        startedServices.push(service);
      }
      this.started = true;
    } catch (error) {
      await this.stopStartedServices(startedServices);
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.stopStartedServices([...this.services].reverse());
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  private async stopStartedServices(services: RuntimeService[]): Promise<void> {
    const errors: unknown[] = [];

    for (const service of services) {
      try {
        await service.stop?.();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop one or more runtime services");
    }
  }
}
