# Suggestion Engine vNext Implementation Plan

| 항목 | 값 |
| --- | --- |
| Status | **Implementation in progress — R-003 synthetic resolver checkpoint implemented and validated; B-001 next; release not approved** |
| Date | 2026-08-13 |
| Owner | User (product decision and release approver); Codex (AI implementation executor and record author) |
| Authority | `SUGGESTION_ENGINE_VNEXT_TECH_SPEC.md` |

> 이 문서는 구현 순서와 승인 gate를 추적하는 planning artifact다. 개별 task의 기록된 automated validation은 데이터셋 동결, human approval, 배포 승인 또는 release readiness를 의미하지 않는다.

## 1. 목표

기존 Active Attention을 변경하지 않으면서 다음 기능을 단계적으로 추가한다.

- 검증된 즉시 개입과 최근 작업 이어가기를 서로 다른 lane으로 판단한다.
- 최근 GitHub push와 최근 Codex session을 source-local Continuation 후보로 활용한다.
- WorkContext 매핑이 없을 때 후보를 숨기지 않고 안전한 Setup CTA를 제공한다.
- Proposal Router가 primary 1개와 alternatives 최대 2개를 구성한다.
- display/link-only에서 시작해 검증된 exact resume으로 capability를 점진적으로 확장한다.
- 모든 behavior change를 versioned contract, dataset, evaluator, Engine Change Record로 재현 가능하게 만든다.

## 2. 현재 상태

- Active Attention은 엄격한 candidate admission과 eligibility를 사용한다.
- Recent Work v0.2는 최근 push를 일반화된 문구로 보여주지만 정식 Continuation ranking과 action contract는 아니다.
- GitHub v6 metadata에는 최근 push의 source-native identity와 시각이 있다.
- Codex v3 metadata에는 session identity, project label, update 시각과 bounded activity metadata가 있다.
- GitHub repository, Codex session, local workspace를 사용자 중심으로 묶는 first-class WorkContext가 없다.
- mapping 부재와 partial coverage가 현재 제품에서 전체 추천 실패처럼 보인다.
- 기존 historical exact-resumption 계획은 broad source-local Continuation MVP와 분리되지 않았다.
- E-001 v0.2 scaffold와 authenticated resolver integration, S-001, R-001, R-002, R-003의 pure unwired synthetic regression checkpoint가 구현·검증됐다. 12 contract oracle과 9 resolver behavior row가 통과했고 B-001 cross-lane row 1개만 deferred다. 다음 code task는 B-001이며 trusted R-003 input-bound verifier seam만 소비해야 한다. API, UI, runtime, Board, persistence, monitor와 action은 아직 연결되지 않았다.

이 상태는 아래 task별 기록과 2026-08-13 KST automated validation 결과를 함께 반영하며, production activation이나 release를 의미하지 않는다.

## 3. 구현 원칙

- **Active immutability:** Continuation은 Attention input, candidate, eligibility, ranking, result hash에 영향을 주지 않는다.
- **Contract before resolver:** schema와 version을 먼저 정의한다.
- **Dataset before behavior:** 합성 dev/regression case와 evaluator를 resolver보다 먼저 준비한다.
- **Candidate/action separation:** 표시할 수 있음과 실행할 수 있음을 분리한다.
- **Source-local utility:** 신선한 direct evidence는 전역 coverage가 partial이어도 bounded 후보가 될 수 있다.
- **Explicit mapping:** exact remote 일치는 proposal만 만들며 persistent mapping은 사용자 확인을 요구한다.
- **Deterministic first:** MVP ranking에 LLM을 사용하지 않는다.
- **Privacy minimization:** commit subject, diff, raw prompt, raw path를 MVP에서 수집하지 않는다.
- **Reversible rollout:** shadow, presentation, link-only, exact resume 순으로 켠다.
- **No new dependency:** vNext MVP를 위해 production dependency를 추가하지 않는다.

## 4. Dependency graph

```text
D-001 Product decisions + draft ECR
  └── C-001 Contracts/version ledger
        ├── E-001 Dataset/evaluator scaffolding [done] ─┐
        ├── S-001 private adapter batch v0.4 [done] ────┤
        └── R-001 Identity/mapping v0.4 [done] ─────────┤
                                                       ▼
                         R-002 Candidate envelope/result v0.3 [done]
                                (rule/config v0.2)
                                                       │
                                                       ▼
                              R-003 Score/resolver core v0.1 [done]
                                      │                    │
                                      ▼                    ▼
                    E-001 resolver integration       B-001 Board composer
                              [done]                    [next code task]
                                      └──────────────┬─────┘
                                                     ▼
                                      shadow-use approval remains pending
                                                     │
                                                     ▼
                                            A-001 APIs
                                                     │
                                                     ▼
                                            U-001 Web UI
                                                     │
                                                     ▼
                                            X-001 Explicit actions
                                                     │
                                                     ▼
                                            L-001 Launcher v3

M-001 Monitoring/replay/feedback spans all runtime phases after C-001.

E-001 + R-003 + B-001 + A-001 + U-001 + X-001 + L-001 + M-001
  └── Q-001 Integrated QA
         └── P-001 Human review, freeze, staged rollout
```

`R-003` core와 E-001 v0.2의 9개 resolver behavior row 연결은 구현·검증됐다. B-001 cross-lane row는 Board 구현까지 유일하게 deferred다. B-001은 artifact schema 성공만 신뢰하지 않고 R-003의 original-input-bound verifier를 필수 seam으로 사용해야 한다. 어떤 R-003/Board behavior도 human gate 전에는 production path에 연결하지 않는다.

## 5. MVP 범위

### 5.1 포함

