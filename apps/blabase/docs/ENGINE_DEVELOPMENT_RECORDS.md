# blabase Engine Development and Recordkeeping Guide

## 1. Purpose

blabase is building a semantic extraction engine that restores AI
conversations and turns them into traceable topics, decisions, questions,
actions, preferences, constraints, problems, satisfaction signals, change
events, entities, and relations.

The engine improves only when production signals become reviewed,
representative evaluation cases. Merely accumulating raw conversations does
not improve the engine. This document defines what must be recorded so future
Codex CLI sessions and human collaborators can reproduce a result, understand
why behavior changed, prevent regressions, and use production data safely.

This guide is normative for changes to:

- share-link restoration and conversation normalization;
- Rule and LLM extraction;
- prompts, providers, models, and segmentation;
- evidence verification, deduplication, and conflict resolution;
- Golden, Regression, Rolling, and Holdout datasets;
- evaluation runners, judges, metrics, and guardrails;
- user corrections that may become evaluation data.

## 2. Non-negotiable Principles

1. **Reproducibility over memory.** A result must not depend on someone
   remembering which model, prompt, dataset, or configuration was used.
2. **Frozen data is immutable.** Correcting a frozen dataset creates a new
   version and hash.
3. **Raw logs are not Gold.** Usage data becomes Gold only after privacy review,
   normalization, human review, and an explicit promotion decision.
4. **Original evidence is preserved.** Corrections and interpretations do not
   overwrite the original record.
5. **Evaluation input stays fixed during comparison.** Engine A and Engine B
   must be measured on the same frozen input to support a direct comparison.
6. **Automatic judges prioritize review; they do not replace it.** A score from
   the same model family as the candidate is especially unsuitable as a final
   quality claim.
7. **Representative coverage matters more than volume.** Prefer diverse,
   high-value cases over an unbounded collection of similar conversations.
8. **Private data stays private.** Secrets, raw conversations, and private
   evaluation outputs must not be committed to Git.

## 3. Dataset Classes

| Dataset | Purpose | Update policy |
|---|---|---|
| Core Golden | Small, stable contract for essential engine behavior | Change deliberately through a new version |
| Regression | Prevent recurrence of verified production or development failures | Add a case when a failure is confirmed and generalized |
| Rolling Evaluation | Detect recent usage and distribution changes | Replace samples on a schedule; do not use as a permanent contract |
| Locked Holdout | Estimate generalization without prompt or rule overfitting | Keep hidden from routine development and open only at release gates |

Production logs, analytics events, low-confidence outputs, and user reactions
are **candidate signals**, not datasets in this table until reviewed.

## 4. Required Identifiers and Versions

Use stable IDs and explicit versions. Do not infer them later from filenames or
timestamps.

| Field | Required meaning |
|---|---|
| `analysisId` | One application analysis request |
| `sessionId` | Stable dataset or source-conversation identifier |
| `runId` | One engine or evaluation execution |
| `itemId` | One extracted semantic item within a run |
| `evalId` | One field-level or case-level evaluation result |
| `datasetVersion` | Immutable dataset contract, such as `gold-core-v0.1` |
| `datasetSha256` | Hash of the canonical frozen evaluation input |
| `engineVersion` | Overall semantic engine release or contract version |
| `schemaVersion` | Input/output schema contract |
| `normalizationVersion` | Conversation cleaning and canonicalization behavior |
| `ruleVersion` | Deterministic extractor and classification rules |
| `promptVersion` | Candidate-generation prompt contract |
| `summaryPromptVersion` | Session summary prompt contract when separate |
| `judgePromptVersion` | Automatic evaluation prompt contract |
| `guardrailVersion` | Deterministic post-judge correction rules |
| `verifierVersion` | Evidence verification behavior |
| `codeCommitSha` | Exact Git revision used for the run |

A new execution gets a new `runId` even if every version is unchanged. A data
correction gets a new `datasetVersion` and `datasetSha256`. A behavior change
must update the narrowest relevant version; do not reuse a version string for
different behavior.

## 5. Records That Must Be Kept

### 5.1 Source and Normalization Record

Keep one record for the input that entered the engine.

Required fields:

