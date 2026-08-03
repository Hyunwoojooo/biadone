import { resolve } from "node:path";

import { resolveAttentionCodeProvenance } from "../src/attention/codeProvenance";

const requestedRoot = process.argv[2];
if (!requestedRoot) {
  throw new Error("Launcher source root is required.");
}

const provenance = await resolveAttentionCodeProvenance(
  resolve(requestedRoot),
  process.env
);
if (provenance.codeState === "unavailable") {
  throw new Error(
    "Launcher code provenance is unavailable; provide BLABASE_CODE_COMMIT_SHA or BLABASE_CODE_FINGERPRINT_SHA256."
  );
}

process.stdout.write(`${JSON.stringify(provenance)}\n`);
