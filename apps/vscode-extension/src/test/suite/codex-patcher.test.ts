import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suite, test } from "mocha";

import {
  assertValidCodexPatchBoundary,
  buildCodexInjectedSource,
  CodexWebviewPatcher,
  locateCodexShimmerEntry,
} from "../../rendering/codex-patcher";

const CODEX_26_609_SOURCE = `
function g(e){const defaultMessage=\`Thinking\`;return (0,X.jsxs)("span",{children:e})}
function v(e){const defaultMessage=\`Thinking\`;return (0,X.jsxs)("span",{children:(0,X.jsx)(g,{children:e})})}
export{v as n,g as t};
`;

const CODEX_LEGACY_SOURCE = `
function v(e){const defaultMessage=\`Thinking\`;return (0,X.jsxs)("span",{children:e})}
export{v as n};
`;

// A bundle that passes the FULL preflight (shimmer entry + object-property defaultMessage:`Thinking`
// + a jsx call) — used for the apply/restore round-trip. The 26.609 fixture above only satisfies
// locateCodexShimmerEntry, not the defaultMessage anchor preflight requires.
const CODEX_FULL_SOURCE = `
function g(e){return (0,X.jsxs)("span",{defaultMessage:\`Thinking\`,children:e})}
export{g as t};
`;

suite("CodexWebviewPatcher", () => {
  test("preflight fails closed when the webview bundle is missing", () => {
    const patcher = new CodexWebviewPatcher(
      "/tmp/runtimeads-missing-codex-webview.js",
      "/tmp/runtimeads-block.asset.js",
    );

    const result = patcher.preflight();
    assert.equal(result.ok, false);
    assert.ok(result.reason?.includes("not found"));
  });

  test("locateCodexShimmerEntry targets export t on Codex 26.609 builds", () => {
    const entry = locateCodexShimmerEntry(CODEX_26_609_SOURCE);
    assert.ok(entry);
    assert.equal(entry?.name, "g");
    assert.equal(entry?.arg, "e");
  });

  test("locateCodexShimmerEntry falls back to export n on legacy builds", () => {
    const entry = locateCodexShimmerEntry(CODEX_LEGACY_SOURCE);
    assert.ok(entry);
    assert.equal(entry?.name, "v");
    assert.equal(entry?.arg, "e");
  });

  test("buildCodexInjectedSource uses invoke boundary, not legacy })();)||", () => {
    const entry = locateCodexShimmerEntry(CODEX_26_609_SOURCE);
    assert.ok(entry);

    const blockPath = path.join(__dirname, "../../../dist/codex-block.asset.js");
    const block = readFileSync(blockPath, "utf8").trim();
    assert.ok(block.endsWith("})"), "codex block asset must end with })");
    assert.ok(!block.endsWith("})();"), "codex block asset must not self-invoke");

    const injected = buildCodexInjectedSource(CODEX_26_609_SOURCE, entry!, block);
    assert.match(injected, /\}\)\(\)\)\|\|e;/);
    assert.doesNotThrow(() => assertValidCodexPatchBoundary(injected));
    assert.throws(() => assertValidCodexPatchBoundary("e=((function(){})();)||e;"), /legacy/);
  });

  test("preflight fails closed when the sibling extension.js (CSP host) is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-codex-"));
    try {
      const target = path.join(dir, "webview", "assets", "thinking-shimmer-test.js");
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, CODEX_FULL_SOURCE, "utf8");
      // No sibling extension.js — the CSP host can't be located, so we must NOT patch the bundle.

      const result = new CodexWebviewPatcher(target, "/tmp/runtimeads-unused.asset.js").preflight();
      assert.equal(result.ok, false);
      assert.ok(result.reason?.includes("CSP host"), result.reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyPatch → restore round-trip patches bundle + CSP and fully reverts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-codex-"));
    try {
      const target = path.join(dir, "webview", "assets", "thinking-shimmer-test.js");
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, CODEX_FULL_SOURCE, "utf8");
      // Sibling extension.js (CSP host) sits three levels up from the bundle, with a connect-src anchor.
      const sibling = path.join(dir, "extension.js");
      writeFileSync(sibling, "const csp = `connect-src 'self'`;\n", "utf8");

      const blockPath = path.join(__dirname, "../../../dist/codex-block.asset.js");
      const patcher = new CodexWebviewPatcher(target, blockPath);

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

  test("preflight flags an already-patched but anchorless Codex bundle as modified", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtimeads-codex-"));
    try {
      const target = path.join(dir, "thinking-shimmer-test.js");
      // Has our block (so isPatched) but the thinking-shimmer anchors are gone → modified/corrupt.
      writeFileSync(
        target,
        "const x=1;\n/* RUNTIMEADS-START */renderAd();/* RUNTIMEADS-END */\n",
        "utf8",
      );

      const result = new CodexWebviewPatcher(target, "").preflight();
      assert.equal(result.ok, false);
      assert.ok(result.reason?.includes("modified"), result.reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
