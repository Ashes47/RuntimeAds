import type { AttentionRuntime, DiagnosticsSnapshot } from "@runtimeads/runtime";
import type { ExtensionContext, WebviewPanel } from "vscode";
import { ViewColumn, window } from "vscode";

import {
  formatAuthStatus,
  formatHealthStatus,
  formatNetworkStatus,
  formatSyncStatus,
  formatTechnicalReason,
} from "../user-messages";
import { buildStaticWebviewCsp } from "./webview-security";

export class DiagnosticsPanel {
  private static currentPanel: WebviewPanel | undefined;

  static show(extensionUri: ExtensionContext["extensionUri"], runtime: AttentionRuntime): void {
    const snapshot = runtime.getDiagnosticsService().createSnapshot(runtime.getStatus());

    if (!DiagnosticsPanel.currentPanel) {
      DiagnosticsPanel.currentPanel = window.createWebviewPanel(
        "runtimeadsDiagnostics",
        "RuntimeAds Help & Status",
        ViewColumn.One,
        {
          enableScripts: false,
          localResourceRoots: [extensionUri],
        },
      );

      DiagnosticsPanel.currentPanel.onDidDispose(() => {
        DiagnosticsPanel.currentPanel = undefined;
      });
    }

    DiagnosticsPanel.currentPanel.webview.html = renderDiagnostics(
      snapshot,
      DiagnosticsPanel.currentPanel.webview.cspSource,
    );
    DiagnosticsPanel.currentPanel.reveal(ViewColumn.One);
  }
}

