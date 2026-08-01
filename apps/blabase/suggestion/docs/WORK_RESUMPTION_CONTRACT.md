# Work Resumption Contract

## 1. 목적과 범위

Work Resumption은 Work Cockpit의 제안을 사용자가 이미 작업하던 Codex
세션으로 안전하게 이어주는 로컬 실행 경계다.

첫 구현은 다음 한 가지 흐름만 지원한다.

```text
사용자가 Work Cockpit 제안과 Codex 세션을 명시적으로 연결
→ 사용자가 "Codex에서 작업 이어가기"를 직접 실행
→ Local Companion이 연결된 세션을 찾음
→ Companion daemon이 local loopback App Server에서 thread를 먼저 subscribe
→ 이미 같은 managed endpoint로 연 Terminal이면 해당 창을 앞으로 가져옴
→ 아니면 새 Terminal에서
  `codex resume --remote ws://127.0.0.1:<port> <thread-id>` 실행
```

이 기능은 추천 엔진이 Codex를 자율 제어하는 기능이 아니다. 제안의 선택,
세션 연결, 재개 시작은 각각 사용자에게 보이는 별도 단계다.

## 2. 제품 원칙

1. **명시적 연결만 사용한다.** 제목, URL, repository 이름 또는 prompt
   유사성으로 task와 Codex 세션을 자동 연결하지 않는다.
2. **한 번의 명시적 실행만 수행한다.** 사용자의 버튼 클릭 또는 버튼에
   포커스된 상태의 Enter 입력이 있어야 재개 command를 만든다.
3. **원문을 자동 전송하지 않는다.** 추천 제목, first step, 새 prompt를
   Codex 세션에 자동 입력하지 않는다.
4. **허용된 operation만 실행한다.** 첫 계약은 `focus_or_resume`만 허용하며
   서버가 arbitrary shell command를 전달할 수 없다.
5. **local native locator를 저장하지 않는다.** native Codex thread ID,
   전체 local path와 최종 shell command는 registry, queue, API, log 또는
   Git에 저장하지 않는다.
6. **실패를 숨기지 않는다.** Companion offline, session missing, Codex
   missing, unsupported OS와 Terminal launch failure를 구분해 표시한다.
7. **실패 시 자동 재시도하지 않는다.** command는 짧은 만료 시간을 가지며
   사용자가 다시 실행해야 한다.

## 3. 역할 분리

### Work Cockpit

- 현재 top suggestion과 Codex overview를 보여준다.
- 사용자가 재개할 Codex 세션을 직접 선택하게 한다.
- active binding이 있을 때만 재개 버튼을 보여준다.
- Companion 상태와 마지막 command 결과를 사용자 문구로 표시한다.

### Next.js local API

- local request와 same-origin mutation만 허용한다.
- task/session binding과 제거 결정을 private local registry에 기록한다.
- Companion이 online일 때만 bounded command를 queue한다.
- raw native locator나 shell command를 API 응답에 포함하지 않는다.

### Local Companion

- private local queue를 polling하고 heartbeat를 기록한다.
- pending command를 atomic claim한다.
- opaque Codex execution ID를 실행 직전에 App Server 목록과 대조한다.
- active binding, scope와 Codex connection generation을 다시 검증한다.
- local loopback App Server process와 observation connection을 소유하고 해당
  thread를 subscribe한다.
- fixed Terminal adapter로 같은 App Server의 remote TUI를 focus 또는 resume한다.
- 완료 상태에는 sanitized result code만 기록한다.

### Codex App Server와 CLI

- App Server의 `thread/list`는 opaque execution ID에 해당하는 native
  thread와 작업 경로를 실행 순간에만 찾는 데 사용한다.
- Companion-owned App Server의 `thread/resume`은 explicit binding의 thread를
  observation connection에 subscribe하는 데 사용한다.
- CLI의
  `codex resume --remote ws://127.0.0.1:<port> <thread-id>`는 같은 local App
  Server에서 기존 대화 맥락을 가진 interactive session을 여는 데만 사용한다.
- observation connection은 prompt를 보내거나 approval/user-input server
  request에 응답하지 않는다.

## 4. Binding 계약

binding identity는 다음 값으로 결정한다.

```text
task source + stable task subject ID + opaque Codex execution ID
```

- volatile candidate ID와 표시 제목은 identity로 사용하지 않는다.
- 제목은 UI 요청 검증에만 사용하고 binding registry에는 저장하지 않는다.
  persisted/public binding은 `kind`, `source`, stable `subjectId`만 보존한다.
