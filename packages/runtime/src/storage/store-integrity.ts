import { createHmac, randomBytes } from "node:crypto";

import type { SecureStore } from "../secure-store";
import { LOCAL_STORE_INTEGRITY_KEY } from "./local-store-keys";

export interface IntegrityKeyProvider {
  getIntegrityKey(): Promise<string>;
}

export interface SignedRecord<T = unknown> {
  data: T;
  mac: string;
}

export function computeStoreMac(integrityKey: string, data: unknown): string {
  const payload = JSON.stringify(data);
  return createHmac("sha256", integrityKey).update(payload).digest("base64url");
}

export function isSignedRecord(value: unknown): value is SignedRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<SignedRecord>;
  return "data" in record && typeof record.mac === "string";
}

export class SecureStoreIntegrityKeyProvider implements IntegrityKeyProvider {
  constructor(private readonly secureStore: SecureStore) {}

  async getIntegrityKey(): Promise<string> {
    const existing = await this.secureStore.get(LOCAL_STORE_INTEGRITY_KEY);
    if (existing) {
      return existing;
    }

    const generated = randomBytes(32).toString("base64url");
    await this.secureStore.store(LOCAL_STORE_INTEGRITY_KEY, generated);
    return generated;
  }
}
