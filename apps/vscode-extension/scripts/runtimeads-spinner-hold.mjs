const holdMs = Number(process.argv[2] ?? process.env.RUNTIMEADS_SPINNER_HOLD_MS ?? "1500");
if (!Number.isFinite(holdMs) || holdMs < 0) {
  process.exit(0);
}

await readStdin();
await new Promise((resolve) => setTimeout(resolve, holdMs));
process.exit(0);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
}