- 기존 GitHub v6 metadata 재사용
- 기존 Codex v3 metadata 재사용
- 최근 GitHub push 후보
- 최근 Codex session 후보
- 매핑 또는 session 선택이 필요한 Setup CTA
- 결정론적 Continuity score
- primary 1개와 alternatives 최대 2개
- `display | open_source | open_setup_surface` capability의 display 및 link-only action
- shadow resolution에서 시작해 웹 표시로 확대
- 기존 Attention 결과와 hash의 byte-equivalence 검증

MVP의 mapping/session CTA는 설정 또는 선택 화면으로 navigation만 수행한다. registry 저장, mapping confirmation, confirmed session selection persist 또는 resume 실행은 하지 않는다.

### 5.2 MVP 제외

- Local Git v2 collector
- commit subject, changed file name, diff 수집
- exact Codex resume 실행
- persistent mapping, mapping correction/removal, confirmed session selection 저장
- external source mutation
- MVP prompt draft auto-fill, automatic prompt send, command, retry
- implicit feedback 기반 ranking 학습
- macOS Launcher v3 기본 활성화
- LLM ranking 또는 semantic unfinished inference

## 6. 단계별 계획

### Phase 0. 제품 결정과 Draft Engine Change Record

- `D-001`의 MVP product-policy 결정은 2026-08-12 Human product owner의 conversation approval로 문서화됐다: 모든 valid Attention 우선, single-source primary 허용, 7일 activity window, explicit mapping confirmation, local verified label 표시, navigation-only action, explicit-feedback-only ranking, provisional 0/75/90 rollout gate.
- 역할은 User를 product decision/release approver로, Codex를 AI implementation executor/record author로, `qa_reviewer` agent를 advisory technical reviewer로 지정한다. Human dataset reviewers/adjudicator는 pending이다.
- behavior-changing implementation 전에 draft Engine Change Record를 만든다.
- Record에는 제안 version ledger, privacy impact, rollback flags, 비교 계획을 적되 존재하지 않는 run ID나 hash를 채우지 않는다.

**Status:** `D-001` complete for planning: MVP product policy, responsibility assignment와 Draft ECR이 기록됐다. 이는 `C-001` 시작을 허용하지만 implementation result, dataset freeze, rollout 또는 release 승인을 의미하지 않는다.

**Exit gate:** 충족. 다음 task는 `C-001` 계약과 version ledger다.

### Phase 1. 계약과 version freeze 후보

- `C-001`에서 WorkContext, ContextLink, Observation, Candidate, Decision, Board, Action Offer schema를 정의한다.
- canonicalization, opaque ID, result hash input, mixed-version fail-closed 규칙을 정의한다.
- Active와 Recent Work 계약은 변경하지 않는다.

**Exit gate:** schema와 version ledger가 사람 검토를 받고 evaluator 작성에 충분해야 한다. 이 단계의 "freeze 후보"는 dataset freeze를 의미하지 않는다.

### Phase 2. Dataset과 evaluator를 resolver보다 먼저 작성

- `E-001`에서 mutable dev dataset builder와 evaluator contract를 만든다.
- source-local, mapping missing, conflict, stale, terminal, dedupe, privacy, board precedence 사례를 합성 데이터로 작성한다.
- human labels와 provisional quality gate의 형식을 정의한다.

**Status (2026-08-13):** `E-001` v0.2 authenticated resolver integration과 automated evaluation checkpoint가 완료됐다. Final typecheck, targeted Vitest 8 files/112 tests와 lint가 pass했고 두 authoritative `npm run continuation:baseline` 실행도 pass했다. 22개 중 12 contract oracle과 실제 authenticated S-001→R-001→R-002→R-003 chain을 사용하는 9 resolver behavior case가 모두 통과했으며, B-001 cross-lane row 1개만 `not_evaluated`다. 모든 critical error count는 0이고 automatic review는 passed, human review는 `not_started`다. Dataset `suggestion-continuation-dev-v0.1` revision 2는 여전히 mutable/unfrozen이며 dataset/config SHA는 null이다. Acceptable@1/3과 setup quality는 null이고 release gate는 적용되지 않으며 decision은 deferred다. 기존 v0.1 JSON과 historical run은 변경하지 않았다. Final run IDs, private artifact metadata와 exact shared hashes는 ECR의 E-001 v0.2 section에 기록했다.

**Exit gate:** E-001 contract/resolver synthetic checkpoint는 충족했다. B-001 cross-lane row, human review, immutable dataset freeze, same-input comparison과 release gate는 후속 task로 열려 있다.

### Phase 3. Source adapters

- `S-001`에서 GitHub v6와 Codex v3 metadata를 versioned Continuation Observation으로 projection한다.
- commit subject, diff, raw prompt 또는 path를 추가 수집하지 않는다.
- source-local identity와 snapshot/activity time을 분리한다.

**Status (2026-08-13):** `S-001`의 pure adapter 구현과 automated validation이 완료됐다. GitHub snapshot v6와 Codex snapshot v3를 각각 `continuation-github-adapter-v0.1`, `continuation-codex-adapter-v0.1`로 projection하며, 출력 Observation/Input은 v0.2다. Private adapter batch contract/schema/hash는 v0.4이며 observations, identity bindings, exclusions, source assessment와 evaluation provenance를 포함한 canonical whole content를 installation-secret HMAC으로 인증한다. `evaluatedAsOf`는 available/unavailable 모두에 존재해 과거 failure assertion의 replay를 막고, available batch는 `snapshotFreshnessCutoff`와 `complete | partial | unknown` source assessment를 함께 묶는다. Adapter는 shadow-only이고 runtime, API, UI, persistence 또는 monitor에 연결되지 않았다. Secret과 raw repository/session identity, 이름, URL, path, prompt/summary text, commit text와 diff는 저장·출력하지 않는다. Activity window는 정확히 7일이고 stale/partial metadata와 metadata-only Codex count 0은 inactivity로 과장하지 않는다. 2026-08-13 KST 최종 실행에서 typecheck, targeted Vitest 7 files/89 tests와 lint가 pass했다. G2 privacy human approval은 pending이다.

