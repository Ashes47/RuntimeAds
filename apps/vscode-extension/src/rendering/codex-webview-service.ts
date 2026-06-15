import type { AttentionRuntime } from "@runtimeads/runtime";
import type { ExtensionContext } from "vscode";
import { env, Uri, window } from "vscode";

import type { ClaudeHookServerHandle } from "../signals/claude-hook-server";
import { buildWebviewPatchParams } from "./build-patch-params";
import { ensurePatchAllocation } from "./resolve-display-allocation";
import { listAllCodexWebviewTargets, locateCodexWebviewTarget } from "./codex-locator";
import { CodexWebviewPatcher, type CodexPatchParams, type CodexPatchResult } from "./codex-patcher";

export class CodexWebviewService {
  private lastAllocationId: string | undefined;
  private lastPatchParams: CodexPatchParams | undefined;

  constructor(
    private readonly context: ExtensionContext,
    private readonly runtime: AttentionRuntime,
    private readonly hookServer: ClaudeHookServerHandle,
  ) {}

  async applyCurrentAd(force = false): Promise<CodexPatchResult> {
    const target = locateCodexWebviewTarget();
    if (!target) {
      return {
        ok: false,
        reason: "Codex extension not found. Install OpenAI's Codex extension, then reload.",
      };
    }

    const allocation = await ensurePatchAllocation(this.runtime);
    const loopbackBase = await this.resolveLoopbackBase();
    const params: CodexPatchParams = await buildWebviewPatchParams(allocation, loopbackBase);

    if (!force && allocation && this.lastAllocationId === allocation.allocationId) {
      const patcher = new CodexWebviewPatcher(target, this.blockAssetPath());
      if (patcher.isPatched()) {
        return { ok: true, target, reason: "already current" };
      }
    }

    const patcher = new CodexWebviewPatcher(target, this.blockAssetPath());
    const result = patcher.isPatched() ? patcher.reapplyPatch(params) : patcher.applyPatch(params);

    if (result.ok) {
      if (allocation) {
        this.lastAllocationId = allocation.allocationId;
      }
      this.lastPatchParams = params;
    } else if (result.reason) {
      this.runtime.getDisplayMetricsService().recordPatchFailure();
    }

    return result;
  }

  preflight(): CodexPatchResult {
    const target = locateCodexWebviewTarget();
    if (!target) {
      return {
        ok: false,
        reason: "Codex extension not found. Install OpenAI's Codex extension, then reload.",
      };
    }

    return new CodexWebviewPatcher(target, this.blockAssetPath()).preflight();
  }

  async refreshPatchedBlock(): Promise<CodexPatchResult> {
    const target = locateCodexWebviewTarget();
    if (!target) {
      return { ok: false, reason: "Codex extension not found" };
    }

    if (!this.lastPatchParams) {
      return { ok: false, reason: "Codex panel has not been patched yet" };
    }

    const loopbackBase = await this.resolveLoopbackBase();
    return new CodexWebviewPatcher(target, this.blockAssetPath()).reapplyPatch({
      ...this.lastPatchParams,
      loopbackBase,
    });
  }

  async restore(): Promise<CodexPatchResult> {
    const targets = listAllCodexWebviewTargets();
    if (targets.length === 0) {
      return { ok: false, reason: "Codex extension not found" };
    }

    const results = targets.map((target) =>
      new CodexWebviewPatcher(target, this.blockAssetPath()).restore(),
    );
    this.lastAllocationId = undefined;
    const restored = results.some((result) => result.ok);

    if (restored) {
      window.showInformationMessage(
        "RuntimeAds removed its changes from the Codex panel. Reload the Codex panel to finish.",
      );
    }

    const result: CodexPatchResult = {
      ok: restored,
      target: targets[targets.length - 1]!,
    };
    if (!restored && results[0]?.reason) {
      result.reason = results[0].reason;
    }
    return result;
  }

  async primeCsp(): Promise<void> {
    const target = locateCodexWebviewTarget();
    if (!target) {
      return;
    }

    new CodexWebviewPatcher(target, this.blockAssetPath()).prime();
  }

  private blockAssetPath(): string {
    return `${this.context.extensionPath}/dist/codex-block.asset.js`;
  }

  private async resolveLoopbackBase(): Promise<string> {
    const local = this.hookServer.webviewBaseUrl;
    try {
      const external = await env.asExternalUri(Uri.parse(local));
      return external.toString(true).replace(/\/$/, "");
    } catch {
      return local.replace(/\/$/, "");
    }
  }
}
