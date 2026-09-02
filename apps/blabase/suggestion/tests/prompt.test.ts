import { describe, expect, it } from "vitest";

import { buildTaskCandidatePrompt } from "../src/prompt";
import { TASK_CANDIDATE_PROMPT_VERSION } from "../src/versions";
import { conversationFixture } from "./helpers";

describe("task candidate prompt", () => {
  it("requires terminal state preservation and rejects uncommitted planning", () => {
    const result = buildTaskCandidatePrompt(
      conversationFixture(),
      "2026-08-21T00:00:00.000Z"
    );

    expect(result.prompt).toContain(
      `Prompt contract: ${TASK_CANDIDATE_PROMPT_VERSION}.`
    );
    expect(result.prompt).toContain(
      "completed, cancelled, or replaced update in the separate stateSignals array"
    );
    expect(result.prompt).toContain(
      "undecided alternative, passive view, or possible future direction is not a task"
    );
    expect(result.prompt).toContain(
      "including the full ISO timestamp when present"
    );
  });
});
