# 대화를 유지하는 Blabee 설치·업데이트 계획

작성: 2026-10-10. 검증 갱신: 2026-10-11.
상태: 아래 범위의 소스 구현·격리 회귀 검증 완료. 배포 앱·실제 업데이트 검증 전.

## 목표와 권장 결정

사용자는 `업데이트` 한 번으로 다운로드·검증·설치·Blabee 재실행을 마친다.
지원 조합에서 Codex·Claude 대화 프로세스를 유지하고 Blabee UI와 공통 서비스만
잠깐 재시작한다. 진행 중인 승인이나 미지원 연결은 구체적인 사유와 함께 적용을 보류한다.
다운로드 완료를 설치 완료로 표시하거나 모든 공급자 버전에 대화 유지를 약속하지 않는다.

기존 GitHub Releases·Developer ID 서명·Apple 공증·설치기를 우선 유지한다.
장기 실행 연결을 교체할 앱에서 분리하고, 서비스 세대 전환과 연결 인증을 함께 구현한다.
Sparkle 도입은 후속 선택이다. 새 의존성이나 서명 키를 이번 계획에서 추가하지 않는다.

| 상황 | 목표 사용자 흐름 |
| --- | --- |
| 최초 설치 | DMG에서 설치·시작 → 최초 온보딩·로그인·연결 설정. macOS가 요구하는 권한 확인은 명시적으로 안내 |
| 일반 업데이트 | `업데이트` → 다운로드·검증 → Blabee 재시작 → 새 버전과 연결 상태 확인 |
| 승인·저장 처리 중 | 다운로드는 진행하고 `진행 중인 요청이 끝나면 적용` 표시. 나중에 적용하거나 취소 가능 |
| 연결 호환성 미확인 | 영향을 받는 연결과 필요한 조치 표시. 단순히 전체 Codex 종료를 요구하지 않음 |
| 실패·시간 초과 | 멈춘 단계·이유·다음 조치 표시. 무기한 `업데이트 진행 중` 상태로 남지 않음 |

## 구현 전 진단에서 확인한 구조와 증거의 범위

- `app/entrypoints/main.swift`는 명령 시작 때 설치 실행 파일의 공유 사용 잠금을
  획득한다. Codex MCP 명령은 stdin 연결이 유지되는 동안 계속 실행되므로 그 잠금도 유지된다.
- `AppRuntimeUseLease`는 실제 실행 파일 inode에 공유·배타 잠금을 사용한다.
  `AppInstallation`은 배타 잠금 획득 실패를 설치 대상 사용 중으로 처리한다.
  이 보호를 없애면 실행 중인 바이너리와 나중에 읽는 리소스가 다른 버전이 될 수 있다.
- 직전 읽기 전용 진단에서는 Blabee UI가 없는 상태에서도 설치된 r80 실행 파일의
  MCP 프로세스 두 개가 Codex App Server 아래에 있었다. 원래 설치 실패 시점의
  프로세스와 동일하다는 증거는 없으며, 이번 진단 대화가 새 연결을 만들었을 수도 있다.
- MCP의 정상 EOF 종료 경로는 존재한다. 살아 있는 stdin 연결만으로 고아 프로세스나
  EOF 누수를 단정하지 않는다.
- 관리 세션 수는 자동 종료·복원 등록 수이며 실제 전체 Codex 프로세스 수가 아니다.
- r80의 앱 종료 대기 문제와 MCP의 설치 잠금은 별개다. 종료 호출 수정만으로
  장기 실행 MCP의 앱 교체 차단까지 해결되지는 않는다.

기존 동작: [자동 업데이트](../AUTOMATIC_UPDATES.md),
[설치 실행 파일 사용 잠금](INSTALLER_RUNTIME_LEASE_KO.md).
직전 로컬 진단 기록은 `/private/tmp/blabee-r81-install-blocker-epwzv453/REPORT.md`와
`/private/tmp/blabee-update-r80-stall-k32nly3y/REPORT.md`에 있다.
이는 특정 시점의 관측이며 현재 실행 상태를 보증하지 않는다.

