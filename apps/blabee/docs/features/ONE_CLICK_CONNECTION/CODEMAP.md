# 통합 연결 설정 코드 지도

확인·갱신일: 2026-09-23. 아래 기존 경로 표와 결합 분석은 구현 전 조사 기록이며 줄 번호는 이동할 수 있다. 통합 설정 구현 후 추가·변경 경로를 먼저 정리한다. 설치 앱·사용자 설정·실제 세션은 교체하거나 변경하지 않았다.

## 구현 후 추가·변경 경로

- `app/coordination/PetConnectionSetup.swift`: 제공자 선택 저장, 현재 설정/세션 증거 분리, 순차 설정·재조회·취소·부분 실패 처리. 동일 polling 증거는 다시 발행하지 않는다.
- `app/coordination/PetViewModel.swift`: `inspectConnectionSetup` → `prepareConnectionSetup` → `configureConnectionProvider`; 기존 도구별 writer와 서비스 제어 재사용. `connectionSetupSnapshot`으로 온보딩의 읽기 전용 directory와 일반 snapshot을 구분한다.
- `app/ui/onboarding/PetConnectionSetupView.swift`: 마지막 온보딩과 설정 연결 탭이 공유하는 도구 선택·연결 화면. Claude 상세의 appearance 조회도 같은 진입점으로 합쳤다.
- `PetApplication.swift`: 선택 의도만 저장하는 UserDefaults store 주입. `Package.swift`에 새 소스 두 개를 기존 앱 target에 등록했다.
- `PetClaudeConnection.configureAutomaticConnection`: 터미널·프로브를 생성하지 않고 기존 자동 설정 adapter를 적용한 뒤 재확인한다. 일반 CLI 세션의 실제 준비 증거는 현재 서비스·정확한 inbox 행으로만 읽는다.
- `CodexRuntimeTrust`/`CodexNativeRuntime`/`CodexPluginCheckReport`: 기존 거부 코드에 경로 실패 종류·컴포넌트 진단을 추가한다. 후보 신뢰 조건은 완화하지 않는다.
- `scripts/build-macos-app.mjs`, `build-release-dmg.mjs`: 공개 빌드 원본·staged plist의 약관/개인정보 URL과 문서 버전 검사. 기존 Claude 개발 모드 공개 차단 유지.
- 추가 테스트: `PetConnectionSetupTests`, `PetConnectionSetupIntegrationTests`, `PetConnectionSetupViewTests`, `Tests/AppPackaging/release-legal-metadata.test.mjs`. 실제 결과는 [QA_REPORT.md](QA_REPORT.md).

## 구현 전 주요 파일과 재사용 지점

| 책임 | 현재 파일·심볼 | 재사용할 기능 |
| --- | --- | --- |
| 앱 조립 | [PetApplication.swift](../../../app/ui/PetApplication.swift) `startProductionPet`(175), `finishFirstRun`(343), `startNormalPet`(354) | 공통 서비스·두 provider transport·설정 manager를 생성하고 온보딩 완료 뒤 정상 polling 시작 |
| 첫 실행 상태 | [PetFirstRun.swift](../../../app/ui/onboarding/PetFirstRun.swift) `PetFirstRunController`(137), `finishSetup`(292) | 네 단계, 원자적 진행 저장·재개, 완료 후 재노출 방지 |
| 첫 실행 화면 | [PetFirstRunView.swift](../../../app/ui/onboarding/PetFirstRunView.swift) `connectionSetup`(280) | 서비스·Codex Plugin·프로젝트 개별 버튼을 통합할 위치 |
| 설정 조립 | [PetViewModel.swift](../../../app/coordination/PetViewModel.swift) `refreshAllOnboardingSettings`(1576), `connectCodexPlugin`(1689), `enableAppOwnedService`(1750), `chooseAndEnableProject`(1797) | 이미 있는 설정 작업을 순서대로 호출 |
| 공통 서비스 | [PetAppService.swift](../../../app/service/PetAppService.swift) `PetAppServiceController`(100), [AppOwnedServiceProcess.swift](../../../app/service/AppOwnedServiceProcess.swift) `launch`(31) | enable/restart, 앱 identity, 비공개 credential, 서비스 세대와 timeout 검증 |
| 서비스 구성 | [main.swift](../../../app/entrypoints/main.swift) 850–918행 | 공통 엔진·Codex operational·Claude product owner 조립. Codex 설치를 서비스 시작 조건으로 요구하지 않음 |
| 프로젝트 설정 | [PetOnboarding.swift](../../../app/ui/onboarding/PetOnboarding.swift) `PetLiveOnboardingAdapter`(57), [ProductServiceSettingsWriter.swift](../../../app/service/product-support/ProductServiceSettingsWriter.swift) `update`(68) | 실제 폴더 검증·파일 잠금·원자적 저장·중복 등록 방지 |
| Codex 설치 | [CodexPluginSetup.swift](../../../bridges/codex/swift/setup/CodexPluginSetup.swift) resolver(196), manager(1154) | 실행 후보 탐색·native 검증·Plugin 설치/업데이트·사용자 설정 충돌 보호 |
| Codex 진단 | [CodexNativeRuntime.swift](../../../bridges/codex/swift/runtime/CodexNativeRuntime.swift), [CodexRuntimeTrust.swift](../../../bridges/codex/swift/runtime/CodexRuntimeTrust.swift) | 후보 실행 전 경로·소유권·권한·서명·버전 검증. 실패 분류를 보완할 위치 |
| Codex Hook | [PetHookReadiness.swift](../../../bridges/codex/swift/hooks/PetHookReadiness.swift) manager(133), [PetConnectionReadiness.swift](../../../app/ui/settings/PetConnectionReadiness.swift) initializer(36) | Plugin 설치·Hook 신뢰·실제 수신 증거를 구분 |
| Claude 연결 | [PetClaudeConnection.swift](../../../app/coordination/PetClaudeConnection.swift) controller(7) | 환경 설정 → 서비스 준비 → 터미널 실행 → 정확한 세션과 ACK 관찰 |
| Claude 자동 연결 | [ClaudeAutoConnectSetup.swift](../../../bridges/claude/swift/service/ClaudeAutoConnectSetup.swift) `enable`(79), `disable`(127) | 소유한 zsh block과 별도 PATH shim 관리·해제 |
| 일반 Claude 명령 | [ClaudeAutoConnectCommand.swift](../../../bridges/claude/swift/service/ClaudeAutoConnectCommand.swift) `disposition`(26), `run`(88) | 대화형 실행 연결, 원래 인수 보존, 사용자 지정 실행/비대화형 명령 통과 |
| Claude 탐색·창 열기 | [PetClaudeLauncher.swift](../../../app/service/PetClaudeLauncher.swift) `startConnectionLive`(119), `claudeCandidates`(228), `recommendedTerminal`(265) | 알려진 CLI 후보와 지원 터미널 탐색 |
| provider 관찰 | [PetProviderTransport.swift](../../../app/service/PetProviderTransport.swift) | 검증된 service directory·scope·provider 세션·공통 inbox |

