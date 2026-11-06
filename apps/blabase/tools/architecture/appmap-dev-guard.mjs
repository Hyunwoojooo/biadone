console.error(
  [
    "arch:trace:dev is intentionally disabled.",
    "AppMap's HTTP recorder can capture request and response bodies, including real shared conversations.",
    "Use `npm run arch:trace:test` for the deterministic synthetic fixture trace.",
    "Enable an interactive trace only after a synthetic-only server or harness exists and is reviewed."
  ].join("\n")
);

process.exitCode = 2;
