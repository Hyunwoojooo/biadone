# Dayflow Suggestion Ablation 실행 Runbook

## Current Colin-only operating checkpoint (2026-08-19)

이 절은 아래에 남아 있는 David 전용 human-review receipt, H-DFA-CONTRACT,
ContractFreezeProposal/decision/freeze 절차보다 우선한다. 아래 기존 절차와 ECR 링크는
과거 설계·감사 이력이며 현재 operator가 실행해서는 안 된다.

### Roles

- `colin`: 개발, 실험 운영, blind 결과 검토와 최종 의사결정의 단일 책임자.
- `david`: 필수 reviewer/signatory가 아니다. David용 package, receipt, decision 또는
  approval artifact를 생성하지 않는다.
- Technical QA: source/test correctness와 privacy boundary를 검증하지만 Colin의 결과
  판단을 대신하지 않는다.

### Current stop boundary

- 중단된 DFA evidence regeneration/publisher를 실행하거나 재구성하지 않는다.
- `TrustedHumanReviewChannel`, `TrustedContractDecisionChannel`, David-bound receipt와
  proposal/decision/freeze issuer를 호출하지 않는다.
- stale ten-candidate seven-artifact chain을 수정, relabel 또는 삭제하지 않는다.
- 소스·테스트 계약 단순화, 새 아티팩트 생성, 기존 아티팩트 삭제는 각각 별도 Task다.

### Minimal operator sequence

1. Colin이 A/B/C가 공유할 protocol, configuration, frozen evaluation input과 성공·안전
   기준을 확인한다.
2. `experiment-manifest.json`에 input/code/schema/config/command/version과 SHA-256을 기록하고
   read back한다.
3. 세 arm을 동일한 frozen input에서 실행하고 `run-results.json`에 run IDs, 상태, 원시
   지표와 오류를 기록한다.
4. Arm identity를 숨긴 상태로 Colin이 output review를 수행한다. 기존 blind-review
   schema의 유용한 부분은 유지하되 second reviewer는 요구하지 않는다.
5. Arm을 공개한 뒤 `comparison-report.md`에 직접 비교 가능한 지표, guardrail,
   privacy/retention 영향과 limitation을 기록한다.
6. `colin-decision.md`에 `continue | revise | stop` 판단, 이유, 다음 gate와 rollback을
   기록한다.

네 아티팩트의 private/raw 형식은 ignored `.local/`에 보관한다. Git에는 안전하게
요약된 문서만 둔다. 무결성은 SHA-256, restrictive mode, immutable/no-clobber write로
충분하다. HMAC chain, authenticated human receipt와 이중 승인 패키지는 요구하지 않는다.

### Task transition rule

현재 문서 정합화 다음 Task는 source/test governance simplification이다. 그 Task를 시작하기
전에 Colin에게 제거할 계약과 유지할 blind-review 계약의 정확한 목록을 제시한다. 소스
변경이 끝나기 전에는 DFA-002를 완료로 표시하거나 A/B/C 실행 아티팩트를 만들지 않는다.
기존 seven-artifact chain 삭제는 단순 대체 아티팩트 검증 이후 별도 명시적 승인을 받는다.

> **상태:** Draft, planning only  
> **실행 권한:** Human-approved Draft ECR와 additive DFA-002A scope 안의 bounded local governance implementation만 허용된다.  
> **현재 다음 단계:** `DFA-002 pending`, nested `DFA-002A in_progress` — exact two-file local adapters를 구현·검증하고 fresh 12-candidate/10-command-input evidence를 재생성해야 한다.  
> **실험 범위:** 로컬 전용, 오프라인 E1 suggestion-specificity ablation. 제품 Attention, Continuation, Work Board, Launcher, action, monitoring 경로는 변경하지 않는다.  
> **Primary comparison:** `B versus A1`. `A0`는 production compatibility anchor이고 `C`는 별도 screen-only discovery study다.

## 0. Approved synthetic scope와 실행 순서

DFA-000의 scope 승인은 단일 Draft ECR
`ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`에 기록돼 있다. 사용자는
2026-08-17 task thread에서 이 bounded synthetic scope와 간소화된 governance process를
승인했다. 별도 machine-generated governance artifact나 approval chain은 요구하지 않는다.
2026-08-18 `colin`은 그 exact allowlist에
`suggestion/tsconfig.dayflow-dfa002.json`과
`suggestion/vitest.dayflow-dfa002.config.ts` 두 tracked path만 추가하는 human-reviewed
scope amendment를 명시적으로 승인했다. 다른 path, capability, contract, live 또는 release
authority는 추가되지 않았다. 이어서 전체 DFA-002A recommendation 직후 `colin`의
`다음 작업 진행해`는 정확히
`suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts`와
`suggestion/tests/dayflowGovernanceAdapters.test.ts` 및 Section 0.4의 bounded capabilities를
승인했다. 다른 tracked path나 human/live/external/production authority는 승인하지 않았다.

실행자는 다음 순서를 지킨다.

1. ECR의 exact tracked-path allowlist와 synthetic-only prohibition을 확인한다.
2. DFA-001 planned model/view diff를 읽고 표준 architecture commands를 실행한다.
3. Command text/result와 package-lock/relevant tool versions를 기록하고 independent QA를
   받는다.
4. DFA-002 strict source schemas, synthetic fixtures와 tests를 allowed paths에 구현한다.
5. DFA-002A의 exact two-file local governance adapters와 adversarial tests를 구현·검증한다.
6. Prior ten-candidate machine bundle을 stale/abandoned 처리하고 fresh source pin과 exact 12
   candidate/10 command-defining inputs를 고정한 뒤 네 fresh
   authoritative command receipt v0.1, readable diff v0.3, machine-evidence bundle v0.3를 만든다.
7. `david`가 trusted channel에서 exact bundle을 `confirmed`한 human-review receipt v0.3를
   만든 뒤 `colin`이 이를 참조하는 `ContractFreezeProposal` v0.4를 publish/readback한다.
8. Human `H-DFA-CONTRACT` decision v0.4가 existing proposal을 승인한 뒤 immutable freeze를
   publish/readback한다.
9. 그 뒤에만 DFA-002를 완료한다. DFA-003은 별도 H-CROSS-REPO 없이는 시작하지 않는다.

### 0.1 DFA-001 entry/exit gate

**Entry gate**

- DFA-000 ECR이 `completed` scope를 기록한다.
- 변경 path가 ECR의 exact tracked allowlist 안에 있다.
- Dayflow source/document pins는 read-only이고 live/production capability는 꺼져 있다.

**실행 명령**

Blabase repository root에서 다음 standard commands를 그대로 실행한다.

```text
npm run arch:model:format:check
npm run arch:sources:check
npm run arch:model:check
npm run arch:model:build
```

각 command의 exact text, current planned-source hashes, result와 readable output 또는
artifact path를 기록한다. 이는 정상적인 source-level reproducibility record이며 hermetic
node_modules tree 증명을 주장하지 않는다.

2026-08-17 exit evidence:

- `architecture/planned.c4` raw SHA-256:
  `56b48e0049220e928398cbae636b46c89a7c9ba03141dc3044bcf186a1ecadfb`.
- `architecture/views.c4` raw SHA-256:
  `f92c7e5ec197bc7145901feb3941fc18965c736cc83fbeb7c38d57e5e294b8f4`.
- Format PASS; sources PASS (49 links); model check PASS (5 files); build PASS.
- Build output은 ignored architecture artifact뿐이다.
- Semantic `rg` PASS: implemented model/dynamics/production 경로에 Dayflow leakage가 없다.
- Independent QA PASS: Medium 이상 finding이 없다.

**Independent QA**

QA reviewer는 planned diff와 results를 직접 확인한다.

- Dayflow는 `architecture/planned.c4` 및 planned-view content에만 있다.
- Implemented `architecture/model.c4`, dynamics, production import가 바뀌지 않았다.
- Build output은 ignored `artifacts/architecture/` 아래에만 있다.
- 네 command가 모두 성공하고 result가 current source와 일치한다.

**Exit gate**

네 standard command evidence와 accepted independent QA가 모두 있어야 DFA-001을
`completed`로 바꾼다. 위 evidence가 gate를 충족했으므로 DFA-001은 `completed`다. 이는
planning-only change이고 core baseline은 N/A다.

### 0.2 DFA-002 proposal/freeze gate

DFA-001 exit 뒤에만 strict source schemas, synthetic fixtures와 tests를 구현한다. Targeted
tests, typecheck, lint, import 변경 시 `arch:deps:check` 결과와 source/config/fixture/test
hash, package-lock/relevant tool versions, readable diff를 기록한다. Failed, missing, stale,
다른 source revision의 결과는 통과로 보지 않는다.

`ContractFreezeProposal` v0.4는 source-pin set, machine-evidence bundle v0.3와 authenticated
human-review receipt v0.3를 참조한다. Machine bundle은 exact validation-input set, 네 command
receipt v0.1, readable diff v0.3, tool versions와 limitations를 결속한다. Human
`H-DFA-CONTRACT`는 existing proposal을 독립적으로 승인 또는 거절하며
proposal을 생성·수정하지 않는다. 승인된 proposal과 decision을 결속한 immutable freeze를
read back한 뒤에만 strict source schemas/registry/fixtures가 normative가 되고 DFA-002를
`completed`로 바꿀 수 있다. Candidate source, dependency, config, fixture 또는 result가
달라지면 새 proposal과 새 approval이 필요하다.

Pending role assignment은 proposer/working owner와 owner reviewer `colin`, authenticated
independent reviewer `david`다. Contract는 2-of-2가 아니다. Proposal v0.4는
`proposerPseudonym: colin`과 `independentHumanReviewReceiptRef`를 가지며, resolved receipt
v0.3는 trusted channel의 `reviewerPseudonym: david`, `decision: confirmed`여야 한다.
Decision v0.4의 단일 `approverPseudonym`도 literal `david`다. `colin`의 owner confirmation은
workflow prose이고 두 번째 schema approval이 아니다. External QA PASS와 Colin의 tracked-path
scope approvals는 David의 receipt/decision을 대체하지 않는다. 아직 human-review receipt,
proposal, decision, approval 또는 freeze는 없다.

### 0.3 Safety와 현재 상태

DFA-000~002A는 local-only, synthetic-only다. Raw human conversation/screenshot, actual
Dayflow blob, production data, secret/credential 사용은 금지한다. Dayflow repository
write/build/run, DB/WAL/screenshot read, macOS capture API, network/provider/telemetry/cloud,
production store/route/action 또는 integration은 금지한다. Generated private artifacts는
ignored `.local/` 또는 `artifacts/architecture/` 밖에 두지 않는다.

```text
DFA-000  completed
DFA-001  completed
DFA-002  pending  <- DFA-002A required; proposal reassembly pending
DFA-002A in_progress <- approved bounded local governance implementation work package
DFA-003+ deferred_and_fail_closed
```

Detailed wire/data appendices는 DFA-002 candidate acceptance sketch다. A0/A1/B/C, immutable
data DAG, privacy/retention, separate live approval과 fail-closed rules는 유지하며 exact
source schemas는 H-DFA-CONTRACT와 freeze 뒤에만 normative다.

2026-08-18 corrected final evidence는 dedicated dependency-cruiser PASS (6 modules/9 dependencies),
explicit ESLint PASS, scoped TypeScript PASS, targeted Vitest 3 files/`75/75` PASS다. Full
suggestion typecheck와 lint도 PASS했고 root `arch:deps:check`는 0 errors로 exit 0이며 기존
warnings는 repository 12, suggestion 8, scripts 2다. External QA도 PASS했다. Pre-DFA-002A exact 10-file
source byte/hash와 36-row version/domain tuple은
`ECR-DFA-002-CONTRACT-CANDIDATE-V0.4-REAL-BASE-2026-08-18`에 있다. Contract-only이고
production semantics를 바꾸지 않으므로 Golden baseline은 N/A다. Colin의 two-file expansion
승인 뒤 그 existing current machine bundle은 stale/abandoned이며 David에게 제출할 수 없다.
새 file hashes/results는 아직 기록하지 않고 fresh 12/10 chain을 구현 뒤 재생성한다.

Schema-valid `.local` `ContractFreezeProposal`은 아직 emit하지 않았다. Proposer `colin`,
owner reviewer `colin`, authenticated reviewer `david`의 assignment은 기록됐다. Prior source
pin `dfa002.source-pin.936ddf31a62727536ff2b01e24f46695`와 input hash
`622f5525e5bf167b3f6b3b6046762b784af80fdde11ed2915322cf1426fe85f4`를 공유한 네 receipt는
real-base correction 전 evidence라 stale/abandoned이고 proposal authority가 아니다. 그 exact
stale receipt IDs는 `dfa002.receipt.dfa002-depcruise.4d7334bf80994292d38ed638a812ccfb`,
`dfa002.receipt.dfa002-eslint.c2d1862b99b5eae98e9b918cfd13de6f`,
`dfa002.receipt.dfa002-tsc.5062dce85b75e9b1e4e871236343d567`,
`dfa002.receipt.dfa002-vitest.b62241f69b04682e2bc3d4092e93f793`이고 모두 stale다. The formerly
current ten-candidate machine bundle도 proposal use에는 stale다. Fresh 12/10 source pin,
receipts, readable diff v0.3, replacement machine-evidence bundle v0.3, authenticated David
human-review receipt와 실제 contract confirmation은 아직 없다. Existing result summaries를
schema artifacts로 추정하지 않는다. 따라서
approval/freeze/execution authority는 없고 DFA-003의 external pin/export implementation과
DFA-007의 trusted historical authority/attestation storage resolver implementation은
deferred이며 missing/untrusted resolution을 fail-closed한다. Live/runtime/production/store/
CLI/screen capability는 없다.

### 0.4 DFA-002A bounded local governance implementation

`DFA-002A`는 DFA-002 내부 work-package label이고 closed `DFA-000..016` machine task enum을
바꾸지 않는다. Machine state는 `DFA-002/pending`, work-package status는 `in_progress`다.

허용 implementation은 정확히 다음이다.

- bounded read-only local Blabase Git object acquisition;
- contained/no-follow hardened `.local` governance artifact reads;
- proposal history resolution, currentness/head validation과 CAS fencing;
- proposal-only hard-link atomic no-clobber publisher와 byte/hash readback.

허용 tracked paths는 정확히 다음 둘이다.

- `suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts`
- `suggestion/tests/dayflowGovernanceAdapters.test.ts`

Dayflow access/runtime/Swift, human signing/trusted-channel issuer, decision/freeze creation,
live authority, route/CLI/production 연결은 금지한다. Local base/current-candidate/proposal
governance는 DFA-002A가 DFA-002 exit 전에 소유한다. External Dayflow pin/export는 DFA-003,
live/historical authority와 attestation lifecycle은 DFA-007 소유로 유지한다. 구현 전후
missing/untrusted resolution은 fail closed다.

## 1. 목적과 비목표

### 목적

이 Runbook은 동일한 `captureWindowId`에서 구조화된 Blabase evidence와 Dayflow 화면 evidence의 증분 가치를 재현 가능하고 사생활을 보호하는 방식으로 측정하는 실행 절차다. `A0/A1/B`만 permitted structured checkpoint에 결속하고 `C`는 독립 직렬화된 screen-only input을 사용한다.

구체적으로 다음을 보장한다.

- 네 arm은 같은 `captureWindowId`만 공유한다. `A0/A1/B`는 허용된 structured checkpoint에 결속하고, `C`는 independently serialized screen-only input만 사용한다.
- `B`와 `A1` 사이에서 화면 evidence 유무만 바뀌도록 한다.
- 화면 evidence가 suggestion의 구체성·즉시 실행 가능성을 높이는지 측정한다.
- wrong identity, unsupported state claim, stale/completed resurfacing, privacy leak을 quality gain보다 우선하는 안전 gate로 다룬다.
- 모든 입력, 출력, review, aggregate를 immutable ID와 canonical hash로 추적한다.
- 합성 데이터에서 시작해 private pilot을 거친 뒤, 동결된 60-checkpoint directional study로 진행한다.
- consent 철회, retention 만료, 오류, 중단, rollback 때 양 저장소의 삭제 상태를 끝까지 확인한다.

### 비목표

이 실험은 다음을 하지 않는다.

- 화면 capture를 production source로 승격하지 않는다.
- Dayflow의 live SQLite, WAL, `StorageManager`, GRDB 구현을 Blabase에 직접 연결하거나 복사하지 않는다.
- E1에서 candidate admission, selection, score, ranking, capability, action, target을 변경하지 않는다.
- `C`를 `A1/B`의 paired causal estimate에 포함하지 않는다.
- 화면 evidence로 완료, 검증 성공·실패, merge, deploy, delivery, 외부 mutation을 증명하지 않는다.
- cloud image upload, 자동 실행, target open, 외부 source write, production suggestion publish를 하지 않는다.
- production conversation, raw screenshot, private review를 Golden Dataset 또는 Git에 넣지 않는다.
- E1 결과만으로 E2 candidate discovery나 production rollout을 승인하지 않는다.

## 2. 기준 source와 pin

실행자는 branch 이름이나 repository commit만으로 source가 고정됐다고 판단하지 않는다. Dayflow 참조 문서는 현재 untracked일 수 있으므로 commit과 문서·source file hash를 함께 검증한다.

| 항목 | 동결 값 |
| --- | --- |
| Blabase base commit | `92b2ca94fc3e8347261ac6a85a627c8e6c915400` |
| Dayflow repository HEAD | `df3c367edb7d405a78d1ae76edffe4ba366f57d7` |
| Dayflow architecture reference SHA-256 | `bfc38c0c22aa594711db04e87210f7b64d82802d1b8d93d5be28d39ad0dc8b39` |
| `ScreenRecorder.swift` SHA-256 | `94f2683bce56a1aec41bab3a856b07a551d87d09e64d4bc7186046d76448192e` |
| `StorageManager+Screenshots.swift` SHA-256 | `67e0ca38c673981a1a9da2d48c2359f47132c44c817789d6ad0c6468feb4b1f4` |
| `StorageManager.swift` SHA-256 | `d1fc88fe3b0caec6c2cc4dc28c8fc75735d99dfbc56b47518fb14024c394ae7b` |
| `Package.resolved` SHA-256 | `2fbad062f299f029a3ac35ae82ef06eca622ad3abcb7486aff9687c8e3f33077` |
| Export contract | `dayflow-screen-evidence-export-v0.1` |
| Normalized evidence contract | `dayflow-normalized-evidence-v0.1` |
| Checkpoint contract | `dayflow-ablation-checkpoint-v0.2` |
| Run contract | `dayflow-ablation-run-v0.4` |
| Final dataset binding | `dayflow-ablation-final-dataset-binding-v0.1` |

어느 pin이라도 달라지면 실행을 중단한다. 승인된 새 pin set, 새 Draft Engine Change Record revision, 새 freeze ID를 만들기 전에는 기존 연구를 재개하지 않는다.

## 3. Arm 정의와 비교 규칙

| Arm | 허용 입력 | 실행 의미 | 절대 금지 |
| --- | --- | --- | --- |
| `A0` | 현재 sealed Blabase Attention/Board 결과와 그 provenance | production compatibility 및 byte-preservation anchor | Dayflow export·normalized evidence 읽기, E1 refiner로 재생성하기 |
| `A1` | `B`와 같은 fixed structured candidate + static `screenEvidenceMode: masked` + allowlisted window/checkpoint ID | 화면 evidence가 없는 causal control | Dayflow blob·export·label·normalized hash/ref를 dependency, cache, registry를 통해 직·간접 수신하거나 dereference하기 |
| `B` | `A1`과 같은 structured candidate + verified normalized screen evidence | 화면 context가 wording/rationale에 주는 증분 효과 측정 | E1에서 admission, ordering, capability, action, target을 변경하거나 structured authority를 화면으로 override하기 |
| `C` | 별도 직렬화된 `screenOnlyInput`과 공통 non-source presentation rules | screen-only discovery의 별도 탐색 | structured candidate, WorkContext registry, target/project label, structured-source hash/state, A fallback 받기 |

핵심 규칙은 다음과 같다.

1. Primary causal comparison은 항상 `B versus A1`이다.
2. `A0`를 `A1` 대신 사용하거나 둘을 같은 control로 보고하지 않는다.
3. `C`는 같은 capture window ID를 공유할 수 있지만 독립 input projection과 hash를 사용하며 별도 queue·지표로 보고한다.
4. E1에서 `A1`과 `B`는 refiner, template, prompt, model, generation parameters, retry, concurrency, config, guardrail, structured candidate, language, output limit이 같아야 한다.
5. `B`에서 유효한 화면 evidence가 사라지면 결과는 `A1`과 byte-equal이어야 하며 별도 typed availability failure를 남긴다.
6. `C`에서 화면 evidence가 없으면 suggestion을 생성하지 않는다. `A`, registry, structured source로 fallback하지 않는다.
7. 화면 미관측은 `notObservedBySource`이며 idle, inactive, complete의 근거가 아니다.

## 4. 분리된 동결 레코드

### 4.1 Two-stage contract freeze — `DFA-002` exit

`DFA-000`은 ECR에 기록된 synthetic tracked-path/safety scope만 승인하며 contract를
동결하지 않는다. DFA-001은 그 scope로 planned architecture를 검증한다. DFA-002의
provisional source schemas, fixtures, exact checks, source hashes와 readable diff가 모두
준비된 뒤 `ContractFreezeProposal`을 publish하고 독립 human `H-DFA-CONTRACT`를 받아야
한다. 그 proposal/approval을 resolve한 immutable `ContractFreeze` publish/readback 전에는
DFA-002가 pending candidate일 뿐 완료될 수 없다.

Final contract freeze ref는 정확히
`{ schemaVersion: dayflow-dfa-contract-freeze-v0.4, contractFreezeId,
contractFreezeSha256 }`다. Candidate source, dependency, config, fixture 또는 command/check result가
바뀌면 새 proposal과 human approval부터 다시 한다.

### 4.2 Live-collection protocol freeze — `DFA-013` 전 필수

Private pilot과 frozen directional study는 각각 첫 live frame 전에 별도 immutable live-collection freeze를 승인한다. Synthetic 단계의 `notApplicableUntilLive`를 live 실행에 사용할 수 없다.

```text
liveCollectionFreezeSchemaVersion: dayflow-ablation-live-collection-freeze-v0.1
liveCollectionFreezeId: dfalf-<immutable-id>
liveCollectionFreezeSha256: <detached-domain-hash>
lineageClass: control
targetDataOrigin: live
targetStudyPhase: private_pilot | directional_study
targetCheckpointCount: 15 when private_pilot | 60 when directional_study
contractFreezeRef { schemaVersion: dayflow-dfa-contract-freeze-v0.4, contractFreezeId, contractFreezeSha256 }
executionFreezeRef { schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
status: approved | closed
supersedesLiveCollectionFreezeRef: optional { schemaVersion, liveCollectionFreezeId, liveCollectionFreezeSha256 }
approvedAt: required only when approved
closedAt, closureReasonCode: required only when closed

studyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
inclusionPolicyVersion: <version>
exclusionPolicyVersion: <version>
checkpointSpacingPolicyVersion: <version>
asOfPolicyVersion: <version>
missingOutputAnalysisPolicyVersion: <version>
reviewRubricVersion: <version>
blindPermutationVersion: <version>
metricFormulaVersion: <version>

captureScopeHash: <sha256>
consentRevision: <approved-live-revision>
capturePolicyRef { version, sha256 }
denylistPolicyRef { version, sha256 }
retentionPolicyRef { policyId, sha256 }
encryptionDeploymentRef { version, sha256 }
artifactGovernancePolicyRefs[] sorted unique by (artifactClass, policyId):
  { artifactClass, policyId, policySha256 }
localOnly: true
cloudImageUpload: false

approvalRefs:
  - approvalType: H-LIVE-CAPTURE | H-PILOT-GO
    approvalRecordId: <immutable-id>
    approvalRecordSha256: <sha256>
```

`studyProtocolHash`가 수집 전에 고정하는 연구 단위다. Protocol manifest에는 source/config tuple, inclusion/exclusion **규칙**, checkpoint 간격, randomization, replicate, review, metric, retention을 포함한다. 아직 발생하지 않은 checkpoint 집합의 최종 `datasetVersion`이나 `datasetSha256`을 수집 전에 만들지 않는다.

Private pilot freeze에는 그 pilot phase/protocol/scope에 맞는 current valid `H-LIVE-CAPTURE`가 정확히 하나 있어야 한다. Pilot go/no-go가 끝나면 별도 `H-PILOT-GO`를 생성한다. Directional-study freeze에는 새 directional phase용 current valid `H-LIVE-CAPTURE`와 pilot-derived current valid `H-PILOT-GO`가 모두 있어야 한다. Missing, duplicate, expired, revoked, wrong-phase, wrong-protocol, wrong-scope, hash-mismatched typed ref는 fail-closed다. Singular 또는 untyped `approvalRef`는 허용하지 않는다.

Resolved `H-LIVE-CAPTURE`의 `phase`, `studyProtocolRef`, `captureScopeHash`, `consentRevision`, `capturePolicyRef`, `denylistPolicyRef`, `retentionPolicyRef`, `encryptionDeploymentRef`, complete sorted `artifactGovernancePolicyRefs[]`, `localOnly: true`, `cloudImageUpload: false`는 freeze의 대응 field와 exact equal이어야 한다. Freeze는 `targetDataOrigin: live`이고 `targetStudyPhase`가 approval의 `phase`와 같은 underscore enum이어야 한다. Policy ID/version뿐 아니라 typed ref hash까지 다르면 거부한다.

### 4.3 Candidate generation과 final dataset freeze

생성 순서는 다음 strict DAG다.

```text
CandidateDatasetGeneration v0.1
  -> ExclusionClosure v0.1
  -> FinalDatasetManifest v0.1
  -> FinalDatasetBinding v0.1
```

후행 artifact만 immediate predecessor의 typed ID/hash를 참조한다. Predecessor의 successor reverse ref, mixed `studyProtocolHash`, self/forward/cycle, unresolved/hash-mismatched ref, unknown field는 거부한다.

```text
candidateDatasetGenerationSchemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1
candidateDatasetGenerationId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
priorCandidateDatasetGenerationRef: optional {
  schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1
  candidateDatasetGenerationId
  candidateDatasetGenerationSha256
}
completedCheckpointRuns[] sorted unique by checkpointId:
  checkpointRef {
    schemaVersion: dayflow-ablation-checkpoint-v0.2
    checkpointId
    checkpointSha256
  }
  checkpointCompletionRef {
    schemaVersion: dayflow-ablation-checkpoint-completion-v0.1
    checkpointCompletionId
    checkpointCompletionSha256
  }
  runRefs[] sorted unique by (armId, replicateIndex, runId):
    schemaVersion: dayflow-ablation-run-v0.4
    runId
    runSha256
    armId
    replicateIndex
createdAt
candidateDatasetGenerationSha256
```

Candidate generation은 completion이 `completed`이고 checkpoint/run/freeze/origin/phase/protocol이 일치한 뒤 publish한다. Entry `runRefs[]`는 completion refs와 exact sorted bijection이다. `priorCandidateDatasetGenerationRef`가 있으면 child는 cumulative full snapshot이어야 한다: parent entries 전부를 byte/JCS-identical하게 보존하고 최소 한 새 checkpoint를 추가하며 수정/drop/delta-only를 금지한다. `parentGenerationRef`, `priorCandidateGenerationRef`와 nested legacy aliases는 unknown으로 거부한다.

