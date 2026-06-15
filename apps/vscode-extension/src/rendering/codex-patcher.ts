import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { locateCodexExtensionJs } from "./codex-locator";
import { sha256 } from "./webview-host";

const BLOCK_START = "/* RUNTIMEADS-START */";
const BLOCK_END = "/* RUNTIMEADS-END */";
const ID = "[A-Za-z_$][\\w$]*";
const STRIP_RES: RegExp[] = [
  new RegExp(
    "(?:" +
      ID +
      "=\\()?" +
      "\\/\\* RUNTIMEADS-START \\*\\/[\\s\\S]*?\\/\\* RUNTIMEADS-END \\*\\/" +
      "(?:\\)\\|\\|" +
      ID +
      ";)?",
    "g",
  ),
  new RegExp(ID + "=\\(\\)\\|\\|" + ID + ";", "g"),
  // Legacy broken boundary from patcher builds that omitted the invoke parens.
  new RegExp("\\}\\)\\(\\);\\)\\|\\|" + ID, "g"),
];
const LEGACY_PATCH_BOUNDARY_RE = /\}\)\(\);\s*\)\|\|/;
const EXPORT_RE = /export\s*\{([^}]*)\}/;
const JSX_RE = /\(0,\s*([A-Za-z0-9_$]+)\.jsxs?\)/;
const CSP_CONNECT_RE = /`connect-src\s+([^`]*)`/g;
const CSP_MARK = "connect-src http://127.0.0.1:*";
const CSP_INSERT = "http://127.0.0.1:* http://localhost:*";

export interface CodexShimmerEntry {
  name: string;
  arg: string;
  at: number;
}

/** Primary Codex shimmer entry (export `t`, then legacy export `n`). */
export function locateCodexShimmerEntry(source: string): CodexShimmerEntry | null {
  const exportMatch = EXPORT_RE.exec(source);
  if (!exportMatch) {
    return null;
  }

  const exports = exportMatch[1] ?? "";
  const entryExport =
    /([A-Za-z0-9_$]+)\s+as\s+t\b/.exec(exports) ?? /([A-Za-z0-9_$]+)\s+as\s+n\b/.exec(exports);
  if (!entryExport?.[1]) {
    return null;
  }

  const entryName = entryExport[1];
  const signature = new RegExp(
    "function\\s+" + entryName + "\\s*\\(\\s*([A-Za-z0-9_$]+)\\s*\\)\\s*\\{",
  ).exec(source);
  if (!signature?.[1]) {
    return null;
  }

  return {
    name: entryName,
    arg: signature[1],
    at: signature.index + signature[0].length,
  };
}

export interface CodexPatchParams {
  brand: string;
  headline: string;
  iconUrl: string;
  clickUrl: string;
  allocationId: string;
  loopbackBase: string;
}

export interface CodexPatchResult {
  ok: boolean;
  reason?: string;
  target?: string;
}

export class CodexWebviewPatcher {
  constructor(
    private readonly target: string,
    private readonly blockAssetPath: string,
  ) {}

  preflight(): CodexPatchResult {
    if (!existsSync(this.target)) {
      return { ok: false, reason: "Codex webview bundle not found", target: this.target };
    }

    const pristine = this.readPristineSource();
    if (!pristine) {
      return { ok: false, reason: "Unable to read Codex webview bundle", target: this.target };
    }

    if (
      !locateCodexShimmerEntry(pristine) ||
      !/defaultMessage:`Thinking`/.test(pristine) ||
      JSX_RE.exec(pristine) === null
    ) {
      return {
        ok: false,
        reason: "Unsupported Codex build (thinking-shimmer anchors missing)",
        target: this.target,
      };
    }

    return { ok: true, target: this.target };
  }

  reapplyPatch(params: CodexPatchParams): CodexPatchResult {
    const preflight = this.preflight();
    if (!preflight.ok) {
      return preflight;
    }

    try {
      const pristine = this.readPristineSource();
      if (!pristine) {
        return { ok: false, reason: "Unable to read pristine webview bundle", target: this.target };
      }

      const next = this.buildInjectedSource(pristine, params);
      if (!next) {
        return {
          ok: false,
          reason: "thinking-shimmer entry function not found",
          target: this.target,
        };
      }

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

  applyPatch(params: CodexPatchParams): CodexPatchResult {
    const preflight = this.preflight();
    if (!preflight.ok) {
      return preflight;
    }

    try {
      const pristine = this.ensurePristineSource();
      const next = this.buildInjectedSource(pristine, params);
      if (!next) {
        return {
          ok: false,
          reason: "thinking-shimmer entry function not found",
          target: this.target,
        };
      }

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

  restore(opts?: { keepCsp?: boolean }): CodexPatchResult {
    try {
      const backupPath = this.backupPath();
      if (!existsSync(backupPath)) {
        // No backup (e.g. a concurrent re-patch from another window raced a prior restore,
        // or the backup was lost). Strip the injection directly from the target to recover
        // the original instead of leaving it patched.
        if (existsSync(this.target)) {
          const current = readFileSync(this.target, "utf8");
          if (current.includes(BLOCK_START)) {
            writeFileSync(this.target, stripInjection(current), "utf8");
          }
        }
        if (!opts?.keepCsp) {
          this.restoreCsp();
        }
        return { ok: true, reason: "no backup present", target: this.target };
      }

      const pristine = readFileSync(backupPath);
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

  prime(): CodexPatchResult {
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
    const sibling = locateCodexExtensionJs(this.target);
    return sibling ? `${sibling}.runtimeads-backup` : "";
  }

  private ensurePristineSource(): string {
    const backup = this.backupPath();
    const live = readFileSync(this.target, "utf8");
    const pristine = stripInjection(existsSync(backup) ? readFileSync(backup, "utf8") : live);

    if (!existsSync(backup)) {
      writeFileSync(backup, Buffer.from(pristine, "utf8"));
    }

    return pristine;
  }

  private readPristineSource(): string | null {
    const backup = this.backupPath();
    if (existsSync(backup)) {
      return stripInjection(readFileSync(backup, "utf8"));
    }

    if (!existsSync(this.target)) {
      return null;
    }

    return stripInjection(readFileSync(this.target, "utf8"));
  }

  private buildInjectedSource(pristine: string, params: CodexPatchParams): string | null {
    const location = locateCodexShimmerEntry(pristine);
    if (!location) {
      return null;
    }

    const block = this.renderBlock(params);
    const next = buildCodexInjectedSource(pristine, location, block);
    assertValidCodexPatchBoundary(next);
    return next;
  }

  private renderBlock(params: CodexPatchParams): string {
    let source = readFileSync(this.blockAssetPath, "utf8").trim();
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

    return source;
  }

  private patchCsp(): void {
    const sibling = locateCodexExtensionJs(this.target);
    if (!sibling || !existsSync(sibling)) {
      return;
    }

    const source = readFileSync(sibling, "utf8");
    if (source.includes(CSP_MARK)) {
      return;
    }

    let changed = false;
    const replaced = source.replace(CSP_CONNECT_RE, (_match, rest: string) => {
      changed = true;
      return "`connect-src " + CSP_INSERT + " " + rest.trim() + "`";
    });

    if (!changed) {
      return;
    }

    const backup = this.extBackupPath();
    if (backup && !existsSync(backup)) {
      writeFileSync(backup, Buffer.from(source, "utf8"));
    }

    writeFileSync(sibling, Buffer.from(replaced, "utf8"));
  }

  private restoreCsp(): void {
    const backup = this.extBackupPath();
    const sibling = locateCodexExtensionJs(this.target);
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
      writeFileSync(target, data);
      unlinkSync(tmp);
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

export function buildCodexInjectedSource(
  pristine: string,
  location: CodexShimmerEntry,
  block: string,
): string {
  return (
    pristine.slice(0, location.at) +
    BLOCK_START +
    location.arg +
    "=(" +
    block +
    "())||" +
    location.arg +
    ";" +
    BLOCK_END +
    pristine.slice(location.at)
  );
}

export function assertValidCodexPatchBoundary(source: string): void {
  if (LEGACY_PATCH_BOUNDARY_RE.test(source)) {
    throw new Error("Invalid Codex patch boundary (legacy })();)|| syntax)");
  }
}

function stripInjection(source: string): string {
  let next = source;
  for (const pattern of STRIP_RES) {
    next = next.replace(pattern, "");
  }
  return next;
}
