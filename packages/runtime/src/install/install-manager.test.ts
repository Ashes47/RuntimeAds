import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import { InstallManager } from "./install-manager";

describe("InstallManager", () => {
  it("creates install identity once and reuses it from persistent storage", async () => {
    const store = new MemoryKeyValueStore();
    const firstManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });

    expect(await firstManager.ensureInstallId()).toBe("install-1");

    const secondManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-2",
    });

    expect(await secondManager.ensureInstallId()).toBe("install-1");
  });

  it("reports when a new install identity is provisioned", async () => {
    const manager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store: new MemoryKeyValueStore(),
      idFactory: () => "install-1",
    });

    expect(manager.consumeNewInstallEvent()).toBe(false);
    await manager.ensureInstallId();
    expect(manager.consumeNewInstallEvent()).toBe(true);
    expect(manager.consumeNewInstallEvent()).toBe(false);
  });

  it("registers the stable install identity with the backend client", async () => {
    const registrations: unknown[] = [];
    const manager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store: new MemoryKeyValueStore(),
      idFactory: () => "install-1",
      registrationClient: {
        async registerInstall(request) {
          registrations.push(request);
        },
      },
    });

    await manager.registerInstall();

    expect(registrations).toEqual([
      {
        installId: "install-1",
        platform: "vscode",
        sdkVersion: "0.1.0",
      },
    ]);
  });
});
