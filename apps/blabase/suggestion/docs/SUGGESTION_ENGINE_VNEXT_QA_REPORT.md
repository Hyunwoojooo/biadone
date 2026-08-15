# Suggestion Engine vNext Q-001 Automated Checkpoint Report

| 항목 | 값 |
| --- | --- |
| Date | 2026-08-14 KST |
| Base revision | `e2fc9f56066b5d731fddcf9cc1837424a740b450` |
| Automated checkpoint | `automated_checkpoint_passed` |
| Release state | `blocked_pending_human_review` |
| Owner | Codex (automated implementation/checkpoint evidence); User (human product, privacy and release approval) |

> Final exact `npm run arch:check`가 통과했으므로 automated checkpoint는
> `automated_checkpoint_passed`다. 이 결과는 human approval, dataset freeze, Gold
> 승격, production rollout 또는 release readiness를 의미하지 않는다.

## 1. Scope and evidence class

Q-001은 `E-001`부터 `M-001a`까지 현재 구현된 범위의 자동 회귀, build,
mutable Continuation evaluator checkpoint, web browser flow, Launcher package와
architecture consistency를 한 번에 확인하는 local checkpoint다. 이 과정에서 발견된
product blocker에는 최소한의 fail-closed 보정과 회귀 테스트를 추가했다.

- Dataset `suggestion-continuation-dev-v0.1` revision 3은 **mutable/unfrozen Dev
  Candidate**다. 22/22는 12 contract, 9 resolver, 1 Board 합성 row의 contract
  checkpoint이며 human-reviewed Gold, Acceptable@1/3 또는 release-quality 측정이
  아니다.
- Monitoring record와 aggregate는 항상 `reviewState=candidate`,
  `appliedToRanking=false`, `goldEligible=false`,
  `releaseGateEligible=false`다.
- Production conversation, frozen Golden/Regression/Holdout data, prompt, model,
  resolver ranking 또는 Board ordering은 변경하지 않았다.
- Notarization은 실행하지 않았다.

## 2. Initial exact matrix

아래는 Q-001 시작 시 base-scoped worktree에서 얻은 최초 결과다. 실패를 숨기지 않고
후속 보정 근거로 보존한다.

| Check | Initial result | Evidence |
| --- | --- | --- |
| `npm test` | pass | 158 files, 1,312 tests; 18.16s |
| `npm run typecheck` | pass | 9.06s |
| `npm run lint` | pass | 7.65s |
| `npm run build` | pass | Next.js 15.5.21; 15.66s |
| `npm run continuation:baseline` | pass | 22/22 measured/pass, 0 failed/deferred; 1.11s |
| `npm run test:e2e` | fail | 28 total: 18 passed, 8 failed, 1 skipped, 1 did not run; 99.56s |
| monitoring opt-in Playwright | pass | 1/1; 5.74s |
| `npm run launcher:agent:bundle` | pass | 0.50s; SHA-256 `6cae421c560d8e6a9f775ce50b488d92a7b6e22e1d436329461bff6060b83afe` |
| `npm run launcher:swift:smoke` | pass | 25.42s |
| `(cd desktop/macos && swift build)` | pass | 1.02s |
| `npm run launcher:app:build` | pass | 2.73s; executable SHA-256 `daa2c3674b043d964359b01ac80ba2f178b1b356a1a24e5ccad7a6b2393860cd` |
| `npm run launcher:package` | pass | 16.53s; DMG SHA-256 `d7aab8cc2aabf7b213424d51860c33ed24b5989ba5318107dc6fa217c6b18332` |
| `npm run launcher:package:verify` | pass | 4.79s |
| `(cd desktop/macos && swift test)` | environment/toolchain gate | failed before test execution in 0.88s: selected Command Line Tools SDK has no `XCTest` module |
| root `npm run arch:check` | fail | 3.60s; repository dependency check reported 12 warnings/0 errors, then suggestion dependency check stopped with TS18003/no inputs |

