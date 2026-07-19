# Golden Dataset Quality v1 — Engine Change Record

- Date: 2026-07-20
- Owner: Nika (product), Codex (implementation)
- Goal: Detect structural Golden Dataset errors and review candidates before
  an evaluation spends model calls or publishes misleading metrics.
- Affected pipeline stages: Golden input validation, baseline preflight,
  evaluation manifest, developer CLI.
- Behavior before: The baseline runner checked only the dataset version,
  approval state, selected session, and fixed prompt/summary counts.
- Behavior after: A deterministic validator reports identity, relationship,
  scope, approval, empty-field, cancellation, and pending-review issues. Errors
  stop the baseline before LLM calls; warnings remain non-blocking by default.
- Versions before: No standalone Golden data-quality version.
- Versions after: `golden-quality-v1`.
- Code commit: Implementation working tree is based on `f27ab30`; the final
  implementation commit is the commit that introduces this record.
- Evaluation dataset version and SHA-256: `gold-core-v0.1`; Gold snapshot
  SHA-256 `f02a650d2e78bb605ae8b068d224d454aa5808aff61f72073eb5f2f3266ae672`.
- Candidate run ID: Not applicable; the checker makes no model call.
- Comparison run ID: Not applicable; semantic extraction output is unchanged.
- Commands executed:
  - `npm run golden:validate -- --input .local/golden-v01-input.json --output .local/golden-v01-quality.json`
  - `npm run golden:validate -- --input .local/golden-v01-input.json --fail-on-warning`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- Metrics changed: No engine quality metric changed. The current input produces
  0 errors and 14 warnings across 14 records: 6 cancelled-input prompt rows, 4
  empty summary fields, and 4 pending author judgments.
- Regressions or accepted exceptions: Existing review candidates remain in the
  frozen v0.1 input. They are warnings until human review establishes a policy.
- Privacy or retention impact: The report stores identifiers, fields, codes,
  counts, and sanitized explanations. It does not copy Gold text or share URLs.
  Full reports remain in ignored `.local/` storage unless explicitly redacted.
- Release decision: Enable as a baseline preflight. Fail on structural errors.
  Keep warnings non-blocking for routine development; use `--fail-on-warning`
  when a clean-data release gate is required.
- Rollback method: Remove the baseline preflight call and the
  `golden:validate` package script. Dataset content does not need rollback.
- Follow-up work: Human review of the 14 warnings is intentionally deferred.
  Add quality-report visibility to the future read-only Golden dashboard.