**Exit gate:** adapter unit cases가 source fact를 과장하지 않고 versioned observation을 만든다.

### Phase 4. Identity, candidate, resolver shadow

- `R-001`에서 WorkContext와 exact remote proposal을 구현한다.
- `R-002`에서 single-source, corroborated, setup candidate를 derivation한다.
- `R-003`에서 score, diversity cap, conflict exclusion, deterministic tiebreak를 구현한다.
- resolver output은 shadow storage/monitoring에만 기록하고 UI에 표시하지 않는다.

**R-001 status (2026-08-13):** Pure identity input/result/schema/hash는 v0.4다. Input builder는 registry 전체를 별도 domain의 installation-secret HMAC으로 인증하고 resolver는 caller artifact의 HMAC만으로 currentness를 추정하지 않는다. 별도 trusted option `expectedRegistrySha256`가 현재 registry와 정확히 일치해야 mapping을 수행한다. Resolver는 private adapter batch v0.4 whole-content proof와 identity binding proof를 검증하고, terminal explicit-user confirmed registry decision과 scope binding이 일치할 때만 WorkContext를 부여한다. 결과는 available-empty source까지 포함해 exact adapter-batch hash, `evaluatedAsOf`와 `snapshotFreshnessCutoff`를 canonical freshness evaluation으로 전달한다. Proof 누락/동일 중복은 input reject, 서로 다른 유효 proof의 다중 scope는 `conflict/null`, confirmed mapping 부재나 terminal remove/unmapped는 `setup_needed/null`이다. Persistence, API, UI, runtime wiring, auto-confirmation 또는 project auto-selection은 없다. 2026-08-13 KST 최종 실행에서 typecheck, targeted Vitest 7 files/89 tests와 lint가 pass했다. Persistent mapping/correction/removal은 post-MVP human gate이며 G2는 pending이다.

**R-002 status (2026-08-13):** Deterministic candidate derivation envelope/result/schema/hash는 v0.3이고 rule/config는 v0.2다. Fresh mapped GitHub/Codex observation은 display-only/null-target single-source candidate가 되고, exact same WorkContext의 GitHub+Codex만 corroborated `linked_workstream`으로 결합한다. 이름/시간 유사성은 사용하지 않는다. `setup_needed`와 `conflict`는 각각 reason-bound deterministic private descriptor를 가진 non-executable `workspace_mapping` Setup candidate가 되며 conflict는 ready candidate가 아니다. Admission은 exact 7-day expiry, nonfuture/nonterminal/no observation conflict/error와 R-001 freshness provenance를 요구한다. Partial/unknown coverage와 terminal unknown은 caveat로만 허용한다. Result schema는 artifact integrity를 검증하고 provenance-sensitive consumer는 exact R-001 input과 envelope로 rederive/canonical compare하는 input-bound verifier를 사용해야 한다. API, UI, runtime, Board, persistence, monitor와 E-001 rows는 연결하지 않았다.

**R-003 status (2026-08-13):** Provisional deterministic scoring/resolution core와 E-001 v0.2 synthetic resolver checkpoint가 구현·검증됐다. Scoring result/schema, resolver와 scoring policy, resolution envelope/schema 및 distinct resolved-decision artifact/schema/hash는 v0.1이다. Resolver는 original authenticated R-001 input과 out-of-band trust expectations로 full chain을 재검증한다. Ready pool은 Setup보다 항상 우선하고 score 내림차순/`candidateId` 오름차순, WorkContext당 최대 1개, 전체 최대 3개로 선택한다. Full authenticated two-source complete/fresh coverage이고 quality exclusion이 없을 때만 offer가 `COMPLETE`; proven normal empty는 `no_recent_context/COMPLETE`; Setup은 항상 `SOURCE_LOCAL_PARTIAL`이다. Final validation은 typecheck, targeted Vitest 8 files/112 tests와 lint pass이며 E-001은 12/12 contract와 9/9 resolver rows를 통과했다. 이는 `contract_and_resolver_regression_only` evidence이며 quality, shadow activation 또는 release 승인이 아니다.

**Exit gate:** Core deterministic replay, Dev dataset resolver integration과 private evaluation-run provenance 기록은 충족했다. B-001, human review, G2/G3/G8와 shadow/release 승인은 미충족이다.

### Phase 5. Board composer와 Active byte equivalence

- `B-001`에서 Attention, Continuation, Setup의 precedence와 cross-lane dedupe를 구현한다.
- Board composer는 lane result를 입력으로 받고 lane 내부 fact를 재판정하지 않는다.
- feature flag가 꺼졌을 때 기존 Attention projection과 result hash가 동일한지 검증한다.

**Exit gate:** Active behavior 변화가 없고 unknown mixed version이 fail closed한다.

### Phase 6. API와 웹 표시

- `A-001`에서 `/api/continuation`, `/api/work-board`, `/api/continuation/open`의 초기 link-only 계약을 추가한다.
- `U-001`에서 `지금 처리할 일`, `이어서 할 일`, `연결할 일`을 구분한다.
- `Attention.no_action`을 전체 추천 실패로 표현하지 않는다.
- source-local 후보는 bounded copy와 evidence band를 표시한다.

**Exit gate:** web flag가 켜진 승인된 환경에서 primary 1개와 alternatives 최대 2개가 안전하게 표시된다.

### Phase 7. Mapping과 Setup 흐름 — Post-MVP

