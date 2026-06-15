// RuntimeAds CLI status line. Shipped raw (placeholders substituted at install).
// Reads a cache file and prints once. No network, no stdin, never throws.
import { readFileSync } from "node:fs";

try {
  const CACHE = __RUNTIMEADS_CLI_AD_PATH__;
  const FRESH_MS = __RUNTIMEADS_FRESH_MS__;
  const parsed = JSON.parse(readFileSync(CACHE, "utf8"));
  const fresh =
    parsed &&
    typeof parsed.ts === "number" &&
    Date.now() - parsed.ts <= FRESH_MS &&
    typeof parsed.adText === "string" &&
    parsed.adText.length > 0;

  if (fresh) {
    const strip = (value) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
    const text = strip(parsed.adText);
    const url = typeof parsed.clickUrl === "string" ? strip(parsed.clickUrl) : "";
    const ESC = "\u001b";
    const out = url ? ESC + "]8;;" + url + ESC + "\\" + text + ESC + "]8;;" + ESC + "\\" : text;
    process.stdout.write(out);
  }
} catch {
  // Never break the Claude CLI status line.
}

process.exit(0);
