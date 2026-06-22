import assert from "node:assert/strict";
import { suite, test } from "mocha";

import { collapseDuplicateHookGroups, mergeHookSettings } from "../../signals/hook-settings-merge";

suite("terminal hook installer", () => {
  test("mergeHookSettings replaces all RuntimeAds groups and removes spinner hold hooks", () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: "node",
                args: ["/ext/dist/runtimeads-spinner-hold.mjs", "1500"],
                statusMessage: "Sponsored by Linear · Issue tracking built for speed",
              },
            ],
          },
          {
            hooks: [
              {
                type: "command",
                command: "node",
                args: ["/ext/dist/runtimeads-terminal-hook.mjs", "codex_cli"],
              },
            ],
          },
          {
            hooks: [
              {
                type: "command",
                command: "node",
                args: ["/other/hook.mjs"],
              },
            ],
          },
        ],
      },
    };

    const runtimeadsHooks = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: "node",
                args: ["/ext/dist/runtimeads-terminal-hook.mjs", "codex_cli"],
              },
            ],
          },
        ],
      },
    };

    const merged = mergeHookSettings(existing, runtimeadsHooks);
    const groups = (merged.hooks as Record<string, unknown>).UserPromptSubmit as Array<{
      hooks: Array<Record<string, unknown>>;
    }>;

    assert.equal(groups.length, 2);
    const firstArg = (group: (typeof groups)[number], index: number): unknown => {
      const args = group.hooks[index]?.args;
      return Array.isArray(args) ? args[0] : undefined;
    };
    assert.equal(firstArg(groups[0]!, 0), "/other/hook.mjs");
    assert.equal(firstArg(groups[1]!, 0), "/ext/dist/runtimeads-terminal-hook.mjs");
    assert.equal(
      groups.some((group) => group.hooks.some((hook) => "statusMessage" in hook)),
      false,
    );
  });

  test("mergeHookSettings collapses duplicate installed .sh wrapper groups to one", () => {
    // The shape we actually install: a single command pointing at the wrapper script (no args).
    // The old detector only matched `.mjs` names, so it never recognized these as ours and kept
    // appending — this is what produced the duplicate hook groups seen in the wild.
    const wrapperGroup = (async?: boolean) => ({
      hooks: [
        {
          type: "command",
          command: "/Users/dev/.runtimeads/hooks/runtimeads-claude-hook.sh",
          ...(async ? { async: true } : {}),
        },
      ],
    });

    const existing = {
      hooks: {
        Notification: [wrapperGroup(true), wrapperGroup(true)],
        Stop: [
          { hooks: [{ type: "command", command: "/user/own-hook.sh" }] },
          wrapperGroup(),
          wrapperGroup(),
        ],
      },
    };

    const runtimeadsHooks = {
      hooks: {
        Notification: [wrapperGroup(true)],
        Stop: [wrapperGroup()],
      },
    };

    const merged = mergeHookSettings(existing, runtimeadsHooks);
    const hooks = merged.hooks as Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;

    // Both duplicate wrapper groups are removed and exactly one RuntimeAds group remains.
    assert.equal(hooks.Notification!.length, 1);
    assert.equal(
      hooks.Notification![0]!.hooks[0]!.command,
      "/Users/dev/.runtimeads/hooks/runtimeads-claude-hook.sh",
    );

    // The user's own non-RuntimeAds hook survives; our two duplicates collapse to one.
    assert.equal(hooks.Stop!.length, 2);
    assert.equal(hooks.Stop![0]!.hooks[0]!.command, "/user/own-hook.sh");
    assert.equal(
      hooks.Stop![1]!.hooks[0]!.command,
      "/Users/dev/.runtimeads/hooks/runtimeads-claude-hook.sh",
    );
  });

  test("collapseDuplicateHookGroups removes extra RuntimeAds groups in place, keeps the first", () => {
    const wrapperGroup = () => ({
      hooks: [{ type: "command", command: "/h/.runtimeads/hooks/runtimeads-claude-hook.sh" }],
    });
    const userGroup = { hooks: [{ type: "command", command: "/user/hook.sh" }] };

    const settings = {
      hooks: {
        // Three duplicate RuntimeAds groups straddling the user's own group.
        PreToolUse: [wrapperGroup(), userGroup, wrapperGroup(), wrapperGroup()],
        // Already clean — must be left exactly as-is.
        Stop: [wrapperGroup()],
      },
    };

    const changed = collapseDuplicateHookGroups(settings);
    assert.equal(changed, true);

    const hooks = settings.hooks as Record<
      string,
      Array<{ hooks: Array<Record<string, unknown>> }>
    >;
    assert.equal(hooks.PreToolUse!.length, 2);
    assert.equal(
      hooks.PreToolUse![0]!.hooks[0]!.command,
      "/h/.runtimeads/hooks/runtimeads-claude-hook.sh",
    );
    assert.equal(hooks.PreToolUse![1]!.hooks[0]!.command, "/user/hook.sh");
    assert.equal(hooks.Stop!.length, 1);

    // Idempotent: a second pass finds nothing to change.
    assert.equal(collapseDuplicateHookGroups(settings), false);
  });
});