- `analysisId`, `sessionId`, and source type;
- collection time and source reference, without embedding credentials;
- consent or other approved processing basis;
- privacy classification and retention policy;
- original message count and normalized message count;
- canonical normalized input hash;
- `normalizationVersion`;
- excluded message counts and exclusion reasons;
- restoration or normalization warnings and errors.

Do not store a public share URL in a committed artifact if it exposes a private
conversation. A private record may retain the URL when operationally required.

### 5.2 Engine Run Record

Every Rule, LLM, hybrid, or resolver execution must record:

- `runId`, `analysisId`, `sessionId`, start time, and completion time;
- status: `queued`, `running`, `completed`, `partial`, or `failed`;
- `engineVersion` and `codeCommitSha`;
- all applicable schema, normalization, rule, prompt, verifier, resolver, and
  guardrail versions;
- provider and exact model ID;
- relevant feature flags and segmentation configuration;
- input hash and output hash;
- segment count, successful segment count, and failed segment count;
- item counts by semantic type and verification status;
- evidence message coverage and semantic type coverage;
- request latency and total duration;
- input, output, reasoning, and total token usage when the provider supplies
  them;
- estimated or reported cost when available;
- structured error code, retry count, and sanitized error detail.

Environment variable values that contain secrets must never be copied into the
record. Store effective non-secret configuration values instead.

### 5.3 Semantic Item and Evidence Record

Each extracted item must preserve:

- stable `itemId`, `runId`, semantic type, subtype, value, and status;
- extractor source: Rule, LLM, resolver, or human;
- confidence and the method used to calculate it;
- evidence message IDs or indexes;
- exact start and end character spans when available;
- trigger phrase or evidence excerpt in private storage only when needed;
- evidence role and direct/indirect classification;
- verification status and reason codes;
- deduplication key and merged source item IDs;
- conflict IDs and the competing interpretations;
- rejection or review-queue reasons;
- schema validation status.

Never keep only the final resolved value. The engine must retain enough lineage
to explain which source and rule produced it.

### 5.4 Evaluation Run Record

Every baseline, regression, rolling, or holdout evaluation must record:

- `runId`, `datasetVersion`, `datasetSha256`, dataset class, and split;
- exact session and field scope, included count, and excluded count;
- candidate provider, model, prompts, engine versions, and `codeCommitSha`;
- judge provider, model, prompt, and guardrail versions;
- whether the candidate and judge use the same model family;
- context limit, segmentation, concurrency, and retry configuration;
- row counts by task and context mode;
- schema pass rate and error count;
- aggregate scores and field-, type-, session-, and context-level breakdowns;
- comparison baseline `runId` when reporting improvement or regression;
- automatic review status and human review status as separate fields;
- start time, completion time, artifact location, and artifact hash;
- limitations, known data-quality warnings, and accepted exceptions.

Do not report two run scores as a direct improvement when their dataset hashes
differ. Describe such comparisons as directional only.

### 5.5 User Feedback and Correction Record

When the product later captures feedback, keep:

- `feedbackId`, time, target `analysisId`, `runId`, and `itemId`;
- signal source: explicit correction, explicit rating, repeated request,
  abandonment, support report, or automatic anomaly;
- whether the signal is explicit or inferred;
- original engine value and proposed corrected value;
- original evidence and proposed evidence references;
- consent, privacy, anonymization, and retention status;
- review state: `candidate`, `reviewing`, `accepted`, `rejected`, or `deferred`;
- reviewer and review time for internal audit;
- linked issue or failure category;
- dataset version into which the case was promoted, if any.

An implicit reaction such as a repeated prompt may identify a candidate failure,
but it must not automatically become an approved label.

### 5.6 Engine Change Record

Every change that can alter semantic output must add a durable record to the
relevant PR, commit notes, or a tracked evaluation report. Use this template:

```markdown
## Engine Change Record

- Date:
- Owner:
- Goal:
- Affected pipeline stages:
- Behavior before:
- Behavior after:
- Versions before:
- Versions after:
- Code commit:
- Evaluation dataset version and SHA-256:
- Candidate run ID:
- Comparison run ID:
- Commands executed:
- Metrics changed:
- Regressions or accepted exceptions:
- Privacy or retention impact:
- Release decision:
- Rollback method:
- Follow-up work:
```

