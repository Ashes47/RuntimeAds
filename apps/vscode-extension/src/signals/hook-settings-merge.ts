import { isRuntimeAdsHookWrapper } from "./deploy-hook-relay";

const RUNTIMEADS_HOOK_SCRIPTS = [
  "runtimeads-terminal-hook.mjs",
  "runtimeads-claude-hook.mjs",
  "runtimeads-spinner-hold.mjs",
];

export function mergeHookSettings(
  existing: Record<string, unknown>,
  runtimeadsHooks: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  const existingHooks =
    existing.hooks && typeof existing.hooks === "object"
      ? (existing.hooks as Record<string, unknown>)
      : {};
  const runtimeadsHookMap = runtimeadsHooks.hooks as Record<
    string,
    Array<{ hooks: Array<Record<string, unknown>> }>
  >;

  const nextHooks: Record<string, unknown> = { ...existingHooks };

  for (const [eventName, hookGroups] of Object.entries(runtimeadsHookMap)) {
    const currentGroups = Array.isArray(nextHooks[eventName])
      ? [...(nextHooks[eventName] as unknown[])]
      : [];
    const runtimeadsGroup = hookGroups[0];

    const filtered = currentGroups.filter((group) => !isRuntimeAdsHookGroup(group));

    if (runtimeadsGroup) {
      filtered.push(runtimeadsGroup);
    }

    nextHooks[eventName] = filtered;
  }

  merged.hooks = nextHooks;
  return merged;
}

/**
 * Collapse duplicate RuntimeAds hook groups — left behind when an older build's `.mjs`-only dedup
 * failed to recognize the `.sh` wrapper it installed and kept appending — down to the first group
 * per event. Mutates `settings.hooks` in place and reports whether anything changed. The user's own
 * (non-RuntimeAds) groups are never touched.
 */
export function collapseDuplicateHookGroups(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") {
    return false;
  }

  let changed = false;
  for (const [eventName, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) {
      continue;
    }

    let keptOurs = false;
    const deduped = groups.filter((group) => {
      if (!isRuntimeAdsHookGroup(group)) {
        return true;
      }
      if (keptOurs) {
        changed = true;
        return false;
      }
      keptOurs = true;
      return true;
    });

    if (deduped.length !== groups.length) {
      (hooks as Record<string, unknown>)[eventName] = deduped;
    }
  }

  return changed;
}

function isRuntimeAdsHookGroup(group: unknown): boolean {
  if (!group || typeof group !== "object") {
    return false;
  }

  const hooks = (group as { hooks?: Array<Record<string, unknown>> }).hooks ?? [];
  return hooks.some((hook) => isRuntimeAdsHook(hook));
}

function isRuntimeAdsHook(hook: Record<string, unknown>): boolean {
  const command = typeof hook.command === "string" ? hook.command : "";
  const args = Array.isArray(hook.args) ? hook.args : [];

  // Wrapper-command form — the shape we actually install today:
  // { type: "command", command: "~/.runtimeads/hooks/runtimeads-claude-hook.sh" }.
  // Without this the old `.mjs`-only check never matched our own installed hooks, so each
  // merge appended a fresh group instead of replacing → duplicate hook groups accumulated.
  if (isRuntimeAdsHookWrapper(command)) {
    return true;
  }

  if (RUNTIMEADS_HOOK_SCRIPTS.some((script) => command.includes(script))) {
    return true;
  }

  return args.some(
    (arg) =>
      typeof arg === "string" &&
      (RUNTIMEADS_HOOK_SCRIPTS.some((script) => arg.includes(script)) ||
        arg.includes("runtimeads-")),
  );
}