function renderDiagnostics(snapshot: DiagnosticsSnapshot, webviewCspSource: string): string {
  const status = snapshot.status;
  const csp = buildStaticWebviewCsp(webviewCspSource);

  return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
        padding: 24px;
        max-width: 720px;
      }

      p.intro,
      p.hint {
        color: var(--vscode-descriptionForeground);
      }

      h2 {
        margin-top: 28px;
      }

      details {
        margin-top: 28px;
      }

      summary {
        cursor: pointer;
        color: var(--vscode-textLink-foreground);
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 8px 16px;
      }

      dt {
        color: var(--vscode-descriptionForeground);
      }

      code {
        user-select: text;
      }
    </style>
  </head>
  <body>
    <h1>RuntimeAds Help &amp; Status</h1>
    <p class="intro">Connection details and troubleshooting. Share your Device ID with support if you need help.</p>

    <h2>Connection</h2>
    <dl>
      <dt>Sign-in</dt>
      <dd>${escapeHtml(formatAuthStatus(status.authStatus))}</dd>
      <dt>Overall status</dt>
      <dd>${escapeHtml(formatHealthStatus(status.health))}</dd>
      <dt>Sync</dt>
      <dd>${escapeHtml(formatSyncStatus(status.syncStatus))}</dd>
      <dt>Network</dt>
      <dd>${escapeHtml(formatNetworkStatus(status.networkStatus))}</dd>
      <dt>Device ID</dt>
      <dd><code>${escapeHtml(status.installId ?? "pending")}</code></dd>
      <dt>Last synced</dt>
      <dd>${escapeHtml(status.lastSyncAt ?? "never")}</dd>
      <dt>Last issue</dt>
      <dd>${escapeHtml(status.lastError ? formatTechnicalReason(status.lastError) : "none")}</dd>
    </dl>

    ${
      status.display
        ? `<h2>Sponsor ads</h2>
    <dl>
      <dt>Impressions (queued / uploaded / verified / rejected)</dt>
      <dd>${status.display.impressionsQueued ?? status.display.impressions} / ${status.display.impressionsUploaded ?? 0} / ${status.display.impressionsVerified ?? 0} / ${status.display.impressionsRejected ?? 0}</dd>
      <dt>Clicks (queued / uploaded / verified / rejected)</dt>
      <dd>${status.display.clicksQueued ?? status.display.clicks} / ${status.display.clicksUploaded ?? 0} / ${status.display.clicksVerified ?? 0} / ${status.display.clicksRejected ?? 0}</dd>
      <dt>Ads dismissed</dt>
      <dd>${status.display.dismissals}</dd>
      <dt>Currently hidden by you</dt>
      <dd>${status.display.userSuppressed ? "Yes" : "No"}</dd>
      ${
        status.display.lastImpressionSkipReason
          ? `<dt>Last ad skipped</dt><dd>${escapeHtml(formatTechnicalReason(status.display.lastImpressionSkipReason))}</dd>`
          : ""
      }
    </dl>`
        : ""
    }

    ${
      status.signals
        ? `<h2>Wait-time detection</h2>
    <p class="hint">RuntimeAds counts time when Claude or Codex is waiting so your account can earn.</p>
    <dl>
      <dt>Wait sessions detected</dt>
      <dd>${status.signals.signalsGenerated}</dd>
      <dt>Currently waiting</dt>
      <dd>${status.signals.activeSessions}</dd>
      <dt>Agent check-ins</dt>
      <dd>${status.signals.hookObservations}</dd>
    </dl>`
        : ""
    }

    ${
      snapshot.recentErrors.length > 0
        ? `<h2>Recent issues</h2>
    <ul>
      ${snapshot.recentErrors
        .map(
          (error) =>
            `<li><code>${escapeHtml(error.occurredAt)}</code> ${escapeHtml(formatTechnicalReason(error.message))}</li>`,
        )
        .join("")}
    </ul>`
        : ""
    }

    <h2>Privacy</h2>
    <p>Prompts, AI responses, code, terminal output, file paths, and repository names are never collected.</p>

    <details>
      <summary>Advanced details (for support)</summary>
      <dl>
        <dt>Pending uploads</dt>
        <dd>${status.queueSize}</dd>
        <dt>Cached ads</dt>
        <dd>${status.cacheSize}</dd>
        <dt>Started</dt>
        <dd>${escapeHtml(status.startedAt ?? "not started")}</dd>
        <dt>Last ad refresh</dt>
        <dd>${escapeHtml(status.lastRefillAt ?? "never")}</dd>
        <dt>Last heartbeat</dt>
        <dd>${escapeHtml(status.lastHeartbeatAt ?? "never")}</dd>
        <dt>Snapshot generated</dt>
        <dd>${escapeHtml(snapshot.generatedAt)}</dd>
      </dl>
      ${
        status.display
          ? `<h3>Ad pipeline</h3>
      <dl>
        <dt>Session state</dt>
        <dd>${escapeHtml(status.display.sessionState)}</dd>
        <dt>Active display session</dt>
        <dd>${status.display.activeSession}</dd>
        <dt>Displayed in cache</dt>
        <dd>${status.display.cacheDisplayed}</dd>
        <dt>Inventory displays</dt>
        <dd>${status.display.inventoryDisplays}</dd>
        <dt>Visible duration (ms)</dt>
        <dd>${status.display.visibleDurationMs}</dd>
        <dt>Lifecycle timeouts</dt>
        <dd>${status.display.lifecycleTimeouts}</dd>
        <dt>Pending inventory events</dt>
        <dd>${status.display.pendingInventoryEvents}</dd>
        <dt>Pending render events</dt>
        <dd>${status.display.pendingRenderEvents}</dd>
        <dt>Refill successes</dt>
        <dd>${status.display.refillSuccesses}</dd>
        <dt>Refill failures</dt>
        <dd>${status.display.refillFailures}</dd>
        <dt>Empty cache events</dt>
        <dd>${status.display.emptyCacheEvents}</dd>
        <dt>Expired purged</dt>
        <dd>${status.display.expiredPurged}</dd>
        <dt>Setup failures</dt>
        <dd>${status.display.patchFailures}</dd>
        <dt>Display errors</dt>
        <dd>${status.display.renderErrors}</dd>
        ${
          status.display.lastRefillError
            ? `<dt>Last refill error</dt><dd>${escapeHtml(formatTechnicalReason(status.display.lastRefillError))}</dd>`
            : ""
        }
      </dl>`
          : ""
      }
      ${
        status.signals
          ? `<h3>Detection diagnostics</h3>
      <dl>
        <dt>Invalid transitions</dt>
        <dd>${status.signals.invalidTransitions}</dd>
        <dt>Unknown sessions</dt>
        <dd>${status.signals.unknownSessions}</dd>
      </dl>`
          : ""
      }
    </details>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
