import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suite, test } from "mocha";

import { listAllClaudeCodeWebviewTargets } from "../../rendering/claude-code-locator";

const OVERRIDE_KEY = "RUNTIMEADS_CLAUDE_CODE_WEBVIEW_TARGET";

function withOverride(value: string | undefined, run: () => void): void {
  const prev = process.env[OVERRIDE_KEY];
  try {
    if (value === undefined) {
      delete process.env[OVERRIDE_KEY];
    } else {
      process.env[OVERRIDE_KEY] = value;
    }
    run();
  } finally {
    if (prev === undefined) {
      delete process.env[OVERRIDE_KEY];
    } else {
      process.env[OVERRIDE_KEY] = prev;
    }
  }
}

suite("listAllClaudeCodeWebviewTargets", () => {
  test("honours the explicit override when the target exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-cc-loc-"));
    try {
      const target = path.join(dir, "index.js");
      writeFileSync(target, "x", "utf8");
      withOverride(target, () => {
        assert.deepEqual(listAllClaudeCodeWebviewTargets(), [target]);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns empty when the override points at a missing file", () => {
    withOverride("/tmp/runtimeads-does-not-exist-cc.js", () => {
      assert.deepEqual(listAllClaudeCodeWebviewTargets(), []);
    });
  });
});
