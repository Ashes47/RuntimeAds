import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
});
