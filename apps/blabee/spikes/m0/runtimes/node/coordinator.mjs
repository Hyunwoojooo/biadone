import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on("line", (line) => {
  let request;

  try {
    request = JSON.parse(line);
  } catch {
    reply({ ok: false, error: "invalid_json", protocol_version: 1 });
    return;
  }

  if (request?.method !== "health") {
    reply({ ok: false, error: "unsupported_method", protocol_version: 1 });
    return;
  }

  reply({ ok: true, runtime: "node", protocol_version: 1 });
});
