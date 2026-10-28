# GitHub 업데이트와 연결 유지

## 2026-10-17: 남은 claim 재시도 정보와 Claude 연결 기록 복구

전체 디버깅의 1·2번에 해당하는 후속 수정이다. 정상적인 업데이트마다 Mac 재시동을
요구하는 기능은 아니다. 실패 후 남은 연결 기록 때문에 종료 확인을 반복해도 진행되지
않는 경우를 위한 복구 경로다.

- `queuedClaimRetries`는 정확한 전달 턴의 재시도 자격만 보관한다. 이것을 진행 중인
  응답으로 세지 않는다. 소켓 서버가 실제 `user_prompt_submit` 응답 소유자를 세어
  `pending_claim_responses`를 채우며, 결과·오류 전송과 소켓 종료까지 공유 admission을
  유지한다. 최종 교체는 배타적 admission을 획득한 뒤 재검사한다.
- 재시도 정보는 보존한다. 동일 ref·세션·전달 턴·프롬프트의 정확한 재시도만 같은
  durable claim으로 복구하고, 다른 턴·세션 및 권위 검증 실패는 계속 거부한다.
  Hook이 포기한 작업을 자동으로 재전송·실행하거나 claim을 시간만으로 삭제하지 않는다.
- 새 Claude 사용 기록(v2)은 커널의 `kern.bootsessionuuid`를 포함한다. 같은 부팅의
  사용 기록은 PID/부모 프로세스가 사라져도 남긴다. 새 부팅이 확인된 v2 기록만
  배타적 Claude admission 아래에서 정리하고 사용 기록을 다시 검사한다.
- 구형 v1 기록이나 등록 도중 중단된 기록은 업데이트 창 또는 DMG 설치 창의
  **연결 복구 준비**를 사용한다. 현재 부팅 ID와 대상 파일의 이름·device·inode·크기·
  SHA-256을 비공개 복구 기록에 저장하며 현재 사용 기록은 삭제하지 않는다.
  사용자는 작업을 저장하고 Mac을 재시동한 뒤 같은 앱/설치 창을 열어 다시 시도한다.
  준비 전에 이미 이전 부팅의 증거가 충분한 기록은 먼저 복구할 수 있다.
- 다음 부팅에서도 대상 또는 디렉터리가 바뀌었으면 자동 정리를 거부한다. 명시적으로
  복구를 다시 준비하면 현재 유효한 기록을 새로 고정하며 **다시 한 번 재시동해야**
  정리할 수 있다. 잘못된 파일·심볼릭 링크·하드 링크·권한·알 수 없는 부팅 ID는
  우회하지 않는다. 새로 생긴 연결 기록은 이전 준비 목록에 섞어 지우지 않는다.
- 복구 준비는 설치 시작이나 앱/세션 종료 동의가 아니다. 창 닫기는 늦은 응답과 설치
  진행을 차단하지만 이미 저장된 준비를 되돌리지는 않는다. Mac 재시동, Codex·Claude
  종료·재실행, 작업 재전송은 자동 수행하지 않는다. 계정·DB·payload는 정리하지 않는다.

실제 사용이 끝난 owner는 자기 파일만 검증해 제거한다. 다른 owner의 잘못된 기록이
자기의 정상 종료 정리를 막지 않지만, 그 잘못된 기록은 계속 설치를 차단한다.
설치된 구버전 서비스의 카운터나 구형 launcher는 소급 변경되지 않는다. 첫 전환은
새 DMG와 정상 종료가 필요할 수 있고, 구형 Claude 잔여 기록에는 위 복구 준비와
Mac 재시동을 사용한다. 검증 결과와 배포본에서 남은 확인은
[전체 디버깅 보고서](development/FULL_DEBUG_20261017.md)의 후속 수정 기록을 참고한다.

## 2026-10-17: 사용자가 세션을 종료한 뒤 업데이트

설정의 **업데이트**는 별도 업데이트 창을 연다. 이 창은 Pet 패널과 달리 터미널로
전환하거나 최소화해도 유지된다. 설치 파일 다운로드·검증 뒤 사용자가 작업을 저장하고
연결된 Codex·Claude 세션을 정상 종료한 후 **세션 종료 완료 · 업데이트**를 누른다.
이 확인은 사용자의 정상 종료 의사이며, 모든 native 호스트의 종료를 자동 입증한 결과가 아니다.

