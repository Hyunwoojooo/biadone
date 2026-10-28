# Blabee 전체 디버깅 검토 — 2026-10-17

현재 작업 트리(`HEAD 97fa6a5` + 기존 미커밋 변경)를 대상으로 Engine, 공통 앱, Codex·Claude bridge, 업데이트·설치, 계정·피드백 경로를 검토했다. 설치 앱의 현재 버전이나 실제 업데이트 실패 순간은 이번에 조사하지 않았다.

**후속 작업:** 사용자의 요청으로 아래 1~5번에 소스 수정과 회귀 검사를 추가했다.
원래 진단의 관측과 수치는 그대로 남기며, 후속 수정 결과는 이 문서 끝에 별도로 기록한다.

**기존 격리 회귀 검사 1,709개가 통과했지만, 아래 7개 수정·보완 항목을 확인했다.** 이 숫자는 전체 제품 검증 완료를 뜻하지 않는다. 추가 진단 테스트가 기존 검사의 빈틈을 재현했다. 초기 진단에서는 제품 코드를 수정하지 않았으며, 진단용 테스트를 임시 적용했다가 원본 바이트로 복원했다.

## 우선순위

| 번호 | 항목 | 영향 | 확인 수준 |
| --- | --- | --- | --- |
| 1 | 실패한 claim의 재시도 정보가 업데이트를 계속 차단 | 세션을 정상 종료해도 업데이트 대기 가능 | 메모리 journal·가짜 전송기로 재현 |
| 2 | Claude 비정상 종료 후 남은 연결 기록의 복구 경로 부재 | 정상 종료 유도만으로 설치·업데이트 차단을 해소할 수 없음 | 소스 + 기존 임시 저장소 테스트 통과 |
| 3 | 표시용 프롬프트 크기 검사가 선택 저장보다 늦음 | 일부 유효 카드가 선택된 뒤 Codex 전달 실패 | 실제 Swift 검증 경로로 재현 |
| 4 | 늦은 계정 상태 응답이 만료된 UI 사용권한을 다시 활성화 | 버튼은 활성화되지만 서비스가 실행을 거부 | 지연 응답·가짜 시계로 재현 |
| 5 | Claude MCP의 진단 출력 실패가 비정상 종료를 유발 | 제어된 연결 실패가 unhandled EPIPE 종료로 바뀜 | 격리 Node 자식 프로세스로 재현 |
| 6 | 전체 semantic replay의 중복 전수검색 | 이력이 늘 때 검증 비용 증가 | 소스 복잡도 + 순수 메모리 시간 측정 |
| 7 | 피드백 언어 정보가 앱 시작 시점에 고정 | 설정을 한국어로 바꿔도 영어로 기록 | 메모리 피드백 서비스로 재현 |

1·2번을 업데이트 복구 작업으로 먼저 처리하고, 3~5번 기능 결함, 6번 성능 개선, 7번 기록 정확성 순으로 진행하는 것을 권장한다. 1번과 2번은 서로 다른 원인이다. **사용자가 겪은 r83→r84 업데이트 실패가 이 두 원인 중 하나였다는 증거는 이번 검사에 없다.**

## 1. 실패한 claim의 복구 정보가 업데이트 대기로 남음

- 위치: `app/coordination/CoordinatorOperationalApplication.swift:700`, `:1577`, `:3251`, `:4427`.
- 업데이트 차단 위치: `app/update/AppUpdateTransitionPreflight.swift:69`.
- 조건: 유효 카드 선택 → 전송 완료 → `queued_action_context_claimed` 저장은 성공 → 응답 및 즉시 복구 읽기는 실패 → Hook이 더 이상 재시도하지 않음.
- 이후 전달 턴과 원래 턴의 Stop, 시간 처리, 같은 세션 등록을 해도 `pending_claim_responses=1`이 남았다. 나머지 대기 수는 모두 0이고 `ready=false`였다.
- 재현에서 dispatcher 호출은 1회, claim append도 1회로 유지됐다. 정리·조회 중 journal sequence는 증가하지 않았다. 실제 선택 작업을 실행하거나 재전송하지 않았다.

`pendingQueuedClaims`는 정확히 같은 시도의 재시도를 식별하기 위한 정보다. 실패 후에도 이 정보를 보존하는 것 자체는 필요하다. 문제는 **복구 자격 정보와 실제 진행 중인 응답 수를 같은 값으로 세는 것**이다. 현재 사용자 확인 종료 모드도 이 수를 차단 조건으로 유지한다.

새 일반 프롬프트의 성공 처리나 서비스 종료로 정보가 사라질 수 있으므로 절대 복구 불능은 아니다. 다만 사용자가 안내받은 “세션 종료 → 업데이트 재확인”만으로 끝나지 않는 상태다.

수정 방향: 실제 요청·응답 진행 상태와 재시도 자격을 분리한다. 정상 종료 확인 모드에서는 신규 진입 차단, 연결 해제, 실제 응답 종료, 권위 저장 상태 확인을 함께 만족할 때의 명시적 정리 규칙을 둔다. 단순 시간 초과로 claim을 삭제하거나 카운터를 무시하면 안 된다. 정확한 동일 턴 재시도, 단일 claim, 다른 턴·세션 거부를 보존해야 한다.

