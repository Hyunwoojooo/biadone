# T-010 네이티브 macOS Pet 구현 보고서

상태: 코드·headless 안전 게이트, 실제 macOS 1차와 실시간 deadline qualification 통과, 환경 매트릭스 진행 중
작성일: 2026-08-22

## 결과

T-011의 UDS `get_state`·`focus_interaction`·`select` 계약을 사용하는 네이티브
Pet을 Swift Package에 구현했다. 별도 LLM API나 터미널 키 입력 주입은 사용하지
않는다. 현재 결과는 개발용 실행 파일과 자동 계약 검사의 승인이지, 서명된 공개
앱이나 실사용 dispatch 승인은 아니다.

## 구현 범위

- 앱을 활성화하지 않는 always-on-top `NSPanel`과 SwiftUI 카드 UI
- routing 순서를 유지하는 다중 세션 카드와 사용자 명시적 foreground 전환
- 동적 1·2, 고정 3·4, disabled 대안, 만료·알림·작업 중·보류 상태
- 위험·증거·체크포인트·결과 상세와 `high`·`critical` 1·2 확인 단계
- 기본 `Option+1·2·3·4`, `Option+Space`와 제한된 안전 조합을 선택하는 설정 UI
- Carbon 단축키의 동적 등록, 실제 상태 label, 충돌 진단과 실패 시 이전 binding 복원
- PermissionRequest 알림 수 표시와 Allow/Deny 없는 best-effort 앱 복귀
- `blabee-coordinator pet [--socket ABS]` 개발 실행 모드

## 안전 경계

- snapshot은 strict typed parser로 해석하며 routing과 interaction의 bijective exact
  join이 깨지면 표시·선택을 중단한다.
- 카드 전환은 14-field `focus_interaction`, 실행은 16-field v1 selection으로 보낸다.
  `select`는 foreground를 암묵적으로 바꾸지 않는다.
- stale revision, 만료, 모호한 응답, 중복 option/action ID, 불완전한 rollback
  checkpoint는 fail-closed한다.
- 한 interaction의 선택은 슬롯이 달라도 single-flight로 제한한다.
- 현재 유효한 슬롯만 전역 단축키로 등록한다. 폐기한 registration ID와 전환 전
  카드의 오래된 입력은 실행하지 않는다.
- 모든 사용자 조합은 Option을 포함해야 한다. Option 단독은 숫자와 Space에만
  허용하고, 미지원 조합과 전체 설정의 중복은 저장 전에 거부한다.
- 설정은 draft에서 편집하며 취소·Pet 접기 시 폐기한다. 활성 단축키 변경 중 하나라도
  macOS 등록에 실패하면 후보 전체를 저장하지 않고 기존 설정과 binding을 다시 등록한다.
- 카드 label은 실제 등록 상태를 기준으로 chord, `Pet 확인`, `사용 불가`, `충돌`,
  `등록 실패`를 구분한다. 편집 중인 chord에는 현재 binding 상태 대신 `저장 전`을 표시한다.
- `high`·`critical`의 슬롯 1·2는 숫자 단축키로 시작하지 않는다. 슬롯 3 보류는
  네이티브 승인과 무관하므로 사용할 수 있다.
- PermissionRequest는 요청 수만 알리며 허용·거부를 전송하지 않는다.
- 현재 operational proposal은 risk `info`, 빈 evidence, checkpoint `unavailable`,
  rollback disabled만 생성한다. 고위험 확인·채워진 상세·활성 롤백 UI는 fixture로
  안전 동작을 검증했지만 실제 Hook→MCP 제안에서 아직 end-to-end로 도달하지 않는다.

## 자동 검증

| 검사 | 결과 |
|---|---:|
| Swift Pet 집중 테스트 | 35/35 통과 |
| Swift Operational 집중 테스트 | 14/14 통과 |
| Swift Routing 필터 | 18/18 통과(Routing 16 + Pet 2) |
| Swift package 전체 | XCTest 5/5 + Swift Testing 106/106 통과 |
| T-011 Node/Swift 결합 계약 | 23/23 통과 |
| v1 계약 | 114/114 통과 |

검증은 Xcode toolchain과 `/tmp` module/build cache를 사용했다. 기본 Command Line
Tools 조합은 로컬 compiler/SDK 불일치와 sandbox cache 제약 때문에 manifest 전
단계에서 실패했으며, 제품 소스 assertion 실패는 아니었다. Swift package의 격리된
Keychain unit test까지 통과했지만 로그인 Keychain을 사용하는 실제 제품 daemon은
비밀번호 대화상자를 피하기 위해 실행하지 않았다.

## 실제 macOS 1차 qualification

제품 Keychain과 사용자 프로젝트를 사용하지 않고 `/tmp`의 격리 UDS fixture, 임시
`.app` 번들 ID와 포커스 프로브로 실제 WindowServer 동작을 확인했다. 임시 앱과
프로세스는 종료했고, 검증 중 만든 두 UserDefaults 도메인도 제거했다.

