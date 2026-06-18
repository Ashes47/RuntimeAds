import { describe, expect, it, vi } from "vitest";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import {
  VersionCheckService,
  type ExtensionRequirements,
  type UpdateAvailableInfo,
} from "./version-check-service";

function requirements(overrides: Partial<ExtensionRequirements> = {}): ExtensionRequirements {
  return {
    gateEnabled: true,
    publisher: "runtimeads",
    extensionId: "runtimeads.runtimeads",
    latestVersion: "0.1.0",
    minSupportedVersion: "0.1.0",
    ...overrides,
  };
}

describe("VersionCheckService", () => {
  it("prompts when a newer build is advertised", async () => {
    const updates: UpdateAvailableInfo[] = [];
    const service = new VersionCheckService({
      currentVersion: "0.1.0",
      client: {
        async getExtensionRequirements() {
          return requirements({ latestVersion: "0.2.0" });
        },
      },
      onUpdateAvailable: (info) => updates.push(info),
    });

    await service.check();

    expect(updates).toEqual([{ latestVersion: "0.2.0", required: false }]);
  });

  it("stays silent when the build is current", async () => {
    const updates: UpdateAvailableInfo[] = [];
    const service = new VersionCheckService({
      currentVersion: "0.2.0",
      client: {
        async getExtensionRequirements() {
          return requirements({ latestVersion: "0.2.0", minSupportedVersion: "0.1.0" });
        },
      },
      onUpdateAvailable: (info) => updates.push(info),
    });

    await service.check();

    expect(updates).toEqual([]);
  });

  it("flags required when below the minimum supported version", async () => {
    const updates: UpdateAvailableInfo[] = [];
    const service = new VersionCheckService({
      currentVersion: "0.1.0",
      client: {
        async getExtensionRequirements() {
          return requirements({ latestVersion: "0.3.0", minSupportedVersion: "0.2.0" });
        },
      },
      onUpdateAvailable: (info) => updates.push(info),
    });

    await service.check();

    expect(updates).toEqual([{ latestVersion: "0.3.0", required: true }]);
  });

  it("nags at most once per cooldown window for the same version", async () => {
    const updates: UpdateAvailableInfo[] = [];
    let clock = 1_000_000;
    const service = new VersionCheckService({
      currentVersion: "0.1.0",
      client: {
        async getExtensionRequirements() {
          return requirements({ latestVersion: "0.2.0" });
        },
      },
      promptCooldownMs: 60 * 60_000, // 1 hour
      now: () => clock,
      onUpdateAvailable: (info) => updates.push(info),
    });

    await service.check(); // prompts
    clock += 30 * 60_000; // +30 min — still within cooldown
    await service.check(); // suppressed
    expect(updates).toHaveLength(1);

    clock += 31 * 60_000; // now >1h since the prompt
    await service.check(); // nags again
    expect(updates).toHaveLength(2);
  });

  it("prompts immediately for a newer version even within the cooldown", async () => {
    const updates: UpdateAvailableInfo[] = [];
    let latest = "0.2.0";
    let clock = 1_000_000;
    const service = new VersionCheckService({
      currentVersion: "0.1.0",
      client: {
        async getExtensionRequirements() {
          return requirements({ latestVersion: latest });
        },
      },
      now: () => clock,
      onUpdateAvailable: (info) => updates.push(info),
    });

    await service.check(); // prompts for 0.2.0
    clock += 5 * 60_000; // only 5 min later
    latest = "0.3.0"; // but a newer release shipped
    await service.check(); // prompts again despite cooldown

    expect(updates.map((u) => u.latestVersion)).toEqual(["0.2.0", "0.3.0"]);
  });

  it("persists the cooldown across instances via the store", async () => {
    const store = new MemoryKeyValueStore();
    const clock = 1_000_000;
    const makeService = (updates: UpdateAvailableInfo[]) =>
      new VersionCheckService({
        currentVersion: "0.1.0",
        client: {
          async getExtensionRequirements() {
            return requirements({ latestVersion: "0.2.0" });
          },
        },
        store,
        now: () => clock,
        onUpdateAvailable: (info) => updates.push(info),
      });

    const first: UpdateAvailableInfo[] = [];
    await makeService(first).check();
    expect(first).toHaveLength(1);

    // A fresh instance (simulating a window reload) reads the persisted timestamp and stays
    // quiet until the cooldown elapses.
    const second: UpdateAvailableInfo[] = [];
    await makeService(second).check();
    expect(second).toHaveLength(0);
  });

  it("swallows poll failures and records the error", async () => {
    const service = new VersionCheckService({
      currentVersion: "0.1.0",
      client: {
        async getExtensionRequirements() {
          throw new Error("network down");
        },
      },
      onUpdateAvailable: () => {
        throw new Error("should not be called");
      },
    });

    await expect(service.check()).resolves.toBeUndefined();
    expect(service.getLastError()).toBe("network down");
  });

  it("polls on its scheduled interval and clears on stop", async () => {
    const handles: unknown[] = [];
    const cleared: unknown[] = [];
    const check = vi.fn(async () => requirements());
    const service = new VersionCheckService({
      currentVersion: "0.1.0",
      client: { getExtensionRequirements: check },
      intervalMs: 60_000,
      scheduler: {
        setInterval: (handler, timeoutMs) => {
          handles.push(timeoutMs);
          void handler();
          return "handle";
        },
        clearInterval: (handle) => cleared.push(handle),
      },
    });

    await service.start();
    await service.stop();

    expect(handles).toEqual([60_000]);
    expect(cleared).toEqual(["handle"]);
    // Once on start(), once from the scheduled tick.
    expect(check).toHaveBeenCalledTimes(2);
  });
});