```text
exclusionDecisionSchemaVersion: dayflow-ablation-exclusion-decision-v0.1
exclusionDecisionId
lineageClass: evidence
dataOrigin: synthetic | live
studyPhase: contract_conformance | private_pilot | directional_study
studyProtocolHash
sourceGenerationRef { schemaVersion, candidateDatasetGenerationId, candidateDatasetGenerationSha256 }
checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
disposition: include | exclude
reasonCode
reasonDetail: optional private text
reviewerPseudonym
decidedAt
exclusionDecisionSha256
```

Decision은 source generation publish/readback 뒤에만 만들고 `decidedAt > sourceGeneration.createdAt`이어야 한다. Generation은 decision/ref를 갖지 않는다. Decision은 standalone immutable artifact이며 successor ref를 갖지 않는다.

```text
exclusionClosureSchemaVersion: dayflow-ablation-exclusion-closure-v0.1
exclusionClosureId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
sourceGenerationRef {
  schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1
  candidateDatasetGenerationId
  candidateDatasetGenerationSha256
}
decisionRefs[] sorted unique by checkpointId:
  checkpointId
  schemaVersion: dayflow-ablation-exclusion-decision-v0.1
  exclusionDecisionId
  exclusionDecisionSha256
closedAt
exclusionClosureSha256
```

Closure는 source generation의 모든 checkpoint에 정확히 한 standalone decision ref를 가지며 extra/missing decision을 거부한다. Resolved decision의 origin/phase/protocol/source generation/checkpoint hash가 closure와 일치하고 include/exclude 모두 `reasonCode`가 있어야 한다. Decision/closure의 successor reverse ref는 금지한다.

```text
finalDatasetManifestSchemaVersion: dayflow-ablation-final-dataset-manifest-v0.1
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
exclusionClosureRef {
  schemaVersion: dayflow-ablation-exclusion-closure-v0.1
  exclusionClosureId
  exclusionClosureSha256
}
datasetVersion
includedCheckpointRuns[] sorted unique by checkpointId:
  checkpointRef {
    schemaVersion: dayflow-ablation-checkpoint-v0.2
    checkpointId
    checkpointSha256
  }
  runRefs[] sorted unique by (armId, replicateIndex, runId):
    schemaVersion: dayflow-ablation-run-v0.4
    runId
    runSha256
    armId
    replicateIndex
    matchedPairId: required for A1 | B; forbidden for A0 | C
datasetSha256: detached manifest hash
```

Manifest는 closure의 `include` checkpoint와 source generation에 이미 있던 run만 exact sorted order로 포함한다. `datasetSha256` field를 JCS preimage에서 생략해 detached hash를 계산하며 binding reverse ref를 금지한다.

```text
finalDatasetBindingSchemaVersion: dayflow-ablation-final-dataset-binding-v0.1
finalDatasetBindingId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
manifestRef {
  schemaVersion: dayflow-ablation-final-dataset-manifest-v0.1
  datasetVersion
  datasetSha256
}
runBindings[] sorted unique by (checkpointId, armId, replicateIndex, runId):
  checkpointId
  checkpointSha256
  runId
  runSha256
  armId
  replicateIndex
  matchedPairId: required for A1 | B; forbidden for A0 | C
createdAt
finalDatasetBindingSha256
```

Binding은 typed manifest ref를 resolve하고 manifest/closure payload를 반복하지 않는다. `manifest.includedCheckpointRuns[].runRefs[]`를 각 parent `checkpointRef`와 함께 flatten한 집합과 `runBindings[]`는 exact bijection이어야 한다. Cardinality가 같고 모든 manifest run이 정확히 한 번 나타나야 하며 omit/add/duplicate를 모두 거부한다. 각 mapping의 `checkpointId`, `checkpointSha256`, `runId`, `runSha256`, `armId`, `replicateIndex`, 조건부 `matchedPairId`는 manifest/ref-resolved 값과 exact equal이어야 한다. Aggregate와 direct comparison은 같은 final binding ID/hash에서만 생성한다. Closure 뒤 변경은 기존 artifact 수정이 아니라 새 closure, manifest, binding, dataset version/hash, analysis ID로 표현한다.

### Model, prompt, config, replicate, randomization 규칙

- Provider가 recorded seed의 결정성을 보장하면 exact seed와 지원 조건을 기록한다.
- 결정성을 보장하지 못하면 사전에 승인된 동일한 `N`회 matched replicate를 `A1`과 `B`에 적용한다. 단일 unseeded sample은 causal comparison으로 인정하지 않는다.
- 각 checkpoint의 `(replicateIndex, A1, B)` 요청 순서는 고정 알고리즘과 기록된 randomization seed로 미리 생성한다. 결과를 본 뒤 순서를 바꾸지 않는다.
- Execution freeze에는 request-order schema/algorithm/seed/binding-time policy만 둔다. Concrete manifest는 checkpoint seal 뒤 첫 A1/B request 전에 immutable publish하고 해당 arm input/run이 typed ID/hash를 참조한다; freeze에는 future manifest ID/hash를 넣지 않는다.
- `A1`만 또는 `B`만 선택적으로 retry하지 않는다. 같은 retry policy와 missing-replicate policy를 적용하고 provider generation ID, latency, token usage, outcome을 모두 기록한다.
- `A0`는 sealed production 결과를 보존하므로 E1 model 요청을 새로 만들지 않는다. `C`의 model/prompt/config는 별도 고정 tuple로 기록하고 `A1/B` causal tuple과 혼합하지 않는다.
- 연구 도중 model alias, prompt text, template, config, seed, replicate count, randomization, retry policy가 바뀌면 현재 study를 중단하고 새 implementation/live freeze와 `studyProtocolHash`로 다시 시작한다. 수집 후 final dataset version은 exclusion closure 뒤에만 만든다.

## 5. Immutable ID, hash, artifact 경계

### 필수 ID

최소한 다음 ID를 생성 시점에 고정하고 재사용하거나 덮어쓰지 않는다.

- `contractFreezeId`, `liveCollectionFreezeId`, `studyProtocolHash`, `sessionId`
- 수집 중 `candidateDatasetGenerationId`, `candidateDatasetGenerationSha256`; exclusion closure 후 `datasetVersion`, `datasetSha256`
- `exclusionDecisionId`, `exclusionClosureId`, `finalDatasetBindingId`, `finalDatasetBindingSha256`
- `exportId`, `generationId`, `evidenceId`, `checkpointId`
- arm·replicate별 `runId`, item별 `outputItemId`
- `evalId`, `reviewId`, `analysisId`, `deletionReceiptId`
- blind mapping용 `permutationVersion`, `permutationHash`

같은 checkpoint를 재실행해도 기존 `runId`를 overwrite하지 않는다. 새 `runId`를 만들고 `comparisonRunIds`, retry/replicate 관계를 명시한다. 수정은 기존 artifact 변경이 아니라 새 generation과 supersession link로 표현한다.

### Canonical hash

- 각 domain은 export, normalized evidence, checkpoint, `A0`, `A1`, `B`, `C`, dataset, output으로 분리한다.
- Hash preimage는 `UTF8(domain + "\u0000") || JCS(value)`다.
- Self-referential hash field는 preimage에서 제외하고 payload 밖에 저장한다.
- 시간은 UTC RFC 3339, 정확히 millisecond 3자리와 `Z`를 사용한다.
- source row ID, safe integer 범위를 넘는 byte count와 identifier는 decimal string으로 직렬화한다.
- 모든 blob과 manifest는 size와 SHA-256을 검증한다.
- Swift와 TypeScript의 RFC 8785/JCS conformance vector가 다르면 export를 받지 않는다.

모든 immutable JSON artifact는 아래 exact schema version과 hash domain을 사용한다. 새 artifact/version은 이 registry, producer/consumer, conformance vector를 함께 갱신하기 전 publish할 수 없다.

Canonical inventory는 [`contracts.ts`](../src/evaluation/dayflowAblation/contracts.ts)의 frozen
`DAYFLOW_ABLATION_ARTIFACT_REGISTRY`다. Current complete 36-row projection은 다음과 같다.

| Artifact class | Schema version | Hash domain | Storage | Detached hash field |
| --- | --- | --- | --- | --- |
| `dayflow-export-manifest` | `dayflow-screen-evidence-export-v0.1` | `blabase.dayflow-screen-evidence-export.v0.1` | `standalone` | `detachedManifestSha256` |
| `normalized-screen-evidence` | `dayflow-normalized-evidence-v0.1` | `blabase.dayflow-normalized-evidence.v0.1` | `standalone` | `dayflowNormalizedEvidenceHash` |
| `source-pin-set` | `dayflow-ablation-source-pin-set-v0.1` | `blabase.dayflow-ablation.source-pin-set.v0.1` | `standalone` | `sourcePinSetSha256` |
| `artifact-layout-config` | `dayflow-ablation-artifact-layout-config-v0.1` | `blabase.dayflow-ablation.artifact-layout-config.v0.1` | `standalone` | `artifactLayoutConfigSha256` |
| `contract-freeze-proposal` | `dayflow-dfa-contract-freeze-proposal-v0.4` | `blabase.dayflow-dfa.contract-freeze-proposal.v0.4` | `standalone` | `contractFreezeProposalSha256` |
| `dfa-contract-decision` | `dayflow-dfa-contract-decision-v0.4` | `blabase.dayflow-dfa.contract-decision.v0.4` | `standalone` | `contractDecisionSha256` |
| `contract-freeze` | `dayflow-dfa-contract-freeze-v0.4` | `blabase.dayflow-dfa.contract-freeze.v0.4` | `standalone` | `contractFreezeSha256` |
| `dfa-command-receipt` | `dayflow-dfa-command-receipt-v0.1` | `blabase.dayflow-dfa.command-receipt.v0.1` | `standalone` | `commandReceiptSha256` |
| `dfa-readable-diff` | `dayflow-dfa-readable-diff-v0.3` | `blabase.dayflow-dfa.readable-diff.v0.3` | `standalone` | `readableDiffSha256` |
| `dfa-machine-evidence-bundle` | `dayflow-dfa-machine-evidence-bundle-v0.3` | `blabase.dayflow-dfa.machine-evidence-bundle.v0.3` | `standalone` | `machineEvidenceBundleSha256` |
| `dfa-human-review-receipt` | `dayflow-dfa-human-review-receipt-v0.3` | `blabase.dayflow-dfa.human-review-receipt.v0.3` | `standalone` | `humanReviewReceiptSha256` |
| `evaluation-execution-freeze` | `dayflow-ablation-evaluation-execution-freeze-v0.1` | `blabase.dayflow-ablation.evaluation-execution-freeze.v0.1` | `standalone` | `evaluationExecutionFreezeSha256` |
| `live-collection-freeze` | `dayflow-ablation-live-collection-freeze-v0.1` | `blabase.dayflow-ablation.live-collection-freeze.v0.1` | `standalone` | `liveCollectionFreezeSha256` |
| `human-approval-record` | `dayflow-ablation-human-approval-v0.1` | `blabase.dayflow-ablation.human-approval.v0.1` | `standalone` | `approvalRecordSha256` |
| `study-protocol` | `dayflow-ablation-study-protocol-v0.1` | `blabase.dayflow-ablation.study-protocol.v0.1` | `standalone` | `studyProtocolHash` |
| `request-order-manifest` | `dayflow-ablation-request-order-manifest-v0.1` | `blabase.dayflow-ablation.request-order-manifest.v0.1` | `standalone` | `requestOrderManifestSha256` |
| `request-issuance-receipt` | `dayflow-ablation-request-issuance-receipt-v0.1` | `blabase.dayflow-ablation.request-issuance-receipt.v0.1` | `standalone` | `requestIssuanceReceiptSha256` |
| `blind-permutation` | `dayflow-ablation-blind-permutation-v0.1` | `blabase.dayflow-ablation.blind-permutation.v0.1` | `standalone` | `permutationHash` |
| `candidate-dataset-generation` | `dayflow-ablation-candidate-dataset-generation-v0.1` | `blabase.dayflow-ablation.candidate-dataset-generation.v0.1` | `standalone` | `candidateDatasetGenerationSha256` |
| `exclusion-decision` | `dayflow-ablation-exclusion-decision-v0.1` | `blabase.dayflow-ablation.exclusion-decision.v0.1` | `standalone` | `exclusionDecisionSha256` |
| `exclusion-closure` | `dayflow-ablation-exclusion-closure-v0.1` | `blabase.dayflow-ablation.exclusion-closure.v0.1` | `standalone` | `exclusionClosureSha256` |
| `final-dataset-manifest` | `dayflow-ablation-final-dataset-manifest-v0.1` | `blabase.dayflow-ablation.final-dataset-manifest.v0.1` | `standalone` | `datasetSha256` |
| `final-dataset-binding` | `dayflow-ablation-final-dataset-binding-v0.1` | `blabase.dayflow-ablation.final-dataset-binding.v0.1` | `standalone` | `finalDatasetBindingSha256` |
| `pilot-verification-attestation` | `dayflow-ablation-pilot-verification-attestation-v0.1` | `blabase.dayflow-ablation.pilot-verification-attestation.v0.1` | `standalone` | `pilotVerificationAttestationSha256` |
| `evaluation-checkpoint` | `dayflow-ablation-checkpoint-v0.2` | `blabase.dayflow-ablation.checkpoint.v0.2` | `standalone` | `checkpointSha256` |
| `checkpoint-completion` | `dayflow-ablation-checkpoint-completion-v0.1` | `blabase.dayflow-ablation.checkpoint-completion.v0.1` | `standalone` | `checkpointCompletionSha256` |
| `a0-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.a0.v0.4` | `standalone` | `armInputHash` |
| `a1-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.a1.v0.4` | `standalone` | `armInputHash` |
| `b-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.b.v0.4` | `standalone` | `armInputHash` |
| `c-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.c.v0.4` | `standalone` | `armInputHash` |
| `semantic-output` | `dayflow-ablation-semantic-output-v0.1` | `blabase.dayflow-ablation.semantic-output.v0.1` | `standalone` | `semanticOutputSha256` |
| `arm-run` | `dayflow-ablation-run-v0.4` | `blabase.dayflow-ablation.run.v0.4` | `standalone` | `runSha256` |
| `output-review` | `dayflow-ablation-output-review-v0.2` | `blabase.dayflow-ablation.output-review.v0.2` | `standalone` | `outputReviewSha256` |
| `pair-preference-review` | `dayflow-ablation-pair-preference-review-v0.2` | `blabase.dayflow-ablation.pair-preference-review.v0.2` | `standalone` | `pairPreferenceReviewSha256` |
| `deletion-receipt` | `dayflow-ablation-deletion-receipt-v0.1` | `blabase.dayflow-ablation.deletion-receipt.v0.1` | `standalone` | `deletionReceiptSha256` |
| `aggregate` | `dayflow-ablation-aggregate-v0.1` | `blabase.dayflow-ablation.aggregate.v0.1` | `standalone` | `aggregateSha256` |

각 candidate registry row는 closed tuple `{ artifactClass, schemaVersion, hashDomain,
storageMode, detachedHashField }`이고 `storageMode`는 `standalone | embedded`뿐이며 current
36 rows는 모두 `standalone`이다. Human-approved Draft
scope ECR은 registry 밖이다. ContractFreezeProposal과 ContractFreeze는 frozen source
schema/hash contract를 따르며 다른 candidate artifact와 혼동하지 않는다.

Layout `pathTemplates[]`는 `storageMode: standalone` row와만 exact bijection이다. State generation과 `CURRENT_STATE.json`은 operational non-registry layout exception이다. Generation은 immutable whole-file-hashed JSON이고 `CURRENT_STATE.json`은 §15 bytes/CAS 규칙을 따르는 유일한 replaceable pointer이며, 둘 다 registry storage mode가 없다. Export blob은 JSON registry 밖 immutable raw-byte blob이고 exact export-manifest frame entry 하나가 owner이며 hash는 raw bytes SHA-256이다. 다른 storage mode, embedded owner, pointer/blob 예외는 금지한다.

`contractFrozen` 뒤 candidate registry의 standalone JSON artifact와 embedded hashed
value는 `UTF8(domain + "\u0000") || JCS(value)`를 사용한다. Draft scope ECR과 raw
screenshot blob은 각각 ECR/export contract가 선언한 byte/hash 규칙을 사용하며 candidate
JCS artifact가 아니다.

위 table의 `Detached hash field` column은 current registry의 exhaustive authority다. 각
standalone strict schema는 registered JCS hash preimage에서 그 field 하나만 제외한다.
State generation과 replaceable pointer는 operational non-registry artifact이며
`stateGenerationSha256`은 exact whole-file UTF-8/LF raw bytes의 SHA-256으로 byte integrity만
증명한다. Raw export blob과 Draft scope ECR도 각 contract/record가 선언한 byte/hash 규칙을
쓴다.

### Private artifact layout

Blabase가 소유하는 모든 실험 artifact는 아래 repository-relative `suggestion/.local/` root 아래에만 둔다. 절대 경로, raw human content, credential은 evaluation domain object나 public report에 기록하지 않는다. DFA-002 pre-freeze 작업은 `staging`, `pins`, `command-receipts`, `readable-diffs`, `machine-evidence-bundles`, `human-review-receipts`, `contract-proposals`와 operational `state`만 사용한다. `contract-decisions`와 `contract-freezes`는 각각 human decision과 approved-decision gate 뒤에만 eligible하며 나머지는 trusted contract freeze 뒤의 evaluation layout이다.

```text
suggestion/.local/evaluations/dayflow-ablation/
  state/CURRENT_STATE.json
  state/generations/<stateGenerationId>.json
  pins/<sourcePinSetId>.json
  command-receipts/<commandReceiptId>.json
  readable-diffs/<readableDiffId>.json
  machine-evidence-bundles/<machineEvidenceBundleId>.json
  human-review-receipts/<humanReviewReceiptId>.json
  contract-proposals/<contractFreezeProposalId>.json
  contract-decisions/<contractDecisionId>.json
  contract-freezes/<contractFreezeId>.json
  configs/artifact-layout/<artifactLayoutConfigId>.json
  freezes/evaluation/<evaluationExecutionFreezeId>.json
  freezes/live/<liveCollectionFreezeId>.json
  protocols/<studyProtocolHash>.json
  request-orders/<requestOrderManifestId>.json
  datasets/candidates/<candidateDatasetGenerationId>/manifest.json
  datasets/<datasetVersion>/manifest.json
  exclusions/decisions/<exclusionDecisionId>.json
  exclusions/closures/<exclusionClosureId>.json
  bindings/<finalDatasetBindingId>.json
  approvals/<approvalRecordId>.json
  exports/<exportId>/manifest.json
  exports/<exportId>/blobs/<sha256>
  normalized/<evidenceId>.json
  checkpoints/<checkpointId>.json
  checkpoint-completions/<checkpointCompletionId>.json
  arm-inputs/<armInputHash>.json
  permutations/<permutationHash>.json
  runs/<runId>.json
  reviews/<reviewId>.json
  aggregates/<analysisId>.json
  deletion-receipts/<deletionReceiptId>.json
  staging/<sessionId>/
```

이 layout의 source schema와 path set은 `DFA-002` source-hash proposal에 포함되고 matching
contract freeze에서만 동결된다. `pathTemplates[]`는 registry의 `storageMode: standalone` class만 exact
bijection이고 embedded row에는 template가 없다. Replaceable pointer와 raw export
blob만 명시적 non-registry 예외다. 누락/extra/duplicate standalone class는 거부한다.
`root`와 resolved unique `temporaryRootTemplate`가 두 configured root다. 이후 변경은
새 proposal/approval/freeze chain을 요구한다. Directory `0700`, file `0600`,
immutable publish no-clobber·atomic rename·readback을 사용한다.
`state/CURRENT_STATE.json`만 canonical replaceable pointer이고 YAML은 금지한다.
Symlink, traversal, root 이탈, immutable destination 재사용은 fail-closed다.
Draft는 `staging/<sessionId>/`에서만 최대 1시간 허용하고 canonical destination에는
schema-valid LF JSON만 publish한다. 별도 persistent `contract-proposals/evidence` 또는
unregistered diff/report subtree는 금지한다.

Dayflow canonical source frame은 별도 Dayflow-owned storage에 남는다. Blabase에는 importer root 안의 bounded copy 또는 opaque reference만 허용하며 ownership과 retention class를 섞지 않는다. Git, Golden Dataset, diagnostics, telemetry, backup에는 raw human frame과 private review를 넣지 않는다.

### Governance artifact 분류

Live collection 전에 아래 각 artifact class의 exact policy ID를 `artifactGovernancePolicyIds`에 동결한다. `retention`, `deletion`, `backup`, `consent` 중 하나라도 미분류면 live capture는 금지한다.

| Artifact class | Consent 분류 | Retention 분류 | Deletion 분류 | Backup 분류 |
| --- | --- | --- | --- | --- |
| Scope ECR/proposal/contract freeze | Synthetic/governance metadata only; no live consent authority | Append-only source/audit retention | In-place mutation 금지; successor record로 supersede | 기본 excluded |
| DFA-002 pin/command/diff/machine/human evidence | Synthetic private source/code metadata only; raw screen/conversation/blob 금지 | Pending chain은 `sourcePinSet.createdAt`부터 최대 30일; stale/abandoned chain은 승격 금지; approved current freeze가 참조한 complete chain만 freeze source/audit retention으로 승격 | Abandon/reject/scope-revoke/rollback 중 earliest trigger에 safe purge; replacement/reconciliation 전 immutable artifact 수정·재사용 금지 | Git/backup/export/telemetry excluded |
| Live-collection freeze | Consent/approval reference만 포함, raw content 금지 | `liveGovernanceRetentionPolicyId` | Consent revoke와 study close를 반영한 reviewed purge | 기본 excluded |
| Candidate/final dataset manifest | Consent-bound derived metadata와 hashes | Private evaluation 최대 30일 정책 | Tombstone 뒤 manifest/relation purge; content-free aggregate만 별도 review | excluded |
| Pilot verification attestation | Private metadata only; raw blob 없음 | `verifiedAt`부터 decision-audit need 동안, 최대 30일 | Earliest deletion/revocation/invalidation/rollback trigger에 receipt-covered purge | excluded; export/telemetry 금지 |
| State generation과 CURRENT_STATE pointer | Private operational metadata; live phase에는 consent reference 포함 | `stateRetentionPolicyId`, 기본 최대 30일 | Immutable generations reviewed purge, pointer는 tombstone generation으로 atomic 교체 | excluded |
| Human approval record | Approver/pseudonymous audit metadata | 별도 `approvalAuditRetentionPolicyId` | 일반 subject-data purge와 분리한 reviewed audit deletion | 별도 review 전 excluded |
| Deletion receipt | Consent/deletion 결과의 content-free 또는 pseudonymous audit metadata | **별도 `deletionReceiptAuditRetentionPolicyId`** | 삭제 증명 기간 동안 subject-data purge와 함께 지우지 않으며 audit expiry 뒤 reviewed deletion | 별도 audit-backup 결정, 기본 excluded |

Deletion receipt는 raw/private payload를 보존하는 수단이 아니다. 다만 삭제 완료를 검증할 별도 reviewed audit-retention을 적용하며, 그 policy ID와 backup 결정을 `H-LIVE-CAPTURE` 전에 승인한다.

## 6. Consent, coverage, retention, deletion

### Consent와 capture gate

화면 capture consent는 connector, Work Board monitoring, semantic continuation, quality feedback consent와 별개다. Live frame 하나를 받기 전에 다음이 모두 승인돼야 한다.

- Screen Recording 권한과 항상 보이는 capture indicator
- 즉시 pause 동작
- app/window/display denylist
- password, authentication, banking, health, private messaging 기본 차단
- capture 시점의 consent revision과 policy decision attestation 저장
- raw·derived retention, backup exclusion, local encryption/threat model
- local-only 처리와 cloud image upload 비활성화
- 사람의 screenshot inspection 허용 범위
- 양 저장소 purge와 deletion receipt 절차

Consent 또는 policy revision이 바뀌면 현재 bundle을 닫는다. Mixed-revision bundle이나 per-frame attestation이 없는 frame은 거부한다.

### Coverage 검증

`coverage.intervals[]`는 `[windowStart, windowEnd)` 전체를 빠짐없이 덮는 non-overlapping half-open partition이어야 한다. 각 interval의 reason은 다음 중 하나다.

```text
running | paused | locked | policy-denied | missing | read-failed | unavailable
```

Overlap precedence는 다음 순서로 고정한다.

```text
unavailable > read-failed > missing > policy-denied > locked > paused > running
```

Verifier는 window clip, 모든 boundary split, precedence resolution, adjacent coalescing, `(start, end)` sort를 수행한다. Top-level expected/observed/rejected count는 interval 합과 같아야 하며, `0 <= rejected <= observed`, `artifacts.length == observed - rejected`를 만족해야 한다.

Coverage 결과는 세 가지뿐이다.

| 결과 | 조건 | 후속 동작 |
| --- | --- | --- |
| `observed` | accepted artifact가 1개 이상이고 failure가 없음 | normalization 가능 |
| `valid-empty` | 모든 interval이 `paused`, `locked`, `policy-denied`이고 세 count가 모두 0 | 관측 없음으로 기록. inactivity claim 금지 |
| `failure` | `missing`, `read-failed`, `unavailable`, expected frame 누락, rejected frame, partition/count/hash 불일치 등 | evidence claim 0개, screen input unavailable |

Unknown privacy state, placeholder 판별 불가, deleted/missing/future/duplicate/out-of-window/unsupported row는 typed issue다. 오류를 빈 배열이나 zero activity로 바꾸지 않는다.

### Retention 기본값

| 데이터 class | 최대 보존 |
| --- | ---: |
| Blabase raw export/blob copy | 24시간 |
| Pilot-created Dayflow canonical source frame | 24시간 |
| Blabase complete export bundle | 24시간 |
| OCR, thumbnail, extractor temporary, model intermediate | 가능하면 memory-only, 아니면 1시간 |
| Redacted normalized evidence | 30일 |
| Checkpoint, arm output, blind mapping, private review | 30일 |
| Pilot verification attestation | `verifiedAt`부터 audit need 동안, 최대 30일; earliest deletion/revocation/invalidation/rollback trigger 적용 |
| DFA-002 pending evidence chain | `sourcePinSet.createdAt`부터 최대 30일; abandonment/rejection/scope-revocation/rollback 중 earliest trigger 적용; stale pre-correction pin/receipts는 authority 승격 없이 safe purge/replacement pending; approved current freeze가 참조한 complete chain만 append-only source/audit policy로 유지 |
| Staging·incomplete bundle | 1시간 후 reconciliation |
| Content-free diagnostic | 30일 |
| Content-free aggregate | privacy review 후에만 indefinite 가능 |

Dayflow가 pilot frame의 24시간 TTL을 집행하지 못하면 live pilot은 금지한다. 더 긴 retention은 원래 deadline 전에 별도 `H-EXCEPTION`으로 승인하고, 이후 생성되는 deletion receipt가 그 immutable exception의 typed ID/hash를 참조해야 한다.

DFA-002 command receipt는 unsanitized stdout/stderr bytes를 persist하지 않고 그 raw
length/hash와 bounded sanitized text/hash, redaction 여부/policy만 결속한다. Readable diff
v0.3는 최대 4 MiB의 UTF-8 before/after source content를 담되 private-secret material을
거부한다. 이 private source/code evidence는 Git, backup, export, telemetry와 public report에
넣지 않는다. Sensitive 또는 mismatch artifact는 수정하지 않고 폐기 후 재생성한다.

### 삭제 순서

```text
impact preview
  -> revision-bound human confirmation
  -> deletion intent/tombstone commit
  -> new capture와 late publication fencing
  -> Blabase relation/blob/staging/cache purge
  -> Dayflow pilot-created canonical frame purge
  -> orphan/reconciliation scan
  -> deletion receipt publish
```

Receipt는 최소한 다음을 분리해 기록한다.