## 실행 파일과 설치 앱의 수명 분리

제안 위치는 사용자 전용 `~/Library/Application Support/Blabee/runtimes/<runtime-identity>/Blabee.app`이다.
처음에는 전체 서명 앱을 복사해 실행 파일·라이브러리·지연 로딩 리소스의 버전을 함께 보존한다.
기존 `AppUpdateRuntimeCopy`의 경로·소유권·서명·정확한 identity 검증과 별도 inode 검사를 재사용한다.

1. 원본 확인과 복사를 잠금으로 보호하고 staging 경로에서 완전성을 검사한다.
2. 검증된 세대를 실행 대상으로 게시한다. 동시 게시와 이미 존재하는 세대의 재사용도 재검증한다.
3. 짧은 bootstrap은 검증된 복사본으로 실행을 넘기고 설치 앱의 장기 사용자가 되지 않는다.
   이전 실행 파일의 공유 잠금을 계속 잡는 부모 프로세스를 남기지 않도록 수명을 검증한다.
4. 기존 연결은 자기 세대의 바이너리와 리소스를 계속 사용한다. 새 연결은 새 세대를 사용한다.
5. 각 세대의 사용 잠금은 실행이 끝날 때까지 유지한다. 설치 경로의 기존 검증을 우회하지 않는다.

개별 세대 게시의 원자성과 앱 교체 전체의 원자성은 다르다. 기존 설치기의 두 번 rename은
crash-atomic이 아니다. 단계 기록·백업·복구 규칙을 유지하고 장애 지점별로 검증한다.

## 공급자 연결과 서비스 전환

| 대상 | 현재 제약 | 필요한 변경 |
| --- | --- | --- |
| Codex MCP | locator가 설치 앱을 가리키고 장기 실행이 그 inode를 점유 | Marketplace 설치 위치는 유지하고 실행 대상만 검증된 runtime store로 분리 |
| Codex Hook | 짧은 요청에도 버전·권한 검증 필요 | 장기 MCP와 단기 Hook의 세대 정책을 따로 정의하고 설치 중 새 진입과의 경쟁을 제어 |
| 이전 Codex runtime | UDS에서 최대 두 이전 identity와 일부 요청만 허용 | 정확한 버전·identity·요청별 지원 표 작성. 승인 요청까지 일괄 허용하지 않음 |
| Claude | Node/JS는 이미 별도 payload지만 native launcher는 설치 앱 사용 | native와 리소스를 함께 분리하고 전역 설치 차단을 검증된 세대별 사용 보호로 전환 |
| Claude 인증 | launcher/service cdHash 일치, capability의 service incarnation 바인딩 | 검증된 재등록·capability 갱신을 구현하거나 연결 종료까지 새 서비스 적용 보류 |
| 공통 서비스 | 단일 Coordinator writer와 서비스 generation | 이전 서비스 종료·권위 잠금 해제를 확인한 후 새 서비스만 권위 획득 |

현재 이전 runtime에 허용된 요청은 `emit_decision`, `session_start`, `stop`,
`user_prompt_submit`이다. `permission_request`, 관리형 승인, Claude 요청은 이 허용 목록에
포함되지 않는다. `동일 major 버전이면 안전`이라는 정책으로 대체하지 않는다.

새 요청 접수 제어 → 진행 중 요청 정리 또는 적용 보류 → 이전 서비스 종료 확인 →
앱 교체·새 서비스 시작 → 연결 갱신 → 버전·서비스·연결 결과 확인 순서를 계약으로 정의한다.
각 단계에 제한 시간과 취소 가능한 지점을 둔다. Hook의 응답 예산을 넘겨 무작정 대기시키지 않는다.
재시도는 계약이 허용하는 동일 요청에 한정하며, 결과가 불명확한 mutation을 자동 재전송하지 않는다.
단일 claim·만료·revision·MAC·freshness·세션 바인딩을 유지한다.