Initial Continuation run ID는
`continuation_eval_run_2201e106858331df1982e648f42d01dd`다. Private full artifact는
Git 밖 `.local/`에 mode 0600으로 유지했고, 다음 reproducibility tuple을 기록했다.

| Artifact | SHA-256 |
| --- | --- |
| Candidate dataset payload | `98a3c8135b23c6ac2aeddd3c2ada511d3d9a46638fb016d95d86945c8f6d8f31` |
| Materialized input | `de9dd348173cdf5087905a1c7b33e2ee20cd948159280572e8f090b95cdb9da2` |
| Candidate configuration | `60ac735cc0d8566772ef7fbf5329f5e626d89c02a8e408d3dafbda28f658221b` |
| Deterministic output | `bd6dfccc525cef2ee1837b08dfb2fa3a88b8776c7283732bb36e4502fd0db4e7` |
| Canonical run artifact | `a86f086a8c08bc7e2a17e778861c9a3785fe455b79560e39794edb8baff8ef29` |
| Stored run artifact | `bd1da8a3fd46ad8df7d209f5c44ade145b054c051be5dda4a960ad661049496e` |

## 3. Blockers found and bounded corrections

### 3.1 Monitoring replay and deletion

- Normal store reads still reject an authenticated aggregate that does not match
  its authenticated event chain. Replay uses a narrower authenticated read: it
  verifies schema, `authKeyId`, event hashes/HMAC chain and store HMAC, then
  recomputes the aggregate. A stale stored aggregate therefore becomes a
  deterministic replay mismatch and CLI failure instead of making replay itself
  impossible.
- Explicit purge now acquires the monitoring root lock and deletes every safe
  canonical current or inactive `authKeyId` namespace. It does not depend on a
  current Codex configuration or installation secret. Symlink, wrong-type,
  wrong-mode and unexpected entries fail closed instead of being followed or
  silently skipped.
- Codex disconnect performs this all-data purge before deleting configuration.
  Purge failure aborts disconnect with a sanitized error, so a successful
  disconnect cannot leave known monitoring namespaces behind.
- The approved 30-day policy is unchanged: current store mutations lazily compact
  expired prefixes; there is no background cleanup. The explicit all-data purge is
  the complete deletion path across key rotation.

### 3.2 Semantic Continuation intent authority

- Private intent store/schema moved from v0.1 to
  `semantic-continuation-intent-store-v0.2` and
  `semantic-continuation-intent-store-schema-v0.2`. Each record carries an
  installation-secret-derived HMAC and `authKeyId` and is stored at
  `.local/semantic-continuation/<authKeyId>/intent-store.json` behind strict
  0700/0600, no-follow, inode-checked atomic persistence.
- The current secret opens only its exact namespace. The fixed-root v0.1 store is
  ignored rather than silently migrated, and a rotated/wrong secret cannot enumerate
  or reuse prior intent authority.
- Pure GET/read remains non-mutating. An exact orphan temporary-file sentinel makes
  it fail closed and does not delete the file. The next authorized POST, while
  holding the shared cross-process semantic/validation lease, visits the fixed
  legacy root plus every canonical current/inactive `authKeyId` namespace and may
  recover only an exact regular same-owner 0600
  `intent-store.json.<pid>.<16hex>.tmp`. This prevents a rotated-key orphan from
  suppressing the current overlay; hostile symlinks or wrong modes remain untouched
  and fail closed.
- The shared lease path now validates and creates its fixed directory chain
  component-by-component. Unsafe `.local` or `work-resumption` ancestors are not
  traversed by recursive bootstrap.
- SC-002 validation receipt GET/preserve remains pure and fail-closed on an orphan
  write. The next authorized validation/semantic mutation under that same shared
  lease may remove only an exact no-follow, inode-matched, same-owner 0600
  `receipts.json.<pid>.<16hex>.tmp`; hostile symlink/wrong-mode temps are preserved
  and reject the mutation. This closes the remaining indefinite overlay-null crash
  window without adding GET cleanup.
