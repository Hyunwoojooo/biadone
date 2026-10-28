# blabase AGENTS.md

These instructions apply to all work under `apps/blabase/`.

## Stack and Commands

- Framework: Next.js 15 App Router with React 19.
- Language: TypeScript.
- Validation: Zod.
- Tests: Vitest.
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Test: `npm test`
- Golden baseline: `npm run golden:baseline -- <args>`

## Task Checkpoints and Human Decisions

- Divide substantial work into independently reviewable tasks based on purpose
  and outcome, not arbitrary time limits.
- Each task must have one primary objective, explicit scope, completion criteria,
  and a clear list of actions that are out of scope.
- Do not automatically continue to the next task after completing a checkpoint.
  Stop, report the checkpoint, and wait for the user's decision.
- At every checkpoint, report:
  - what was done;
  - files, data, or artifacts changed;
  - checks run and their results;
  - findings, blockers, and residual risks;
  - the recommended next action;
  - the exact decision the user must make before work continues.
- Present concrete options and tradeoffs when the user must choose between
  approaches. If no product or architecture choice is required, still ask
  whether to proceed, hold, revise, or roll back the completed checkpoint.
- Keep implementation, validation, QA review, artifact publication, destructive
  cleanup, and human approval as separate tasks unless the user explicitly
  authorizes combining them.
- Never combine creation of replacement artifacts with deletion of existing
  artifacts in one checkpoint. Create, validate, request approval, and only then
  perform separately approved cleanup.
- Treat automated QA, technical review, and human approval as distinct gates.
  Passing one gate does not authorize or imply the next.
- If a task expands beyond its declared scope or encounters a blocker, stop at
  that checkpoint and report it instead of silently expanding the work.
- Avoid long opaque background work. Provide progress at meaningful task
  boundaries and make the current activity observable to the user.

## Human Roles and Review Authority

- `Colin` is the developer and working owner of this project. Colin owns
  implementation decisions, technical scope, intermediate checkpoints, and the
  decision to continue, revise, hold, or roll back development work.
- Colin is also the sole human reviewer and decision authority for development
  results. Direct all questions, checkpoint decisions, approvals, and rollback
  decisions to Colin.
- `David` has no required role in the development, technical QA, governance,
  artifact, approval, or release workflow. Do not block work or create review
  packages, receipts, approvals, or artifacts for David.
- Create review artifacts only when they help Colin inspect results, reproduce a
  run, compare alternatives, or make a decision. Do not create artifacts merely
  to satisfy an assumed external reviewer.
- Automated checks and agent QA provide technical evidence for Colin. They do
  not replace Colin's decision or create a separate human approval gate.
- If an existing schema, contract, plan, or record assigns David any required
  reviewer or approver role, report the conflict and handle it as a separate
  role-correction task. Do not preserve that gate merely because it already
  exists, and do not silently rewrite it while performing unrelated work.

## Engine Recordkeeping

Before changing conversation restoration, normalization, extraction, prompts,
segmentation, evidence verification, Golden Dataset logic, evaluation, or result
resolution, read `docs/ENGINE_DEVELOPMENT_RECORDS.md` completely.

The following rules are mandatory:

- Treat a frozen Golden Dataset as immutable. Corrections create a new dataset
  version and hash; never silently overwrite an old version.
- Every engine or evaluation run must be reproducible from recorded dataset,
  code, schema, rule, prompt, model, guardrail, and configuration versions.
- Record evidence, confidence, verification status, conflicts, errors, latency,
  and token usage when the affected pipeline produces them.
- Keep raw conversations, private evaluation artifacts, and credentials out of
  Git. Use `.local/` or an approved private store.
- Do not promote production conversations into Golden or Regression datasets
  without an explicit lawful basis, data minimization, anonymization, and a
  recorded review decision.
- Do not treat production logs, implicit feedback, or an LLM judge score as
  human-approved Gold.
- Preserve original values when proposing corrections. Store corrections as a
  separate reviewed change until a new dataset version is frozen.
- A behavior-changing engine change requires relevant tests and an Engine
  Change Record using the template in the recordkeeping guide.
- If an engine version is compared with another version, keep the same frozen
  evaluation input and record both run IDs. Do not compare metrics produced
  from different datasets as if they were directly equivalent.
- UI-only changes that do not alter engine input, output, filtering, ordering,
  or interpretation do not require a baseline rerun. State that explicitly in
  the final report.

## Done Means for Engine Work

- Required identifiers and versions are present in the affected records.
- Relevant unit and integration tests pass.
- Typecheck and lint pass when source code changed.
- A baseline or targeted regression run is recorded when semantic behavior
  changed, or the final report explains why it was deferred.
- Data privacy and retention impact is reviewed.
- Documentation describes behavior, compatibility, risks, and follow-up work.

## Architecture Workflow

- Update the LikeC4 model when a system boundary, container, component, external integration, or core dynamic flow changes.
- Keep implemented architecture in `architecture/model.c4` and unimplemented plans in `architecture/planned.c4`; never present planned structure as live.
- Run `npm run arch:deps:check` after module moves or import changes.
- Run `npm run arch:model:check` after architecture model changes.
- Run `npm run arch:check` before completing architecture-affecting work and `npm run arch:build` when review artifacts are needed.
- Do not commit AppMap recordings, actual user data, `.env*`, `.local/`, or `artifacts/architecture/`. The reviewed `docs/architecture-current.html` is an intentional standalone documentation artifact generated from its adjacent `.archify.json` source.
- When code, tests, and architecture documentation disagree, record the drift and either correct it or mark the uncertainty; do not conceal it with broad analysis exclusions.
- See `docs/architecture/README.md` for source-of-truth rules, tool roles, privacy constraints, and runbooks.
