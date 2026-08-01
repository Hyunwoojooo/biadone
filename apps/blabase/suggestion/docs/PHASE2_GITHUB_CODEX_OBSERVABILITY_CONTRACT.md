# Phase 2 GitHub + Codex Observability Contract

## 문서 정보

| 항목 | 값 |
|---|---|
| 상태 | Phase 2A.1 stabilization + Codex historical capture v0.1 + Phase 2B.0 local Work Resumption |
| 기준일 | 2026-07-30 |
| 입력 계약 | `cross-source-attention-input-v0.3` |
| 결과 계약 | `cross-source-attention-result-v0.3` |
| 정책 | `aggressive-evidence-bound-attention-policy-v0.2` |
| GitHub rule | `github-project-aware-candidate-rule-v0.2` |
| Codex rule | `codex-historical-context-overview-rule-v0.3` |
| live orchestrator | `attention-live-orchestrator-v0.2` |
| monitor run | `attention-monitor-run-v0.3` (`v0.1`, `v0.2` read compatibility) |
| ephemeral preview | `attention-monitor-preview-v1`, persistence/replay 주장 없음 |
| failed execution | `attention-monitor-failure-v0.2` (`v0.1` read compatibility), sanitized private metadata + code provenance |
| private replay input | `attention-replay-input-v1`, 30일 local retention |
| supporting source adapter | `supporting-source-adapter-v0.3` |
| Codex observation/history | `codex-execution-observation-v2`, `codex-observation-history-v2` (`v1` exact-record read compatibility) |
| Codex snapshot/config | `codex-snapshot-v3`, `codex-connector-config-v3` |
| Codex content collector | `codex-app-server-thread-read-v1`, `codex-conversation-content-limits-v1` |
| Codex private content | `codex-conversation-and-execution-store-v1`, 7일 local retention |
| Codex content consent | `codex-conversation-content-consent-v1`, 별도 explicit opt-in |
| Work Resumption | `work-resumption-binding-store-v1`, `work-resumption-schema-v1` |
| Local Companion protocol | `work-resumption-local-protocol-v1`, `work-resumption-command-v1`, `work-resumption-heartbeat-v1` |
| 제품 route | local-only `/api/attention`, `/api/sync`, `/api/sync/start`, `/api/sync/status`, `/api/context/*`, `/api/work-resumption`, Work Cockpit, Attention Lab |

---

## 1. 목적

Phase 2A.1은 Phase 1의 integrity-verified runtime `WorkSignalBatch`와
Phase 2A의 decision runner 앞에 서버 중심 수집·context 경계를 둔다.

```text
SourceSyncCoordinator
 GitHub/Codex latest WorkSignalBatch
+ Calendar schedule context
+ Notion project context
+ explicit project mapping
+ global/project weekly outcome
→ GitHub intervention candidates
+ inventory-only Codex Work Cockpit overview
+ explicitly opted-in historical Codex content manifest
→ suggested / scoped no_action / insufficient_evidence
```

LLM은 사용하지 않는다. connector 원본에 없는 deadline, progress, failure,
completion, draft state 또는 obligation을 만들지 않는다.

`thread/read(includeTurns=true)`로 수집한 prompt, answer와 execution content는
과거에 저장된 thread/turn 기록이다. 이 기록을 수집 시점의 live 실행
관찰이라고 해석하지 않는다. raw content는 private connector store에만 두고
Attention에는 completeness, count, hash와 bounded sanitized clue만 전달한다.

---

## 2. 적극 추천의 의미

사용자 결정:

> 서비스가 만드는 추천을 먼저 보고 수정할 수 있도록, 근거가 있는 후보가
> 하나라도 있으면 가능한 한 한 가지를 적극적으로 추천한다.

구현 의미:

- minimum score가 없다.
- 같은 lane의 후보가 비슷해도 clarification으로 멈추지 않는다.
- 실제 update time과 stable ID로 결정적인 기본 후보를 고른다.
- 동급 기본 선택은 더 중요하다는 의미가 아니다.
- `CAVEAT_DEFAULT_TIE_BREAK_USED`와 alternatives를 표시한다.
- partial snapshot의 확인된 positive candidate도 provisional로 제안할 수 있다.

변하지 않는 gate:

- stale 또는 invalid source는 현재 후보에 사용하지 않는다.
- source-native safe destination이 없으면 추천하지 않는다.
- native field가 없는 deadline, urgency, impact를 만들지 않는다.
- Codex `active`를 running/progress로, `system_error`를 failure로 바꾸지 않는다.
- approval/input badge를 request lifecycle로 만들지 않는다.

---

## 3. 제품 기본값

```text
recommendation mode       aggressive_evidence_bound
lane order                must_now → unblock → close_loop → focus
due-soon hypothesis       48 hours
alternatives              최대 2개
weekly outcome            선택 입력, 7일 cadence
source action             read-only
Attention run metadata    로컬 store에 최대 30일
private replay input      로컬 immutable artifact로 최대 30일
Codex raw content         별도 동의 시 private `.local`, 최대 7일
```

48시간은 versioned hypothesis다. native milestone이 overdue 또는 48시간 안인
경우에만 현재 지원 후보를 `must_now`로 올린다. 이를 GitHub issue 자체의
보장된 deadline이나 business urgency로 표현하지 않는다.

pure runner 자체는 persistence를 추가하지 않는다. local orchestrator는
metadata-only run, source health, 후보별 sanitized assessment와 명시적
피드백을 `.local/attention/monitor.json`에 최대 30일 보관한다. monitor
metadata는 Codex의 ordered execution history가 아니며 title, URL, task
summary, raw prompt/response/command/output을 보관하지 않는다.

