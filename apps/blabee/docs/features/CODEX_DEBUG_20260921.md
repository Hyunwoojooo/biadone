# Blabee Codex 디버깅 — 2026-09-21

요청 범위는 Codex Plugin·Hook·MCP·queue·승인·관리형 연결이다. 이전 빌드 금지와
Codex 전용 세션 책임을 유지했다. 시작 기준 commit은 `686bc9a`이며, 진행 중이던
다른 UI·패키징 변경은 수정하지 않았다.

## 설치 상태 확인

- 설치 앱은 build **63**, 내장 Plugin과 사용자 Plugin 캐시는 모두 **0.1.2**다.
- 소스·설치 앱·캐시의 Plugin manifest, Hook, MCP 설정과 launcher 네 파일의
  SHA-256이 각각 일치한다. 이전 build 62 보고서를 현재 설치 상태로 간주하지 않았다.
- 설치 Codex는 **0.155.1 / aarch64-apple-darwin**이며, 실행 파일 SHA-256은
  `8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e`다.
  앞서 검증한 공식 패키지 실행 파일과 일치한다. 이번 확인에서는 Codex를 실행하지 않았다.
- 설치 앱의 `codesign --verify --deep --strict` 검사도 통과했다. 처음 샌드박스 안에서는
  invalid signature가 반환됐지만, 승인된 샌드박스 밖 읽기 전용 검사에서는 exit 0이었다.
  앱 서명을 고치거나 다시 서명하지 않았다.

이 상태 확인은 파일 일치 증거이며, 실제 사용자 세션의 Hook·승인·queue 왕복 증거는 아니다.

## 수정: 실패한 native 검사의 관측값 유실

`CodexNativeDiagnostic.normalize`가 상세 실패를 오류 코드로 바꾸고,
`CodexPluginSetupManager`는 qualification에 성공한 객체에서만 버전과 경로를
보고서로 옮겼다. 따라서 실제 버전을 읽고 지원 목록에서 거부해도 결과가
`codex_native_version_unqualified`, `codex_version=unknown`이 됐다.

기존 검사에서 관측한 경로·숫자 버전을 실패 후보에 결합해 보존한다.
첫 후보와 후속 후보의 실패를 섞지 않고, timeout·보호 기록 실패·동시 실행 시
후속 후보 실행을 중단하는 기존 규칙도 유지한다. 진단을 위해 재실행하지 않는다.
원시 stdout/stderr·인증정보를 저장하지 않으며 공유용 경로 가림 규칙을 유지한다.
관측값은 실행 허가 객체와 별개이므로 실패한 검사가 Plugin 명령으로 진행하지 않는다.

수정 파일:

- `bridges/codex/swift/runtime/CodexNativeRuntime.swift`
- `bridges/codex/swift/setup/CodexPluginSetup.swift`
- 관련 `CodexNativeRuntimeTests`, `CodexPluginSetupTests`, `CodexPluginCheckReportTests`.

회귀 소스는 버전 거부, probe 전 실패, 잘못된 출력·실패 종료·signal,
여러 후보의 오류/관측값 결합, 즉시 중단 조건, 후속 후보 성공, 보고서 가림을 검사한다.
Swift 회귀는 빌드 금지로 실행하지 않았다.

## 수정: 해결된 관리형 승인 요청의 뒤늦은 전달

`ManagedCodexAppServerBridge`는 native `serverRequest/resolved` 알림을 TUI에만
전달하고 대기 중인 Pet 승인과 연결하지 않았다. 승인 A가 이미 해결됐어도 늦은
Pet 응답을 AppServer에 쓰거나, timeout 뒤 원문 A를 TUI에 다시 보낼 수 있었다.
실제 사용자 명령의 중복 실행을 확인한 것은 아니다.

대기 요청을 정확한 thread와 native request ID에 연결하고, 같은 connection의
resolved 알림이 전달보다 먼저 처리되면 해당 요청을 취소한다. 숫자 ID와 문자열 ID는
구별하며, 다른 thread나 잘못된 알림은 승인 취소 근거로 쓰지 않는다.

resolved 처리와 최종 응답·fallback 전송 사이에 순서를 확정하는 잠금을 두었다.
native resolved가 먼저인 경우 응답·fallback·전달 ACK를 억제한다. 반대로 응답 쓰기가
먼저 성공했다면 그 뒤 정상적으로 도착한 resolved가 해당 성공의 ACK를 없애지 않는다.
coordinator ACK 대기 중에는 전달 잠금을 잡지 않아 AppServer read loop가 진행된다.
stop은 대기 중 I/O를 끊을 수 있고 admission 해제는 기존 queue 종료 경로 한 곳에 둔다.