If evaluation is intentionally deferred, record the reason and the exact gate
that must be satisfied before release.

### 5.7 Release Decision Record

Before an engine version becomes the product default, record:

- release version and `codeCommitSha`;
- baseline, regression, and holdout run IDs;
- primary metrics, guardrail metrics, and comparison results;
- known regressions and why they were accepted;
- unresolved privacy, cost, latency, or reliability risks;
- human approver and approval time;
- rollout scope and rollback procedure.

## 6. Version Change Rules

Use these rules consistently:

- Dataset content changed: new `datasetVersion` and `datasetSha256`.
- Field definition or schema changed: new `schemaVersion`.
- Message restoration or cleaning changed: new `normalizationVersion`.
- Deterministic extraction changed: new `ruleVersion`.
- Candidate instructions changed semantically: new `promptVersion`.
- Judge rubric changed: new `judgePromptVersion`.
- Evidence acceptance changed: new `verifierVersion`.
- Judge post-processing changed: new `guardrailVersion`.
- Only runtime infrastructure changed with identical output behavior: keep
  semantic versions, create a new `runId`, and record the infrastructure change.

Formatting-only edits do not require a semantic version bump. If there is doubt
whether output can change, assume it can and update the relevant version.

## 7. From Production Signal to Golden Case

Use this promotion flow:

```text
production signal
→ privacy and retention eligibility
→ anonymization and data minimization
→ duplicate and cluster reduction
→ human labeling
→ second review for ambiguous/high-impact cases
→ candidate regression case
→ frozen dataset version
→ baseline and holdout evaluation
```

Good candidates include Rule/LLM disagreement, low confidence, verifier
rejection, user correction, repeated requests, new conversation structures, and
verified incidents. Sampling should preserve language, conversation length,
semantic type, product surface, and failure category coverage.

Do not automatically promote every user's conversation. One representative,
reviewed case is more useful than hundreds of unreviewed duplicates.

## 8. Storage and Git Rules

| Location | Allowed content |
|---|---|
| `.local/` | Private inputs, raw HTML, full run outputs, temporary reports; never commit |
| Approved private Sheet/store | Annotation workflow, review state, private evidence, operational results |
| `docs/` | Specifications, redacted aggregate reports, decisions, and templates safe for Git |
| `.env` or secret manager | Credentials and private keys; never copy into docs, logs, or fixtures |
| `tests/fixtures/` | Synthetic or explicitly approved anonymized fixtures only |

Before staging files, check for share URLs, message text, email addresses,
service-account data, API keys, `.local/`, `.next/`, and `.wrangler/` content.

## 9. Codex CLI Workflow

### Before an engine change

1. Read this document and the relevant semantic specification.
2. Inspect the current dataset, prompt, schema, rule, verifier, and guardrail
   versions.
3. Identify whether the change can affect output or only presentation.
4. Define the comparison dataset and success/guardrail metrics.
5. Confirm that required private inputs exist without printing their contents.

### During implementation

1. Preserve provenance and original values.
2. Update the narrowest relevant version constant.
3. Add or update unit and integration tests.
4. Keep secrets and private conversations out of tool output and Git.
5. Write deterministic code for hashing, ordering, and IDs.

### Before declaring completion

1. Run relevant tests, typecheck, lint, and build.
2. Run a targeted regression or frozen baseline when semantic output changed.
3. Compare against an explicit prior `runId` on the same dataset hash.
4. Complete an Engine Change Record.
5. Report files changed, checks run, metric changes, risks, privacy impact, and
   deferred follow-up work.

## 10. Current Project Context

The current seed dataset is `gold-core-v0.1`, covering S-001 through S-020.
The completed local baseline contains 233 prompt labels, 20 session summaries,
and 2,024 field-level evaluation rows. It is a development set, not a locked
generalization test. Its automatic candidate and judge use the same Gemini model
family, and the evaluation rows have not received a separate human review.

Known review candidates include cancelled-input labels and uncertain session
summaries. Until human review occurs, Codex may build validation, storage,
read-only APIs, dashboards, comparison infrastructure, and tests, but must not
silently rewrite Gold values or present the current automated scores as final
product quality.
