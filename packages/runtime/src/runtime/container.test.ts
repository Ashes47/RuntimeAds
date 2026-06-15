import { describe, expect, it } from "vitest";

import { RuntimeContainer } from "./container";
import type { RuntimeService } from "./service";

describe("RuntimeContainer", () => {
  it("starts services in registration order and stops them in reverse order", async () => {
    const events: string[] = [];
    const container = new RuntimeContainer();

    container.register(createService("storage", events));
    container.register(createService("queue", events));
    container.register(createService("sync", events));

    await container.start();
    await container.stop();

    expect(events).toEqual([
      "start:storage",
      "start:queue",
      "start:sync",
      "stop:sync",
      "stop:queue",
      "stop:storage",
    ]);
  });

  it("starts only once", async () => {
    const events: string[] = [];
    const container = new RuntimeContainer();

    container.register(createService("storage", events));

    await container.start();
    await container.start();

    expect(events).toEqual(["start:storage"]);
  });
});

function createService(name: string, events: string[]): RuntimeService {
  return {
    name,
    async start() {
      events.push(`start:${name}`);
    },
    async stop() {
      events.push(`stop:${name}`);
    },
  };
}