- `R-001`, `U-001`, `X-001`을 확장해 exact remote proposal, workspace 선택, 사용자 확인, correction/removal을 구현한다.
- mapping은 append-only reviewed change 또는 tombstone semantics를 따른다.
- 이 단계 전의 MVP CTA는 setup surface를 여는 navigation일 뿐 registry 또는 confirmed selection을 저장하지 않는다.

**Entry gate:** persistent mapping, correction/removal 및 confirmed session selection에 대한 별도 human approval이 기록되어야 한다.

**Exit gate:** 사용자 확인 없는 persistent mapping이 없으며 conflict가 exact capability로 승격되지 않는다.

### Phase 8. Explicit open 후 exact resume

- 먼저 `open_source`, `map_workspace`, `select_session`을 action-time revalidation과 함께 활성화한다.
- 이후 별도 승인으로 work resumption protocol v2와 `resume_exact_session`을 추가한다.
- exact resume은 30초 제안 TTL, heartbeat, scope, binding revalidation을 요구한다.

**Exit gate:** invalid offer가 `409`으로 중단되고 prompt, command, retry 또는 mutation이 없다.

### Phase 8B. Reviewable prompt draft auto-fill — Post-MVP 별도 gate

- exact action target과 현재 session/scope를 action-time에 다시 검증한다.
- versioned bounded template로 만든 prompt draft를 사용자가 볼 수 있는 composer에 자동 입력한다.
- visible preview와 explicit user confirmation 없이는 전송하지 않는다.
- source label, commit text 또는 task summary를 instruction authority로 해석하지 않는다.
- automatic send, approval, command execution, retry 또는 external mutation은 이 목표에 포함되지 않는다.

**Entry gate:** exact resume 계약, prompt schema/template, privacy/retention, injection defense, security review 및 별도 human approval.

**Exit gate:** auto-fill은 reviewable draft만 만들며 전송과 실행은 사용자의 별도 명시적 행동 전에는 0건이다.

### Phase 9. Launcher v3

- `L-001`에서 optional Continuation/Board projection을 launcher v3에 추가한다.
- older decoder/read compatibility를 유지한다.
- web rollout의 안전성과 품질 gate를 통과한 뒤 별도 flag로 활성화한다.

**Exit gate:** launcher에서 unknown schema가 fail closed하며 Active-only fallback이 동작한다.

### Phase 10. Monitoring, replay, feedback

- `M-001`에서 lane별 provenance, error, conflict, latency, deterministic replay를 기록한다.
- explicit feedback taxonomy와 resettable bounded preference를 추가한다.
- click/no-click은 analytics로만 보존하고 Gold 승격을 금지한다.

**Exit gate:** critical safety metric과 privacy sentinel을 release review에서 확인할 수 있다.

### Phase 11. 검토, dataset freeze, rollout

- `Q-001`에서 전체 test matrix와 manual UX/privacy review를 수행한다.
- 사람이 dataset item과 label을 검토한 뒤 새 regression dataset을 freeze하고 version/hash를 기록한다.
- `P-001`에서 provisional 75/90 hypothesis를 실제 human-reviewed 결과와 함께 승인 또는 조정한다.
- shadow, attention_lab, web, link-only, explicit resume, launcher 순서로 rollout한다.

**Exit gate:** human approval과 release record가 있어야 한다. 이 문서는 해당 승인이 이루어졌다고 주장하지 않는다.

## 7. 작업 목록