저장에 성공한 formal run을 exact input으로 재생하기 위한 normalized
Attention input은 별도의
`.local/attention/replay-inputs/run_<id>.json`에
`attention-replay-input-v1` immutable private artifact로 최대 30일 보관한다.
이 artifact에는 평가에 실제 사용된 title, safe URL, weekly outcome 같은
private 값이 포함될 수 있으므로 Git과 제품 API 응답에 포함하지 않는다.

Phase 2A.1의 source sync audit는 별도 store다.

```text
.local/sync/latest.json
→ source별 last attempt/success/failure, retry/backoff와 latest snapshot metadata

.local/sync/history.json
→ newest-first ordered sanitized sync attempts, 기본 최대 256개

.local/sync/transitions.json
→ source별 reset/disconnect durable intent, target state, retry schedule

.local/sync/settlements.json
→ normal attempt의 exact latest/history target을 가진 crash-recovery journal

.local/connectors/codex/observation-history.json
→ ordered inventory observation metadata, 최대 30일

.local/connectors/codex/conversation-history.json
→ explicit opt-in prompt/answer/execution raw artifact, 최대 7일

.local/attention/replay-inputs/run_<id>.json
→ run별 exact normalized Attention input, immutable, 최대 30일
```

connector latest snapshot payload는 기존 connector store가 현재 화면과
normalizer용으로 관리한다. sync history에는 payload를 복제하지 않고 revision,
SHA-256, item count, 시각, latency, retry count와 sanitized error code만
기록한다.

Codex raw content store는 connector directory `0700`, file `0600`, atomic
replacement를 사용한다. store read와 connector config read 시 expiry를
검사하고 만료된 artifact를 삭제한 뒤 `null`로 취급한다. raw content mode가
아닌 상태에서도 남은 raw artifact를 purge하며, scope/content mode 변경과
disconnect는 generation을 갱신해 늦게 끝난 수집이 삭제된 데이터를 되살리지
못하게 한다.

---

## 4. 입력 계약

GitHub와 Codex 입력은 source별 상태를 명시한다.

```ts
type Phase2SourceInput =
  | {
      status: "available";
      batch: RuntimeWorkSignalBatch;
    }
  | {
      status: "unavailable";
      reason:
        | "CONNECTOR_DISCONNECTED"
        | "COLLECTION_FAILED"
        | "SNAPSHOT_MISSING"
        | "SNAPSHOT_PARSE_FAILED"
        | "SNAPSHOT_SCHEMA_UNSUPPORTED";
    };
```

v0.2 Attention input은 supporting source와 focus를 같은 `asOf` decision에
결합한다.

```ts
type CrossSourceAttentionInputV02 = {
  contract: "cross-source-attention-input-v0.2";
  asOf: string;
  focus: {
    primaryOutcome: string | null;
    capturedAt: string | null;
    validUntil: string | null;
  };
  sources: {
    github: Phase2SourceInput;
    codex: Phase2SourceInput;
    googleCalendar:
      | CalendarScheduleContext
      | SupportingSourceUnavailable;
    notion:
      | NotionProjectContext
      | SupportingSourceUnavailable;
  };
};
```

필수 invariant:

- available batch는 slot source와 일치한다.
- 모든 available batch의 `assessment.asOf`는 decision `asOf`와 같다.
- signal, batch ID/hash integrity가 검증돼야 한다.
- raw provider error, credential, local path는 failure에 넣지 않는다.
- GitHub와 Codex는 source별 latest batch 하나만 받는다.
- Calendar event는 `schedule_context_only`, 일반 Notion resource는
  `project_context_only`로만 입력되며 직접 candidate를 만들지 않는다.
- `supporting-source-adapter-v0.3`는 Calendar constraint를 결정적 순서의 최대
  250개로 제한하고 초과 여부를 `truncated`로 보존한다.
- project mapping이 없는 source scope의 `projectId`는 `null`이다.

project identity는 GitHub repository ID, Codex scope ID, Notion resource ID와
Calendar OAuth 연결 세대별 random `connectionScopeId`를 opaque reference로
보존한다. Calendar reconnect는 같은 계정이어도 새 scope를 만들며 이전
mapping을 자동 재사용하지 않는다. title, repository name, local path 또는
문자열 유사성으로 자동 확정하지 않는다. mapping은
`/api/context/projects`의 explicit user confirmation을 거친 active decision만
normalizer와 supporting adapter에 적용한다.

weekly outcome store는 global `projectId=null`과 project-scoped outcome을 모두
지원한다. 현재 Attention source scope가 한 project로 명확하게 resolve되면 해당
project outcome을 우선하고, 그렇지 않으면 global outcome을 사용한다.
`/api/context/weekly-outcome`과 제품의 Weekly focus UI는 global 한 줄 입력
경계다.
outcome 원문은 결과에 복사하지 않으며 title/repository와 결정적인 token
overlap이 있을 때만 같은 lane 안의 약한 preference로 사용한다. 이 match는
eligibility, lane 또는 deadline을 만들 수 없다. 7일 validity가 지났거나
`capturedAt`이 decision `asOf`보다 미래면 ranking에 사용하지 않는다.

---

## 5. GitHub candidate rule

### 5.1 Assigned issue

다음을 만족하면 confirmed `do` 후보다.

- current fresh GitHub batch
- `assigned_issue`
- open state와 query membership evidence
- direct work item
- safe GitHub destination

