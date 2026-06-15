import type { SecureStore } from "../secure-store";

const ACCESS_TOKEN_KEY = "runtimeads.access_token";
const REFRESH_TOKEN_KEY = "runtimeads.refresh_token";
const DEVELOPER_ID_KEY = "runtimeads.comeloper_id";

export class CredentialVault {
  constructor(private readonly store: SecureStore) {}

  async setAccessToken(token: string): Promise<void> {
    await this.store.store(ACCESS_TOKEN_KEY, token);
  }

  async getAccessToken(): Promise<string | undefined> {
    return this.store.get(ACCESS_TOKEN_KEY);
  }

  async setRefreshToken(token: string): Promise<void> {
    await this.store.store(REFRESH_TOKEN_KEY, token);
  }

  async getRefreshToken(): Promise<string | undefined> {
    return this.store.get(REFRESH_TOKEN_KEY);
  }

  async setDeveloperId(developerId: string): Promise<void> {
    await this.store.store(DEVELOPER_ID_KEY, developerId);
  }

  async getDeveloperId(): Promise<string | undefined> {
    return this.store.get(DEVELOPER_ID_KEY);
  }

  async clearCredentials(): Promise<void> {
    await Promise.all([
      this.store.delete(ACCESS_TOKEN_KEY),
      this.store.delete(REFRESH_TOKEN_KEY),
      this.store.delete(DEVELOPER_ID_KEY),
    ]);
  }
}