증거: `build/full-debug-20261017/engine/repro.patch`의 `operationalDebugAbandonedClaimBlocksUpdateAfterStop`. 결함 상태를 기대하는 특성화 검사이며 통과가 수정 완료를 뜻하지 않는다. 24시간 전진은 주입한 연속 시계에만 적용했으며, 실제 대기 시간이나 wall-clock 만료 검증으로 해석하지 않는다.

## 2. Claude 비정상 종료 기록을 복구할 수 없음

- 위치: `bridges/claude/swift/service/ClaudeRuntimePayloadUse.swift:5`, `:48`, `:64`, `:108`, `:152`; `ClaudeInstalledLauncher.swift:110`.
- 정상 `complete()`만 사용 기록을 제거한다. owner가 갑자기 사라지면 유효한 잔여 기록은 `.inUse`, 등록 도중 남은 `.registering-*`는 `.unavailable`로 유지된다.
- 기존 `ClaudeRuntimePayloadUseTests.persistentUses`, `updateInspectionRetainsGenerations`, `invalidUseRecord`가 이를 의도적으로 확인하며 이번 격리 실행에서도 통과했다.
- 새 세션을 정상 종료해도 과거 owner가 가진 기록은 해제되지 않는다. 중간 등록 기록은 다른 정상 owner의 `complete()`도 막을 수 있다.

알 수 없는 사용 상태에서 교체를 막는 것은 필요한 안전 규칙이다. 누락된 부분은 비정상 종료·이전 부팅에서 남은 기록의 지원 가능한 복구 절차다. 현재 메시지는 연결 상태 복구 필요성을 언급하지만 실제 복구 기능이 없다.

수정 방향: 일반 “세션을 종료하고 기다리기”와 “기록 복구 필요”를 구별한다. 자동 복구는 신뢰할 수 있는 부팅·세대 정보, 배타적 진입 차단, 살아 있는 자식·보조 프로세스의 사용 여부를 근거로 설계해야 한다. PID가 안 보인다는 이유만으로 기록을 삭제하면 안 된다. 그런 증거가 없는 구형 기록은 별도 명시적 복구 절차가 필요하다.

실제 앱을 강제 종료하거나 재부팅해서 재현하지 않았다. 기존 안전 설계의 복구 기능 공백이며, 새 코드가 만든 회귀라고 단정하지 않는다.

## 3. 카드 선택 저장 후 표시용 프롬프트 생성 실패

- 위치: `app/coordination/CoordinatorOperationalApplication.swift:3671`, `:3714`; `bridges/codex/swift/core/QueuedPromptEnvelope.swift:49`, `:71`.
- `constraints`에 U+200D 8,192개 문자열을 두 개 넣은 합성 action은 Swift JSON 기준 **49,318바이트**였다. 카드 생성·의미 검증을 통과했다.
- 표시할 때 보이지 않는 문자를 escape로 늘리는 과정에서 131,072바이트 상한을 초과하여 `message(...)`가 nil을 반환했다.
- 선택 요청은 `queued_prompt_preview_invalid`로 실패했다. 그 전에 journal에 `decision_selection_claimed`, `continuation_dispatched`가 저장돼 있었다. `continuation_consumed`는 없고 dispatcher 호출은 0회였다.

이는 매우 많은 특수문자가 있는 경계값 사례다. 일반 카드 전체가 실패한다는 뜻은 아니다. 전송되지 않은 작업을 실행한 것으로 기록한 것도 아니다. 다만 사용자에게 선택 가능하게 보여준 카드를 선택 저장 후 전달할 수 없게 된다.

수정 방향: 카드 등록 시 전체 표시 프롬프트의 생성 가능성을 확인하고, 기존 카드에 대해서도 durable 선택 변경 전에 다시 확인한다. 제약을 임의로 잘라 전달하거나 표시 내용을 실행 권한으로 삼지 않는다.

증거: `build/full-debug-20261017/codex/repro.patch`, `swift-diagnostic-probes-confirmed.log`. 메모리 journal에서 실제 의미 처리·append 경계를 검사했으며 SQLite/fsync 내구성 시험은 아니다. 최초 진단의 잘못된 이벤트명 `selection_claimed`는 테스트 오류로 수정했고 재실행에서 통과했다.

## 4. 늦게 수신한 계정 상태로 UI 만료가 연장됨

- 위치: `app/account/PetAccessController.swift:182`, `:233`, `:276`; `app/account/ProductAccess.swift:160`.
- 서비스는 응답을 만들 때 남은 시간을 계산한다. UI는 응답을 받은 시각에 그 남은 시간을 다시 더한다.
- 남은 시간 1초인 응답을 만든 뒤 주입한 시계로 1.5초 지연시켰다. 수신 전에는 `allowsActions=false`였지만 수신 후 **`allowsActions=true`, `remaining=1`**로 돌아왔다.
- 1.5초는 기본 요청 응답 대기 2초보다 작다. 이 검사는 실제 sleep 대신 가짜 시계를 사용했다.

서비스의 권위 만료 검사는 유지되므로 실제 권한 우회는 아니다. 사용자는 활성화된 버튼을 눌러도 만료 오류를 받는 상태다.

수정 방향: 요청 시작 시각과 응답 경과 시간을 반영하고 남은 시간의 정수 올림 오차도 고려해 UI 마감 시각을 보수적으로 계산한다. 늦은 응답이 이전 만료를 무조건 새 허용으로 바꾸지 않게 한다. 사용자·서비스 세대·revision 검증은 유지한다.