기본 lane은 `focus`다. native milestone이 overdue 또는 48시간 안이면
`must_now`다. 현재 state는 `not_started`나 `in_progress`로 추론하지 않고
`unclear`로 유지한다.

### 5.2 Review request with unknown draft state

현재 contract에는 `isDraft`가 없다.

금지:

```text
review request observed
→ isDraft=false 추론
→ 실제 review 행동 추천
```

Phase 2A 허용:

```text
review request observed + safe destination
→ provisional inspect
→ “PR을 열어 draft 여부와 리뷰 가능 상태 확인”
```

기본 lane은 `unblock`이며 `CAVEAT_REVIEW_DRAFT_UNKNOWN`을 표시한다.
Phase 2B에서 native `isDraft=false`가 추가된 뒤에만 confirmed `review`로
승격한다.

### 5.3 Excluded

- authored open PR
- activity-only signal
- stale/invalid source의 work item
- unsafe destination
- source evidence가 없는 deadline

---

## 6. Codex observation과 overview rule

### 6.1 Inventory-only current collector

current `codex-snapshot-v3`의 session inventory는 `thread/list`에서
오므로 모두 overview-only다. inventory가 보여주는 `active`, `not_loaded`,
`system_error`는 blabase가 해당 실행의 event stream을 관찰했다는 뜻이 아니다.

모든 inventory observation은 다음 invariant를 지킨다.

```text
observationMode          inventory_only
liveObservationAvailable false
executionState           unknown
inventoryActivityState   non-null inventory enum
waitingState             null
sourceEvent              thread_inventory
sourceUpdatedAt          non-null inventory timestamp
reasonCode               CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE
```

| Native inventory | Overview 표시 | 실행 의미 |
|---|---|---|
| `active` | activity label | `unknown` |
| `idle` | idle label | live completion을 뜻하지 않음 |
| `not_loaded` | 실행 관찰 불가 | stopped/failed/completed를 뜻하지 않음 |
| `system_error` | inventory system-error label | live execution failure를 뜻하지 않음 |
| `unknown` | unknown | `unknown` |
| approval/input badge | `overview_badge_only` | stable request lifecycle 아님 |

snapshot의 approval/input badge는 inventory overview 표시일 뿐 observation의
`waitingState`로 저장하지 않는다. `inventory_only` record에 managed 전용
waiting state, reason code, event 또는 null source timestamp가 섞이면 schema가
거부한다.

opt-in task summary는 `display_only_unknown`으로 표시할 수 있다. inventory Codex
execution은 모두 `forbiddenAsAttentionCandidate=true`다. invalid batch는
overview를 만들지 않고 `SOURCE_CODEX_STALE_OR_INVALID` coverage reason을
남긴다.

inventory session의 의미 상태가 바뀐 경우에만 metadata observation을 strict
sequence order로 append하고 최대 30일 보존한다. 동일 상태 polling은 history를
늘리지 않는다. 이 history는 “목록이 언제 어떻게 관찰됐는가”를 재생하기 위한
것이며 running, meaningful progress, stall, completion 또는 failure의 근거가
아니다.

### 6.2 Explicit opt-in historical content capture

Codex content mode는 세 단계로 분리한다.

| mode | 수집 범위 | 동의 |
|---|---|---|
| `metadata_only` | thread inventory metadata | raw content 동의 없음 |
| `activity_summary` | metadata + 기존 task summary | summary 동의만 |
| `conversation_and_execution` | metadata + `thread/read(includeTurns=true)` historical content | 별도 명시적 동의 필수 |

기존 `activity_summary` consent를 raw content consent로 자동 승격하지 않는다.
`conversation_and_execution`을 선택한 사용자가
`codex-conversation-content-consent-v1`의 수집 범위와 7일 retention을 확인한
시각을 별도로 기록한 경우에만 수집한다. 동의가 없거나 contract/version이
일치하지 않으면 연결 요청을 거부한다.

`thread/read(includeTurns=true)` response에서 다음 categories를 strict schema로
정규화한다.

- user prompt text와 image/local-image/skill/mention reference
- Codex `agentMessage`의 commentary/final answer
- plan
- command, working directory, command action, aggregated stdout/stderr, exit
  code, duration과 historical status
- file path, change kind와 diff
- MCP/dynamic tool namespace, name, argument, result/error, success와 duration
- turn status/time/error와 supported process event payload

Codex private reasoning item은 수집하지 않는다. reasoning이 발견되면 payload를
버리고 count와 `REASONING_EXCLUDED_BY_POLICY`만 남긴다. unknown item은 추측해
기존 category로 바꾸지 않고 버린 뒤 `UNSUPPORTED_ITEM`과 partial completeness를
기록한다.

현재 bounded collection limits는 다음 versioned contract다.

```text
limits contract        codex-conversation-content-limits-v1
thread reads / sync    25
turns / thread         100
items / thread         1,000
bytes / field          1 MiB, UTF-8 code point 경계
bytes / thread         16 MiB
raw retention          7일
```

limit에 닿아도 이미 strict-validated한 prefix는 저장할 수 있다. 대신
`TURN_LIMIT`, `ITEM_LIMIT`, `FIELD_BYTE_LIMIT` 또는 `THREAD_BYTE_LIMIT`과
original/stored byte count, truncation, content SHA-256을 남기며 session
acquisition state는 `partial`이다. malformed response, 다른 thread ID, read
중 `updatedAt` 변경, per-thread RPC failure와 read cap은 각각
`THREAD_RESPONSE_INVALID`, `THREAD_CHANGED_DURING_READ`,
`THREAD_READ_FAILED`, `THREAD_READ_LIMIT`으로 구분한다. 이전의 unexpired
strict artifact가 있으면 stale manifest로 표시할 수 있지만 새 데이터인
것처럼 갱신하지 않는다.