| ID | 작업 | Owner role | Dependencies | 주요 파일 | Deliverables | Done 기준 | Validation | Human approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `D-001` | 제품 결정 및 draft ECR | User + Codex | 없음 | `docs/ENGINE_CHANGE_RECORD.md`, vNext 문서 | 승인된 MVP 정책 로그, responsibility assignment, draft ECR, privacy/rollback 계획 | **Complete for planning on 2026-08-12** | AI document QA; human product decision recorded | **C-001 may start; release remains unapproved** |
| `C-001` | 계약과 version ledger | Engine architect | `D-001` | `src/continuation/contracts.ts`, `src/suggestionBoard/contracts.ts`, version registry | Zod/TS schema, canonical hash 계약, compatibility matrix | unknown/mixed version fail-closed 규칙 포함 | Contract unit tests, typecheck | Required for contract freeze candidate |
| `E-001` | Dataset builder와 evaluator | Evaluation owner | `C-001` | `eval/synthetic/continuation*`, `src/evaluation/continuation/*`, `tools/run-continuation-baseline.ts`, `.local/` private artifacts | v0.2 mutable dev dataset/evaluator, authenticated R-003 fixtures, bounded private-artifact runner | **v0.2 synthetic regression checkpoint complete on 2026-08-13.** 12/12 contract + 9/9 resolver passed; only B-001 row deferred | Typecheck pass; targeted Vitest 8 files/112 tests pass; lint pass; final runs `continuation_eval_run_bb3fa6da77edc64e74d976bbe1a8999e`, `continuation_eval_run_a74dc27b4c9b6fa9a78e72ad4b668966` pass | Human review not started; mutable/unfrozen, not Gold; quality/release deferred, flags off |
| `S-001` | GitHub/Codex adapters | Connector owner | `C-001` | `src/continuation/adapters.ts`, `src/continuation/index.ts` | v6/v3 → Observation v0.2 + private batch v0.4 whole-content HMAC/source assessment/evaluation time | **Implemented and automatically validated locally.** Pure unwired projection, all-status replay-bound evaluation time, available cutoff/assessment, exact 7-day window, partial/count-0 semantics | 2026-08-13 KST: typecheck pass; targeted Vitest 7 files/89 tests pass; lint pass | G2 privacy sign-off required before activation |
| `R-001` | WorkContext identity resolution | Identity owner | `C-001`, `S-001` | `src/continuation/resolveIdentity.ts`, `src/continuation/index.ts` | v0.4 authenticated registry/batches + trusted current registry SHA → mapped/setup/conflict | **Implemented and automatically validated locally.** Exact confirmed mapping only; registry rollback, inconsistent identity meaning and invalid proof fail closed; persistence/API/UI/runtime/auto-selection 없음 | 2026-08-13 KST: typecheck pass; targeted Vitest 7 files/89 tests pass; lint pass | G2 pending; persistent mapping/correction은 post-MVP human gate; activation/release unapproved |
| `R-002` | Candidate derivation | Engine implementer | `E-001`, `S-001`, `R-001` | `src/continuation/deriveCandidates.ts`, `src/continuation/index.ts` | envelope/result/schema v0.3, rule/config v0.2; exact candidates and input-bound verifier | **Implemented and automatically validated locally.** Exact 7-day/freshness provenance, same-WorkContext-only linking, display-only mapped candidates, non-executable setup descriptors, canonical IDs/hashes | 2026-08-13 KST: typecheck pass; targeted Vitest 7 files/89 tests pass; lint pass; evaluator/baseline deferred | G2 and shadow activation approvals pending; no release claim |
| `R-003` | Score와 Continuation resolver | Engine implementer | `R-002` | `src/continuation/scoreContinuity.ts`, `src/continuation/resolveContinuation.ts` | v0.1 provisional score/result/resolver/resolution envelope/distinct decision artifact, full input-bound verifier | **Core and E-001 v0.2 synthetic checkpoint complete.** Deterministic score/selection, authenticated coverage, trusted expectations and full-chain verification; 9/9 resolver rows pass | 2026-08-13 KST: typecheck pass; targeted Vitest 8 files/112 tests pass; lint pass; two authoritative baseline runs pass | G2/G3/G8 and shadow activation approval pending; no recommendation-quality/release claim |
| `B-001` | Work Suggestion Board composer | Engine architect | `R-003` | `src/suggestionBoard/composeBoard.ts` | precedence, dedupe, primary/alternatives projection | Active fact 재판정 없음, mixed version fail closed | Board regression, Active byte-equivalence | Dual-lane flag approval required |
| `A-001` | Continuation/Board API | API owner | `B-001` | `app/api/continuation/route.ts`, `app/api/work-board/route.ts`, `app/api/continuation/open/route.ts` | GET decision/board, POST offer action contract | native identifier 미노출, same-origin/local-only, typed errors | API contract/integration tests | Public API review required |
| `U-001` | 웹 UI | Web owner | `A-001` | `app/WorkCockpit.tsx`, client projection/components | lane별 UI, bounded copy, CTA, caveat | no-action 문구 모순 제거, primary 1 + alt ≤2 | Component/manual accessibility/UX checks | Copy and privacy approval required |
| `X-001` | Action gateway | Security + Runtime owner | `A-001`, `R-001`, `U-001` | `src/continuation/actions/*`, resumption protocol/store | offer store, TTL, revalidation, typed failure | 자동 실행/재시도/mutation 없음, invalid offer 409 | Race/expiry/security integration tests | **Required before any action activation** |
| `L-001` | Launcher v3 projection | macOS owner | `X-001`, web rollout evidence | launcher TS/Swift projection and presentation files | optional Continuation board, older reader compatibility | unknown version fail closed, Active fallback 유지 | Decoder/Swift tests, manual launcher check | Launcher rollout approval required |
| `M-001` | Monitor, replay, feedback | Observability + Evaluation owner | `C-001`, then each runtime phase | monitoring/replay schema, feedback store | provenance, lane metrics, explicit feedback | implicit signal Gold 금지, resettable preference | Schema/replay/privacy tests | Retention/feedback approval required |
| `Q-001` | 통합 QA 및 회귀 검토 | QA reviewer | `E-001`~`M-001` applicable scope | tests, QA report, private run artifacts | test report, risk findings, manual checklist | critical error 0 후보 기준 검증, unresolved risk 명시 | 전체 승인 test matrix | Human QA sign-off required |
| `P-001` | Freeze와 단계적 rollout | Product + Engine + Security owner | `Q-001` | dataset records, ECR, rollout/release record | human-reviewed frozen dataset, recorded hashes/run IDs, rollout decision | 실제 provenance와 rollback owner가 기록됨 | Locked holdout + staged observation | **Required for every promotion stage** |

Owner role은 task 책임 범주다. 실제 governance는 User가 product decision/release approver, Codex가 AI implementation executor/record author, `qa_reviewer` agent가 advisory technical reviewer이며 human dataset reviewers/adjudicator는 pending이다.

## 8. 예상 파일 변경 목록

다음은 계획된 범위이며 현재 생성 또는 수정되었다는 의미가 아니다.

### 8.1 신규 engine 파일 후보

```text
suggestion/src/continuation/contracts.ts
suggestion/src/continuation/adapters/github.ts
suggestion/src/continuation/adapters/codex.ts
suggestion/src/continuation/resolveIdentity.ts
suggestion/src/continuation/deriveCandidates.ts
suggestion/src/continuation/scoreContinuity.ts
suggestion/src/continuation/resolveContinuation.ts
suggestion/src/continuation/actions/contracts.ts
suggestion/src/continuation/actions/openOffer.ts
suggestion/src/suggestionBoard/contracts.ts
suggestion/src/suggestionBoard/composeBoard.ts
```

### 8.2 신규 API 후보

```text
suggestion/app/api/continuation/route.ts
suggestion/app/api/continuation/open/route.ts
suggestion/app/api/work-board/route.ts
```

### 8.3 평가 파일 후보

```text
suggestion/src/evaluation/continuation/contracts.ts
suggestion/src/evaluation/continuation/buildDataset.ts
suggestion/src/evaluation/continuation/evaluate.ts
suggestion/src/evaluation/continuation/run.ts
suggestion/src/evaluation/continuation/__tests__/*
suggestion/src/evaluation/suggestionBoard/__tests__/*
```