증거: `build/full-debug-20261017/app-repro.patch`의 `delayedStatusMustNotExtendGrant`. 기대 동작 검사의 마지막 두 assertion이 실패해 결함을 재현했다.

## 5. Claude MCP의 stderr 오류가 프로세스를 비정상 종료

- 위치: `bridges/claude/src/session-v2-mcp.mjs:222`, `:273`, `:282`, `:306`.
- stdout과 달리 진단용 `errorOutput.write`에는 비동기 오류 처리가 없다.
- 같은 bootstrap 실패를 주입한 두 격리 프로세스에서 정상 stderr는 exit 0, EPIPE stderr는 처리되지 않은 오류로 exit 1이었다.
- 두 경우 모두 논리적 종료 Promise는 먼저 `{orderlyClosed:true,code:0}`를 내보냈다. 따라서 이 재현만으로 cleanup이 생략됐다고 단정하지 않는다.

수정 방향: 동기 throw와 나중에 발생하는 stream error/close를 모두 처리하는 진단 writer를 둔다. 진단 오류를 다시 진단하는 재귀나 반복 cleanup을 피하고, caller가 소유한 stderr를 임의로 파괴하지 않는다. 실제 등록된 bridge 정리 중 오류, 늦은 EPIPE, 이미 닫힌 stream도 회귀 검사에 포함한다.

증거: `build/full-debug-20261017/claude/repro-mcp-stderr-epipe.mjs`, `repro-mcp-stderr-epipe.jsonl`. 빈 환경·메모리 stream·가짜 bootstrap만 사용했으며 실제 Claude나 소켓을 연결하지 않았다.

## 6. 전체 replay 중 과거 boundary를 반복 검색

- 위치: `engine/semantic/CoordinatorSemanticState.swift:266`, `:541`; `engine/semantic/CoordinatorSemanticApplication.swift:172`.
- 닫힌 boundary도 검증 상태에 남고 과거 packet seal마다 `boundaries.values` 전체에서 충돌을 찾는다.
- N개의 정상 open/seal/close 이력을 전체 replay할 때 이 검색의 후보 방문 수는 소스상 `N(N+1)/2`다. 아래 후보 수는 **계산값이며 계측값이 아니다.**

| 완료 카드 수 | 이벤트 수 | 계산된 후보 수 | 최소 / 중앙 / 최대 replay ms |
| --- | --- | --- | --- |
| 100 | 300 | 5,050 | 70.121 / 70.842 / 74.253 |
| 200 | 600 | 20,100 | 153.635 / 154.153 / 156.787 |
| 400 | 1,200 | 80,200 | 364.380 / 365.602 / 367.883 |

각 크기에서 fixture 생성과 warmup을 제외하고 순수 메모리 replay 3회만 측정했다. SQLite I/O, Keychain, actor 대기, 실제 Hook 처리 시간은 포함되지 않는다. 작은 표본의 전체 시간에 선형 처리 비용도 섞여 있으므로 **전체 지연이 제곱으로 증가한다거나 설치 앱 과열·Hook 실패의 원인이라고 단정할 수 없다.**

수정 방향: 인증된 replay 상태 내부에 세션별 pending 인덱스를 유지한다. seal/reseal·선택·만료·닫힘에서 일관되게 갱신하고 CAS 충돌 시 폐기한다. MAC·freshness·head·sequence·외부 writer 변경 검증을 줄이지 않는다. 개선 전후에는 실제 후보 방문 횟수, replay 호출 수, 저장소 시간과 actor 대기 시간을 별도로 측정해야 한다.

증거: `build/full-debug-20261017/engine/repro.patch`의 `semanticDebugClosedPacketHistoryReplayScaling`, `swift-diagnostic-probes.log`.

## 7. 피드백에 시작 시점 언어가 전송됨

- 위치: `app/telemetry/PetFeedback.swift:301`, `:318`, `:369`; `PetProductMetrics.swift:61`.
- controller 생성 때 `.current` 환경을 고정하고 이후 모든 새 preview에 재사용한다.
- 영어 상태에서 controller 생성 → 한국어 설정 상태에서 새 피드백 작성·제출 시 현재 환경은 ko인데 payload와 `p_ui_language`는 en이었다.

수정 방향: 새 preview 작성 시점에 환경을 조회한다. 이미 사용자가 검토한 preview와 불확실한 전송의 동일 요청 재시도는 기존 payload를 유지해야 한다.

증거: `build/full-debug-20261017/app-repro.patch`의 `newFeedbackUsesCurrentLanguage`. 메모리 서비스·고정 시각·TaskLocal 언어를 사용했고 실사용 언어 설정이나 DB를 바꾸지 않았다. 두 기대 assertion이 실패했다.

## 실행한 검사

| 범위 | 결과 | 로그 |
| --- | --- | --- |
| Swift 공통 Engine·운영 애플리케이션 | 312 통과 | `swift-engine.log` |
| Swift 앱·계정·업데이트·연결·신뢰·UI 선택 검사 | 876 통과 | `swift-app.log` |
| Node 계약·참조 Engine·Codex·Cloud SQL | 264 통과 | `node-core-contracts.log` |
| Claude bridge Node | 157 통과 | `claude-tests-unsandboxed.log` |
| 계정 웹 Node | 100 통과 | `account-tests.log` |
| 계정 웹 typecheck | 통과 | `account-typecheck.log` |
| Claude JS syntax | 53파일 통과 | `claude-check.log` |