```text
deletionReceiptSchemaVersion: dayflow-ablation-deletion-receipt-v0.1
deletionReceiptId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
affectedArtifactRefs[] sorted unique
blabaseRawCopyStatus: deleted | not-present | pending | failed
blabaseRawCopyPurgedAt: <timestamp-or-null>
dayflowCanonicalSourceStatus: deleted | not-present | retained-under-separate-explicit-approval | pending | failed
dayflowCanonicalSourcePurgedAt: <timestamp-or-null>
dayflowCanonicalRetentionExceptionRef: <required-when-retained> {
  schemaVersion: dayflow-ablation-human-approval-v0.1
  approvalType: H-EXCEPTION
  approvalRecordId
  approvalRecordSha256
}
createdAt
deletionReceiptSha256
```

어느 required purge라도 `pending` 또는 `failed`이면 삭제는 성공이 아니다. `retained-under-separate-explicit-approval`이면 receipt의 typed ref가 먼저 동결된 current `longer-retention` exception을 resolve하고 해당 frame과 deadline을 cover해야 한다. 새 live capture와 study resume를 차단한다. Raw 삭제 후 replay가 필요하면 frozen normalized evidence에서 시작하며 이미 삭제한 image extraction을 재실행하지 않는다.

## 7. 한 capture window에서 네 arm을 만드는 canonical workflow

아래 순서를 바꾸거나 arm별로 따로 capture하지 않는다. 네 arm은 `captureWindowId`를 공유하지만, structured checkpoint는 `A0/A1/B`에만 허용된다. `C`는 같은 window의 independently serialized screen-only input만 받는다.

### 7.1 Entry gate

다음이 모두 참이어야 checkpoint 생성을 시작한다.

- trusted `contractFreezeId` raw hash가 resolve되고 source pin이 현재 입력과 일치한다.
- Live phase라면 승인된 `liveCollectionFreezeId`와 `studyProtocolHash`가 있고 inclusion/exclusion 규칙과 `asOf` 정책이 동결됐다.
- 수집 중에는 final dataset을 사전 생성하지 않으며 latest candidate dataset generation이 있으면 immutable hash가 유효하다.
- 필요한 경우 현재 consent/capture/retention approval가 유효하다.
- 이전 session의 staging과 deletion receipt가 reconciled 상태다.
- arm tuple, replicate count, randomization manifest가 실행 전에 고정됐다.
- live study라면 capture window가 앞선 eligible checkpoint와 겹치지 않는다.

### 7.2 Capture와 export를 한 번만 동결

1. `sessionId`, `captureWindowId`, 예정 `checkpointId`, `asOf`, `[windowStart, windowEnd)`를 만든다.
2. 같은 시점의 sealed current Attention result, Board, structured evidence, WorkContext registry hash를 기록한다.
3. Dayflow-owned stable snapshot에서 atomic export bundle 하나를 만든다. Live SQLite 또는 SQLite file copy를 직접 읽지 않는다.
4. Complete marker 전에 모든 blob fsync, byte size, SHA-256, row bounds, consent/policy revision을 검증한다.
5. Exact manifest를 JCS canonicalize하고 detached manifest hash를 검증한다.
6. Producer가 이미 canonical form으로 직렬화한 coverage partition을 exact byte/parser contract로 검증한다. Import verifier는 persisted input을 고치거나 재정렬하지 않으며 non-canonical partition이면 typed unavailable 상태로 export 전체를 거부하고 raw claim extraction을 수행하지 않는다.

Window마다 Dayflow export는 정확히 하나만 만든다. Arm별 재-capture, frame 추가·삭제, window shift는 금지한다. Verified normalized screen evidence를 consume할 수 있는 arm은 `B`와 `C`뿐이다. `A0/A1`은 allowlisted `captureWindowId`와 `checkpointId`만 grouping/audit용으로 가지며 export/normalized hash, blob ref, screen label, importer handle을 받거나 dereference하지 않는다.

### 7.3 Screen normalization을 한 번만 동결

1. Verified export, capture metadata, privacy/capture policy만 extractor input allowlist에 넣는다.
2. Structured candidate, Board, registry, target/project label, source state를 extractor에 전달하지 않는다.
3. Local-only minimization, redaction, extraction, claim verification을 수행한다.
4. 각 field/claim을 exact source artifact hash와 capture span에 연결한다.
5. rejected claim과 conflicting claim을 성공한 빈 값에 숨기지 않고 별도 기록한다.
6. `extractorInputHash`, normalized payload hash, model/prompt/config/guardrail/version을 publish한다.

Structured 또는 registry data를 임의 변경해도 normalized screen evidence byte와 hash가 같아야 한다.

Normalized claim collection의 exact schema는 다음과 같다.

```text
acceptedClaims[] sorted unique by claimId:
  { claimId, outputFieldPath, claimClass, normalizedValueHash, confidenceBasisPoints, fieldEvidenceId }
fieldEvidence[] sorted unique by fieldEvidenceId:
  { fieldEvidenceId, claimId, outputFieldPath,
    sourceArtifactRefs[] non-empty sorted unique by (exportId,sourceRowId,blobSha256),
    captureSpans[] non-empty sorted unique by canonical discriminated-union key }
rejectedClaims[] sorted unique by rejectedClaimId:
  { rejectedClaimId, proposedOutputFieldPath, claimClass, proposedValueHash, reasonCode,
    sourceArtifactRefs[] sorted unique restricted refs, rejectedAt }
conflictingClaims[] sorted unique by conflictId:
  { conflictId, outputFieldPath, screenClaimIds[] non-empty sorted unique, structuredAuthorityRef: strict union,
    resolutionCode: STRUCTURED_AUTHORITY_WINS | DROP_SCREEN_CLAIM, reasonCode }
```

Nested wire type은 다음 closed union이다.

```text
sourceArtifactRef {
  artifactType: dayflow_export_frame
  exportRef { schemaVersion: dayflow-screen-evidence-export-v0.1, exportId, detachedManifestSha256 }
  sourceRowId, blobSha256
}
captureSpan:
  normalized_frame -> { spanKind: normalized_frame, sourceArtifactRef, startOffsetMs, endOffsetMs }
  text_offset_utf8 -> { spanKind: text_offset_utf8, sourceArtifactRef, normalizedTextSha256, startByteOffset, endByteOffset }
structuredAuthorityRef:
  sealed_attention_result -> { authorityType: sealed_attention_result, resultId, resultSha256 }
  checkpoint_structured_field -> { authorityType: checkpoint_structured_field,
    checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 },
    authorityClass: attention_input | attention_result | board | structured_evidence | work_context_registry,
    authoritySha256 }
semanticOutput {
  schemaVersion: dayflow-ablation-semantic-output-v0.1
  presentationMode: display_only
  status: suggestions_available | no_suggestion
  items[] max 3, sorted by position: {
    position, title, summary,
    caveatCodes[] sorted unique subset of SCREEN_CONTEXT_ONLY | NOT_COMPLETION_EVIDENCE | NOT_ACTIONABLE | NOT_OBSERVED_BY_SOURCE,
    claimIds[] sorted unique
  }
}
```

Offset/position은 JSON unsigned integer다. Frame은 millisecond 단위 `0 <= startOffsetMs < endOffsetMs <= windowDurationMs`, text는 UTF-8 byte 단위 `0 <= startByteOffset < endByteOffset <= actualNormalizedTextByteLength`다. `suggestions_available`은 contiguous position 1..N의 item 1..3개, `no_suggestion`은 item 0개다. Title은 NFC scalar 1..120, summary는 1..500이다. 모든 semantic-output level에서 `action`, `actionId`, `target`, `targetId`, executable URI 및 동등 field를 금지한다. `claimIds[]`는 해당 item leaf의 accepted claim만 resolve한다.

모든 path field는 RFC 6901 canonical JSON Pointer다. 명시 허용 외 empty 금지, `/` 시작, `~`는 `~0|~1`만, array token은 `0|[1-9][0-9]*`, decode 후 NFC re-encode bytes가 원문과 같아야 한다. `outputFieldPath`/`proposedOutputFieldPath`는 `/items/<0..2>/title`, `/items/<0..2>/summary`, `/items/<0..2>/caveatCodes/<canonical-index>` leaf만 허용한다. `confidenceBasisPoints`와 모든 confidence 값은 JSON unsigned integer `0..10000`이고 float/0..1/0..3 scale은 금지한다.

`claimClass` enum은 `VISIBLE_APPLICATION | VISIBLE_SUBJECT | VISIBLE_TASK_INTENT | RECENT_FOCUS | DISPLAY_TITLE_HINT | TASK_COMPLETION | VALIDATION_RESULT | MERGE_STATE | DEPLOYMENT_STATE | DELIVERY_STATE | EXTERNAL_MUTATION | VERIFIED_WORK_CONTEXT | INACTIVITY`다. Shared freeze body의 control `screenClaimPolicy`는 `policySchemaVersion: dayflow-screen-claim-policy-v0.1`, `lineageClass: control`, allowed=앞 5개, forbidden=뒤 8개, `structuredAuthorityWins: true`로 고정한다. Rejection reason은 `FORBIDDEN_CLAIM_CLASS | INSUFFICIENT_EVIDENCE | PRIVACY_BLOCKED | STRUCTURED_AUTHORITY_CONFLICT | STALE_EVIDENCE | COVERAGE_UNAVAILABLE | AMBIGUOUS_IDENTITY`, conflict reason은 `STRUCTURED_AUTHORITY_CONFLICT | AMBIGUOUS_IDENTITY | STALE_EVIDENCE`만 허용한다.

모든 emitted screen-derived semantic output leaf는 같은 path를 가진 accepted claim 하나와 fieldEvidence 하나에 exact bijection이어야 하고 그 역도 성립한다. Missing/extra/duplicate/cross-field lineage는 normalized evidence 전체를 거부한다. Rejected/conflicting item은 accepted coverage를 채우지 못하고 forbidden class는 semantic output에 들어가지 않는다.

### 7.4 Checkpoint를 immutable하게 publish

Checkpoint는 최소한 다음을 묶는다.

```text
checkpointSchemaVersion: dayflow-ablation-checkpoint-v0.2
checkpointId, asOf, windowStart, windowEnd
lineageClass: evidence
dataOrigin, studyPhase
captureWindowId, studyProtocolHash
studyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
executionFreezeRef {
  schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1,
  evaluationExecutionFreezeId,
  evaluationExecutionFreezeSha256
}
priorCandidateDatasetGenerationRef: optional {
  schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1,
  candidateDatasetGenerationId,
  candidateDatasetGenerationSha256
}
expectedRunKeys[] sorted unique by (armId, replicateIndex): { armId: A0 | A1 | B | C, replicateIndex }
blabaseCodeProvenance
currentAttentionInputHash, currentAttentionResultHash, currentBoardHash
structuredEvidenceHash, workContextRegistryHash
dayflowExportHash, dayflowNormalizedEvidenceHash
consentRevision, retentionPolicyId
inputSealStatus: sealed
checkpointSha256
```

`priorCandidateDatasetGenerationRef`는 checkpoint 시작 전에 완료된 generation만 가리키고 첫 checkpoint에서는 생략한다. `priorCandidateGenerationRef`, `candidateGenerationId`, `candidateGenerationSha256` 등 legacy alias는 unknown으로 거부한다. `studyProtocolRef.studyProtocolHash`는 repeated evidence hash와 같고 `executionFreezeRef` target origin/phase/protocol 및 arm/replicate projection은 authoritative protocol의 `armPolicy`와 같아야 한다. `expectedRunKeys[]`는 각 enabled arm의 JSON integer `replicateIndex` `0..replicateCountByArm[armId]-1`을 enum arm order/numeric index로 정렬한 exact set이며 disabled arm은 key가 없다. Stored/ref-resolved protocol/freeze mismatch는 fail-closed다. 모든 입력 참조가 no-clobber publish되고 readback hash가 맞으면 sealed checkpoint를 publish하며 run/completion/future generation ref는 금지한다.

### 7.5 네 input projection 생성

동일 capture window에서 아래 projection을 independently allowlist, serialize, hash한다. `A0/A1/B`는 permitted structured checkpoint를 공유하지만 `C`에는 그 checkpoint payload나 hash를 직렬화하지 않는다.

다음은 `dayflow-ablation-arm-input-v0.4` candidate acceptance sketch다. 이 exact source schema가 source-hash proposal과 `H-DFA-CONTRACT`/matching freeze에 결속된 뒤에만 normative가 된다. Common 및 선택 variant에 열거되지 않은 field와 다른 variant field는 forbidden이다.

```text
common:
  armInputSchemaVersion: dayflow-ablation-arm-input-v0.4
  armInputId
  lineageClass: evidence
  armId: A0 | A1 | B | C
  dataOrigin, studyPhase, studyProtocolHash
  captureWindowId
  executionFreezeRef { schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
  replicateIndex
  presentationPolicyRef { version, sha256 }
  armInputHash

A0:
  inputKind: structured_baseline
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  sealedAttentionResultRef { resultId, resultSha256 }
  structuredCheckpointRef { currentAttentionInputHash, currentAttentionResultHash, currentBoardHash, structuredEvidenceHash, workContextRegistryHash }
  screenEvidenceMode: none
  structuredCandidateHash, normalizedEvidenceRef, generationTupleSelector, matchedPairId, requestOrderManifestRef, requestId, requestPosition: forbidden

A1:
  inputKind: structured_generation
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  structuredCheckpointRef { currentAttentionInputHash, currentAttentionResultHash, currentBoardHash, structuredEvidenceHash, workContextRegistryHash }
  structuredCandidateHash
  screenEvidenceMode: masked
  generationTupleSelector: a1bCausalTuple
  matchedPairId
  requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
  requestId
  requestPosition: canonical decimal string
  sealedAttentionResultRef, normalizedEvidenceRef: forbidden

B:
  inputKind: structured_plus_screen_generation
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  structuredCheckpointRef { currentAttentionInputHash, currentAttentionResultHash, currentBoardHash, structuredEvidenceHash, workContextRegistryHash }
  structuredCandidateHash
  screenEvidenceMode: normalized
  normalizedEvidenceRef { schemaVersion: dayflow-normalized-evidence-v0.1, evidenceId, dayflowNormalizedEvidenceHash }
  generationTupleSelector: a1bCausalTuple
  matchedPairId
  requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
  requestId
  requestPosition: canonical decimal string
  sealedAttentionResultRef: forbidden

C:
  inputKind: screen_only_generation
  screenEvidenceMode: normalized
  normalizedEvidenceRef { schemaVersion: dayflow-normalized-evidence-v0.1, evidenceId, dayflowNormalizedEvidenceHash }
  generationTupleSelector: cScreenOnlyTuple
  checkpointRef, sealedAttentionResultRef, structuredCheckpointRef, structuredCandidateHash, matchedPairId, requestOrderManifestRef, requestId, requestPosition: forbidden
```

각 projection은 고유 hash domain, `armInputHash`, 별도 `runId`를 사용한다. `C` payload에는 structured hash 자체도 넣지 않는다.

### 7.6 실행과 replicate pairing

1. `A0` sealed bytes와 hash를 먼저 보존한다.
2. 미리 동결된 request order manifest대로 `A1/B` matched replicate를 실행한다.
3. `C`는 별도 screen-only schedule과 별도 report scope로 실행한다.
4. 모든 attempt에 attempt index, latency, token usage, cost, validation issue, request hash와 strict attempt variant가 허용한 response hash를 기록한다. `providerGenerationId`는 `provider_success` 또는 acknowledgement 이후 `provider_failure`에서만 required이고 나머지 variant에서는 null이 아니라 forbidden이다. Prompt body, raw source, credential, private URL은 기록하지 않는다.
5. 결과가 나오기 전과 후에 input tuple equality와 output provenance를 검증한다.
6. 각 실행을 `dayflow-ablation-run-v0.4`로 publish한다. A0/A1/B run은 existing checkpoint ID/hash를 결합하고 C run은 checkpoint ref를 금지한다. 모든 run은 `studyProtocolHash`, arm input hash, replicate와 해당 variant가 허용한 request-order/issuance refs, output hash를 결합하며 dataset/final-binding/review/analysis field를 금지한다.
7. Arm output을 각 `runId` artifact로 atomic no-clobber publish한다. 후행 dataset/review/aggregate는 existing run ID를 참조하며 run을 patch하지 않는다.

다음은 full run candidate acceptance sketch다. 이 exact source schema가 source-hash proposal과 `H-DFA-CONTRACT`/matching freeze에 결속된 뒤에만 normative가 된다.

```text
common:
  runSchemaVersion: dayflow-ablation-run-v0.4
  runId
  lineageClass: evidence
  armId: A0 | A1 | B | C
  dataOrigin, studyPhase, studyProtocolHash
  armInputRef { schemaVersion: dayflow-ablation-arm-input-v0.4, armInputId, armInputHash }
  executionFreezeRef { schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
  replicateIndex
  startedAt, completedAt
  status: completed | failed | no_output
  attempts[] sorted unique by numeric attemptIndex, strict union with common {
    attemptIndex, startedAt, completedAt,
    attemptKind: deterministic_success | provider_success | deterministic_failure | provider_failure,
    requestSha256, latencyMs, inputTokens, outputTokens, costMicrounits
  }
    deterministic_success -> { responseSha256, attemptOutputHash }; providerGenerationId, failureCode, failureStage forbidden
    provider_success -> { responseSha256, attemptOutputHash, providerGenerationId }; failureCode, failureStage forbidden
    deterministic_failure -> { failureCode }; responseSha256, attemptOutputHash, providerGenerationId, failureStage forbidden
    provider_failure -> { failureCode, failureStage: before_provider_acknowledgement | after_provider_acknowledgement };
      before -> providerGenerationId, responseSha256, attemptOutputHash forbidden;
      after -> bounded providerGenerationId and responseSha256 required, attemptOutputHash forbidden
  semanticOutput: conditional exact dayflow-ablation-semantic-output-v0.1
  validationIssueCodes[] sorted unique
  outputHash: conditional
  terminalFailureCode: conditional
  runSha256

A0:
  runKind: sealed_baseline
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  sealedResultSha256
  attempts: exactly one deterministic_success at attemptIndex 0
  status: completed
  matchedPairId, requestOrderManifestRef, requestId, requestPosition, requestIssuanceReceiptRef, issuanceSequence, terminalFailureCode: forbidden

A1 | B:
  runKind: causal_generation
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  matchedPairId
  requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
  requestId
  requestPosition: canonical decimal string
  requestIssuanceReceiptRef { schemaVersion: dayflow-ablation-request-issuance-receipt-v0.1, requestIssuanceReceiptId, requestIssuanceReceiptSha256 }
  issuanceSequence: canonical decimal string
  sealedResultSha256: forbidden

C:
  runKind: screen_only_generation
  checkpointRef, matchedPairId, requestOrderManifestRef, requestId, requestPosition, requestIssuanceReceiptRef, issuanceSequence, sealedResultSha256: forbidden
```

