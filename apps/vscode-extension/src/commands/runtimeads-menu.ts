import type { AttentionRuntime } from "@runtimeads/runtime";
import { commands, window } from "vscode";

export interface RuntimeAdsMenuItem {
  label: string;
  description: string;
  command: string;
}

export function buildRuntimeAdsMenuItems(runtime: AttentionRuntime): RuntimeAdsMenuItem[] {
  const authenticated = runtime.getStatus().authStatus === "authenticated";
  const items: RuntimeAdsMenuItem[] = [];

  if (authenticated) {
    items.push({
      label: "Sign out",
      description: "Disconnect this editor from your RuntimeAds account",
      command: "runtimeads.logout",
    });
  } else {
    items.push({
      label: "Sign in",
      description: "Connect your RuntimeAds account to start earning",
      command: "runtimeads.login",
    });
  }

  items.push(
    {
      label: "Dashboard",
      description: "Account status and activity",
      command: "runtimeads.openDashboard",
    },
    {
      label: "Help & status",
      description: "Connection details and troubleshooting",
      command: "runtimeads.showDiagnostics",
    },
    {
      label: "Open active ad",
      description: "Open the current sponsor in your browser",
      command: "runtimeads.openActiveAd",
    },
    {
      label: "Dismiss sponsor ad",
      description: "Hide sponsors until you restore them or agents finish waiting",
      command: "runtimeads.dismissAd",
    },
    {
      label: "Restore sponsor ads",
      description: "Show sponsors again on all surfaces",
      command: "runtimeads.restoreAds",
    },
    {
      label: "Set up Claude & Codex",
      description: "Enable sponsor ads and wait-time detection",
      command: "runtimeads.installTerminalHooks",
    },
    {
      label: "Restore Claude & Codex panels",
      description: "Remove RuntimeAds changes from Claude and Codex panel files",
      command: "runtimeads.restoreWebviewPatches",
    },
    {
      label: "Remove RuntimeAds integration",
      description: "Remove RuntimeAds hooks and panel changes from Claude & Codex",
      command: "runtimeads.removeIntegrations",
    },
  );

  return items;
}

export async function showRuntimeAdsMenu(runtime: AttentionRuntime): Promise<void> {
  const choice = await window.showQuickPick(buildRuntimeAdsMenuItems(runtime), {
    title: "RuntimeAds",
    matchOnDescription: true,
  });

  if (choice) {
    await commands.executeCommand(choice.command);
  }
}
