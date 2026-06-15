import type { Platform } from "@runtimeads/sdk-contracts";

import type { KeyValueStore } from "../storage/key-value-store";

const INSTALL_ID_KEY = "runtimeads.install_id";

export interface InstallRegistrationClient {
  registerInstall(request: InstallRegistrationRequest): Promise<void>;
}

export interface InstallRegistrationRequest {
  installId: string;
  platform: Platform;
  sdkVersion: string;
  os?: string;
  timezone?: string;
  extensionId?: string;
  extensionVersion?: string;
  publisher?: string;
}

export interface InstallManagerOptions {
  platform: Platform;
  sdkVersion: string;
  store: KeyValueStore;
  idFactory?: () => string;
  os?: string;
  // P1-20: IANA timezone from the host (e.g. Intl.DateTimeFormat().resolvedOptions().timeZone).
  timezone?: string;
  registrationClient?: InstallRegistrationClient;
  // P1-25 extension version gate metadata (from the host extension's manifest).
  extensionId?: string;
  extensionVersion?: string;
  publisher?: string;
}

export class InstallManager {
  private installId: string | undefined;
  private newlyProvisioned = false;

  constructor(private readonly options: InstallManagerOptions) {}

  async start(): Promise<void> {
    await this.ensureInstallId();
  }

  async ensureInstallId(): Promise<string> {
    if (this.installId) {
      return this.installId;
    }

    const storedInstallId = await this.options.store.get<string>(INSTALL_ID_KEY);
    if (storedInstallId) {
      this.installId = storedInstallId;
      return storedInstallId;
    }

    const installId = this.options.idFactory?.() ?? createInstallId();
    await this.options.store.set(INSTALL_ID_KEY, installId);
    this.installId = installId;
    this.newlyProvisioned = true;
    return installId;
  }

  consumeNewInstallEvent(): boolean {
    const wasNew = this.newlyProvisioned;
    this.newlyProvisioned = false;
    return wasNew;
  }

  /** Forget the persisted install identity so a later start() provisions a fresh one. */
  async clearStoredInstall(): Promise<void> {
    await this.options.store.delete(INSTALL_ID_KEY);
    this.installId = undefined;
    this.newlyProvisioned = false;
  }

  async registerInstall(): Promise<void> {
    const installId = await this.ensureInstallId();
    await this.options.registrationClient?.registerInstall({
      installId,
      platform: this.options.platform,
      sdkVersion: this.options.sdkVersion,
      ...(this.options.os ? { os: this.options.os } : {}),
      ...(this.options.timezone ? { timezone: this.options.timezone } : {}),
      ...(this.options.extensionId ? { extensionId: this.options.extensionId } : {}),
      ...(this.options.extensionVersion ? { extensionVersion: this.options.extensionVersion } : {}),
      ...(this.options.publisher ? { publisher: this.options.publisher } : {}),
    });
  }

  getInstallId(): string | undefined {
    return this.installId;
  }
}

function createInstallId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  throw new Error("No UUID generator available for install identity");
}
