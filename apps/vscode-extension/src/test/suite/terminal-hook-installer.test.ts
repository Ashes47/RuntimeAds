import assert from "node:assert/strict";
import { suite, test } from "mocha";

import { mergeHookSettings } from "../../signals/hook-settings-merge";

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
});
