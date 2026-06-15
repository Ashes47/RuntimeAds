import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { suite, test } from "mocha";

import { removeTerminalHooks } from "../../signals/remove-terminal-hooks";

suite("removeTerminalHooks", () => {
  test("strips only RuntimeAds hook entries and preserves the user's own config + file", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "runtimeads-ws-"));
    try {
      const claudeDir = path.join(root, ".claude");
      mkdirSync(claudeDir, { recursive: true });
      const settingsPath = path.join(claudeDir, "settings.json");

      // A settings file the user owns: a real user hook + RuntimeAds's relay hook side by side.
      const original = {
        model: "opus",
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "echo user-hook" }] },
            {
              hooks: [
                { type: "command", command: "node x", args: ["runtimeads-terminal-hook.mjs"] },
              ],
            },
          ],
        },
      };
      writeFileSync(settingsPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

      await removeTerminalHooks(root);

      // File must survive (we never delete a user-owned file).
      assert.ok(existsSync(settingsPath), "settings.json should still exist");
      const after = JSON.parse(readFileSync(settingsPath, "utf8")) as typeof original;
      assert.equal(after.model, "opus", "user keys preserved");
      const stopGroups = after.hooks.Stop;
      assert.equal(stopGroups.length, 1, "only the RuntimeAds hook group is removed");
      assert.equal(stopGroups[0]?.hooks[0]?.command, "echo user-hook", "user hook preserved");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is a no-op on a workspace with no RuntimeAds hooks", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "runtimeads-ws-"));
    try {
      const result = await removeTerminalHooks(root);
      // Nothing to rewrite, and we never create agent settings files that weren't there.
      assert.deepEqual(result.rewrittenSettings, []);
      assert.ok(!existsSync(path.join(root, ".claude", "settings.json")));
      assert.ok(!existsSync(path.join(root, ".codex", "hooks.json")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