- Intent POST uses exact JSON content type, required length, an 8,192-byte declared
  and streamed cap, fatal UTF-8 decoding, declared/actual length equality and strict
  schema parsing before semantic evaluation.

### 3.3 Least privilege and browser currentness

- Intent writes require both exact read flag
  `BLABASE_WORK_BOARD_SHADOW_READ_ENABLED === "true"` and separate exact default-off
  `BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED === "true"`. The server page passes
  only the resulting boolean capability and hides the form when write authority is
  unavailable.
- The form is keyed by exact `itemRef`, `workContextRef` and base `generatedAt`.
  Target changes remount/reset it; request generations suppress late completions and
  prevent stale refresh. Editing a previously submitted label invalidates the old
  completion immediately.
- The explicit mounted race regression passed 1/1 with the semantic write flag on.

### 3.4 E2E fixture drift

- The first eight E2E failures were stale exact UI copy assertions; current product
  copy was verified and the assertions were corrected without weakening semantic
  checks.
- An intermediate full rerun produced 26 passed, 2 skipped and 1 failed in 42.12s.
  The remaining assertion incorrectly counted ordinary background Attention GET
  polling as a forbidden source refresh. It now checks the mutating Attention POST
  boundary, which is the behavior under test.
- Launcher model smoke now performs a bounded deterministic wait for its one-shot
  post-configuration fake process to exit before shutdown. This removes a test-harness
  scheduling race without changing Launcher runtime authority or projection behavior.

## 4. Capability matrix at this checkpoint

| Surface/capability | Automated checkpoint meaning | Release state |
| --- | --- | --- |
| Web formal display read | Strict public projection only; every item is `capability="display"`, `action=null`; no action authority | Implemented default-off; human G2/G3/copy/accessibility review pending |
| Setup navigation | Explicit click may issue a short-lived offer for fixed same-origin `/projects`; binds candidate TTL, source identity/observation, relevant mapping state and typed code provenance. Because the Setup candidate has null WorkContext, exact WorkContext and session heartbeat are not required | Implemented default-off; only this bounded navigation slice has product-policy approval, not release approval |
| `open_source` | No implemented or approved source-open path in this checkpoint | Blocked/unimplemented |
| `resume_exact_session` | No implemented or approved exact resume. A future slice requires exact WorkContext/session binding, fresh heartbeat, short TTL and action-time revalidation | Blocked/unimplemented |
| Launcher Full Board | Strict display-only rows; no Setup/Continuation action | Implemented default-off; manual packaging compatibility/accessibility gates pending |
| Launcher Active-only fallback | May retain only the pre-existing legacy Active actions | No new Continuation/Setup authority |
| Monitoring | Web-only explicit consent/render/feedback, redacted aggregate/replay; never changes rank, Gold, evaluation score or release gate | Local dogfood default-off; human privacy/copy review pending |

## 5. Final exact matrix

`swift test` was deliberately attempted exactly once. Its environment failure is
preserved below and must not be converted to pass without a full Xcode toolchain run.
The final architecture result alone selects the automated-checkpoint literal described
at the top; manual gates always keep release blocked.

Final host/toolchain evidence: Node.js `v22.23.2`, npm `10.9.8`, Next.js `15.5.21`,
Swift `6.3.1`, macOS `26.5.2`, with `xcode-select` pointing to Command Line Tools.

