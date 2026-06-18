# RuntimeAds

**Get paid while your AI agents think.** RuntimeAds shows a single, privacy-safe sponsor ad while
Claude Code or Codex is busy waiting — in the panel spinner, the terminal, or the status bar —
and credits your developer account. No ads in your prompts, your code, or your responses.

Works in **VS Code** and **Cursor**, with **Claude Code** and **Codex**.

## What you get

- **Earn during dead time** — ads appear only while an agent is waiting, never in your prompts or its answers.
- **One tasteful sponsor** — a single line, not a cluttered panel. Hide it anytime.
- **Privacy-first** — RuntimeAds never reads or collects prompts, responses, code, terminal output, file paths, or repository names. See [Privacy](#privacy).
- **No lock-in** — uninstall leaves nothing behind. Most tools that reach into your editor dig in and stay; RuntimeAds is built to do the opposite. Every change is backed up and put back on removal, and nothing lingers after you restart (see [Removing RuntimeAds](#removing-runtimeads)).

## Quick start

1. **Install** RuntimeAds from the Marketplace / Open VSX (or a `.vsix`).
2. **Sign in** — Command Palette → `RuntimeAds: Sign In`, then complete Google sign-in in your browser.
3. **Set up Claude & Codex** — Command Palette → `RuntimeAds: Set Up Claude & Codex`. This connects RuntimeAds to your agents in the current workspace.
4. **Trust Codex hooks** (if prompted) — in Codex, run `/hooks` and trust the RuntimeAds hooks so wait time can be counted. (Shortcut: `RuntimeAds: Trust Codex Hooks`.)
5. **Work normally** — when an agent is waiting, you may see a sponsor ad, and your account earns.

Open **`RuntimeAds: Open Dashboard`** anytime to check your connection and activity. View earnings and
payouts on the [RuntimeAds developer portal](https://runtimeads.com/developer) (same account).

## How it works — what RuntimeAds changes

RuntimeAds is transparent about every file it touches. To show an ad in your agents' native UI, it
makes small, **reversible** changes (each original is backed up alongside it):

| Surface                   | What RuntimeAds does                                                         | Where                                                                    |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Claude Code / Codex panel | Injects a small ad-overlay block into the editor's webview bundle            | the Claude Code / Codex extension files (a `.runtimeads-backup` is kept) |
| Claude / Codex CLI        | Adds a spinner verb + status-line command so the CLI can show an ad          | `~/.claude/settings.json` (global)                                       |
| Codex CLI launcher        | Wraps the global `codex` command so it can print a one-line sponsor at start | your npm `codex` shim (original recorded for restore)                    |
| This workspace            | Adds wait-time hooks so RuntimeAds knows when an agent is waiting            | `.claude/settings.json` and `.codex/hooks.json` in the open repo         |

All of this is undone by the removal commands below — RuntimeAds only ever removes **its own**
entries and restores your original files; it never deletes config you wrote.

## Commands

| Command                                     | What it does                                                  |
| ------------------------------------------- | ------------------------------------------------------------- |
| `RuntimeAds: Sign In`                       | Connect your RuntimeAds account                               |
| `RuntimeAds: Sign Out`                      | Disconnect this editor                                        |
| `RuntimeAds: Open Dashboard`                | Account status and activity inside the editor                 |
| `RuntimeAds: Set Up Claude & Codex`         | Enable sponsor ads and wait-time detection in this workspace  |
| `RuntimeAds: Trust Codex Hooks`             | Open Codex and trust RuntimeAds hooks                         |
| `RuntimeAds: Dismiss Sponsor Ad`            | Hide the current sponsor until agents finish waiting          |
| `RuntimeAds: Restore Sponsor Ads`           | Show sponsors again                                           |
| `RuntimeAds: Open Active Ad`                | Open the current sponsor in your browser                      |
| `RuntimeAds: Help & Status`                 | Connection details and troubleshooting                        |
| `RuntimeAds: Menu`                          | Quick actions from the status bar                             |
| `RuntimeAds: Restore Claude & Codex Panels` | Undo the panel/CLI patches (extension stays installed)        |
| `RuntimeAds: Remove from This Workspace`    | Undo everything for this repo, sign out, and clear local data |

## Settings

| Setting                           | Description                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `runtimeads.render.statusBarAds`  | Show sponsor ads in the status bar while an agent is waiting (on by default). |
| `runtimeads.render.spinnerHoldMs` | How long sponsor text stays visible in the terminal spinner (milliseconds).   |
| `runtimeads.apiBaseUrl`           | RuntimeAds API URL. Leave the default unless you self-host.                   |

## Removing RuntimeAds

**No lock-in.** Remove RuntimeAds and everything it touched is put back exactly as it was: your
Claude/Codex panels restored from backup, the global CLI changes undone, the wait-time hooks
stripped from every workspace, and its one folder (`~/.runtimeads`) deleted. No ad code, no
tracking, and no changes to your other extensions survive removal, and your login never lived
anywhere but your editor's secure storage. Because the client is source-available, you can confirm
this yourself instead of taking our word for it.

Pick the level that matches what you want — from "hide it for now" to "remove it completely."

1. **Just hide the ad** — `RuntimeAds: Dismiss Sponsor Ad` (bring it back with `Restore Sponsor Ads`).
2. **Restore the original panels, keep earning later** — `RuntimeAds: Restore Claude & Codex Panels`.
   Undoes the panel/CLI patches but leaves the extension installed; it re-applies next time an ad shows.
3. **Remove RuntimeAds from one workspace** — `RuntimeAds: Remove from This Workspace`. Restores
   Claude/Codex, removes this repo's wait-time hooks, signs you out, and clears local data.
4. **Uninstall completely** — uninstall **RuntimeAds** from the Extensions panel, then **restart the
   editor**. On restart, RuntimeAds automatically restores the Claude/Codex panels, undoes the global
   CLI changes, strips its wait-time hooks from **every workspace it set up**, and removes
   `~/.runtimeads`.

> ⚠️ **Restart the editor after uninstalling.** VS Code and Cursor defer an extension's removal
> (and its cleanup) until the **next time you launch the app** — closing windows is not enough.
> Until you restart, you may still see the sponsor ad. After a restart, it's gone.

Tip: if you want a guaranteed-clean slate (e.g. before reinstalling), run
`RuntimeAds: Remove from This Workspace` first, then uninstall and restart.

## Privacy

RuntimeAds does **not** read or collect:

- prompts or AI responses
- terminal output
- source code or file contents
- file paths, repository names, or branch names
- environment variables or clipboard contents

It sends only wait-time signals and ad display events needed to credit your account. Full details:
[privacy policy](https://runtimeads.com/privacy).

## Troubleshooting

**Not signed in?** Run `RuntimeAds: Sign In` and complete browser auth.

**No ads appearing?** Run `RuntimeAds: Set Up Claude & Codex`, reload the Claude/Codex panels, and
restart terminal Claude if you use the CLI.

**Codex not counting wait time?** Open Codex, run `/hooks`, and trust all RuntimeAds hooks — or use
`RuntimeAds: Trust Codex Hooks`.

**"Sponsor ads unavailable" warning?** Open `RuntimeAds: Help & Status`. Common fix: install or update
the Claude Code / Codex extensions, then reload the window.

**Still seeing ads after uninstalling?** The editor hasn't finished removing the extension yet —
**fully quit and reopen** VS Code / Cursor (closing windows isn't enough). The cleanup runs on the
next launch. If anything lingers after that, run `RuntimeAds: Remove from This Workspace` before the
final uninstall.

For support, include your **Device ID** (shown in the dashboard) when contacting RuntimeAds.
