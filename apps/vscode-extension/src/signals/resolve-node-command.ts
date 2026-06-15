import { execSync } from "node:child_process";

export function resolveNodeCommand(): string {
  try {
    const command = process.platform === "win32" ? "where node" : "which node";
    const output = execSync(command, {
      encoding: "utf8",
      env: process.env,
    }).trim();
    const firstLine = output.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (firstLine) {
      return firstLine.trim();
    }
  } catch {
    // Fall back to the Node binary running the extension host.
  }

  return process.execPath;
}
