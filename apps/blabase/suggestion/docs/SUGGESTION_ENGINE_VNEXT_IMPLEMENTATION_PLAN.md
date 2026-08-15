# Suggestion Engine vNext Implementation Plan

| 항목 | 값 |
| --- | --- |
| Status | **Q-001 `automated_checkpoint_passed`; release `blocked_pending_human_review`** |
| Date | 2026-08-14 |
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
- E-001 v0.3 revision 3 scaffold와 authenticated resolver/Board integration, S-001, R-001, R-002, R-003, B-001의 pure synthetic regression checkpoint가 구현·검증됐다. 12 contract oracle, 9 resolver behavior row와 1 Board behavior row가 모두 통과해 22/22 measured/pass이고 deferred는 0이다. A-001은 그 exact core를 바꾸지 않고 단일 live capture를 실제 `S1 → R1 → R2 → R3 → B1` chain으로 통과시키는 action-disabled local shadow slice를 연결한다. PR-002는 PR-001 preserve readers를 Work Board에 연결하고 mutating Work Resumption lease를 preserve-only authority snapshot으로 대체했다. Work Board GET/intent의 base evaluation은 one-asOf `attention-preserve-capture-v0.1` 안에서 connector, context, workflow, binding, managed observability와 attribution을 함께 검증한다. `/api/attention`은 default `maintain`으로 기존 동작을 유지한다. Production G2/G3, manual browser/privacy review 및 release는 여전히 blocked다.
- Q-001은 base `e2fc9f56066b5d731fddcf9cc1837424a740b450`에서 전체 자동 matrix와 독립 advisory QA를 수행하고, monitoring replay/deletion, Semantic Continuation intent authority/least privilege/browser currentness 및 stale E2E assertions를 보정한다. Exact initial/final evidence와 manual residual은 `SUGGESTION_ENGINE_VNEXT_QA_REPORT.md`에 기록한다. 최종 automated checkpoint literal과 무관하게 release는 `blocked_pending_human_review`다.

이 상태는 아래 task별 기록과 2026-08-14 KST Q-001 automated validation 결과를 함께 반영하며, production activation이나 release를 의미하지 않는다.

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
                              [done]                         [done]
                                      └──────────────┬─────┘
                                                     ▼
                              action-disabled local shadow slice implemented;
                              production shadow approval remains pending
                                                     │
                                                     ▼
                                  A-001 Work Board monitoring slice
                         [local review only; production blocked]
                                                     │
                                                     ▼
                                            U-001 Web UI
                                                     │
                                                     ▼
                                            X-001 Explicit actions
                                                     │
                                                     ▼
                              L-001 Launcher Work Board v1 [default-off]

M-001 Monitoring/replay/feedback spans all runtime phases after C-001.

E-001 + R-003 + B-001 + A-001 + U-001 + X-001 + L-001 + M-001
  └── Q-001 Integrated QA
         └── P-001 Human review, freeze, staged rollout