## 구현 전 흐름

```text
PetApplication.startProductionPet
  → 공통 서비스 controller / provider transport / 도구별 설정 controller 생성
  → 미완료 온보딩: PetFirstRunView 설정 단계
      → refreshFirstRunSetup → firstRunSetupSnapshot
      → 서비스 시작 / Codex Plugin 연결 / 프로젝트 추가를 각각 수행
      → Codex 중심 isConnectionSetupReady
      → finishSetup → startNormalPet → startPolling

현재 설정 화면의 Claude 연결
  → connectClaudeSession → PetClaudeConnectionController.connect
      → ClaudeAutoConnectSetup inspect/enable
      → prepareClaudeConnectionService
      → PetClaudeLauncher.startConnectionLive
      → 도구 로그인·프로젝트 신뢰·필수 채널 확인
      → 같은 nativeSessionID / cwd / 서비스 incarnation의 ACK 관찰
```

## 통합할 때 수정해야 할 결합

### 첫 실행과 일반 화면의 관찰 경로

`supportsClaudeConnectionSetup`(PetViewModel 813행)은 provider transport와 연결 closure, appService가 있으면 가능하다. 서비스가 이미 실행 중일 필요는 없다. `prepareClaudeConnectionService`(826행)는 꺼진 서비스를 enable할 수 있다.

그러나 성공 대기는 **일반 `snapshot?.providerDirectory`**(839행)를 읽고 `updateClaudeConnection`(870행)도 일반 snapshot을 사용한다. 온보딩의 `refreshFirstRunSetup`(1605행)은 `firstRunSetupSnapshot`(1630행)만 채우며 정상 polling은 완료 후 시작한다(1949행).

따라서 Claude 버튼을 온보딩으로 옮기는 것만으로는 부족하다. 온보딩용 fresh provider 상태를 기존 연결 controller에 전달해야 한다. 일반 카드 focus·claim·consumer heartbeat를 조기에 켜는 방식은 사용하지 않는다. `PetFirstRunSetupTests`가 이 부작용 부재를 이미 검사한다.

### Codex 중심 완료 조건

`isConnectionSetupReady`(1047행)는 Codex Hook trusted와 Codex readiness를 요구한다. 화면도 Claude-only 사용자에게 ‘연결은 나중에’ 후 설정에서 연결하도록 안내한다(250행).

공통 서비스는 Codex CLI/Plugin 없이 시작할 수 있고 신규 빈 프로젝트 설정도 허용한다. 수정 책임은 선택한 provider별 완료 조건과 app 조립에 있다. 이 문제를 이유로 엔진이나 bootstrap을 새로 나누지 않는다.

