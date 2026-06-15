import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suite, test } from "mocha";

import { ClaudeCodeWebviewPatcher } from "../../rendering/claude-code-patcher";

suite("ClaudeCodeWebviewPatcher", () => {
  test("preflight fails closed when the webview bundle is missing", () => {
    const patcher = new ClaudeCodeWebviewPatcher(
      "/tmp/runtimeads-missing-claude-webview.js",
      "/tmp/runtimeads-block.asset.js",
    );

    const result = patcher.preflight();
    assert.equal(result.ok, false);
    assert.ok(result.reason?.includes("not found"));
  });

  test("restore strips the injected block even when the backup is missing", () => {
    // Regression: a patched panel with no .runtimeads-backup (e.g. a concurrent re-patch raced a
    // prior restore) must still be recoverable — otherwise the ad stays frozen in the panel
    // with no way to clean it via restore / the uninstall hook.
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-cc-"));
    try {
      const target = path.join(dir, "index.js");
      writeFileSync(
        target,
        "const original=1;\n/* RUNTIMEADS-START */renderAd();/* RUNTIMEADS-END */\n",
        "utf8",
      );
      // No <target>.runtimeads-backup is created.

      const result = new ClaudeCodeWebviewPatcher(target, "").restore({ keepCsp: true });

      assert.equal(result.ok, true);
      const after = readFileSync(target, "utf8");
      assert.ok(!after.includes("RUNTIMEADS-START"), "injected block removed");
      assert.ok(after.includes("const original=1;"), "original source preserved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
