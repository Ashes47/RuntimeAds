import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

import type { CachedAllocation } from "@runtimeads/sdk-contracts";
import { formatCliAdText, stripControlChars } from "@runtimeads/runtime";

const MARKER = "RUNTIMEADS-CODEX-CLI";
const AD_FILE_NAME = "codex-cli-ad.txt";
const SHIM_METADATA_NAME = "codex-shim.json";

interface CodexShimMetadata {
  shimPath: string;
  entryPath: string;
  shimWasSymlink: boolean;
  symlinkTarget?: string;
}

export interface CodexCliSyncResult {
  ok: boolean;
  reason?: string;
}

export class CodexCliSyncService {
  constructor(private readonly extensionPath: string) {}

  clearBanner(): CodexCliSyncResult {
    try {
      const adPath = this.adFilePath();
      if (existsSync(adPath)) {
        rmSync(adPath);
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "codex cli clear failed",
      };
    }
  }

  syncAllocation(allocation: CachedAllocation): CodexCliSyncResult {
    try {
      const shim = this.locateCodexShim();
      if (!shim) {
        return { ok: false, reason: "codex shim not found" };
      }

      const preflight = this.preflight(shim);
      if (!preflight.ok) {
        return preflight;
      }

      mkdirSync(this.runtimeadsDir(), { recursive: true });
      writeFileSync(
        this.adFilePath(),
        `${stripControlChars(formatCliAdText(allocation)) || "RuntimeAds sponsor"}\n`,
        "utf8",
      );

      if (!this.isPatched(shim) || this.wrapperNeedsRefresh(shim)) {
        this.installWrapper(shim);
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "codex cli sync failed",
      };
    }
  }

  restore(): CodexCliSyncResult {
    try {
      const shim = this.locateCodexShim();
      if (!shim) {
        return { ok: true };
      }

      const metadata = this.readShimMetadata();
      if (metadata && metadata.shimPath === shim) {
        rmSync(shim, { force: true });
        if (metadata.shimWasSymlink && metadata.symlinkTarget) {
          symlinkSync(metadata.symlinkTarget, shim);
        } else if (existsSync(metadata.entryPath)) {
          symlinkSync(relative(dirname(shim), metadata.entryPath), shim);
        }
        rmSync(this.shimMetadataPath(), { force: true });
      } else if (this.isPatched(shim)) {
        const entryPath = this.guessCodexEntryPath(shim);
        if (entryPath) {
          rmSync(shim, { force: true });
          symlinkSync(relative(dirname(shim), entryPath), shim);
        }
      }

      this.removeLegacyBackups(shim);

      const adPath = this.adFilePath();
      if (existsSync(adPath)) {
        rmSync(adPath);
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "codex cli restore failed",
      };
    }
  }

  preflight(shim = this.locateCodexShim()): CodexCliSyncResult {
    if (!shim) {
      return { ok: false, reason: "codex shim not found" };
    }

    if (!existsSync(shim)) {
      return { ok: false, reason: "codex shim not found" };
    }

    const raw = readFileSync(shim, "utf8");
    if (raw.includes(MARKER)) {
      const entryPath = this.readShimMetadata()?.entryPath ?? this.guessCodexEntryPath(shim);
      if (!entryPath || !existsSync(entryPath)) {
        return {
          ok: false,
          reason: "codex entry script missing; reinstall @openai/codex",
        };
      }
      return { ok: true };
    }

    if (!this.looksLikeCodexEntry(raw)) {
      return { ok: false, reason: "codex shim does not look like @openai/codex" };
    }

    return { ok: true };
  }

  private installWrapper(shim: string): void {
    const resolved = this.resolveCodexEntry(shim);
    // Hard stop: a wrapper that execs the shim itself turns `codex` into a file Node parses as JS
    // and crashes on our `#` marker. Better to leave codex unpatched (no ad) than to break it.
    if (this.samePath(resolved.entryPath, shim)) {
      throw new Error("refusing to wrap codex: could not resolve the real entry (would self-exec)");
    }
    this.writeShimMetadata({
      shimPath: shim,
      entryPath: resolved.entryPath,
      shimWasSymlink: resolved.wasSymlink,
      ...(resolved.symlinkTarget ? { symlinkTarget: resolved.symlinkTarget } : {}),
    });

    if (lstatSync(shim).isSymbolicLink()) {
      unlinkSync(shim);
    }

    const wrapper = this.renderWrapper(resolved.entryPath);
    writeFileSync(shim, wrapper, "utf8");
    if (!shim.toLowerCase().endsWith(".cmd")) {
      try {
        chmodSync(shim, 0o755);
      } catch {
        // Best-effort on POSIX.
      }
    }
  }

