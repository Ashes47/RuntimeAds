import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(extensionRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const destinationDir = path.join(extensionRoot, "dist");
const destination = path.join(destinationDir, "sql-wasm.wasm");

await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);
