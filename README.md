<div align="center">

<img src="apps/vscode-extension/media/favicon.png" width="96" alt="RuntimeAds" />

# RuntimeAds

### Get paid while your AI agents think.

RuntimeAds shows a single, privacy-safe sponsor ad while **Claude Code** or **Codex** is busy —
in the panel spinner, the terminal, or the status bar. You earn during the wait, and it
**never reads your prompts, code, or terminal output**.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/runtimeads.runtimeads?label=VS%20Code%20Marketplace&logo=visualstudiocode&color=2ea043)](https://marketplace.visualstudio.com/items?itemName=runtimeads.runtimeads)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/runtimeads.runtimeads?label=installs&color=2ea043)](https://marketplace.visualstudio.com/items?itemName=runtimeads.runtimeads)
[![Open VSX](https://img.shields.io/open-vsx/v/runtimeads/runtimeads?label=Open%20VSX&color=2ea043)](https://open-vsx.org/extension/runtimeads/runtimeads)

**[Install for VS Code](https://marketplace.visualstudio.com/items?itemName=runtimeads.runtimeads)** ·
**[Install for Cursor](https://open-vsx.org/extension/runtimeads/runtimeads)** ·
**[runtimeads.com](https://runtimeads.com)**

</div>

---

## What it does

- **Detects idle moments** — when your coding agent is thinking or running a tool and you're just waiting.
- **Shows one tasteful ad** in that moment: the Claude/Codex panel spinner, the terminal, or the status bar. Never in your chat, never as a popup.
- **Pays you for the attention** — a revenue share on every verified impression, cashable once you hit the payout threshold.

## Privacy first

RuntimeAds only observes **agent lifecycle signals** ("waiting started / ended"). It does **not** read,
store, or transmit your prompts, code, files, or terminal output. Ads render from a **local cache**, so
nothing sits on your hot path. See the full [privacy policy](https://runtimeads.com/privacy).

## Install

- **VS Code** — search **"RuntimeAds"** in the Extensions tab, or [install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=runtimeads.runtimeads).
- **Cursor / VSCodium / Windsurf** — search **"RuntimeAds"** (served from [Open VSX](https://open-vsx.org/extension/runtimeads/runtimeads)).

Then run **“RuntimeAds: Sign In”** and accept the one-time setup that connects Claude Code & Codex.

## How it works

1. A tiny hook reports only *"the agent started/finished waiting"* to the local extension — nothing else.
2. The extension shows a cached sponsor ad during the wait and records the impression locally.
3. Verified impressions (and clicks) earn you a revenue share. You're **never charged** — clicks are engagement, not a cost to you.

## About this repository

This is a **public, read-only mirror** of the RuntimeAds client — the exact code that runs on your
machine, published so anyone can audit it. The backend (API, advertiser portal, auction & accounting
engine) is **not** here.

- [`apps/vscode-extension/`](apps/vscode-extension) — the extension
- [`packages/runtime/`](packages/runtime), [`packages/sdk-contracts/`](packages/sdk-contracts) — libraries bundled into the published build

### Build & verify it matches the published extension

```bash
pnpm install
pnpm build:vsix   # → apps/vscode-extension/runtimeads-<version>.vsix
```

> Synced automatically from the private source repo — please don't open PRs or issues here.

## License

Source-available, **not** open-source — see [LICENSE.txt](LICENSE.txt). You may view the source and run
the official build; redistribution, modification, competing services, and tampering with billing or
integrity mechanisms are not permitted.

© 2026 Cognitobit Innovations Private Limited.
