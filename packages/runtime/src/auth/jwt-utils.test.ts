import { describe, expect, it } from "vitest";

import { decodeJwtPayload, isJwtExpired } from "./jwt-utils";

describe("jwt-utils", () => {
  it("decodes JWT payload claims", () => {
    const token = createUnsignedJwt({ sub: "developer-1", exp: 4_102_444_800 });

    expect(decodeJwtPayload(token)).toMatchObject({
      sub: "developer-1",
      exp: 4_102_444_800,
    });
  });

  it("detects expired access tokens with skew", () => {
    const token = createUnsignedJwt({ exp: 1_700_000_000 });

    expect(isJwtExpired(token, 1_700_000_000_000, 0)).toBe(true);
    expect(isJwtExpired(token, 1_699_999_000_000, 0)).toBe(false);
  });

  it("treats tokens without exp as non-expired client hints", () => {
    const token = createUnsignedJwt({ sub: "developer-1" });

    expect(isJwtExpired(token)).toBe(false);
  });
});

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
