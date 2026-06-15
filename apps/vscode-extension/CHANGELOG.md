# Changelog

All notable user-facing changes to the RuntimeAds VS Code extension.

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