로그는 모두 `build/full-debug-20261017/` 아래에 있다. App 필터가 Engine 검사 4개도 다시 실행했으므로 위 합계 1,709에서는 중복 4개를 제외했다. 파라미터별 case 수와 테스트 함수 수는 같은 단위가 아니다.

추가 진단은 별도 결과다. claim 잔여 상태·preview overflow·replay 측정은 관측한 결함 상태를 기대하는 검사로 통과했다. UI 만료·피드백 언어는 기대하는 정상 동작을 검사하여 2개 테스트/4개 assertion이 실패했다. 최종 묶음의 exit 1은 이 두 결함 재현 때문이며 기존 검사 실패와 혼동하지 않는다.

Claude Node 검사의 최초 실행은 sandbox가 임시 Unix socket 생성을 거부하여 38개가 EPERM으로 실패했다. 격리 경로를 확인한 뒤 권한 있는 실행으로 전체 157개가 통과했다. 이를 제품 회귀로 세지 않았다. Swift 테스트는 프로젝트의 `npm run test:swift` 잠금·직렬 wrapper를 유지했다.

실행 명령과 필터는 `node-results.json`, `swift-app-result.json`, `swift-diagnostic-results.json`, `swift-diagnostic-results-confirmed.json`에 남겼다. Engine 명령은 다음과 같다.

```sh
npm run test:swift -- --filter CoordinatorSwiftTests --skip 'keychainFreshnessStoreIntegration|missingStorageKeychainRecoveryArchivesUniqueTestItem'
```

## 변경·격리·남은 확인

- 초기 진단의 영구 변경은 이 보고서뿐이다. 진단 패치·실행기·로그는 `build/full-debug-20261017/`에 보관했다.
- 임시 적용한 테스트 4개 파일은 기존 미커밋 내용까지 원본 바이트로 복원했다. 원본·복원 SHA-256을 `swift-diagnostic-results-confirmed.json`에 기록했다. 원래 진행 중이던 업데이트 창·UI·프롬프트·설치 경로 변경은 보존했다.
- 실제 운영 앱·서비스 재시작, 사용자 Codex·Claude 세션 조작, 과거 ref 재전송, 운영 DB·Keychain·인증정보 변경은 하지 않았다.
- Swift 테스트용 컴파일은 수행했다. 새 배포 앱·DMG 생성, 서명·공증, 설치, Git commit·push는 하지 않았다.
- 실제 Keychain 검사, 설치 제품 바이너리 검사, 실제 계정 로그인·중지/복원, 실제 모델 전달·실행·완료, 새 Mac 설치, 배포본 업데이트·rollback은 실행하지 않았다.
- Engine MAC·freshness·단일 claim·세션 바인딩 우회는 이번 검토 범위에서 발견하지 못했다. 전체 제품에 결함이 없다는 증명은 아니다.
- product access enforcement가 활성화된 실제 서비스의 재시작 후 과거 claim 복구는 로컬 접근 세대 검증을 거친다. access gate 없는 fixture의 restart 성공을 실제 제품의 무조건 복구 가능성으로 확대하지 않는다.

수정 후에는 격리 회귀를 먼저 통과시키고, 별도 테스트 환경에서 실제 “진행 중 세션 확인 → 정상 종료 → Blabee 종료·교체·재실행”을 확인해야 한다. 실제 계정·설치 제품을 사용하는 검증이나 배포는 별도 범위로 진행한다.

## 후속 수정 — 1·2번

사용자의 요청으로 1·2번을 수정했다. 3~7번은 이 후속 수정 범위에 포함하지 않았다.
이 결과도 실제 r83→r84 실패 원인을 소급 확정하는 증거는 아니다.

### 수정 내용

1. **claim 재시도 정보와 전송 중인 응답 분리.** `queuedClaimRetries`는 정확한 재시도에
   계속 사용하지만 업데이트 카운터로 세지 않는다. 소켓 서버가 실제 응답의 수명을
   추적하고, 결과·오류 전송 및 연결 종료까지 admission을 유지한다. 실패 후 Stop을
   받은 상태는 준비 완료로 돌아오고, 정확한 재시도는 기존 claim 하나로 복구된다.
   권위 읽기 실패는 준비 완료로 표시하지 않는다.
2. **Claude 잔여 기록의 복구 경로.** 새 사용 기록에 커널 부팅 ID를 저장하고, 이전
   부팅이 입증된 기록만 배타적 admission 아래에서 정리한다. 구형 기록에는 명시적인
   준비 → Mac 재시동 → 정확한 파일 재검증 절차를 둔다. 업데이트 창과 DMG 설치 창에
   ‘연결 복구 준비’를 추가했다. 재설치에서 첫 transition 검사로 막히는 경우도 포함한다.
   취소와 늦은 응답은 세대 검사로 차단하며 설치·재시동을 자동 실행하지 않는다.

현재 부팅에서 owner/PID가 사라졌다는 이유로 기록을 지우지 않는다. 복구 마커의
대상·디렉터리가 달라지면 자동 복구를 거부하며, 명시적인 재준비는 현재 유효한 기록을
다시 고정하고 추가 재시동을 요구한다. 잘못된 마커·이름·링크·권한은 여전히 거부한다.
정상 owner의 완료 처리는 자기 파일만 검증하므로 무관한 중간 등록 기록에 막히지 않는다.

