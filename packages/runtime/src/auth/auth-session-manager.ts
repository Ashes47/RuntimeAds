import { CredentialVault } from "./credential-vault";
import { isJwtExpired } from "./jwt-utils";

export type AuthStatus =
  | "unauthenticated"
  | "authenticated"
  | "expired"
  | "refreshing"
  | "logged_out";

export interface AuthClient {
  loginWithGoogle(googleToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: {
      id: string;
      email: string;
      role: string;
    };
  }>;
  refresh(refreshToken: string): Promise<{ accessToken: string }>;
  redeemAuthCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    developerId: string;
    role: string;
  }>;
}

export class AuthSessionManager {
  private status: AuthStatus = "unauthenticated";

  constructor(
    private readonly vault: CredentialVault,
    private readonly client?: AuthClient,
    // Invoked once when the refresh token is definitively rejected (the session is over and
    // the user must sign in again). The host wires this to a "sign in again" prompt.
    private readonly onSessionExpired?: () => void,
  ) {}

  async start(): Promise<void> {
    const accessToken = await this.vault.getAccessToken();
    const refreshToken = await this.vault.getRefreshToken();

    if (accessToken && !isJwtExpired(accessToken)) {
      this.status = "authenticated";
      return;
    }

    if (accessToken && isJwtExpired(accessToken) && refreshToken && this.client) {
      try {
        await this.refreshAccessToken();
        return;
      } catch {
        this.status = "expired";
        return;
      }
    }

    if (accessToken && isJwtExpired(accessToken)) {
      this.status = refreshToken ? "expired" : "unauthenticated";
      return;
    }

    this.status = refreshToken ? "expired" : "unauthenticated";
  }

  getStatus(): AuthStatus {
    return this.status;
  }

  async loginWithGoogle(googleToken: string): Promise<void> {
    if (!this.client) {
      throw new Error("Auth client is not configured");
    }

    const response = await this.client.loginWithGoogle(googleToken);
    await this.vault.setAccessToken(response.accessToken);
    await this.vault.setRefreshToken(response.refreshToken);
    await this.vault.setDeveloperId(response.user.id);
    this.status = "authenticated";
  }

  /**
   * Exchange a one-time OAuth callback code for tokens, persist the session, and return
   * the developer id so callers can attribute follow-up telemetry.
   */
  async redeemSession(code: string): Promise<{ developerId: string }> {
    if (!this.client) {
      throw new Error("Auth client is not configured");
    }

    const session = await this.client.redeemAuthCode(code);
    await this.storeSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      developerId: session.developerId,
    });
    return { developerId: session.developerId };
  }

  async storeSession(session: {
    accessToken: string;
    refreshToken: string;
    developerId: string;
  }): Promise<void> {
    await this.vault.setAccessToken(session.accessToken);
    await this.vault.setRefreshToken(session.refreshToken);
    await this.vault.setDeveloperId(session.developerId);
    this.status = "authenticated";
  }

  async getAccessToken(): Promise<string | undefined> {
    return this.vault.getAccessToken();
  }

  /**
   * True if any credential is still persisted in the vault (access OR refresh token). Read-only —
   * does NOT mutate auth status, so it is safe to call before `start()`. Used by the host at
   * activation to detect stale keychain credentials left behind by a prior install: the
   * `vscode:uninstall` hook wipes `~/.runtimeads` but can't reach SecretStorage, so a reinstall
   * would otherwise resurrect a dead session.
   */
  async hasStoredCredentials(): Promise<boolean> {
    const [accessToken, refreshToken] = await Promise.all([
      this.vault.getAccessToken(),
      this.vault.getRefreshToken(),
    ]);
    return Boolean(accessToken || refreshToken);
  }

  async refreshAccessToken(): Promise<string | undefined> {
    const refreshToken = await this.vault.getRefreshToken();
    if (!refreshToken || !this.client) {
      this.status = refreshToken ? "expired" : "unauthenticated";
      return undefined;
    }

    this.status = "refreshing";

    try {
      const response = await this.client.refresh(refreshToken);
      await this.vault.setAccessToken(response.accessToken);
      this.status = "authenticated";
      return response.accessToken;
    } catch (error) {
      // A 401/403 means the refresh token itself is rejected — the session is permanently
      // over. Clear credentials so nothing keeps retrying with a dead token (the refresh
      // spam), mark logged out, and prompt the user to sign in again. Transient failures
      // (network/5xx) just mark "expired" and leave the token for a later retry.
      const status = (error as { status?: number } | null | undefined)?.status;
      if (status === 401 || status === 403) {
        await this.vault.clearCredentials();
        this.status = "logged_out";
        this.onSessionExpired?.();
        return undefined;
      }
      this.status = "expired";
      throw error;
    }
  }

  async logout(): Promise<void> {
    await this.vault.clearCredentials();
    this.status = "logged_out";
  }
}
