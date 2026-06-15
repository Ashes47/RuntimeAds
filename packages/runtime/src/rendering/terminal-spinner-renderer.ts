import type { CachedAllocation } from "@runtimeads/sdk-contracts";

// These regexes intentionally match terminal control characters (ESC, BEL, C0/C1)
// to detect and strip ANSI / OSC inline-image payloads from spinner verbs.
// eslint-disable-next-line no-control-regex
const ITERM_INLINE_IMAGE_RE = /\u001b\]1337;File=[^\u0007]*\u0007/g;
const ORPHAN_BASE64_PREFIX_RE = /^◆?\s*[A-Za-z0-9+/]{80,}={0,2}\s*/;
// eslint-disable-next-line no-control-regex
const ANSI_SGR_RE = /\u001b\[[0-9;]*m/g;

/** Detect legacy iTerm inline-image spinner verbs that leak base64 in Cursor/VS Code. */
export function containsLegacySpinnerImage(verb: string): boolean {
  return ITERM_INLINE_IMAGE_RE.test(verb) || ORPHAN_BASE64_PREFIX_RE.test(verb);
}

/** Strip terminal control chars — Claude spinnerVerbs must be plain text. */
export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/** Strip legacy inline-image payloads, ANSI, and control chars from spinner verbs. */
export function sanitizeSpinnerVerb(verb: string): string {
  let cleaned = verb.replace(ITERM_INLINE_IMAGE_RE, "");
  cleaned = cleaned.replace(ORPHAN_BASE64_PREFIX_RE, "");
  cleaned = cleaned.replace(ANSI_SGR_RE, "");
  cleaned = cleaned.replace(/^◆\s*/, "");
  cleaned = stripControlChars(cleaned);
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/** Kickbacks-style plain CLI ad line (spinner verb + status line). */
export function formatCliAdText(allocation: CachedAllocation): string {
  return stripControlChars(`${allocation.brand} — ${allocation.headline} ↗`);
}
