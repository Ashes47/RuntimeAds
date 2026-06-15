import assert from "node:assert/strict";
import { suite, test } from "mocha";

import { runUninstall } from "../../uninstall";

suite("vscode:uninstall hook", () => {
  test("runUninstall is best-effort: resolves without throwing when no surfaces exist", async () => {
    // The hook runs at extension-removal time with no extension host. On a machine with no
    // patched Claude/Codex surfaces every restore step must no-op silently rather than throw.
    await assert.doesNotReject(runUninstall());
  });

  test("runUninstall is idempotent (safe to run twice)", async () => {
    await assert.doesNotReject(runUninstall());
    await assert.doesNotReject(runUninstall());
  });
});