- binding 생성과 제거는 `explicit_user` 결정만 허용한다.
- 제거는 과거 record를 덮어쓰지 않고 현재 active decision을 supersede한다.
- Codex `scopeId`는 private binding에만 보존하고 API의 public binding에서는
  제거한다.
- initial UI는 GitHub top suggestion을 지원하지만 계약은 Codex, Notion,
  manual attention subject로 확장할 수 있다.
- 새 GitHub binding은 persisted decision을 만들기 전에 현재 stored GitHub
  snapshot의 exact `github:object:<native id>`와 대조한다. 제목, URL 또는
  repository 유사성으로 대체 identity를 찾지 않는다.
- GitHub snapshot이 이후 해당 object를 관찰하지 못해도 기존 binding을 완료로
  해석하거나 삭제하지 않는다. relation projection에서 `not_observed` 또는
  `unavailable`로 보존한다.

## 5. Command 상태

```text
requested
  ├─ Companion offline → rejected, queue 없음
  └─ Companion online → pending
                         ├─ claimed → completed
                         ├─ claimed → failed
                         └─ TTL 경과 → expired
```

- 같은 사용자 동작의 중복 제출은 하나의 command ID로 추적한다.
- command에는 `focus_or_resume`, binding ID, opaque execution ID, 요청 시각과
  만료 시각, opaque connection generation만 포함한다.
- command 결과는 fixed reason code를 사용하고 provider error, native ID,
  local path와 command text를 보존하지 않는다.
- claim의 최종 유효성 확인부터 Terminal 실행과 결과 저장까지 동일한
  filesystem execution lease를 유지한다. unbind, disconnect와 status expiry는
  이 lease 앞이나 뒤에만 직렬화되므로 실행 중간에 command를 덮어쓰지 않는다.
- queue launch가 같은 lease 안에서 managed manager를 호출할 때는
  `callerHoldsOwnershipLease` 경로를 사용해 동일 filesystem lease를 중첩
  획득하지 않는다. lease 밖의 manager 호출은 ownership lease를 직접 획득한다.
- execution/state lease는 5초마다 갱신하고 token, device, inode와 owner PID가
  최초 소유자와 같은지 확인한다. 살아 있는 owner PID의 lease는 오래되어
  보이더라도 takeover하지 않으며, stale 삭제 직전 두 번 ownership을
  재확인한다. 갱신 또는 종료 시 소유권 변경을 발견하면 fail closed한다. 이 보장은 하나의
  local filesystem을 공유하는 beta 범위에 한정하며 distributed/device 간
  fencing을 제공하지 않는다. artifact mutation에도 같은 경계를 적용한다.
- Companion이 Terminal 실행 결과를 기록하기 전에 비정상 종료하면 자동
  재실행하지 않고 `LAUNCH_OUTCOME_UNKNOWN` terminal failure로 닫는다. 사용자는
  Terminal을 확인한 뒤에만 새 명시적 실행을 만들 수 있다.

## 6. Terminal 안전 경계

macOS Terminal adapter는 다음 고정 template만 만들 수 있다.

```text
cd <resolved-cwd> && exec <resolved-codex-binary> resume \
  --remote ws://127.0.0.1:<port> <resolved-thread-id>
```

- `cwd`는 선택된 Codex scope의 absolute path여야 한다.
- binary는 기존 Codex binary resolver가 확인한 executable이어야 한다.
- native thread ID는 control character와 shell metacharacter를 거부한다.
- remote endpoint는 `ws://127.0.0.1:<1..65535>`만 허용한다.
- child process는 `shell: false`로 AppleScript에 argument를 전달한다.
- shell argument는 POSIX quoting을 적용하고 interpolated AppleScript source로
  전달하지 않는다.
- Companion이 전에 연 Terminal window만 ID로 추적하며, 존재할 때는 새
  command를 입력하지 않고 focus만 한다.

## 7. 저장과 개인정보

모든 runtime state는 Git에서 제외된 `.local/work-resumption/` 아래에 둔다.

- directory mode: `0700`
- file mode: `0600`
- binding registry: task display metadata와 opaque execution ID
- command queue/result: bounded metadata와 sanitized code
- heartbeat: process availability와 시각

terminal command/result는 `work-resumption-command-retention-v1`에 따라 완료,
실패 또는 만료 뒤 7일 동안만 보관하고 다음 status 조회에서 제거한다. active
binding과 binding 감사 이력은 사용자가 unbind하거나 Codex 연결을 해제할 때까지
보관하며, Codex 연결 해제는 queued/claimed command보다 먼저 Work Resumption
상태를 폐기한다. connector deletion과 이 cleanup은 같은 filesystem state
lease 안에서 수행한다. bind 역시 그 lease 안에서 current Codex snapshot과
connection을 다시 확인하므로 disconnect 전의 stale resolution을 나중에
저장하지 않는다.

