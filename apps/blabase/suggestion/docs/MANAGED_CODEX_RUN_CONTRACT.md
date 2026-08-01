# Managed Codex Run Observability Contract

## 문서 정보

| 항목 | 값 |
|---|---|
| 상태 | Phase 2B.1 local beta |
| 기준일 | 2026-08-01 |
| 시작 조건 | 사용자의 explicit Work Resumption 실행 |
| transport | local loopback Codex App Server WebSocket + remote TUI |
| public projection | `codex-managed-public-projection-v1` |
| retention | sanitized metadata 최대 30일, run별 최대 10,000 events |
| Attention 사용 | 금지 |

---

## 1. 목적과 비목적

Managed Codex Run Observability는 Blabase를 통해 재개한 Codex 작업의 실행
진행을 Work Cockpit에서 실시간으로 확인하기 위한 **관찰 전용** 기능이다.

```text
explicit task↔Codex binding
+ 사용자의 "Codex에서 작업 이어가기"
→ Local Companion이 native thread를 실행 순간에 resolve
→ Companion이 local loopback Codex App Server를 시작하고 thread를 subscribe
→ 같은 App Server에 연결된 remote Codex TUI를 Terminal에서 시작
→ bounded lifecycle notification을 sanitized metadata로 저장
→ Work Cockpit의 "Codex 실시간 진행"에서 별도 표시
```

이 단계의 목적은 사용자가 여러 Codex 작업의 현재 상태를 눈으로 파악하게 하는
것이다. 다음 기능은 포함하지 않는다.

- managed event를 Attention input, candidate, ranking, selection 또는 result
  resolution에 사용
- progress, stall, scope drift, failure 후 개입 또는 완료 후 후속 작업 추천
- prompt 자동 입력 또는 turn 자동 시작
- 승인 요청의 자동 승인·거절
- 사용자 입력 요청의 자동 답변
- 실패한 Codex 작업의 자동 재실행·재시도
- GitHub, Notion 또는 Calendar mutation

향후 semantic detector가 managed event를 사용하려면 별도 schema/rule version,
회귀 사례, privacy review와 Engine Change Record가 필요하다.

## 2. Live authority

현재 실행 상태를 주장할 수 있는 authority는 Blabase가 직접 소유한 managed
run뿐이다. 한 run이 managed authority를 가지려면 다음 조건을 모두 만족해야
한다.

1. 사용자가 만든 active `WorkSessionBinding`이 있다.
2. binding ID, opaque execution ID, private scope ID와 Codex connection
   generation이 실행 순간의 값과 일치한다.
3. fresh Local Companion instance가 local App Server process와 observation
   connection을 소유한다.
4. App Server의 `thread/resume`으로 해당 native thread를 subscribe한 뒤
   notification을 ordered stream으로 직접 받는다.
5. event가 허용 method, expected native thread와 strict observation schema를
   통과한다.

public liveness도 owner ID 하나만으로 판정하지 않는다. read 시점의 active
Work Resumption state에 동일한 `bindingId + executionId + scopeId +
connectionGeneration` exact authority가 있어야 한다. fresh Companion owner와
exact authority 중 하나라도 없으면 `liveObservationAvailable=false`다.

다음 정보는 managed live authority가 아니다.

- 다른 Codex client가 시작한 기존 session
- `thread/list`의 `active`, `idle`, `not_loaded`, `system_error`
- 과거 `thread/read(includeTurns=true)`의 turn status
- polling 횟수 또는 최근 inventory timestamp
- title, repository 이름, local path 또는 prompt의 유사성

이들은 계속 historical/inventory context로만 표시하고 execution state는
`unknown`으로 둔다. Work Cockpit의 과거 작업 맥락과 managed 실시간 진행은
별도 영역이다.

## 3. Local App Server와 remote TUI 경계

Local Companion daemon은 explicit resume command를 처리할 때 다음 순서로
동작한다.

