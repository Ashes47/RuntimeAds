import { describe, expect, it } from "vitest";

import { CredentialVault } from "./credential-vault";

describe("CredentialVault", () => {
  it("stores and clears credentials through the secure store boundary", async () => {
    const values = new Map<string, string>();
    const vault = new CredentialVault({
      get: async (key) => values.get(key),
      store: async (key, value) => {
        values.set(key, value);
      },
      delete: async (key) => {
        values.delete(key);
      },
    });

    await vault.setAccessToken("access-token");
    await vault.setRefreshToken("refresh-token");
    await vault.setDeveloperId("developer-id");

    expect(await vault.getAccessToken()).toBe("access-token");
    expect(await vault.getRefreshToken()).toBe("refresh-token");
    expect(await vault.getDeveloperId()).toBe("developer-id");

    await vault.clearCredentials();

    expect(await vault.getAccessToken()).toBeUndefined();
    expect(await vault.getRefreshToken()).toBeUndefined();
    expect(await vault.getDeveloperId()).toBeUndefined();
  });
});
