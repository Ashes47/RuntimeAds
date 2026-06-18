/**
 * Compare two dot-separated versions (e.g. "0.1.0" vs "0.2.0"). Numeric parts only;
 * pre-release/build suffixes (after `-` or `+`) are ignored. Missing trailing parts are
 * treated as 0, so "0.1" === "0.1.0". Returns -1 if `a` < `b`, 1 if `a` > `b`, else 0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseParts(a);
  const pb = parseParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) {
      return da < db ? -1 : 1;
    }
  }
  return 0;
}

/** True when `current` is strictly behind `target` (i.e. an update exists). */
export function isVersionOlder(current: string, target: string): boolean {
  return compareVersions(current, target) < 0;
}

function parseParts(version: string): number[] {
  // Drop any pre-release/build suffix, then read the numeric x.y.z components.
  const core = version.split(/[-+]/, 1)[0] ?? "";
  return core
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) ? value : 0));
}
