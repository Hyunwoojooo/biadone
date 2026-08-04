# Content Note v4 evaluation draft record

- Date: 2026-08-04
- Scope: `apps/gptmemory/evals/golden-notes`
- Artifact class: semantic Teacher drafts for a topic-centered v4 note
- Approval state: pending human review
- Automated scoring: prohibited

## Purpose

The existing `teacher-draft.md` files preserve the chronological evolution of each
conversation well, but they are too long to serve directly as the target for the
content-first v4 note. The v4 draft set selects the most reusable content first while
retaining enough topic-level reasoning to resume work without reopening the transcript.
It then separates confirmed decisions, explicit next actions, unresolved questions,
actual artifacts, active proposals, and important constraints.

The intended reading order is:

```text
한눈에 보기
→ 핵심 정리
→ 주제별 정리
→ 결론·확정 결정
→ 다음 할 일
→ 남은 질문
→ 보조 정보
```

This follows the product rule: **content first, state second, evidence on demand**.
The legacy Teacher drafts remain unchanged and continue to be the fuller account of
conversation flow and correction history.

## Evidence and approval boundary

These Markdown files are semantic drafts only.

- `sourceMessageIds` have **not** been assigned.
- The source conversations have not been re-aligned against these individual claims.
- No draft has completed human review.
- No draft is a `human_reference`, `active_eval_case`, or machine-scoreable Golden target.
- The current `manifest.json`, case status, `humanReview.referencePath`, and legacy
  Teacher metadata intentionally remain unchanged.
- The drafts must not be used for automated pass/fail scores, prompt ranking, release
  gates, or claims about v4 quality.

The lack of evidence IDs is explicit in every draft. IDs must not be guessed from
message order or reconstructed from the legacy prose.

## Draft inventory

| Case | Draft | State |
|---|---|---|
| `saber-aaai27-001` | `cases/saber-aaai27-001/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `mac-mini-cross-migration-002` | `cases/mac-mini-cross-migration-002/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `remote-dev-ghostty-codex-003` | `cases/remote-dev-ghostty-codex-003/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `nuvin-ai-learning-service-004` | `cases/nuvin-ai-learning-service-004/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `playmcp-codex-remote-control-005` | `cases/playmcp-codex-remote-control-005/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `delay-tolerant-grasp-research-006` | `cases/delay-tolerant-grasp-research-006/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `world-action-model-research-007` | `cases/world-action-model-research-007/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `rl-adaptation-business-008` | `cases/rl-adaptation-business-008/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `pieces-personal-memory-os-009` | `cases/pieces-personal-memory-os-009/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `blabase-incremental-memory-architecture-010` | `cases/blabase-incremental-memory-architecture-010/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `note-service-video-research-011` | `cases/note-service-video-research-011/teacher-content-draft-v4.md` | source IDs missing; human review pending |
| `llm-context-acquisition-preference-012` | `cases/llm-context-acquisition-preference-012/teacher-content-draft-v4.md` | source IDs missing; human review pending |

The alternate Delay-Tolerant Grasp Teacher draft remains an alternate capture and
does not create a thirteenth case.

## Human approval procedure

Each draft must pass the following steps before promotion:

1. Restore the configured public share and apply the existing source-index cutoff so
   Teacher prompt and response turns remain excluded.
2. Verify source message count and a pinned canonical digest. Stop if the source has
   drifted.
3. Compare every sentence and bullet with the sanitized cutoff conversation and the
   legacy `teacher-draft.md` evaluation guide.
4. Remove low-value detail, duplication, unsupported synthesis, and accidental status
   language while preserving the central explanation and material direction changes.
5. Label user-confirmed decisions separately from Assistant proposals. Do not convert
   a completed answer into an artifact or an unaccepted suggestion into a next action.
6. Assign non-empty `sourceMessageIds` from the actual sanitized input to every public
   semantic item. Verify that every ID is an input subset and supports the full claim.
7. Record reviewer corrections, reviewer identity, date, and decision in a dedicated
   v4 review artifact.
8. Convert the approved content into the strict structured v4 reference format and
   only then update case metadata and dataset version.
9. Run schema, evidence, authority, privacy, compatibility, and no-teacher-leak tests.
10. Only an approved structured reference may participate in automated semantic
    scoring or release gates.

## Review criteria

A human reviewer should check:

- important explanatory content is present, not only lifecycle state;
- the top summary and topics can be understood without rereading the transcript;
- topic boundaries are meaningful and do not merely mirror every turn;
- repeated facts are compressed rather than copied into several sections;
- the glance and takeaway layers stay concise while topic bodies retain the reasoning,
  comparisons, conditions, examples, and design detail needed to resume work;
- detail adapts to the source: short conversations are not padded and long research or
  planning conversations are not forced into a fixed 2,400-character body;
- user corrections and changes of direction remain visible;
- conclusions, decisions, proposals, unfinished work, and artifacts are not confused;
- unanswered questions and genuinely open user requests remain open;
- unsupported owner, due date, completion, implementation, or adoption claims are absent;
- the compact draft does not contradict the legacy evaluation guide;
- every final structured item has valid, sufficient evidence IDs.

## Product implementation status

The application now writes new imports as `gptmemory.content-note.v4` by default.
The v4 runtime keeps content planning and lifecycle state extraction separate, then
combines only their validated outputs. Existing v1, v2, and v3 notes remain readable;
no database migration or automatic note conversion is required.

The target product contract includes:

- three to five key takeaways and one to five adaptive topics;
- a 1,200-character quick-read budget and adaptive primary-content budgets: roughly
  1,500–3,000 characters for short conversations, 3,000–5,000 for ordinary exploration
  or planning, and 5,000–8,000 for long research or product-design conversations;
- topic bodies that may use three to seven content blocks, with two to four sentences
  per block when the source contains enough material;
- cross-layer deduplication: takeaways index the topics, topics provide the explanation,
  and conclusions contain only genuinely derived conclusions rather than a third recap;
- conditional current-state language, omitted for research or learning conversations
  unless implementation, experimentation, submission, or another genuine state change
  is evidenced;
- deterministic evidence-ID materialization and stored-payload validation;
- decisions, open actions, unresolved questions, proposals, constraints, and actual
  artifacts from the existing validated state ledger;
- content-first list and detail rendering with evidence and legacy flow collapsed;
- conditional replacement that preserves legacy edits and leaves the old row unchanged
  on provider, validation, timeout, rate-limit, or stale-write failure.

One local live-import smoke check created a v4 note through the ChatGPT share adapter and
Gemini provider, verified non-empty evidence for every public semantic item, and removed
the temporary note immediately afterward. This is an integration check, not a human
quality score for the 12 draft references.

## Current limitations

- The files are Markdown previews, not the final Structured Output schema.
- Their visible length is a drafting aid and is not yet a validated UI character budget.
- Adaptive budgets are guardrails, not targets; drafts must not be padded to reach them.
- No inter-annotator review or user comprehension test has been performed.
- The existing Golden runner evaluates the deterministic legacy note and does not score
  these drafts.
- Because the legacy references are also unapproved Teacher drafts, agreement with them
  alone is not sufficient for promotion.
