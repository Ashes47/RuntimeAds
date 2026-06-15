# RuntimeAds — extension (public mirror)

This is a **read-only mirror** of the [RuntimeAds](https://runtimeads.com) VS Code / Cursor
extension — the exact client code that runs on your machine. It shows a single, privacy-safe
sponsor ad while Claude Code or Codex is waiting, and **never reads your prompts, code, or
terminal output**.

The backend (API, advertiser portal, auction/accounting engine) lives in a separate private repo.

## What's here

- `apps/vscode-extension/` — the extension
- `packages/runtime/`, `packages/sdk-contracts/` — libraries bundled into the published VSIX

## Build / verify it matches the published extension

```bash
pnpm install
pnpm build:vsix   # produces apps/vscode-extension/runtimeads-<version>.vsix
```

Synced from the source repo automatically; do not open PRs here.