raw artifact는
`.local/connectors/codex/conversation-history.json` 하나에 strict session
contract, consent contract, scope, collection/expiry time, limits provenance,
content hash와 함께 저장한다. snapshot에는 full prompt, answer, plan, command,
stdout/stderr, diff, tool arguments/results 또는 turn error를 복제하지 않는다.
snapshot content manifest에는 artifact hash, source/collection/expiry time,
completeness/reason, historical last-turn status, category counts와 bounded
sanitized excerpts만 허용한다.

raw artifact와 full source text는 다음 경계에 절대 넣지 않는다.

- WorkSignal과 Attention input/result/candidate
- `.local/attention/replay-inputs`의 normalized Attention replay
- Attention monitor와 source sync latest/history
- connector/status/Attention 제품 API response
- Golden/Regression dataset 또는 Git

manifest의 `historicalTurnStatus`는 마지막 persisted turn을 read한 결과다.
`completed`, `failed`, `interrupted`, `in_progress`가 있어도 현재
running/completed/failed라고 주장하지 않고
`forbiddenAsAttentionCandidate=true`를 유지한다. live 상태는 다음 managed
event-stream contract로만 만들 수 있다.

사용자가 mode를 낮추면 먼저 새 config에서 raw 수집 동의를 비활성화하고
snapshot, observation history와 raw artifact를 삭제한다. scope 변경도 이전
scope artifact를 삭제한다. disconnect는 config, snapshot, observation
history와 raw artifact를 모두 삭제한다. read/startup은 expiry를 확인해 7일이
지난 artifact를 삭제하며, generation guard는 opt-out/disconnect와 겹친
in-flight 수집의 늦은 write를 거부한다.

### 6.3 Managed App Server event stream

live 실행 상태는 blabase가 long-lived Codex App Server connection과 thread/turn
lifecycle을 직접 소유하고 ordered notification을 받은 경우에만
`observationMode=managed_event_stream`으로 만들 수 있다.

허용 native event:

```text
thread/status/changed
turn/started
turn/completed
item/started
item/completed
```

`running`, `completed`, `failed`, `interrupted`는 위 managed event의 native
status에만 대응한다. 현재 collector는 이 managed connection을 만들지 않고,
다른 Codex client가 소유한 세션의 event stream에 attach하지 않는다. 따라서
managed schema와 parser가 있어도 현재 Work Cockpit은 inventory 세션에 live
state를 표시하거나 exception candidate를 생성하지 않는다.

managed record도 다음 exact tuple만 허용한다.

| source event | execution state | waiting state | reason |
|---|---|---|---|
| active thread status | `running` | null/approval/input | `CODEX_MANAGED_THREAD_ACTIVE` |
| idle thread status | `idle` | `null` | `CODEX_MANAGED_THREAD_IDLE` |
| not-loaded/system-error thread status | `unknown` | `null` | 대응 managed thread reason |
| turn started | `running` | `null` | `CODEX_MANAGED_TURN_STARTED` |
| turn completed | native `completed`/`failed`/`interrupted` | `null` | 대응 managed turn reason |
| item started/completed | `running` | `null` | `CODEX_MANAGED_ITEM_ACTIVITY` |

모든 managed record는 `liveObservationAvailable=true`,
`inventoryActivityState=null`, `sourceUpdatedAt=null`이다. event/state/reason을
교차 조합하거나 inventory timestamp/activity를 섞으면 거부한다.

exact validation을 식별하기 위해 observation/history contract를 `v2`로
올렸다. semantically valid한 private `v1` history는 read 시 메모리에서 `v2`로
정규화하고 다음 정상 append가 `v2`로 atomic replacement한다. `v1`이라도
waiting state나 managed reason이 섞인 malformed inventory record는
마이그레이션하지 않고 fail closed한다.

---

## 7. Coverage와 결정

### Suggested

- confirmed 또는 safe provisional candidate가 하나 이상
- lane, deadline hypothesis, weekly token match, update time, stable ID 순으로
  결정적인 top 선택
- partial candidate set이면 `provisional`과 caveat 표시

### Scoped no-action

다음을 모두 만족해야 한다.

- GitHub snapshot이 fresh
- GitHub candidate set이 complete
- material invalid/conflicting/unsafe direct record 없음
- candidate 없음

사용자 문구:

> 현재 평가 가능한 GitHub 작업 범위에서는 사용자가 직접 개입할 항목이
> 없습니다. Codex는 목록 기반 실행 현황만 표시했습니다. 연결된 Google
> Calendar와 Notion은 각각 일정·프로젝트 맥락으로 반영했지만 직접 행동
> 후보로 만들지는 않았습니다.

supporting source가 disconnected 또는 unavailable이면 기존처럼 평가하지 못한
source를 명시한다. Calendar/Notion availability는 GitHub candidate-capable
negative coverage를 만들지 않으며 `no_action`의 근거를 넓히지 않는다.

### Insufficient evidence

- GitHub disconnected, failed, stale 또는 invalid
- GitHub candidate set이 partial이고 확인된 positive candidate가 없음
- unsafe destination 때문에 현재 행동을 시작할 수 없음
- Codex overview-only만 있고 candidate-capable source가 없음

`needs_clarification` 상태는 계약에 남지만 Phase 2A에서는 preference tie 때문에
사용하지 않는다. 사용자 답이 eligibility나 명시적인 실행 결정을 바꿀 수 있는
case를 추가한 뒤 활성화한다.

