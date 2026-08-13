import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Semantic validation HTTP isolation", () => {
  it("keeps the CLI producer unreachable from browser GET, POST, and client code", async () => {
    const files = [
      "app/api/work-board/route.ts",
      "app/api/work-board/intent/route.ts",
      "app/api/continuation/route.ts",
      "app/attentionClient.ts",
      "app/continuationClient.ts",
      "app/attention-lab/AttentionLab.tsx",
      "src/suggestionBoard/liveShadow.ts"
    ];
    for (const file of files) {
      const source = await readFile(resolve(process.cwd(), file), "utf8");
      expect(source).not.toContain("node:child_process");
      expect(source).not.toContain("validation/producer");
      expect(source).not.toContain("runSemanticContinuationValidation");
      expect(source).not.toContain("semantic-validation");
    }
  });

  it("keeps the validation process runner argument-free, non-shell, and output-discarding", async () => {
    const [producer, cli] = await Promise.all([
      readFile(
        resolve(
          process.cwd(),
          "src/semanticContinuation/validation/producer.ts"
        ),
        "utf8"
      ),
      readFile(
        resolve(process.cwd(), "tools/run-semantic-validation.ts"),
        "utf8"
      )
    ]);

    expect(producer).toContain("shell: false");
    expect(producer).toContain(
      'stdio: ["ignore", "ignore", "ignore"]'
    );
    expect(producer).not.toMatch(/exec(?:File)?\s*\(/u);
    expect(cli).toContain("process.argv.slice(2).length > 0");
    expect(cli).toContain("SEMANTIC_VALIDATION_ARGUMENTS_NOT_ALLOWED");
  });
});
