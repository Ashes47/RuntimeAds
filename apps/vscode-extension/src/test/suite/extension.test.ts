import assert from "node:assert/strict";
import { suite, test } from "mocha";
import * as vscode from "vscode";

suite("RuntimeAds extension", () => {
  test("activates and registers commands", async () => {
    const extension = vscode.extensions.getExtension("runtimeads.runtimeads");
    assert.ok(extension, "RuntimeAds extension should be discoverable");

    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("runtimeads.login"));
    assert.ok(commands.includes("runtimeads.logout"));
    assert.ok(commands.includes("runtimeads.openDashboard"));
    assert.ok(commands.includes("runtimeads.openMenu"));
    assert.ok(commands.includes("runtimeads.showDiagnostics"));
  });
});