---

## 8. 결정성, 무결성, 개인정보

결과는 다음을 기록한다.

- input SHA-256
- stable result ID
- result SHA-256
- input/result/policy/rule version
- candidate source signal IDs
- coverage, gate, candidate, why-now, caveat, decision reason code

같은 canonical input과 policy에서는 top, alternatives, overview order와 hash가
같아야 한다. hash 이후 결과를 바꾸면 integrity verification이 실패한다.

persisted current run은 `attention-monitor-run-v0.3`이며 `runId` 외에
`analysisId`, `sessionId`와 `attention-replay-input-v1` artifact SHA-256을
요구한다. 기존 `attention-monitor-run-v0.1`, `v0.2`는 read compatibility만
유지하고 새로운 run 생성에는 사용하지 않는다.

GET 자동 평가와 POST persistence 실패 응답은
`attention-monitor-preview-v1`이다. preview는 `analysisId/sessionId=null`,
`replayArtifactState=not_recorded`, `replayArtifactSha256=null`이며 formal
monitor store에 저장할 수 없다. 따라서 실제 artifact가 없는 응답이 immutable
replay를 주장하지 않는다.

명시적 POST가 source sync 또는 Attention resolution에서 실패하면 실행 전에
발급한 `runId`, `analysisId`, `sessionId`를 유지한
`attention-monitor-failure-v0.2` metadata를 기록한다. 상태는 `failed`이며
실패 단계, sanitized error code, retry count, latency, 적용된
engine/schema/policy/rule version과 성공 run과 같은 code provenance를 남긴다.
기존 v0.1 failure는 `codeCommitSha=null`, `codeState=legacy_unknown`,
fingerprint null로만 읽는다. raw exception, credential, provider payload와
private path는 저장하거나 응답하지 않는다.

code provenance는 다음 중 하나다.

```text
clean_commit      현재 clean worktree의 commit SHA
declared_commit   운영자가 명시적으로 제공한 commit SHA
dirty_worktree    commit SHA 없음 + deterministic code fingerprint
unavailable       commit SHA와 fingerprint 모두 없음
```

dirty code fingerprint는 당시 code state를 식별하지만 source patch 자체를
materialize하지 않으므로 exact release replay를 보장하지 않는다. release
comparison은 clean committed code SHA를 요구한다.

사용자 화면용 결과에는 권한 범위의 GitHub title, safe URL, opt-in Codex
summary가 포함될 수 있다. engine error와 integrity failure에는 해당 원문,
token, private path 또는 provider detail을 넣지 않는다.

### 8.1 Local product orchestration

- `GET /api/attention`은 저장된 snapshot을 현재 시각으로 평가하는
  side-effect-free preview이며 scheduler나 run history를 변경하지 않는다.
- same-origin `POST /api/attention`은 네 source를
  `SourceSyncCoordinator`로 갱신한 뒤 저장된 snapshot을 평가하고 실행
  history를 기록한다.
- same-origin `POST /api/sync`는 요청한 source만 같은 coordinator를 통해
  즉시 갱신한다. connector connect/callback, Codex connect/content-mode와
  `evaluateCurrentAttention({refreshSources:true})`도 explicit snapshot
  collection을 이 경계로 전달한다.
- same-origin `POST /api/sync/start`는 local background scheduler의 명시적
  idempotent start endpoint다. manual sync를 수행하는 mutation path도 완료 뒤
  scheduler가 유지되도록 보장한다.
- `GET /api/sync/status`는 source별 마지막 시도·성공·실패, retry/backoff,
  snapshot revision/hash와 전체 pipeline revision을 side-effect 없이 반환한다.
- coordinator의 기본 성공 주기는 GitHub/Notion 5분, Codex 30초,
  Calendar 1분이다. 실패는 source별 versioned exponential backoff를 사용하고
  manual sync는 due time과 무관하게 즉시 시도한다.
- live freshness hypothesis는 GitHub 30분, Codex 5분, future clock skew
  1분이며 `attention-live-freshness-policy-v0.1`로 고정한다.
- GitHub에 active installation과 비어 있지 않은 non-archived repository
  scope가 없으면 scoped `no_action`을 만들지 않는다.
- Work Cockpit은 사용자용 현재 결과와 source health, Codex overview를
  보여주며 explicit project mapping과 global weekly outcome 입력·수정 surface를
  제공한다.
- Attention Lab은 run/result ID, hash, policy/rule version, source coverage,
  candidate funnel과 sanitized gate reason, 명시적 feedback을 보여준다.
- visible browser는 sync status를 15초 polling하며 client failure 시 최대
  120초까지 backoff하고, Work Cockpit과 Attention Lab preview는 30초
  polling한다. page가 hidden이면 polling을 중단했다가 visible일 때 즉시
  확인한다.
- polling consumer가 시작될 때 먼저 `/api/sync/start`를 호출한다.
  stop/start가 기존 in-flight poll과 겹쳐도 새 generation이 즉시 이어지고,
  첫 status response에 저장된 revision이 있으면 초기 UI도 invalidation한다.
- 전체 또는 source snapshot revision/hash나 disconnect 상태가 바뀌면
  connector card, timeline, Work Cockpit과 Attention Lab에 invalidation event를
  전파해 저장본을 다시 읽는다.
- 페이지 조회와 자동 preview는 run count를 늘리지 않으며 explicit
  refresh/evaluation만 새로운 run이다.
