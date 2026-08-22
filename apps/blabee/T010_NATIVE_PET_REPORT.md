# T-010 네이티브 macOS Pet 구현 보고서

상태: 코드 및 headless 안전 게이트 조건부 완료, 실제 macOS 수동 검증 진행 중
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
- `Option+1·2·3·4`, `Option+Space` Carbon 단축키의 동적 등록과 충돌 진단
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
- `high`·`critical`의 슬롯 1·2는 숫자 단축키로 시작하지 않는다. 슬롯 3 보류는
  네이티브 승인과 무관하므로 사용할 수 있다.
- PermissionRequest는 요청 수만 알리며 허용·거부를 전송하지 않는다.
- 현재 operational proposal은 risk `info`, 빈 evidence, checkpoint `unavailable`,
  rollback disabled만 생성한다. 고위험 확인·채워진 상세·활성 롤백 UI는 fixture로
  안전 동작을 검증했지만 실제 Hook→MCP 제안에서 아직 end-to-end로 도달하지 않는다.

## 자동 검증

| 검사 | 결과 |
|---|---:|
| Swift Pet 집중 테스트 | 25/25 통과 |
| Swift Operational 집중 테스트 | 14/14 통과 |
| Swift Routing 필터 | 18/18 통과(Routing 16 + Pet 2) |
| Swift package 전체 | XCTest 5/5 + Swift Testing 96/96 통과 |
| T-011 Node/Swift 결합 계약 | 23/23 통과 |
| v1 계약 | 114/114 통과 |

검증은 Xcode toolchain과 `/tmp` module/build cache를 사용했다. 기본 Command Line
Tools 조합은 로컬 compiler/SDK 불일치와 sandbox cache 제약 때문에 manifest 전
단계에서 실패했으며, 제품 소스 assertion 실패는 아니었다. 로그인 Keychain을
사용하는 전체 제품 테스트는 비밀번호 대화상자를 피하기 위해 실행하지 않았다.

## 남은 수동 게이트

1. 일반 타이핑 중 입력 초점을 빼앗지 않는지 확인한다.
2. 다중 디스플레이 이동·분리, Spaces, 전체 화면에서 panel 위치와 표시를 확인한다.
3. 실제 Carbon 단축키 충돌과 키보드 레이아웃을 확인한다.
4. 실제 60초 알림과 120초 만료, sleep/복귀 뒤 늦은 입력 거부를 확인한다.
5. Terminal, VS Code, Orca에서 선택 후 호스트 복귀와 PermissionRequest 알림을 확인한다.
6. 요청에 원래 PID/창 identity가 없어 알림 증가 polling 시점의 frontmost 앱으로
   돌아가는 best-effort 동작의 제품 범위를 확정한다.
7. 공개 설정 UI와 사용자가 바꾼 단축키 label을 구현·검증한다.

## T-012로 넘기는 범위

- `.app`, Info.plist, entitlement, launchd/login item
- Developer ID 서명, 공증, DMG, updater, `blabee doctor`
- signed Data Protection Keychain/access group과 실제 제품 daemon 통합

따라서 T-010은 현재 `in_progress`다. 위 수동 macOS 매트릭스가 통과해야 `done`으로
전환한다.
