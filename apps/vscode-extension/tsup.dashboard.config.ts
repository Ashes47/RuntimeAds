import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  entry: {
    dashboard: "src/dashboard/main.tsx",
  },
  format: ["iife"],
  platform: "browser",
  target: "es2022",
  outDir: "dist/dashboard",
  outExtension() {
    return { js: ".js" };
  },
  globalName: "RuntimeAdsDashboardBundle",
  clean: true,
  sourcemap: false,
  dts: false,
  minify: true,
  loader: {
    ".css": "text",
  },
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.define = {
      ...options.define,
      "process.env.NODE_ENV": JSON.stringify("production"),
    };
  },
  onSuccess: async () => {
    await mkdir(path.join(extensionRoot, "dist", "dashboard"), { recursive: true });
    await copyFile(
      path.join(extensionRoot, "src", "dashboard", "dashboard.css"),
      path.join(extensionRoot, "dist", "dashboard", "dashboard.css"),
    );
  },
});