  private resolveCodexEntry(shim: string): {
    entryPath: string;
    wasSymlink: boolean;
    symlinkTarget?: string;
  } {
    const metadata = this.readShimMetadata();
    if (
      metadata?.entryPath &&
      existsSync(metadata.entryPath) &&
      this.looksLikeCodexEntryFile(metadata.entryPath)
    ) {
      return {
        entryPath: metadata.entryPath,
        wasSymlink: metadata.shimWasSymlink,
        ...(metadata.symlinkTarget ? { symlinkTarget: metadata.symlinkTarget } : {}),
      };
    }

    try {
      const stat = lstatSync(shim);
      if (stat.isSymbolicLink()) {
        const symlinkTarget = readlinkSync(shim);
        const entryPath = realpathSync(shim);
        return { entryPath, wasSymlink: true, symlinkTarget };
      }
    } catch {
      // Fall through to heuristics below.
    }

    // A plain (non-symlink) shim is only the real entry if it actually looks like codex — never if
    // it's one of our wrappers (any marker) or anything else. realpathSync(shim) === shim for a
    // regular file, so without this check a stale wrapper would be used as its own exec target.
    if (!this.isPatched(shim)) {
      const entryPath = realpathSync(shim);
      if (entryPath !== shim && this.looksLikeCodexEntryFile(entryPath)) {
        return { entryPath, wasSymlink: false };
      }
    }

    const guessed = this.guessCodexEntryPath(shim);
    if (guessed) {
      return {
        entryPath: guessed,
        wasSymlink: true,
        symlinkTarget: relative(dirname(shim), guessed),
      };
    }

    throw new Error(
      "codex entry script missing; run RuntimeAds Restore webview patches or reinstall @openai/codex",
    );
  }

  private renderWrapper(entryPath: string): string {
    const assetName =
      process.platform === "win32" ? "codex-cli-wrapper.cmd.asset" : "codex-cli-wrapper.sh.asset";
    const assetPath = join(this.extensionPath, "dist", assetName);
    return readFileSync(assetPath, "utf8")
      .split("__RUNTIMEADS_CODEX_AD_PATH__")
      .join(this.adFilePath())
      .split("__RUNTIMEADS_CODEX_BACKUP__")
      .join(entryPath);
  }

  private wrapperNeedsRefresh(shim: string): boolean {
    try {
      const raw = readFileSync(shim, "utf8");
      if (!raw.includes(MARKER)) {
        return false;
      }

      const metadata = this.readShimMetadata();
      if (!metadata?.entryPath || !raw.includes(metadata.entryPath)) {
        return true;
      }

      return (
        raw.includes(".runtimeads-orig") ||
        raw.includes(".runtimeads-backup.mjs") ||
        raw.includes(".runtimeads/codex-shim.mjs") ||
        !raw.includes("exec node ")
      );
    } catch {
      return false;
    }
  }

  private locateCodexShim(): string | undefined {
    try {
      const command = process.platform === "win32" ? "where codex" : "which codex";
      const output = execSync(command, { encoding: "utf8" }).trim();
      const firstLine = output.split(/\r?\n/).find((line) => line.trim().length > 0);
      return firstLine?.trim();
    } catch {
      return undefined;
    }
  }

  private samePath(a: string, b: string): boolean {
    try {
      return realpathSync(a) === realpathSync(b);
    } catch {
      return a === b;
    }
  }

  private isPatched(shim: string): boolean {
    try {
      return existsSync(shim) && readFileSync(shim, "utf8").includes(MARKER);
    } catch {
      return false;
    }
  }

  private guessCodexEntryPath(shim: string): string | undefined {
    const candidates = [
      join(dirname(shim), "..", "lib", "node_modules", "@openai", "codex", "bin", "codex.js"),
      join(dirname(shim), "..", "lib", "node_modules", "@openai", "codex", "bin", "codex"),
    ];

    for (const candidate of candidates) {
      if (this.looksLikeCodexEntryFile(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private looksLikeCodexEntryFile(filePath: string): boolean {
    try {
      return this.looksLikeCodexEntry(readFileSync(filePath, "utf8"));
    } catch {
      return false;
    }
  }

  private looksLikeCodexEntry(raw: string): boolean {
    return (
      !raw.includes(MARKER) &&
      (/@openai[\\/]codex|codex-darwin|codex-linux|codex-win32/.test(raw) || /codex\.js/.test(raw))
    );
  }

  private readShimMetadata(): CodexShimMetadata | undefined {
    try {
      const raw = readFileSync(this.shimMetadataPath(), "utf8");
      const parsed = JSON.parse(raw) as CodexShimMetadata;
      if (parsed.shimPath && parsed.entryPath) {
        return parsed;
      }
    } catch {
      // No metadata yet.
    }

    return undefined;
  }

  private writeShimMetadata(metadata: CodexShimMetadata): void {
    mkdirSync(this.runtimeadsDir(), { recursive: true });
    writeFileSync(this.shimMetadataPath(), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }

  private removeLegacyBackups(shim: string): void {
    for (const legacyPath of [
      join(dirname(shim), "codex.runtimeads-backup.mjs"),
      join(dirname(shim), "codex.runtimeads-orig"),
      join(this.runtimeadsDir(), "codex-shim.mjs"),
    ]) {
      rmSync(legacyPath, { force: true });
    }
  }

  private shimMetadataPath(): string {
    return join(this.runtimeadsDir(), SHIM_METADATA_NAME);
  }

  private runtimeadsDir(): string {
    return join(homedir(), ".runtimeads");
  }

  private adFilePath(): string {
    return join(this.runtimeadsDir(), AD_FILE_NAME);
  }
}
