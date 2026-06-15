export interface JwtPayload {
  exp?: number;
  sub?: string;
  [key: string]: unknown;
}

export function decodeJwtPayload(token: string): JwtPayload | undefined {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return undefined;
  }

  try {
    const normalized = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const json = Buffer.from(normalized + padding, "base64").toString("utf8");
    return JSON.parse(json) as JwtPayload;
  } catch {
    return undefined;
  }
}

export function isJwtExpired(token: string, nowMs = Date.now(), skewMs = 30_000): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) {
    return false;
  }

  return payload.exp * 1000 <= nowMs + skewMs;
}