- Pet 열기, 설정 버튼, Picker 조작 중 호스트 프로브가 `active=true`, `key=true`,
  `focus=true`, `resigned=0`을 유지했다. 입력도 `A`에서 `AB`로 이어져 panel이
  일반 타이핑의 포커스를 빼앗지 않음을 확인했다.
- 보조키·키 Picker에서 `⌥⇧P`를 선택할 수 있었고 취소 뒤 `⌥Space`로 복원됐다.
  별도 임시 번들에서는 저장 뒤 실제 Carbon 등록 상태가 `등록됨`으로 바뀌고,
  프로세스 재시작 뒤에도 `⌥⇧P`가 다시 로드됐다.
- 두 번째 격리 Pet이 같은 `⌥Space`를 등록하자 실제 Carbon 충돌이 발생했고,
  화면과 진단에 각각 `macOS 단축키 충돌`, `macOS 단축키 등록 충돌: toggle`이
  표시됐다.
- 기존 `current.maxY` 기준 resize가 접기→펼치기→접기 뒤 Pet을 위로 이동시키는
  결함을 발견했다. 오른쪽 아래 `maxX`·`minY` anchor를 보존하도록 수정하고 일반,
  음수 좌표, 작은 화면과 화면 복귀 시 정상 크기 복원 회귀를 추가했다. 실제 WindowServer 좌표도
  `92×92@(3328,1328) → 440×620@(2980,800) → 92×92@(3328,1328)`로 정확히
  왕복했다.
- 유효 카드 fixture에서 대기 카드 표시, 정확한 14-field focus, 동적 `⌥1`·`⌥2`,
  고정 `⌥3`, disabled rollback을 확인했다. 권장 선택은 정확한 16-field request를
  한 번만 보내고 Pet을 `작업 중`으로 전환했으며 호스트 포커스는 유지됐다.

## 실제 연속 시계 60/120초 qualification

제품 Keychain과 사용자 프로젝트를 사용하지 않는 `/tmp`의 test-harness UDS에서
실제 `mach_continuous_time` scheduler와 제품 Hook·MCP·Stop·Pet 공개 상태 경로를
연결해 벽시계 시간을 기다렸다.

- 대기 시작 상태는 `reminder_due=false`, 만료까지 `119,948 ms`였다.
- 알림은 시작 뒤 `60,056.709 ms`에 `reminder_due=true`로 관찰됐고, 남은 만료
  시간은 `59,898 ms`였다.
- interaction은 `120,030.318 ms`에 제거됐다. 보관한 exact 14-field focus와
  16-field selection을 뒤늦게 다시 보내자 모두 `interaction_not_waiting`으로
  거부됐다.
- 최종 공개 상태는 `interactions=0`, `routing.pending=0`, `in_flight_count=0`,
  `selection_enabled=false`였다. 대기 중이던 Stop Hook도 exit 0, 빈 stdout·stderr로
  종료됐다. 빈 Hook 출력만으로는 fail-open과 구분하지 않고 최종 state와 늦은 요청
  거부를 주 증거로 사용했다.
- 네이티브 Pet 프로세스도 같은 socket에 연결했지만 Orca computer-use runtime이
  `runtime_unavailable`로 끊겨 Pet 자체 local foreground와 `결정 알림`·`만료됨`
  시각 상태는 자동 증거로 확보하지 못했다. 이 UI 항목은 남은 호스트 매트릭스에
  포함하며 권위 상태 통과로 대신하지 않는다.
- 시험 뒤 임시 Pet·driver·server 프로세스를 모두 종료하고 이번 실행에서 생성한
  `/private/tmp` 디렉터리 7개를 제거한 뒤 경로 부재를 확인했다.

## 남은 수동 게이트

1. 다중 디스플레이 이동·분리·재연결, Spaces, 전체 화면과 Stage Manager에서
   panel 위치와 표시를 확인한다.
2. 실제 물리 키로 전역 Carbon 전달을 확인하고 한국어·영문 등 키보드 레이아웃별
   표시와 입력을 검증한다. 자동화 입력은 앱 대상이라 전역 단축키를 발생시키지 못했다.
3. Pet local foreground의 `결정 알림`·`만료됨` 시각 상태와 장시간 sleep/복귀 뒤
   늦은 물리 입력 거부를 확인한다. 실제 권위 상태의 60/120초와 늦은 UDS 입력 거부는 통과했다.
4. Terminal, VS Code, Orca 각각에서 선택 후 호스트 복귀와 PermissionRequest 알림을
   확인한다.
5. 요청에 원래 PID/창 identity가 없어 알림 증가 polling 시점의 frontmost 앱으로
   돌아가는 best-effort 동작의 제품 범위를 확정한다.

## T-012로 넘기는 범위

- `.app`, Info.plist, entitlement, launchd/login item
- Developer ID 서명, 공증, DMG, updater, `blabee doctor`
- signed Data Protection Keychain/access group과 실제 제품 daemon 통합

따라서 T-010은 실제 macOS 1차와 실시간 deadline qualification까지 통과했지만
현재 `in_progress`다. 남은 디스플레이·Space·sleep·물리 키·실제 호스트 앱
매트릭스가 통과해야 `done`으로 전환한다.
