# Changelog

All notable user-facing changes to the RuntimeAds VS Code extension.

## 0.1.4

- Documentation & in-app help refresh — the README, this changelog, and the dashboard hint now
  reflect automatic setup and the renamed commands (`Reset Claude & Codex Panels`,
  `Remove RuntimeAds & Sign Out`). No functional changes.

## 0.1.3

- **Setup is now automatic** — RuntimeAds connects to Claude Code & Codex on first launch; no setup
  prompt or manual step. Re-run anytime with `RuntimeAds: Set Up Claude & Codex`.
- **Codex CLI sponsor banner** now installs reliably on standard `codex` installs (it could
  previously fail to wrap the CLI, so the terminal banner never appeared).
- **Clearer commands:** `Restore Claude & Codex Panels` → **`Reset Claude & Codex Panels`** (undo
  patches, stay installed and signed in); `Remove from This Workspace` →
  **`Remove RuntimeAds & Sign Out`** (undo everything, sign out, clear local data).
- **Safer patching & restore:** panel patches are written atomically and verified, so an interrupted
  update can't leave a half-patched panel; a bundle modified by another tool now shows a clear
  "reinstall Claude/Codex" message instead of failing quietly. Uninstall restores **every** Claude
  install, not just one.
- **Cleaner reinstall:** a leftover sign-in from a previous install is cleared automatically when you
  reinstall after uninstalling.

## 0.1.0

- Initial release: sign in, earn while Claude Code or Codex waits, privacy-safe sponsor ads.
- Works in **VS Code and Cursor**.
- Dashboard and Help & Status panels for connection and activity.
- Set up Claude & Codex from the command palette or first-run prompt.
- Dismiss and restore sponsor ads; optional status-bar ads setting.
- **Clean removal:** uninstalling restores the Claude/Codex panels, undoes global CLI changes,
  strips wait-time hooks from every workspace it set up, and removes local data — automatically
  on the next editor launch. (Tip: restart the editor after uninstalling so the cleanup runs.)
- Menu commands clarified: **Restore Claude & Codex Panels** (undo patches, stay installed) and
  **Remove from This Workspace** (undo everything for a repo, sign out, clear local data).
