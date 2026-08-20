#!/usr/bin/env node
import { requestJsonl } from "./jsonl-client.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--socket") result.socketPath = argv[++index];
    else if (arg === "--type") result.type = argv[++index];
    else if (arg === "--payload") result.payloadText = argv[++index];
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (!result.socketPath) throw new Error("--socket is required");
  if (!result.type) throw new Error("--type is required");
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let payloadText = args.payloadText;
  if (payloadText === undefined) {
    process.stdin.setEncoding("utf8");
    payloadText = "";
    for await (const chunk of process.stdin) payloadText += chunk;
  }
  const payload = payloadText.trim() ? JSON.parse(payloadText) : {};
  const result = await requestJsonl({
    socketPath: args.socketPath,
    type: args.type,
    payload,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "request_failed"}: ${error.message}\n`);
  process.exitCode = 1;
});