확인 후 남아 있는 Blabee 연결과 미처리 요청을 계속 검사한다. 30초 후 반복 오류로
끝내는 대신 차단 사유를 창에 표시하며, 사용자는 취소하거나 창을 닫아 중단할 수 있다.
이 대기는 사용자가 해소할 수 있는 연결·요청에만 적용한다. 서비스 연결 실패·응답 지연은
30초로 제한하고, 잘못된 응답·identity·무결성 오류는 재시도하지 않는다.
대기 중에는 배타적 admission을 잡지 않는다. 승인·전달·카드·claim·reconciliation이
남으면 각각의 사유를 안내하고 계속 차단한다. 카드가 남았다면 Blabee에서 선택 또는
**선택 건너뛰기**로 처리해야 하며, 패널을 닫는 것만으로 완료되지 않는다.

검사를 통과하면 검증된 도우미가 배타적 admission 아래에서 다시 검사한 뒤 준비를
기록한다. 이때만 Blabee를 정상 종료하고, 앱 백업·교체·재실행과 새 서비스의 응답을
확인한다. Codex·Claude 프로세스는 강제 종료하거나 자동 재실행하지 않는다.

이 흐름은 journal schema 3으로 별도 기록한다. schema 1의 관리 세션 종료·복원이나
schema 2의 연결 유지 정책으로 변환하지 않는다. schema 3에는 세션 종료·복원 목록이
없고, 호환 런타임이라도 활성 연결이 하나라도 남으면 차단한다. 서명·공증·설치 파일
사용 잠금, Claude 사용 기록, 준비/교체 전 재검증과 실행 후 서비스 검증은 유지한다.

`pending_prompt_contexts`는 실제 호스트 목록이 아니라 UserPromptSubmit/Stop의
메모리 상태다. 정상 Stop이 빠지면 세션 종료 후에도 남을 수 있다. schema 3은 위의
명시적 사용자 확인과 실제 연결/미처리 요청 검사 후 이 메모리 상태만 정상 앱 종료의
차단 조건에서 제외한다. 작업을 완료 처리하거나 journal을 삭제하거나 선택을 재전송하지
않는다. schema 2에서는 계속 차단한다. 이 변경은 모든 native 세션의 자동 종료 감지 기능이 아니다.

창 닫기/취소는 비동기 정리 전에 작업 세대를 즉시 무효화한다. 늦게 끝난 다운로드나
상태 확인이 새 업데이트를 시작할 수 없고, 중복 확인도 도우미를 중복 실행하지 않는다.
도우미 준비 이후에는 창 닫기를 막고 기존 업데이트 상태·복구 규칙을 따른다.

**구버전 전환:** 설치된 r83의 updater와 도우미는 r83 코드다. 새 릴리스 파일을
게시하는 것만으로 이 새 창이 r83에 적용되지는 않는다. 기존 흐름에서 막힌 사용자는
처음 한 번 세션과 Blabee를 정상 종료한 뒤 새 공증 DMG로 설치해야 한다. 소스/회귀
검증과 실제 공증 앱의 업데이트 왕복 검증은 별도로 보고한다.

### 이번 변경의 검증과 남은 확인

- 기존 안내 문구는 `pending_prompt_contexts > 0` 경로와 일치한다. 이 상태는
  실제 프로세스 목록이 아니라 `UserPromptSubmit`/동일 턴 `Stop`으로 갱신된다.
  따라서 종료 기록이 누락되면 남을 수 있으나, 이번 스크린샷만으로 실제 실행 중인
  작업과 남은 메모리 상태 중 어느 쪽인지 확정하지 않았다.
- 직렬 Swift 검증: 업데이트 transaction·readiness·journal·controller·창·정상 종료,
  임시 소켓의 admission, 임시 앱 설치, 메모리 대역의 통계 검사를 포함한 **115개 통과**.
  취소 후 늦은 응답, 중복 확인, schema 1/2 호환, schema 3의 비 prompt 차단 조건,
  새 서비스 확인 실패, 실제 응답 송신이 끝날 때까지 유지되는 잠금을 검사했다.
- 화면 캡처 fixture를 별도 offscreen 창에 연결한 뒤 창 관련 **9개 재검사 통과**.
  영어·한국어, light/dark의 460×480 렌더를 확인했다. 테스트 창을 표시하거나
  앱을 활성화하지 않았다. 실제 키보드·VoiceOver·설치된 앱 UI 검증은 별도다.
