import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suite, test } from "mocha";

import { atomicWriteFileSync } from "../../signals/atomic-write";

suite("atomic-write", () => {
  test("writes new content, replaces existing, and leaves no temp files behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtimeads-atomic-"));
    try {
      const target = join(dir, "settings.json");

      atomicWriteFileSync(target, '{"a":1}\n');
      assert.equal(readFileSync(target, "utf8"), '{"a":1}\n');

      atomicWriteFileSync(target, '{"a":2}\n');
      assert.equal(readFileSync(target, "utf8"), '{"a":2}\n');

      // The rename must clean up after itself — only the target remains in the directory.
      assert.deepEqual(readdirSync(dir), ["settings.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a reader never observes a partial file (target is always whole)", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtimeads-atomic-"));
    try {
      const target = join(dir, "settings.json");
      writeFileSync(target, '{"old":true}\n', "utf8");

      const big = `${JSON.stringify({ big: "x".repeat(100_000) })}\n`;
      atomicWriteFileSync(target, big);

      // Either old or new — never a truncated mix; here it is fully the new bytes.
      const seen = readFileSync(target, "utf8");
      assert.equal(seen, big);
      assert.equal(existsSync(target), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