```text
현재 binding/connection ownership 재검증
→ `codex app-server --listen ws://127.0.0.1:<ephemeral-port>`
→ JSON-RPC `initialize` / `initialized`
→ observation connection에서 `thread/resume`
→ stream 연결 상태 저장
→ Terminal에서
   `codex resume --remote ws://127.0.0.1:<port> <native-thread-id>`
```

queue runtime은 command claim의 최종 검증부터 target resolution, manager 준비,
Terminal launch와 result write까지 Work Resumption execution lease를 유지한다.
이 경로는 manager에 `callerHoldsOwnershipLease`를 명시해 같은 filesystem lease를
재획득하지 않는다. lease 밖에서 호출하는 manager 경로는 스스로 ownership
lease를 획득한다. 이 구분은 중첩 lock deadlock을 피하면서 stale binding 실행도
막기 위한 계약이다.

- endpoint는 `ws://127.0.0.1:<1..65535>`만 허용한다. wildcard interface,
  LAN host, TLS termination 또는 remote server는 이 beta 범위가 아니다.
- binary와 cwd는 absolute local path로 검증하며 child process는
  `shell: false`로 시작한다.
- App Server child에는 Codex 실행에 필요한 allowlisted environment만 전달한다.
- WebSocket startup, request와 message size에는 bounded timeout/limit을 둔다.
  현재 managed runtime message 한도는 4 MiB다.
- startup timeout 안의 socket 연결 시도는 transport establishment이며 Codex
  작업 재시도가 아니다. 끊긴 작업을 자동으로 다시 실행하지 않는다.
- observation connection은 server request를 받더라도 승인, 거절 또는 사용자
  답변을 보내지 않는다. interactive request의 주체는 remote TUI와 사용자다.
- raw/delta notification은 initialize capability에서 opt-out하고 persistence
  allowlist에서도 거부한다.

Codex App Server의 local WebSocket transport와 remote TUI 조합은 현재
experimental local beta 경계로 취급한다. protocol 변경, reconnect 호환성과
실제 Terminal 동작은 release마다 다시 확인해야 한다.

## 4. 허용 event와 상태 의미

### 4.1 Persisted source event

native notification allowlist는 다음 다섯 개뿐이다.

```text
thread/status/changed
turn/started
turn/completed
item/started
item/completed
```

stream lifecycle은 다음 bounded event만 저장한다.

```text
stream_connected
stream_reconnected
stream_disconnected
run_failed
run_closed
```

`item/started`와 `item/completed`에서는 내용이 아니라 다음 normalized item
type 하나만 보존할 수 있다.

```text
user_message | agent_message | reasoning | command_execution | file_change
tool_call | collaboration | web_search | context_compaction | other
```

`reasoning`은 item category가 관찰됐다는 metadata일 뿐 reasoning text를
저장한다는 뜻이 아니다.

### 4.2 Managed run과 turn 상태 분리

managed run lifecycle과 최신 Codex turn 상태는 서로 다르다.

- `turn/completed`는 최신 turn의 `completed`, `failed` 또는 `interrupted`를
  검증하지만 managed run을 종료하지 않는다.
- 같은 thread에서 다음 turn이 시작되면 managed run은 계속 관찰한다.
- `run_failed`와 `run_closed`만 managed run을 terminal lifecycle로 닫는다.
- Codex turn 완료는 연결된 GitHub/Notion work item 완료를 뜻하지 않는다.

public projection은 다음 원칙을 따른다.

- fresh owner, connected stream과 current exact authority가 모두 있을 때만
  `liveObservationAvailable=true`다.
- owner/authority가 없거나 stream이 끊기면 waiting state를 지우고 현재
  nonterminal execution state를 `unknown`으로 낮춘다.
- 마지막으로 검증한 상태는 `lastVerifiedExecutionState`에 별도로 남겨 현재
  추정과 과거 증거를 구분한다.
- reconnect 직후에는 `continuity=gap_detected`이며 reconnect 전의 nonterminal
  `running`/`idle`을 현재 상태로 재사용하지 않는다. 따라서 마지막 검증 상태가
  nonterminal이면 stream이 다시 connected여도
  `effectiveExecutionState=unknown`이다.