- `git diff --check` 통과. 결과는 `build/update-session-close-20261017/`의
  `final-regression.log`, `window-renders.log`, `renders/`에 있다.
- 배포용 앱 생성·서명·공증·설치, 운영 앱/세션 종료, 운영 DB/Keychain 변경은
  이번 검사에 포함하지 않았다. 공증 앱에서 사용자 정상 종료 → 확인 → Blabee 종료
  → 교체 → 자동 재실행과 새 서비스 확인을 실제로 검증해야 한다.

주요 수정은 `app/update/PetAppUpdateWindow.swift`의 독립 창,
`PetAutomaticAppUpdateView.swift`·`PetAppUpdateView.swift`·`PetAppUpdates.swift`의
진입/안내, `AppUpdateTransaction.swift`의 확인·취소·helper 전달,
`AppUpdateTransitionPreflight.swift`의 정책별 준비 검사,
`AppUpdateJournal.swift`의 schema 3에 있다. `PetApplication.swift`·`PetViewModel.swift`·
`PetSettingsView.swift`와 `Package.swift`에서 창을 연결했다. 회귀 검사는
`AppUpdateAdmissionTests.swift`, `AppUpdateTransactionTests.swift`,
`PetAppUpdateWindowTests.swift`에 추가했다.

## 2026-10-10 새 소스의 업데이트 흐름

새 업데이트는 journal schema 2를 사용한다. `업데이트`로 다운로드·서명·공증을 확인한 뒤,
진행 중인 요청과 연결 호환성을 검사하고 Blabee만 정상 재시작한다. 관리 Codex 세션의
자동 종료·복원은 새 흐름에 사용하지 않는다. 아래 관리 세션 설명은 이전 schema 1 기록의
해석·복구를 위한 내용이며 유지한다.

장기 연결의 실행 사본을 앱 설치 경로에서 분리했다. 진행 중인 Codex 작업·카드·승인·선택
전달이 남았거나 Claude 연결의 인증 갱신을 지원하지 않는 경우 적용을 보류한다. 안전 확인은
30초 동안 제한적으로 재시도한 뒤 이유와 재시도·나중에 버튼을 표시한다. 새 앱 실행 후에도
정확한 새 서비스의 응답을 확인해야 완료로 표시한다. 실패한 선택 작업을 재전송하지 않는다.

기존 설치 버전에서 이미 시작된 연결은 새 경로로 소급 이동하지 않는다. 최초 전환이나
서명된 호환 정책에 포함되지 않은 연결은 한 번 정상 종료가 필요할 수 있다.
소스·회귀 검증과 공증된 앱의 실제 업데이트 검증은 구분한다.
자세한 범위와 남은 검증은 [설치·업데이트 구현 기록](features/SEAMLESS_UPDATES_PLAN_KO.md)을 따른다.

## 기존 schema 1의 목표와 사용자 선택

사용자가 설정에서 업데이트를 선택하면 GitHub Releases의 새 Blabee를 다운로드하고,
검증 후 Blabee와 관리 중인 Codex를 종료·교체·복원한다. 원래 터미널을 우선 유지하며,
복원할 터미널이 없거나 지원하지 않는 환경에서는 macOS Terminal의 새 창을 사용한다.

사용자는 2026-09-13에 Blabee 관리 세션 도입을 선택했다. 기존 외부 Codex 세션은
처음 한 번 정상 종료하고 관리 세션으로 전환해야 한다. 일반 `codex` 명령이나 기존
사용자 셸 설정은 변경하지 않는다. 복원 대상은 저장된 대화와 작업 폴더다. 미전송
입력 초안과 중단된 도구 프로세스의 메모리 상태는 복원하지 않는다.

업데이트 확인 화면의 세션 수는 실행 중인 전체 Codex 프로세스 수가 아니라
`update-managed/v1`에 등록된 자동 종료·복원 대상 수다. 일반 터미널이나 Codex 앱에서
직접 연 세션은 Plugin이 연결되어 있어도 이 목록에 포함되지 않는다. 대상이 없으면
`0개를 복원` 대신 등록된 복원 대상이 없다고 표시하고, 일반 세션은 작업 저장 후
직접 정상 종료하도록 안내한다. 이 표시는 외부 프로세스가 없다는 확인을 의미하지
않으며 기존 설치 시점의 실행 파일 사용 잠금·프로세스 검증은 그대로 유지한다.

## 구조

