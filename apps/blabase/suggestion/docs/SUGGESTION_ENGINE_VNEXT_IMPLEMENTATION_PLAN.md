# Suggestion Engine vNext Implementation Plan

| 항목 | 값 |
| --- | --- |
| Status | **Draft — planning only; AI proposal, not human approval** |
| Date | 2026-08-12 |
| Owner | User (product decision and release approver); Codex (AI implementation executor and record author) |
| Authority | `SUGGESTION_ENGINE_VNEXT_TECH_SPEC.md` |

> 이 문서는 구현 순서와 승인 gate를 제안하는 planning artifact다. 구현 승인, 데이터셋 동결, 테스트 통과, 배포 승인 또는 release readiness를 의미하지 않는다.

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

이 상태 진술은 새 runtime 조사나 테스트 결과가 아니라 현재 설계 문맥을 정리한 것이다.

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
        ├── E-001 Dataset/evaluator scaffolding ──────┐
        ├── S-001 Source adapters ────────────────────┤
        └── R-001 Identity/mapping ───────────────────┤
                                                     ▼
                                            R-002 Candidate derivation
                                                     │
                                                     ▼
                                            R-003 Score/resolver shadow
                                                     │
                                                     ▼
                                            B-001 Board composer
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

`R-002`는 `E-001`, `S-001`, `R-001`을 모두 dependency로 가진다. `E-001`의 최소 synthetic cases와 evaluator contract가 준비되기 전에는 `R-002` 구현을 시작하거나 `R-003` behavior를 production path에 연결하지 않는다.

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

**Status (2026-08-12):** `E-001` 구현과 automated evaluation checkpoint가 완료됐다. Targeted Vitest 3개 파일은 39/39, 최종 typecheck와 lint는 pass했고 `npm run continuation:baseline`도 pass했다. Baseline run `continuation_eval_run_df5a85b1e2bb784355c035969f835380`은 22개 중 executable contract oracle 12개를 모두 통과시켰고 10개 resolver behavior case는 `not_evaluated`로 deferred했다. `exactOraclePassRate=1`, 모든 recorded critical failure count는 0, automatic review는 passed이며 human review는 `not_started`다. Private artifact와 전체 hash/provenance는 Draft ECR의 E-001 section에 기록됐다. Dataset은 여전히 mutable Dev Candidate이고 frozen dataset, human-approved Gold, comparison/improvement, resolver quality 또는 release claim이 아니다. Release는 deferred, `releaseEligible=false`이고 관련 flag는 off다. `HS-001` pass는 contract-level evidence만 제공하며 Active runtime integration equivalence는 deferred다.

**Exit gate:** E-001 scaffold와 automated evaluation checkpoint는 충족했다. Resolver behavior 10개 평가, human review, immutable dataset freeze, same-input comparison과 release gate는 후속 task로 열려 있다.

### Phase 3. Source adapters

- `S-001`에서 GitHub v6와 Codex v3 metadata를 versioned Continuation Observation으로 projection한다.
- commit subject, diff, raw prompt 또는 path를 추가 수집하지 않는다.
- source-local identity와 snapshot/activity time을 분리한다.

**Status (2026-08-12):** `S-001`의 pure adapter 구현과 unit case 작성은 완료됐고 automated validation을 기다리고 있다. GitHub snapshot v6와 Codex snapshot v3를 각각 `continuation-github-adapter-v0.1`, `continuation-codex-adapter-v0.1`로 projection하며, 출력 경계는 Continuation Observation/Input v0.2다. Adapter는 shadow-only이고 runtime, resolver, API, UI 또는 persistence에 연결되지 않았다. Keyed HMAC opaque reference만 보존하며 raw repository/session identity, 이름, URL, path, prompt/summary text, commit text와 diff를 추가 수집하거나 출력하지 않는다. Activity window는 7일이고 snapshot freshness cutoff는 caller가 제공하며, stale/partial metadata와 metadata-only Codex count 0은 inactivity로 과장하지 않는다. 관련 unit tests는 작성됐지만 typecheck, test, lint와 baseline은 아직 실행하지 않았다. G2 privacy human approval도 pending이다.

**Exit gate:** adapter unit cases가 source fact를 과장하지 않고 versioned observation을 만든다.

### Phase 4. Identity, candidate, resolver shadow

- `R-001`에서 WorkContext와 exact remote proposal을 구현한다.
- `R-002`에서 single-source, corroborated, setup candidate를 derivation한다.
- `R-003`에서 score, diversity cap, conflict exclusion, deterministic tiebreak를 구현한다.
- resolver output은 shadow storage/monitoring에만 기록하고 UI에 표시하지 않는다.

