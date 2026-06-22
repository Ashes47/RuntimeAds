import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { CachedAllocation } from "@runtimeads/sdk-contracts";
import {
  containsLegacySpinnerImage,
  formatCliAdText,
  sanitizeSpinnerVerb,
} from "@runtimeads/runtime";

import { atomicWriteFileSync } from "./atomic-write";

const ABSENT_MARKER = "/* RUNTIMEADS-CLI-ABSENT */";
// Detects leaked ANSI color escape sequences that workspace settings have
// historically injected into spinner verbs. The \u001b control char is intentional.
// eslint-disable-next-line no-control-regex
const ANSI_COLOR_RE = /\u001b\[[0-9;]*m/;
const SCRIPT_NAME = "runtimeads-cli-statusline.mjs";
const CACHE_NAME = "cli-ad.json";
const FRESH_MS = 10 * 60 * 1000;
const RUNTIMEADS_CLI_KEY = "runtimeadsCliSurfaces";

export interface ClaudeCliSyncResult {
  ok: boolean;
  reason?: string;
}

interface CliAdCache {
  adText: string;
  clickUrl: string;
  destinationUrl: string;
  allocationId: string;
  ts: number;
}

function buildCliOpenUrl(baseUrl: string, allocationId: string, surface: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/open?allocation_id=${encodeURIComponent(allocationId)}&surface=${encodeURIComponent(surface)}`;
}

export class ClaudeCliSyncService {
  private webviewBaseUrl?: string;

  constructor(
    private readonly extensionPath: string,
    private readonly workspaceSettingsPath?: string,
  ) {}

  setWebviewBaseUrl(url: string): void {
    this.webviewBaseUrl = url.replace(/\/$/, "");
  }

  clearAdCache(): void {
    try {
      const cachePath = this.cachePath();
      if (existsSync(cachePath)) {
        rmSync(cachePath);
      }
    } catch {
      // Best-effort cache clear on dismiss.
    }
  }

  /** Remove CLI ad surfaces from global settings (spinner verb + empty status cache). */
  clearCliSurfaces(): ClaudeCliSyncResult {
    try {
      this.clearAdCache();
      const settingsPath = this.settingsPath();
      if (!existsSync(settingsPath)) {
        return { ok: true };
      }

      const settings = this.readJson(readFileSync(settingsPath, "utf8"));
      if (settings[RUNTIMEADS_CLI_KEY] !== true) {
        return { ok: true };
      }

      delete settings.spinnerVerbs;
      delete settings.runtimeadsSpinnerVerbs;
      atomicWriteFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      this.stripWorkspaceCliSurfaces();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "cli clear failed",
      };
    }
  }

  syncAllocation(allocation: CachedAllocation): ClaudeCliSyncResult {
    try {
      const adText = formatCliAdText(allocation);
      const clickUrl = this.webviewBaseUrl
        ? buildCliOpenUrl(this.webviewBaseUrl, allocation.allocationId, "cli_status_line")
        : allocation.destinationUrl;
      this.writeCache({
        adText,
        clickUrl,
        destinationUrl: allocation.destinationUrl,
        allocationId: allocation.allocationId,
        ts: Date.now(),
      });
      this.ensureStatuslineScript();
      this.upsertSettings(adText);
      this.stripWorkspaceCliSurfaces();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "cli sync failed",
      };
    }
  }

  restore(): ClaudeCliSyncResult {
    try {
      const settingsPath = this.settingsPath();
      const backupPath = `${settingsPath}.runtimeads-cli-backup`;

      // Choose the restore base: the backup (the user's pre-RuntimeAds config) if present,
      // otherwise the live file. ABSENT_MARKER means there was no settings.json before us.
      let source: string | null = null;
      let removeSettings = false;
      if (existsSync(backupPath)) {
        const saved = readFileSync(backupPath, "utf8");
        if (saved === ABSENT_MARKER) {
          removeSettings = true;
        } else {
          source = saved;
        }
        rmSync(backupPath);
      } else if (existsSync(settingsPath)) {
        source = readFileSync(settingsPath, "utf8");
      }

      if (removeSettings) {
        if (existsSync(settingsPath)) {
          rmSync(settingsPath);
        }
      } else if (source !== null) {
        // Always strip our keys defensively, so a backup captured while already patched
        // (legacy bug) can never re-pollute the restored file.
        const cleaned = this.stripRuntimeadsCliKeys(this.readJson(source));
        atomicWriteFileSync(settingsPath, `${JSON.stringify(cleaned, null, 2)}\n`);
      }

      const scriptPath = this.scriptPath();
      if (existsSync(scriptPath)) {
        rmSync(scriptPath);
      }

      const cachePath = this.cachePath();
      if (existsSync(cachePath)) {
        rmSync(cachePath);
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "cli restore failed",
      };
    }
  }

  /** Remove only the keys RuntimeAds owns (gated by our markers, so user keys survive). */
  private stripRuntimeadsCliKeys(settings: Record<string, unknown>): Record<string, unknown> {
    const next = { ...settings };
    const ownsSpinner = next.runtimeadsSpinnerVerbs === true;
    const ownsCli = next[RUNTIMEADS_CLI_KEY] === true;
    delete next[RUNTIMEADS_CLI_KEY];
    delete next.runtimeadsSpinnerVerbs;
    if (ownsSpinner) {
      delete next.spinnerVerbs;
    }
    if (ownsCli) {
      const statusLine = next.statusLine as { command?: unknown } | undefined;
      if (
        statusLine &&
        typeof statusLine.command === "string" &&
        statusLine.command.includes(SCRIPT_NAME)
      ) {
        delete next.statusLine;
      }
    }
    return next;
  }

  private writeCache(cache: CliAdCache): void {
    mkdirSync(this.runtimeadsDir(), { recursive: true });
    atomicWriteFileSync(this.cachePath(), JSON.stringify(cache));
  }

  private ensureStatuslineScript(): void {
    const assetPath = join(this.extensionPath, "dist", SCRIPT_NAME);
    const scriptPath = this.scriptPath();
    const rendered = readFileSync(assetPath, "utf8")
      .split("__RUNTIMEADS_CLI_AD_PATH__")
      .join(JSON.stringify(this.cachePath()))
      .split("__RUNTIMEADS_FRESH_MS__")
      .join(String(FRESH_MS));

    mkdirSync(this.runtimeadsDir(), { recursive: true });
    if (!existsSync(scriptPath) || readFileSync(scriptPath, "utf8") !== rendered) {
      atomicWriteFileSync(scriptPath, rendered);
    }
  }

  private upsertSettings(adText: string): void {
    const settingsPath = this.settingsPath();
    const backupPath = `${settingsPath}.runtimeads-cli-backup`;
    const existed = existsSync(settingsPath);
    const pristine = existed ? readFileSync(settingsPath, "utf8") : null;

    if (!existsSync(backupPath)) {
      // Snapshot the user's genuine config. If a prior patch already polluted the file
      // (no backup existed yet), sanitize it so the backup is a clean restore target;
      // otherwise keep the exact original bytes.
      if (pristine === null) {
        writeFileSync(backupPath, ABSENT_MARKER, "utf8");
      } else {
        const parsed = this.readJson(pristine);
        const alreadyPatched =
          parsed[RUNTIMEADS_CLI_KEY] === true || parsed.runtimeadsSpinnerVerbs === true;
        writeFileSync(
          backupPath,
          alreadyPatched
            ? `${JSON.stringify(this.stripRuntimeadsCliKeys(parsed), null, 2)}\n`
            : pristine,
          "utf8",
        );
      }
    }

    const settings = pristine ? this.readJson(pristine) : {};
    settings.statusLine = {
      type: "command",
      command: `node ${JSON.stringify(this.scriptPath())}`,
      padding: 0,
    };
    settings.spinnerVerbs = {
      mode: "replace",
      verbs: [sanitizeSpinnerVerb(adText)],
    };
    settings[RUNTIMEADS_CLI_KEY] = true;
    settings.runtimeadsSpinnerVerbs = true;

    const next = `${JSON.stringify(settings, null, 2)}\n`;
    if (!existed || next !== pristine) {
      mkdirSync(join(homedir(), ".claude"), { recursive: true });
      atomicWriteFileSync(settingsPath, next);
    }
  }

  private readJson(source: string): Record<string, unknown> {
    const parsed = JSON.parse(source) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  }

  private runtimeadsDir(): string {
    return join(homedir(), ".runtimeads");
  }

  private cachePath(): string {
    return join(this.runtimeadsDir(), CACHE_NAME);
  }

  private scriptPath(): string {
    return join(this.runtimeadsDir(), SCRIPT_NAME);
  }

  private settingsPath(): string {
    return join(homedir(), ".claude", "settings.json");
  }

  /** Workspace settings must not carry CLI surfaces — they override ~/.claude. */
  private stripWorkspaceCliSurfaces(): void {
    if (!this.workspaceSettingsPath || !existsSync(this.workspaceSettingsPath)) {
      return;
    }

    try {
      const pristine = readFileSync(this.workspaceSettingsPath, "utf8");
      const settings = this.readJson(pristine);
      const verb = readSpinnerVerb(settings);
      const managed =
        settings.runtimeadsSpinnerVerbs === true ||
        settings.runtimeadsCliSurfaces === true ||
        Boolean(settings.statusLine) ||
        (verb !== undefined && (containsLegacySpinnerImage(verb) || ANSI_COLOR_RE.test(verb)));

      if (!managed) {
        return;
      }

      delete settings.spinnerVerbs;
      delete settings.runtimeadsSpinnerVerbs;
      delete settings.statusLine;
      delete settings.runtimeadsCliSurfaces;

      const next = `${JSON.stringify(settings, null, 2)}\n`;
      if (next !== pristine) {
        atomicWriteFileSync(this.workspaceSettingsPath, next);
      }
    } catch {
      // Never break sync if workspace settings are malformed.
    }
  }
}

function readSpinnerVerb(settings: Record<string, unknown>): string | undefined {
  const spinnerVerbs = settings.spinnerVerbs;
  if (!spinnerVerbs || typeof spinnerVerbs !== "object") {
    return undefined;
  }

  const verbs = (spinnerVerbs as { verbs?: unknown }).verbs;
  if (!Array.isArray(verbs) || typeof verbs[0] !== "string") {
    return undefined;
  }

  return verbs[0];
}