앱 게시 뒤 새 서비스가 실행됐거나 DB migration 여부가 불명확하면 구버전을 무조건 자동 실행하지
않는다. 기존 복구 규칙을 따르고 앱·백업을 보존하며 필요한 조치를 표시한다.

## 기존 사용자 전환과 저장 공간

r80/r81에서 이미 실행 중인 프로세스는 새 경로로 소급 이동할 수 없다.
첫 전환에는 정확히 확인된 해당 연결의 정상 해제·재연결이 필요할 수 있다.
호스트의 대화 보존과 재연결 지원이 검증되지 않았다면 사용자가 해당 호스트를 한 번 정상
종료한 뒤 설치하도록 안내한다. 전체 Codex 강제 종료나 Mac 재부팅을 기본 절차로 삼지 않는다.

사용 중인 구버전 runtime은 보존한다. 정리는 native 실행 파일의 배타 사용 잠금,
정확한 경로·identity, Claude 사용 기록을 함께 확인한다. PID 번호나 idle 시간만으로
삭제하지 않고, 소유자를 확인할 수 없는 기록은 보존한다. 디스크 부족은 복구 가능한 오류로
표시한다. 보안상 폐기된 runtime이나 호환되지 않는 계약 변경은 해당 연결 재시작이 필요할 수 있다.

## 구현 순서와 완료 조건

아래 표는 설계의 완료 조건이다. 소스 반영 범위와 검증 한계는 아래 구현 기록에 따로 기록한다.
기존 변경·운영 앱·사용자 세션은 그대로 유지한다.

| 작업 | 책임·선행 조건 | 완료 조건 |
| --- | --- | --- |
| T-001 상태·호환성 계약 | app·서비스·각 bridge | UI 상태, 시간 제한, 취소·복구, exact identity·요청 종류별 유지/재연결/보류 기준 확정 |
| T-002 runtime store·bootstrap | app·packaging / T-001 | 별도 inode와 완전한 리소스, 변조·부분 복사 거절, 동시 게시·새 실행/설치 경쟁 검증 |
| T-003 공급자 연결 전환 | Codex·Claude bridge / T-001·002 | Marketplace 소유권 유지, Claude 인증 갱신 또는 보류, 오래된 권한 승계·자동 실행 없음 |
| T-004 공통 서비스 교체 | app 서비스·Engine / T-001·003 | 단일 writer와 generation fencing, 늦은 응답 거절, 중복 claim·불명확한 재전송 없음 |
| T-005 설치기·업데이트 UI 통합 | app/update / T-002·004 | 인앱·DMG가 같은 전환 정책 사용, 실제 상태 표시, 각 중단 지점 복구, 무한 진행 상태 없음 |
| T-006 구세대 보존·정리 | 공통 runtime 관리 / T-002·003·005 | 실행 중·미확정 세대 보존, 사용 종료가 확인된 세대만 정리, 디스크 부족 처리 |
| T-007 기존 버전 전환·실사용 검증 | release·QA / 전체 | 옛 구조→새 구조와 새 구조→다음 버전을 별도 검증. 지원 대화 유지·미지원 보류 확인 |

## 수정 후보와 회귀 검사