- `completed`/`failed`/`interrupted`는 마지막으로 직접 검증된 turn 결과라는
  terminal fact로 보존할 수 있다. 이는 managed run의 현재 활동 또는 연결된
  GitHub/Notion work item 상태를 뜻하지 않는다.
- reconnect 뒤 새 managed notification을 직접 관찰하면 그 notification이
  검증한 상태를 current effective state로 표시할 수 있다. 다만 continuity의
  gap은 유지하고 관찰하지 못한 구간을 history나 새 상태로 역추정하지 않는다.
- sequence가 event time보다 ordering authority다. clock regression이 있어도
  이전 event를 덮어쓰지 않는다.

## 5. 저장, 무결성과 개인정보

managed runtime metadata는 Git에서 제외된 다음 경계에 저장한다.

```text
.local/connectors/codex/managed/registry.json
→ managed run identity와 ownership metadata

.local/connectors/codex/managed/latest.json
→ UI용 latest private projection

.local/connectors/codex/managed/events/managed_run_<id>.json
→ run별 strict ordered event history

.local/connectors/codex/managed/settlement.json
→ registry/history/latest atomic commit의 crash-recovery journal
```

- directory mode는 `0700`, file mode는 `0600`이다.
- registry, latest, history와 settlement는 strict schema와 canonical SHA-256을
  검증한다.
- event는 연속 sequence, previous-event hash와 current event hash로 연결한다.
- history→latest 중간 crash는 exact settlement를 재적용해 복구한다.
- 변조, sequence gap, identity/owner mismatch 또는 불완전한 store는 fail
  closed한다.
- metadata는 최대 30일 보존하고 run별 10,000 event를 넘으면 hash anchor를
  남긴 채 오래된 prefix를 제거한다.
- Codex connector disconnect는 Work Resumption cleanup과 같은 state lease에서
  managed artifact를 제거한다.

managed store에는 다음 raw 값을 저장하지 않는다.

- native Codex thread/turn/item ID
- local cwd와 App Server endpoint
- user prompt와 Codex answer text
- reasoning text
- command와 stdout/stderr/output
- file path와 diff
- tool arguments, results와 provider error payload
- shell command와 Terminal output

별도 explicit opt-in `conversation_and_execution` historical collector는 이
계약과 다른 store/consent/7일 retention을 사용한다. 그 historical raw artifact를
managed history, public projection 또는 Attention으로 복제하지 않는다.

production managed events, UI 조회와 implicit feedback은 Golden 또는 Regression
label이 아니다. 별도 lawful basis, data minimization, anonymization과 human
review 없이 평가 dataset으로 승격하지 않는다.

## 6. Public API와 UI 계약

local product는 `GET /api/managed-codex-runs`에서
`codex-managed-public-projection-v1`만 반환한다.

- local request만 허용하고 응답은 `Cache-Control: no-store`다.
- current fresh Companion owner를 read 시점에 결합해 liveness를 계산한다.
- API는 Work Resumption state lease를 유지한 채 fresh owner와 현재
  binding/execution/scope/connection-generation authority를 읽고 managed
  projection까지 만든다. authority read와 projection read 사이의 unbind 또는
  disconnect TOCTOU를 허용하지 않는다.
- native thread ID, scope ID, connection generation, owner instance ID, cwd,
  event hash와 raw payload를 반환하지 않는다.
- Work Cockpit은 visible 상태에서 기본 2초 polling하고 일시 실패 시 bounded
  backoff를 적용한다.
- managed 실시간 진행은 historical Codex overview와 별도 empty/error state를
  가진다.
- 화면에 **“관찰 전용 · 추천 우선순위에 반영하지 않음”**을 표시한다.
- 모든 public run은 `forbiddenAsAttentionCandidate=true`다.

이 public projection은 Attention input/result, replay input, monitor run hash,
candidate derivation, eligibility, lane, ranking 또는 selection에 절대 결합하지
않는다. snapshot revision과 managed projection revision도 서로 독립이다.

## 7. 종료와 실패 처리