**Exit gate:** deterministic replay와 dev dataset evaluation 결과를 실제 run provenance와 함께 기록할 수 있어야 한다.

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
| `E-001` | Dataset builder와 evaluator | Evaluation owner | `C-001` | `eval/synthetic/continuation*`, `src/evaluation/continuation/*`, `tools/run-continuation-baseline.ts`, `.local/` private artifacts | mutable dev dataset, case/config/run schema, evaluator, bounded private-artifact runner | **Implementation and automated evaluation checkpoint complete on 2026-08-12.** 12/12 executable contract oracles passed; 10 resolver behavior cases remain deferred | Targeted Vitest 39/39, final typecheck pass, lint pass, `npm run continuation:baseline` pass; run `continuation_eval_run_df5a85b1e2bb784355c035969f835380` | Human review not started; not frozen or Gold; release deferred, not eligible, flags off |
| `S-001` | GitHub/Codex adapters | Connector owner | `C-001` | `src/connectors/github/*`, `src/connectors/codex/*`, `src/continuation/adapters/*` | v6/v3 → Observation projection | **Implemented locally; awaiting automated validation.** Pure shadow-unwired projection, keyed opaque references, 7-day activity window, caller freshness cutoff, partial/count-0 semantics | Adapter unit tests authored; typecheck/test/lint not run | G2 privacy sign-off required; not complete for activation |
| `R-001` | WorkContext identity와 mapping | Identity owner | `C-001`, `S-001` | `src/continuation/resolveIdentity.ts`, context store/API | WorkContext, proposed/confirmed/conflict link | exact remote은 proposal만 생성, correction/removal 지원 | Identity matrix tests | Mapping policy approval required |
| `R-002` | Candidate derivation | Engine implementer | `E-001`, `S-001`, `R-001` | `src/continuation/deriveCandidates.ts` | GitHub, Codex, setup 후보 | stale/terminal/conflict 규칙과 bounded copy 준수 | Candidate unit/regression tests | Single-source primary policy required |
| `R-003` | Score와 Continuation resolver | Engine implementer | `R-002` | `src/continuation/scoreContinuity.ts`, `src/continuation/resolveContinuation.ts` | deterministic scoring, diversity, tiebreak, decision hash | 동일 input/permutation에서 결과 동일 | Resolver unit, replay, dev dataset eval | Shadow activation approval required |
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

`npm run continuation:baseline`은 `E-001`에서 wiring되고 2026-08-12에 실행되어 pass했다. Run ID, private artifact, dataset/config/artifact hashes, counts와 historical dirty-worktree fingerprint는 Engine Change Record의 E-001 section에 기록됐다. 이후 문서-only 기록 변경은 해당 run 당시 fingerprint를 바꿔 쓰지 않으며 baseline 재실행을 요구하지 않는다.

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

## 17. 현재 작업 상태 (2026-08-12)

- `D-001` planning과 `C-001` contract correction 뒤 `E-001` dataset/evaluator scaffold와 automated evaluation checkpoint가 완료됐다. API, UI, resolver, production flag wiring은 이 단계의 범위가 아니다.
- `S-001` GitHub v6/Codex v3 pure source adapter와 unit cases가 구현됐지만 automated validation은 아직 실행하지 않았다. Adapter는 shadow-only/unwired이고 G2 privacy human approval 전에는 activation하지 않는다.
- `HS-001`을 포함한 executable contract oracle 12개는 모두 pass했고, resolver behavior 10개는 dependency가 구현될 때까지 deferred/`not_evaluated`다.
- Evaluator는 구조상 evaluation-only이며 production consumer가 연결되지 않았다. `HS-001` pass는 contract-level evidence이고 Active의 실제 runtime input, candidate universe, eligibility, ordering, result byte 및 hash에 대한 runtime integration equivalence는 deferred다.
- Dataset은 mutable Dev Candidate이며 freeze 또는 human-approved Gold가 아니다. Human review는 시작되지 않았고 comparison, improvement, resolver quality, release readiness 또는 rollout도 주장하거나 승인하지 않는다.
- Targeted Vitest 3개 파일 39/39, 최종 typecheck, lint와 `npm run continuation:baseline`이 pass했다. Run `continuation_eval_run_df5a85b1e2bb784355c035969f835380`의 private artifact와 hashes는 Draft ECR에 기록됐다. Release는 deferred이고 `releaseEligible=false`다.
- 새 production dependency는 추가하지 않았다.
