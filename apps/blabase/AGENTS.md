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