- App Server 또는 WebSocket의 unexpected close는 `stream_disconnected`로
  기록하고 live claim을 제거한다.
- 사용자가 다시 explicit resume할 때 새 stream generation으로 reconnect할
  수 있지만 reconnect 직후 과거 nonterminal effective state는 `unknown`이고
  continuity는 gap으로 남는다. 이후 새 직접 notification만 current
  nonterminal state를 다시 만들 수 있다.
- binding, scope 또는 connection generation이 바뀌면 이전 managed ownership은
  더 이상 유효하지 않다. manager ownership sweep은 새 native event를
  append하지 않고 persisted `run_closed`를 best-effort로 기록한 뒤 idle App
  Server session을 닫는다. close 기록과 경합하거나 실패하더라도 public API의
  exact authority 결합이 즉시 liveness를 fail closed한다.
- Terminal launch가 실패하면 raw error detail 없이 `run_failed`로 닫는다.
- Companion이 정상 종료되면 `run_closed`로 닫고 owned App Server를 종료한다.
- 실패한 작업, prompt, approval 또는 input request를 자동 재실행하거나
  자동 처리하지 않는다.

## 8. 현재 제한과 다음 단계

현재 release는 다음 범위로 제한한다.

- local single-user Companion daemon
- macOS 기본 Terminal
- Blabase가 explicit Work Resumption으로 시작한 run
- local loopback experimental WebSocket transport
- metadata-only progress UI

다음은 별도 Phase 2B semantic change다.

- meaningful progress와 stall detector
- stable approval/input request lifecycle와 escalation threshold
- failed execution intervention
- configured workflow 기반 completion follow-through
- explicit item-level Codex↔GitHub relation
- scope drift detector
- production multi-process/device ownership, pairing과 durable background service

## 9. 완료 조건

- explicit active binding/connection ownership 없이 managed run을 시작하지 않음
- queue launch lease 경로가 같은 Work Resumption lease를 중첩 획득하지 않음
- observer가 thread를 subscribe한 뒤에만 remote TUI를 실행
- loopback 외 App Server endpoint와 arbitrary shell payload를 거부
- allowlist 밖 event, 다른 native thread와 malformed tuple을 저장하지 않음
- stream/owner가 stale하면 current state와 waiting state를 fail closed
- unbind/connection-generation 변경 뒤 persisted run과 무관하게 public
  liveness가 fail closed하고 manager가 best-effort `run_closed`를 기록
- raw prompt/answer/command/output/diff/tool payload sentinel이 managed private
  store, public API와 UI payload에 없음
- history sequence/hash, latest projection과 settlement recovery가 일치
- 30일 retention, 10,000 event cap과 private permission이 검증됨
- turn completion 뒤에도 다음 turn을 관찰할 수 있음
- reconnect 직후 과거 nonterminal state를 current로 재사용하지 않고, 새
  managed notification 뒤에만 current nonterminal state를 다시 표시함.
  terminal state는 마지막으로 검증된 turn 결과로만 보존함
- managed projection이 Attention input, hash, ranking 또는 결과를 바꾸지 않음
- transport, store, runtime, route, UI polling과 disconnect가 synthetic fixture로
  회귀 테스트됨

## 10. 2026-08-01 local beta 검증

- focused managed/Work Resumption/Codex Vitest: `6` files/`76` tests 통과
- 전체 Vitest: `51` files/`438` tests 통과
- typecheck, lint와 production build 통과
- Playwright Chromium E2E: `5` tests 통과. managed progress UI `2` tests 포함
- 실제 `codex-cli 0.146.0` loopback App Server initialize/close smoke 통과
- Cross-source Dev Candidate: `suggestion-cross-source-dev-v0.1`, revision `2`,
  `30` cases, SHA-256
  `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  유지
- `git diff --check` 통과

실제 macOS Terminal launch와 native thread resume smoke는 활성 사용자 session을
방해할 수 있어 실행하지 않았다. 이는 transport 실패가 아니라 별도의 manual
beta verification 후속 항목이다.