### 수정 파일

- 공통 상태·전송: `app/coordination/CoordinatorOperationalApplication.swift`,
  `app/service/UnixDomainSocketTransport.swift`.
- Claude 기록: `bridges/claude/swift/service/ClaudeRuntimePayloadUse.swift`.
- 업데이트·설치: `app/update/AppUpdateTransitionPreflight.swift`, `AppInstallation.swift`,
  `AppUpdateTransaction.swift`, `AppInstallationUI.swift`, `PetAppUpdateWindow.swift`,
  `PetAutomaticAppUpdateView.swift`.
- 회귀 검사: `Tests/swift/CoordinatorSwiftTests/OperationalApplicationTests.swift`,
  `Tests/swift/BlabeePetTests/AppUpdateAdmissionTests.swift`, `AppUpdateAdmissionTransportTests.swift`,
  `ClaudeRuntimePayloadUseTests.swift`, 새 `ClaudeRuntimePayloadRecoveryTests.swift`,
  `PetAppUpdateWindowTests.swift`, `AppInstallationFlowTests.swift`.
- 사용 절차: `docs/AUTOMATIC_UPDATES.md`와 이 보고서. 기존 다른 작업자의 변경은 유지했다.

### 검증 결과와 한계

| 최종 소스 검사 | 결과 | 로그 |
| --- | --- | --- |
| 업데이트·설치·Claude 기록·claim 집중 회귀 | Swift 러너 기준 278개 성공 | `final-focused.log` |
| 공통 Engine 전체 격리 회귀 | Swift 러너 기준 313개 성공 | `engine.log` |
| 정적 검토·공백 검사 | 차단 수준 문제 없음, `git diff --check` 통과 | 소스와 리뷰 |

로그와 정확한 명령·실행 시간은 `build/update-recovery-20261017/`의 동명 `.json`에 있다.
두 실행은 일부 검사가 겹치므로 합산하지 않는다. 첫 집중 검사 276개 성공 후 정적 리뷰에서
재설치의 복구 UI 누락을 발견해 보완했고, 최종 집중 검사로 다시 확인했다.

느린 결과·오류 전송, 전송 실패 후 카운터 해제, admission 충돌, 단일 claim과 동일 재시도,
새 부팅/같은 부팅, 구형 기록, 파일 변조·교체·링크, 중간 쓰기·정리 중단, 새 기록 보존,
UI 중복 클릭·닫기·늦은 응답·재설치 검사 순서를 포함한다. 영어/한국어의 화면 크기·렌더
검사도 실행했지만 실제 사용자 창·키보드·VoiceOver 조작을 검증한 것은 아니다.

실제 패키지 payload 선택 검사는 fixture 조건이 없어 건너뛰었고, 대용량 벤치마크 2개와
운영 Keychain을 사용하는 검사 2개는 실행하지 않았다. 시간 측정 성능 개선을 주장하지 않는다.
Swift 테스트용 컴파일만 수행했으며 배포용 앱/DMG 생성·서명·공증·설치·운영 앱 재시작·
사용자 세션/DB/인증정보 변경·commit·push는 하지 않았다.

남은 실사용 확인은 별도 테스트 환경에서의 **실제 재부팅 후 파일 식별자 검증**, 구형
서명 앱에서 새 DMG 복구 UI로 전환, 정상 종료 → 교체 → 새 Blabee 재실행이다.
구형 실행 서비스·launcher에는 새 코드가 소급 적용되지 않는다. 특히 구형 launcher는
새 v2/복구 파일을 알지 못하므로 첫 전환은 정상 종료 또는 안내된 복구 준비와 Mac 재시동이
필요할 수 있다. 손상된 공개 마커나 알 수 없는 파일은 자동 삭제 대상이 아니다.

## 후속 수정 — 3번

최종 표시 프롬프트의 크기 검사를 **카드 등록 전**과 **선택 저장 전**으로 옮겼다.
4~7번은 이번 수정에 포함하지 않았다.

- 신규 제안은 정확한 세션·토큰·프롬프트·secret 검증 후 모든 옵션에 실제 생성기를
  적용한다. 전체 NFC UTF-8 문자열이 131,072바이트를 초과하면 공통 reconciliation,
  등록, journal 쓰기 전에 거부한다. 원본 action JSON의 60,000바이트 제한도 유지한다.
- 선택에서는 packet에 저장된 정확한 action과 실제 continuation ref로 전달문을 먼저
  생성한다. 크기·known secret 검사 실패 시 `routeSelection`을 호출하지 않는다.
  라우팅 이후 반환된 effect의 binding·ID·revision·action을 대조하고 같은 전달문을
  재사용한다. 내용 절단, 상한 확대, ref-only 우회 전달은 추가하지 않았다.
- MCP 오류 `decision_preview_too_large`는 내용을 고친 제안을 제출할 수 있게 안내한다.
  미확인 acceptance와 자동 재시도를 구별하며, 같은 요청의 자동 반복은 안내하지 않는다.
  앱은 영어·한국어로 내용이 너무 길다는 이유와 새 카드 요청 방법을 표시한다.