Companion이 연 Terminal window ID는 현재 Companion process memory에만 두고
재시작 뒤 복원하지 않는다.

native Codex thread ID, 전체 작업 경로, prompt/answer, shell command와
Terminal output은 이 store에 저장하지 않는다. production conversation이나
binding/command 기록을 Golden 또는 Regression data로 자동 승격하지 않는다.

daemon이 시작한 managed run의 sanitized event metadata는 별도
`.local/connectors/codex/managed/` store에 최대 30일, run별 최대 10,000
events로 보존한다. raw prompt/answer/command/output/diff/tool arguments/results,
native thread ID와 cwd는 이 managed store에도 저장하지 않는다. 정확한
authority, event, projection과 retention 경계는
`MANAGED_CODEX_RUN_CONTRACT.md`를 따른다.

heartbeat에는 공개하지 않는 random Companion instance ID를 포함한다. fresh한
다른 instance가 있으면 두 번째 Companion은 ownership을 덮어쓰지 않고
종료하며, 종료 시에도 자신의 heartbeat만 compare-and-clear한다.

## 8. 첫 release 제한

- macOS Terminal만 지원한다. iTerm, VS Code terminal과 다른 OS는 후속
  adapter다.
- Work Cockpit의 현재 top suggestion만 binding UI를 제공한다.
- 기존 외부 Codex 세션은 historical context로 표시할 수 있지만, 사용자가
  직접 binding한 경우에만 재개할 수 있다.
- 현재 실행 중인 Companion이 시작한 Terminal focus는 best-effort다. 창을
  사용자가 닫았거나, Codex process가 끝났거나, Companion이 재시작되어
  식별할 수 없으면 새 Terminal에서 같은 session을 resume한다.
- 다른 Codex client가 이미 열어둔 세션의 Terminal window를 신뢰성 있게
  식별하거나 focus하지 못한다. inventory `active`를 다른 client의 live
  ownership 증거로 사용하지 않으며, 같은 세션의 동시 재개를 자동 조정하지
  않는다.
- Phase 2B.1은 daemon이 이 흐름으로 시작한 run의 managed live event를 관찰
  전용 UI에 표시한다. 기존 외부 session은 계속 historical/inventory context다.
- managed public liveness는 fresh Companion owner와 현재 binding ID, execution
  ID, scope ID, connection generation의 exact authority를 함께 요구한다.
  unbind 또는 generation 변경 시 manager는 best-effort `run_closed`를 기록하고,
  기록 실패와 무관하게 public projection은 fail closed한다.
- managed progress는 Attention input, candidate, hash, filtering, ordering 또는
  ranking에 사용하지 않는다. stall/failure detector, workflow follow-through와
  autonomous execution은 구현하지 않는다.
- local App Server WebSocket/remote TUI transport는 experimental beta이며
  loopback 밖의 endpoint는 지원하지 않는다.
- 첫 release는 active Companion 한 개만 허용한다. stale heartbeat takeover는
  허용하지만 여러 Companion 사이의 Terminal window ownership 이전은 하지
  않는다.

## 9. 완료 조건

- explicit confirmation 없는 binding 생성/제거가 거부된다.
- Companion offline이면 command file을 만들지 않는다.
- queue는 허용된 operation 외 payload를 schema 단계에서 거부한다.
- opaque execution이 현재 선택 범위에서 resolve되지 않으면 Terminal을 열지
  않고 typed failure를 반환한다.
- API와 persisted command/result에 native thread ID, local cwd와 shell
  command가 나타나지 않는다.
- 버튼은 pointer와 keyboard Enter 양쪽에서 같은 explicit action을 만든다.
- action은 prompt 전송, 승인 자동 처리, 자동 재시도 또는 GitHub mutation을
  수행하지 않는다.
- 새 GitHub binding은 exact native object가 없거나 identity claim이 충돌하면
  persisted decision을 만들지 않고 typed failure를 반환한다.
- managed mode는 observation subscription을 Terminal launch 전에 만들고
  loopback remote endpoint만 TUI에 전달한다.
- API가 Work Resumption state lease 안에서 exact authority와 managed
  projection을 함께 읽어 unbind/disconnect TOCTOU를 막는다.
- raw Codex content 없이 bounded lifecycle metadata만 저장하고 모든 public
  managed projection은 `forbiddenAsAttentionCandidate=true`다.
- domain, store, route, resolver와 launcher가 합성 fixture로 회귀 테스트된다.
- typecheck, lint, unit test와 production build가 통과한다.