### 8.4 기존 통합 seam 후보

```text
suggestion/src/attention/liveAttention.ts
suggestion/src/attention/monitoringSchema.ts
suggestion/src/attention/versions.ts
suggestion/src/connectors/github/*
suggestion/src/connectors/codex/*
suggestion/src/resumption/contracts.ts
suggestion/app/WorkCockpit.tsx
suggestion/app/attentionClient.ts
suggestion/docs/ENGINE_CHANGE_RECORD.md
macOS launcher projection/service/contracts and Swift presentation files
```

기존 파일 변경은 task별 소유권을 배정한 뒤 최소 diff로 수행한다. Active 경로 변경이 불필요하면 별도 composer/service에서 통합하고 기존 파일을 건드리지 않는 방안을 우선한다.

## 9. Production dependency 정책

- MVP는 새 production dependency를 추가하지 않는다.
- 기존 TypeScript, Zod, Vitest, Next.js 패턴을 재사용한다.
- dependency가 필요하다고 판단되면 구현 전에 대안, bundle/runtime 영향, 보안 및 유지보수 비용을 문서화하고 사람 승인을 받는다.

## 10. Test matrix

### 10.1 MVP-required matrix

| 영역 | 필수 사례 | 기대 결과 |
| --- | --- | --- |
| Attention isolation | flags off/on, Continuation input permutation | 기존 candidate, eligibility, ranking, result hash byte-equivalent |
| GitHub adapter | recent push, stale snapshot, future timestamp, partial coverage | 직접 사실만 observation으로 보존, 적절한 caveat/error |
| Codex adapter | recent session, metadata-only, bounded summary, terminal historical | 미완료/긴급 오표현 없음 |
| Identity | exact remote proposed, same name/different repo, conflicting existing links | 자동 confirmation 없음, conflict exclusion |
| Candidate | single-source, corroborated, mapping missing, terminal | bounded candidate 또는 Setup, terminal 제외 |
| Score | recency buckets, one WorkContext duplicate signals, diversity cap, ties | 35/25/20/10/10 규칙과 stable tiebreak |
| Router | Attention only, Continuation only, Setup only, simultaneous lanes | precedence 준수, cross-lane dedupe, primary 1 + alt ≤2 |
| API | supported/unknown versions, private identifier sentinel, action errors | mixed version fail closed, raw target 미노출 |
| Action | open-source expiry, invalid target, setup CTA | 재검증 실패 시 409, setup surface navigation 외 상태 변경 없음 |
| Privacy | SHA, URL, path, prompt, diff, token sentinel | public projection과 tracked artifact에 노출 0 |
| Feedback | explicit/implicit split, reset, bounded weight | click은 analytics-only, safety/identity 불변 |
| Compatibility | Recent Work v0.2, older resumption reader, launcher decoder | 명시된 compatibility 유지 또는 fail closed |
| Determinism | identical canonical input, shuffled order, replay | 동일 decision/result hash |
| UX | no Attention + recent work, mapping missing, all empty | 모순 없는 lane copy와 안전한 CTA |
| Existing Local Git v1 | 영향받는 변경이 있을 때 compatibility와 privacy regression | 기존 v1 동작과 privacy boundary 유지 |

### 10.2 Post-MVP 또는 contract fixture-only matrix

| 영역 | 사례 | Gate 의미 |
| --- | --- | --- |
| Persistent mapping | confirm, correction, removal, conflicting confirmed links | Phase 7 human gate 이후 release blocker |
| Confirmed selection | session 선택 저장, rebind, deletion | Phase 7 human gate 이후 release blocker |
| Local Git v2 | dirty, staged, ahead, behind, diverged, exact three-source join | Local Git v2 구현 단계의 release blocker이며 MVP blocker 아님 |
| Exact resume | expired offer, heartbeat race, replayed offer, session deletion | Phase 8 security/human gate 이후 release blocker |

Post-MVP 사례는 future contract를 위한 synthetic fixture로 먼저 추가할 수 있다. Local Git v2와 persistent mapping이 구현되기 전에는 MVP release blocker가 아니다. 단, 기존 Local Git v1 코드나 projection이 영향을 받으면 10.1의 compatibility/privacy regression은 계속 필수다.

### 10.3 승인된 구현 단계에서 실행할 명령

```bash
cd /Users/joo/BiaDone/apps/blabase/suggestion
npm test
npm run typecheck
npm run lint
npm run build
npm run continuation:baseline
```

`npm run continuation:baseline`은 `E-001`에서 wiring됐다. Historical v0.1 run은 그대로 보존되며, 2026-08-13 v0.2의 final authoritative runs `continuation_eval_run_bb3fa6da77edc64e74d976bbe1a8999e`와 `continuation_eval_run_a74dc27b4c9b6fa9a78e72ad4b668966`도 pass했다. Private artifact metadata, exact dataset/materialized/config/deterministic hashes, counts와 dirty-worktree fingerprint는 Engine Change Record의 E-001 sections에 기록됐다. 이후 문서-only 기록 변경은 해당 run provenance를 바꿔 쓰지 않으며 baseline 재실행을 요구하지 않는다.

## 11. Engine Change Record와 release provenance

Behavior-changing 단계마다 `/Users/joo/BiaDone/apps/blabase/suggestion/docs/ENGINE_CHANGE_RECORD.md`의 프로젝트 규칙과 상위 recordkeeping guide를 따른다.

최소 기록 항목은 다음과 같다.

- change objective와 affected lanes
- dataset version 및 SHA-256
- code version
- schema, rule, score, identity, freshness, action policy version
- configuration hash
- before/after run IDs
- 동일 frozen input 사용 확인
- evidence, confidence band, verification status, conflict, error
- latency와 token usage
- privacy 및 retention impact
- test, typecheck, lint, build 결과
- rollback flags와 owner
- unresolved risk와 human approval

