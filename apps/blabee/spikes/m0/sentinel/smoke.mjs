#!/usr/bin/env node
import { parseSentinelOnce } from "./parser.mjs";

try {
  process.stdin.setEncoding("utf8");
  let inputText = "";
  for await (const chunk of process.stdin) inputText += chunk;
  const proposal = parseSentinelOnce(inputText);
  process.stdout.write(`${JSON.stringify({ matched: proposal !== null, proposal })}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
