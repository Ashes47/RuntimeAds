import Mocha from "mocha";
import path from "node:path";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    color: true,
    ui: "bdd",
  });

  for (const fileName of [
    "extension.test.js",
    "claude-code-patcher.test.js",
    "codex-patcher.test.js",
    "terminal-hook-installer.test.js",
    "remove-terminal-hooks.test.js",
  ]) {
    mocha.addFile(path.resolve(__dirname, fileName));
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension tests failed`));
        return;
      }

      resolve();
    });
  });
}
