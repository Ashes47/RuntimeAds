import { describe, expect, it } from "vitest";

import { CredentialVault } from "./credential-vault";
import { AuthSessionManager } from "./auth-session-manager";

describe("AuthSessionManager", () => {
  it("restores authenticated state when an access token exists", async () => {
    const vault = new CredentialVault(createSecureStore());
    await vault.setAccessToken("access-token");
    const manager = new AuthSessionManager(vault);

    await manager.start();

    expect(manager.getStatus()).toBe("authenticated");
  });

  it("refreshes access token using the refresh token", async () => {
    const vault = new CredentialVault(createSecureStore());
    await vault.setRefreshToken("refresh-token");
    const manager = new AuthSessionManager(vault, {
      async loginWithGoogle() {
        throw new Error("not used");
      },
      async refresh(refreshToken) {
        expect(refreshToken).toBe("refresh-token");
        return { accessToken: "new-access-token" };
      },
      async redeemAuthCode() {
        throw new Error("not used");
      },
    });

    await manager.start();
    const accessToken = await manager.refreshAccessToken();

    expect(accessToken).toBe("new-access-token");
    expect(await vault.getAccessToken()).toBe("new-access-token");
    expect(manager.getStatus()).toBe("authenticated");
  });

  it("stores credentials after Google login", async () => {
    const vault = new CredentialVault(createSecureStore());
    const manager = new AuthSessionManager(vault, {
      async loginWithGoogle(googleToken) {
        expect(googleToken).toBe("dev-token");
        return {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          user: {
            id: "developer-id",
            email: "developer@example.com",
            role: "developer",
          },
        };
      },
      async refresh() {
        throw new Error("not used");
      },
      async redeemAuthCode() {
        throw new Error("not used");
      },
    });

    await manager.loginWithGoogle("dev-token");

    expect(manager.getStatus()).toBe("authenticated");
    expect(await vault.getAccessToken()).toBe("access-token");
    expect(await vault.getRefreshToken()).toBe("refresh-token");
    expect(await vault.getDeveloperId()).toBe("developer-id");
  });

  it("stores callback sessions", async () => {
    const vault = new CredentialVault(createSecureStore());
    const manager = new AuthSessionManager(vault);

    await manager.storeSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      developerId: "developer-id",
    });

    expect(manager.getStatus()).toBe("authenticated");
    expect(await vault.getAccessToken()).toBe("access-token");
    expect(await vault.getRefreshToken()).toBe("refresh-token");
    expect(await vault.getDeveloperId()).toBe("developer-id");
  });

  it("refreshes expired access tokens during startup", async () => {
    const vault = new CredentialVault(createSecureStore());
    await vault.setAccessToken(createUnsignedJwt({ exp: 1 }));
    await vault.setRefreshToken("refresh-token");
    const manager = new AuthSessionManager(vault, {
      async loginWithGoogle() {
        throw new Error("not used");
      },
      async refresh(refreshToken) {
        expect(refreshToken).toBe("refresh-token");
        return { accessToken: "fresh-access-token" };
      },
      async redeemAuthCode() {
        throw new Error("not used");
      },
    });

    await manager.start();

    expect(manager.getStatus()).toBe("authenticated");
    expect(await vault.getAccessToken()).toBe("fresh-access-token");
  });

  it("marks session expired when startup refresh fails", async () => {
    const vault = new CredentialVault(createSecureStore());
    await vault.setAccessToken(createUnsignedJwt({ exp: 1 }));
    await vault.setRefreshToken("refresh-token");
    const manager = new AuthSessionManager(vault, {
      async loginWithGoogle() {
        throw new Error("not used");
      },
      async refresh() {
        throw new Error("refresh failed");
      },
      async redeemAuthCode() {
        throw new Error("not used");
      },
    });

    await manager.start();

    expect(manager.getStatus()).toBe("expired");
  });

  it("redeems a one-time code and stores the session", async () => {
    const vault = new CredentialVault(createSecureStore());
    const manager = new AuthSessionManager(vault, {
      async loginWithGoogle() {
        throw new Error("not used");
      },
      async refresh() {
        throw new Error("not used");
      },
      async redeemAuthCode(code) {
        expect(code).toBe("one-time-code");
        return {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          developerId: "developer-id",
          role: "developer",
        };
      },
    });

    const result = await manager.redeemSession("one-time-code");

    expect(result.developerId).toBe("developer-id");
    expect(manager.getStatus()).toBe("authenticated");
    expect(await vault.getAccessToken()).toBe("access-token");
    expect(await vault.getRefreshToken()).toBe("refresh-token");
    expect(await vault.getDeveloperId()).toBe("developer-id");
  });

  it("clears credentials on logout", async () => {
    const vault = new CredentialVault(createSecureStore());
    await vault.setAccessToken("access-token");
    await vault.setRefreshToken("refresh-token");
    const manager = new AuthSessionManager(vault);

    await manager.logout();

    expect(manager.getStatus()).toBe("logged_out");
    expect(await vault.getAccessToken()).toBeUndefined();
    expect(await vault.getRefreshToken()).toBeUndefined();
  });

  it("hasStoredCredentials reflects the vault without mutating auth status", async () => {
    const vault = new CredentialVault(createSecureStore());
    const manager = new AuthSessionManager(vault);

    expect(await manager.hasStoredCredentials()).toBe(false);
    expect(manager.getStatus()).toBe("unauthenticated"); // read-only — safe before start()

    await vault.setRefreshToken("refresh-token");
    expect(await manager.hasStoredCredentials()).toBe(true);
    expect(manager.getStatus()).toBe("unauthenticated"); // still not mutated

    await manager.logout();
    expect(await manager.hasStoredCredentials()).toBe(false);
  });

  it("signs out and notifies (no spam) when the refresh token is rejected with 401", async () => {
    const vault = new CredentialVault(createSecureStore());
    await vault.setRefreshToken("dead-refresh-token");
    let refreshCalls = 0;
    let expiredNotified = 0;
    const manager = new AuthSessionManager(
      vault,
      {
        async loginWithGoogle() {
          throw new Error("not used");
        },
        async refresh() {
          refreshCalls += 1;
          throw Object.assign(new Error("Unauthorized"), { status: 401 });
        },
        async redeemAuthCode() {
          throw new Error("not used");
        },
      },
      () => {
        expiredNotified += 1;
      },
    );

    const result = await manager.refreshAccessToken();

    expect(result).toBeUndefined(); // resolves, does not throw → callers stop, no retry spam
    expect(manager.getStatus()).toBe("logged_out");
    expect(await vault.getRefreshToken()).toBeUndefined(); // dead token cleared
    expect(expiredNotified).toBe(1); // user prompted exactly once

    // A subsequent refresh has no token → returns immediately without hitting the API again.
    await manager.refreshAccessToken();
    expect(refreshCalls).toBe(1);
  });

  it("keeps the session for a transient (5xx) refresh failure", async () => {
    const vault = new CredentialVault(createSecureStore());
    await vault.setRefreshToken("refresh-token");
    const manager = new AuthSessionManager(vault, {
      async loginWithGoogle() {
        throw new Error("not used");
      },
      async refresh() {
        throw Object.assign(new Error("Server error"), { status: 503 });
      },
      async redeemAuthCode() {
        throw new Error("not used");
      },
    });

    await expect(manager.refreshAccessToken()).rejects.toThrow();
    expect(manager.getStatus()).toBe("expired");
    expect(await vault.getRefreshToken()).toBe("refresh-token"); // kept for a later retry
  });
});

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

function createSecureStore() {
  const values = new Map<string, string>();

  return {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
}
