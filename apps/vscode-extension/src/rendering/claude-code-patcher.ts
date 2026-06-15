import { existsSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { locateClaudeCodeExtensionJs } from "./claude-code-locator";
import { sha256 } from "./webview-host";

const BLOCK_START = "/* RUNTIMEADS-START */";
const BLOCK_RE = /\/\* RUNTIMEADS-START \*\/[\s\S]*?\/\* RUNTIMEADS-END \*\//g;
const ANCHORS = [
  '"Discombobulating"',
  '"Flibbertigibbeting"',
  '"Combobulating"',
  '"Clauding"',
  '"Reticulating"',
];
const ARRAY_RE = /\[(?:"[^"\\]*"\s*,\s*)+"[^"\\]*"\]/g;
const CSP_ANCHOR_RE = /default-src 'none'; (\$\{[a-zA-Z_]\w*\})/;
const CSP_MARK = "connect-src http://127.0.0.1:*";

export interface ClaudeCodePatchParams {
  brand: string;
  headline: string;
  iconUrl: string;
  clickUrl: string;
  allocationId: string;
  loopbackBase: string;
}

export interface ClaudeCodePatchResult {
  ok: boolean;
  reason?: string;
  target?: string;
}

export class ClaudeCodeWebviewPatcher {
  constructor(
    private readonly target: string,
    private readonly blockAssetPath: string,
  ) {}

  preflight(): ClaudeCodePatchResult {
    if (!existsSync(this.target)) {
      return { ok: false, reason: "Claude Code webview bundle not found", target: this.target };
    }

    const pristine = this.readPristineSource();
    if (!pristine) {
      return {
        ok: false,
        reason: "Unable to read Claude Code webview bundle",
        target: this.target,
      };
    }

    if (this.findVerbArray(pristine) === null) {
      return {
        ok: false,
        reason: "Unsupported Claude Code build (spinner markers missing)",
        target: this.target,
      };
    }

    return { ok: true, target: this.target };
  }

  reapplyPatch(params: ClaudeCodePatchParams): ClaudeCodePatchResult {
    const preflight = this.preflight();
    if (!preflight.ok) {
      return preflight;
    }

    try {
      const pristine = this.readPristineSource();
      if (!pristine) {
        return { ok: false, reason: "Unable to read pristine webview bundle", target: this.target };
      }

      const block = this.renderBlock(params);
      const next = `${pristine.replace(BLOCK_RE, "").replace(/\s+$/, "")}\n${block}\n`;
      const nextBuf = Buffer.from(next, "utf8");

      if (sha256(nextBuf) !== sha256(readFileSync(this.target))) {
        this.atomicWrite(this.target, nextBuf);
      }

      this.patchCsp();
      return { ok: true, target: this.target };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "reapply failed",
        target: this.target,
      };
    }
  }

  applyPatch(params: ClaudeCodePatchParams): ClaudeCodePatchResult {
    const preflight = this.preflight();
    if (!preflight.ok) {
      return preflight;
    }

    try {
      const pristineBuf = this.ensureBackup();
      if (pristineBuf === null) {
        return { ok: true, reason: "already patched", target: this.target };
      }

      const pristine = pristineBuf.toString("utf8");
      const block = this.renderBlock(params);
      const next = `${pristine.replace(BLOCK_RE, "").replace(/\s+$/, "")}\n${block}\n`;
      const nextBuf = Buffer.from(next, "utf8");

      if (sha256(nextBuf) !== sha256(readFileSync(this.target))) {
        this.atomicWrite(this.target, nextBuf);
      }

      this.patchCsp();
      return { ok: true, target: this.target };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "patch failed",
        target: this.target,
      };
    }
  }

  restore(opts?: { keepCsp?: boolean }): ClaudeCodePatchResult {
    try {
      const backupPath = this.backupPath();
      if (!existsSync(backupPath)) {
        // No backup (e.g. a concurrent re-patch from another window raced a prior restore,
        // or the backup was lost). The injected block is self-delimited and only appended,
        // so strip it directly from the target to recover the original instead of giving up.
        if (existsSync(this.target)) {
          const current = readFileSync(this.target, "utf8");
          if (current.indexOf(BLOCK_START) !== -1) {
            writeFileSync(
              this.target,
              `${current.replace(BLOCK_RE, "").replace(/\s+$/, "")}\n`,
              "utf8",
            );
          }
        }
        if (!opts?.keepCsp) {
          this.restoreCsp();
        }
        return { ok: true, reason: "no backup present", target: this.target };
      }

      let pristine = readFileSync(backupPath);
      if (pristine.indexOf(BLOCK_START) !== -1) {
        pristine = Buffer.from(pristine.toString("utf8").replace(BLOCK_RE, ""), "utf8");
      }

      writeFileSync(this.target, pristine);
      if (sha256(readFileSync(this.target)) !== sha256(pristine)) {
        return { ok: false, reason: "restore verification failed", target: this.target };
      }

      rmSync(backupPath);
      if (!opts?.keepCsp) {
        this.restoreCsp();
      }

      return { ok: true, target: this.target };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "restore failed",
        target: this.target,
      };
    }
  }

  isPatched(): boolean {
    try {
      return existsSync(this.target) && readFileSync(this.target, "utf8").includes(BLOCK_START);
    } catch {
      return false;
    }
  }

  prime(): ClaudeCodePatchResult {
    try {
      this.patchCsp();
      return { ok: true, target: this.target };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "csp prime failed",
        target: this.target,
      };
    }
  }

  private backupPath(): string {
    return `${this.target}.runtimeads-backup`;
  }

  private extBackupPath(): string {
    const sibling = locateClaudeCodeExtensionJs(this.target);
    return sibling ? `${sibling}.runtimeads-backup` : "";
  }

  private ensureBackup(): Buffer | null {
    const existing = this.backupPath();
    if (existsSync(existing)) {
      return readFileSync(existing);
    }

    const raw = readFileSync(this.target);
    if (raw.indexOf(BLOCK_START) !== -1) {
      return null;
    }

    writeFileSync(existing, raw);
    return raw;
  }

  private readPristineSource(): string | null {
    const backup = this.backupPath();
    if (existsSync(backup)) {
      return readFileSync(backup, "utf8");
    }

    if (!existsSync(this.target)) {
      return null;
    }

    const live = readFileSync(this.target, "utf8");
    return live.replace(BLOCK_RE, "");
  }

  private findVerbArray(source: string): [number, number] | null {
    for (const match of source.matchAll(ARRAY_RE)) {
      if (ANCHORS.some((anchor) => match[0].includes(anchor))) {
        return [match.index ?? 0, (match.index ?? 0) + match[0].length];
      }
    }

    return null;
  }

  private renderBlock(params: ClaudeCodePatchParams): string {
    let source = readFileSync(this.blockAssetPath, "utf8");
    const replacements: Record<string, string> = {
      __RUNTIMEADS_BRAND__: JSON.stringify(params.brand),
      __RUNTIMEADS_HEADLINE__: JSON.stringify(params.headline),
      __RUNTIMEADS_ICON_URL__: JSON.stringify(params.iconUrl),
      __RUNTIMEADS_CLICK_URL__: JSON.stringify(params.clickUrl),
      __RUNTIMEADS_ALLOCATION_ID__: JSON.stringify(params.allocationId),
      __RUNTIMEADS_LOOPBACK_BASE__: JSON.stringify(params.loopbackBase),
    };

    for (const [key, value] of Object.entries(replacements)) {
      source = source.split(key).join(value);
    }

    return source.trim();
  }

  private patchCsp(): void {
    const sibling = locateClaudeCodeExtensionJs(this.target);
    if (!sibling || !existsSync(sibling)) {
      return;
    }

    const source = readFileSync(sibling, "utf8");
    if (source.includes(CSP_MARK)) {
      return;
    }

    const match = CSP_ANCHOR_RE.exec(source);
    if (!match) {
      return;
    }

    const backup = this.extBackupPath();
    if (backup && !existsSync(backup)) {
      writeFileSync(backup, Buffer.from(source, "utf8"));
    }

    const replaced = source.replace(
      CSP_ANCHOR_RE,
      "default-src 'none'; connect-src http://127.0.0.1:* http://localhost:*; $1",
    );
    writeFileSync(sibling, Buffer.from(replaced, "utf8"));
  }

  private restoreCsp(): void {
    const backup = this.extBackupPath();
    const sibling = locateClaudeCodeExtensionJs(this.target);
    if (!backup || !sibling || !existsSync(backup)) {
      return;
    }

    const pristine = readFileSync(backup);
    writeFileSync(sibling, pristine);
    if (sha256(readFileSync(sibling)) === sha256(pristine)) {
      rmSync(backup);
    }
  }

  private atomicWrite(target: string, data: Buffer): void {
    const tmp = `${target}.runtimeads-tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmp, data);
      renameSync(tmp, target);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        // Ignore temp cleanup failures.
      }
      writeFileSync(target, data);
    }
  }
}
