# State Note v3 implementation record

Date: 2026-08-03
Schema: `gptmemory.state-note.v3`
Engine: `gptmemory-note-state.v3`
Prompt: `gptmemory-state-prompt.v3`

## Product change

The default generated artifact changed from a topic-oriented compressed summary to a
current-state note. The note answers what is valid now, what the user confirmed, what
was completed, and what remains open. Existing v1 and v2 notes are not migrated.

## Pipeline

```text
sanitized conversation
→ Gemini Structured Output with atomic StateEvent candidates
→ evidence ID, message role and ordering validation
→ deterministic lifecycle ledger fold
→ current-state projection
→ strict v3 parser
→ conditional D1 write
```

Long conversations are split into message chunks. Chunks produce event batches rather
than prose partial summaries, and validated batches are folded in original message
order. Up to three chunks are processed concurrently by default.

## Enforced invariants

- Assistant-only proposals cannot become confirmed decisions.
- Confirmed decision text is anchored to an explicit user clause, or to an accepted
  proposal plus the user's acceptance evidence.
- Open-action text is anchored to the exact user request rather than a model paraphrase.
- Fulfilled, cancelled and superseded requests do not remain in `openActions`.
- Unsupported owner, due date and artifact locator metadata is removed.
- Every public item has source message IDs and bounded evidence snippets from the
  request-specific evidence catalog.
- Malformed output, invalid evidence, provider failure and stale replacement fail before
  the existing note is changed.
- The public state-note text budget is at most 1,200 characters.

## Automated verification

The state-engine tests cover:

- fulfilled request → completed result, not an open action;
- Assistant proposal → proposal, not decision/action;
- exact user request publication and supported owner/due metadata;
- later user correction superseding an earlier decision;
- invalid stored evidence rejection;
- provider timeout classification without credential leakage;
- v3 import metadata and atomic storage;
- v1/v2/v3 read compatibility and malformed-v3 fallback;
- v3 list/detail UI source contract.

Final local checks on 2026-08-03:

- `npm test`: 100 passed, 1 environment-dependent loopback test skipped;
- `npm run typecheck`: passed;
- `npm run lint`: passed without warnings;
- `npm run build`: passed.

## End-to-end smoke test

A supplied public ChatGPT share URL completed the local fetch → Gemini → validation →
D1 path with HTTP 201 in about 10.7 seconds after concurrent chunk processing was
enabled. The response used `gptmemory.state-note.v3`; the temporary local note was then
moved to Trash and permanently deleted.

## Remaining evaluation work

This implementation is structurally complete, but product-quality acceptance still
requires human references for the existing 12 Golden conversations. In particular:

- annotate expected final decisions, completed requests, open requests, unresolved
  questions and superseded directions;
- measure completed-request/open-action confusion and proposal/decision confusion;
- compare different chunk boundaries for the same long conversation;
- verify Korean output consistency after the added primary-language hint;
- measure median time-to-resume with users;
- visually inspect desktop and mobile layouts in an available browser session.

Until those checks pass, v3 should be treated as the new local default with
`GPTMEMORY_GENERATION_MODE=summary-v2` retained as the operational rollback.
