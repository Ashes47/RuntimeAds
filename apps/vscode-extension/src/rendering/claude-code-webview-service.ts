import type { AttentionRuntime } from "@runtimeads/runtime";
import type { ExtensionContext } from "vscode";
import { env, Uri, window } from "vscode";

import type { ClaudeHookServerHandle } from "../signals/claude-hook-server";
import { buildWebviewPatchParams } from "./build-patch-params";
import { ensurePatchAllocation } from "./resolve-display-allocation";
import { locateClaudeCodeWebviewTarget } from "./claude-code-locator";
import {
  ClaudeCodeWebviewPatcher,
  type ClaudeCodePatchParams,
  type ClaudeCodePatchResult,
} from "./claude-code-patcher";

export class ClaudeCodeWebviewService {
  private lastAllocationId: string | undefined;
  private lastPatchParams: ClaudeCodePatchParams | undefined;

  constructor(
    private readonly context: ExtensionContext,
    private readonly runtime: AttentionRuntime,
    private readonly hookServer: ClaudeHookServerHandle,
  ) {}

  async applyCurrentAd(force = false): Promise<ClaudeCodePatchResult> {
    const target = locateClaudeCodeWebviewTarget();
    if (!target) {
      return {
        ok: false,
        reason:
          "Claude Code extension not found. Install Anthropic's Claude Code extension, then reload.",
      };
    }

    const allocation = await ensurePatchAllocation(this.runtime);
    const loopbackBase = await this.resolveLoopbackBase();
    const params: ClaudeCodePatchParams = await buildWebviewPatchParams(allocation, loopbackBase);

    if (!force && allocation && this.lastAllocationId === allocation.allocationId) {
      const patcher = new ClaudeCodeWebviewPatcher(target, this.blockAssetPath());
      if (patcher.isPatched()) {
        return { ok: true, target, reason: "already current" };
      }
    }

    const patcher = new ClaudeCodeWebviewPatcher(target, this.blockAssetPath());
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

  preflight(): ClaudeCodePatchResult {
    const target = locateClaudeCodeWebviewTarget();
    if (!target) {
      return {
        ok: false,
        reason:
          "Claude Code extension not found. Install Anthropic's Claude Code extension, then reload.",
      };
    }

    return new ClaudeCodeWebviewPatcher(target, this.blockAssetPath()).preflight();
  }

  async refreshPatchedBlock(): Promise<ClaudeCodePatchResult> {
    const target = locateClaudeCodeWebviewTarget();
    if (!target) {
      return { ok: false, reason: "Claude Code extension not found" };
    }

    if (!this.lastPatchParams) {
      return { ok: false, reason: "Claude Code panel has not been patched yet" };
    }

    const loopbackBase = await this.resolveLoopbackBase();
    const patcher = new ClaudeCodeWebviewPatcher(target, this.blockAssetPath());
    return patcher.reapplyPatch({
      ...this.lastPatchParams,
      loopbackBase,
    });
  }

  async restore(): Promise<ClaudeCodePatchResult> {
    const target = locateClaudeCodeWebviewTarget();
    if (!target) {
      return { ok: false, reason: "Claude Code extension not found" };
    }

    const patcher = new ClaudeCodeWebviewPatcher(target, this.blockAssetPath());
    const result = patcher.restore();
    this.lastAllocationId = undefined;

    if (result.ok) {
      window.showInformationMessage(
        "RuntimeAds removed its changes from the Claude Code panel. Reload the Claude Code panel to finish.",
      );
    }

    return result;
  }

  async primeCsp(): Promise<void> {
    const target = locateClaudeCodeWebviewTarget();
    if (!target) {
      return;
    }

    new ClaudeCodeWebviewPatcher(target, this.blockAssetPath()).prime();
  }

  private blockAssetPath(): string {
    return `${this.context.extensionPath}/dist/claude-code-block.asset.js`;
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
