import path from "node:path";

import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = path.resolve(__dirname, "../../");
const extensionTestsPath = path.resolve(__dirname, "./suite/index.js");

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_IPC_HOOK;
delete process.env.VSCODE_ESM_ENTRYPOINT;

async function main(): Promise<void> {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    version: "1.100.0",
    launchArgs: ["--disable-extensions"],
  });
}

void main();