- 크기 초과로 거부된 동일 proposal ID는 고쳐서 새로 등록할 수 있다. 이미 등록된 제안의
  정확한 재시도와 digest/context 충돌 규칙, MAC·freshness·세션·단일 claim 검증은 유지한다.

수정 파일은 `app/coordination/CoordinatorOperationalApplication.swift`, `PetViewModel.swift`,
`bridges/codex/swift/core/QueuedPromptEnvelope.swift`, `bridges/codex/swift/hooks/OperationalCLI.swift`,
`Tests/swift/CoordinatorSwiftTests/OperationalApplicationTests.swift`,
`Tests/swift/BlabeePetTests/PetSelectionDeliveryTests.swift`, 새 `QueuedPromptEnvelopeTests.swift`·
`EmitDecisionFailureTests.swift`, `docs/features/QUEUED_HOOK_ORDERING.md`와 이 보고서다.

구형 oversized packet 회귀는 실제 의미 계층에 저장한 packet에 제품의 동일 preflight를
적용하는 gate 단위 검사다. 운영 actor에는 기존 pending packet의 hydration 진입점이
없어 전체 actor의 legacy 카드 복원 검사를 대신하지 않는다. 신규 제안의 등록 거절,
새로 학습한 secret의 선택 전 거절, 정상 Unicode·emoji·여러 줄의 선택→Hook claim은
전체 actor 경로로 검사한다.

후속 Swift 검증 결과:

| 범위 | 결과 | 로그 |
| --- | --- | --- |
| Engine·운영 앱 격리 회귀 | 316개 성공 | `regression.log` 첫 Swift Testing 실행 |
| 표시문·MCP 오류·앱 안내·기존 Hook/queue 회귀 | 51개 성공 | `regression.log` 두 번째 Swift Testing 실행 |
| pending reconciliation을 포함한 최종 preflight 검사 | 5개 성공 | `admission-ordering.log` |

로그와 정확한 명령은 `build/queued-preview-preflight-20261017/`에 있다. 마지막 5개 중
4개는 앞선 실행과 겹치므로 합산하지 않는다. 상한 직전·정확한 상한·1바이트 초과,
raw JSON은 유효하지만 escape 후 초과하는 사례, 옵션 4개 위치 × 문자 유형 2종을 확인했다.
복구 가능한 activation을 일부러 남기고 cooldown을 해제한 뒤 초과 제안이 append를
발생시키지 않음을 확인했다. 이어 원래 정상 제안으로 복구를 실제 진행시켜, 앞선 무변경이
단순히 cooldown 때문이 아님도 검사했다.

`git diff --check` 통과. 저장소의 잠금·직렬 Swift wrapper를 유지했고 실제 Keychain 검사
2개와 선택적 대용량 벤치마크 2개는 실행하지 않았다. 새 패키지·DMG 빌드, 서명·공증·설치,
운영 앱/서비스 재시작, 실제 Codex 모델 실행·사용자 세션 조작, DB/인증정보 변경과
commit·push는 수행하지 않았다. 최종 배포 앱의 실제 카드 거절·정상 카드 전달 UI 확인은
새 빌드 이후 별도 확인 대상이다.

## 후속 수정 — 4·5번

사용자의 요청으로 UI 권한 만료와 Claude MCP 진단 출력 문제를 수정했다. 6·7번은
이번 수정에 포함하지 않았다.

### 4. 응답 지연이 UI 권한을 연장하지 않도록 수정

- `PetAccessController`는 요청을 보내기 직전의 단조시각을 저장한다. 유효한 active 응답은
  **요청 시작 + (remaining_seconds − 1)초**를 UI 만료 시각으로 사용한다. 서비스가 남은
  시간을 올림하므로 1초의 불확실성을 제외하며, 도착 시각에 TTL을 새로 더하지 않는다.
- 응답이 도착할 때 이미 기한이 지났다면 바로 `expired`로 게시한다. 초 미만의 로컬
  잔여 시간은 표시할 때 올림하여 불필요하게 두 번째 1초를 잃지 않는다.
- 시계 역행은 현재 캐시된 허가를 무효화하며 시간값이 복구되는 것만으로 되살리지 않는다.
  overflow는 차단한다. 새롭고 검증된 갱신은 기존 사용자·소유자·서비스 세대·revision·
  로그아웃 clear 장벽을 거쳐 허용한다. 서비스의 실제 권한 검사는 변경하지 않았다.
- 만료 타이머는 실제 남은 기간만 기다린다. 일찍 깨어나면 현재 deadline을 확인해 남은
  시간만 다시 기다린다. 계정/서비스 교체와 취소 이후의 오래된 타이머는 진행하지 않는다.

지연된 status/update/refresh, 남은 1초의 응답이 1.5초 뒤 도착하는 사례, 4초 응답이
1.25초 지연되어 1.75초만 남는 사례, 초 미만 마지막 기간, 정상 갱신, 시계 역행·overflow,
타이머의 조기 기상을 가짜 시계와 제어된 전송기/대기로 검사했다. 기존 사용자 전환·서비스
교체·clear ACK·동일 요청 재시도·단일 요청 검사도 통과했다.

### 5. 진단 stderr 오류가 MCP를 비정상 종료시키지 않도록 수정

- 기존 `session-v2-mcp.mjs` 안에 안전한 진단 writer를 추가해 초기 문맥/클라이언트 준비
  전에 설치한다. 정상 연결, 연결 실패, 정리, CLI 시작 실패 안내가 같은 writer를 쓴다.
