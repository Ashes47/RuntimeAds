import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ICON_DIR = path.join(os.homedir(), ".runtimeads", "icons");
// Keep in lockstep with the API/web icon limit (256 KB) — a smaller cap here silently drops
// server-accepted icons and the webview renders an empty <img> (a "black spot").
const ICON_MAX_BYTES = 262_144;

function cachePathForIconUrl(iconUrl: string): string {
  const hash = createHash("sha256").update(iconUrl).digest("hex").slice(0, 24);
  return path.join(ICON_DIR, `${hash}.bin`);
}

// Ext M5 (blind SSRF): icon URLs are server-originated, but validate the whole URL and block
// link-local + private-LAN IP literals (cloud metadata at 169.254.169.254, LAN probing) so a
// tampered URL can't make the developer's machine fetch internal services. Loopback stays
// allowed for local dev (MinIO on 127.0.0.1).
function isPrivateOrLinkLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    return false;
  }
  // IPv6 link-local (fe80::) and unique-local (fc00::/fd00::). Gate the fc/fd check to
  // literal IPv6 (host contains ":") so it doesn't block DNS names like fcdn.example.com.
  if (host.startsWith("fe80:")) return true;
  return host.includes(":") && (host.startsWith("fc") || host.startsWith("fd"));
}

function fetchableIconUrl(iconUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(iconUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  if (isPrivateOrLinkLocalHost(parsed.hostname)) {
    return undefined;
  }
  return parsed.toString();
}

export async function cacheCampaignIcon(iconUrl: string): Promise<string | undefined> {
  const safeUrl = fetchableIconUrl(iconUrl);
  if (safeUrl === undefined) {
    return undefined;
  }

  const cachePath = cachePathForIconUrl(safeUrl);

  try {
    const existing = await readFile(cachePath);
    if (existing.length > 0 && existing.length <= ICON_MAX_BYTES) {
      return existing.toString("base64");
    }
  } catch {
    // Cache miss; fetch below.
  }

  try {
    const response = await fetch(safeUrl);
    if (!response.ok) {
      return undefined;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) {
      return undefined;
    }

    await mkdir(ICON_DIR, { recursive: true });
    await writeFile(cachePath, bytes);
    return bytes.toString("base64");
  } catch {
    return undefined;
  }
}

function mimeTypeForIconBytes(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return "image/png";
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01) {
    return "image/x-icon";
  }

  return "image/png";
}

/** Inline data URL for webview `<img>` tags (not for terminal spinner text). */
export async function resolveCampaignIconDataUrl(iconUrl?: string): Promise<string | undefined> {
  if (!iconUrl) {
    return undefined;
  }

  const base64 = await cacheCampaignIcon(iconUrl);
  if (!base64) {
    return undefined;
  }

  // Derive the MIME from the actual bytes (decode just the magic-byte prefix) so a JPEG/WebP
  // icon isn't mislabelled as PNG — which would make the webview render a broken image.
  const mime = mimeTypeForIconBytes(Buffer.from(base64.slice(0, 24), "base64"));
  return `data:${mime};base64,${base64}`;
}