1. `PetAppUpdates`는 기존 `blabee-vX.Y.Z+build.N` 형식의 공개 정식 릴리스를 비교한다.
   자동 설치에는 정확한 `Blabee-X.Y.Z-arm64-rN.dmg`와 `.dmg.sha256` 자산이 필요하다.
2. `AppUpdateDownloadPreparer`는 제한된 HTTPS 주소·크기·시간으로 다운로드한다.
   SHA-256, Blabee Developer ID와 Team ID, 공증, 앱 버전, 실제 서명 식별값을 검증한다.
   런타임은 macOS 기본 도구만 사용하며 Xcode를 요구하지 않는다.
3. `AppUpdateRuntimeCopy`가 현재 전체 앱의 검증된 별도 복사본을 만든다. 실행 파일의
   inode가 달라야 설치된 앱의 공유 사용 잠금 때문에 업데이트가 막히지 않는다.
4. 업데이트 도우미는 종료·설치·복원 단계를 사용자 전용 journal에 기록한다.
   기존 `AppInstallationService`의 고정 설치 경로, 서명 확인, 사용 잠금, 백업과
   배타적 교체를 재사용한다. 구형·미확인 프로세스가 남으면 교체하지 않는다.
5. `UpdateManagedCodex` 감독 프로세스는 자기 전용 AppServer와 TUI만 관리한다.
   원래 터미널에서 대기할 수 있어 터미널 종류에 상관없이 같은 자리에서 재개한다.

새 production 의존성, 전역 프로세스 종료, 격리 속성 삭제, 사용자 설정 수정은 필요 없다.

## 관리 세션 저장·종료 기준

Codex의 native TUI에 종료 신호를 보내는 것만으로 저장 완료를 확인할 수 없다.
관리형 승인 프로필과 독립된 전용 lifecycle 프로필을 사용한다.
현재 자동 종료·복원 대상으로 검증한 버전은 `0.154.0`, `0.155.0`, `0.155.1`이며
목록에 없는 버전과 prerelease는 거부한다. Plugin 지원이나 승인 프로필 통과만으로
자동 종료·복원 지원을 추정하지 않는다.

- 전용 AppServer의 시작·재개·턴·요청·승인 상태를 관찰한다.
- 정확한 UUID의 대화 파일이 이 세션의 `CODEX_HOME`에 저장됐는지 먼저 확인한다.
  Codex가 아직 파일을 만들지 않은 새 대화는 종료하지 않고 사용자에게 안내한다.
- 새 변경 요청을 막고, 진행 중인 턴이나 요청이 있으면 종료를 진행하지 않는다.
- 모든 소유 스레드의 구독을 해제하고 `thread/closed`를 기다린다.
  `thread/unsubscribe` 응답만으로는 저장 완료가 아니다.
- 서버의 stdout·stderr를 끝까지 읽고 저장 실패, 출력 손실과 제한 시간 초과를 검사한다.
  서버 종료 신호나 종료 코드만으로 성공을 추정하지 않는다.
- 저장 완료를 확인한 뒤에만 자기 TUI 자식을 종료하고 터미널 상태를 복원한다.
- 정확한 thread UUID와 cwd로 재개하며 writable 재개 응답을 확인한다.
  `--last`, 초기 프롬프트 재전송, `/quit` 메시지 주입은 사용하지 않는다.

Codex 저장 실패는 `ShutdownComplete` 이후에도 문제가 될 수 있으므로
`RUST_LOG=warn`, `LOG_FORMAT=json`을 전용 자식 환경에만 적용한다. 사용자 로그 전체를
보관하지 않고 필요한 실패 여부만 기록한다. writer lock 파일은 삭제하지 않는다.

## 트랜잭션과 복구

준비 → 다운로드 검증 → 종료 대상 검토 → 사용자 실행 확인 → 도우미 준비 확인 →
Blabee 종료 → 관리 세션 저장·종료 → 설치 교체 → 새 앱 실행 확인 → 세션 재개 확인.

- 다운로드 실패는 실행 중 앱과 세션에 영향을 주지 않는다.
- 도우미가 준비됐다고 확인하기 전에는 Blabee를 종료하지 않는다.
- 일부 세션 종료가 실패하면 앱 교체를 시작하지 않고 이미 종료한 세션을 복원한다.
- 기존 설치 서비스의 게시 전 실패는 기존 검증된 롤백을 따른다.
- 게시 후 오류와 새 앱 실행 실패는 앱·백업을 보존하고 복구 상태로 남긴다.
  실행 여부가 불명확한 앱을 무조건 다시 덮어쓰지 않는다.