- 같은 run의 같은 feedback은 idempotent하고, 변경된 feedback은 이전
  event를 참조하는 correction으로 보존한다. feedback은 자동 Gold가 아니다.
- store는 30일 cutoff를 읽을 때도 디스크에 적용하며 0700 directory,
  0600 file, atomic rename을 사용한다.
- `CONNECTOR_DISCONNECTED`, `REAUTHORIZATION_REQUIRED`와 명시적인
  refresh-token 부재·만료는 `disabled`, `nextDueAt=null`로 저장해 scheduled
  retry를 멈추고 reconnect 뒤 manual sync로 `ready`에 복귀한다.
- GitHub, Codex, Calendar, Notion store는 generation guard와 serialized
  mutation으로 disconnect 뒤 늦게 끝난 collection write를 거부한다.
- connector startup/read는 strict-name atomic temp를 5분 grace와 active-write
  guard 뒤 정리한다. explicit disconnect는 serialized generation 변경 뒤
  recognized inactive token/config/snapshot/observation temp를 age와 무관하게
  제거하고 unrelated file, directory와 symlink는 건드리지 않는다.
- GitHub/Notion/Calendar reconnect는 새 credential 저장 전에 generation을
  증가시키고 이전 snapshot을 제거한다. disconnect는 local 삭제를 먼저
  확정하며 remote revoke는 2초 bounded best-effort다.
- OAuth replacement는 해당 source의 이전 connection lineage를 latest/history에서
  제거하되 다른 source history는 보존한다. durable lineage reset이 성공하기
  전에는 replacement credential을 저장하지 않는다. purge 저장이 실패하면
  기존 credential을 그대로 두고 `source-sync-transition-v1` intent, clean
  target과 retry schedule을 영속 보존하며 재시작 후에도 adapter 실행 전에
  idempotent replay한다.
- Codex selected scope/content contract 변경도 connection generation을
  초기화하며 durable reset이 성공하기 전에는 새 config를 저장하지 않는다.
  scope 변경 시 이전 snapshot과 inventory history를 제거한다.
- connection generation/disconnect persistence가 진행 중인 source에는 별도
  transition barrier와 source별 mutex를 두어 concurrent manual/scheduled
  adapter 실행을 막고 reset/disconnect 호출 순서를 보존한다. disconnect
  finalization이 실패해도 동일 attempt를 durable intent에서 재사용해 history에
  중복 기록하지 않는다. 다른 source commit은 pending target과 intent를
  보존한다.
- normal source commit은 `source-sync-settlement-v1` exact target을 먼저
  저장하고 history→latest 순서로 projection한다. 중간 실패는 같은 process에서
  즉시 replay/read-back 확인하고, 연속 실패나 process crash는 다음
  read/mutation 또는 재시작 시 adapter보다 먼저 journal을 그대로 재생한다.
  disabled→manual success도 새 attempt를 만들지 않고 동일 settlement로
  `ready`를 확정한다.
- source A journal을 source B commit 시작에서 복구했다면 recovered disk latest가
  authoritative base다. B state만 병합한 exact store를 repository가
  coordinator에 반환해 stale caller가 A recovery를 덮어쓰지 않는다. journal
  recovery가 없던 정상 commit은 caller latest 전체를 유지해 등록 adapter
  normalization을 보존한다. projection 전에는 transition 보호 대상이 아닌
  source의 retained history와 latest `lastAttempt`를 교차검증한다.
- `beginTransition`/`updateTransition`이 journal을 복구한 경우에도 같은
  authoritative handoff를 사용하고, `completeTransition`은 그 latest에
  transition source만 병합한 store를 coordinator에 반환한다. 따라서 다른
  source의 reset/disconnect가 recovered source를 stale caller 값으로
  되돌리지 않는다.
- sync 또는 reset/disconnect intent를 준비하기 전에도 pending settlement를
  선택적으로 복구한다. 같은 source disconnect의 retry count, last success와
  attempt는 recovered state에서 계산하며, recovery가 없으면 기존 in-memory
  normalization을 교체하지 않는다.
- adapter 미등록 source는 transition/pending 처리 뒤 즉시 skip해 unrelated
  transition barrier를 기다리지 않는다. 반대로 등록 adapter는 unrelated
  transition 중에도 settlement queue를 반드시 통과한 뒤 current/due/previous
  snapshot을 읽고 실행한다.
- atomic rename 뒤 chmod acknowledgement가 실패하면 target bytes와 0600 mode를
  read-back 검증한다. 이미 비워진 transition store를 실패로 오인해
  coordinator가 존재하지 않는 intent를 계속 갱신하지 않는다.
- scheduler start는 source collection을 기다리지 않으며 provider HTTP
  request는 요청당 15초 상한을 가진다. coordinator disconnect는 in-flight
  settlement를 supersede하고 `disabled` 상태를 즉시 기록한다.
- Codex inventory observation history는 의미 상태 변화만 append하고 건수
  절단 없이 30일 time cutoff를 적용한다.
- Attention run은 GitHub/Codex batch뿐 아니라 Calendar/Notion snapshot hash,
  fetched time, adapter version, item/mapping/truncation과 work-context registry,
  resolution, weekly-outcome store hash·상태를 metadata-only provenance로
  기록한다.
- explicit POST evaluation은 metadata run과 정확히 대응하는 private immutable
  `attention-replay-input-v1` artifact를 각각 private atomic write로 기록한다.
  replay artifact는 30일 후 run과 함께 제거되며 GET/POST 제품 응답에는
  노출하지 않는다.