Attempt는 non-empty이고 JSON integer index 0부터 contiguous다. `providerGenerationId`는 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`이며 `provider_success`와 acknowledged `provider_failure`에서만 required, 나머지 variant에서 forbidden이다. Failure variant는 semantic output/output hash를 갖지 않는다. `completed`는 final success, `semanticOutput.status: suggestions_available`, output hash, terminal failure forbidden이다. `failed`는 failure variant만 허용하고 semantic output/output hash를 금지한다. `no_output`은 final success, `semanticOutput.status: no_suggestion`, output hash, literal `NO_ELIGIBLE_OUTPUT`이다. A0는 deterministic success 하나로 sealed result를 projection하고 provider를 호출하지 않는다. 다른 조합은 거부한다.

Run이 sealed checkpoint hash를 이미 참조하므로 checkpoint를 사후 patch하지 않는다. 대신 다음 별도 artifact를 publish한다.

```text
checkpointCompletionSchemaVersion: dayflow-ablation-checkpoint-completion-v0.1
checkpointCompletionId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
studyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
executionFreezeRef { schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
expectedRunKeys[] sorted unique by (armId, replicateIndex): { armId: A0 | A1 | B | C, replicateIndex }
completionStatus: completed | failed
presentRunRefs[] sorted unique by (armId, replicateIndex, runId):
  { schemaVersion: dayflow-ablation-run-v0.4, runId, runSha256, armId, replicateIndex }
missingExpectedRunKeys[] sorted unique by (armId, replicateIndex)
failedRunKeys[] sorted unique by (armId, replicateIndex)
noOutputRunKeys[] sorted unique by (armId, replicateIndex)
completedAt
checkpointCompletionSha256
```

Completion의 checkpoint/protocol/execution-freeze refs와 `expectedRunKeys[]`는 checkpoint와 byte/JCS-equal이고 protocol `armPolicy`에서 독립 재계산한다. `presentRunRefs[]`와 `missingExpectedRunKeys[]`는 expected keys를 exact partition하고 `failedRunKeys[]`/`noOutputRunKeys[]`는 겹치지 않는 present-key subset이다. Missing, failed, no-output가 하나도 없을 때만 `completed`이며 하나 이상이면 `failed`다. A0/A1/B는 exact checkpoint, C는 arm input을 통해 capture window/control refs를 match하고 completed completion만 generation에 들어간다.

한 A1/B matched pair는 같은 checkpoint ID/hash, `studyProtocolHash`, `replicateIndex`, globally unique `matchedPairId`, exact typed `requestOrderManifestRef`를 공유한다. Resolved manifest에는 그 pair ID에 A1 request 하나와 B request 하나만 있어야 하며 arm input/run request ID와 position이 entry와 일치한다. 각 causal run 시작 전 standalone issuance receipt가 manifest entry와 exact arm input을 결속한다. Receipt position/sequence는 `"0"`부터 contiguous이고 첫 receipt는 predecessor가 없으며 뒤 receipt는 직전 hash와 strictly increasing `issuedAt`을 갖고 run은 exact receipt ref/sequence를 반복한다. A0/C는 causal request/receipt field를 모두 금지한다. Duplicate pair/receipt, mixed checkpoint/protocol/replicate/manifest, broken chain, missing/extra peer, run-to-manifest/receipt mismatch는 거부한다.

### 7.7 Exit gate

Checkpoint는 다음을 모두 만족할 때만 `eligible`이다.

- 네 projection과 output의 ID/hash/provenance가 완전하다.
- `A0` byte-preservation이 통과했다.
- `A1/B` causal tuple은 screen-selection field를 제외하고 동일하다.
- replicate가 matched되고 요청 순서 manifest와 일치한다.
- `B`의 모든 screen-derived field에 lineage가 있다.
- invalid/unavailable screen fallback의 `B`가 `A1`과 byte-equal이다.
- `C` input에서 structured/registry/target taint가 검출되지 않는다.
- 어떤 arm도 action, external mutation, target open, production publish를 일으키지 않았다.
- retention deadline과 deletion schedule이 기록됐다.
- Checkpoint와 required run 뒤 standalone `checkpoint-completion-v0.1`이 publish됐고, 그 completion ref와 checkpoint ID/hash를 포함하는 새 immutable candidate dataset generation이 별도 publish됐다. Checkpoint는 이 사후 completion/generation을 참조하지 않는다.

하나라도 실패하면 checkpoint를 `ineligible`로 표시하고 metric denominator 처리는 미리 동결한 analysis policy만 따른다. 실패한 pair를 임의로 고치거나 다른 checkpoint와 짝짓지 않는다.

수집 중에는 candidate generation별 진행 현황만 계산할 수 있다. Generation은 completed checkpoint refs만 포함하고 single-parent ancestry의 self/forward/cycle을 거부한다. Direct arm comparison aggregate는 exclusion review를 close한 뒤 final-dataset-binding v0.1이 exact included checkpoint ID/hash와 existing run IDs를 `datasetVersion`/`datasetSha256`에 매핑한 후에만 publish한다. 모든 비교 record는 같은 binding ID/hash를 가져야 한다.

## 8. Cross-arm contamination 금지

### 금지되는 data flow

- `A0`와 `A1`은 Dayflow export, normalized evidence, screen-derived label을 읽지 않는다.
- `A1`은 `B`의 prompt fragment, model response, cache entry, derived title을 재사용하지 않는다.
- `B`는 fixed candidate 밖의 Board item, registry label, structured search result를 추가로 읽지 않는다.
- `C`는 structured candidate, source health, registry mapping, current Board, target label, structured hash를 받지 않는다.
- Extractor는 arm identity, A/B output, reviewer note, WorkContext registry를 받지 않는다.
- Reviewer projection은 actual arm을 노출하지 않으며 blind mapping은 rating commit 전 reviewer process에 전달하지 않는다.
- Cache key는 최소한 hash domain, `armInputHash`, tuple version, replicate index를 포함한다. Cross-arm cache hit은 금지한다.
- 한 arm의 failure, retry, human correction을 다른 arm input에 반영하지 않는다.

### 실행 전 taint/invariance checks

| Mutation | 반드시 불변이어야 하는 것 |
| --- | --- |
| Dayflow-only input mutation | `A0` bytes/hash, `A1` input/output bytes/hash |
| Registry·target label mutation | normalized screen evidence, `C` input/output bytes/hash |
| Fixed candidate 밖 structured mutation | `B` serialized input/output bytes/hash |
| Screen evidence mask 적용 | `B`가 아닌 `A1`에 raw/normalized screen byte가 0개임 |
| Invalid screen을 unavailable로 치환 | `B` output이 `A1` output과 byte-equal, `C` output은 none |

이 checks가 통과하지 않으면 live pilot과 aggregate 생성은 금지한다.

## 9. Human review workflow

### 9.1 OutputReview

Reviewer는 pair preference를 보기 전에 output을 독립적으로 평가한다.

1. `A1`과 `B`를 `causal-blind` queue의 서로 다른 session에 넣는다.
2. Reviewer projection은 `arm: redacted`, deterministic `opaqueSlot`, immutable `permutationRef`만 노출한다.
3. Reviewer는 rank 1~최대 3 각각의 acceptability, specificity, next-action clarity, correctness, timeliness, privacy concern, unsupported claim, wrong identity, stale/completed resurfacing을 기록한다.
4. `sourceArmGuess`와 JSON unsigned integer `sourceArmGuessConfidenceBasisPoints` 0..10000을 기록한 뒤 immutable commit한다.
5. `A0`는 `reference` queue에서 compatibility reference로 평가하며 blind causal queue에 섞지 않는다.
6. `C`는 screen-only caveat가 arm을 드러내므로 `screen-only` queue에서 별도 평가한다.
7. Commit 뒤 review를 수정하지 않는다. correction은 새 reviewed generation으로 만들고 원본을 보존한다.

`dayflow-ablation-output-review-v0.2`의 공통 식별자는 `reviewSchemaVersion`, `reviewId`, `evalId`, `dataOrigin`, `studyPhase`, `studyProtocolHash`, `checkpointId`, `runId`, `reviewerPseudonym`, `reviewedAt`, `committedAt`, store-assigned monotonic decimal-string `commitSequence`다. 모든 OutputReview의 `reviewId`와 `evalId`는 전역 unique다. `comparisonGroupId`는 A1/B blind variant에 required이고 A0/C variant에는 forbidden이다. Causal group은 전역 unique하며 정확히 A1 OutputReview 1개, B OutputReview 1개, PairPreferenceReview 1개만 소유한다. 두 OutputReview의 run은 같은 checkpoint ID/hash, `studyProtocolHash`, `dataOrigin`, `studyPhase`, JSON-integer `replicateIndex`, exact `matchedPairId`, exact `requestOrderManifestRef` 관계를 만족해야 한다. `rankAcceptability[]`는 `semanticOutput.items[].position` 1부터 최대 3까지 정확히 한 번씩 포함한다. Unknown field, ID/group 재사용, duplicate/extra record, double submit은 거부한다.

### 9.2 PairPreferenceReview

같은 checkpoint의 `A1`과 `B` OutputReview가 모두 commit된 뒤에만 paired view를 연다.

1. Frozen permutation으로 left/right opaque slot을 배치한다.
2. Reviewer는 `left | right | tie | none` 중 하나를 선택한다.
3. 다음 필드를 immutable하게 저장한다.

```text
reviewSchemaVersion: dayflow-ablation-pair-preference-review-v0.2
reviewId
evalId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
comparisonGroupId
checkpointId
leftOutputReviewId
rightOutputReviewId
leftRunId
rightRunId
leftOpaqueSlot
rightOpaqueSlot
permutationVersion
permutationHash
preference
reviewerPseudonym
reviewedAt
committedAt
commitSequence
pairPreferenceReviewSha256
```

4. PairPreferenceReview도 전역 unique `reviewId`와 `evalId`를 가진다. 두 ID namespace는 OutputReview와 PairPreferenceReview schema 전체에서 공유된다. 세 review의 `evalId`는 모두 다르며 Pair record를 만들기 직전 group에는 정확히 referenced A1/B OutputReview 두 개만 있어야 하고 Pair commit 뒤 cardinality는 정확히 3이어야 한다.
5. Validator는 left/right `OutputReview`가 서로 다른 `A1/B` run을 가리키고 같은 `checkpointId`, `reviewerPseudonym`, `comparisonGroupId`를 가지며, 두 run의 protocol, replicate, `matchedPairId`, request-order-manifest relation이 exact match이고, 두 review의 `committedAt`이 pair보다 늦지 않으며 `commitSequence`가 pair보다 엄격히 작은지 확인한다.
6. `left/rightOutputReviewId`, `left/rightRunId`, opaque slot과 arm orientation은 exact permutation version/hash와 일치해야 한다. Referenced run은 같은 checkpoint의 declared run이어야 한다.
7. `PairPreferenceReview.reviewerPseudonym`은 두 referenced OutputReview의 reviewer와 같아야 한다. ID/group 재사용, missing/duplicate/extra group member, reference 누락, uncommitted review, checkpoint/reviewer/protocol/replicate/matchedPair/manifest/run/permutation 불일치는 fail-closed다.
8. Preference를 본 뒤 OutputReview를 다시 열거나 점수를 고치지 않는다.
9. Unblinding은 review freeze와 integrity validation 뒤 aggregate process에서만 수행한다.

Raw review 경로는 다음과 같다.

```text
suggestion/.local/evaluations/dayflow-ablation/reviews/<reviewId>.json
```

### 9.3 Metrics

`Acceptable@1`은 eligible output의 rank-1 judgment가 `yes`인 비율이다. `Acceptable@3`은 rank 1~3 중 하나라도 `yes`인 비율이다. Missing output에 가짜 `no` rank를 만들지 않고 동결된 missing-output policy에 따라 eligible/excluded를 분리한다.

Aggregate는 `dayflow-ablation-final-dataset-binding-v0.1`의 ID/hash, exclusion closure, final `datasetVersion`, final `datasetSha256`을 반드시 참조한다. Candidate dataset generation 사이의 임시 수치를 direct arm comparison으로 발표하지 않으며, 서로 다른 binding의 metric을 직접 비교하지 않는다.

Aggregate는 다음 schema path에 count, denominator, excluded, rate를 모두 저장한다.

```text
aggregateSchemaVersion: dayflow-ablation-aggregate-v0.1
analysisId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
finalDatasetBindingId
finalDatasetBindingSha256
datasetVersion
datasetSha256
metrics.byArm.<A0|A1|B|C>.acceptableAt1
metrics.byArm.<A0|A1|B|C>.acceptableAt3
aggregateSha256
```

Primary와 safety metrics는 다음과 같다.

- `B versus A1` paired win/tie/loss와 Acceptable@1 차이
- Arm별 Acceptable@1, Acceptable@3
- Mean specificity, next-action clarity
- Wrong identity rate
- Unsupported state-claim rate
- Stale 또는 completed work resurfacing rate
- Confirmed privacy leak rate
- Automatic execution/external mutation count
- 모든 screen-derived title의 lineage coverage
- Added latency, compute, token/cost bucket, retained bytes
- `B` screen fallback/availability-failure rate
- Reviewer source-arm guess accuracy와 basis-points confidence 분포
- `C`의 별도 descriptive results; `A1/B` causal result와 합치지 않음

후속 promotion을 검토할 최소 안전 조건은 다음과 같다.

- `B`의 Acceptable@1이 `A1`보다 최소 10 percentage points 높다.
- Wrong identity와 unsupported state claim이 증가하지 않는다.
- Confirmed privacy leak은 0이다.
- Automatic execution/external mutation은 0이다.
- 모든 screen-derived title과 claim이 normalized evidence와 source hash로 추적된다.

Threshold 충족은 production 또는 E2 자동 승인이 아니다.

## 10. 연구 단계: synthetic → private pilot → frozen 60-checkpoint study

| 단계 | 관련 task | Entry | 실행 | Exit |
| --- | --- | --- | --- | --- |
| Synthetic contract-conformance regression | `DFA-009` | Contracts, evaluator, isolation, reproducibility tuple 완료 | Synthetic fixtures로 A0/A1/B/C, invalid coverage, fallback, taint 검증 | Exact version/hash/run ID, false quality/baseline/release claim flags와 private artifact가 기록되고 live data가 0개 |
| Private instrumentation pilot | `DFA-013` | `DFA-012` 완료 + phase-scoped typed `H-LIVE-CAPTURE` + pilot `studyProtocolHash` + lifecycle 준비 | 로컬 전용 15 checkpoint로 contract, blind review, purge, latency 확인 | Pilot closure/manifest/binding, manual inspection, deletion receipt, safety report 완료 |
| Human go/no-go | `DFA-014` | Pilot final binding/deletion evidence + frozen directional protocol + matching directional live approval | 품질보다 privacy/correctness를 우선해 결정 | Go이면 strict `H-PILOT-GO`; no-go/revise는 state/Engine Record만 갱신 |
| Frozen directional study | `DFA-015` | Current typed directional `H-LIVE-CAPTURE` + current `H-PILOT-GO` + directional `studyProtocolHash` | 최소 10 working days 동안 immutable candidate dataset generations로 eligible non-overlapping checkpoint 정확히 60개 수집 | Exclusion close 후 final binding을 만들고 그 binding으로 paired report 생성. Release claim은 하지 않음 |
| E2 decision | `DFA-016` | Frozen study review 완료 | 별도 candidate policy 필요성 판단 | Target protocol/final binding, quality evidence, decision/reason을 결속한 strict `H-E2` 기록 |

60-checkpoint study의 첫 capture 전에 inclusion/exclusion **규칙**, checkpoint spacing, model/prompt/config, replicate count, randomization, missing-output policy, rubric, permutation, metric formula, retention을 canonical protocol manifest로 만들고 `studyProtocolHash`를 freeze한다. 수집 중 checkpoint 집합은 immutable candidate dataset generations로 누적한다. 마지막 수집 뒤 exclusion을 close하고서 final dataset manifest와 final-dataset-binding v0.1을 freeze한다. Protocol이 바뀌면 새 study로 다시 시작하며, direct comparison은 같은 final binding ID/hash에서만 수행한다.

Contract-conformance regression artifact는 synthetic fixture만 사용할 수 있고 quality, baseline, release, `H-PILOT-GO`, `H-E2` evidence가 될 수 없다. 명시적으로 검토·익명화된 live data는 별도 승인된 향후 release 절차의 후보일 뿐이며 이 study는 release claim을 하지 않는다. Production screenshot이나 private pilot raw frame은 자동으로 regression/Golden data가 되지 않는다.

## 11. DFA-000부터 DFA-016까지 실행 순서

각 task는 한 번에 하나만 `in_progress`로 둔다. Entry gate를 충족하지 못하면 `blocked`로 기록하고, exit evidence가 없으면 `completed`로 바꾸지 않는다.

### DFA-000 — Human-approved synthetic scope ECR

- **현재 상태:** `completed`; implementation/contract/live/release는 승인되지 않았다.
- **Entry gate:** Plan, Runbook, Dayflow pins와 proposed tracked paths를 사람이 검토한다.
- **실행:** Full-template Draft ECR
  `ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`에 user approval, exact tracked
  path allowlist, synthetic-only prohibitions, status, rationale와 rollback을 기록한다.
- **Exit gate:** Base ECR과 additive DFA-001 evidence section에 DFA-000/DFA-001
  `completed`, DFA-002 `pending`이 있고 contract/cross-repo/live/release approval이 아님이
  명확하다.
- **실패 시:** DFA-001 이하를 시작하지 않는다.

### DFA-001 — Planned LikeC4 external export boundary

- **현재 상태:** `completed`; 두 planned-source SHA, 네 standard command PASS, semantic
  leakage guard PASS와 independent QA PASS가 additive ECR evidence에 기록됐다.
- **Entry gate:** DFA-000 ECR 완료, diff가 exact tracked allowlist 안이고 Dayflow/production
  write나 live capability가 없다.
- **실행:** Planned files를 검토하고 root에서
  `npm run arch:model:format:check`, `npm run arch:sources:check`,
  `npm run arch:model:check`, `npm run arch:model:build`를 실행한다. Exact command,
  timestamps, exit status, package-lock/relevant tool versions와 readable output/artifact를
  기록한다. Independent QA가 planned-only change와 unchanged model/dynamics를 확인한다.
- **Exit gate:** 네 command가 current source에서 통과하고 QA가 accepted이며 generated
  output은 ignored architecture artifact path에만 있다.
- **실패 시:** DFA-002 behavior source를 시작하지 않는다.

### DFA-002 — Strict contracts와 synthetic fixtures

- **현재 상태:** `pending`.
- **Entry gate:** DFA-001 command evidence와 independent QA 완료; ECR scope와
  synthetic-only/no-live/no-network/no-provider prohibitions 유지.
- **실행:** Original 13 paths, Colin이 승인한 exact two config paths와 DFA-002A exact two
  adapter/test paths, 총 17-path allowlist 안에 strict source schemas, synthetic fixtures와
  tests를 구현한다. DFA-002A 완료 뒤 exact 12-candidate/10-command-defining input set을
  고정하고 four authoritative commands를 실행해
  fresh command receipt v0.1을 만든다. Bounded local Git acquisition으로 fixed base를
  resolve한 regenerated 12-candidate readable diff v0.3와 machine-evidence bundle v0.3를 결속하고,
  authenticated David human-review receipt v0.3가 exact bundle을 `confirmed`한 뒤에만
  immutable `ContractFreezeProposal` v0.4를 publish/readback한다. Human `H-DFA-CONTRACT`
  decision v0.4가 existing proposal을 결정하고, 승인된 proposal/decision을 그대로 결속한
  freeze v0.4를 publish/readback한다.
- **Exit gate:** Required checks가 모두 pass하고 source-hash proposal, human approval,
  matching immutable freeze가 resolve된다. 그 전에는 strict source contract가 normative가
  아니며 conformance/quality/baseline/live/release claim은 0개다.
- **실패 시:** Exporter/importer에 계약을 추정 구현하지 않는다.

### DFA-002A — Local governance adapters (nested work package)

- **현재 상태:** `in_progress`; machine task는 계속 `DFA-002/pending`이다.
- **Entry gate:** Colin의 additive DFA-002A scope/sequencing decision과 exact two-path
  allowlist가 존재하고, no-Dayflow/no-human-signing/no-live/no-production exclusions가 유지됨.
- **실행:** `governanceAdapters.ts`와 `dayflowGovernanceAdapters.test.ts`에서만 bounded
  read-only local Git acquisition, hardened `.local` governance reads, proposal
  history/currentness/CAS, proposal-only hard-link atomic no-clobber publisher와 adversarial
  tests를 구현한다.
- **Exit gate:** Exact two paths의 implementation/tests/checks가 기록되고, pre-expansion
  machine bundle은 stale/abandoned이며, David review 전 fresh 12-candidate/10-command-input
  chain이 재생성된다. 이 문서 결정 자체는 어떤 hash/result도 미리 주장하지 않는다.
- **실패 시:** Proposal을 publish하거나 David review로 진행하지 않고 DFA-002를 `pending`에
  유지한다.

### DFA-003 — Dayflow-owned capture policy와 atomic exporter

- **Entry gate:** `DFA-002` 완료, strict `H-CROSS-REPO`가 exact Dayflow repository ID/path, pinned HEAD, branch, sorted allowed write paths를 결속함.
- **실행:** 승인된 exact Swift file ownership 안에서 pre-capture denylist, per-frame attestation, stable snapshot, row/blob bundle, complete marker를 synthetic frame으로 구현·검증한다.
- **Exit gate:** Atomic publication, checksum, coverage, mixed-revision rejection, no live SQLite reader 계약이 evidence로 남는다.
- **추가 live gate:** Consent와 retention 승인 전에는 synthetic frame만 허용한다. 현재 Dayflow `main`과 untracked design document는 암묵적으로 수정하지 않는다.

### DFA-004 — Blabase private verifier/importer

- **Entry gate:** `DFA-002`, `DFA-003` 완료; hardened private importer root가 정의됨.
- **실행:** manifest/blob hash, size/bounds, complete marker, coverage, no-follow/path containment, typed unavailable를 검증한다.
- **Exit gate:** Hash/bounds/failure 및 adversarial path/symlink validation이 통과하고 live DB를 읽지 않는다.
- **실패 시:** 빈 evidence로 downgrade하지 않고 import 전체를 거부한다.

### DFA-005 — Local-only extraction, minimization, claim verification

- **Entry gate:** `DFA-002` 완료; extraction implementation에는 local-only policy와 non-model fixtures만 허용한다. 실제 model/provider를 쓰는 실행은 `DFA-006`의 evaluation-execution freeze 전까지 금지한다.
- **실행:** allowlisted extractor input, redaction, lineage, rejected/conflict claim, normalized coverage를 구현한다.
- **Exit gate:** Screen-only input hash, structured-data invariance, field lineage, bounds, typed failure가 검증된다. Raw cloud upload가 0개다.
- **실패 시:** normalized claim을 publish하지 않는다.

### DFA-006 — A0/A1/B E1 evaluator와 C runner

- **Entry gate:** `DFA-002`, `DFA-005` 완료; model/provider를 처음 사용하기 전에 immutable `dayflow-ablation-evaluation-execution-freeze-v0.1` revision이 trusted contract freeze와 exact study protocol을 참조하고 provider/model/prompt/template/config/generation/retry/concurrency/guardrail/verifier/replicate/randomization/review tuple을 동결했다. 기존 contract freeze를 수정해 이 값을 채우는 것은 금지한다.
- **실행:** 네 independent input projection, A0 byte anchor, A1/B matched execution, C screen-only runner, strict dataset DAG, fallback과 taint checks를 구현한다.
- **Exit gate:** Causal tuple equality, A0/A1 screen isolation, strict generation/closure/manifest/binding, same checkpoint/protocol/replicate/`matchedPairId`/request manifest, deterministic replay, A0 byte preservation, invalid-screen B=A1가 모두 검증된다.
- **실패 시:** paired metric을 만들지 않는다.

### DFA-007 — Private-store lifecycle와 deletion receipt

- **Entry gate:** `DFA-002` 완료; encryption/local same-user threat-model design과 retention class 초안 존재.
- **실행:** strict approval discriminated union, authoritative current/historical-as-of resolver, immutable create-no-overwrite pilot-attestation publication, private attestation store/read, per-class TTL anchored at `verifiedAt`, consent-revocation tombstone, in-flight fencing, atomic purge, crash staging reconciliation, backup/export/telemetry exclusion, 양 저장소 deletion receipt를 구현한다.
- **Exit gate:** Typed `H-THREAT-MODEL-DESIGN` record와 모든 approval variant의 required/forbidden/unknown/ref validation, historical-as-of/currentness/revocation, attestation create/read/purge/receipt coverage, lifecycle/deletion/late-publish, corruption/rollback fail-closed, backup/export/telemetry-exclusion tests가 통과한다. Design approval은 live capture 승인이 아니다.
- **실패 시:** live capture를 영구 차단한다.

### DFA-008 — Blinded local review와 aggregate

- **Entry gate:** `DFA-006`, `DFA-007` 완료; rubric, permutation, missing-output policy 동결.
- **실행:** A1/B independent blind review, A0 reference, C separate queue, PairPreferenceReview, final-binding-scoped aggregate, no-double-submit, deletion을 구현한다.
- **Exit gate:** Globally unique group마다 정확히 A1+B OutputReview와 Pair 하나, unique IDs, same reviewer/checkpoint/protocol/replicate, exact matchedPair/request-manifest/permutation, committed-before-pair, final binding equality, review deletion을 구현 test가 검증한다.
- **실패 시:** reviewer에게 paired arm을 노출하거나 aggregate하지 않는다.

### DFA-009 — Targeted synthetic contract-conformance regression

- **Entry gate:** `DFA-006` 완료.
- **실행:** 정상, valid-empty, failure, contamination, fallback, nondeterministic replicate synthetic cases를 실행한다.
- **Exit gate:** Exact versions, hashes, run/comparison IDs, artifact paths, limitations가 private run record에 존재한다.
- **실패 시:** Contract regression을 부분 성공으로 보고하거나 baseline/quality evidence로 승격하지 않는다.

### DFA-010 — Implemented LikeC4 model 갱신

- **Entry gate:** `DFA-003`~`DFA-008` 구현 경계가 확정됨.
- **실행:** 실제 구현된 external boundary, components, dynamic flow만 `model.c4`에 반영하고 계획만 있는 항목은 `planned.c4`에 남긴다.
- **Exit gate:** Implemented model이 code와 일치하고 model validation evidence가 존재한다.
- **실패 시:** 계획 구조를 live architecture로 표시하지 않는다.

### DFA-011 — Final automated verification

- **Entry gate:** `DFA-006`, `DFA-007`, `DFA-008`, `DFA-010` 완료.
- **실행:** 승인된 구현 세션에서 typecheck, lint, 모든 relevant implementation tests, required existing Golden baseline check, targeted synthetic contract regression, `arch:deps:check`, `arch:model:check`, `arch:check`를 수행한다. 두 evidence class를 별도 ID/hash/claim scope로 기록하며 synthetic 결과를 baseline으로 부르지 않는다. Dataset required/unknown fields, sorted/unique/hash refs, mixed protocol, reverse/cycle, manifest/binding resolution과 flattened manifest-run 대 binding exact bijection(omit/add/duplicate/cardinality 및 `checkpointId`/`checkpointSha256`/`runId`/`runSha256`/`armId`/`replicateIndex`/조건부 `matchedPairId` mismatch); matchedPair/request-manifest mismatch; comparison-group 2+1 cardinality/duplicate; 모든 approval variant의 required/forbidden/unknown 및 discriminator-specific typed refs; `H-E2` target/evidence/decision; `H-EXCEPTION` conditional fields/deadline/expiry/required-check 우회 금지, exception→receipt ref 금지, later receipt→existing exception typed ID/hash, optional audit-index-only forward linkage, mutual/reverse/cycle 거부; DFA-014 prerequisite tests를 포함한다.
- **Exit gate:** Typecheck, lint, required tests, required existing Golden baseline check, targeted synthetic contract regression, dependency check, model check, `arch:check`가 **모두 pass**한다. Missing implementation test는 failure다. Exception은 non-blocking warning이나 문서화된 limitation에만 허용하며 required check의 failure·누락을 승인으로 바꾸지 못한다.
- **실패 시:** `DFA-012`를 완료하지 않고 원인과 재실행 범위를 기록한다.

### DFA-012 — Engine Change Record 확정

- **Entry gate:** `DFA-009`, `DFA-011` 완료.
- **실행:** Draft record에 실제 run IDs, hashes, verification, architecture result, privacy/retention, accepted exception, limitation을 추가한다.
- **Exit gate:** Record가 재현 가능한 evidence를 참조하고 사람 review가 완료된다.
- **실패 시:** private pilot 승인을 요청하지 않는다.

### DFA-013 — 15-checkpoint local private pilot

- **Entry gate:** `DFA-004`, `DFA-005`, `DFA-007`, `DFA-008`, `DFA-012` 완료, pilot `liveCollectionFreezeId`와 `studyProtocolHash` 승인, phase/protocol/scope가 일치하는 current unrevoked `H-LIVE-CAPTURE` typed ref가 정확히 하나 존재, synthetic sentinel을 실제 consent revision·encryption deployment approval로 교체, 다음 별도 승인 모두 획득: Screen Recording/indicator, denylist, raw/derived retention, artifact별 governance, local-only/cloud policy, screenshot inspection, purge/backup exclusion.
- **실행:** 동의한 private user 범위에서 15개 non-overlapping instrumentation checkpoint를 로컬로 수집·review하고 pilot exclusion을 close해 strict final manifest/binding을 만든다. Exactly 15개 complete execution bundle과 historical authority/raw deadlines를 검증한 immutable pilot-verification attestation을 pre-purge publish/readback한 뒤 raw를 삭제한다.
- **Exit gate:** Pilot final binding과 exact pilot-verification attestation이 15개 included checkpoint/run bundle을 resolve하고 manual inspection, blind review, full raw purge, 두 저장소 typed deletion receipt가 완료된다. Confirmed privacy leak과 unresolved purge failure가 0개다.
- **실패 시:** 즉시 capture를 멈추고 `DFA-014`로 진행하지 않는다.

### DFA-014 — Pilot human go/no-go

- **Entry gate:** `DFA-013` pilot exclusion closure, final manifest/binding과 exact immutable pilot-verification attestation이 검증 완료이고 required pilot deletion receipts가 성공 상태다. Proposed directional `studyProtocolHash`가 freeze됐고 그 exact phase/protocol용 current `H-LIVE-CAPTURE` record/ref가 존재한다.
- **실행:** 사람 reviewer가 privacy, correctness, quality, burden, cost를 검토한다.
- **Exit gate:** `go`이면 strict `H-PILOT-GO`가 pilot final binding, exact pilot-verification attestation, successful deletion receipt refs, directional phase/protocol target, entry에서 검증한 directional `H-LIVE-CAPTURE` ref를 모두 결속한다. `no-go | revise-and-repeat-pilot`은 Engine Change Record와 immutable state generation만 갱신하고 `H-PILOT-GO` 생성을 금지한다.
- **실패 시:** 자동으로 go로 해석하지 않는다. `DFA-015`는 blocked 상태다.

### DFA-015 — Frozen 60-checkpoint directional study

- **Entry gate:** `DFA-014`의 strict `H-PILOT-GO`, directional-study live freeze, 그 approval이 참조한 것과 byte-identical한 current/unexpired/unrevoked `H-LIVE-CAPTURE`와 target `studyProtocolHash`, 나머지 model/review/retention 규칙이 동결됐다. Final directional dataset/binding은 아직 없어야 한다.
- **실행:** 최소 10 working days에 걸쳐 eligible non-overlapping checkpoint 정확히 60개를 동일 canonical workflow로 처리하고, checkpoint admission/exclusion 변화마다 immutable candidate dataset generation을 publish한다.
- **Exit gate:** Exclusion review를 close하고 closure hash를 기록한 뒤 final dataset manifest와 `dayflow-ablation-final-dataset-binding-v0.1`을 freeze한다. Binding이 flattened manifest run set과 exact bijection이고 checkpoint/hash/arm/replicate/조건부 `matchedPairId`까지 exact equal인지 검증한 뒤 그 binding으로만 paired B-vs-A1 report, arm별 Acceptable@1/@3, safety, blinding, cost, exclusions, deletion status, limitations를 생성한다. Release claim은 0개다.
- **실패 시:** Protocol/config drift가 있으면 새 `studyProtocolHash`로 새 study를 시작한다. Closure 후 변경은 새 closure/final binding/dataset version으로만 표현하며 서로 다른 binding metric을 직접 비교하지 않는다.

### DFA-016 — E2 candidate discovery 설계 여부 결정

- **Entry gate:** `DFA-015` report와 raw private review/audit가 사람에게 검토됨.
- **실행:** 증분 품질, safety, privacy, compute/retention cost를 바탕으로 E2 설계 여부를 판단한다.
- **Exit gate:** Strict `H-E2`가 reviewed directional `studyProtocolHash`, final binding ID/hash, target-binding aggregate를 포함한 typed quality evidence, `do-not-proceed | design-E2` 결정과 이유를 결속한다. `design-E2`이면 새 candidate policy, synthetic cases, identity binding, stale suppression, Engine Change Record가 필요함을 명시한다.
- **실패 시:** E1 결과를 E2 승인으로 간주하지 않는다.

## 12. Human approval checkpoints

| Gate | 승인 내용 | 차단하는 작업 |
| --- | --- | --- |
| Scope ECR approval | Exact tracked paths, synthetic-only safety boundary와 rollback을 기록한 Draft ECR | DFA-001과 provisional DFA-002만; contract/live/release를 승인하지 않음 |
| `H-DFA-CONTRACT` | Fresh exact source pin, machine evidence bundle v0.3, authenticated `david` human-review receipt v0.3를 결속한 existing `ContractFreezeProposal` v0.4; proposer/owner reviewer `colin`, independent reviewer와 future sole decision signer `david` | DFA-002 completion 및 DFA-003+ prerequisite; pending이며 live/cross-repo/release를 승인하지 않음 |
| `H-CROSS-REPO` | Pinned Dayflow branch/base와 exact file scope에 대한 cross-repository write | `DFA-003` |
| `H-THREAT-MODEL-DESIGN` | Encryption/local same-user threat-model design | `DFA-007` completion; live capture를 승인하지 않음 |
| `H-LIVE-CAPTURE` | Live-collection freeze, `studyProtocolHash`, consent, indicator/pause, denylist, artifact별 retention/deletion/backup/consent, local-only, inspection, encryption, purge | 모든 live frame 및 `DFA-013` |
| `H-PILOT-GO` | 15-checkpoint pilot 결과와 deletion receipt 기반 go/no-go | `DFA-015` |
| `H-E2` | Frozen 60-checkpoint 결과 기반 E2 설계 여부 | E2 기획·구현 |
| `H-EXCEPTION` | Explicitly non-blocking check 또는 별도 사전 승인한 longer retention만 허용하는 bounded exception | 해당 non-blocking 처리/retention; required check는 우회하지 못함 |

승인 record는 strict `dayflow-ablation-human-approval-v0.1` discriminated union이다.
H-DFA-CONTRACT 자체는 별도 `dayflow-dfa-contract-decision-v0.4`이다. Proposal v0.4에는
exactly one proposer와 별도 authenticated human-review-receipt v0.3 ref가 있고, 그 receipt의
reviewer는 literal `david`, proposal에 진입할 decision은 `confirmed`다. Contract decision의
exactly one approver도 literal `david`다. 2-of-2 vote는 없고 `colin`의 owner confirmation은
workflow note일 뿐 decision field가 아니다. Colin의 tracked-path scope approvals와 external
QA PASS는 이 human receipt/contract decision이 아니다. 현재 receipt, proposal,
confirmation, decision과 approval은 모두 pending이다.

```text
common base:
  approvalSchemaVersion: dayflow-ablation-human-approval-v0.1
  approvalRecordId
  lineageClass: control
  approvalType: H-CROSS-REPO | H-THREAT-MODEL-DESIGN | H-LIVE-CAPTURE | H-PILOT-GO | H-E2 | H-EXCEPTION
  approverPseudonym
  approvedAt
  scopeHash
  approvalRecordSha256

H-CROSS-REPO:
  decision: approved
  repositoryRef { repositoryId, canonicalPath, pinnedHeadSha256 }
  writeScope { branchName, allowedPaths[] sorted unique }

H-THREAT-MODEL-DESIGN:
  decision: approved
  threatModelRef { version, sha256 }
  encryptionPolicyRef { version, sha256 }
  retentionPolicyRefs[] sorted unique by (version, sha256)
  localSameUserBoundaryRef { version, sha256 }

H-LIVE-CAPTURE:
  decision: approved
  phase: private_pilot | directional_study
  studyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
  consentRevision
  captureScopeHash
  capturePolicyRef { version, sha256 }
  denylistPolicyRef { version, sha256 }
  retentionPolicyRef { policyId, sha256 }
  encryptionDeploymentRef { version, sha256 }
  artifactGovernancePolicyRefs[] sorted unique by (artifactClass, policyId): { artifactClass, policyId, policySha256 }
  localOnly: true
  cloudImageUpload: false
  validFrom
  validUntil
  revokedAt: optional

H-PILOT-GO:
  decision: approved
  pilotFinalBindingRef { schemaVersion: dayflow-ablation-final-dataset-binding-v0.1, finalDatasetBindingId, finalDatasetBindingSha256 }
  pilotVerificationAttestationRef { schemaVersion: dayflow-ablation-pilot-verification-attestation-v0.1, pilotVerificationAttestationId, pilotVerificationAttestationSha256 }
  pilotDeletionEvidenceRefs[] non-empty, sorted unique by (deletionReceiptId, deletionReceiptSha256):
    { schemaVersion: dayflow-ablation-deletion-receipt-v0.1, deletionReceiptId, deletionReceiptSha256 }
  directionalTarget { phase: directional_study, studyProtocolHash }
  liveCaptureApprovalRef { schemaVersion: dayflow-ablation-human-approval-v0.1, approvalRecordId, approvalRecordSha256 }
  validFrom
  validUntil
  revokedAt: optional

H-E2:
  decisionTarget: e2-candidate-discovery-design
  decision: design-E2 | do-not-proceed
  targetStudyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
  targetFinalBindingRef { schemaVersion: dayflow-ablation-final-dataset-binding-v0.1, finalDatasetBindingId, finalDatasetBindingSha256 }
  qualityEvidenceRefs[] non-empty, sorted unique by (artifactType, schemaVersion, artifactId, artifactSha256):
    { artifactType: aggregate | output-review | pair-preference-review, schemaVersion, artifactId, artifactSha256 }
  decisionReasonCode
  decisionNote: optional private text

H-EXCEPTION:
  decision: approved
  exceptionKind: non-blocking-check | longer-retention
  exceptionScope { phase: implementation | private_pilot | directional_study | post_study_audit, artifactTypes[] non-empty sorted unique }
  reasonCode
  ownerPseudonym
  expiresAt
  compensatingControls[] non-empty sorted unique
  affectedArtifactRefs[] non-empty, sorted unique by (artifactType, schemaVersion, artifactId, artifactSha256):
    { artifactType, schemaVersion, artifactId, artifactSha256 }
  requiredChecksPassInvariant: true
  when exceptionKind = non-blocking-check:
    checkRef { checkId, blockingClassification: non-blocking }
    originalDeadline, extendedDeadline: forbidden
  when exceptionKind = longer-retention:
    originalDeadline
    extendedDeadline
    checkRef: forbidden
```

`H-E2.qualityEvidenceRefs[]`의 허용 discriminator/schema pair는 `aggregate -> dayflow-ablation-aggregate-v0.1`, `output-review -> dayflow-ablation-output-review-v0.2`, `pair-preference-review -> dayflow-ablation-pair-preference-review-v0.2`뿐이다. `H-EXCEPTION.affectedArtifactRefs[]`는 5장의 immutable-artifact registry에 있는 artifact type/schema pair만 허용하며 임의 schema string을 거부한다.

Common base와 선택된 variant의 모든 field는 optional로 표시된 것 외에는 required다. 다른 variant field는 forbidden이고 unknown field는 거부한다. Array는 canonical sorted/unique여야 하고 모든 typed ref의 schema, ID, hash와 discriminator가 허용하는 schema를 resolve한다. 선택 variant가 선언한 phase, protocol, validity, decision, revocation field만 요구하며 이를 common-base blanket requirement로 적용하지 않는다. Scope approval은 Draft ECR에 기록되고 `H-DFA-CONTRACT`는 이 live-governance JCS union 밖의 human contract decision이다. Candidate parser는 어느 approval도 생성하지 못한다. `H-E2` quality evidence에는 target binding aggregate가 포함돼야 하고, 해당 field를 가진 evidence는 target protocol/final binding과 일치해야 한다. `H-EXCEPTION`은 미리 non-blocking으로 분류된 check 또는 `originalDeadline` 전에 별도로 승인한 longer retention에만 유효하며, latter는 `originalDeadline < extendedDeadline <= expiresAt`을 만족해야 한다. Exception에는 deletion-receipt ref를 넣지 않고 receipt 생성 뒤에도 수정하지 않는다. 이후 receipt가 immutable exception의 typed ID/hash를 참조한다. Future/inverse linkage가 필요하면 별도 derived forward-link audit index만 exception과 receipt에 대한 outgoing typed refs를 가질 수 있고 두 source artifact는 변경하지 않는다. 그 index는 생성 전에 독립적인 exact versioned schema/hash domain을 받아야 한다. Mutual hash ref, audit index로의 reverse ref, cycle은 거부한다. Required typecheck, lint, test, baseline, architecture check, privacy/safety gate, typed approval, deletion obligation의 실패·누락을 waive하거나 pass로 바꿀 수 없다. Freeze의 `approvalRefs[]` 원소는 `{ approvalType, approvalRecordId, approvalRecordSha256 }`만 허용하며 resolved record의 discriminator와 같아야 한다.

Approval은 구두 추정이나 task status만으로 대체하지 않는다. Private pilot은 phase-scoped `H-LIVE-CAPTURE`, directional study는 current `H-LIVE-CAPTURE`와 `H-PILOT-GO`를 모두 요구한다. 모든 record/ref는 common-base의 type, unique ID, record hash, scope hash, approver를 가지며 phase, `studyProtocolHash`, UTC validity, revocation은 선택된 variant가 선언할 때만 요구한다. Singular/untyped ref는 거부한다.

## 13. Fail-closed 규칙

| 조건 | 즉시 동작 |
| --- | --- |
| Source pin, schema, implementation/live freeze ID, `studyProtocolHash`, prompt/config hash 누락·불일치 | Session 중단, 새 freeze 전 재시도 금지 |
| Stable snapshot/complete marker 없음 | Export 거부; incomplete staging으로 격리 후 TTL purge |
| Blob size/hash, bounds, order, duplicate, privacy attestation 오류 | 해당 export 전체를 typed failure로 거부 |
| Coverage partition/count 불일치 또는 `missing/read-failed/unavailable` | Normalized claim 0개; screen unavailable |
| `valid-empty` | inactivity claim 금지; `B`는 screen-derived change 없음, `C`는 no suggestion |
| Consent/policy revision 변경 또는 mixed revision | 현재 bundle 즉시 close; 새 승인 revision 전 capture 금지 |
| Unknown privacy state 또는 denylist ambiguity | Frame/export 거부; 기본 허용 금지 |
| Import path root 이탈, symlink, pre-existing destination, no-clobber 실패 | Import/publish 중단, 보안 issue 기록 |
| Structured field가 extractor/C input에 발견됨 | Contamination failure; checkpoint ineligible |
| A0/A1 input에 export/normalized hash, blob ref, screen label 또는 dereference capability 발견 | Contamination failure; checkpoint/study 중단 |
| Checkpoint의 prior candidate ref가 미완료, forward, self 또는 cyclic ancestry | Checkpoint 거부; 새 acyclic ref 전 재시도 금지 |
| Candidate generation이 미완료 checkpoint를 포함하거나 self/forward/cycle 생성 | Generation 거부; 기존 checkpoint/run은 수정하지 않음 |
| Candidate/closure/manifest/binding에 unsorted·duplicate·unknown field, mixed protocol, reverse edge, unresolved/hash-mismatched ref | 해당 DAG artifact와 모든 후행 publish 거부 |
| A1/B tuple, replicate, randomization, retry 불일치 | Pair 무효; causal metric에서 제외하고 study integrity issue로 승격 |
| Invalid screen에서 `B != A1` | Evaluator failure; pilot/study 중단 |
| Comparison group 중복 또는 cardinality가 A1 Output 1 + B Output 1 + Pair 1이 아님 | Review/aggregate 중단; group 수정 대신 새 group 필요 |
| Review ID/eval ID 중복 또는 reviewer/checkpoint/protocol/replicate/matchedPair/request-manifest/run/permutation/commit-order 불일치 | Review/aggregate 중단; unblind 금지 |
| Approval union의 required/forbidden/unknown field 오류 또는 typed ref가 missing/duplicate/expired/revoked/wrong type·phase·protocol·scope/hash | 해당 gate와 live capture/resume 금지 |
| `H-PILOT-GO`가 pilot binding, verification attestation, successful deletion evidence, directional target, exact live approval 중 하나라도 잘못 결속 | DFA-014 go 및 DFA-015 시작 금지 |
| Exclusion이 open이거나 final binding이 없거나 manifest run 대 binding bijection/cardinality/필드 일치 실패 | Direct comparison aggregate publish 금지 |
| `H-E2` target protocol/final binding/evidence/decision 결속 오류 또는 `H-EXCEPTION` 종류·conditional field·typed ref·expiry 오류 | 해당 E2 결정/exception 효력 거부 |
| `H-EXCEPTION`이 required check 실패·누락 또는 privacy/safety/deletion gate 우회를 시도 | Exception 거부; 원래 blocking failure 유지 |
| `H-EXCEPTION`에 receipt ref가 있거나 retained receipt의 typed exception ref가 없거나 mutual/reverse/cyclic hash ref가 형성됨 | Exception/receipt/audit index 결속 거부; immutable source artifact 수정 금지 |
| Deletion receipt `pending/failed`, TTL breach, backup exclusion 미확인 | 새 capture와 resume 차단 |
| 어떤 arm이 action, external mutation, target open, production publish 수행 | Emergency stop, 전체 session 무효, 영향 조사와 사람 review |
| Raw content/credential/private URL이 log·Git·telemetry에 발견됨 | 노출 경로 차단, purge/incident review, human approval 전 재개 금지 |

Error를 empty success, no activity, tie, missing rank, 낮은 confidence로 바꿔 계속하지 않는다. Exception은 사전에 scope가 제한되고 아직 만료되지 않은 strict `H-EXCEPTION`이 명시적으로 허용한 non-blocking check 또는 longer retention에만 적용한다.

## 14. 중단, 재개, rollback

### 안전한 중단

1. 새 capture와 provider request 발행을 fence한다.
2. 진행 중 atomic publish를 complete 또는 explicitly incomplete 상태로 끝낸다.
3. In-flight run/result가 current pointer를 바꾸지 못하게 한다.
4. `CURRENT_STATE.executionStatus`를 `blocked`로 갱신하고 `blockers[]`에 `blockerCode: OPERATOR_PAUSE`를 기록하며 마지막 completed artifact typed ref를 남긴다.
5. Staging TTL과 raw deletion deadline을 기다리지 말고 가능한 범위에서 즉시 reconcile한다.

### 재개 gate

- Source pin, implementation/live freeze ID, `studyProtocolHash`, consent revision, retention deadline이 여전히 유효하다.
- `pending/failed` deletion receipt와 orphan staging이 없다.
- 마지막 task의 exit evidence와 다음 task entry gate가 일치한다.
- 새 `sessionId`를 만들며 incomplete `runId`를 재사용하지 않는다.
- Frozen study 중 protocol/config drift가 없고 request-order manifest의 다음 position과 latest candidate dataset generation이 명확하다.
- Drift가 있으면 기존 study를 resume하지 않고 새 `studyProtocolHash`와 live freeze로 시작한다. Final dataset version은 exclusion close 뒤에만 만든다.

### Rollback

1. Blabase experiment-only runner를 disable한다.
2. Reviewed private-store command를 통해 Blabase raw copy, normalized evidence, checkpoints, outputs, reviews, blind mappings, aggregates, incomplete/complete export, staging을 purge한다.
3. Dayflow experimental exporter를 별도로 disable하고 필요한 경우 Screen Recording permission을 revoke한다.
4. Dayflow-side reviewed command로 pilot auxiliary attestation과 **pilot-created** canonical frame만 TTL에 따라 purge한다.
5. Pre-existing 또는 실험과 무관한 Dayflow canonical data로 purge 범위를 넓히지 않는다.
6. Blabase copy와 Dayflow canonical status를 분리한 deletion receipt를 publish한다.
7. `pending/failed`가 0개가 될 때까지 rollback을 완료로 표시하지 않는다.

DFA-002A rollback은 정확히
`suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts`와
`suggestion/tests/dayflowGovernanceAdapters.test.ts`만 제거하고 preceding 15-path scope를
복원하며, 그 두 path를 포함해 조립된 private 12/10 evidence를 abandon/purge한다. Immutable
artifact, local Git object, Dayflow, production state, human governance record는 mutate하지 않는다.

Rollback 뒤에도 production Attention, Continuation, Work Board, Launcher, action, monitoring contract와 저장 상태는 바뀌지 않아야 한다.

## 15. Immutable state generation과 `CURRENT_STATE` pointer

중단·handoff·재개 상태는 두 artifact로 나눈다.

- `suggestion/.local/evaluations/dayflow-ablation/state/generations/<stateGenerationId>.json`: immutable, no-clobber canonical-JSON state generation.
- `suggestion/.local/evaluations/dayflow-ablation/state/CURRENT_STATE.json`: latest generation의 ID/hash만 가진 symlink-safe, atomically replaceable canonical-JSON pointer.

먼저 generation을 publish하고 readback SHA-256을 확인한 뒤 pointer를 atomic replace한다. Pointer가 가리키는 ID/hash가 없거나 불일치하면 resume하지 않는다. Public 문서에는 raw content나 private path를 복사하지 않는다.

### Strict state generation v0.2

다음은 state-generation candidate acceptance sketch다. Exact source schema가 source-hash proposal과 `H-DFA-CONTRACT`/matching freeze에 결속된 뒤에만 normative가 되며 JSON 예시는 그 source schema를 대체하지 않는다.

```text
stateSchemaVersion: dayflow-ablation-state-generation-v0.2
stateGenerationId
lineageClass: control
previousStateGenerationRef: optional {
  schemaVersion: dayflow-ablation-state-generation-v0.2, stateGenerationId, stateGenerationSha256
}
updatedAt
updatedByAgent
planningStatus: draft_planning_only | approved_for_implementation
currentTask: DFA-000 | DFA-001 | DFA-002 | DFA-003 | DFA-004 | DFA-005 | DFA-006 | DFA-007 | DFA-008 | DFA-009 | DFA-010 | DFA-011 | DFA-012 | DFA-013 | DFA-014 | DFA-015 | DFA-016
currentPhase: scope_authority | planned_architecture | contract_candidate | cross_repo_exporter | private_import | evidence_normalization | evaluation_execution | artifact_lifecycle | human_review | synthetic_contract_regression | implemented_architecture | automated_verification | engine_record | private_pilot | pilot_decision | directional_study | e2_decision
executionStatus: pending | implementation_validation_pending | not_started | in_review | blocked | in_progress | completed | failed
taskStatuses[] exactly 17, sorted by numeric task suffix: {
  taskId: <same closed DFA enum>, status: pending | implementation_validation_pending | not_started | in_review | blocked | in_progress | completed | failed
}
nextAtomicAction { actionId, taskId, actionCode, descriptionCode }
sessionId: optional
activeStudyProtocolRef: required in DFA-000..002 { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
claimEligibility: required in DFA-000..002 { contractConformance, quality, baseline, release, hPilotGo, hE2 }
controlArtifactRefs[] sorted unique by (artifactType, artifactId):
  { artifactType, schemaVersion, artifactId, artifactSha256 }
evidenceArtifactRefs[] sorted unique by (dataOrigin, studyPhase, artifactType, artifactId):
  { artifactType, schemaVersion, artifactId, artifactSha256, dataOrigin, studyPhase, studyProtocolHash }
approvalRefs[] sorted unique by (approvalType, approvalRecordId):
  { schemaVersion: dayflow-ablation-human-approval-v0.1, approvalType, approvalRecordId, approvalRecordSha256 }
exitEvidenceRefs[] sorted unique by (taskId, artifactType, artifactId):
  { taskId, artifactType, schemaVersion, artifactId, artifactSha256, lineageClass: control | evidence,
    dataOrigin/studyPhase/studyProtocolHash: required iff lineageClass = evidence }
exceptionRefs[] sorted unique by approvalRecordId:
  { schemaVersion: dayflow-ablation-human-approval-v0.1, approvalType: H-EXCEPTION, approvalRecordId, approvalRecordSha256 }
blockers[] sorted unique by blockerId: {
  blockerId, taskId, blockerCode: MISSING_APPROVAL | MISSING_ARTIFACT | HASH_MISMATCH | FAILED_REQUIRED_CHECK | PRIVACY_HOLD | RETENTION_HOLD | DEPENDENCY_NOT_COMPLETE | OPERATOR_PAUSE,
  ownerPseudonym, openedAt, detailCode
}
safetyIssues[] sorted unique by safetyIssueId: {
  safetyIssueId, issueCode, severity: low | medium | high | critical, status: open | mitigated | closed,
  artifactRefs[] sorted unique typed refs
}
resumeChecks[] sorted unique by resumeCheckId: {
  resumeCheckId, checkCode: POINTER_MATCH | PREDECESSOR_MATCH | HASH_READBACK | APPROVAL_CURRENT | RETENTION_CURRENT | STAGING_RECONCILED | LINEAGE_COMPATIBLE,
  status: pending | passed | failed, artifactRefs[] sorted unique typed refs
}
governanceItems[] sorted unique by artifactClass: {
  artifactClass,
  consentPolicyRef { schemaVersion, policyId, policySha256 },
  retentionPolicyRef { schemaVersion, policyId, policySha256 },
  deletionPolicyRef { schemaVersion, policyId, policySha256 },
  backupPolicyRef { schemaVersion, policyId, policySha256 },
  nextDeadline: exact UTC timestamp | null
}
handoffNoteCode
stateGenerationSha256
```

`taskStatuses[]`에는 DFA-000..016이 정확히 한 번씩 있고 `currentTask` entry의 status가 `executionStatus`와 같으며 `in_progress`는 최대 하나다. `currentTask`와 `currentPhase`는 위 enum의 같은 ordinal pair여야 한다. 완료되지 않은 dependency를 건너뛰지 않는다. 모든 generic/governance typed ref는 declared schema/ID/hash를 resolve하며 bare policy ID를 거부한다. DFA-000..002에서는 `activeStudyProtocolRef`와 `claimEligibility`가 required이고 latter는 canonical synthetic protocol과 byte/JCS-equal이다. `nextDeadline`은 absent/sentinel이 아니라 exact UTC timestamp 또는 `null`이다. State의 evidence refs는 resume용 non-authoritative locator이며 evidence graph를 연결하거나 origin/phase 호환성을 부여하지 않는다. `dataOrigin`과 `studyPhase`는 state 최상위와 control ref에 forbidden이다.

`previousStateGenerationRef`는 바로 이전 generation만 가리키며 첫 generation에서만 absent다. ID-only, skip, forked-latest, self, forward, reverse-successor, cycle을 거부한다. State는 dataset/approval/freeze authority나 tuple 복제본이 아니며 resolved artifact가 authority다. 최초 scope-approved generation은 `planningStatus: draft_planning_only`, DFA-001/`planned_architecture`/`implementation_validation_pending`이었다. Recorded DFA-001 exit evidence 뒤 immediate successor는 DFA-002/`contract_candidate`/`pending`이며 DFA-000과 DFA-001은 `completed`, DFA-003..016은 `not_started` 또는 dependency-blocked다. Trusted contract freeze 전에는 DFA-002를 `completed`로 바꾸지 않는다.

### Replaceable pointer contract

Pointer의 유일한 strict payload는 `{ pointerSchemaVersion: dayflow-ablation-current-state-pointer-v0.1, stateGenerationId, stateGenerationSha256 }`이고 unknown field를 거부한다. File bytes는 정확히 `UTF8(JCS(pointer) + "\n")`다. State writer는 generation을 no-clobber publish하고 whole-file raw SHA를 read back한 뒤 같은 directory의 unique `0600` temp file에 pointer를 쓰고 file `fsync` → expected-old pointer ID/hash CAS 검증 → symlink-safe atomic replace → directory `fsync` → parse/JCS/raw-hash readback 순서로 수행한다. Formatting/CAS와 `/usr/bin/shasum`은 byte integrity와 concurrency만 증명한다. Required command evidence, external technical QA와 gate가 요구하는 authenticated human review는 별도 evidence이며 state hash에서 추론하거나 서로 대체할 수 없다. Expected-old가 바뀌었거나 pointer/generation ID/hash가 불일치하거나 crash-left temp가 reconcile되지 않으면 새 generation을 orphan audit 대상으로 남기고 pointer를 덮지 않으며 resume를 fail-closed한다.

## 16. 에이전트 작업 시작 체크리스트

- [ ] 내 task ID와 소유 file/module 범위가 명시돼 있다.
- [ ] 다른 에이전트가 같은 파일을 수정 중인지 확인했고 그 변경을 되돌리지 않는다.
- [ ] `CURRENT_STATE` pointer의 ID/hash와 immutable latest generation, current task/phase/status enum, blocker, next atomic action을 확인했다.
- [ ] 현재 task의 entry gate와 필요한 human approval reference가 모두 유효하다.
- [ ] Human-approved scope ECR와 trusted `contractFreezeId`/raw hash를 확인했다. Live phase라면 `liveCollectionFreezeId`와 `studyProtocolHash`도 확인했고, final dataset hash는 exclusion close 뒤에만 요구한다.
- [ ] Live data가 필요한지 확인했고, 필요하면 `H-LIVE-CAPTURE` 없이는 시작하지 않는다.
- [ ] Raw/private artifact 경로가 `suggestion/.local/evaluations/dayflow-ablation/` 아래로 제한됐다.
- [ ] Provider/model/prompt/config/replicate/randomization과 exact artifact hash-domain registry가 동결됐고 결과를 본 뒤 바꿀 수 없음을 확인했다.
- [ ] Cross-arm allowlist와 contamination checks를 이해했다.
- [ ] Fail-closed 조건, TTL, purge 책임, rollback 명령의 승인 경계를 확인했다.
- [ ] 새 `sessionId`와 content-free 작업 기록을 만들었다.
- [ ] 명시적 승인 없이 production dependency, external source, Dayflow repository, Git history를 변경하지 않는다.

## 17. 에이전트 작업 종료 체크리스트

- [ ] Exit gate를 전부 충족했거나, 충족하지 못한 항목을 blocker로 명시했다.
- [ ] 생성 artifact마다 immutable ID, relative `.local` path, SHA-256, schema/config version이 있다.
- [ ] No-clobber publish와 readback hash가 확인됐다.
- [ ] Arm taint, tuple equality, replicate/randomization, action/mutation zero 조건을 해당 task 범위에서 확인했다.
- [ ] Raw content, credential, private URL, absolute path가 log·report·Git에 들어가지 않았다.
- [ ] Staging, temporary OCR/model file, expired raw copy를 retention policy에 따라 reconcile했다.
- [ ] 필요한 deletion receipt가 `deleted/not-present` 또는 승인된 retention 상태이며 `pending/failed`를 숨기지 않았다.
- [ ] Human approval이 필요한 다음 task를 자동 시작하지 않았다.
- [ ] 새 immutable state generation을 publish/readback한 뒤 `CURRENT_STATE` ID/hash pointer를 atomic replace했고 next atomic action을 하나만 남겼다.
- [ ] 구현·검증 task라면 strict candidate/closure/manifest/binding DAG, matchedPair/request manifest, exact 2+1 comparison group, strict approval union과 DFA-014 prerequisites를 포함한 validation evidence/tests를 연결했다. Missing required test나 required check failure를 exception으로 처리하지 않았다.
- [ ] Handoff note에 변경 scope, checks, risks, remaining work, approval need를 content-free하게 기록했다.

이 Runbook을 작성하는 현재 문서 세션에서는 구현, 테스트 실행, Git 명령을 수행하지 않는다. 이후 각 DFA task의 validation은 그 task가 별도로 승인된 구현 세션에서만 수행한다.

## 18. Product decision과 technical decision

### 사람이 결정해야 하는 product/privacy 항목

- Screen capture를 허용할지와 capture indicator/pause 경험
- App/window/display denylist와 민감 category 기본 차단
- Human screenshot inspection 범위
- 각 retention 기본값과 예외
- 15-checkpoint pilot 뒤 60-checkpoint study 진행 여부
- Acceptable@1 증분이 privacy/compute/storage 비용을 정당화하는지
- E2 candidate discovery를 설계할지

### `DFA-002` source-hash proposal과 contract freeze에서 동결할 항목

- Export/normalization/checkpoint schema와 canonical hash domain
- Stable snapshot과 atomic complete-marker protocol
- Provider/model/prompt/template가 모두 literal `none`인 contract-only tuple과 deterministic fixture generator version/seed/config hash
- Replicate/request-order schema, randomization algorithm/seed derivation, missing-output policy처럼 future checkpoint ID를 요구하지 않는 algorithm/policy
- Arm input allowlist, cache key, contamination/invariance checks
- Study protocol schema, inclusion/exclusion 규칙, missing-output denominator, review rubric/permutation
- `.local` artifact layout과 retention/deletion/fencing implementation contract
- Pinned Dayflow read-only base/source hashes; exporter write file scope는 H-CROSS-REPO 전까지 forbidden/deferred

### `DFA-006` evaluation-execution freeze에서 동결할 항목

- Extractor, A1/B causal, C screen-only 각각의 exact provider/model/prompt/template/config/generation tuple
- Retry, concurrency, resolver, guardrail, verifier versions와 replicate 정책
- Randomization algorithm/seed/derivation과 request-order manifest schema/binding-time; concrete manifest는 checkpoint seal 뒤 첫 request 전에 별도 publish
- Review rubric, blind permutation, missing-output policy와 typed predecessor revision

### Live collection 전에 별도로 동결할 항목

- Phase별 canonical `studyProtocolHash`; 수집 전 final dataset hash는 만들지 않음
- Consent revision, capture policy, encryption/threat-model approval reference
- Artifact class별 retention/deletion/backup/consent policy ID
- Pilot 또는 directional-study의 checkpoint spacing, collection scope와 approval reference
- Exclusion close 뒤 final dataset version/hash와 그 뒤에만 허용되는 aggregate scope

## 19. 현재 상태 선언

현재 상태는 **Draft, planning only**다. Planned architecture validation과 independent QA,
pre-DFA-002A ten-file contract-only candidate validation 및 external QA는 완료됐다. Approved
two-file expansion implementation/validation은 아직 완료되지 않았다. DFA-002의 closed
machine status는 `pending`, DFA-002A work-package status는 `in_progress`이고 prose label은
"DFA-002A local governance implementation in progress; DFA-002 proposal reassembly pending"이다.
Fresh 12/10 proposal publish/readback/submission 뒤에만 DFA-002가 `in_review`가 된다.
Approved/frozen/executable/completed 상태가 아니다.
Baseline, capture, human contract decision, private pilot과 60-checkpoint study는 없다.

다음 작업은 오직 DFA-002A local governance implementation/validation, fresh 12/10 DFA-002
evidence reassembly와 그 뒤의 독립 `H-DFA-CONTRACT`다.

```text
DFA-000  completed
DFA-001  completed
DFA-002  pending  <- DFA-002A required; proposal reassembly pending
DFA-002A in_progress <- bounded local governance work package; not a machine-task enum value
DFA-003  not_started  <- external pin/export implementation deferred; resolution fails closed
DFA-004  not_started
DFA-005  not_started
DFA-006  not_started
DFA-007  not_started  <- trusted authority/attestation lifecycle deferred; resolution fails closed
DFA-008  not_started
DFA-009  not_started
DFA-010  not_started
DFA-011  not_started
DFA-012  not_started
DFA-013  blocked_by_human_approval
DFA-014  blocked_by_DFA-013
DFA-015  blocked_by_DFA-014
DFA-016  blocked_by_DFA-015
```

The single full-template Draft ECR records the accepted synthetic scope and the deliberate
governance simplification. Its additive scope amendment records only Colin's two approved config
paths; its DFA-001 section records passed standard commands, source hashes, semantic guard and
independent QA; its current DFA-002 correction addendum records the pre-DFA-002A exact 10-file
candidate, 36-row registry, 75/75 and compatibility/QA evidence. The existing current
ten-candidate machine bundle and its input chain are now stale/abandoned for proposal use and
must be replaced by a fresh 12/10 chain. No authenticated David receipt, proposal, decision or
freeze artifact exists.
Independent
`H-DFA-CONTRACT`/trusted freeze 전에는
DFA-002 completion 또는 DFA-003+로 진행하지 않는다.

Contract candidate는 raw human artifact를 생성·소비하지 않았다. 향후 raw artifact TTL은
최대 24시간이고 normalized metadata는 문서화된 policy를 따른다. Immutable pre-purge
attestation에는 raw blob이 없으며 purge 후 verification은 metadata, attestation과 deletion
receipt를 사용한다. 이 retention 설계도 live collection 권한이 아니다.

## 20. DFA-002 candidate acceptance sketch

이 절은 provisional DFA-002 구현을 검토하는 non-authoritative sketch다. Pre-code scope는
Plan/Runbook §0과 human-approved Draft ECR의 tracked-path/safety boundary다. 아래 exact
TypeScript schema/registry/fixture는 source-hash proposal, `H-DFA-CONTRACT`, matching
immutable freeze readback 뒤에만 normative가 된다.

### 20.1 `dataOrigin`, `studyPhase`, claim 경계

모든 immutable artifact는 exact lineage discriminator를 가진다. Source pin, layout config, DFA command receipt, readable diff, machine-evidence bundle, human-review receipt, 모든 freeze/proposal, study protocol, state generation, approval, typed ECR ref는 `lineageClass: control`이고 `dataOrigin`/`studyPhase`를 omit·forbid한다. Phase target은 `targetDataOrigin`/`targetStudyPhase`로만 표현한다. Export, normalized evidence, checkpoint/completion, arm input, semantic output, run, request-order manifest, request-issuance receipt, blind permutation, candidate generation, exclusion decision/closure, final manifest/binding, pilot-verification attestation, OutputReview, PairPreferenceReview, deletion receipt, aggregate는 `lineageClass: evidence`이고 hashed value 안에 `dataOrigin`/`studyPhase`가 required다. 허용 evidence 조합은 `synthetic + contract_conformance`, `live + private_pilot`, `live + directional_study`뿐이다.

Compatibility matrix는 closed다. Evidence→control과 control→control ref는 허용한다. Evidence→evidence는 exact origin/phase/protocol이 같아야 한다. Control→evidence는 H-PILOT-GO, H-E2, H-EXCEPTION variant가 명시한 typed evidence ref와 state-generation-v0.2의 non-authoritative operational locator 외에는 금지한다. Cross-phase semantic edge는 H-PILOT-GO의 live/private-pilot evidence에서 live/directional-study target field로 가는 선언된 edge 하나뿐이며 state locator도 evidence graph를 호환시키지 않는다. Synthetic evidence/ancestry는 live, H-PILOT-GO, H-E2, release input이 될 수 없다.

Canonical synthetic protocol payload는 다음과 같다.

```text
studyProtocolSchemaVersion: dayflow-ablation-study-protocol-v0.1
studyProtocolId
lineageClass: control
targetDataOrigin: synthetic
targetStudyPhase: contract_conformance
fixtureOnly: true
evidenceUse: contract_conformance_only
syntheticConsentPolicyId: synthetic-consent-<version>
syntheticRetentionPolicyId: synthetic-retention-<version>
fixtureGenerator { version, seed, configSha256, syntheticOnly: true }
armPolicy {
  enabledArms[] canonical enum-order subset of [A0, A1, B, C]
  replicateCountByArm { A0, A1, B, C }: each JSON unsigned integer 0..8
}
claimEligibility {
  contractConformance: true,
  quality: false,
  baseline: false,
  release: false,
  hPilotGo: false,
  hE2: false
}
createdAt
studyProtocolHash
```

Trusted `contractFrozen` 뒤 `studyProtocolHash`를 뺀 payload를 approved registered
domain으로 hash한다. `armPolicy` count는 arm disabled iff `0`, enabled iff `1..8`이며
A1/B는 함께 enable/disable되고 primary comparison에서 같은 positive count를 갖는다.
Before freeze에는 fixture-only라도 conformance를 포함한 모든 claim flag가 false다.
Freeze 뒤 approved synthetic protocol만 contract-conformance를 true로 만들 수 있고
quality, baseline, release, `H-PILOT-GO`, `H-E2`는 계속 false다.

Live protocol은 `targetDataOrigin: live`, `targetStudyPhase: private_pilot | directional_study`, phase-locked `targetCheckpointCount` (`private_pilot=15`, `directional_study=60`)인 다른 control variant다. `fixtureOnly: false`, `evidenceUse: evaluation`, 같은 required strict `armPolicy`, `consentRef { lineageClass: control, consentRevision, consentRecordSha256 }`, `retentionPolicyRef { lineageClass: control, policyId, policySha256 }`, phase별 `claimEligibility`, `createdAt`, `studyProtocolHash`만 허용하고 synthetic consent/retention/generator/count field는 금지한다. Primary comparison protocol은 A1/B를 같은 positive count로 enable한다. Private pilot eligibility는 `{ contractConformance: false, quality: true, baseline: false, release: false, hPilotGo: true, hE2: false }`, directional은 `hPilotGo: false, hE2: true`만 달라진다. Live evidence는 sentinel/synthetic ref를 거부하고 release는 모든 variant에서 false다.

### 20.2 Implementation safety와 reproducibility

DFA-000–002A tracked write는 Draft ECR와 additive scope decisions의 exact 17-path allowlist로
제한한다. Dayflow document/source
pins는 read-only이고 Dayflow write/build/run, live capture/data, production path,
network/provider/telemetry/cloud, secret/credential access는 허용하지 않는다. Private
generated output은 ignored `.local/` 또는 `artifacts/architecture/`에만 둔다.

DFA-001은 §0의 네 standard architecture commands와 independent QA를 사용한다. 현재 source
constant는 pre-DFA-002A candidate 10개를 가진다. DFA-002A는 정확히 두 path를 추가하고,
그 뒤 DFA-002는 exact 12 candidate files와 unchanged 10 command-defining inputs를
validation-input set으로 결속하고
`dfa002-depcruise` (dependency-cruiser 18.2.0), `dfa002-eslint` (9.39.5), `dfa002-tsc`
(TypeScript 5.9.3), `dfa002-vitest` (3.2.7) 네 source-authoritative command를 사용한다. 각
receipt는 exact input-set hash/cwd/tool-entry/argv, runtime version, empty environment-name set,
env-file false, network disabled, timestamps, zero exit와 sanitized stdout/stderr evidence를
남긴다. Full suggestion typecheck/lint와 root `arch:deps:check`는 ECR의 supplemental
compatibility evidence다. 다른 source revision의 result, missing/failed check, unexpected
tracked path 또는 unapproved capability는 fail-closed다.

이 절차는 source-level reproducibility를 제공하지만 hermetic host나 byte-identical
node_modules 증명을 주장하지 않는다. Typed command/diff/machine artifacts는 evidence
chain일 뿐 approval이나 execution authority가 아니다.

### 20.3 Strict source pin, layout, freeze

Source pin payload는 다음뿐이다.

```text
sourcePinSetSchemaVersion: dayflow-ablation-source-pin-set-v0.1
sourcePinSetId
lineageClass: control
pins[] sorted unique by (repositoryId, pinRole, pinKind, relativePath):
  repository-revision -> { repositoryId: blabase | dayflow, pinRole: immutable-input | authorized-output-baseline, pinKind, relativePath: ".", revision }; sha256 forbidden
  file-sha256 -> { repositoryId: blabase | dayflow, pinRole: immutable-input | authorized-output-baseline, pinKind, relativePath, sha256 }; revision forbidden
createdAt
sourcePinSetSha256
```

Absolute/escaping path, unknown field/kind/role, duplicate sort key, required pin 누락, start hash/revision mismatch를 거부한다. `file-sha256`은 raw bytes SHA-256이다. Plan/Runbook/Dayflow pin은 immutable input이다. ECR whole-file, `architecture/planned.c4`, `architecture/views.c4`는 authorized-output baseline이다. ECR은 DFA-000/DFA-002/DFA-012 append, 두 architecture file은 DFA-001에서만 바뀌며 views는 planned-view content만 허용한다. 각 window는 output ID/hash를 기록하고 그 밖의 drift는 차단한다. ECR은 UTF-8 no-BOM/LF-only다. `sectionId`는 begin marker부터 end marker와 LF까지 inclusive raw bytes를 고르고 `draftEcrRef.sha256`는 raw SHA-256, `byteSize`는 canonical-decimal exact length다. Missing/duplicate/nested marker, CRLF, BOM은 거부한다.

Artifact layout payload는 다음뿐이다.

```text
artifactLayoutConfigSchemaVersion: dayflow-ablation-artifact-layout-config-v0.1
artifactLayoutConfigId
lineageClass: control
root: suggestion/.local/evaluations/dayflow-ablation
pathTemplates[] sorted unique by artifactClass: { artifactClass, relativeTemplate }
temporaryRootTemplate
directoryMode: "0700"
fileMode: "0600"
immutablePublish: { noClobber: true, atomicRename: true, readbackHash: true, noFollow: true }
privateOnly: true
createdAt
artifactLayoutConfigSha256
```

`pathTemplates`는 registry의 `storageMode: standalone` class와 exact bijection이고 embedded class에는 template가 없다. Replaceable pointer/raw export blob만 explicit non-registry entry다. 각 template은 `root` 또는 resolved unique `temporaryRootTemplate` 아래에만 머물며 absolute path와 `..`를 금지한다. Missing/extra/duplicate standalone class를 거부한다. Hash는 `artifactLayoutConfigSha256`만 빼고 domain `blabase.dayflow-ablation.artifact-layout-config.v0.1`로 계산한다.

Pre-freeze canonical paths는 `pins/<sourcePinSetId>.json`,
`command-receipts/<commandReceiptId>.json`, `readable-diffs/<readableDiffId>.json`,
`machine-evidence-bundles/<machineEvidenceBundleId>.json`,
`human-review-receipts/<humanReviewReceiptId>.json`,
`contract-proposals/<contractFreezeProposalId>.json`과 operational `state`다. Draft는
`staging/<sessionId>/`에서만 최대 1시간 허용한다. `contract-decisions`와
`contract-freezes`는 각각 decision/approved-decision gate 뒤에만 쓸 수 있다. 모든 directory
`0700`, file `0600`, no-follow/no-clobber/same-root atomic rename/readback을 사용하며 persistent
unregistered evidence/diff/report subtree를 금지한다.

Candidate checks 뒤에는 four fresh command receipt v0.1과 full-content readable diff v0.3를
machine-evidence bundle v0.3로 결속한다. Trusted channel의 authenticated David
human-review receipt v0.3가 exact bundle을 `confirmed`한 뒤에만 strict raw-byte
`ContractFreezeProposal` v0.4를 publish한다. Independent `H-DFA-CONTRACT` decision v0.4는
unchanged proposal만 참조하고, trusted final freeze v0.4는
scope/proposal/approval raw refs를 모두 resolve한다. 변경은 새 append-only
proposal/approval/freeze chain으로만 표현한다. Draft ECR은 immutable이고
DFA-002는 별도 `H-DFA-CONTRACT` approval section, DFA-012는 별도 completion section만
append한다.

DFA-002 candidate generation tuple은 provider/model/prompt/template `none`, empty generation parameters, deterministic generator version/seed/config hash, `syntheticOnly: true`다. `none`은 placeholder가 아닌 literal enum이다. DFA-006에서 최초 model/provider call 전에 다음 새 artifact를 immutable publish한다.

```text
evaluationExecutionFreezeSchemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1
evaluationExecutionFreezeId
lineageClass: control
revision
predecessorRef: required when revision > "1", forbidden when revision = "1" {
  schemaVersion, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256
}
targetDataOrigin
targetStudyPhase
targetCheckpointCount
contractFreezeRef { schemaVersion: dayflow-dfa-contract-freeze-v0.4, contractFreezeId, contractFreezeSha256 }
studyProtocolRef { schemaVersion, studyProtocolHash }
extractorTuple { provider, model, promptVersion, promptSha256, templateVersion, configVersion, generationParameters }
a1bCausalTuple { provider, model, promptVersion, promptSha256, templateVersion, configVersion, generationParameters }
cScreenOnlyTuple { provider, model, promptVersion, promptSha256, templateVersion, configVersion, generationParameters }
retryPolicy
concurrencyPolicy
resolverVersion
guardrailVersion
verifierVersions
replicatePolicy {
  armPolicyRef { studyProtocolHash, jsonPointer: /armPolicy }
  enabledArms[] canonical enum-order subset
  replicateCountByArm { A0, A1, B, C }: JSON unsigned integers 0..8
}
randomization { algorithmVersion, seed, seedDerivationVersion, requestOrderManifestSchemaVersion, bindingTime: before-first-paired-request }
review { rubricVersion, permutationVersion, missingOutputPolicyVersion }
createdAt
evaluationExecutionFreezeSha256
```

Hash는 마지막 field만 빼고 domain `blabase.dayflow-ablation.evaluation-execution-freeze.v0.1`로 계산한다. 값 변경은 새 revision을 만들며 trusted contract freeze나 이전 revision을 수정하지 않는다.

`revision`은 canonical decimal string이고 모든 artifact의 `replicateIndex`는 string이 아닌 JSON unsigned integer `0..7`이다. `replicatePolicy.armPolicyRef`는 authoritative protocol을 resolve하고 copied enabled/count field는 `studyProtocolRef./armPolicy`와 byte/JCS-equal이다. Predecessor는 바로 전 revision 하나만 가리키며 same target-origin/target-phase/protocol ancestry의 self/forward/cycle을 거부한다. A1/B는 `a1bCausalTuple`을 byte-identical하게 사용하고 C는 별도 `cScreenOnlyTuple`만 사용한다. A0는 새 model call을 금지한다. Checkpoint가 아직 없으므로 이 freeze에 concrete request-order manifest ref를 넣지 않는다. 각 concrete manifest는 checkpoint seal 뒤 첫 paired request 전에 publish하고 run이 그 typed ref와 이 evaluation-freeze typed ref를 함께 가진다.

Live freeze도 strict `dayflow-ablation-live-collection-freeze-v0.1` control payload와 registered domain hash를 사용한다. 4.2의 `targetDataOrigin: live`, `targetStudyPhase`, typed implementation/evaluation/protocol refs, typed approval refs가 required이고 `dataOrigin`, `studyPhase`, ID-only freeze ref, synthetic/sentinel ref, singular `approvalRef`는 forbidden이다. `approved` variant는 `approvedAt` required, `closedAt/closureReasonCode` forbidden이다. Close/supersede는 in-place status 변경이 아니라 새 ID/hash와 typed immediate `supersedesLiveCollectionFreezeRef`를 가진 `closed` record로 표현한다. Closed variant는 `closedAt/closureReasonCode` required, `approvedAt` forbidden이고 이전 policy/protocol scope를 exact repeat한다. Predecessor는 single-parent/acyclic이며 latest resolved approved/unclosed record만 capture를 authorize한다.

### 20.4 DFA-002 strict wire appendix

모든 level의 unknown field를 거부한다. ID는 `^[a-z][a-z0-9._:-]{0,127}$`, version은 `^[a-z0-9][a-z0-9._-]{0,63}$`, SHA-256은 `^[0-9a-f]{64}$`, reason/issue code는 `^[A-Z][A-Z0-9_]{0,63}$`, timestamp는 `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`, canonical decimal string은 `^(0|[1-9][0-9]*)$`다. 일반 string은 Unicode scalar 256개, human reason은 1,024개, relative path는 512개가 최대이며 control/bidi 문자를 금지한다. Default array 최대 256, source ref 32, coverage interval 1,024, file/artifact 256이다. JSON artifact는 4 MiB, blob은 10 MiB, bundle은 512 MiB/256 blobs가 최대이며 더 작은 schema cardinality가 우선한다.

DFA-002 proposal evidence payload는 다음 closed chain이다.

```text
command receipt v0.1:
  scopeId: DFA-002; commandId; validationInputSetSha256
  exact invocation { cwd, node/runtimeVersion, tool package/version/entry, argv,
    environmentVariableNames: [], envFilesLoaded: false, networkAccess: disabled }
  startedAt <= completedAt; exitStatus: 0
  stdout/stderr { rawByteLength, rawSha256, sanitizedByteLength, sanitizedSha256,
    sanitizedText, redactionApplied, redactionPolicyVersion }

readable diff v0.3:
  scopeId: DFA-002; baseRevision
  sorted add|modify|delete operations with full UTF-8 before/after content refs
  content ref { relativePath, mediaType, encoding: utf-8, byteLength, rawSha256, content }
  aggregate content <= 4194304 bytes; private-secret material forbidden

machine evidence v0.3:
  sourcePinSetRef; baseCodeProvenance
  validationInputSet { trackedBaseRevision, candidateFiles[12],
    commandDefiningFiles[10], unexpectedTrackedPaths: [], validationInputSetSha256 }
  deterministic generationTuple; exact toolVersions
  commandReceiptRefs[4]; readableDiffRef; limitations[]; assembledAt

human review receipt v0.3:
  reviewerPseudonym: david; decision: confirmed | changes-requested
  machineEvidenceBundleRef; reviewedAt
  hashed non-empty reviewReport; limitations[]

proposal v0.4:
  revision/predecessor; sourcePinSet/base provenance/draft ECR refs
  machineEvidenceBundleRef; independentHumanReviewReceiptRef
  merged limitations[]; proposerPseudonym: colin; createdAt; detached hash

decision v0.4:
  H-DFA-CONTRACT; approved | rejected; proposalRef; same humanReviewReceiptRef
  approverPseudonym: david; decidedAt; detached hash

freeze v0.4:
  exact proposal/approved decision refs and embedded values
  frozenRegistry[36]; registry hash; frozenAt; detached hash
```

Trusted base/candidate resolvers reconstruct the exact readable diff. Pre-DFA-002A evidence
recorded that, at fixed Blabase revision
`92b2ca94fc3e8347261ac6a85a627c8e6c915400`, the exact ten then-current candidate paths resolved
as absent and the v0.3 diff contained ten sorted `add` operations. That diff and its dependent
machine bundle are now stale/abandoned for proposal use. After DFA-002A implementation, the
resolver must evaluate the same fixed revision against all exact 12 candidate paths and generate
a fresh canonical diff. This scope decision claims no base resolver outcome, operation type/count,
bytes, hashes or tool result for either new path. Source pin creation precedes command starts;
commands and diff precede bundle assembly; bundle
precedes David review; review precedes proposal; proposal precedes decision; decision precedes
freeze. Missing/non-canonical/private-secret/mismatched resolver bytes, unauthenticated review,
stale head, existing destination 또는 chronology mismatch는 fail-closed다.

Export nested shape는 다음과 같이 고정한다.

```text
sourceFileHashes[] sorted unique by relativePath: { relativePath, sha256 }
captureConfig {
  captureIntervalMs, maxWindowDurationMs, maxArtifactsPerExport, maxBlobBytes: canonical decimal strings
  allowedMimeTypes[]: non-empty sorted unique enum values
}
databaseSnapshotIdentity:
  synthetic -> { snapshotKind: synthetic-fixture, fixtureSetId, fixtureGeneratorVersion, fixtureGeneratorSeed, fixtureGeneratorConfigSha256 }; database/WAL fields forbidden
  live -> { snapshotKind: dayflow-stable-snapshot, snapshotAlgorithmVersion, snapshotId, databaseSchemaFingerprint, mainDatabaseSha256, walState: none | included, walSha256: included일 때만 required, stableSnapshotMarkerSha256, createdAt }; fixture fields forbidden
artifact closed fields:
  mimeType: image/jpeg | image/png
  privacyState: synthetic_fixture | consented_live
  capturePolicyDecision: allow
  placeholderState: synthetic_fixture | verified_non_placeholder
  availability: available
  pseudonymousDisplayAttestation, pseudonymousWindowAttestation:
    { attestationSchemaVersion: dayflow-pseudonymous-capture-attestation-v0.1, pseudonymousSubjectId, policyVersion, policySha256, attestedAt }
```

`allowedMimeTypes[]`는 위 exact MIME enum의 non-empty subset이다. `captureIntervalMs`, `maxWindowDurationMs`, `maxArtifactsPerExport`, `maxBlobBytes`는 양의 canonical decimal이고 각각 window `<= "86400000"`, artifact count `<= "256"`, blob `<= "10485760"`이며 observed bundle total은 512 MiB 이하다. Artifact `sourceRowId`, `sequenceWithinSecond`, `byteSize`는 canonical decimal이다. `byteSize`는 referenced blob의 actual byte length와 반드시 exact equal이고 `<= maxBlobBytes`다. Coverage count는 모두 JSON unsigned integer `0..1000000`이고 interval/top-level 합이 exact equal이다. `idleSeconds`는 JSON unsigned integer `0..86400`이다. Replicate/attempt/rank/latency/token/cost counter는 JSON unsigned integer `0..9007199254740991`이다. `sourceRowId`는 leading zero 없는 `0|[1-9][0-9]*`이고 lexical이 아니라 arbitrary-precision numeric order로 비교한다. Synthetic은 `synthetic_fixture` privacy/placeholder와 synthetic attestation ID만, live는 `consented_live`, `verified_non_placeholder`, non-synthetic attestation만 허용한다. 그 밖의 enum 조합은 typed issue이며 rejected/missing/denied row는 accepted artifact variant가 아니라 issue와 coverage count다.

Export hash는 정확히 `SHA256(UTF8("blabase.dayflow-screen-evidence-export.v0.1\u0000") || JCS(manifestWithoutDetachedHash))`다. Persist된 coverage는 이미 canonical이어야 한다. Producer contract builder만 serialization 전에 source interval을 normalize할 수 있고 importer/verifier는 persisted input을 고치거나 재정렬하지 않는다. DFA-002 synthetic loader부터 duplicate-aware tokenizer/parser를 쓰며 last-key-wins `JSON.parse` 방식은 금지한다. DFA-004는 independent live raw-byte parser를 추가한다. 어느 nesting depth든 duplicate object key는 schema validation 전에 `DUPLICATE_JSON_KEY`로 거부한다.

Privacy issue record는 strict `{ issueCode, artifactRef: optional, fieldPath: optional, detectedAt }`다. Fatal enum은 `PRIVACY_STATE_UNKNOWN`, `CONSENT_REVISION_MISMATCH`, `CAPTURE_POLICY_MISMATCH`, `DENYLIST_BLOCKED`, `DISPLAY_ATTESTATION_MISSING`, `WINDOW_ATTESTATION_MISSING`, `PLACEHOLDER_AMBIGUOUS`, `SENSITIVE_CATEGORY`, `RAW_CONTENT_FORBIDDEN`, `CREDENTIAL_PATTERN`, `ABSOLUTE_PATH_FORBIDDEN`, `ORIGIN_PHASE_MISMATCH`, `LIVE_SENTINEL_FORBIDDEN`, `SYNTHETIC_ID_IN_LIVE`다. 모두 screen unavailable이며 empty evidence로 downgrade할 수 없다.

Request-order manifest exact payload는 다음과 같다.

```text
requestOrderManifestSchemaVersion: dayflow-ablation-request-order-manifest-v0.1
requestOrderManifestId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
algorithmVersion
seed
entries[] sorted by contiguous position starting "0":
  { position, checkpointId, checkpointSha256, matchedPairId, replicateIndex, armId: A1 | B, requestId }
createdAt
requestOrderManifestSha256
```

Strict issuance receipt payload는 다음과 같다.

```text
requestIssuanceReceiptSchemaVersion: dayflow-ablation-request-issuance-receipt-v0.1
requestIssuanceReceiptId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
requestId
position: canonical decimal string
issuanceSequence: canonical decimal string
armInputRef { schemaVersion: dayflow-ablation-arm-input-v0.4, armInputId, armInputHash }
issuedAt
previousReceiptSha256: optional; position "0"에서는 forbidden, 그 뒤에는 exact prior receipt hash
requestIssuanceReceiptSha256
```

Live-pilot-only verification attestation exact payload는 다음과 같다.

```text
pilotVerificationAttestationSchemaVersion: dayflow-ablation-pilot-verification-attestation-v0.1
pilotVerificationAttestationId
lineageClass: evidence
dataOrigin: live
studyPhase: private_pilot
studyProtocolHash
targetCheckpointCount: 15
sourceGenerationRef { schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1, candidateDatasetGenerationId, candidateDatasetGenerationSha256 }
exclusionClosureRef { schemaVersion: dayflow-ablation-exclusion-closure-v0.1, exclusionClosureId, exclusionClosureSha256 }
finalDatasetManifestRef { schemaVersion: dayflow-ablation-final-dataset-manifest-v0.1, datasetVersion, datasetSha256 }
finalDatasetBindingRef { schemaVersion: dayflow-ablation-final-dataset-binding-v0.1, finalDatasetBindingId, finalDatasetBindingSha256 }
verifierVersion
verificationStatus: verified
verificationIssueCodes: []
checkpoints[15] sorted unique by checkpointId:
  captureWindowId, windowStart, windowEnd, checkpointAsOf
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  checkpointCompletionRef { schemaVersion: dayflow-ablation-checkpoint-completion-v0.1, checkpointCompletionId, checkpointCompletionSha256 }
  exportManifestRef { schemaVersion: dayflow-screen-evidence-export-v0.1, exportId, detachedManifestSha256 }
  normalizedEvidenceRef { schemaVersion: dayflow-normalized-evidence-v0.1, evidenceId, dayflowNormalizedEvidenceHash }
  historicalLiveAuthorityRef { schemaVersion: dayflow-ablation-live-collection-freeze-v0.1, liveCollectionFreezeId, liveCollectionFreezeSha256 }
  retentionPolicy { policySchemaVersion: dayflow-ablation-live-retention-policy-v0.1, lineageClass: control, policyId, blabaseRawCopyMaxAgeMs, dayflowCanonicalSourceMaxAgeMs, policySha256 }
  executionBundleProofSha256
  rawPurgeObligations[] sorted unique by frameRef.artifactId:
    frameRef { artifactType: dayflow-export-frame, schemaVersion: dayflow-export-artifact-v0.1, artifactId, artifactSha256 }
    exportManifestRef { schemaVersion: dayflow-screen-evidence-export-v0.1, exportId, detachedManifestSha256 }
    capturedAt, exportedAt, blabaseRawCopyDeleteBy, dayflowCanonicalSourceDeleteBy
verifiedAt
pilotVerificationAttestationSha256
```

Attestation은 15개 execution bundle이 모두 resolve되고 `verifiedAt`이 어느 raw deadline보다
늦지 않은 pre-purge 시점에만 발행한다. Post-purge verification은 immutable DAG metadata,
attestation, historical-as-of authority, deletion receipts를 resolve하며 누락/mismatch는
fail-closed다. Source schema에는 `createdAt`, `expiresAt`, TTL, revocation, purge 또는 raw-blob
field가 없다. DFA-007은 이를 immutable/no-overwrite로 publish하고 raw blob 없는 private
metadata로 저장한다. Store retention clock은 `verifiedAt`이고 pilot/directional/release-decision
audit에 필요한 동안만, 최대 30일 보존한다. 30일 cap, applicable experiment deletion request
또는 consent revocation, authority/contract invalidation, rollback 중 가장 이른 trigger에
purge한다. Backup/export/telemetry는 금지한다. Authority/contract mismatch는 immutable
attestation을 수정하지 않고 사용 불가로 만들며 purge는 deletion receipt로 기록한다.
DFA-007은 historical-as-of authority resolution, currentness/revocation, immutable store/read/
purge, receipt coverage, corruption/rollback fail-closed test를 소유한다.

각 `(checkpoint, matchedPairId, replicateIndex)`에 A1과 B가 정확히 하나씩 있고 두 request 전에 manifest를 commit한다. Receipt는 manifest order의 complete chain이고 causal run은 exact receipt ref/sequence를 반복한다. Checkpoint v0.2는 run 전에 input-sealed되며 run/completion ref를 갖지 않는다. 위 7.6의 standalone checkpoint-completion v0.1은 `completionStatus`, `completedAt`, `presentRunRefs[]`, `missingExpectedRunKeys[]`, `failedRunKeys[]`, `noOutputRunKeys[]`를 가지며 resolved `completed` ref만 뒤 candidate generation에 들어간다. Collection-time checkpoint는 protocol과 optional prior generation만 참조하며 run, completion, 자신, future generation을 참조하지 않는다.

Exclusion decision은 위 4.3의 standalone artifact이고 closure는 typed decision ref만 가진다. Normalized evidence는 extraction/lineage만 소유하며 forward `runId`를 금지한다. Run은 execution/output만, review는 existing committed run의 평가만 소유하고 source를 변경하지 않는다. State generation은 operational resume metadata일 뿐 dataset/approval authority가 아니다. Deletion receipt는 삭제 상태만 attest하고 삭제한 raw payload를 넣지 않는다. Aggregate는 하나의 final binding과 committed review만 resolve하고 source를 repair/exclude/relabel할 수 없으며 machine-readable claim scope를 가진다.

Candidate-registry immutable JSON hash는
`UTF8(domain + "\u0000") || JCS(valueWithoutDetachedHash)`를 사용한다. Draft scope ECR과
source-hash proposal/freeze는 각 frozen source schema/record의 hash rule을 따른다. State generation과 `CURRENT_STATE.json`
pointer는 operational non-registry canonical JSON이며 YAML을 거부한다.
`stateGenerationSha256`은 exact whole-file raw SHA-256이고 byte integrity만 증명한다.
Required command results, external technical QA와 authenticated `david` human-review receipt는
별도 evidence이며 서로 대체할 수 없다.

### 20.5 DFA-002 acceptance matrix

DFA-002는 proposal이 명명한 exact source revision에서 검증한다. Fresh exact
12-candidate/10-command-input source pin, four fresh command receipts v0.1, readable diff v0.3와 machine evidence bundle v0.3가
먼저 resolve돼야 하고, 이후 authenticated `david` review가 human-review receipt v0.3로
resolve돼야 proposal v0.4를 조립할 수 있다. External technical QA는 별도로 기록하며
`david`의 authenticated confirmation을 대신하지 않는다. Missing, failed, stale 또는
cross-revision result는 fail이며 required failure를 exception으로 pass 처리할 수 없다.

필수 negative/parity coverage:

- invalid origin/phase 및 synthetic/live/sentinel 혼합, synthetic의 pilot/E2/release 유입;
- deterministic fixture, actual blob/conversation 0개, DFA-000–002 model/provider/network/
  telemetry call 0개;
- source-hash proposal → human H-DFA-CONTRACT → matching freeze equality, mutation/stale
  proposal, predecessor fork/cycle와 self-approval;
- ECR tracked-path 밖 write, Dayflow/production mutation, live input, private path escape,
  symlink/hardlink, credential/environment/network/provider violation;
- A0/A1/B/C arm isolation, A1/B matched pairing, C structured contamination, invalid-screen
  B=A1 invariance, one export per window;
- A1/B arm input, request-order-manifest entry, request-issuance receipt와 causal run의 exact
  `requestId`/`requestPosition`, contiguous issuance sequence/predecessor chain, missing/duplicate/
  reordered/cross-request rejection;
- live study protocol/evaluation-execution freeze/live-collection freeze의 phase-locked exact
  `targetCheckpointCount` (`private_pilot=15`, `directional_study=60`) 일치;
- checkpoint/run/completion, candidate generation, exclusion decision/closure, final
  manifest/binding DAG와 exact final-binding run bijection;
- exactly 15 complete private-pilot checkpoint bundle의 pre-purge attestation 발행,
  `H-PILOT-GO` exact attestation/deletion-receipt binding, metadata/immutable attestation/
  historical-as-of authority/receipt를 사용하는 raw-free post-purge verification;
- OutputReview/PairPreferenceReview ID/group/reviewer/checkpoint/permutation/commit ordering;
- strict schemas, unknown/duplicate key rejection, version/hash domains, JCS/export parity,
  all bounds/grammars and state pointer atomicity;
- consent, privacy issues, retention/deletion/backup, deletion receipts, purge/crash recovery;
- DFA-007 create-no-overwrite attestation publication, current/historical-as-of authority,
  currentness/revocation, private store/read/purge, `verifiedAt` 기준 30-day cap과 earlier trigger,
  receipt coverage, corruption/rollback fail-closed behavior(스키마 TTL field는 추가하지 않음);
- DFA-001 planned-only guard와 implemented model/dynamics에 Dayflow가 없음.

검증 대상은 frozen source schemas이며 provisional machine-governance artifact를 요구하지
않는다.
Missing implementation test는 acceptance 실패다.

## 21. Candidate control acceptance sketches

### 21.1 Source-hash contract candidate

DFA-002 `ContractFreezeProposal` v0.4는 proposal ID/revision/predecessor, base/code provenance,
source-pin, machine-evidence v0.3, independent-human-review v0.3 refs, merged limitations,
`proposerPseudonym`, timestamp와 detached hash를 가진 closed source schema다. Resolved machine
evidence는 exact 12 candidate/10 command-defining inputs, four command receipts v0.1,
full-content readable diff v0.3, tool versions와 deterministic fixture tuple을 결속한다. Live
data, model/provider output, quality/baseline/release claim은 금지한다.

`colin`은 pending `proposerPseudonym`과 owner reviewer이고 `david`는 human-review receipt
v0.3의 literal authenticated reviewer와 decision v0.4의 literal future approver다. Receipt가
proposal에 들어가려면 `confirmed`여야 한다. Decision schema는 two votes가 아니라 exactly
one `approverPseudonym: david`를 가진다. `colin`의 owner confirmation은 두 번째 schema
approval이 아니며 두-path scope approval도 H-DFA-CONTRACT가 아니다. External QA PASS는
technical evidence일 뿐 David의 authenticated receipt/decision을 대신하지 않는다.
Approval은 proposal을 생성·수정·수리하지 않는다. Freeze는 승인된 byte-identical
proposal과 decision을 참조한다. Candidate source, dependency, config, fixture, test 또는
result가 바뀌면 새 proposal과 새 human decision이 필요하다. 현재 proposal,
confirmation, decision 또는 approval은 없다.

### 21.2 Repository-native validation과 safety

DFA-001은 `npm run arch:model:format:check`, `npm run arch:sources:check`,
`npm run arch:model:check`, `npm run arch:model:build`를 사용한다. DFA-002 authoritative
receipts는 §20.2의 four exact `DFA002_REQUIRED_COMMANDS`만 사용한다. Full suggestion
typecheck/lint와 root `npm run arch:deps:check`는 supplemental compatibility checks다. 각
result는 source revision/input-set hash, exact command, relevant tool/runtime version, time,
exit status와 sanitized readable output evidence를 기록한다.

Tracked write는 ECR allowlist에만 허용하고 generated output은 ignored `.local/` 또는
`artifacts/architecture/`에 둔다. Dayflow write/build/run, live capture/data, production
integration, network/provider/telemetry/cloud와 credential access는 금지한다. Independent
QA가 diff와 command evidence를 검토한다. Hermetic node_modules/host proof는 주장하지
않는다.
<!-- dfa002a-final-closure-checkpoint:begin -->

## DFA-002A final closure checkpoint (2026-08-18)

### Machine status

| Work package | Status | Meaning |
| --- | --- | --- |
| `DFA-002A` | `completed` | Approved local governance adapters/publisher implemented and independently validated |
| `DFA-002` | `pending` | Fresh 12/10 machine chain, David review, proposal, decision and freeze do not exist |
| `DFA-003+` | gated | Existing H-DFA-CONTRACT and H-CROSS-REPO ordering remains unchanged |

The current closure is exactly 12 candidate files plus 10 command-defining files, with two
overlapping config paths and therefore 20 distinct paths. The next source pin must resolve all
23 ordered required pin shapes. It must use the final readback bytes of the Plan, Runbook and ECR;
no pre-edit documentation hash may be reused.

### Authoritative validation commands

Run from `suggestion/`. These are the four closed DFA-002 command identities and exact command
strings used for DFA-002A validation.

```text
dfa002-depcruise: node ../node_modules/dependency-cruiser/bin/dependency-cruise.mjs --config ../dependency-cruiser.suggestion.config.mjs src/dayflowEvidence/contracts.ts src/evaluation/dayflowAblation/contracts.ts src/evaluation/dayflowAblation/buildDataset.ts src/evaluation/dayflowAblation/governanceAdapters.ts tests/dayflowEvidenceContracts.test.ts tests/dayflowEvidenceExtraction.test.ts tests/dayflowAblationEvaluation.test.ts tests/dayflowGovernanceAdapters.test.ts
dfa002-eslint: node node_modules/eslint/bin/eslint.js src/dayflowEvidence/contracts.ts src/evaluation/dayflowAblation/contracts.ts src/evaluation/dayflowAblation/buildDataset.ts src/evaluation/dayflowAblation/governanceAdapters.ts tests/dayflowEvidenceContracts.test.ts tests/dayflowEvidenceExtraction.test.ts tests/dayflowAblationEvaluation.test.ts tests/dayflowGovernanceAdapters.test.ts vitest.dayflow-dfa002.config.ts
dfa002-tsc: node node_modules/typescript/bin/tsc --noEmit --project tsconfig.dayflow-dfa002.json
dfa002-vitest: node node_modules/vitest/vitest.mjs run --config vitest.dayflow-dfa002.config.ts tests/dayflowEvidenceContracts.test.ts tests/dayflowEvidenceExtraction.test.ts tests/dayflowAblationEvaluation.test.ts tests/dayflowGovernanceAdapters.test.ts
```

Recorded environment/tool facts: Node `22.23.2`, dependency-cruiser `18.2.0`, ESLint `9.39.5`,
TypeScript `5.9.3`, Vitest `3.2.7`. Results: dependency-cruiser 8 modules/14 dependencies/0
violations; ESLint PASS; scoped TypeScript PASS; Vitest 4 files/93 tests PASS. Full suggestion
typecheck and lint passed. Root `arch:deps:check` exited 0 with the existing warning counts 12/8/2.
Independent current-head QA was Green with no Medium-or-higher finding.

### Fail-closed operator rules

- Local Git reads set `GIT_NO_LAZY_FETCH=1`; network/fetch is forbidden. Only complete
  authoritative tree traversal may prove fixed-tree absence. Missing, corrupt or promised-but-
  unavailable objects fail closed.
- One prepublication attempt coherently recaptures the complete candidate/input set, machine
  evidence, history/CAS state, canonical stored source pin, every local pin and external fact.
  Any drift invalidates the attempt; mixing snapshots is forbidden.
- Proposal publication is proposal-only. Destination creation uses retained descriptors and
  descriptor-relative hard-link/unlink operations through the fixed `/usr/bin/python3 -I -S`
  helper after root-owner/non-writable validation, with a fixed environment and bounded runtime.
- Pre-link failure, destination `EEXIST`, proven success and ambiguous termination are distinct.
  `EEXIST` preserves existing bytes. Ambiguous termination or unprovable cleanup retains the
  staged inode and authenticated lock for manual reconciliation; automatic retry is forbidden.
- `/usr/bin/python3` is a required host capability and portability risk. Missing binary or failed
  ownership/mode validation is a hard stop, not a fallback to path-based publication.
- No human-review issuer, decision/freeze issuer, Dayflow reader, network/provider call, runtime
  route, CLI, live store or production integration is present.

### Next operator sequence

1. Read back the final tracked docs and do not change them after the new source pin is assembled.
2. Safely reconcile and purge the exact abandoned 10-candidate seven-artifact chain recorded in
   the ECR. Never mutate or relabel those immutable bytes.
3. Generate and read back a fresh 12-candidate/10-command-input source pin containing exactly 23
   ordered pins, then capture four fresh command receipts.
4. Generate and read back the exact 12-add readable diff v0.3 and machine bundle v0.3.
5. Obtain David's authenticated `confirmed` human-review receipt v0.3.
6. Only then may Colin publish/read back and submit proposal v0.4. David alone records the v0.4
   H-DFA-CONTRACT decision; only `approved` allows an immutable freeze.

No current source pin, command receipt, readable diff, machine bundle, human receipt, proposal,
decision or freeze exists. The old seven private artifacts remain untouched and purge-pending.
This governance-only implementation changes no evaluation dataset or production semantics, so a
Golden baseline is N/A.

<!-- dfa002a-final-closure-checkpoint:end -->
<!-- dfa002a-external-qa-hold-correction:begin -->

## DFA-002A external-QA HOLD correction (2026-08-18)

이 checkpoint가 앞선 DFA-002A closure checkpoint의 완료/Green 상태를 대체한다.

| Work package | Corrected status | Blocking condition |
| --- | --- | --- |
| `DFA-002A` | `in_progress` / `HOLD` | Latest external independent current-head QA has three unresolved findings |
| `DFA-002` | `pending` | DFA-002A remediation and the existing evidence/human gates remain incomplete |

Open findings:

1. Close the post-final-capture/pre-link and post-link whole-set TOCTOU boundary.
2. Resolve and verify `draftEcrRef` as part of prepublication rather than trusting the reference.
3. Remove the stat/unlink link-count ambiguity from cleanup and fail closed when the unlink result
   cannot be proven.

The previously recorded 93/93 targeted tests and other successful checks remain reproducibility
evidence only. They do not close the findings and do not authorize completion, fresh evidence
assembly, David review, publication, decision or freeze. Remediate all three findings, rerun the
relevant checks, and obtain a new independent current-head QA verdict before changing this HOLD.
The stale ten-candidate seven-artifact chain remains immutable, untouched and purge-pending.

<!-- dfa002a-external-qa-hold-correction:end -->
<!-- dfa002a-final-qa-pass-supersession:begin -->

## DFA-002A final external-QA PASS supersession (2026-08-18)

This checkpoint supersedes the preceding DFA-002A HOLD correction. The three HOLD findings are
closed and the latest independent current-head QA is PASS with zero Medium-or-higher findings.

| Work package | Final current status | Remaining gate |
| --- | --- | --- |
| `DFA-002A` | `completed` / `validated` | None inside the approved DFA-002A implementation scope |
| `DFA-002` | `pending` | Fresh evidence chain, David review, proposal, decision and freeze |

Closure evidence:

1. A global fatal UTF-8 strict ECR marker parser resolves and validates `draftEcrRef` during
   prepublication.
2. The descriptor helper is an explicitly bounded seam with hostile-path and failure coverage.
3. Commit/post-link whole-set recapture/fencing and unlink cleanup fixes close the previously
   reported TOCTOU and stat/unlink link-count ambiguity.
4. `dfa002-vitest` passes 4 files/103 tests. The other authoritative command results, full
   suggestion typecheck/lint and root `arch:deps:check` remain PASS; dependency-cruiser remains
   8 modules/14 dependencies and architecture warning counts remain 12/8/2.

Do not interpret this PASS as H-DFA-CONTRACT or permission to skip the recorded artifact order.
The stale ten-candidate seven-artifact chain remains untouched and purge-pending. No fresh
source pin, receipt, readable diff, machine bundle, human receipt, proposal, decision or freeze
exists. Resolve the final Plan/Runbook/ECR readback bytes only when constructing the next source
pin; do not reuse any earlier documentation hash.

<!-- dfa002a-final-qa-pass-supersession:end -->
<!-- current-runbook:DFA-COLIN-S3-2B-2026-08-19:begin -->

## Current runbook checkpoint: Colin-only S3.2b complete removal

This section is the operative DFA runbook authority as of 2026-08-19. When an earlier step in this
Runbook requires David-specific review artifacts, H-DFA-CONTRACT, proposal/decision/freeze
publication, source-pin-set, command receipts, readable diff, or machine-evidence bundle, this
section supersedes that requirement. Historical records remain readable but must not be executed.

### Completed migration

- Active authority is experiment-manifest v0.2, not a contract freeze.
- Source provenance is an embedded strict manifest value, not a standalone source-pin artifact.
- Study protocol, evaluation execution freeze, and live collection freeze are v0.3 only.
- Artifact layout is v0.2 and is an exact bijection over 30 registered standalone classes.
- Synthetic config/cases and their relevant hash domains are v0.2.
- Run-results v0.1 is the only new terminal-run aggregate.
- The eight retired governance/machine-evidence classes are invalid for new active artifacts.
- No old/new compatibility union or automatic migration is permitted.

### Operator procedure from this checkpoint

1. Treat the current focused-green source and v0.2 fixtures as the only S3.2b candidate.
2. Do not generate or request David artifacts, a proposal, a decision, or a contract freeze.
3. Do not regenerate source pins, command receipts, readable diffs, or machine bundles.
4. Keep the existing private seven-file stale chain byte-for-byte untouched until Colin separately
   approves a deletion task.
5. Treat the separately approved S5 broader compatibility validation as complete for the current
   bytes; any later source, fixture, config, or test change invalidates that result and requires a
   new validation task.
6. After validation, create only the four Colin-owned experiment records when the actual A/B/C
   experiment is ready: manifest, run results, comparison report, and Colin decision.

### Focused evidence

The current focused gate passed:

```text
Vitest: 3 files / 68 tests PASS
Scoped TypeScript: PASS
Scoped ESLint: PASS
```

One stale test expectation for `synthetic.dayflow.dfa002.config.v0.1` was corrected to v0.2 before
the final passing run. No full test suite, build, Git command, private artifact read/write, live
capture, provider request, or production action was part of this checkpoint.

The separately approved S5 compatibility gate then passed:

```text
Full Vitest: 162 files / 1412 tests PASS
Full TypeScript: PASS
Full ESLint: PASS
Next.js production build: PASS
Architecture dependency checks: PASS, 0 errors
Existing architecture warnings: repository 12 / suggestion 8 / scripts 2
```

The production build reported standard loading of `.env.local`. No environment value was
inspected or emitted by this work. Because that build was not hermetic, it is compatibility
evidence only and must not be used as a DFA experiment receipt or reproducibility claim.

### Stop conditions

Stop and obtain a new Colin decision before changing public or production behavior, adding a new
artifact class, restoring a retired compatibility path, altering privacy/retention semantics,
deleting the private seven-file chain, or starting live Dayflow collection. Mechanical fixes inside
an already approved validation command set do not require a new design decision.

<!-- current-runbook:DFA-COLIN-S3-2B-2026-08-19:end -->

<!-- current-runbook:DFA-COLIN-S6-SYNTHETIC-DRY-RUN-2026-08-19:begin -->

## Current runbook checkpoint: S6 synthetic dry-run tooling complete

This additive checkpoint is the operative procedure for Colin-only synthetic contract-conformance
packaging as of 2026-08-19. S6.1 through S6.4 are complete and focused-green. Earlier runbook text
remains historical and does not authorize David artifacts, real execution, live capture, or
publication from stale lineage.

### Construction and validation procedure

1. Call `buildDayflowAblationSyntheticExperimentManifest` with mode
   `synthetic-contract-conformance`, a safe new `runLabel`, exact current v0.2 config/cases bytes,
   the complete required source/provenance byte snapshot and stable provenance/tool facts, and an
   explicit manifest timestamp. Stage A derives every aggregate and detached identity and returns
   the schema-parsed experiment manifest v0.2 plus its exact typed ref.
2. Assemble full sealed current lineage artifacts against that manifest: study protocol v0.3,
   evaluation execution freeze v0.3, and terminal arm runs v0.4. Do not substitute bare refs,
   relabel placeholders, or claim unresolved runs as terminal evidence.
3. Call `buildDayflowAblationSyntheticRunResults` with the Stage A manifest/ref, every full sealed
   lineage artifact, and explicit completion time. Stage B parses and verifies detached hashes,
   origin, phase, chronology, terminality, canonical order, uniqueness, and the complete
   manifest/protocol/freeze/run linkage before returning run-results v0.1 and its typed ref.
4. Call `buildDayflowAblationSyntheticDryRunPackage` with the sealed values, exact config/cases
   identities, safe label, and explicit Colin decision input. The only outputs are
   `experiment-manifest.json`, `run-results.json`, `comparison-report.md`, and
   `colin-decision.md`.
5. Use `parseDayflowAblationSyntheticDryRunPackage` immediately before transport. It revalidates
   the exact four-file order, media types, metadata, JCS-plus-LF JSON, deterministic internal
   Markdown, synthetic and not-computed claims, decision/report raw-hash and byte-length binding,
   lineage, and package snapshot. Use
   `verifyDayflowAblationSyntheticDryRunDecisionBinding` when independently checking the report
   bytes bound by the decision.
6. For a separately authorized publication, pass the validated defensive copies to
   `publishPrivateEvaluationArtifactSetNoClobber` with an explicit data root and safe components
   for `.local/evaluations/dayflow-ablation/synthetic-dry-runs/<runLabel>`. Confirm exact readback
   with `verifyPrivateEvaluationArtifactSetReadback`.

The private store is generic transport and is not experiment provenance. It creates a unique
`0700` run directory, creates `0600` files without clobbering, fsyncs files and directories, and
verifies exact bytes, lengths, raw hashes, ownership, modes, link counts, and stable paths. It does
not list, overwrite, resume, repair, clean up, or inspect any unrelated private directory. A
partial write is deliberately preserved; its label is permanently unavailable and retry requires
a new label.

### Claims and stop conditions

The package is a synthetic dry-run only. JSON is deterministic JCS UTF-8 plus one LF; Markdown is
deterministic LF-only and remains internal/non-registry. `metricsStatus` is `not-computed`; no A/B/C
metric, command/model/provider execution, resolved real experiment, or real approval may be
inferred. The registry remains at 30 and no S6 schema, serialized version, dependency, public API,
or production behavior was added.

Validation evidence is limited to:

```text
S6.2a: Vitest 1 file / 47 tests PASS; scoped TypeScript PASS; ESLint PASS
S6.2b: Vitest 1 file / 51 tests PASS; scoped TypeScript PASS; ESLint PASS
S6.3: Vitest 2 files / 62 tests PASS; full TypeScript PASS; ESLint PASS
```

No real `.local` artifact, actual Colin decision, A/B/C metric, live capture, provider/network/env
read, Git operation, production change, dataset run, or baseline run occurred. The private seven
were neither read nor changed. Baseline is N/A for evaluation tooling, serialization, and storage
transport only.

Stop for a new Colin decision before real publication. That gate requires a new `runLabel`, an
explicit decision input, and full sealed lineage artifacts. Deletion of the private seven and live
Dayflow remain independent gates. On rollback, remove only S6 additions/tests through a successor
record; never rewrite historical records or mutate private immutable data.

<!-- current-runbook:DFA-COLIN-S6-SYNTHETIC-DRY-RUN-2026-08-19:end -->

<!-- current-runbook:DFA-COLIN-E1-DETERMINISTIC-ARM-RUNNER-2026-08-20:begin -->

## Current runbook checkpoint: E1 deterministic renderer and arm-run builder complete

This is the operative E1 runbook authority as of 2026-08-20. It supersedes stale runbook steps
that would invoke a provider, require David review/approval or a David-bound contract freeze,
treat run-results as unimplemented, or let E1 construct an execution freeze. Historical text is
retained but must not be executed. E1.1 policy, E1.2 implementation, and E1.3 validation and
recordkeeping are complete.

### Allowed local procedure

1. Supply a strictly sealed current A1, B, or C arm input. A0 remains a no-call control and is
   rejected by the E1 runner.
2. For A1/B, supply the matching full sealed issuance receipt. The runner verifies origin, phase,
   protocol, freeze, checkpoint/order/request/position/input lineage, receipt hash, and issuance
   chronology. C has no causal receipt fields.
3. Produce the semantic result with the pure A1/B or C renderer. Do not supply a caller-generated
   request hash or a boolean claiming evidence verification.
4. Call `buildDayflowE1ArmRun` with explicit start/completion timestamps. The builder verifies the
   renderer result, derives the domain-separated request hash, computes the raw response hash,
   emits exactly one zero-token/zero-cost deterministic attempt, seals arm-run v0.4, and reparses
   it. Exceptions are terminal to the call and are not converted to fabricated runs.
5. When composing a resolved test bundle, preserve A0, replace A1/B/C with the exact generated
   artifacts, rebuild `presentRunRefs`, reseal checkpoint-completion, and run the existing full
   resolved-execution verifier. A changed run with a stale completion ref must fail with
   `EXECUTION_COMPLETION_MISMATCH`.

The active identities are runner `dayflow-e1-deterministic-arm-runner-v0.1`, A1/B renderer
`dayflow-e1-ab-renderer-v0.1`, C renderer `dayflow-e1-c-renderer-v0.1`, screen eligibility
`dayflow-e1-screen-eligibility-v0.1`, guard `dayflow-e1-public-text-guard-v0.1`, presentation
`dayflow-e1-display-only-presentation-v0.1`, and request preimage
`dayflow-e1-deterministic-request-v0.1` under
`blabase.dayflow-e1.deterministic-request.v0.1`.

The existing contracts remain arm input/run v0.4, semantic output v0.1, issuance receipt v0.1,
and evaluation execution freeze v0.3. The closure remains 11 source entries / 22 provenance pins /
4 commands / 30 registry classes. No schema, registry, config, cases, dependency, public API, or
production version changed.

### Screen-context rules

B may modify only item 1 summary, caveats, and private claim IDs using exactly:

```text
{A1 summary} 화면 맥락: {normalized screen summary} (화면 표시는 완료·검증 근거가 아닙니다.)
```

There is exactly one space between the A1 summary and `화면 맥락`. Only a fully verified
`RECENT_FOCUS` or `VISIBLE_TASK_INTENT` claim at >= 8000 basis points is eligible. Invalid,
unavailable, rejected, failure, valid-empty, low-confidence, no-context, unsafe, and expired
(`asOf >= expiresAt`) input returns the exact A1 semantic object/bytes/hash with sorted typed
fallback diagnostics.

C requires every title and summary leaf to have eligible, non-conflicted verified claim lineage;
one unsafe or invalid item rejects the whole output. Valid-empty produces `no_suggestion`; invalid,
rejected, expired, unavailable, and failure inputs produce typed failure. Blind review strips
claim IDs. Never expose raw OCR/normalized values, IDs, refs, paths, URLs, hashes, credentials, or
Active actions, targets, first steps, interventions, capabilities, destinations, or source IDs.

### Evidence and stop conditions

```text
Scoped dependency-cruiser: PASS, 115 modules / 443 dependencies / 0 errors / 8 existing warnings
Scoped ESLint: PASS
Scoped TypeScript: PASS
Scoped Vitest: PASS, 3 files / 90 tests
Full TypeScript: PASS
Full lint: PASS
Architecture: PASS, 0 errors; existing warnings repository 12 / suggestion 8 / scripts 2
Full Vitest: 161/162 files, 1437/1438 tests; one 5-second continuation injected-clock timeout
Isolated continuationEvaluation: PASS, 1 file / 22 tests
```

The full Vitest result is not recorded as a pass; the timeout is outside E1 and scoped E1 is
green. The validated file identities are:

- `runGeneration.ts` — 33,122 bytes —
  `301e5134d18391d1c5485722ceac50a75c96f7c70d327f7cadda571bdcc12d08`;
- `contracts.ts` — 242,781 bytes —
  `77bd9b5bf33f5c25f69450630d4d20ca01bba95929781f8170331715c3c473cd`;
- `tsconfig.dayflow-dfa002.json` — 726 bytes —
  `09a27ed04b2530f0887e9978dc3a3edb379e85ae141e87a2f9619776e25821cb`;
- `dayflowAblationEvaluation.test.ts` — 230,514 bytes —
  `7b07b741f4cd35d5f871cdd485ba5e400e79b412deb1a75f99863f737b2706c0`.

Stop before any filesystem, environment, process, provider, network, clock, random, publication,
live, private-store, or production operation. No actual run, run-results artifact, metric, dataset,
baseline, Git operation, or private artifact was created or inspected by E1.

Colin's only next gate is whether to start `E2-IO`, limited to Dayflow exporter/importer
engineering. It is expressly not permission to begin the earlier Plan Stage E2 candidate
discovery or any real capture/execution/publication. Rollback removes only the E1 runner, tests,
and closure entries through a successor record and never rewrites historical/private data.

<!-- current-runbook:DFA-COLIN-E1-DETERMINISTIC-ARM-RUNNER-2026-08-20:end -->


---

## E2-IO.2A completed checkpoint (2026-08-20)

This is the current runbook checkpoint for E2-IO.2A. Earlier failed/HOLD
diagnostics remain historical and do not override the final PASS evidence.

### Authority and boundary

- Owner, reviewer, and decision authority: Colin.
- Required David gate or artifact: none.
- Authorized scope: synthetic, in-memory, transport-only bundle import.
- Completed: E2-IO.2A only.
- Not authorized: E2-IO.2B, E2-IO.2.3, E2-IO.2.4, live access, exporter or
  retention work, normalized evidence, E1 B/C, provider calls, production,
  publication, or release.

### Reproducible source identities

Raw SHA-256 and byte lengths follow. Git identity was not inspected.

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `src/evaluation/dayflowAblation/importEvidenceBundle.ts` | `fcd904c09364b61a35b8573edf5fc7980d7c01b52eecfca8a7664beb144dac1e` | 15404 |
| `src/evaluation/dayflowAblation/strictDuplicateAwareJson.ts` | `2f52948634b22d4eea0ba767ca7e39c9483449f0907a9e5c435d947a8a58532a` | 5355 |
| `tests/dayflowEvidenceBundleImport.test.ts` | `d69e1f652eb36ba2ecaa58a1d4db2a9b532096614a56ddee959a5dcf35bc72bd` | 27354 |
| `tsconfig.dayflow-e2io.json` | `a6dce1582de1b5abdad74e7d25f32d5e229138bfc8f14a00b79d2a3ddb56bc65` | 487 |
| `vitest.dayflow-e2io.config.ts` | `88d698f44b1502bcb8ccab546bbe7f60532b3ea95a5c305bdb053b96be2dbea4` | 291 |

### Focused commands and results

Run the first three from `suggestion/` and the final command from the Blabase
root.

```sh
node node_modules/typescript/bin/tsc -p tsconfig.dayflow-e2io.json --noEmit
node node_modules/eslint/bin/eslint.js src/evaluation/dayflowAblation/importEvidenceBundle.ts src/evaluation/dayflowAblation/strictDuplicateAwareJson.ts tests/dayflowEvidenceBundleImport.test.ts vitest.dayflow-e2io.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.dayflow-e2io.config.ts
npm run arch:deps:check
```

| Check | Version | Final result |
| --- | --- | --- |
| Focused TypeScript | 5.9.3 | PASS |
| ESLint, exact four TS targets | 9.39.5 | PASS |
| Focused Vitest config | 3.2.7 | PASS, 1 file and 10/10 tests |
| Architecture dependency check | dependency-cruiser 18.2.0 | PASS, 0 errors |

Architecture warnings were pre-existing: repository 12, suggestion 8, scripts
2. Coverage was 17 entries and 4 sentinel edges. Independent static QA was
read-only, reran no tests, and passed with no Critical/High/Medium finding.

### Superseded diagnostic history

The first author check found one TypeScript test predicate error and one
incorrect unsafe-path fixture expectation, producing a temporary HOLD. The
narrow correction removed the invalid `Function` predicate and made the
intended uppercase SHA path actually uppercase. Importer behavior did not
change. The final 10/10 PASS supersedes that state.

### Result contract, privacy, and residual risk

Success returns a frozen primitive descriptor containing only
`importSchemaVersion`, `manifestRawSha256`, `manifestDetachedSha256`,
`completionSha256`, `objectCount`, `totalObjectBytes`, and
`replayIdentitySha256`. Manifest data, paths, idle metadata, bytes, normalized
evidence, verification claims, and runtime capabilities are excluded. Entry
ordering is irrelevant to the exact set and replay identity. Limits are 256
objects, 10 MiB per object, and 256 MiB aggregate, enforced before copying.

Only synthetic in-memory bytes were used. No actual Dayflow/private data,
`.local` access, filesystem/network/environment/provider access, production or
publication route, raw retention, or manual inspection occurred.

Dataset/version/hash, run IDs, metrics, model/provider, tokens, latency, and
semantic baseline are not applicable. The targeted regression is the recorded
check; production baseline is N/A for transport-only tooling with no semantic
output or selection change.

Low residuals: SOI/EOI-only JPEG framing, chronology relying on canonical UTC,
and missing exact-limit success/deep-JSON performance cases. Rollback requires a
separately reviewed successor removing only the five E2 files above. No
migration or data cleanup is required.


---

<!-- current-runbook:E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:begin -->

## Current runbook gate: one Blabase suggestion engine for A/B/C

This gate supersedes conflicting E1 execution instructions while retaining them as historical
records. Do not execute, publish, compare, or freeze results from the prior B summary-overlay path,
the separate C renderer, or any path that consumes a Dayflow-produced semanticOutput as a final
suggestion.

The only permitted successor flow is:

Dayflow capture/store/OCR/preprocess
-> neutral preprocessed evidence
-> Blabase verifier and input adapter
-> one Blabase suggestion engine
-> one final suggestion output schema

Use the same engine entry point, model, prompt, configuration, ranking, guardrails, validation, and
post-processing for A, B, and C. Construct A from structured evidence, B from the exact A evidence
plus Dayflow evidence, and C from Dayflow evidence only. Keep arm identity outside the generation
request except for sealed evaluation lineage.

Stop the task if any proposed Dayflow envelope contains final title, final summary, caveats,
ranking, suggestion availability, output-field pointers, semanticOutput, RECENT_FOCUS, or
VISIBLE_TASK_INTENT. Stop also if B adds copy after engine generation, C uses a separate renderer,
or any model/prompt/config/guardrail identity differs by arm.

E2-IO.2A transport verification remains allowed and unchanged. No E2-IO.2B normalization,
generation, fixture migration, provider call, live capture, dataset execution, publication, or
cleanup is authorized by this section.

The next procedure is a separately approved E2-SCHEMA-1 contract-design task. It must create a new
evidence-only version, preserve old bytes and hashes, and stop for Colin's decision before
implementation or validation.

<!-- current-runbook:E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:end -->


---

<!-- current-runbook:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:begin -->

## E2-SCHEMA-2A completed checkpoint (2026-08-20)

### Authority and stop boundary

- Owner, human reviewer, and decision authority: Colin.
- Required David review, receipt, artifact, or approval: none.
- Completed scope: pure synthetic schema, sealer, serializer, parser, tests, and dedicated configs.
- Stop before E2-SCHEMA-2B bundle snapshot/re-verification, common-engine adaptation, run
  generation, live data, A/B/C execution, provider, publication, production, or release work.

Dayflow evidence remains neutral OCR/privacy/provenance input. Stop if any successor adds final
suggestion title or summary, `semanticOutput`, ranking, caveats, suggestion availability,
next-action labels, output pointers, arm-specific generated copy, or a separate engine path.

### Reproducible implementation identities

SHA-256 values are over the exact implementation bytes before this documentation-only append. Git
identity was not inspected.

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `src/dayflowEvidence/preprocessedEvidenceV0_1.ts` | `b7e375e56f1bdee1c7b6ce1a7565165e768f95029728b332a1ced501d71b1e98` | 35330 |
| `tests/dayflowPreprocessedEvidenceV0_1.test.ts` | `67bb0151f6d62f6e649db4094a1d564cc546169b6488bafd91c113f3c95a1b8e` | 21006 |
| `tsconfig.dayflow-e2schema.json` | `06da2615887e5d0fb843a6fac742fda5c8a0adffa17a38738efc964e1a5ddadc` | 423 |
| `vitest.dayflow-e2schema.config.ts` | `6b2e62ad985510ccbd18fb890acb1fdbdeff0902372c597ad4401a69e1d8f449` | 295 |

Frozen identities:

| Component | Value |
| --- | --- |
| schema | `dayflow-preprocessed-evidence-v0.1` |
| hash domain | `blabase.dayflow-preprocessed-evidence.v0.1` |
| verifier | `dayflow-preprocessed-evidence-verifier-v0.1` |
| transport import schema | `dayflow-screen-evidence-bundle-import-v0.1` |

### Recorded checks

| Check | Final result |
| --- | --- |
| Dedicated schema Vitest | PASS, 29/29 |
| Dedicated schema TypeScript | PASS |
| Targeted schema ESLint | PASS |
| E2 importer regression | PASS, 10/10 |
| DFA regression | PASS, 90/90 |
| Compatibility test total | PASS, 5 files and 129 tests |
| Full suggestion TypeScript | PASS |
| Full suggestion lint | PASS |
| Root architecture dependency check | PASS, 0 errors; existing warnings repository 12, suggestion 8, scripts 2 |
| Independent read-only QA | final F2a, F2b.1, and F2c.1 PASS; no Medium-or-higher finding |

The focused fixes close the shared 512-KiB boundary, iterative strict-JSON syntax/decoded-duplicate/
depth precedence, and intrinsic `Uint8Array` snapshot with unsafe-buffer `INPUT_INVALID`
precedence. Low residuals are bounded numeric-token suffix allocation and optional hostile
`byteOffset`/`constructor`, exact-subview, and grammar-parity tests.

Golden/baseline and evaluation run IDs are N/A because this isolated core is not connected to the
runtime engine and changes no engine input, output, filtering, ordering, or ranking. Validation used
synthetic data only; no real screenshots, OCR, `.local`, private artifacts, or live data were
created or inspected.

The next recommended checkpoint is `E2-SCHEMA-2B`, limited to the importer adapter, owned bundle
snapshot, and fresh bundle re-verification. It requires a separate Colin decision and does not
authorize the same-engine adapter or any A/B/C execution.

<!-- current-runbook:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:end -->


---

<!-- current-runbook:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:begin -->

## E2-SCHEMA-2B-1 completed checkpoint (2026-08-21)

### Scope and stop conditions

- Owner, human reviewer, and decision authority: Colin.
- Required David review, receipt, artifact, or approval: none.
- Completed: synthetic-only owned byte snapshot and E2-IO.2A descriptor re-verification.
- Stop before candidate semantic parsing, resolved evidence verification, engine adaptation,
  generation, live access, A/B/C execution, provider, publication, production, or release.

Snapshot version: `dayflow-preprocessed-evidence-verification-snapshot-v0.1`.

Public operations:

- `captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1`;
- `copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1`;
- `copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1`;
- `reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1`.

Public issue codes: `INPUT_INVALID`, `RESOURCE_LIMIT_EXCEEDED`, `BUNDLE_IMPORT_REJECTED`,
`IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH`, and `SNAPSHOT_HANDLE_INVALID`.

The snapshot handle is opaque and ephemeral. Caller bytes are copied to fixed owned buffers after
shape, path/control/count, typed-array safety, and resource-cap preflight. Accessors return fresh
copies. Re-verification creates another fresh bundle copy, calls the unchanged importer, and
compares all seven descriptor fields. Enumerable data properties are projected with bounded extra
detection; accessors and proxies fail. Symbol and non-enumerable extras are ignored and not retained.

### Exact implementation identities

SHA-256 values cover exact validated bytes before this documentation-only append. Git identity was
not inspected.

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `src/evaluation/dayflowAblation/preprocessedEvidenceVerificationSnapshotV0_1.ts` | `209e14d71c851dd58a15e7adb20477c9f27d299ee2ac00552bb7a4b83e52fda2` | 23899 |
| `tests/dayflowPreprocessedEvidenceBundleVerificationV0_1.test.ts` | `6e24714f4456d8cce96d62f557f4f091d6e9eb466561c037d8b15d44ad41139c` | 42116 |
| `tsconfig.dayflow-e2schema-resolved.json` | `40b38c1858e19e14d530cd30de6870e5ecd779e459193a66eb80046432b74104` | 663 |
| `vitest.dayflow-e2schema-resolved.config.ts` | `216a7878c3a9033dd92448eac261c139872632488ba7688c72d047cfebbf7168` | 326 |

### Exact recorded compatibility commands

Run the first six commands from `suggestion/` and the last command from the Blabase root:

```sh
./node_modules/.bin/vitest run --config vitest.dayflow-e2schema-resolved.config.ts
./node_modules/.bin/vitest run --config vitest.dayflow-e2schema.config.ts
./node_modules/.bin/vitest run --config vitest.dayflow-e2io.config.ts
./node_modules/.bin/vitest run --config vitest.dayflow-dfa002.config.ts
npm run typecheck
npm run lint
npm run arch:deps:check
```

The dedicated snapshot TypeScript check and targeted ESLint also passed; their exact argv is not
added here because it was not included in the recorded command list for this documentation task.

| Check | Final result |
| --- | --- |
| Snapshot focused Vitest | PASS, 21/21 |
| Snapshot dedicated TypeScript | PASS |
| Snapshot targeted ESLint | PASS |
| Compatibility Vitest | PASS, 6 files and 150 tests: 21 + 29 + 10 + 90 |
| Full suggestion typecheck | PASS |
| Full suggestion lint | PASS |
| Architecture dependencies | PASS, 0 errors, valid 17 entries/4 sentinel edges; existing warnings 12/8/2 |
| Final read-only QA3 | PASS, no High or Medium finding |

Golden/baseline is N/A because no runtime semantic path changed. LikeC4 is N/A because this
evaluation-only capability is unconnected; dependency closure was checked. Only fictional
synthetic data was used, with no real screenshot, OCR, private artifact, or live data created,
inspected, or persisted.

Residual Low test gaps are exact 259-entry and 257-object issue cases, exact 256-MiB success,
explicit cloned/proxied-handle cases, and runtime-dependent resizable/growable branches.
`E2-SCHEMA-2B-2` remains the next possible checkpoint and requires a separate Colin decision.

<!-- current-runbook:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:end -->


---

<!-- current-runbook:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:begin -->

## E2-SCHEMA-2B-2A completed checkpoint (2026-08-21)

### Scope and stop conditions

- Owner, human reviewer, and decision authority: Colin.
- Required David review, receipt, artifact, or approval: none.
- Completed: internal structural/full schema layering and staged raw-byte inspection.
- Stop before E2-SCHEMA-2B-2B capture-only ordering, manifest/artifact resolution, final resolved
  acceptance, common-engine adaptation, generation, live data, A/B/C execution, or production.

Internal entry point:
`inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification`. Do not expose it through
a barrel or product API. The existing public parser, sealer, serializer, issue codes, canonical
bytes, and detached-hash domain remain the compatibility contract.

The staged order is byte/JSON/caps/canonical, structural schema, root hash, then intrinsic and
resolved-owner collection. A rejected result has only `status` and one core issue code. An accepted
result has a deeply frozen structural candidate plus sorted unique arrays. Any unclassified
full-semantic invalidity returns `SCHEMA_INVALID`.

Seven intrinsic codes:

```text
CAPTURE_WINDOW_MISMATCH
CHRONOLOGY_INVALID
PREPROCESSING_PROVENANCE_INVALID
OCR_TEXT_INVALID
OCR_TEXT_HASH_MISMATCH
PRIVACY_METADATA_INVALID
RESOURCE_COUNT_MISMATCH
```

Future resolved-owner ledger:

```text
COVERAGE
SOURCE_ARTIFACT_BINDING
SOURCE_ARTIFACT_SET
```

Owner entries are not verifier issue codes and never establish acceptance. Only 2B-2B may resolve
them against the snapshot, transport descriptor, manifest, and complete artifact set.

### Exact implementation identities

SHA-256 values cover the validated implementation bytes before this documentation-only append.
No commit or other Git operation was performed.

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `src/dayflowEvidence/preprocessedEvidenceV0_1.ts` | `a9ffcd6743301af2070b8df83424c95b004cd484d3d3b561d1cef47a8d7c5683` | 47698 |
| `src/dayflowEvidence/contracts.ts` | `d03ce566686f3dd47498f7fe048af8f360049b61c89ffc3eb556f36ae605c0f7` | 74234 |
| `tests/dayflowPreprocessedEvidenceV0_1.test.ts` | `cb4388f21e4a276c3b240a95276038abe2dedb7770122cc53c8da2dfcd75cb2b` | 35416 |

### Recorded validation

| Check | Final result |
| --- | --- |
| Focused schema Vitest | PASS, 39/39 |
| Dedicated TypeScript | PASS |
| Scoped ESLint | PASS |
| Compatibility | PASS, 6 files/160 tests: snapshot 21 + schema 39 + importer 10 + DFA 90 |
| Full suggestion typecheck | PASS, 3.72 seconds |
| Full suggestion lint | PASS, 10.47 seconds |
| Root architecture dependencies | PASS, 6.47 seconds, 0 errors, valid 17 entries/4 sentinel edges; existing warnings repository 12/suggestion 8/scripts 2 |
| Independent read-only QA-R2 | PASS, no finding and no Medium-or-higher issue |

Development corrections closed the detached-root-hash collector preimage, duplicate public
refinement, silent full-schema invalidity, owner ledger/fallback, and fixture path/ordinal/
truthfulness findings. Do not report the corrected fixture diagnostic as a residual.

No Golden or baseline run occurred. LikeC4 is unchanged because no implemented system connection
changed. Synthetic tests stored no live screenshot, OCR, private data, artifact, or log; rejection
is redacted and retention is unchanged. Optional Low test follow-ups are owner-helper intrinsic
defaults, all-three-owner ordering, direct public Zod path/message ordering, and redaction-nine.

Rollback reverts the three code/test deltas above together through a successor record while leaving
E2-IO.2A and E2-SCHEMA-2B-1 intact. There is no private artifact cleanup.

<!-- current-runbook:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:end -->

## E2-SCHEMA-2B Stage 1-9 completed implementation checkpoint (2026-08-21)

### Authority and stop boundary

- Owner, human reviewer, and decision authority: Colin.
- Required David review, receipt, artifact, or approval: none.
- Completed: raw three-argument direct-module verification through Stage 9.
- Not completed: full Vitest unit-suite gate, Stage 10, engine generation, A/B/C execution, live/API/
  persistence, barrel/product exposure, provider, production, release, or freeze.

This section supersedes earlier active wording that leaves E2-SCHEMA-2B-2B unimplemented. It does
not rewrite the B1, B2-1, B2-2A, E2-IO.2A, or E2-SCHEMA-2A history.

### Required call order

The only final facade in this checkpoint is the direct module export:

`verifyDayflowPreprocessedEvidenceV0_1(candidateBytes, originalBundle,
expectedImportedBundleDescriptor)`

The required order is:

1. `captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1` projects and owns caller
   input without importing;
2. `inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification` runs the existing
   core gates;
3. `reverifyOwnedPreprocessedEvidenceVerificationSnapshotForResolutionV0_1` creates one fresh
   owned bundle and calls `importDayflowEvidenceBundleForResolutionV0_1` exactly once;
4. Stage 7 checks all candidate/imported/expected transport fields;
5. Stage 8 checks resolved manifest binding, synthetic origin, contract-conformance phase, and study
   protocol;
6. Stage 9 resolves capture window, coverage, source-artifact set/binding, and intrinsic codes;
7. the facade returns one frozen success or redacted failure.

There is one static detailed-import path. An exact importer call-count spy was not added and must not
be claimed.

### Public result contract

- Success: `{ valid: true, evidence, issueCodes: [] }`.
- Failure: `{ valid: false, issueCodes: [oneOrMoreCodes] }`.
- Success evidence is neutral and contains no original bundle, JPEG bytes, filesystem path, private
  snapshot state, or mutable caller reference.
- Failure contains no candidate, partial evidence, raw bytes, path, descriptor value, private state,
  or underlying exception.
- Internal `BUNDLE_IMPORT_REJECTED` maps to `TRANSPORT_REVERIFY_FAILED`.
- Internal descriptor mismatch and candidate transport mismatch map to
  `TRANSPORT_BINDING_MISMATCH`.
- Resolved manifest mismatch maps to `MANIFEST_BINDING_MISMATCH`.

The complete public issue list is the existing seven core codes plus:

`TRANSPORT_REVERIFY_FAILED`, `TRANSPORT_BINDING_MISMATCH`,
`MANIFEST_BINDING_MISMATCH`, `SOURCE_ARTIFACT_SET_MISMATCH`,
`SOURCE_ARTIFACT_BINDING_MISMATCH`, `ORIGIN_PHASE_MISMATCH`,
`STUDY_PROTOCOL_MISMATCH`, `CAPTURE_WINDOW_MISMATCH`,
`COVERAGE_MISMATCH`, `COVERAGE_CODE_MISMATCH`, `COVERAGE_FAILURE`,
`CHRONOLOGY_INVALID`, `PREPROCESSING_PROVENANCE_INVALID`, `OCR_TEXT_INVALID`,
`OCR_TEXT_HASH_MISMATCH`, `PRIVACY_METADATA_INVALID`, and
`RESOURCE_COUNT_MISMATCH`.

### Current scoped byte identities

These raw SHA-256 values and byte sizes identify the current scoped source, test, and dedicated
configuration bytes. No Git operation or commit identity was used.

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `src/evaluation/dayflowAblation/verifyPreprocessedEvidenceBundleV0_1.ts` | `18f501dc8968754b6394d956444ce26c8db1eccc1a5ac890aa50b20af603bb5b` | 19495 |
| `tests/verifyPreprocessedEvidenceBundleV0_1.test.ts` | `123241df821e3322c2e72f1c9fe88d878df11e65a002cfc62176643ecaa35880` | 39399 |
| `src/evaluation/dayflowAblation/importEvidenceBundle.ts` | `dfcd27b368fa715465666375eba461006291cbaa82f9a2a8ce7709e679a240c4` | 18158 |
| `tests/dayflowEvidenceBundleImport.test.ts` | `6cda94a2643b249cb4e5338f8bf103dd25b8834f39f200089f6f9fcf30d4321d` | 33035 |
| `src/evaluation/dayflowAblation/preprocessedEvidenceVerificationSnapshotV0_1.ts` | `f479f3991020bdc5b2cf8f88629d503c427b148f39408a3f434f20ba9b44eb36` | 25717 |
| `tests/dayflowPreprocessedEvidenceBundleVerificationV0_1.test.ts` | `5ae6cdd77289787f6f8224fbd66589ed480f926e0d40407129b9169ead21638e` | 44855 |
| `tsconfig.dayflow-e2schema-resolved.json` | `7be141dd6d827b87783ce3bf25f686990bcbf63598c2dbfd8be992f9e9765bc0` | 799 |
| `vitest.dayflow-e2schema-resolved.config.ts` | `e17f961b3bb4a8e62c94228b6e0c96290ee6b0b504cfae832743055db03e532d` | 386 |

### Recorded evidence and deferred gates

| Check | Final recorded result |
| --- | --- |
| Latest focused verifier closure | PASS, 2 files/42 tests |
| Integration closure | PASS, 4 files/93 tests: core 39 + importer 12 + snapshot/final 42 |
| Full suggestion typecheck | PASS |
| Full suggestion lint | PASS |
| Architecture dependencies | PASS, exit 0, no new Dayflow violation, valid 17 entries/4 sentinel edges; existing warnings repository 12/suggestion 8/scripts 2 |
| B2-2A current-head independent QA | PASS, no Medium-or-higher finding |
| B2-2B current-head independent QA | PASS, no Medium-or-higher finding |
| Full Vitest unit suite | DEFERRED by Colin's documentation choice; required before release/freeze |

B1 projection, B2-1 prerequisites, B2-2A resolution, and B2-2B facade are each implemented,
focused-validated, and independently QA-reviewed with PASS. Earlier focused 29/36 results are
superseded evidence and are not the current totals. No validation command was rerun during this
documentation checkpoint, and exact earlier argv is not fabricated here.

Golden/baseline is N/A at this checkpoint because no LLM prompt, model, ranking, suggestion output,
dataset, or runtime engine connection changed. LikeC4 is unchanged because no implemented system
boundary, container, or runtime flow changed. The planned engine connection remains absent.

Testing was synthetic-only. No live/user data, environment value, private artifact, raw private
bundle, JPEG, filesystem path, or log was created, inspected, persisted, or added to retention.
Dayflow remains capture/storage/OCR/privacy preprocessing only; suggestion generation remains future
Blabase-engine work shared by A/B/C.

Known Low follow-ups:

- facade post-call mutation test;
- malformed descriptor versus valid mismatch contrast;
- exact importer call-count spy, while the implementation has one static call path;
- hostile direct `WeakMap.get` and `Reflect.apply` tests;
- full-schema fallback fixture;
- field-table coverage;
- whole-repository barrel-negative check.

Rollback must use a successor record. Revert only the final-verifier, detailed-import, capture-only,
test, and dedicated-config additions while preserving the existing public E2-IO.2A importer,
E2-SCHEMA-2A core, and E2-SCHEMA-2B-1 snapshot contracts. Delete only files introduced exclusively
for this verifier. There is no private data or artifact cleanup.

<!-- current-runbook:E2-SCHEMA-2B-STAGE1-9-DIRECT-VERIFIER-COMPLETED-2026-08-21:end -->

## E2-FULL-UNIT validation addendum (2026-08-21)

This addendum supersedes the full-unit status in both the earlier `Not completed`
stop-boundary statement and the Stage 1-9 table row that marked the full Vitest unit suite deferred.
It does not supersede the still-pending Stage 10, common-engine, A/B/C, live, product, release, or
freeze boundaries in those records.

| Check | Recorded result |
| --- | --- |
| Command | `npm test` from `suggestion/` |
| Exit | 0 |
| Test result | PASS, 166 files and 1,531 tests, no failures |
| Vitest duration | 20.05 seconds |
| Elapsed time | approximately 20.26 seconds |
| Documentation activity | no code edit and no validation rerun |

The focused two-file/42-test result and integration four-file/93-test result remain distinct
evidence and must not be summed with or replaced by this full-suite total.

This closes the full-unit validation gate only. Stage 10, common Blabase engine adaptation and
generation, A/B/C execution, live/API/persistence, provider, product, release, and freeze remain
pending and require separate Colin decisions. Baseline/Golden and LikeC4 remain N/A for the reasons
already recorded; privacy, retention, neutral Dayflow output, and same-engine direction are
unchanged.

<!-- current-runbook:E2-FULL-UNIT-PASSED-2026-08-21:end -->
