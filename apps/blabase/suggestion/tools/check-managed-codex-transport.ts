import { fileURLToPath } from "node:url";

import { openCodexAppServerWebSocket } from "../src/connectors/codex/appServerWebSocket";
import { resolveCodexBinary } from "../src/connectors/codex/config";

const SUGGESTION_ROOT = fileURLToPath(
  new URL("../", import.meta.url)
).replace(/\/+$/, "");

await main().catch((error: unknown) => {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "UNEXPECTED_ERROR";
  process.stderr.write(`Managed Codex transport check failed: ${code}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const binary = await resolveCodexBinary();
  if (!binary.ok) {
    throw Object.assign(new Error("Codex binary unavailable."), {
      code: "CODEX_UNAVAILABLE"
    });
  }

  const session = await openCodexAppServerWebSocket({
    binaryPath: binary.binaryPath,
    cwd: SUGGESTION_ROOT,
    initializeCapabilities: {
      optOutNotificationMethods: ["item/agentMessage/delta"]
    }
  });
  try {
    process.stdout.write(
      "Managed Codex loopback App Server initialized successfully.\n"
    );
  } finally {
    await session.close();
  }
}