실제 실행 전에는 placeholder를 사실처럼 채우지 않는다. dataset hash, run ID, metric, test pass, release version은 실행 결과가 생성된 뒤에만 기록한다.

## 12. Rollout과 rollback

### 12.1 Flags

```text
continuationResolution: off -> shadow -> active
continuationPresentation: off -> attention_lab -> web -> launcher
continuationAction: disabled -> link_only -> explicit_resume
boardComposer: legacy -> dual_lane
```

### 12.2 Promotion 순서

1. `continuationResolution=shadow`
2. 내부 monitor 및 replay 검토
3. `continuationPresentation=attention_lab`
4. human-reviewed dogfood
5. `continuationPresentation=web`
6. `continuationAction=link_only`
7. 별도 security 승인 후 `continuationAction=explicit_resume`
8. 별도 launcher 승인 후 `continuationPresentation=launcher`

### 12.3 Rollback 순서

1. action을 `disabled`로 전환한다.
2. presentation을 이전 단계 또는 `off`로 전환한다.
3. board composer를 `legacy`로 전환한다.
4. resolution을 `shadow` 또는 `off`로 전환한다.

Rollback은 Active Attention을 수정하거나 재배포하지 않고 수행할 수 있어야 한다. Unknown mixed version은 Continuation/Board에서 fail closed한다.

## 13. 주요 위험과 완화

| 위험 | 영향 | 완화 |
| --- | --- | --- |
| 최근 활동을 미완료 또는 중요 작업으로 오표현 | 사용자 신뢰 저하 | bounded copy, terminal rule, 중요도 표현 금지 |
| 이름 기반 오매핑 | 잘못된 작업 열기 또는 resume | opaque identity, exact remote proposal, user confirmation, conflict exclusion |
| stale snapshot을 현재 상태로 표현 | 잘못된 제안 | snapshot freshness 별도 versioning, current-state copy 제한 |
| 한 repository의 이벤트가 ranking 독점 | 후보 다양성 저하 | latest meaningful signal, WorkContext diversity cap |
| Board가 Attention 의미를 바꿈 | 안전성 회귀 | independent lane results, byte-equivalence, no cross-lane score |
| action offer 재사용 또는 race | 잘못된 session 실행 | TTL, one-time/validated offer, action-time revalidation, 409 |
| 민감한 repository/session 정보 노출 | privacy incident | local alias default, private action store, sentinel tests |
| implicit feedback이 잘못된 학습 신호가 됨 | ranking drift | analytics-only, explicit feedback만 bounded learning |
| version 조합 불일치 | 해석 불가능한 결과 | compatibility matrix, unknown mixed fail closed |
| 과도한 초기 범위 | 일정과 품질 악화 | existing metadata와 link-only MVP로 제한 |

## 14. Deferred work

- Local Git v2 collector와 local continuity 세부 규칙
- commit subject 또는 changed-file category의 opt-in 수집
- exact Codex resume와 work resumption protocol v2
- Launcher v3 기본 활성화
- cross-device WorkContext sync
- semantic clustering 또는 LLM-assisted labeling
- organization/shared project identity
- 외부 source mutation
- feedback 기반 개인화의 장기 학습
- reviewable prompt draft auto-fill 및 별도 automatic send/execution 정책

Deferred 항목은 이 문서의 MVP acceptance에 포함하지 않는다. 각 항목은 별도 privacy, security, schema, dataset 및 ECR 검토가 필요하다.

## 15. Human gates

| Gate | 필요한 결정 |
| --- | --- |
| G0: Planning approval | spec/plan의 방향, owner, scope 승인 |
| G1: Contract approval | schema, version, hash, compatibility 승인 |
| G2: Privacy approval | labels, retention, prohibited fields, source adapters 승인 |
| G3: Shadow approval | mutable dev dataset과 evaluator 준비, shadow 기록 승인 |
| G4: Web presentation approval | copy, single-source primary, Setup CTA, accessibility 승인 |
| G5: Link-only action approval | allowlist, same-origin/local-only, revalidation 승인 |
| G6: Exact resume approval | protocol v2, TTL, heartbeat, race/security test 승인 |
| G7: Dataset freeze approval | human labels, lawful basis, anonymization, hash 승인 |
| G8: Release approval | locked holdout, critical errors 0, 75/90 기준 승인 또는 조정 |
| G9: Launcher approval | decoder compatibility와 macOS UX 승인 |
| G10: Prompt draft auto-fill approval | exact target, bounded template, visible preview, injection defense, privacy/retention 승인 |
| G11: Automatic prompt send/execution approval | 이번 승인 범위 밖; 별도 product/security/ECR/release decision 없이는 금지 |

어떤 agent도 이 문서만으로 gate 통과를 주장할 수 없다. 승인 주체, 날짜, 근거 artifact를 별도 기록해야 한다.

## 16. Human decision status

### 16.1 Resolved for MVP on 2026-08-12

- 모든 valid Active Attention이 primary 우선이며, 없을 때 Continuation이 primary다.
- single-source GitHub/Codex 후보를 bounded non-urgent copy/action 조건으로 primary에 허용한다.
- activity window는 7일이며 snapshot freshness는 source별 versioned policy로 분리한다.
- exact remote match는 proposal/prefill만 자동화하고 persistent mapping은 explicit confirmation을 요구한다.
- verified repository/project 이름은 local web/macOS에 표시하고 external telemetry, monitor, replay, evaluation artifact에는 raw 이름을 넣지 않는다. alias/hide를 지원한다.
- MVP action은 source/setup/session-selection surface navigation만 허용한다.
- explicit feedback만 bounded Continuation ranking에 사용하며 click/no-response는 analytics-only다.
- provisional gate는 human-reviewed frozen input에서 critical error 0, Acceptable@1 >= 75%, Acceptable@3 >= 90%이며 rollout 단계마다 별도 승인을 요구한다.
- reviewable prompt draft auto-fill은 post-MVP 제품 목표지만 automatic send/execution은 승인되지 않았다.

