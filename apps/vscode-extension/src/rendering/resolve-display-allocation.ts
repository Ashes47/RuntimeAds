import type { CachedAllocation } from "@runtimeads/sdk-contracts";
import type { AttentionRuntime } from "@runtimeads/runtime";

const REFILL_RETRY_MS = 30_000;
let lastRefillAttemptMs = 0;

function findActiveWaitingSession(runtime: AttentionRuntime) {
  return runtime
    .getAgentDetectionService()
    .getSessions()
    .find((session) => session.state === "waiting" && !session.endedAt);
}

export async function resolveDisplayAllocation(
  runtime: AttentionRuntime,
): Promise<CachedAllocation | undefined> {
  if (!isAuthenticated(runtime)) {
    return undefined;
  }
  const waitingSession = findActiveWaitingSession(runtime);

  return runtime
    .getDisplayLifecycleService()
    .resolveAllocationForDisplay(waitingSession?.sessionId);
}

/** Ads are only ever shown to a signed-in developer (whose account they credit). */
function isAuthenticated(runtime: AttentionRuntime): boolean {
  return runtime.getStatus().authStatus === "authenticated";
}

/** Resolve the pinned sponsor allocation for webview/status-bar surfaces. */
export async function ensurePatchAllocation(
  runtime: AttentionRuntime,
): Promise<CachedAllocation | undefined> {
  if (!isAuthenticated(runtime)) {
    return undefined;
  }
  const lifecycle = runtime.getDisplayLifecycleService();
  const pinned = lifecycle.getCurrentAllocation();
  if (pinned) {
    return pinned;
  }

  const waitingSession = findActiveWaitingSession(runtime);
  if (waitingSession?.sessionId) {
    const now = Date.now();
    if (now - lastRefillAttemptMs >= REFILL_RETRY_MS) {
      lastRefillAttemptMs = now;
      try {
        await runtime.refillInventoryIfNeeded();
      } catch {
        // API may be offline; fall back to cached inventory.
      }
    }

    await lifecycle.beginWaitingSession(waitingSession.sessionId);
    return lifecycle.getCurrentAllocation();
  }

  return undefined;
}
