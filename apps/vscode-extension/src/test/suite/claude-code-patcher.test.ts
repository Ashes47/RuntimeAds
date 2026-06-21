import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suite, test } from "mocha";

import { ClaudeCodeWebviewPatcher } from "../../rendering/claude-code-patcher";

// A minimal Claude Code bundle: a verb array carrying one of the spinner anchors so findVerbArray
// locates it. The block is appended after this.
const CLAUDE_BUNDLE_SOURCE = 'const verbs=["Thinking","Clauding","Working"];\n';

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

  test("preflight fails closed when the sibling extension.js (CSP host) is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-cc-"));
    try {
      const target = path.join(dir, "webview", "index.js");
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, CLAUDE_BUNDLE_SOURCE, "utf8");
      // No sibling extension.js — the CSP host can't be located, so we must NOT patch the bundle.

      const result = new ClaudeCodeWebviewPatcher(
        target,
        "/tmp/runtimeads-unused.asset.js",
      ).preflight();
      assert.equal(result.ok, false);
      assert.ok(result.reason?.includes("CSP host"), result.reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyPatch → restore round-trip patches bundle + CSP and fully reverts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-cc-"));
    try {
      const target = path.join(dir, "webview", "index.js");
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, CLAUDE_BUNDLE_SOURCE, "utf8");
      // Sibling extension.js (CSP host) sits two levels up from the bundle, with the CSP anchor.
      const sibling = path.join(dir, "extension.js");
      writeFileSync(sibling, "const csp = `default-src 'none'; ${nonce}`;\n", "utf8");

      const blockPath = path.join(__dirname, "../../../dist/claude-code-block.asset.js");
      const patcher = new ClaudeCodeWebviewPatcher(target, blockPath);

      const apply = patcher.applyPatch({
        brand: "Acme",
        headline: "Try Acme",
        iconUrl: "https://example.com/i.png",
        clickUrl: "https://example.com/c",
        allocationId: "alloc-1",
        loopbackBase: "http://127.0.0.1:7777",
      });
      assert.equal(apply.ok, true, apply.reason);
      assert.ok(readFileSync(target, "utf8").includes("RUNTIMEADS-START"), "bundle injected");
      assert.ok(existsSync(`${target}.runtimeads-backup`), "bundle backup created");
      assert.ok(
        readFileSync(sibling, "utf8").includes("connect-src http://127.0.0.1:*"),
        "CSP widened",
      );

      const restore = patcher.restore();
      assert.equal(restore.ok, true, restore.reason);
      assert.ok(!readFileSync(target, "utf8").includes("RUNTIMEADS-START"), "bundle reverted");
      assert.ok(!existsSync(`${target}.runtimeads-backup`), "bundle backup removed");
      assert.ok(
        !readFileSync(sibling, "utf8").includes("connect-src http://127.0.0.1:*"),
        "CSP reverted",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preflight flags an already-patched but anchorless bundle as modified (not unsupported)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-cc-"));
    try {
      const target = path.join(dir, "index.js");
      // Has our block (so isPatched) but the spinner verb-array anchor is gone → modified/corrupt.
      writeFileSync(
        target,
        "const x=1;\n/* RUNTIMEADS-START */renderAd();/* RUNTIMEADS-END */\n",
        "utf8",
      );

      const result = new ClaudeCodeWebviewPatcher(target, "").preflight();
      assert.equal(result.ok, false);
      assert.ok(result.reason?.includes("modified"), result.reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preflight reports an unpatched anchorless bundle as an unsupported build", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-cc-"));
    try {
      const target = path.join(dir, "index.js");
      writeFileSync(target, "const x=1;\n", "utf8"); // no block, no anchor

      const result = new ClaudeCodeWebviewPatcher(target, "").preflight();
      assert.equal(result.ok, false);
      assert.ok(result.reason?.includes("Unsupported"), result.reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