### 16.2 Still open

- strict `focus`/`close_loop`와 pinned Continuation의 future precedence revision
- source별 정확한 snapshot freshness TTL과 failure policy
- observation, alias, feedback 및 action offer의 정확한 retention 기간
- exact resume binding, heartbeat 및 TTL 정책
- prompt draft source/template/privacy와 automatic send/execution의 별도 정책
- reviewer 수, disagreement 처리, holdout 규모 및 lawful basis
- privacy/security 검토 범위와 human dataset reviewers/adjudicator 지정
- 실제 frozen evaluation 결과에 따른 75/90 가설의 유지 또는 조정

### 16.3 Responsibility boundaries

- User는 제품 정책과 최종 release를 승인하지만, 구현 승인만으로 dataset freeze 또는 rollout이 자동 승인되지는 않는다.
- Codex는 구현과 기록을 수행하지만 자신의 결과를 승인하거나 알려진 위험을 수용할 수 없다.
- `qa_reviewer` agent의 검토는 advisory AI review이며 human review, regulatory certification 또는 release decision이 아니다.
- 실행하지 않은 검사는 `not_run`, 증거가 없는 값은 `unknown` 또는 `pending`으로 기록한다.

## 17. 현재 작업 상태 (2026-08-13)

- `D-001`, `C-001`, E-001 v0.2 authenticated resolver integration, `S-001`, `R-001`, `R-002`와 `R-003` core의 pure unwired synthetic checkpoint가 완료됐다. API, UI, runtime, Board, persistence, monitor, action과 production flag wiring은 아직 없다.
- Exact internal tuple은 private adapter batch v0.4, R-001 identity input/result/schema/hash v0.4, R-002 envelope/result/schema/hash v0.3와 rule/config v0.2, R-003 scoring result/schema/resolver/scoring policy v0.1, resolution envelope/schema v0.1, distinct resolved-decision artifact/schema/hash v0.1, E-001 dataset/case contract v0.2, evaluator config v0.2와 evaluator/run policy v0.2다. Base Decision v0.2는 nested body일 뿐 authenticity marker가 아니다.
- S-001 v0.4는 canonical whole-batch HMAC, source assessment와 모든 status의 `evaluatedAsOf`를 묶는다. R-001 v0.4는 registry authority HMAC에 더해 trusted current `expectedRegistrySha256`를 요구한다. R-003는 모든 batch time을 exact resolver `asOf`에 묶고 trusted registry/code/dataset expectations를 확인한다. Legacy 또는 mixed tuple은 fail closed하며 persisted/production artifact가 없어 migration은 없다.
- R-002는 display-only mapped candidate, exact same-WorkContext linked candidate와 non-executable Setup descriptor를 canonical하게 derivation한다. R-003는 full original input에서 R-001을 재실행하고 R-002 input-bound verifier를 거친 뒤 provisional score와 selection을 적용한다. Ready는 Setup보다 우선하며 최대 3개, score/candidate-ID order와 WorkContext diversity를 사용한다.
- Full authenticated two-source complete/fresh proof에 quality exclusion이 없을 때만 offer가 `COMPLETE`다. Normal empty/outside-window의 `no_recent_context`도 동일 proof를 요구하며 Setup은 항상 partial이다. Artifact schema는 local integrity boundary이고 provenance-sensitive consumer는 full-chain `verifyContinuationDecisionAgainstInput`을 사용해야 한다.
- 2026-08-13 KST 최종 validation에서 `npm run typecheck`, targeted Vitest 8 files/112 tests와 `npm run lint`가 모두 pass했다. 두 final E-001 runs도 22 total, 21 measured/pass, 12/12 contract, 9/9 resolver, 1 B-001 deferred와 critical error 0으로 pass했다. 이 checkpoint는 contract/provenance/scoring/resolver regression evidence이며 quality baseline이나 release evidence가 아니다.
- E-001 v0.2는 actual authenticated chain을 사용하는 9 resolver row를 측정한다. Codex historical-completed metadata는 live terminal authority가 아니므로 terminal unknown의 bounded semantics를 검증한다. Same-name oracle은 이름만으로 link/auto-confirm하지 않고 Setup으로 남는다는 의미이며 fabricated identity conflict를 주장하지 않는다. B-001 cross-lane case만 Board 구현까지 deferred다.
- Evaluator는 구조상 evaluation-only이며 production consumer에 연결되지 않았다. Active의 실제 runtime input, candidate universe, eligibility, ordering, result byte/hash equivalence도 deferred다. 다음 code task는 B-001이고, outer R-003 artifact와 mandatory input-bound verifier를 함께 소비해야 한다.
- Dataset은 mutable Dev Candidate이며 freeze 또는 human-approved Gold가 아니다. Human review는 시작되지 않았고 comparison, improvement, resolver quality, release readiness 또는 rollout도 주장하거나 승인하지 않는다.
- Historical v0.1 JSON과 run `continuation_eval_run_df5a85b1e2bb784355c035969f835380`은 다시 쓰지 않았다. Final v0.2 runs는 comparison/improvement run이 아니며 Acceptable@1/3과 setup quality는 null이다. Dataset은 `suggestion-continuation-dev-v0.1` revision 2 mutable/unfrozen, automatic review passed, human review `not_started`, release deferred다. G2/G3/G8 및 shadow/presentation approval은 pending이다.
- 새 production dependency는 추가하지 않았다.