- 앱 설치 성공과 일부 세션 복원 실패를 따로 표시한다. 모호한 복원을 반복하지 않는다.

## 검증 계획

### 2026-10-10: 도우미 준비 후 앱 종료 대기 수정

설치된 r80 환경의 10월 8일 업데이트 기록에서 도우미가 준비된 뒤 부모 Blabee가
종료되지 않아 약 30초 후 `parentDidNotExit`로 중단된 사례를 확인했다. 사용자가
보고한 화면의 정확한 단계는 기억하지 못했으므로, 모든 다운로드 준비 지연을
이 사례 하나로 설명하지 않는다.

업데이트 버튼의 MainActor `Task`에서 `NSApplication.terminate`를 호출하고,
delegate가 다시 `Task`로 서비스 종료를 예약한 뒤 `.terminateLater`를 반환하던
경로를 별도 AppKit 프로세스에서 재현했다. `applicationShouldTerminate`까지만
도달하고 서비스 종료 작업은 시작하지 못했다. `.terminateLater`는 중첩 modal
run loop를 사용하므로, 바깥 main-queue 작업이 끝나기를 기다리는 비동기 종료와
서로 대기할 수 있다.

`PetAppUpdateTermination`은 업데이트의 종료 호출을 `RunLoop.main.perform`으로
예약한다. 업데이트 `Task`가 반환된 뒤 main dispatch queue 밖에서 AppKit 종료를
시작하므로, 기존 delegate의 비동기 서비스 종료와 `reply`가 진행할 수 있다.
다른 `Task`나 `DispatchQueue.main.async`로 옮기는 것만으로는 같은 문제가 남는다.
일반 종료·로그아웃을 포함한 delegate의 `.terminateLater` 계약과 중복 종료 방지,
도우미의 서명·상태 확인, 앱 종료 뒤에만 설치하는 순서, 세션 복원은 유지한다.