수정 파일:

- `bridges/codex/swift/runtime/ManagedCodexLauncher.swift`
- `Tests/swift/BlabeePetTests/ManagedCodexBrokerTests.swift`

늦은 allow와 timeout 재전달 억제, 다른 요청 보호, 숫자/문자열 ID 구별, 잘못된 thread,
중복 resolved/stop, 다음 요청 진행, 성공한 write의 ACK 보존과 ACK 대기 중 read loop를
회귀 소스에 추가했다. 이 Swift 회귀도 실행하지 않았다.

## 추가로 확인한 후속 문제

### 공통 선택 상태: Hook 완료 뒤 CLI 실패가 덮어씀

`app/coordination/CoordinatorOperationalApplication.swift`의 선택 경로에서
정확한 queued Hook가 transport와 claim을 먼저 확정한 뒤 CLI가 timeout/error로
종료하면 catch가 `.failed`를 기록하고 Pet에 오류를 반환할 수 있다.
전달 관측과 CLI receipt 미확인을 별도로 표현해야 한다. 이미 전달된 요청을
자동 재전송하거나 receipt ID를 만들어 성공으로 처리하면 안 된다.

재현할 회귀: 기존 `OperationalApplicationTests.swift`의 Hook-first fixture에서
dispatcher를 `suspendThenSucceed` 대신 `suspendThenFail`로 두고, CLI 실패를
해제하기 전에 정확한 queued Hook를 제출한다. Hook claim 뒤 최종 상태와 Pet 오류를
대조한다. **이번에는 정적 추적으로 확인했으며 실행 재현하지 않았다.**

### 공통 선택 상태: 사람 프롬프트가 끼면 receipt 순서에 의존

같은 파일에서 Hook-first 완료 권한은 `session.latestTurnID`의 진행 경계만 찾는다.
`선택 A → dispatcher 대기 → 같은 세션의 사람 프롬프트 B → A의 정확한 queued Hook`
순서이면 최신 turn이 B로 이동해 A 경계를 못 찾는다. CLI receipt가 아직 없으면
거부될 수 있지만 receipt가 먼저 오면 같은 A ref가 승인된다. 사람 프롬프트 처리에서는
이미 `.dispatched`인 A를 취소하지 않아 결과가 도착 순서에 의존한다.

재현할 회귀: 기존 Hook-first 테스트에 중간 사람 프롬프트를 넣고 receipt-first와
대조한다. 실제 thread·session·cwd·정확한 ref/digest·단일 claim 보호는 유지해야 한다.
**실행 재현 전 항목**이며 이번 버전 확장이 원인이라고 판단하지 않았다.

이 두 항목은 공통 의미·상태 처리 책임이므로 Engine 세션 인계 대상으로 남겼다.
이 세션에서 공통 Coordinator 또는 Pet 상태 코드를 변경하지 않았다.

### 업데이트 관리 세션의 앱 사본 누적

`UpdateManagedCodexSessions.prepare`는 세션별 `runtimes/<UUID>/Blabee.app`을 만든다.
정상 종료 후 `UpdateManagedCodexRegistry.remove`는 registry JSON만 제거하고,
runtime 앱 사본과 Terminal `.command`를 회수하는 경로는 없다. registry의 파일 수
제한은 `runtimes` 하위 항목을 세지 않아 반복 사용 시 사본 누적을 막지 못한다.

실제 사용자 디스크 점유량은 측정하지 않았다. 활성·일시 정지·종료 불확실 사본을
보존하고, 종료 증거·소유권·프로세스 incarnation·경로 identity를 확인하는 정리
정책이 필요하다. 이번에는 운영 사본을 조회하거나 삭제하지 않았다.

## 검증 경계

다음 빌드 없는 회귀는 **170 pass / 0 fail / 0 skip**이다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

이는 계약·Plugin launcher·격리 검사기 회귀다. 새 Swift 동작을 실행해 통과시킨
결과가 아니며, Swift 컴파일·회귀와 설치 앱의 실제 왕복 검증은 남아 있다.
빌드·패키징·서명·설치·commit·push는 하지 않았다. 실행 중인 앱·사용자 설정·
운영 DB·대화 세션도 변경하지 않았다.

검사 로그·변경 diff·입력 SHA 사본은 `build/codex-tests/debug-20260921/`에 있다.
이는 보고서 보관 경로이며 앱 빌드 산출물이 아니다. 원본 증거와 변경 전 사본은
`/private/tmp/blabee-codex-debug-cqoyrrgq/`에 있다.
