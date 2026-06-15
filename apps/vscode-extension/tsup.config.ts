import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts", "src/uninstall.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  external: ["vscode"],
  noExternal: ["@runtimeads/runtime", "@runtimeads/sdk-contracts", "sql.js"],
  clean: true,
  sourcemap: false,
  dts: false,
  outDir: "dist",
  outExtension() {
    return {
      js: ".cjs",
    };
  },
});
