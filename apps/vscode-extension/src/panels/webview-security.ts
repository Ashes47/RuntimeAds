import { randomBytes } from "node:crypto";

export function createWebviewNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function buildWebviewCsp(webviewCspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${webviewCspSource} https:`,
    `font-src ${webviewCspSource}`,
    `style-src ${webviewCspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
}

export function buildStaticWebviewCsp(webviewCspSource: string): string {
  return `default-src 'none'; style-src ${webviewCspSource} 'unsafe-inline'`;
}