- 동기 write 예외, callback 오류, 비동기 error/close/finish, 이미 종료된 stream과
  논리적 정리 이후 도착한 EPIPE를 처리한다. 오류나 backpressure 이후에는 진단 출력을
  중단하며 callback/drain을 기다리거나 같은 로그를 다시 쓰지 않는다.
- WeakMap으로 같은 stream에 하나의 작은 오류 guard만 유지한다. 반복된 runtime이
  진단 listener를 계속 추가하지 않고, guard는 session/runtime을 보관하지 않는다.
  caller 소유 stderr를 destroy/end/unref하거나 stdout으로 우회하지 않는다.
- 진단 출력 실패만으로 정상 MCP 연결을 닫지 않는다. 실제 연결·정리 실패는 원래
  단일 정리 경로와 결과 코드를 따른다. 실제 실패를 성공으로 바꾸거나 RPC/선택을 재전송하지 않는다.

새 Node 회귀 22개는 메모리 stream·가짜 client·빈 환경의 짧은 자식 프로세스만 사용한다.
실제 Writable의 callback EPIPE가 `runtime.closed` 이후 발생해도 처리되는지, CLI 시작
실패의 정상 exit 1을 보존하는지, 정상 연결이 로그 오류만으로 종료되지 않는지, 등록된
bridge가 한 번만 정리되는지 확인했다. 8개의 runtime이 같은 stderr를 재사용해도
listener가 하나씩만 유지되고 신호 정리 listener는 해제된다. callback을 호출하지 않는
진단 stream 검사에는 5초 제한을 둬 이후 회귀가 전체 검사를 무기한 붙잡지 않게 했다.

### 수정 파일과 검증

- 제품 코드: `app/account/PetAccessController.swift`, `bridges/claude/src/session-v2-mcp.mjs`.
- 회귀: `Tests/swift/BlabeePetTests/PetAccessControllerTests.swift`,
  새 `Tests/bridges/claude/session-v2-diagnostics.test.mjs`.
- 문서: `docs/features/PRODUCT_ACCESS.md`,
  `docs/bridges/claude/product-connection/PUBLIC_MCP_HOOK.md`, 이 보고서.

| 검사 | 결과 | 로그 |
| --- | --- | --- |
| Swift 공통 권한·기존 claim 경계 | 4개 성공 | `swift-regression.log` 첫 실행 |
| Swift UI 권한·서비스·선택 안내 회귀 | 78개 성공 | `swift-regression.log` 두 번째 실행 |
| Claude 전체 Node 회귀 | 179개 성공 | `claude-tests.log` |
| Claude JavaScript 문법 | 54파일 성공 | `claude-syntax.log` |
| 정적 리뷰·공백 검사 | 차단 수준 문제 없음, `git diff --check` 통과 | 소스/리뷰 |

로그는 `build/access-diagnostics-20261017/`에 있다. Swift의 정확한 명령은
`swift-regression.json`에 기록했다. Claude 명령은 bridge 디렉터리의 `npm test`와
`npm run check`다. 첫 Node 실행은 sandbox가 임시 Unix 소켓 생성을 거부해 38개가
EPERM으로 실패했다(`claude-tests-sandbox.log`). 격리 경로를 확인한 뒤 권한 있는
실행에서 179개가 모두 통과했으므로 이를 제품 회귀로 세지 않는다.

Swift 테스트용 컴파일만 수행했다. 실제 로그인·토큰·Keychain·운영 DB·사용자 세션·
설치 앱/서비스를 변경하지 않았고 배포용 빌드·서명·공증·설치·commit·push도 하지 않았다.
실제 Mac 잠자기/네트워크 지연에서의 UI 전환과 배포 앱의 Claude MCP 표준 스트림 수명은
별도 실사용 확인 대상이다. 새 생산 의존성이나 wire/schema 변경은 없다.

## 6번 수정 — 세션별 pending 인덱스로 과거 boundary 검색 제거

`CoordinatorSemanticState.assertSessionPendingSlotAvailable`의 전체 boundary 검색을
`[CoordinatorSessionKey: CoordinatorBindingKey]` 조회로 바꿨다. 프로젝트와 세션을 함께
구분하는 기존 typed key를 사용한다. 완료 이력은 그대로 보존하며, 인덱스에는 현재
pending인 세션의 소유자만 남는다. Codex 토큰 수집 기능은 추가하지 않았다.

- `boundaries`의 직접 쓰기를 막고 여덟 reducer 쓰기를 `storeBoundary`로 모았다.
  정상 seal/reseal은 소유자를 유지하고, 선택·명시적 만료·닫힘은 자신의 full key가
  소유한 항목만 제거한다. 오래된 미봉인 카드·선택 완료 카드의 늦은 닫힘이 새 대기
  카드의 소유권을 제거하지 않는다. 열림·repair·dispatch는 대기 권한을 새로 만들지 않는다.
- 벽시계가 지났다는 이유만으로 인덱스에서 제거하지 않는다. 검증된 expiry 이벤트가
  있어야 해제하며, 실제 선택 시각·revision·만료 검사는 기존대로 수행한다.
