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