| Check | Final result | Evidence |
| --- | --- | --- |
| `npm test` | pass | 158 files, 1,327 tests; 22.21s |
| `npm run typecheck` | pass | 3.38s |
| `npm run lint` | pass | 19.16s |
| `npm run build` | pass | Next.js 15.5.21; 18.37s |
| `npm run continuation:baseline` | pass | run `continuation_eval_run_1a7f8824ffcc442dee45d1a73c8b2988`; 22/22 measured/pass, 0 failed/deferred; 1.16s |
| `npm run test:e2e` | pass | 27 passed, 2 skipped; 40.06s |
| monitoring opt-in Playwright | pass | 1/1; 5.29s |
| semantic intent race opt-in Playwright | pass | 1/1; 7.57s |
| `npm run launcher:agent:bundle` | pass | SHA-256 `10625b73ce16dec2220f8f3069a12f0c7fae43fb687b997e922b29d48b2760ca`; 0.52s |
| `npm run launcher:swift:smoke` | pass | 24.85s after deterministic fake-exit wait correction |
| `(cd desktop/macos && swift build)` | pass | 0.40s |
| `npm run launcher:app:build` | pass | executable SHA-256 `7b587946078ee3f2774ebecbda6187799b85c37f48a4dadce599685a3546fc71`; 2.72s |
| `npm run launcher:package` | pass | DMG SHA-256 `21f44ceb78c4e47e99bc0d9990dfba0c141f646dc86905ad84e224609ccc5b7e`; 16.37s |
| `npm run launcher:package:verify` | pass | 2.38s |
| `(cd desktop/macos && swift test)` | `toolchain_gate_failed_before_tests` | attempted once; `no such module 'XCTest'`; 0.88s |
| root `npm run arch:check` | pass | dependency warnings only/0 errors; dependency/source/trace/model checks passed; 7.39s |
| `git diff --check` | pass | 0.03s; no private artifact content included |

Final baseline reproducibility values:

| Artifact | Final value |
| --- | --- |
| Candidate dataset payload SHA-256 | `98a3c8135b23c6ac2aeddd3c2ada511d3d9a46638fb016d95d86945c8f6d8f31` |
| Materialized input SHA-256 | `de9dd348173cdf5087905a1c7b33e2ee20cd948159280572e8f090b95cdb9da2` |
| Candidate configuration SHA-256 | `60ac735cc0d8566772ef7fbf5329f5e626d89c02a8e408d3dafbda28f658221b` |
| Deterministic output SHA-256 | `bd6dfccc525cef2ee1837b08dfb2fa3a88b8776c7283732bb36e4502fd0db4e7` |
| Canonical run artifact SHA-256 | `fddf51329caab4e456a62609664628422d3ad805d9449726ecec3c3467af4f24` |
| Stored run artifact SHA-256 | `1e9f2555625db60e726d7b973f3ed60fa2fffc1d42dfd888954fea6b4cd8a2a4` |

The final scoped implementation/test fingerprint uses policy
`q001-automated-checkpoint-worktree-sha256-v1`: sort
`relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
for the final exact Q-001 implementation/test scope, then SHA-256 hash the records.
Documentation, `.local/`, generated build/package output and unrelated shared dirty
paths are excluded. Scope count: `33`; fingerprint:
`dcbb0dc8515fc228da58d27b86b03c63001238631a88368253b95befbeac3627`.

## 6. Manual and release blockers

The automated checkpoint does not close any of these gates:

- real unmocked authenticated browser chain, including default-off/on privacy and
  safe-origin/no-store behavior;
- human copy, 320px/200% zoom, keyboard, VoiceOver, Safari and privacy review;
- full Xcode-toolchain XCTest run and old-host/new-agent plus new-host/old-agent
  packaged compatibility smoke;
- signed/notarized distribution verification; notarization was not run;
- HTML nonce-based CSP hardening/review for the authenticated web surface;
- manual recovery policy for crash-left locks or temporary files outside the exact
  safe intent-store and validation-receipt mutation recovery cases;
- human dataset reviewers/adjudicator, lawful basis/anonymization, immutable dataset
  freeze, locked holdout, provisional 75/90 decision and explicit release record;
- production G2/G3 and every later rollout gate.

## 7. Decision and rollback

- Automated checkpoint: `automated_checkpoint_passed`.
- Release: `blocked_pending_human_review`.
- Rollback remains flag-first: disable semantic writes, monitoring, Launcher Board,
  Setup action, presentation and resolver in reverse authority order. The v0.2
  current-key Semantic Continuation intent store deliberately does not migrate the
  legacy fixed-root v0.1 store. Monitoring data can be removed through the explicit
  all-namespace purge even after configuration or key removal.
