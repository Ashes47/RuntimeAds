import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";

// Files we write here — ~/.claude/settings.json, ~/.codex/hooks.json, the CLI ad cache, the
// statusline script — are read concurrently by Claude Code / Codex. A plain writeFile truncates
// then fills, so a reader landing mid-write sees partial JSON (this is what produced Claude's
// "Invalid hooks.json found" config error). Writing to a sibling temp file and renaming over the
// target makes the swap atomic on POSIX, so a reader only ever sees the old bytes or the new ones.

let counter = 0;

/** Sibling temp path (same directory → rename stays on one filesystem and is atomic). Unique per
 *  process + call so concurrent editor windows never collide on the temp name. */
function tempPath(target: string): string {
  counter += 1;
  return `${target}.runtimeads-tmp-${process.pid}-${Date.now()}-${counter}`;
}

/** Atomically replace `target` with `data` (write temp + rename). Throws on failure after cleaning
 *  up the temp file; callers already treat a failed surface write as a no-op for that round. */
export function atomicWriteFileSync(target: string, data: string): void {
  const tmp = tempPath(target);
  try {
    writeFileSync(tmp, data, "utf8");
    renameSync(tmp, target);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Temp may not exist if writeFileSync itself failed — ignore.
    }
    throw error;
  }
}

/** Async counterpart of {@link atomicWriteFileSync}. */
export async function atomicWriteFile(target: string, data: string): Promise<void> {
  const tmp = tempPath(target);
  try {
    await writeFile(tmp, data, "utf8");
    await rename(tmp, target);
  } catch (error) {
    try {
      await unlink(tmp);
    } catch {
      // Temp may not exist if writeFile itself failed — ignore.
    }
    throw error;
  }
}