```

`R-003` core, B-001 Board composer와 E-001 v0.3의 9개 resolver behavior row 및 1개 Board behavior row 연결은 구현·검증됐다. B-001은 artifact schema 성공만 신뢰하지 않고 R-003의 original-input-bound verifier를 필수 seam으로 사용하며, bare base Decision, legacy/mixed tuple과 forged outer artifact를 typed input rejection으로 fail closed한다. 어떤 R-003/Board behavior도 G2/G3와 dual-lane approval 전에는 production path에 연결하지 않는다.

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
- macOS Launcher Work Board flag 기본 활성화
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

**Status (2026-08-13):** `E-001` additive v0.3 revision 3 authenticated resolver/Board integration과 automated evaluation checkpoint가 완료됐다. Final typecheck, targeted Vitest 9 files/119 tests와 lint가 pass했고 두 authoritative `npm run continuation:baseline` 실행도 pass했다. 22개 중 12 contract oracle, 실제 authenticated S-001→R-001→R-002→R-003 chain을 사용하는 9 resolver behavior case와 B-001 cross-lane Board behavior case 1개가 모두 통과해 22/22 measured/pass, 0 failed, 0 deferred다. 모든 critical error count는 0이고 automatic review는 passed, human review는 `not_started`다. Dataset `suggestion-continuation-dev-v0.1` revision 3은 여전히 mutable/unfrozen이며 lifecycle의 dataset/config SHA는 null이다. Acceptable@1/3과 setup quality는 null이고 `releaseGateApplicable=false`, release decision은 deferred이며 release는 승인되지 않았다. 기존 v0.1/v0.2 JSON과 run records는 immutable history로 유지했다. Final run IDs, private artifact handling과 exact shared reproducibility hashes는 ECR의 B-001/E-001 v0.3 section에 기록했다.

**Exit gate:** E-001 contract/resolver/Board synthetic checkpoint는 충족했다. Human review, immutable dataset freeze, release-quality measurement과 release gate는 후속 task로 열려 있다.

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

**R-003 status (2026-08-13):** Provisional deterministic scoring/resolution core와 E-001 v0.3 synthetic resolver/Board checkpoint가 구현·검증됐다. Scoring result/schema, resolver와 scoring policy, resolution envelope/schema 및 distinct resolved-decision artifact/schema/hash는 v0.1이다. Resolver는 original authenticated R-001 input과 out-of-band trust expectations로 full chain을 재검증한다. Ready pool은 Setup보다 항상 우선하고 score 내림차순/`candidateId` 오름차순, WorkContext당 최대 1개, 전체 최대 3개로 선택한다. Full authenticated two-source complete/fresh coverage이고 quality exclusion이 없을 때만 offer가 `COMPLETE`; proven normal empty는 `no_recent_context/COMPLETE`; Setup은 항상 `SOURCE_LOCAL_PARTIAL`이다. Latest integrated validation은 typecheck, targeted Vitest 9 files/119 tests와 lint pass이며 E-001은 12/12 contract, 9/9 resolver와 1/1 Board row를 통과했다. 이는 `contract_and_resolver_board_regression` evidence이며 quality, shadow activation 또는 release 승인이 아니다.

**Exit gate:** Core deterministic replay, Dev dataset resolver/Board integration과 private evaluation-run provenance 기록은 충족했다. Human review, G2/G3/G8와 shadow/release 승인은 미충족이다.

### Phase 5. Board composer와 Active byte equivalence

- `B-001`에서 Attention, Continuation, Setup의 precedence와 cross-lane dedupe를 구현한다.
- Board composer는 exact Active v0.5와 complete original R-001/R-002/R-003 bundle을 받고, outer R-003 artifact를 full input-bound verifier로 인증한 뒤에만 nested decision을 읽는다.
- Active `suggested`/`needs_clarification` sequence를 먼저 두고 Continuation/Setup lane order를 보존한다. Cross-lane numeric score는 비교하지 않는다.
- Dedupe는 exact non-null WorkContext가 같은 경우에만 적용하며 Active가 이긴다. 동일 label/다른 WorkContext는 유지하고 null-WorkContext Setup은 자동 dedupe하지 않는다.
- Active object, canonical bytes와 `resultSha256`를 그대로 보존하며 재실행, 재구축 또는 mutation하지 않는다.
- Board는 read-only projection이고 API, UI, runtime, persistence, action 또는 production flag에 연결하지 않는다.

**Status (2026-08-13):** `B-001` core와 E-001 v0.3 Board checkpoint가 구현·검증됐다. Internal Board input/result contract, schema와 input/result/semantic hash domain은 v0.3이고 public Board는 v0.1을 유지한다. Composer, precedence policy와 ID policy는 의미 변경이 없어 v0.1을 유지한다. Bare base Decision, legacy/mixed tuple, forged/rehashed outer R-003 artifact, wrong secret/registry/code/dataset/asOf/version 및 Active tamper는 `WORK_SUGGESTION_BOARD_INPUT_REJECTED`로 fail closed하며 Board를 만들지 않는다. Valid source capability와 exact private action target은 기존 Board policy 안에서만 그대로 보존하고 권한을 올리지 않는다.

**Exit gate:** Synthetic core 기준 충족. Active object/hash invariant, deterministic exact top three, precedence/dedupe, privacy/capability-target constraints와 full input-bound Board verification이 통과했다. Dual-lane flag와 shadow/runtime/API/UI activation은 별도 human gate로 남는다.

### Phase 6. API와 웹 표시

- `A-001`의 첫 slice로 default-off/local/safe-origin/no-store `GET /api/work-board`, public Board v0.1 display-only wrapper, Attention Lab panel과 Active-only bounded fallback을 추가했다. 단일 live capture는 실제 `S1 → R1 → R2 → R3 → B1` chain을 사용하며 source refresh, Board/result persistence, external mutation, telemetry 또는 action을 만들지 않는다.
- `A-001 PR-001`은 GitHub/Codex/Google Calendar/Notion connector read의 explicit `preserve` mode와 managed Codex observability/work-artifact attribution preserve-only reader를 추가했다. PR-002는 additive `LiveReadMode`를 live Attention에 전파하되 default를 `maintain`으로 유지하고, Work Board base evaluation만 내부적으로 `preserve`를 강제한다. `preserve + refreshSources=true`는 env/source/store inspection 전에 거부된다.
- `attention-preserve-capture-v0.1`은 fixed base roots의 sorted O_NOFOLLOW manifest를 capture 전후에 비교하며 content hash와 type/mode/uid/gid/dev/ino/nlink/size/mtime/ctime을 묶는다. Shared ancestor는 trust identity와 scope-filtered listing hash만 사용해 base와 semantic scope를 격리한다. Typed instability만 최대 1회 재시도하고, 두 번째 변화, unsafe/symlink/corrupt state, temp/lock/settlement evidence는 fail closed한다. Base failure는 authenticated route에서 sanitized 503이고, optional semantic intent/receipt scope failure는 byte-identical base와 `semanticPresentation=null`이다.
- Preserve Work Resumption snapshot은 filesystem/process lease를 획득하지 않고 already-read Codex config, exact binding/heartbeat authority와 one-asOf를 재사용한다. Current evidence는 PR-001 managed/artifact preserve APIs를 사용하며 context/outcome/workflow도 동일 capture의 preserve reads를 재사용한다. Semantic live path는 captured installation secret을 재사용하고 Codex config를 다시 읽지 않는다.
- Preserve env는 caller/process env와 module cache를 수정하지 않고 `.env.local`/shared env를 읽지 않는 descriptor-safe request snapshot이다. Preserve code provenance는 declared commit/fingerprint만 사용하고 Git/worktree/child process를 탐색하지 않는다. 선언 provenance가 없으면 Continuation prerequisite가 unavailable이 되어 bounded Active-only fallback이 가능하다. Maintain provenance는 `/usr/bin/git`, sanitized env, `GIT_OPTIONAL_LOCKS=0`, fixed timeout으로 harden됐다.
- PR-001 validation은 targeted Vitest 11 files/128 tests, `npm run typecheck`, `npm run lint`, `git diff --check`가 pass했다. Test evidence는 preserve before/after content, mode, mtime, inode와 listing, no-directory creation, independent settlement-only/managed-temp-only/managed-lock/attribution-lock rejection, deterministic shared/managed/attribution inode replacement, controlled directory-chain identity change, stale history 보존, in-memory retention, corrupt/partial/final-or-ancestor-symlink/unsafe-mode fail-closed, legacy migration 및 default-maintain cleanup compatibility를 포함한다. OS-managed `atime`은 read/readdir 자체가 갱신할 수 있어 invariant에서 명시적으로 제외하며 code-controlled write/mkdir/rename/unlink/chmod/utimes/lease/recovery는 0이다. Cross-review에서 재현된 ancestor-symlink redirect와 missing-state confirmation TOCTOU는 controlled-chain pre/post validation으로 수정됐고 bounded re-review에서 remaining finding 0건이었다. Core engine과 E-001 dataset이 불변이므로 baseline은 N/A다.
- Public contracts/projection은 새 `publicTextSafety.ts` 경계를 사용해 credential-shaped public text를 fail closed한다.
- `A-001`의 다음 coherent slice로 formal display-only `GET /api/continuation`을 추가했다. 새 strict contract `continuation-read-api-v0.1`은 같은 request의 단일 preserve capture에서 이미 인증된 R3 decision을 재사용해 exact `status`, `coverageCode`, `generatedAt`과 최대 3개의 title/summary/caveats만 반환한다. 모든 item은 `capability=display`, `action=null`이고 식별자/ref/hash/proof/private target은 반환하지 않는다. Exact flag `BLABASE_CONTINUATION_READ_ENABLED`는 default-off이며 local/safe-origin/configured Basic auth/no-store 경계 안에서만 GET을 허용한다. 이 display-read slice 자체에는 action/persistence/UI 연결이 없었고, 이후 별도 X-001 default-off Setup POST 경계만 추가됐다. Public rollout은 아직 승인되지 않았다.
- `U-001` display-only slice는 authenticated `/api/work-board` wrapper 하나만 canonical proposal feed로 사용한다. `지금 처리할 일`, `이어서 할 일`, `연결할 일`을 fixed order로 구분하고 Board primary/alternatives order와 exact itemRef-bound semantic title overlay를 유지한다. 모든 item은 render 경계에서 `display/action=null`과 bounded evidence/caveat copy를 재검증하며 action/private hostile feed는 전체 fail closed한다. Browser text 검증은 server public Board의 pure locator/credential policy를 공유해 `CI/CD` 같은 일반 slash copy는 허용하되 absolute path, URL, credential/private ref는 거부한다. 30일 이상 남은 expiry도 60초 이하 timer chunk를 반복 예약해 실제 만료 시 제거한다. 이 패널은 CTA/link/button/form을 만들지 않고, 기존 Active Attention은 별도 timestamp를 가진 진단 영역으로 유지한다.
- `X-001`의 첫 human-approved slice는 Setup lane의 `workspace_mapping/open_setup_surface`만 활성화한다. 기존 Work Board/Continuation GET과 공개 item은 계속 `display/action=null`이며, CTA 클릭 뒤 별도 default-off `BLABASE_CONTINUATION_SETUP_ACTION_ENABLED` 경계에서만 random 256-bit `offerId`를 발급한다. Offer는 30초와 candidate expiry 중 이른 시각에 만료된다. 발급 시점의 capture-volatile candidate/target/result/batch hash는 별도 issuance audit으로 봉인하고, currentness는 `continuation-setup-action-authority-v0.1`의 secret-namespaced canonical authority만 비교한다. 이 authority는 fixed destination policy, public itemRef, logical Setup candidate/observation, Setup reason/expiry, source identity·R1 resolution, relevant mapping state, R1/R2 policy tuple와 typed code provenance를 action-specific HMAC digest로 묶되 request asOf/run/result hash, scored candidate hash, legacy private target, full registry/source batch hash는 포함하지 않는다. Issue와 Open의 fresh single preserve capture는 같은 root filesystem lock 안에서 수행되며, Open은 authority가 일치하고 candidate가 live일 때 durable consume한 뒤 고정된 same-origin `/projects` navigation만 허용한다. `open_source`, mapping 저장, preselection, session/resumption, launcher, command 또는 외부 mutation은 포함하지 않는다.
- `Attention.no_action`을 전체 추천 실패로 표현하지 않는다.
- source-local 후보는 bounded copy와 evidence band를 표시한다.

**Semantic Continuation status (Q-001 hardening 2026-08-14):** A-001의 additive local
display-only follow-up으로 구현됐다. `POST /api/work-board/intent`는 local,
same-origin, configured Basic auth, default-off flag 뒤에서 explicit `QA_RUN`
confirmation만 받고 freshly evaluated unoverlaid `ready/full` Board의 mapped
display-only Continuation target을 재검증한다. Q-001에서 private intent store/schema를
v0.2로 올리고 installation-secret HMAC과 `authKeyId`를 추가했다. Current secret은
`.local/semantic-continuation/<authKeyId>/intent-store.json`만 직접 열며 fixed-root v0.1은
자동 migrate/reuse하지 않는다. refs/registry/observedAt/candidate expiry/confirmedAt/
effective expiry와 supersession을 0700/0600 no-follow atomic storage에 보존하고 read는
pure하다. Pure read가 exact orphan temp sentinel을 보면 삭제하지 않고 fail closed하며,
다음 authorized POST만 shared lease 아래 fixed legacy root와 모든 canonical
current/inactive `authKeyId` namespace를 검증하고 exact regular/same-owner/0600 temp
pattern을 복구할 수 있다. Rotated namespace의 safe orphan은 current overlay를 막지
않고, symlink/wrong-mode namespace 또는 temp는 삭제하지 않은 채 fail closed한다.
GET도 configured Basic auth를 직접 검증한 뒤에만 private state를 읽는다.
Additive response는 기존 schema-valid WorkBoardApiResponse를 byte-identical
`base`로 보존하고, 별도 versioned `semanticPresentation`의 `displayTitle`만
UI가 render-time에 사용한다. Missing/corrupt/stale/mismatch는
`semanticPresentation=null`과 unchanged generic base를 반환한다. Targeted
label safety는 NFKC/구분자 정규화 뒤의 camelCase/concatenated
pass/fail/completion/result/apply claim도 fail closed한다.
Intent POST는 Board read flag 외에 separate exact default-off
`BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED === "true"`를 요구하고, exact JSON
content type/length와 8,192-byte declared/streamed cap을 semantic evaluation보다 먼저
검증한다. UI는 이 server capability가 없으면 form을 렌더하지 않는다. Form은 exact
item/context/base-generatedAt target으로 remount되고 request generation과 edit reset으로
late completion이나 이전 label confirmation이 새 target에 남지 않는다.
Vitest 8 files/35 tests, typecheck와 lint가 pass했다. Core
engine/E-001 tuple이 불변이므로 baseline은 N/A이며 production/release는
승인되지 않았다.

**SC-002 first-slice status (2026-08-13):** 명시적이고 argument-free인
`npm run semantic-validation`만 local QA validation을 시작할 수 있다.
Browser GET/POST/client/UI는 SC-002 producer/profile 또는 validation
child-process 경로를 import하거나 실행하지 않는다. 기존 A-001 live
capture의 read-only Git code-provenance probe는 유지되므로 이 보장은 전체
route graph의 zero-child-process가 아니라 HTTP-triggered **validation**
execution 0건을 뜻한다. Runner는 fixed realpath `suggestion/` root와 current
unsuperseded SC-001 intent를 다시 확인하고, SC-001 confirmation과 공유하는
filesystem authority lock 및 별도 renewable run lease를 획득한 뒤에만
시작한다. Lease loser는 intent/receipt/base/code state를 읽거나 validation
subprocess를 만들지 않는다.

Profile은 현재 package script가 exact expected value인지 검증한 뒤
`process.execPath`와 realpath-confined TypeScript/ESLint/Vitest entrypoint를
`shell:false`, fixed argv/cwd/env/timeout, discarded stdio로 직접 실행한다.
순서는 `typecheck → lint → unit_test`이며 fail-fast 뒤 남은 slot은
`not_run`이다. Arbitrary script/command/argv/cwd, client receipt upload,
HTTP-triggered execution은 없다. v0.1에서는 오직 local `clean_commit`
provenance만 실행 가능하고 dirty/declared/unavailable은 no-spawn
inconclusive다.

Private v0.1 receipts는 current intent/candidate/registry/time binding과
start/end code provenance를 포함하고, installation-secret-derived HMAC 및
SHA-256 append revision chain으로 인증한다. Store는
`.local/semantic-continuation/validation/receipts.json`에 0700/0600,
atomic하게 저장되며 최대 512개다. TTL은 24시간, intent expiry와 candidate
expiry 중 가장 이른 시점이다. Invalid tail은 whole-store rejection이며
salvage하지 않는다. New running event는 즉시 authoritative하여 이전 pass를
숨기고, stale dead lease는 `RUN_ABANDONED/inconclusive`로 닫는다. Q-001은 pure
GET cleanup을 추가하지 않고, shared authenticated mutation lease 아래에서만 exact
`receipts.json.<pid>.<16hex>.tmp` regular/same-owner/0600/no-follow orphan을
inode 재검증 뒤 복구한다. Symlink/wrong mode는 삭제하지 않고 fail closed한다.

Presentation-only overlay는 base Board bytes/schema/order/lane/evidence/
capability/action/execution policy를 바꾸지 않는다. Separate presentation
envelope만 v0.2로 올라가며 verified current status별 exact title은
`QA 진행 상태 확인하기`, `QA 실패 항목 검토하기`,
`QA 통과 결과 확인하기`다. Inconclusive/invalid/stale/drift/mismatch는 SC-001
`${subjectLabel} QA 진행하기`로 되돌아간다. Structured finding, result apply,
results-review live branch와 telemetry는 없다. Targeted Vitest 13 files/56
tests, typecheck와 lint가 통과했고 core/E-001 semantics가 불변이어서
baseline은 N/A다. 실제 CLI와 browser smoke는 explicit user invocation 및
manual follow-up으로 남는다.

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

### Phase 9. Launcher Work Board v1

- `L-001`은 IPC envelope v1과 기존 `attention.get`/Attention projection v2를
  그대로 유지하면서 별도 strict `work-board.get {refresh:boolean}`과
  `blabase-launcher-work-board-v1`을 추가한다.
- Exact `BLABASE_LAUNCHER_WORK_BOARD_ENABLED === "true"` flag만 새 method를
  활성화한다. Managed explicit refresh는 sync 한 번 뒤 canonical preserve Work
  Board를 한 번 평가하고, read-only는 refresh 요청에도 sync하지 않는다.
- Projection은 Board primary+alternatives 순서의 최대 3개 display-only row와 exact
  semantic overlay title만 담는다. Attention dueAt은 visibility TTL이 아니므로
  `expiresAt:null`로 투영하고, Continuation/Setup expiry만 native timer가 60초 이하
  chunk로 제거한다.
- Full zero-item Board는 terminal이다. Active-only/완료된 Board failure/schema
  rejection은 legacy Attention을 `refresh:false`로 한 번만 호출하며 unsupported
  method만 원래 refresh를 보존한다. Timeout/disconnect/malformed envelope은 hung
  process generation을 retire하고 같은 연결에서 fallback하지 않는다. Pending Board
  cancellation도 해당 generation을 retire해 다음 load가 serial queue 뒤에 막히지 않으며,
  config-stop/app shutdown은 MainActor를 막지 않는 quarantine task에서 bounded SIGTERM
  grace 뒤 SIGKILL로 child 종료를 확인한다. 미확인 process는 replacement를 차단하며,
  lifecycle epoch/retirement token/permanent shutdown gate가 await 중 config-root race를
  차단한다. Config stop/새 root activation/complete의 명시적 handshake 동안 gate를
  유지하고 실패는 abort하므로 stop 반환과 activation 사이 old-root launch도 불가능하다.
  Root-change retry의 stop 여부는 `isAgentActive`가 아니라 root equality로만 결정한다.
- Full Board row는 action이 없고, Active-only fallback 뒤 기존 Attention 화면의
  기존 Active action만 유지한다. X-001 Setup action은 launcher에 연결하지 않는다.

**Status (2026-08-14):** 구현 및 local automated validation checkpoint. Default-off이며
manual old-agent/package/accessibility gate와 release 승인은 남아 있다.

**Exit gate:** strict unknown/private/actionful schema fail-closed, one-shot Active
fallback, no-double-sync, request/expiry generation currentness 및 existing Attention v2
compatibility가 자동 회귀로 고정된다.

### Phase 10. Monitoring, replay, feedback

- `M-001a`는 default-off local web dogfood 범위에서 최종 Work Board 응답에
  5분 이내 HMAC receipt header를 더하고, 명시적 consent 뒤 실제 commit된
  `render_confirmed`와 Continuation/Setup의 explicit useful/not-useful/reset만 기록한다.
- Current installation key namespace의 private append-only store는 승인된 30일 lazy
  retention을 사용하고 다음 authorized mutation에서 expired prefix를 정리한다. 별도
  all-data purge는 current config/secret 유무와 무관하게 root lock 아래 안전한 모든
  current/inactive canonical key namespace를 삭제하며 unexpected/symlink entry는 fail
  closed한다. 공개 상태·CLI는 제목이나 identifier 없는 aggregate/history와 aggregate
  replay만 제공한다.
- Normal read는 stored aggregate mismatch를 계속 reject한다. Replay read는 authenticated
  schema/event/store HMAC chain을 먼저 검증한 뒤 aggregate를 재계산하므로 mismatch를
  deterministic CLI failure로 보고할 수 있다. Background cleanup은 없다.
- 이 slice의 모든 record는 `reviewState=candidate`, `appliedToRanking=false`,
  `goldEligible=false`, `releaseGateEligible=false`다. click/dwell/no-click,
  Launcher/offline, Attention feedback 복제와 production engine replay는 수집하지 않는다.

**Status (2026-08-14):** `M-001a` Q-001 hardening checkpoint implemented. Default-off,
30일 lazy retention과 explicit all-namespace purge만 구현됐으며 broader
M-001/ranking/Gold/release promotion은 미구현·미승인이다.

**Exit gate:** strict receipt/API/store/replay/privacy와 GET byte/no-write, browser
commit/currentness가 자동 회귀로 고정되고 수동 privacy/copy 검토가 완료돼야 한다.

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
| `E-001` | Dataset builder와 evaluator | Evaluation owner | `C-001` | `eval/synthetic/continuation*`, `src/evaluation/continuation/*`, `tools/run-continuation-baseline.ts`, `.local/` private artifacts | additive v0.3 mutable dev dataset/evaluator revision 3, authenticated R-003/B-001 fixtures, bounded private-artifact runner | **v0.3 synthetic regression checkpoint complete on 2026-08-13.** 12/12 contract + 9/9 resolver + 1/1 Board passed; 0 deferred; v0.1/v0.2 history unchanged | Typecheck pass; targeted Vitest 9 files/119 tests pass; lint pass; final runs `continuation_eval_run_fa965c0e27a9984410b0a3dd61bf9c9e`, `continuation_eval_run_374acb944d5a79845453fb8e93eabbab` pass | Human review not started; mutable/unfrozen, not Gold; quality null, release gate false/decision deferred, flags off |
| `S-001` | GitHub/Codex adapters | Connector owner | `C-001` | `src/continuation/adapters.ts`, `src/continuation/index.ts` | v6/v3 → Observation v0.2 + private batch v0.4 whole-content HMAC/source assessment/evaluation time | **Implemented and automatically validated locally.** Pure unwired projection, all-status replay-bound evaluation time, available cutoff/assessment, exact 7-day window, partial/count-0 semantics | 2026-08-13 KST: typecheck pass; targeted Vitest 7 files/89 tests pass; lint pass | G2 privacy sign-off required before activation |
| `R-001` | WorkContext identity resolution | Identity owner | `C-001`, `S-001` | `src/continuation/resolveIdentity.ts`, `src/continuation/index.ts` | v0.4 authenticated registry/batches + trusted current registry SHA → mapped/setup/conflict | **Implemented and automatically validated locally.** Exact confirmed mapping only; registry rollback, inconsistent identity meaning and invalid proof fail closed; persistence/API/UI/runtime/auto-selection 없음 | 2026-08-13 KST: typecheck pass; targeted Vitest 7 files/89 tests pass; lint pass | G2 pending; persistent mapping/correction은 post-MVP human gate; activation/release unapproved |
| `R-002` | Candidate derivation | Engine implementer | `E-001`, `S-001`, `R-001` | `src/continuation/deriveCandidates.ts`, `src/continuation/index.ts` | envelope/result/schema v0.3, rule/config v0.2; exact candidates and input-bound verifier | **Implemented and automatically validated locally.** Exact 7-day/freshness provenance, same-WorkContext-only linking, display-only mapped candidates, non-executable setup descriptors, canonical IDs/hashes | 2026-08-13 KST: typecheck pass; targeted Vitest 7 files/89 tests pass; lint pass; evaluator/baseline deferred | G2 and shadow activation approvals pending; no release claim |
| `R-003` | Score와 Continuation resolver | Engine implementer | `R-002` | `src/continuation/scoreContinuity.ts`, `src/continuation/resolveContinuation.ts` | v0.1 provisional score/result/resolver/resolution envelope/distinct decision artifact, full input-bound verifier | **Core and E-001 v0.3 synthetic checkpoint complete.** Deterministic score/selection, authenticated coverage, trusted expectations and full-chain verification; 9/9 resolver rows pass | 2026-08-13 KST latest integrated checkpoint: typecheck pass; targeted Vitest 9 files/119 tests pass; lint pass; two authoritative v0.3 baseline runs pass | G2/G3/G8 and shadow activation approval pending; no recommendation-quality/release claim |
| `B-001` | Work Suggestion Board composer | Engine architect | `R-003` | `src/suggestionBoard/composeBoard.ts`, `src/suggestionBoard/contracts.ts` | internal input/result/schema/hash v0.3, outer-R3-authenticated precedence/dedupe, exact primary/alternatives projection | **Implemented and validated on 2026-08-13.** Active exact object/hash preserved; Attention first; exact non-null WorkContext dedupe; null Setup retained; typed fail-closed authenticity boundary | 2026-08-13 KST: typecheck pass; targeted Vitest 9 files/119 tests pass; lint pass; E-001 Board row 1/1 pass | G2/G3 and dual-lane flag approval required; unwired/read-only, release unapproved |
| `A-001` | Continuation/Board API | API owner | `B-001` | local Work Board wrapper/route, PR-001 preserve readers, PR-002 coherent preserve capture, formal display-only Continuation GET; future action route | **Display-read milestone implemented locally:** Work Board remains forced preserve/no refresh; formal `GET /api/continuation` reuses the exact authenticated R3 decision from one request-local capture and exposes only strict `continuation-read-api-v0.1` display data. No code-controlled cleanup/lease/recovery/permission repair/retention write occurs in the read path. Public Work Board/SC response and core contracts are unchanged | 2026-08-13 KST: PR-002 21 files/150 tests plus the Continuation-read targeted regression recorded in ECR; typecheck, lint and diff-check pass. Baseline N/A because core engine semantics, Board bytes and E-001 data are unchanged | Manual authenticated browser/privacy smoke and G2/G3 remain required. Action/open/UI/public rollout, dataset freeze and release remain blocked |
| `U-001` | 웹 UI | Web owner | `A-001` | `app/WorkSuggestionBoardPanel.tsx`, `app/WorkCockpit.tsx`, browser-safe Work Board client parser | **Display-only slice implemented locally:** fixed Attention/Continuation/Setup lanes, server order/overlay preservation, bounded evidence/caveat copy, expiry filtering, strict whole-feed fail-close, canonical Work Board-only fetch with monotonic request gate. No CTA/link/button/form/action | Focused component/client/integration tests plus typecheck/lint/diff-check recorded in ECR; engine/UI baseline N/A because only existing public projection is rendered | Manual 320px/200% zoom, keyboard/VoiceOver/Safari, copy/privacy and G2/G3 approval remain required |
| `X-001` | Action gateway | Security + Runtime owner | `A-001`, `R-001`, `U-001` | `src/continuation/actions/*`, `/api/continuation/offers`, `/api/continuation/open`, Setup CTA | **Setup-only slice implemented locally:** wire API/action policy v0.1, internal authority v0.1, private offer/event/store/schema and revalidation/retention v0.2; 30초 HMAC offer, current-secret namespace, candidate-expiry+24시간 retention, fixed `/projects` destination | explicit click only; issue/open capture는 shared root lock 안에서 직렬화; 자동 실행/재시도/mapping 저장/mutation 없음; invalid offer 409 | Contract/store/tamper/restart/secret-rotation/race/expiry/cap/gate/privacy/client/UI targeted regression과 ECR 기록 | Human approval is limited to Setup surface; `open_source`, exact resume and release remain blocked |
| `L-001` | Launcher Work Board v1 projection | macOS owner | canonical preserve Work Board | launcher TS/Swift projection, client, state and presentation files | default-off display-only Board, unchanged IPC v1/Attention v2 | strict schema, no-double-sync, one fallback, expiry/currentness and Active compatibility | TS service/JSONL/projection tests, Swift build/model smoke; manual old-agent/accessibility check pending | Launcher rollout approval required |
| `M-001` | Monitor, replay, feedback | Observability + Evaluation owner | `C-001`, then each runtime phase | `src/suggestionBoard/monitoring/*`, Work Board receipt/API, web UI, aggregate CLI | **M-001a Q-001 hardened locally:** 5분 HMAC receipt, consent/render acknowledgement, Continuation/Setup explicit feedback/reset, authenticated aggregate replay, current-key operation store와 config-independent all-namespace purge | default-off web-only; 30일 lazy retention/no background cleanup; implicit signal/Attention/Launcher/ranking/Gold/release 영향 없음 | Contract/HMAC/tamper/TTL/store/concurrency/rotation purge/disconnect/replay mismatch/route/client/UI/CLI/privacy/preserve tests and opt-in browser test; ECR evidence | 30일 local dogfood와 explicit deletion 범위만 approved; privacy/copy and broader M-001/release remain pending |
| `Q-001` | 통합 QA 및 회귀 검토 | QA reviewer | `E-001`~`M-001` applicable scope | tests, `SUGGESTION_ENGINE_VNEXT_QA_REPORT.md`, private run artifacts | initial/final exact matrix, blocker corrections, risk findings, manual checklist | **`automated_checkpoint_passed` on 2026-08-14.** Final exact root architecture gate pass(7.39s, warnings only/0 errors); mutable contract checkpoint만 인정하고 unresolved risk 명시 | Unit 1,327, full E2E 27 pass/2 skip, 22/22 baseline, opt-in monitoring/race, Launcher build-package와 architecture matrix pass; exact evidence는 QA report 참조 | **Release `blocked_pending_human_review`; human QA/privacy/accessibility/dataset/release sign-off required** |
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

`npm run continuation:baseline`은 `E-001`에서 wiring됐다. Historical v0.1/v0.2 artifacts와 runs는 그대로 보존되며, 2026-08-13 v0.3 revision 3의 final authoritative runs `continuation_eval_run_fa965c0e27a9984410b0a3dd61bf9c9e`와 `continuation_eval_run_374acb944d5a79845453fb8e93eabbab`도 pass했다. 두 run은 dataset candidate payload `98a3c8135b23c6ac2aeddd3c2ada511d3d9a46638fb016d95d86945c8f6d8f31`, materialized input `de9dd348173cdf5087905a1c7b33e2ee20cd948159280572e8f090b95cdb9da2`, config candidate `60ac735cc0d8566772ef7fbf5329f5e626d89c02a8e408d3dafbda28f658221b`, deterministic output `bd6dfccc525cef2ee1837b08dfb2fa3a88b8776c7283732bb36e4502fd0db4e7`를 공유한다. Per-run canonical/stored artifact hashes와 private `.local/` mode 0600 metadata는 Engine Change Record의 B-001/E-001 v0.3 section에 기록됐다. Artifact hash가 run receipt에 따라 달라지는 것은 예상된 동작이다. 이후 문서-only 기록 변경은 해당 run provenance를 바꿔 쓰지 않으며 baseline 재실행을 요구하지 않는다.

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

현재 local exact flags는 모두 default-off이며 문자열 `true`만 활성화한다.

```text
BLABASE_WORK_BOARD_SHADOW_READ_ENABLED
BLABASE_CONTINUATION_READ_ENABLED
BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED
BLABASE_CONTINUATION_SETUP_ACTION_ENABLED
BLABASE_WORK_BOARD_MONITORING_ENABLED
BLABASE_LAUNCHER_WORK_BOARD_ENABLED
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
- Launcher Work Board flag 기본 활성화
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
| G5: Link-only action approval | **2026-08-13 Setup-only decision recorded:** fixed `project_mappings → /projects`, local/same-origin/auth, 30초 TTL, current-binding revalidation. `open_source`/resume/launcher/release는 미승인 |
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
- observation, alias, feedback 및 Setup 외 action offer의 정확한 retention 기간 (X-001 Setup offer의 private issuance bytes는 candidate/offer expiry 뒤 최대 24시간 경과 후 다음 authorized namespace operation에서 제거 대상으로 확정; background cleanup 없음)
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

## 17. 현재 작업 상태 (2026-08-14)

- `D-001`, `C-001`, `S-001`, `R-001`, `R-002`, `R-003`, `B-001` core와 E-001 v0.3 revision 3의 synthetic checkpoint가 완료됐다. A-001 action-disabled local shadow slice도 구현·current-head 검증되어 한 번의 live capture를 실제 `S1 → R1 → R2 → R3 → B1` chain으로 통과시키고 public Board v0.1 display-only projection만 wrapper/route/Attention Lab에 노출한다.
- Exact internal tuple은 private adapter batch v0.4, R-001 identity input/result/schema/hash v0.4, R-002 envelope/result/schema/hash v0.3와 rule/config v0.2, R-003 scoring result/schema/resolver/scoring policy v0.1, resolution envelope/schema v0.1, distinct resolved-decision artifact/schema/hash v0.1, B-001 Board input/result/schema/hash v0.3, E-001 dataset/case/config/run/evaluator policy v0.3다. Base Decision v0.2는 nested body일 뿐 authenticity marker가 아니다. Public Board는 v0.1, Board composer/precedence/ID policy는 v0.1을 그대로 유지한다.
- B-001은 exact Active v0.5와 complete original R-001/R-002/R-003 bundle을 받는다. `verifyContinuationDecisionAgainstInput`으로 outer R-003 artifact를 인증하기 전에는 nested `.decision`을 읽지 않으며 bare base/legacy/mixed/forged artifact와 wrong secret/registry/code/dataset/asOf/version을 typed input rejection으로 fail closed한다.
- Board input과 dependencies는 exact Active result hash, outer R-003 result hash, nested base artifact hash, nested semantic hash를 각각 묶는다. Active object/reference, canonical bytes와 `resultSha256`는 재실행·재구축·mutation 없이 그대로 보존한다. Public Attention item은 `display`와 `action=null`만 허용한다.
- Board sequence는 Active `suggested` 또는 `needs_clarification`을 항상 먼저 두고 Continuation/Setup lane order를 보존한다. Numeric score를 cross-lane 비교하지 않으며 exact non-null WorkContext만 dedupe하고 Active가 이긴다. 동일 label/다른 WorkContext는 남고 null-WorkContext Setup은 자동 dedupe하지 않으며 exact expected sequence의 처음 3개만 primary/alternatives가 된다.
- 2026-08-13 KST 최종 validation에서 `npm run typecheck`, targeted Vitest 9 files/119 tests와 `npm run lint`가 모두 pass했다. 두 final E-001 v0.3 runs도 22 total/measured/pass, 12/12 contract, 9/9 resolver, 1/1 Board, 0 failed/deferred와 critical error 0으로 pass했다. 이 checkpoint는 contract/provenance/scoring/resolver/Board regression evidence이며 quality baseline이나 release evidence가 아니다.
- Dataset `suggestion-continuation-dev-v0.1` revision 3은 mutable/unfrozen Dev Candidate이며 freeze 또는 human-approved Gold가 아니다. Human review는 `not_started`, Acceptable@1/3과 setup quality는 null, `releaseGateApplicable=false`, release decision은 deferred이고 release는 승인되지 않았다.
- Historical v0.1/v0.2 dataset, config와 run artifacts는 다시 쓰지 않았다. Final v0.3 runs는 comparison/improvement run이 아니며 private full artifacts는 Git 밖 `.local/`에 mode 0600으로 유지한다. Artifact hashes가 run별 receipt 때문에 달라지는 것은 예상된 동작이다.
- Work Board의 exact flag는 `BLABASE_WORK_BOARD_SHADOW_READ_ENABLED`, formal Continuation read의 exact flag는 `BLABASE_CONTINUATION_READ_ENABLED`이며 둘 다 default-off다. 두 GET은 local/safe-origin/configured Basic auth/no-store 경계 안에 있다. Work Board의 unsafe/unavailable shadow 결과는 bounded Active-only fallback을 유지하고, Continuation GET은 같은 단일 preserve capture의 authenticated R3 decision만 strict `continuation-read-api-v0.1`로 투영한다. New `publicTextSafety.ts`와 route-specific strict text/schema boundary가 credential, path/URL, internal ref/hash 형태를 fail closed한다. X-001 Setup-only action은 별도 exact flag와 POST issue/open 경계로 격리되어 GET/public Board bytes를 바꾸지 않는다; Board/result persistence, source refresh, telemetry, `open_source`, mapping save, resume 및 external mutation은 추가되지 않았다.
- A-001 PR-001은 shared `LocalReadMode`와 connector preserve mode, `readManagedCodexObservabilityPreservingState`, `readWorkArtifactAttributionStorePreservingState`를 additive하게 구현했다. Preserve 경로는 stale-temp cleanup, mkdir/chmod, lease, settlement recovery, rename/write/unlink 및 disk retention maintenance를 수행하지 않는다. Pending/temp/lock/corrupt/partial/unsafe/unstable state는 current로 승격하지 않고 fail closed하며 legacy migration과 retention projection은 in-memory only다. 기존 caller의 default는 `maintain`으로 호환된다.
- PR-002는 Work Board GET/intent base evaluation을 coherent preserve capture에 연결했다. `/api/attention`과 기존 caller는 default `maintain`을 유지하며, Work Board 내부 경로만 `preserve`와 `refreshSources=false`를 강제한다. Base state가 unstable/unsafe/recovery-needed이면 sanitized 503, optional semantic state만 불안정하면 200 base와 overlay null이다.
- 2026-08-13 KST PR-002 validation에서 `npm run typecheck`, targeted Vitest 21 files/150 tests, `npm run lint`와 `git diff --check`가 pass했다. Filesystem evidence는 atime을 제외한 content/type/mode/uid/gid/dev/ino/nlink/size/mtime/ctime/hash, scope isolation, one retry, lock/temp/settlement/corrupt/replacement, missing-state no-create, fixed clock, maintain compatibility, route 503/overlay fallback과 실제 non-empty full-Board whole-cwd fixture를 포함한다. Core engine ranking/input/output semantics와 E-001 v0.3 dataset은 바뀌지 않아 baseline은 N/A다.
- PR-002 automated gate는 통과했지만 manual authenticated browser/Attention Lab smoke, default-off/on privacy review, production G2/G3와 human release approval은 남아 있다. Public action, Board-result persistence, dataset freeze 또는 release readiness는 승인되지 않았다.
- 새 production dependency는 추가하지 않았다.
- Q-001 initial matrix는 unit/typecheck/lint/build/baseline, monitoring browser,
  Launcher bundle/smoke/build/package/verify를 통과했지만 full E2E의 stale copy assertion과
  root architecture dependency configuration에서 실패를 발견했다. `swift test`는 선택된
  Command Line Tools SDK의 `XCTest` 부재로 test execution 전에 실패했으며 정확히 한 번만
  시도했다. 발견된 product blockers와 regression correction은 QA report/ECR에 기록했다.
- Final exact matrix는 unit 158 files/1,327 tests, typecheck/lint/build,
  Continuation 22/22, full E2E 27 pass/2 skip, monitoring/race opt-in browser,
  Launcher bundle/smoke/build/package/verify와 root `arch:check`를 통과했다. Exact
  run/artifact hashes와 duration은 `SUGGESTION_ENGINE_VNEXT_QA_REPORT.md`에 있다.
  Automated checkpoint는 `automated_checkpoint_passed`이고 release는
  `blocked_pending_human_review`다. Real unmocked authenticated browser chain,
  human privacy/copy/accessibility, full Xcode XCTest, old/new Launcher package
  compatibility, notarization, HTML nonce CSP, crash-left manual recovery, G2/G3,
  dataset freeze/holdout와 explicit release record가 남아 있다.
