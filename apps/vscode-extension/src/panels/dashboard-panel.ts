import type { AttentionRuntime } from "@runtimeads/runtime";
import type { ExtensionContext, WebviewPanel } from "vscode";
import { Uri, ViewColumn, window } from "vscode";

import type { DashboardMessage, DashboardViewState } from "../dashboard/types";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { buildWebviewCsp, createWebviewNonce } from "./webview-security";

export class DashboardPanel {
  private static currentPanel: WebviewPanel | undefined;
  private static refreshTimer: NodeJS.Timeout | undefined;
  private static extensionUri: Uri | undefined;

  static async show(
    context: ExtensionContext,
    runtime: AttentionRuntime,
    onOpened?: () => Promise<void>,
  ): Promise<void> {
    DashboardPanel.extensionUri = context.extensionUri;

    if (!DashboardPanel.currentPanel) {
      const nonce = createWebviewNonce();
      DashboardPanel.currentPanel = window.createWebviewPanel(
        "runtimeadsDashboard",
        "RuntimeAds Dashboard",
        ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(context.extensionUri, "dist", "dashboard"),
            Uri.joinPath(context.extensionUri, "media"),
          ],
        },
      );

      const state = await createDashboardState(
        runtime,
        DashboardPanel.currentPanel.webview,
        context.extensionUri,
      );

      DashboardPanel.currentPanel.webview.html = renderDashboardHtml(
        DashboardPanel.currentPanel.webview,
        context.extensionUri,
        state,
        nonce,
      );

      DashboardPanel.currentPanel.webview.onDidReceiveMessage((message: DashboardMessage) => {
        if (message.type === "openDiagnostics") {
          DiagnosticsPanel.show(context.extensionUri, runtime);
        }
      });

      DashboardPanel.currentPanel.onDidDispose(() => {
        DashboardPanel.currentPanel = undefined;
        DashboardPanel.extensionUri = undefined;
        if (DashboardPanel.refreshTimer) {
          clearInterval(DashboardPanel.refreshTimer);
          DashboardPanel.refreshTimer = undefined;
        }
      });

      DashboardPanel.refreshTimer = setInterval(() => {
        void DashboardPanel.publishState(runtime);
      }, 5_000);
    }

    await onOpened?.();
    DashboardPanel.currentPanel.reveal(ViewColumn.One);
    await DashboardPanel.publishState(runtime);
  }

  private static async publishState(runtime: AttentionRuntime): Promise<void> {
    if (!DashboardPanel.currentPanel || !DashboardPanel.extensionUri) {
      return;
    }

    const message: DashboardMessage = {
      type: "state",
      state: await createDashboardState(
        runtime,
        DashboardPanel.currentPanel.webview,
        DashboardPanel.extensionUri,
      ),
    };
    await DashboardPanel.currentPanel.webview.postMessage(message);
  }
}

async function createDashboardState(
  runtime: AttentionRuntime,
  webview: WebviewPanel["webview"],
  extensionUri: Uri,
): Promise<DashboardViewState> {
  const developerId = await runtime.getCredentialVault().getDeveloperId();
  const logoUri = webview
    .asWebviewUri(Uri.joinPath(extensionUri, "media", "favicon.png"))
    .toString();

  return {
    status: runtime.getStatus(),
    ...(developerId ? { developerId } : {}),
    logoUri,
  };
}

function renderDashboardHtml(
  webview: WebviewPanel["webview"],
  extensionUri: Uri,
  state: DashboardViewState,
  nonce: string,
): string {
  const scriptUri = webview.asWebviewUri(
    Uri.joinPath(extensionUri, "dist", "dashboard", "dashboard.js"),
  );
  const styleUri = webview.asWebviewUri(
    Uri.joinPath(extensionUri, "dist", "dashboard", "dashboard.css"),
  );
  const csp = buildWebviewCsp(webview.cspSource, nonce);
  const serializedState = JSON.stringify(state).replaceAll("<", "\\u003c");

  return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>RuntimeAds Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__RUNTIMEADS_DASHBOARD_STATE__ = ${serializedState};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