- 인덱스는 이벤트 replay로만 구성되는 private 파생 상태다. full/incremental 상태 복사와
  함께 이동하고, 실패한 suffix의 후보는 원본을 바꾸지 않는다. canonical 파생 값이므로
  합성 `Equatable`에 포함되어도 유효한 상태의 의미적 동등성은 유지된다.
- 요청 간 authority 캐시, SQLite 저장 schema, MAC·head/sequence·freshness·sidecar
  검증은 바꾸지 않았다. CAS 충돌 때 기존 projection을 버리고 journal을 다시 읽고
  replay하는 경로도 유지한다. 다른 writer가 같은 세션의 slot을 획득하거나 해제하는
  두 경우를 새 회귀 검사에 포함했다.

기존 내부 work observer에 데이터 없는 `sessionPendingSlotLookup` 관측을 추가했다.
생산 환경에서는 observer가 nil이며, 이 계수는 guard의 실제 dictionary 조회만 센다.
인덱스 유지 작업·저장소 scan·actor 대기·모델 토큰을 의미하지 않는다.

| 완료 카드 수 | 이벤트 수 | 이전 scan 후보 수(계산값) | 새 guard 조회 수(실측, 각 3회) |
| --- | --- | --- | --- |
| 100 | 300 | 5,050 | 100 / 100 / 100 |
| 200 | 600 | 20,100 | 200 / 200 / 200 |
| 400 | 1,200 | 80,200 | 400 / 400 / 400 |

같은 verified prefix 뒤의 open+seal 증분 처리에서는 이력 크기와 관계없이 guard 조회가
1회이며 full replay 호출은 0회다. 각 크기의 fixture 생성·warmup은 측정에서 제외했다.
시간은 full replay 함수 안의 wall time만 기록하며 테스트 합격 기준으로 사용하지 않는다.
문서/JSON 검증·hashing·completeness scan 등 다른 비용은 남으므로 전체 replay가 선형이거나
설치 앱의 지연·발열이 특정 비율로 줄었다고 주장하지 않는다. 이번 fixture는 이전 진단과
동일한 성능 비교용 바이너리가 아니므로 과거 시간과 개선율을 계산하지 않는다.

변경 파일:

- `engine/semantic/CoordinatorSemanticState.swift`
- `Tests/swift/CoordinatorSwiftTests/SemanticReplayTests.swift`
- `Tests/swift/CoordinatorSwiftTests/SemanticApplicationTests.swift`
- `Tests/swift/CoordinatorSwiftTests/SQLiteQueuedActionClaimTests.swift` — 기존 observer switch에
  새 metric을 처리하는 분기만 추가했다. 기존 저장소/replay 검증 횟수 기대값은 바꾸지 않았다.
- 이 보고서.

추가 회귀는 각 lifecycle prefix의 full/incremental 동등성과 기존 scan oracle,
프로젝트·세션 분리, reseal, 지원되는 세 선택 종류, 오래된 카드 닫힘,
조기/오래된 revision의 만료 거절, 명시적 만료 전 slot 보존, 중간에 유효한 상태 변경을
포함한 실패 suffix의 원본 보존, CAS 후 소유권 재검증과 실제 조회 횟수를 검사한다.
Rollback은 기존대로 비활성·미지원이며 이번 최적화를 위해 활성화하지 않았다.

검사 로그·정확한 명령·시간은 `build/pending-index-20261017/`에 보관한다.
첫 집중 실행은 compiler cache 쓰기에 대한 sandbox 제한으로 manifest 단계에서 중단되어
테스트가 실행되지 않았다(`swift-focused-sandbox.log`). 동일 잠금·직렬 wrapper의 권한 있는
재실행에서 집중 검사가 통과했다. 전체 Engine 결과는 같은 디렉터리의
`swift-engine.log`와 `swift-engine.json`에 기록한다.

| 검사 | 결과 |
| --- | --- |
| 전체 Engine 회귀 | Swift Testing 318개 + XCTest 14개 = 332개 통과 |
| 이력 100/200/400개 lookup 계측 | 각 3회 모두 예상 조회 수와 일치 |
| 기존 SQLite 검증·queued claim·동일 턴 복구·다른 턴 거절 | 전체 Engine 회귀에서 통과, 기존 횟수 기대값 유지 |
| 독립 소스/회귀 설계 리뷰 | 차단 수준 결함 없음 |
| 변경 파일 공백 검사 | `git diff --check` 통과 |

최종 실행의 pure replay 최소/중앙/최대는 100카드 49.329/49.426/49.477ms,
200카드 98.489/98.596/99.235ms, 400카드 198.243/198.506/198.746ms였다.
이는 진단 수치이며 제품 응답 시간의 보장이나 이전 바이너리 대비 개선율이 아니다.
표본과 한계는 `work-results.json`에 함께 기록했다. Package.swift의 unhandled-file 경고는
다른 작업의 로컬 생성물 때문에 남아 있으며 이번 수정 범위에서 정리하지 않았다.

Swift 테스트용 컴파일만 수행했다. 실제 Keychain 두 검사는 제외했으며, 임시 SQLite와
메모리 freshness authority를 사용했다. 설치 앱·운영 DB·사용자 세션은 변경하지 않았다.
배포 앱/DMG 빌드·서명·공증·설치·commit·push는 하지 않았다. 설치 제품에서 긴 이력으로
연속 선택·승인할 때의 응답성과 CPU/발열은 새 배포본에서 별도 확인 대상이다.