- monitor history read는 current v0.3 replay artifact의 실재, schema,
  run/analysis/session/input/captured-at linkage와 artifact hash를 검증하고
  불일치 시 fail closed한다. 실제 historical v0.1/v0.2 field는 읽을 때
  analysis/session null, replay `not_recorded`/hash null, code
  `legacy_unknown`/SHA·fingerprint null로 정규화되어 신뢰 provenance를 주장할
  수 없다. private store rewrite는 원본 legacy run을 그대로 보존해 기존 SHA를
  silently overwrite하지 않는다.
- replay retention cleanup은 monitor validation과 독립적으로 실행한다.
  corrupt monitor에서는 retained set을 추정하지 않고 strict canonical/temp 중
  cutoff보다 오래된 파일만 정리한다. current artifact, unsafe name, directory는
  보존하며 valid store에서만 retained set 기반 orphan cleanup을 수행한다.
- formal run/replay 저장이 실패한 POST는 degraded ephemeral preview로
  응답하며 `available` replay를 주장하지 않는다.

### 8.2 Context APIs

- `GET /api/context/projects`는 private registry의 active projects, explicit
  mappings, 미확정 proposals와 token/path/content를 제외한 bounded source
  scope discovery를 읽는다.
- `POST /api/context/projects`는 project 생성, mapping 확인 또는 제거를
  수행한다. confirm/remove는 `explicitUserConfirmation=true`를 요구한다.
- `GET /api/context/weekly-outcome`은 현재 active global outcome을 읽는다.
- `POST /api/context/weekly-outcome`은 한 줄 global outcome을 7일 validity로
  capture/update한다.
- context 변경은 Attention UI를 invalidation한다. project-scoped weekly
  outcome은 동일 store/resolver 계약이 지원하며 별도 project 편집 UX는 후속
  작업이다.
- Work Cockpit의 Project mappings UI는 sanitized source label만 보여주고
  사용자가 연결·해제를 명시적으로 실행할 때만 registry를 바꾼다. Weekly
  focus UI는 global outcome을 생성·수정하고 저장 성공 즉시 Attention을
  invalidation한다.

모든 local mutation API는 same-origin POST만 허용하고 GET 응답은
`Cache-Control: no-store`다.

registry가 아직 없는 첫 사용자도 active global weekly outcome을 Attention
focus로 받는다. registry가 있고 하나의 project로 resolve되면 active project
outcome을 우선하고, project override가 없거나 expired/not-yet-active이면
active global outcome으로 fallback한다.

---

## 9. Phase 2B 진입 조건

Phase 2A.1에서 다음 기반은 구현됐다.

- inventory와 managed event stream의 strict semantic boundary
- `thread/status/changed`, turn/item event의 schema/parser
- inventory/managed observation을 검증하는 strict ordered history schema와
  current Codex inventory metadata의 30일 persistence
- 별도 explicit consent를 요구하는 `thread/read(includeTurns=true)` historical
  prompt/answer/execution collector와 strict raw store
- reasoning exclusion, completeness/reason code, content hash와 bounded
  manifest를 가진 7일 private retention/purge 경계
- explicit Codex scope↔project mapping과 project workflow를 붙일 수 있는 context
  registry

Phase 2B.0의 첫 safe-destination vertical slice는 semantic detector와 분리한다.

- 사용자가 현재 attention subject와 opaque Codex execution을 직접 연결하는
  WorkSessionBinding
- local-only bounded command queue와 macOS Local Companion heartbeat
- Companion online + 사용자 explicit action일 때만 허용하는
  `focus_or_resume`
- native thread ID와 cwd를 저장하지 않고 실행 순간 App Server에서만 resolve
- 기존 Companion-launched Terminal focus 또는 새 Terminal의
  `codex resume <thread-id>`
- prompt 자동 전송, 승인 자동 처리, 자동 재시도와 arbitrary shell 금지

정확한 상태, 저장과 privacy boundary는
`WORK_RESUMPTION_CONTRACT.md`를 따른다. 이 vertical slice는 Codex historical
inventory를 live state로 승격하거나 failure/stall candidate를 만들지 않는다.

다음 semantic detector와 managed runtime은 아직 구현하지 않는다.

- confirmed non-draft review
- Codex meaningful progress, stall, failure, recovery, completion
- stable approval/input request lifecycle와 escalation
- completed execution의 configured follow-through
- semantic Codex exception candidate와 WorkSessionBinding을 자동 연결하는
  relation-aware safe destination
- explicit item-level Codex↔GitHub relation
- GitHub checks, requested changes, merge conflict
- blabase가 connection lifecycle을 소유하는 long-lived Codex App Server manager
- managed event reconnect, sequence gap, replay와 retention 운영
- semantic detector가 사용할 managed event의 실제 runtime ingestion/persistence

inventory observation history를 polling 횟수가 충분하다는 이유로 managed event
history로 승격하거나 semantic detector에 입력해서는 안 된다.

Phase 2B connector 계약이 위 native evidence를 제공한 뒤 별도 schema/rule
version과 regression case를 추가한다.

---

## 10. Phase 2A.1 regression contract

필수 deterministic regression:

- source별 due polling, single-flight와 exponential backoff
- disconnected source의 persisted disable/no scheduled retry와 manual recovery
- 성공 후 retry reset, 실패 후 latest success/snapshot 보존과 recovery
- latest state와 ordered sanitized attempt history 분리 및 atomic private write
- history→latest 중간 실패의 same-process confirmation과 durable exact
  settlement restart recovery
- source A settlement recovery 뒤 source B same-process commit의 A/B
  latest/history 보존과 정상 adapter-registration normalization 보존
