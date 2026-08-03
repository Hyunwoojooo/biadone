# Compressed Summary v2 implementation record

- Date: 2026-08-02
- Scope: `apps/gptmemory`
- Schema: `gptmemory.summary.v2`
- Provider: Google Gemini Interactions API
- Default model: `gemini-3.1-flash-lite` (server configurable)

## Product change

The default result for a new ChatGPT share import is no longer the full
chronological reconstruction. It is an evidence-backed summary designed to be
judged in about ten seconds:

- title and one-line summary;
- 3–7 key points;
- conclusions, user-confirmed decisions, assistant proposals, and unresolved
  items kept as distinct outcome kinds;
- only explicit action requests or commitments;
- 1–5 pieces of necessary context.

Every public item retains validated `sourceMessageIds`. The deterministic v1
note remains stored for old-note compatibility and the collapsed conversation
flow view.

## Authority and evidence rules

1. Chat content is untrusted data and cannot alter the summary system
   instruction.
2. The server builds a catalog of complete source sentences or bullet clauses.
   Gemini selects only request-local numeric evidence indexes constrained by
   Structured Output; it does not generate source IDs or quotes.
3. The server resolves every index to its exact source message and clause, then
   rejects out-of-range indexes, malformed fields, count or length violations,
   and summaries over 1,200 visible characters. Fragment citations are not
   authority evidence.
4. A `decision` requires an affirmative, non-question user decision or
   acceptance. An assistant recommendation alone remains a `proposal` or is
   removed. The public decision text is the verified user clause rather than a
   model paraphrase.
5. An action item requires an affirmative, non-negated user request or
   commitment. Its public text is the verified user clause. Owner requires an
   explicit assignment, completed status rejects negated completion, and a due
   date requires both the date and a deadline marker in the same grounded
   clause.
6. Long conversations use validated partial summaries and a reduce pass; final
   exact `(sourceMessageId, quote)` pairs must be a subset of the validated
   partial evidence and original input.

## Persistence and failure contract

- `summary_schema_version` and `summary_json` are nullable additive D1 columns.
- Existing v1 rows remain unchanged and readable.
- New imports write the legacy detail and validated v2 summary together.
- Explicit regeneration updates only the summary and import provenance under
  the existing `noteId + owner + sourceUrl + expectedUpdatedAt` condition. It
  preserves edited v1 title, overview, sections, tags, favorite/archive/trash
  state, ID, and creation time.
- Provider, timeout, rate-limit, malformed output, evidence failure, or stale
  write performs no partial D1 mutation.
- Raw share HTML, reconstructed message arrays, provider response bodies, and
  API keys are not persisted or logged.

## Automated coverage

- structured summary schema, limits, duplicate/unknown fields;
- request-local evidence-index bounds, source ID membership, and exact-clause
  validation;
- assistant proposal versus user decision;
- unsupported action and optional metadata removal;
- prompt-injection content remains inside the untrusted input payload;
- malformed JSON/envelope, timeout, rate-limit, auth, and provider failure;
- chunk/reduce evidence preservation;
- adversarial fragment, question, conditional, negation, owner, status, and
  non-deadline date rejection;
- v1 migration/read/render compatibility and malformed v2 fallback;
- atomic create/reimport and stale-write preservation;
- v2 list-card and collapsed-detail UI contract;
- Gemini transfer disclosure and absence of client-side API key access.

Provider tests use deterministic mocks. A real localhost API smoke test on
2026-08-02 completed the share fetch, Gemini generation, deterministic
validation, and D1 create path with HTTP 201. No real conversation or
credential is added to a fixture.

## Rollback

Stop creating new v2 summaries and render notes through the legacy
`overview`/`sections_json` path. The nullable summary columns can remain unused
to avoid destructive schema rollback. Existing v1 data and user edits are not
removed.