`isOnboardingOperationInFlight`(1224행)에 Claude controller의 `isWorking`도 포함되지 않는다. 통합 진행 중 뒤로가기·완료·서비스 변경의 중복/충돌을 함께 막아야 한다.

### 프로젝트 범위와 실행 중 서비스

[CoordinatorOperationalApplication.swift](../../../app/coordination/CoordinatorOperationalApplication.swift)의 `sessionStart`(1312행), `userPromptSubmit`(1332행)는 미등록 프로젝트를 비활성 처리한다. `project(containing:)`(4329행)는 등록 루트와 하위 폴더 중 가장 구체적인 경로를 선택한다.

설정 파일은 서비스 시작 시 읽는다. `projectSettingsNeedRestart`(PetViewModel 1209행)는 저장된 범위와 실행 범위의 불일치를 표시한다. 신규 설치는 선택한 프로젝트를 저장한 뒤 최초 시작해 불필요한 즉시 재시작을 줄인다. 기존 실행 중 서비스에는 별도 안전한 적용 시점이 필요하다.

처음 고른 작업 루트의 하위 폴더 연결과 모든 미래 작업 폴더 자동 참여는 다른 정책이다. 이번 계획은 사용자 선택 범위를 유지한다.

## 기존 세션과 지원 환경의 경계

- Codex Plugin 등록은 실행 중인 대화에 Hook 로딩·신뢰를 소급 보장하지 않는다. 이미 Hook이 로딩된 경우의 prompt 등록과, 새 Plugin을 기존 세션에 주입하는 것은 구분한다.
- Claude 자동 연결은 지원되는 새 zsh의 대화형 `claude`/resume 경로를 사용한다. 기존 셸·대화는 교체하지 않는다.
- alias/function 충돌은 덮어쓰지 않는다. bash/fish/알 수 없는 셸을 자동 수정하지 않으며 앱의 지원 터미널 실행을 대안으로 제공한다.
- 명시적 settings/MCP/channel 인수 및 비대화형 명령은 기존 passthrough 규칙을 보존한다. 원래 CLI로 fallback하는 것은 Claude spawn 이전 실패가 확실할 때만 가능하다.
- 설정 저장, 터미널 열기, provider ACK, 카드 선택, 실제 실행은 각각 다른 증거다. 다른 세션이나 이전 서비스 세대의 ACK로 성공을 만들지 않는다.

## 회귀 검증 위치

기존 Swift 테스트는 [Tests/swift/BlabeePetTests](../../../Tests/swift/BlabeePetTests)에 있다.

| 테스트 | 통합 이후 확인할 핵심 |
| --- | --- |
| `PetFirstRunTests`, `PetFirstRunViewTests` | 완료·재개·명시적 보류·provider 선택·기존 로그인/약관 흐름 |
| `PetFirstRunSetupTests` | `get_state` 중심 관찰, focus/select/heartbeat/metrics 부재, stale 응답 차단 |
| `PetConnectionReadinessTests`, `PetOnboardingTests` | 설정과 실제 연결 분리, 프로젝트 범위, 중복 클릭, refresh 병합 |
| `PetAppServiceTests` | 서비스 시작 전 setup 가능, 시작 identity/credential, 기존 서비스 모드 충돌 |
| `PetClaudeConnectionTests`, `PetClaudeLauncherTests` | 정확한 세션/cwd/incarnation ACK, 취소, 불확실한 launch 재전송 금지 |
| `ClaudeAutoConnectSetupTests`, `ClaudeAutoConnectCommandTests` | 소유 블록·원본 업데이터·인수 보존, alias/다른 셸/파일 경합, spawn 전 fallback |
| `CodexPluginSetupTests`, `CodexNativeRuntimeTests`, `CodexRuntimeTrustTests`, `PetHookReadinessTests` | 지원 설치 방식, trust 보존, 원인별 진단, 필수 사용자 승인 |
| `ProductServiceConfigurationTests`, `ProductServiceSettingsWriterTests` | 신규 빈 설정, 정확한 프로젝트 등록, 원자적 저장, 실행 범위 적용 |

Swift 검증은 기존 `npm run test:swift`의 직렬 실행·잠금을 유지한다. 구현 후 실행 결과와 재검증 내역은 QA_REPORT.md를 따른다.

## 연결된 계획과 미확정 사항

- 구현 순서: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), 상태/책임: [AGENT_TASKS.md](./AGENT_TASKS.md), [TASK_STATUS.md](./TASK_STATUS.md).
- Claude 공개 Channels 자격은 [RESEARCH.md](./RESEARCH.md)의 별도 외부 조건이다. 현재 개발용 실행 옵션이나 배포 guard를 삭제하는 것만으로 해결되지 않는다.
- 테스터의 `codex_native_path_unsafe`는 실제 실패 Mac의 소유권·권한·링크 증거가 없어 구체 원인을 아직 확정하지 않았다.
- 이 지도는 소스 읽기 결과다. 신규 설치·서명/공증·실제 provider 왕복 성공을 입증하지 않는다.