- source A settlement recovery 뒤 source B reset/disconnect transition의
  authoritative latest/history 보존
- same-source success settlement recovery 뒤 disconnect의 last-success/retry/
  attempt lineage 보존
- pending settlement와 unrelated transition barrier가 겹친 registered adapter의
  pre-execution wait 및 recovered previous snapshot 전달
- failed reset/disconnect의 durable transition intent, 다른 source commit 뒤
  restart recovery, source별 reset↔disconnect 직렬화와 idempotent attempt
- transition clear rename 뒤 chmod failure의 exact/private read-back 성공 확정
- `/api/sync`, `/api/sync/start` same-origin mutation과 `/api/sync/status`,
  `/api/attention` side-effect-free GET
- connector connect/callback/refresh의 coordinator routing
- 첫/subsequent snapshot revision 변경 시 Work Cockpit, Attention Lab,
  connector와 timeline invalidation
- polling 실패 후 backoff/retry, hidden/visible lifecycle과 in-flight stop/start
- 네 connector 모두 disconnect 중 in-flight 결과가 connection/snapshot을
  되살리지 않음
- 네 connector의 crashed atomic temp가 startup grace 뒤 정리되고 explicit
  disconnect가 recognized inactive credential/content temp를 즉시 제거함
- Codex inventory가 live running/completed/failed를 주장하지 않음
- inventory exact tuple이 approval/input waiting, managed reason/event를
  거부하고 malformed persisted v1/v2 history를 fail closed함
- valid v1 history를 v2로 보수적으로 정규화하고 managed App Server event의
  exact state/waiting/reason tuple만 managed execution state를 생성
- 기존 summary consent를 raw consent로 승격하지 않고 explicit consent가
  없으면 `conversation_and_execution` mode를 거부함
- full synthetic `thread/read` fixture의 user prompt, agent answer, plan,
  aggregated command stdout/stderr, exit result, file diff, MCP/dynamic tool
  result 보존과 reasoning payload 제외
- malformed/unknown item fail-closed 또는 partial classification과 turn/item/
  field/thread cap별 deterministic reason code, UTF-8-safe truncation
- strict raw store/session SHA-256 검증과 raw file `0600`, connector directory
  `0700`, 7일 expiry read/startup purge
- content mode downgrade, scope 변경, disconnect와 in-flight generation
  conflict에서 raw artifact가 재생성되지 않음
- raw sentinel이 bounded snapshot manifest, WorkSignal, Attention input/result,
  monitor, replay, sync history와 제품 API에 나타나지 않음
- persisted `historicalTurnStatus`가 live execution 상태나 Codex 행동 후보로
  승격되지 않음
- explicit confirmation 없는 project mapping 거부
- registry가 없는 global outcome을 포함한 global/project weekly outcome
  cadence, correction과 resolution
- 최대 250개와 truncation을 포함한 Calendar schedule-context-only,
  Notion project-context-only
- Calendar/Notion snapshot과 work-context/outcome monitor provenance
- four-source snapshot→context→Attention→UI revision end-to-end propagation
- current monitor run의 `analysisId`/`sessionId`, clean/declared commit과 dirty
  fingerprint provenance, immutable replay artifact hash 일치
- explicit POST source-sync/resolver 실패의 sanitized failed-run metadata
- persisted replay artifact 실재·schema·lineage·hash read-time fail-closed,
  legacy provenance claim 거부와 crashed temp retention
- private replay input의 file permission, API 비노출과 run retention에 맞춘
  30일 pruning

검증 command는 `sourceSyncCoordinator`, `syncRoutes`, `uiSyncController`,
`dataPipelineE2E`, `connectorCallbackSyncRoutes`, 네 connector race,
`workContext`, `liveAttention`, `supportingSourceAdapters`와
`codexObservationContract`, `codexConversationContract`,
`codexConversationPrivacy`, `codexConversationCollection` targeted suite, 전체
test, typecheck, lint와 production build다. 2026-07-29 최종 통합 검증은
Vitest `40` files/`342` tests, Playwright Chromium E2E `2` tests,
suggestion typecheck/lint/production build를 통과했다. 신규 Codex
content/privacy focused suite는 `3` files/`11` tests이며 explicit consent
route와 legacy v0.2 Attention replay read compatibility도 전체 회귀에
포함한다.

`dataPipelineE2E.test.ts`는 private filesystem-backed latest/history store,
coordinator status와 UI invalidation client를 연결한다. callback/API와 네
connector disconnect race는 별도 route/connector regression으로 검증한다.
`npm run test:e2e`는 credential과 `.env.local`을 복사하지 않은 synthetic
private fixture와 실제 Chromium browser/Next.js route/React UI를 사용해
일시적인 status polling 실패 뒤 recovery, 첫 저장 revision의 Work
Cockpit→Attention Lab 전파, 실제 Codex disconnect route의 snapshot revision
제거와 두 UI 전파를 검증한다. production multi-process scheduler/lease E2E는
후속 운영 검증 범위다.

Cross-source evaluation dataset은 이번 변경에서 수정하지 않았다. 현재 dataset은
mutable synthetic Dev Candidate이고 reviewed/adjudicated Golden이 없으므로
formal frozen baseline은 보류한다. release 품질 비교는 dataset freeze,
canonical SHA-256, clean commit SHA, 동일 frozen input의 immutable replay
artifact와 candidate/comparison `runId`·`analysisId`·`sessionId`가 준비된 뒤
수행한다. dirty code fingerprint만 있는 run은 release baseline으로 승격하지
않는다.
