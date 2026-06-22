import assert from "node:assert/strict";
import { suite, test } from "mocha";

import { buildClaudeHookInstallerConfig } from "../../signals/claude-hook-server";

suite("claude hook installer config", () => {
  // Regression: Cursor mirrors Claude's hooks and calls matcher.split("|") for PreToolUse/
  // PostToolUse without a null-guard. A missing matcher crashed its converter and surfaced an
  // "Invalid hooks.json found" panel, so tool-event groups must carry an explicit matcher.
  test("tool events get matcher '*'; non-tool events omit matcher", () => {
    const config = buildClaudeHookInstallerConfig(
      "/ext",
      { url: "http://127.0.0.1:1/v1/hooks/terminal", token: "t" },
      "node",
      "/Users/dev/.runtimeads/hooks/runtimeads-claude-hook.sh",
    );
    const hooks = config.hooks as Record<
      string,
      Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>
    >;

    assert.equal(hooks.PreToolUse![0]!.matcher, "*");
    assert.equal(hooks.PostToolUse![0]!.matcher, "*");

    // Non-tool events must NOT carry a matcher (Cursor only splits tool-event matchers).
    for (const ev of ["SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "Notification"]) {
      assert.equal("matcher" in hooks[ev]![0]!, false, `${ev} should have no matcher`);
    }

    // The Notification async flag is unchanged.
    assert.equal(hooks.Notification![0]!.hooks[0]!.async, true);
  });
});
