import { afterEach, describe, expect, it, vi } from "vitest";

import type { CachedAllocation } from "@runtimeads/sdk-contracts";

import { CacheStore } from "../cache/cache-store";
import { EventQueue } from "../events/event-queue";
import { InstallManager } from "../install/install-manager";
import { MemoryKeyValueStore } from "../storage/key-value-store";
import { DisplayEventService } from "./display-event-service";
import {
  DisplayLifecycleService,
  DISPLAY_SESSION_TIMEOUT_MS,
  IMPRESSION_VIEW_THRESHOLD_MS,
} from "./display-lifecycle-service";
import { DisplayMetricsService } from "./display-metrics-service";
import { FrequencyGuard } from "./frequency-guard";

function allocation(id: string): CachedAllocation {
  return {
    allocationId: id,
    campaignId: "campaign-1",
    brand: "Brand",
    iconUrl: "https://example.com/icon.png",
    headline: "Headline",
    destinationUrl: "https://example.com",
    cpmCents: 0,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

describe("DisplayLifecycleService", () => {
  it("binds one allocation per waiting session and queues display events", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    let eventCounter = 0;
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      idFactory: () => `event-${++eventCounter}`,
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
    });

    await cache.put({ id: "alloc-1", value: allocation("alloc-1") });

    const selected = await lifecycle.beginWaitingSession("session-1");
    expect(selected?.allocationId).toBe("alloc-1");

    await lifecycle.recordImpression("claude_overlay", "alloc-1", "session-1", {
      visibleMs: IMPRESSION_VIEW_THRESHOLD_MS,
    });

    expect((await cache.getLive("alloc-1"))?.state).toBe("displayed");
    expect(cache.size()).toBe(0);

    const events = await eventQueue.listUploadable();
    const types = events.map((record) => record.event.eventType);
    expect(types).toContain("inventory.displayed");
    expect(types).toContain("render.impression");

    await lifecycle.completeWaitingSession("session-1");
    expect(cache.size()).toBe(0);

    const finalEvents = await eventQueue.listUploadable();
    expect(finalEvents.map((record) => record.event.eventType)).toContain("inventory.dismissed");
  });

  it("records one impression from waiting duration using the same fallback for every client", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const metrics = new DisplayMetricsService(store);
    await metrics.start();
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      displayMetrics: metrics,
      idFactory: () => "event-wait-duration",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
      displayMetrics: metrics,
    });

    await cache.put({ id: "alloc-wait", value: allocation("alloc-wait") });
    await lifecycle.beginWaitingSession("session-wait");

    await lifecycle.completeWaitingSession("session-wait", {
      waitingPeriodMs: 8000,
    });

    expect(metrics.getSnapshot().impressions).toBe(1);
    const events = await eventQueue.listUploadable();
    expect(events.map((record) => record.event.eventType)).toContain("render.impression");
    expect(
      events.find((record) => record.event.eventType === "render.impression")?.event.payload,
    ).toMatchObject({
      surface: "cli_spinner_verb",
    });
  });

  it("replaces a stale display session when a new hook session starts waiting", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const metrics = new DisplayMetricsService(store);
    await metrics.start();
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      displayMetrics: metrics,
      idFactory: () => "event-stale",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
      displayMetrics: metrics,
    });

    await cache.put({ id: "alloc-a", value: allocation("alloc-a") });
    await cache.put({ id: "alloc-b", value: allocation("alloc-b") });
    await lifecycle.beginWaitingSession("session-a");

    await lifecycle.beginWaitingSession("session-b");
    await lifecycle.completeWaitingSession("session-b", { waitingPeriodMs: 8000 });

    expect(metrics.getSnapshot().impressions).toBe(1);
    const events = await eventQueue.listUploadable();
    expect(events.map((record) => record.event.eventType)).toContain("render.impression");
  });

  it("bootstraps a display session when a qualifying hook wait ends without waiting_started", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const metrics = new DisplayMetricsService(store);
    await metrics.start();
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      displayMetrics: metrics,
      idFactory: () => "event-bootstrap",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
      displayMetrics: metrics,
    });

    await cache.put({ id: "alloc-bootstrap", value: allocation("alloc-bootstrap") });

    await lifecycle.completeWaitingSession("session-bootstrap", {
      waitingPeriodMs: 8000,
    });

    expect(metrics.getSnapshot().impressions).toBe(1);
  });

  it("attributes overlay visibility and waiting duration through the same session impression path", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const metrics = new DisplayMetricsService(store);
    await metrics.start();
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      displayMetrics: metrics,
      idFactory: () => "event-unified",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
      displayMetrics: metrics,
    });

    await cache.put({ id: "alloc-unified", value: allocation("alloc-unified") });
    await lifecycle.beginWaitingSession("session-unified");
    await lifecycle.reportSurfaceVisibility(
      "claude_overlay",
      "alloc-unified",
      IMPRESSION_VIEW_THRESHOLD_MS,
      "session-unified",
    );

    expect(metrics.getSnapshot().impressions).toBe(1);
    await lifecycle.completeWaitingSession("session-unified", { waitingPeriodMs: 8000 });
    expect(metrics.getSnapshot().impressions).toBe(1);
  });

  it("keeps the pinned allocation when a surface reports a different allocation id", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      idFactory: () => "event-pin",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
    });

    await cache.put({ id: "alloc-a", value: allocation("alloc-a") });
    await cache.put({ id: "alloc-b", value: allocation("alloc-b") });
    await lifecycle.beginWaitingSession("session-pin");

    expect(lifecycle.getCurrentAllocation()?.allocationId).toBe("alloc-a");

    await lifecycle.reportSurfaceVisibility(
      "vscode_status_bar",
      "alloc-b",
      IMPRESSION_VIEW_THRESHOLD_MS,
      "session-pin",
    );

    expect(lifecycle.getCurrentAllocation()?.allocationId).toBe("alloc-a");
  });

  it("records impressions only after the view threshold", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const metrics = new DisplayMetricsService(store);
    await metrics.start();
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      displayMetrics: metrics,
      idFactory: () => "event-threshold",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
      displayMetrics: metrics,
    });

    await cache.put({ id: "alloc-threshold", value: allocation("alloc-threshold") });
    await lifecycle.beginWaitingSession("session-threshold");

    await lifecycle.recordImpression("codex_overlay", "alloc-threshold", "session-threshold", {
      visibleMs: IMPRESSION_VIEW_THRESHOLD_MS - 1,
    });
    expect(metrics.getSnapshot().impressions).toBe(0);

    await lifecycle.recordImpression("codex_overlay", "alloc-threshold", "session-threshold", {
      visibleMs: IMPRESSION_VIEW_THRESHOLD_MS,
    });
    expect(metrics.getSnapshot().impressions).toBe(1);

    await lifecycle.recordImpression("codex_overlay", "alloc-threshold", "session-threshold", {
      visibleMs: IMPRESSION_VIEW_THRESHOLD_MS + 1000,
    });
    expect(metrics.getSnapshot().impressions).toBe(1);
  });

  it("enqueuees a click without fabricating a local impression", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const metrics = new DisplayMetricsService(store);
    await metrics.start();
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      displayMetrics: metrics,
      idFactory: () => "event-click-only",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
      displayMetrics: metrics,
    });

    await cache.put({ id: "alloc-click", value: allocation("alloc-click") });
    await lifecycle.beginWaitingSession("session-click");
    await lifecycle.recordSurfaceDisplayed("claude_overlay", "alloc-click", "session-click");

    await lifecycle.recordClick("claude_overlay", "alloc-click", "session-click");

    expect(metrics.getSnapshot().impressions).toBe(0);
    expect(metrics.getSnapshot().clicks).toBe(1);

    const queued = await eventQueue.listUploadable();
    expect(queued.some((event) => event.event.eventType === "render.click")).toBe(true);
    expect(queued.some((event) => event.event.eventType === "render.impression")).toBe(false);
  });

  it("times out stuck visible sessions", async () => {
    vi.useFakeTimers();

    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const metrics = new DisplayMetricsService(store);
    await metrics.start();
    const displayEvents = new DisplayEventService({
      eventQueue,
      installManager,
      platform: "vscode",
      sdkVersion: "0.1.0",
      idFactory: () => "event-timeout",
    });
    const lifecycle = new DisplayLifecycleService({
      cacheStore: cache,
      displayEvents,
      frequencyGuard: new FrequencyGuard({ store }),
      displayMetrics: metrics,
      sessionTimeoutMs: DISPLAY_SESSION_TIMEOUT_MS,
    });

    await cache.put({ id: "alloc-timeout", value: allocation("alloc-timeout") });
    await lifecycle.beginWaitingSession("session-timeout");
    await lifecycle.recordImpression("claude_overlay", "alloc-timeout", "session-timeout", {
      visibleMs: IMPRESSION_VIEW_THRESHOLD_MS,
    });

    await vi.advanceTimersByTimeAsync(DISPLAY_SESSION_TIMEOUT_MS + 1);

    const events = await eventQueue.listUploadable();
    expect(events.map((record) => record.event.eventType)).toContain("inventory.dismissed");
    expect(
      events.find((record) => record.event.eventType === "inventory.dismissed")?.event.payload,
    ).toMatchObject({
      reason: "timeout",
    });
    expect(metrics.getSnapshot().lifecycleTimeouts).toBe(1);

    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