| 경로 | 역할·필요 검사 |
| --- | --- |
| [AppUpdateRuntimeCopy.swift](../../app/update/AppUpdateRuntimeCopy.swift), [AppRuntimeUseLease.swift](../../app/service/AppRuntimeUseLease.swift) | 검증된 runtime 복사·사용 보호 재사용. 동시 게시·부분 복사·symlink·변조·GC 경쟁 |
| [blabee-launcher](../../bridges/codex/plugin/scripts/blabee-launcher), [CodexPluginSetup.swift](../../bridges/codex/swift/setup/CodexPluginSetup.swift), [DoctorApplication.swift](../../app/service/DoctorApplication.swift) | 실행 대상 분리·locator 신뢰·설치 소유권·진단 |
| [ClaudeRuntimePayload.swift](../../bridges/claude/swift/service/ClaudeRuntimePayload.swift), [ClaudeRuntimePayloadUse.swift](../../bridges/claude/swift/service/ClaudeRuntimePayloadUse.swift), [ClaudeInstalledLauncher.swift](../../bridges/claude/swift/service/ClaudeInstalledLauncher.swift) | 전체 runtime 세대별 수명과 미확정 사용자 보호 |
| [ClaudeAutoConnectSetup.swift](../../bridges/claude/swift/service/ClaudeAutoConnectSetup.swift), [ClaudeAutoConnectCommand.swift](../../bridges/claude/swift/service/ClaudeAutoConnectCommand.swift), [ClaudeSessionEnrollment.swift](../../bridges/claude/swift/session/ClaudeSessionEnrollment.swift) | 새 실행 경로, service incarnation 전환·capability 갱신·재연결 |
| [UnixDomainSocketTransport.swift](../../app/service/UnixDomainSocketTransport.swift), [PetAppService.swift](../../app/service/PetAppService.swift) | 요청별 이전 runtime 호환성, 단일 서비스 권위와 generation |
| [AppInstallation.swift](../../app/update/AppInstallation.swift), [AppUpdateTransaction.swift](../../app/update/AppUpdateTransaction.swift), [PetAutomaticAppUpdateView.swift](../../app/update/PetAutomaticAppUpdateView.swift) | 실제 차단 대상·단계·취소·실패·재실행 표시와 복구 |

우선 확장할 기존 검사:

- `Tests/swift/BlabeePetTests/AppUpdateRuntimeCopyTests.swift`, `AppRuntimeUseLeaseTests.swift`.
- `Tests/AppPackaging/runtime-use-lease.integration.test.mjs`: 복사본 MCP 실행 중 설치 앱 교체,
  사용 중인 세대 정리 거절, EOF 후 잠금 해제와 회수.
- `CodexPluginSetupTests.swift`, `Tests/CoordinatorOperational/plugin-package.test.mjs`.
- `OperationalRuntimeIdentityTests.swift`, `Tests/AppPackaging/runtime-compatibility-assembly.integration.test.mjs`.
- `ClaudeRuntimePayloadUseTests.swift`, `ClaudeSessionEnrollmentTests.swift`: 세대 혼합·미확정 소유자·새 incarnation.
- `AppUpdateTransactionTests.swift`, `AppInstallationTests.swift`, `AppInstallationFlowTests.swift`,
  `PetAppServiceTests.swift`: 늦은 응답·승인 대기·프로세스 종료·각 단계 실패·재시작.

소스 단위 검사와 실제 업데이트 성공은 별도로 기록한다. 공증된 두 버전 사이에서 격리된
실제 Codex·Claude 연결을 유지한 채 다운로드·설치·재실행·새 요청 처리가 완료되는지 확인해야
대화 유지가 검증됐다고 보고할 수 있다. 과거 ref 재전송, 승인 자동 허용, 작업 자동 재실행은
테스트 성공 조건으로 사용하지 않는다.

## 2026-10-10 구현 기록

- T-001/005: 새 업데이트 기록은 schema 2이며 세션 목록이 비어 있어야 한다.
  다운로드·검증 후 적용을 시도하고, 안전한 전환을 확인하지 못하면 구체적인 이유와
  다시 시도·나중에 선택을 제공한다. schema 1 기록의 기존 복구 해석은 유지한다.
  새 흐름에서 관리 Codex 세션을 자동 종료하거나 복원하지 않는다.
- T-002: `AppBridgeRuntimeStore`와 `AppBridgeRuntimeBootstrap`이 전체 서명 앱을 별도
  inode의 identity별 사본으로 준비한다. `mcp`, `claude-installed-launcher`만 이동하며,
  UI·공통 서비스·단기 Hook은 설치 앱에 남는다. Claude 자동 연결의 설치·서비스 준비는
  기존 경로에서 마친 뒤 native launcher 실행을 넘긴다.