근거: [Apple terminateLater 규약](https://developer.apple.com/documentation/appkit/nsapplication/terminatereply/terminatelater).
수정 전 별도 AppKit 재현은 종료 작업이 시작되지 않아 3초 watchdog에서 종료 코드
70으로 끝났고, 실제 수정 소스를 사용한 재현은 서비스 종료 시작·완료와
`applicationWillTerminate`까지 도달해 종료 코드 0으로 끝났다. 새 회귀 검사는
업데이트 `Task` 반환 후 main thread에서 종료를 호출하는 순서를 확인한다.
테스트 실행기의 queue 표지만으로 AppKit 중첩 실행을 판단하지 않고, 실제 종료
완료는 위의 별도 AppKit 프로세스로 검증했다.
최종 소스 기준 업데이트 회귀 검사 71개와 서비스 시작·종료·재연결 검사 34개,
총 105개가 통과했다. 서비스 검사는 업데이트 종료 호출을 좁히기 전에도 수행했으며,
그 이후 서비스 구현은 변경하지 않았다. 전체 제품 테스트와 실제 설치 왕복을
대체하는 결과는 아니다.
별도 테스트 프로세스는 창을 표시하거나 실제 Blabee·Codex·운영 저장소에
연결하지 않았다. 실제 배포 앱의 업데이트 왕복은 새 빌드·설치 후 확인해야 한다.
작업 사본과 종료 재현·회귀 로그: `/private/tmp/blabee-update-stall-22j9d80j/`.

| 범위 | 필요한 증거 |
| --- | --- |
| 릴리스 파일 | 태그·파일명·크기·URL·SHA·서명·공증·버전·runtime identity 일치와 각 불일치 거부 |
| 도우미 | 전용 디렉터리, 별도 inode, 원본/복사본 변경 거부, 준비 전 앱 종료 없음 |
| 세션 | busy 거부, 모든 root/하위 스레드 종료, 저장 오류·pipe 손실·지연 거부 |
| 설치 | 실행 중 사용 잠금 보존, 기존 앱 변경 감지, 실패 전후 백업 보존 |
| 복원 | 정확한 UUID/cwd, writable 응답 확인, 중복 요청/중간 중단 처리 |
| 사용자 환경 | 격리 테스트용 세션의 실제 업데이트 왕복, 원래 터미널 유지 및 Terminal fallback |

자동 테스트·서명·공증과 실제 사용자 환경 검증은 각각 기록한다. 아직 공개된 릴리스가
없는 저장소에는 업데이트가 표시되지 않는다. 처음 updater를 포함한 앱은 수동 설치가
필요하며, 이후 더 높은 빌드의 GitHub Release로 자동 업데이트 경로를 검증한다.

### 2026-09-16 검증 결과

- Swift 관련 회귀 검사: 373개, 19개 suite 통과. 다운로드·설치·세션·복구·기존 Codex 연결 포함.
- 전체 AppPackaging: 145개 통과, 앱 경로가 필요한 opt-in 검사 1개 생략.
  조립한 앱을 지정해 해당 검사도 별도 실행: 5개 통과, 생략 없음.
- 공식 Codex 0.154.0 실제 AppServer: 시작 → 저장 → 구독 해제 → `thread/closed` →
  종료 코드 0 및 두 출력 EOF → 같은 UUID로 새 서버에서 재개 → 정상 종료 통과.
  네트워크와 사용자 홈 접근을 차단한 임시 `CODEX_HOME`에서 실행했고 모델 턴은 보내지 않았다.
  양성 fixture는 테스트 세션에만 `thread/section/move`를 적용해 파일을 생성했다.
  생성 전에는 새 세션의 광고된 파일이 실제로 없음을 확인했다.
- 독립 리뷰의 알림 순서·보조 대화·취소된 승인·저장 오류·Terminal 창 지적을 수정 확인했다.
- Release 실행 파일 빌드와 로컬 r41 앱 조립, 임시 서명 검증 통과.

로컬 검증 앱: `build/local-automatic-update-20260916-r41/Blabee.app`.
이 로컬 검증 앱은 배포용 Developer ID 서명·공증본이 아니다. 검증 당시 현재 설치된 앱을
교체하지 않았고, 이후 별도 배포용 DMG를 아래와 같이 게시했다. 공증된 두 버전 사이의 실제 다운로드·교체·대화 복원,
원래 터미널 유지, Terminal 권한 허용/거부 및 새 창 복원은 별도 실사용 검증이 남아 있다.

검증 로그:
`/private/tmp/blabee-automatic-update-final-tests.log`,
`/private/tmp/blabee-update-packaging-all.log`,
`/private/tmp/blabee-update-native-lease.log`.
실제 Codex wire 기록: `/private/tmp/blabee-native-update-contract-6wul28d5/result.json`
(SHA-256 `8dd7851612cfd01c31c23c8c23c628b0184dd7044e21dc81dcfd2cd398352b8f`).
재현 스크립트: `scripts/verify-update-managed-codex-native.py`.

### 2026-09-21 lifecycle 지원 확장 — 빌드 없이 검증

공식 `0.155.0`·`0.155.1` macOS arm64 패키지에서 각각 시작 → 테스트 대화 저장 →
구독 해제 → `thread/closed` → 두 출력 EOF와 종료 코드 0 → 새 AppServer에서 같은
UUID/cwd로 writable 재개 → 정상 종료를 확인했다. 버전별 공식 모델 catalog와 임시
`CODEX_HOME`을 사용했고 네트워크·사용자 홈 접근은 OS에서 차단했다. 모델 턴은 0개다.
두 버전의 thread unload, persistence shutdown, AppServer lifecycle 공식 소스도
파일별 SHA-256이 동일했다. 저장 완료 판단과 실패 시 거부 규칙은 변경하지 않았다.

검증기는 `--expected-version`과 별도 검증한 공식 실행 파일의 `--expected-sha256`을
명시적으로 요구한다. `--work-dir`은 새 private 증거 폴더를 둘 기존 절대 경로이며 기본은
`/private/tmp`다. `--execute`, `--codex`, `--catalog`도 함께 지정한다. 실제 Codex를
실행하지 않는 Node/Python 회귀 4개는 버전/해시 불일치, 명시적 실행 동의와 no-turn
RPC 경계를 검사한다.

실제 wire 증거는 `/private/tmp/blabee-codex-all-stable-9CoDxB/update-lifecycle-8zb21udx/`
아래 `blabee-native-update-contract-3eykujz1/result.json`(0.155.0),
`blabee-native-update-contract-xraf73qk/result.json`(0.155.1)에 있다.
Swift 회귀 소스는 새 버전 허용과 미검증 버전 거부를 보완했지만 실행하지 않았다.
이번 검증은 Swift 컴파일·앱 빌드·패키징·설치 교체·터미널 UI 복원을 수행하지 않았으며,
설치된 제품의 전체 업데이트 왕복이나 실행 중 모델 작업의 저장·복원 증거는 별도로 필요하다.

### r41 배포 완료 — 2026-09-16

- [GitHub 공개 최신 릴리스](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.41)
- 배포 파일: `build/release-dmg-20260916-r41/Blabee-0.1.0-arm64-r41.dmg`
- Developer ID Application 서명, Hardened Runtime, 보안 타임스탬프 확인.
- Apple 공증 `Accepted`: `791a87e4-7bea-4b1b-b44b-1547ae09dc5b`.
- DMG stapling·Gatekeeper 및 내부 앱 Gatekeeper `Notarized Developer ID` 확인.
- 최종 SHA-256: `a7f94bebb1624b9ecf57d837ddae4f40469a39c01c4083288869b7590d8afa17`.
- DMG·checksum·`r41-provenance.json` 게시 후 재다운로드 일치 확인.
  로그인하지 않은 공개 릴리스 목록과 DMG 다운로드도 별도로 확인했다.

릴리스 태그는 기존 커밋 `f0b4144b6315133585feaa81eb5ae4c3f11394e3`을 기준점으로 삼는다.
빌드에는 아직 커밋되지 않은 변경이 포함돼 있으므로 GitHub 자동 소스 압축본은 이 바이너리의
전체 소스를 재현하지 않는다. 소스 입력 fingerprint와 패키징 스크립트 해시는 공개 provenance에
기록했고, 이 차이를 릴리스 설명에도 명시했다. 로컬 앱 교체와 전체 터미널 복원 실사용 검증은
이 배포 작업에서 수행하지 않았다.

### r42 배포 완료 — 2026-09-16

- [GitHub 공개 릴리스](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.42)
- 배포 파일: `build/release-dmg-20260916-r42/Blabee-0.1.0-arm64-r42.dmg`.
- 설치 자산이 유효하면 강조된 **업데이트** 버튼으로 앱 내부 다운로드·검증을 시작한다.
  설치 자산을 확인하지 못한 경우만 릴리스 페이지를 안내한다.
- 변경 후 관련 Swift 검사 46개 통과. 새 Release 빌드의 입력 해시 일치와 바이너리 내
  새 안내 문구 포함·이전 준비 버튼 문구 제거를 확인했다. r35·r41 런타임 호환 정보를 포함한다.
- Developer ID 서명·Hardened Runtime·타임스탬프, Apple 공증 `Accepted`, stapling,
  DMG와 내부 앱 Gatekeeper `Notarized Developer ID` 확인.
- 공증 제출 ID: `1cb19071-b76b-4833-8677-82f59a3e4380`.
- 최종 SHA-256: `c929f2db5cae70638dd4c436df1a30c2d63ce82a34554c739e957e21723b4145`.
- 공개 정식 최신 릴리스로 게시하고, 로그인 없이 DMG·checksum·`r42-provenance.json`을
  다시 다운로드해 일치를 확인했다. 기존 r41 자산의 ID·체크섬은 유지됐다.
- 소스 태그는 r41과 같은 기존 커밋을 기준으로 하며, 위 소스 압축본 관련 제한은 그대로다.
  현재 설치 앱 교체와 전체 업데이트·터미널 복원 실사용 검증은 이번 배포 범위에 포함하지 않았다.

## 사용 방법과 배포 조건

1. 이 기능이 포함된 Blabee를 `/Applications/Blabee.app`에 처음 한 번 설치한다.
2. 기존 대화를 이어가려면 Codex의 `/status`에 표시된 Session ID를 먼저 확인하고 정상 종료한다.
   Blabee 설정의 **앱 업데이트 → Codex 자동 복원 설정**에 이 ID를 입력하고 원래 프로젝트
   폴더를 선택한다. 새 대화는 ID를 비워 두고 연다.
3. 원래 쓰던 터미널에서 직접 시작하려면 다음 명령을 사용한다. 특정 대화를 바로 이어갈
   때만 정확한 세션 UUID를 `--resume`에 넣는다.

   ```sh
   /Applications/Blabee.app/Contents/MacOS/blabee-coordinator managed-session \
     --cwd /absolute/project/path --resume 00000000-0000-0000-0000-000000000000
   ```

4. **업데이트 확인 → 업데이트**를 누른다. 브라우저를 열지 않고 앱에서 다운로드·검증을
   시작한다. 정상적인 설치 자산이 없는 릴리스에만 **릴리스 페이지 열기**를 대신 표시한다.
   작업·승인이 진행 중이면
   먼저 마치고 다시 준비한다. 종료 대상과 미전송 입력 안내를 확인한 뒤 **종료하고 업데이트**를 누른다.
5. 복원 실패가 표시되면 기존 터미널과 표시된 세션 상태부터 확인한다. 같은 세션을
   반복 실행하거나 writer lock을 지우지 않는다.

관리 세션 안에서 다른 대화로 전환해 주 대화 식별이 모호해진 경우에는 자동 종료를
거부한다. 이어갈 대화의 ID를 확인하고 정상 종료한 뒤 그 ID로 관리 세션을 다시 연다.

Terminal 새 창을 처음 열 때 macOS가 Blabee의 Terminal 제어를 요청할 수 있다.
필요하면 **시스템 설정 → 개인정보 보호 및 보안 → 자동화**에서 허용한다.
권한을 거부하거나 창 열기의 결과가 불확실하면 자동으로 다시 명령을 보내지 않고
오류를 표시한다. 기존 터미널에서 기다리던 관리 세션은 이 새 창 제어를 사용하지 않는다.

### 초기 관리 세션 실행 실패 복구 — 2026-09-23

새 관리 세션의 명령 파일 준비 실패 또는 확정된 Terminal 자동화 거절에서는
시작 당시의 registry 기록을 철회한다. CLI의 `managed-session`에서도 `execv`가
실패해 반환하면 같은 처리를 적용한다. 이 기록 때문에 이후 앱 업데이트가
미종료 세션으로 차단되지 않도록 한다.

철회는 registry 잠금 안에서 원본 기록 전체가 여전히 일치하고, `.starting`,
PID/시작 시간 0, transaction/restoration claim 없음이 확인될 때만 수행한다.
이미 Host가 시작했거나 다른 기록으로 바뀌면 보존한다. 삭제된 시작 기록을
이전에 읽은 Host도 incarnation 검사를 통과하지 못해 다시 생성할 수 없다.
삭제나 동기화 실패는 숨기지 않고 오류로 보고한다.

timeout, signal 종료, 일반 실행 오류처럼 실제 창 열기 여부가 불확실하면
기록을 유지하고 재실행하지 않는다. signal 없는 정상 실패 응답의 마지막
Apple event 오류 코드만 자동화 거절 근거로 사용한다. 업데이트 뒤 세션 복원의
durable claim은 이 초기 실행 철회 대상에 포함되지 않는다.

과거에 남은 시작 기록과 앱 사본·`.command`는 자동 삭제하지 않는다. 과거 기록만으로는
실행되지 않았음을 확정할 수 없으며, 앱 사본의 안전한 회수는 별도 작업이다.

회귀 소스는 registry 원본 비교·Host 경합, 실패 뒤 세션 목록/업데이트 preflight,
불확실한 결과 보존, Terminal 오류 분류를 다룬다. 이번 변경은 빌드 금지에 따라
Swift 컴파일·회귀 실행·설치 앱의 실사용 검증을 수행하지 않았다.
빌드 없는 기존 lifecycle 검사기의 Node/Python 회귀 4개와 변경 공백 검사는
통과했다. 이 결과는 새 Swift 동작을 실행해 검증한 증거는 아니다.

GitHub 정식 릴리스에는 공증 완료 후 계산한 checksum을 DMG와 함께 올린다.
예를 들어 빌드 42의 태그는 `blabee-v0.1.0+build.42`, 자산은
`Blabee-0.1.0-arm64-r42.dmg`, `Blabee-0.1.0-arm64-r42.dmg.sha256`이다.
위 버전은 형식 예시이며, 이 문서 자체가 게시·설치 완료를 뜻하지 않는다.
draft/prerelease 또는 자산이 누락된 릴리스는 자동 설치 대상으로 사용하지 않는다.

## 근거

- [Codex 0.154.0 thread unload](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [Codex persistence shutdown](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session/handlers.rs)
- [Codex app-server lifecycle](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/lib.rs)
- [Codex 0.155.0 thread unload](https://github.com/openai/codex/blob/rust-v0.155.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [Codex 0.155.1 thread unload](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [Codex 0.155.1 persistence shutdown](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/core/src/session/handlers.rs)
- [Codex 0.155.1 app-server lifecycle](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/lib.rs)
- [기존 배포용 빌드와 공증](development/RELEASE_DMG_PACKAGING.md)