- T-003: Codex 구세대 MCP는 후보 앱의 서명된 이전 identity·네 요청 허용 정책으로
  검증한다. Claude capability 재등록은 구현하지 않았다. 활성 또는 확인 불가 Claude
  사용 기록이 있으면 적용을 보류하며, 기존 대화 프로세스를 종료하지 않는다.
  이전 관리 Codex supervisor도 승인 계약의 세대 전환이 지원되지 않으므로 보류한다.
- T-004: `AppUpdateAdmissionGate`의 요청 SH/업데이트 EX 잠금으로 새 요청 진입과
  교체를 구분한다. 요청 잠금은 actor 반환 이후 UDS 응답 기록까지 유지한다.
  `update_status`만 EX 중 조회할 수 있으며 journal을 검증하되 변경하지 않는다.
  승인·응답 ACK·카드·queued claim·미완료 정리·진행 중 Codex 프롬프트를 확인한다.
  정확한 세션·턴의 정상 Stop만 프롬프트 종료로 인정하고, 카드 만료나 시간 경과로
  실행 완료를 추정하지 않는다. 새 서비스의 건강 확인과 업데이트 적용 준비는 별도다.
- T-005: DMG 설치와 인앱 업데이트가 같은 전환 검사를 사용한다. DMG에서 실행 중인
  구버전 GUI를 자동 종료하는 기능은 추가하지 않았다. 실제 교체는 기존 실행 파일의
  배타 사용 잠금까지 필요하다. 첫 구버전 전환에는 해당 연결의 정상 종료가 필요할 수 있다.
- T-006: 사용 중이거나 검증할 수 없는 세대는 보존한다. 자동 정리는 store·실행 파일·
  공급자 사용 보호를 함께 획득한 검증된 미사용 세대에만 적용한다.
- T-007: 운영 앱 설치·재시작, 사용자 대화 유지 검사, 공증된 두 버전 간 업데이트는
  아직 수행하지 않았다. 소스 회귀 통과를 이 항목의 완료로 간주하지 않는다.

프롬프트가 시작된 후 호스트가 비정상 종료해 정상 Stop가 오지 않았다면, 자동 timeout으로
권한 정보를 버리지 않고 적용을 보류한다. 사용자가 대화를 정리한 뒤 정상 재연결해야 한다.
서명된 앱의 runtime 사본 실행과 실제 중단 시간은 별도의 배포 검증 항목이다.

## 2026-10-11 검증 결과와 남은 확인

`npm run test:swift`의 기존 직렬 실행·잠금을 사용했다. 실행 대상은 임시 파일·DB,
격리 소켓과 테스트 대역을 사용하는 검사이며, 설치 앱·운영 서비스·사용자 세션·Keychain은
변경하지 않았다. Swift 테스트용 컴파일은 수행했고 제품 빌드·패키징·공증·설치는 하지 않았다.

| 검사 | 결과·범위 |
| --- | --- |
| 업데이트 관련 Swift 회귀 | Coordinator 7개 + 앱 203개, 총 210개 통과. runtime 사본·사용 잠금·설치·업데이트 journal·UI·Claude 인자·서비스 준비 상태 포함 |
| 마지막 admission 잠금 보완 후 집중 검사 | 12개 통과. 위 회귀와 중복되므로 합산하지 않는다. 새 잠금 파일에서 8개 동시 요청을 20회 반복하고, 마지막 요청이 해제되기 전까지 교체 잠금이 차단되는지 확인 |
| `Tests/AppPackaging/macos-app-assembly.test.mjs` | 62개 통과. 임시 fixture 앱 조립 검사이며 실제 배포 앱을 만든 결과는 아님 |
| 정적 검사 | 변경 파일 공백·충돌 표식 검사 통과. 새 제품 Swift 소스 4개가 `Package.swift`에 각각 한 번만 포함됨을 확인 |

runtime store 최초 준비에서 동시 `O_CREAT` 열기가 `ENOENT`로 실패하는 경합을 재현했다.
기존 파일 열기와 `O_CREAT|O_EXCL` 최초 생성을 분리하고, 생성 경쟁의 `EEXIST`만 제한적으로
재조회하도록 수정했다. runtime 준비도 20회 × 8개 동시 실행으로 재검증했다.
파일 소유자·권한·inode·링크·서명 검증은 유지한다. 이는 격리 환경의 동시성 검증이며
운영 업데이트의 처리 시간이나 실제 대화 유지 성공률을 측정한 결과가 아니다.

회귀 범위에는 요청의 actor 처리 이후 느린 응답 기록·응답 기록 실패까지 교체 차단 유지,
정확한 세션·턴 Stop, 카드 만료 후에도 진행 중 작업 보호, journal 무결성·freshness 실패,
새 서비스 identity 불일치·시작 실패, 게시 뒤 백업 보존과 자동 재전송 금지가 포함된다.

주요 소스는 `AppBridgeRuntimeStore.swift`, `AppBridgeRuntimeBootstrap.swift`,
`AppUpdateAdmission.swift`, `AppUpdateTransitionPreflight.swift`, `AppUpdateTransaction.swift`,
`AppInstallation.swift`, `UnixDomainSocketTransport.swift`,
`CoordinatorOperationalApplication.swift`다. UI·journal·Claude 실행 경로와 관련 테스트도
함께 갱신했다. 공통 검증을 약화하거나 새 production 의존성을 추가하지 않았다.

실제 배포 전 남은 확인:

- 이전 설치 구조 → 새 구조, 새 구조 → 다음 버전 업데이트를 각각 검사한다.
- 공증된 두 버전으로 실제 `exec` 인계·기존 MCP 연결 유지·새 요청 처리를 확인한다.
- 활성 Claude·구형 관리 Codex·미지원 identity는 구체적인 이유로 보류되는지 확인한다.
- 새 서비스 실행 실패와 게시 후 복구 안내를 확인한다. 과거 선택 ref를 재전송하거나
  승인을 자동 허용하는 방식으로 성공을 만들지 않는다.
- DMG 설치는 실행 중인 구버전 GUI를 자동 종료하지 않는다. 첫 전환에 필요한 정상 종료
  안내와 이후 인앱 업데이트를 구분해 확인한다.

로그 위치: `/private/tmp/blabee-seamless-updates-r0ln834k/`.
전체 관련 회귀는 `swift-final-regression.log`, 마지막 잠금 검사는
`swift-admission-final.log`, 수정 전 경합 근거는 `swift-runtime-stress.log`다.
이 경로는 임시 로컬 증거이며 배포 산출물에 포함하지 않는다.

## Sparkle 비교와 공식 근거

Sparkle는 일반 앱의 업데이트 확인·다운로드·검증·교체·재실행을 담당한다.
호스트 PID의 종료를 다루는 공식 구조에서 Blabee의 임의 MCP 프로세스·사용 잠금·대화 복원까지
관리한다는 보장은 확인되지 않는다. 따라서 Sparkle 단독 전환으로 현재 문제를 해결할 수 없다는
결론은 이 구조와 Blabee 소스를 함께 검토한 판단이다.
[공식 설치 구조](https://github.com/sparkle-project/Sparkle/blob/2.x/Documentation/Installation.md)

백그라운드 다운로드·종료 시 설치와 설치 시점 delegate를 제공한다. 설치 권한 확인이 필요한
환경의 사용자 동작까지 제거하지는 않는다.
[자동 업데이트 설정](https://sparkle-project.org/documentation/customization/),
[SPUUpdaterDelegate](https://sparkle-project.org/documentation/api-reference/Protocols/SPUUpdaterDelegate.html)

추후 자체 업데이터 유지보수 비용이 크다면 Sparkle를 검토한다. GitHub 자산 URL은 유지할 수
있지만 framework/helper 조립·서명, appcast와 EdDSA 키 운영, 이전 업데이트 경로 이행이 추가된다.
[게시 문서](https://sparkle-project.org/documentation/publishing/)
