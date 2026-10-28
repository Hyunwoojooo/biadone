# Blabee 통합 연결 설정 기술 설계

상태: **통합 설정 구현·검증 진행, 공개 연결 경로 미완료** · 기준일: 2026-09-23

이 문서는 목표 설계와 외부 조건을 함께 보존한다. 구현된 범위와 실제 테스트 결과는 [TASK_STATUS.md](TASK_STATUS.md), [QA_REPORT.md](QA_REPORT.md)를 따른다. 공개 연결·깨끗한 Mac 수용 기준까지 통과했다는 뜻은 아니다. 실행 순서는 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), 공식 제공자 조건과 조사 근거는 [RESEARCH.md](./RESEARCH.md)를 따른다.

## 목표

사용자는 Blabee 설치 후 한 번 연결하고, 이후 지원하는 환경에서 평소처럼 `codex` 또는 `claude`를 사용한다. 서비스 시작·Plugin 등록·프로젝트 등록을 개별 작업으로 이해할 필요가 없도록 마지막 온보딩 단계를 통합한다.

- 기존 네 단계인 사용법 → 로그인 → 약관 → 설정을 유지하고, **설정 단계의 주 동작을 ‘연결하기’ 하나로 합친다.**
- 설치된 도구와 지원 여부는 자동으로 확인한다. 연결할 도구와 작업 폴더 범위는 사용자가 확인한다.
- Blabee가 처리 가능한 설정은 순서대로 실행한다. 제공자 로그인, macOS 권한, 도구 자체의 필수 승인은 해당 공식 화면으로 안내한다.
- Codex만, Claude만, 둘 다 선택할 수 있다. 한 제공자 실패가 다른 제공자의 성공을 취소하지 않는다.
- 공통 Engine·Pet UI·선택 계약·정확한 세션 전달 규칙은 유지한다.

‘한 번 연결’은 모든 Mac의 모든 터미널에서 추가 동작이 전혀 없다는 보장이 아니다. 기존 실행 중 세션은 보존하고, 필요한 신뢰 승인과 지원 환경의 새 세션부터 연결한다.

## 가정과 제품 결정

### 이번 제안의 기본값

1. 기존 앱 로그인과 약관 단계를 유지한다. Codex/Claude 로그인은 별도이며 Blabee가 암호·토큰을 대신 수집하지 않는다.
2. 발견된 도구를 화면에 제안하되 `연결하기` 전까지 설정하지 않는다. 미설치 도구는 선택적인 설치 안내를 제공한다. 임의로 Homebrew/npm/Claude를 설치·업데이트하지 않는다.
3. 처음에는 사용자가 고른 작업 루트와 그 하위, 기존에 허용한 폴더만 사용한다. Codex의 기존 프로젝트 범위 검사를 유지하며 새 작업 루트는 앱에서 쉽게 추가한다. 홈 전체·디스크 전체를 스캔하거나 관찰 대상으로 허용하지 않는다.
4. 실행 중인 외부 세션을 관리형 세션으로 강제 전환하지 않는다. 기존 세션 자동 종료·재실행·복원은 이 작업의 범위가 아니다.
5. 자동 연결이 지원되지 않는 셸에서는 이유와 사용 가능한 앱 내 실행 경로를 제공한다. 지원 여부를 숨겨 성공으로 표시하지 않는다.
6. Claude 공개 연결 방식은 별도 외부 조건이다. 개발용 옵션을 숨기는 것으로 일반 배포가 가능하다고 판단하지 않는다.

### 구현 전 확정할 제품 항목

- 초기 지원 셸·실행 환경: 현재 구현을 재사용할 수 있는 macOS 로컬 zsh를 우선한다. 앱에서 새 창을 여는 지원 터미널과 일반 CLI 진입 지원은 별도 목록으로 관리한다.
- Claude 일반 사용자 Channels 제공 가능 여부와, 충족하지 못할 때 공개 일정을 조정할지 또는 대안 연결을 개발할지 결정한다. Codex만 공개하는 것으로 임의 축소하지 않는다.
- 공개용 이용약관·개인정보처리방침 URL 및 문서 버전은 제품 소유자가 제공한다.

## 구현 전 코드에서 확인한 차이

| 현재 구현 | 목표와의 차이 | 책임 위치 |
| --- | --- | --- |
| `PetFirstRunView.connectionSetup`에 서비스·Codex Plugin·프로젝트 별도 버튼 | 마지막 설정에서 사용자가 내부 순서를 조립해야 함 | app 온보딩 |
| 같은 화면의 Claude 안내는 ‘연결은 나중에’ 후 설정 화면 사용을 요구 | Claude-only 첫 연결이 기본 온보딩 흐름 밖에 있음 | app 온보딩 |
| `PetViewModel.isConnectionSetupReady`가 `codexHookReadiness`에 의존 | 제공자 선택에 따른 설정 완료를 표현하지 못함 | app 상태 합성 |
| 공통 서비스 bootstrap은 Codex 없이 시작할 수 있고 빈 프로젝트 목록도 허용 | Claude-only 지원에 새 bootstrap/Engine 구현은 필요하지 않음 | 기존 app 서비스 재사용 |
| Claude 서비스 준비·ACK 갱신은 일반 `snapshot`을 관찰하지만 온보딩은 `firstRunSetupSnapshot`만 갱신 | 버튼만 옮기면 서비스가 준비되어도 연결 대기가 끝나지 않을 수 있음 | app 연결 조립 |
| Codex `candidateURLs`와 `CodexNativeRuntime`이 후보 탐색·신뢰 검사 수행 | `codex_native_path_unsafe`에서 원인·실패 경로를 구분하기 어려움 | Codex bridge |
| `ClaudeAutoConnectSetup`이 별도 shim과 소유한 `.zshrc` 블록을 관리 | 재사용 가능하나 셸 지원·설정 저장·실제 연결은 별도로 표현해야 함 | Claude bridge |
| Claude 설정 controller가 정확한 세션과 ACK를 확인 | 공통 설정 controller가 새로 같은 검증을 구현하면 안 됨 | app/Claude bridge |
| 공개 빌더는 개발용 Claude payload를 거부 | 일반 연결 경로의 검증 없이 guard 제거 불가 | Packaging/scripts |

근거 소스: [첫 실행 화면](../../../app/ui/onboarding/PetFirstRunView.swift), [상태 조립](../../../app/coordination/PetViewModel.swift), [Claude 연결 controller](../../../app/coordination/PetClaudeConnection.swift), [Codex 설정](../../../bridges/codex/swift/setup/CodexPluginSetup.swift), [Codex 실행 검증](../../../bridges/codex/swift/runtime/CodexNativeRuntime.swift), [Claude 자동 연결](../../../bridges/claude/swift/service/ClaudeAutoConnectSetup.swift), [공개 빌더](../../../scripts/build-release-dmg.mjs).

## 기술 접근

### 책임 구분과 최소 구성

`app`에 통합 설정 controller 하나를 추가한다. 화면과 기존 설정 화면은 같은 controller를 사용하고, 도구별 설정은 기존 bridge 구현에 위임한다.

```text
온보딩 설정 / 연결 설정 화면
        ↓
PetConnectionSetupController (app)
  ├─ 공통 서비스 준비와 사용자 선택 범위
  ├─ Codex 설정 adapter → 기존 CodexPluginSetup / NativeRuntime
  └─ Claude 설정 adapter → 기존 ClaudeAutoConnectSetup / 연결 controller
        ↓
기존 공통 서비스 상태 + 제공자별 현재 연결 증거
```

새 adapter는 `inspect → 필요한 작업 계산 → configure → 설정 결과 확인` 정도의 작은 인터페이스만 둔다. 범용 workflow 엔진이나 새 프로세스는 추가하지 않는다. 세션 수명·Hook·권한·전달 ACK의 해석은 각 bridge가 계속 담당한다.

공통 Engine, `Contracts/v1`, SQLite journal schema, 서비스 식별자, Keychain 식별자, 세션 권한·한 번만 claim하는 규칙은 변경하지 않는다. Swift 모듈을 분리하지 않고 `Package.swift`에 새 파일을 정확히 한 target씩 포함한다. 새 production 의존성도 계획하지 않는다.

### 상태는 두 축으로 분리

| 축 | 제안 상태 | 의미 |
| --- | --- | --- |
| 사용자별 설정 | `notSelected`, `checking`, `needsInstall`, `needsAction`, `configuring`, `configured`, `failed`, `deferred` | 이 사용자가 선택한 연결 설정의 저장·검증 상태 |
| 현재 실행 연결 | `notObserved`, `waitingForSession`, `waitingForApproval`, `waitingForAcknowledgement`, `ready`, `unavailable`, `disconnected` | 현재 서비스·정확한 세션에서 확인한 일시적 증거 |

- `configured`는 설치·설정·필요한 지속적 신뢰 조건을 검증했다는 뜻이며 **활성 세션이 연결되었다는 뜻이 아니다.**
- `ready`는 기존 제공자 검증의 현재 서비스 세대·세션·scope·프로젝트·ACK가 일치할 때만 표시한다. 캐시·이전 실행의 ACK·다른 세션으로 성공을 대신하지 않는다.
- 영구적인 초기 승인이나 지원 경로 조건이 남아 있으면 `needsAction`이다. 단순히 앱 설정 파일을 저장했다고 완료하지 않는다.
- 아직 도구를 실행하지 않았어도 준비 조건을 모두 갖췄다면 ‘설정 완료 · 다음 실행부터 연결’로 온보딩을 마칠 수 있다. 처음 실제 전달이 확인되기 전에는 ‘연결 확인 완료’로 표시하지 않는다.
- 선택한 도구 중 하나만 성공하면 ‘Codex 준비 완료 · Claude 확인 필요’처럼 표시한다. 사용자가 실패한 도구를 명시적으로 나중에 연결하기로 바꾸어야 나머지 완료로 진행한다.
- 온보딩 완료는 빌드 번호와 독립적이다. 업데이트 후 튜토리얼을 다시 강제하지 않으며, 연결 상태만 재검사한다.

### 실행 순서

1. **확인:** 설치 후보·플랫폼·셸·기존 Blabee 설정·서비스 등록·허용 작업 폴더를 읽기 전용으로 조사한다. GUI 앱의 제한된 PATH를 보완하되 사용자의 셸 startup script를 실행하지 않는다.
2. **선택 확인:** 연결 도구와 작업 폴더, 자동 연결 설정 범위를 간단히 보여준다. 버튼 한 번으로 이 범위를 승인받으며, 찾지 못한 CLI를 자동 설치하지 않는다.
3. **범위 저장:** 신규 설치는 선택된 작업 루트를 기존 settings writer로 먼저 등록한다. 첫 서비스를 시작한 직후 프로젝트 반영을 위해 다시 시작하는 흐름을 피한다. Claude-only에 Codex 프로젝트 선택을 강요하지 않는다.
4. **준비:** 선택된 제공자가 사용할 공통 서비스를 기존 enable 경로로 준비하고 실제 응답을 확인한다. Codex 바이너리·Plugin을 Claude-only 사용의 선행 조건으로 추가하지 않는다. 기존 앱 소유 서비스와 SMAppService 등록 모드를 중복 실행하지 않는다. 이미 실행 중인 서비스의 설정 변경은 지원되는 안전한 갱신 경로 또는 다음 시작 시점에 반영하며, 이 controller가 임의로 재시작하지 않는다. 저장만 되고 실행 상태에는 미반영인 항목은 그 상태를 보여준다.
5. **적용:** 제공자별 기존 installer/adapter로 필요한 변경만 순서대로 수행한다.
6. **필수 동작 안내:** 해당 도구 로그인·신뢰·채널 권한·macOS 승인이 필요한 경우 해당 화면을 열 수 있게 한다. 승인을 대신 누르거나 설정 파일을 변경해 우회하지 않는다.
7. **검증:** 설정을 다시 읽고 `configured`를 계산한다. 새 세션이 있으면 기존 연결 검증을 이어서 수행한다. 세션을 자동 생성하거나 프롬프트를 자동 전송할지는 별도 사용자 동작 없이 확대하지 않는다.
8. **완료:** 이후 새 셸에서 평소 명령을 사용할 수 있는지 안내한다. 선택적 ‘연결 확인’은 무해한 전용 probe만 사용하며 실제 작업 카드의 승인·선택·실행을 일으키지 않는다.

온보딩의 Claude 연결은 `firstRunSetupSnapshot`에서 얻는 **새 provider directory/상태 증거**를 읽을 수 있도록 조립한다. 일반 카드 poll, focus, presentation, consumer heartbeat, claim을 켜는 것으로 우회하지 않는다. 기존 Claude probe가 foreground 선택을 요구하는 지점은 그대로 호출 가능한지 확인하고, 불가능하면 온보딩 완료 뒤 명시적인 연결 확인 단계로 분리한다. 검증 없이 `ready`를 합성하지 않는다.

### 중단·재개·부분 실패

- 같은 controller의 중복 클릭은 하나의 진행 작업을 가리킨다. UI를 닫아도 다시 열었을 때 현재 상태가 보인다. 앱 종료는 다음 mutation 시작을 중단하며 적용 중 원자적 파일 변경을 손상시키지 않는다.
- 기존 `isOnboardingOperationInFlight`가 빠뜨리는 Claude controller의 진행 상태도 통합 busy 판정에 포함한다. 설정 적용 중 뒤로가기·완료·제공자 변경·서비스 변경이 서로 충돌하지 않게 하고, 취소 가능한 대기에는 명시적 중단 경로를 둔다.
- 다음 실행은 성공 플래그를 믿고 재실행하지 않는다. 저장된 진행 기록을 참고해 실제 상태를 다시 조사하고 남은 단계를 계산한다.
- 구현에서는 기존 onboarding 파일을 변경하지 않고 `com.biadone.blabee.connection.providers.v1` UserDefaults에 선택한 도구만 저장한다. 명시적인 빈 선택도 보존한다. 프로젝트 설정은 기존 writer를 쓰며 완료 단계·성공 플래그·fingerprint를 중복 저장하지 않고 매번 현재 상태를 확인한다. 토큰, 자격증명, 활성 세션 권한, 과거 ACK를 이 기록에 저장하지 않는다.
- 모든 변경에 거대한 트랜잭션을 만들지 않는다. provider별 멱등 작업과 현재 파일 확인, 기존 mutation lock을 재사용한다. 성공한 제공자는 보존하고 실패한 단계만 다시 시도한다.
- 네이티브 승인 대기 중 파일 lock을 잡지 않는다. 다시 시작할 때 입력 및 파일 identity를 재확인한다. 동일 사용자에서 두 앱/설정 창이 실행되면 한 mutation만 진행하고 다른 쪽은 현재 상태를 새로 읽는다.
- 불확실한 쓰기 결과는 성공/실패를 추측하지 않고 재조사한다. 이미 제출한 명령·프로브·세션 생성은 응답 유실을 이유로 자동 재전송하지 않는다.

### 사용자 파일 보존

Claude의 기존 관리 블록·별도 shim, Codex 공식 Plugin 설치와 기존 project settings writer를 재사용한다. 설정 전체를 새 내용으로 덮어쓰지 않는다.

- 변경 전후 파일 identity와 필요한 내용을 비교하고, 다른 변경이 끼어들면 해당 단계만 중단한다.
- 알 수 없는 중복 블록·symlink·별도 소유자의 파일은 덮어쓰지 않는다. 지원되는 보존 방식이 없으면 수동 확인을 안내한다.
- 복구는 이번 시도에서 생성했고 여전히 정확히 같은 파일/블록인 항목에만 적용한다. 다른 사용자의 변경을 과거 백업으로 덮어쓰지 않는다.
- disable은 Blabee 소유 설정만 제거한다. 원래 CLI 실행 파일·업데이터 링크·사용자의 shell 설정과 다른 Plugin은 보존한다.

### Codex 브릿지 보완

기존 후보 탐색과 native 실행 전 신뢰 검사를 유지한다. 보고된 `codex_native_path_unsafe`는 버전 확인 전 실패이며, 테스터 Mac에서 어느 조건이 실패했는지는 아직 확정하지 않았다.

- 진단에 고정된 세부 코드(예: 소유자 불일치, 쓰기 가능한 경로, ACL, 지원하지 않는 shim, 링크 해석 실패/변경)를 추가한다. 일반 화면에는 해결 가능한 짧은 설명, 상세 보고서에는 필요한 경로·검사 단계만 남긴다.
- 공식 설치 방식별 source launcher → canonical native executable을 안전하게 확인한다. shell script/shim을 임의 실행해 경로를 알아내거나 권한 검사를 일괄 완화하지 않는다.
- 한 후보가 실패해도 기존 정책상 허용되는 후속 후보를 검사하며, 다른 Codex를 임의 교체하거나 사용자의 선택과 다른 실행 파일을 조용히 고정하지 않는다.
- Plugin 설치와 Hook 신뢰 확인은 구분한다. 기존 호환 버전·실행 전 identity 재검사·시간 제한·단일 실행 guard를 유지한다.

### Claude 브릿지와 공개 배포

2026-09-27 공개 경로는 일반 MCP·Hook(`mcp-hook-v1`, session v3)으로 전환했다.
zsh 자동 연결 설정을 재사용하며 개발용 Channels 승인은 안내하지 않는다. 사용자가 직접 확인할
항목은 Claude 로그인, 프로젝트 신뢰와 MCP 사용 승인이다. 실제 선택 재개·claim·완료 검증 및
버전 범위는 [공개 MCP·Hook 연결 기록](../../bridges/claude/product-connection/PUBLIC_MCP_HOOK.md)을 따른다.

다음은 전환 전 Channels 방식에 대해 조사한 배포 조건이며, 현재 제품의 승인 절차가 아니다.

- 2026-09-23 공식 문서 확인 기준 Channels는 research preview이고 일반 `--channels`는 Anthropic 또는 조직의 유효 allowlist를 요구한다. marketplace 등록만으로 이 자격을 얻지 못하며, 개발용 모드는 별도 확인을 요구한다. 조건과 출처는 [조사 기록](./RESEARCH.md)에 있다. Blabee의 개인 배포 자격은 확보된 것으로 보지 않는다.
- 공개 Channels 지원/승인 조건, 계정·조직 정책, 필수 신뢰 화면과 Plugin 배포 경로를 공식 자료 및 실제 일반 계정으로 확인한다.
- 표준 Hook/MCP 대안은 현재와 같은 push·선택 전달·권한 승인 경험을 보장한다고 가정하지 않는다. 대안이 필요하면 유지/변경/불가능 기능을 먼저 비교한다.
- 공개 전환은 승인된 실행 경로와 검증된 payload의 명시적 배포 모드로 표현한다. `build-release-dmg` 또는 notarization guard 삭제만으로 통과시키지 않는다.
- Apple 서명·공증·stapling과 Claude 사용 조건은 서로 다른 완료 조건이다. 둘을 모두 충족해야 통합 공개 배포본으로 표시한다.

### 사용자 화면 문구

| 상황 | 기본 문구·동작 |
| --- | --- |
| 조사 중 | ‘사용 환경을 확인하고 있어요’ |
| 확인 완료 | 발견된 Codex/Claude, 허용 작업 폴더, ‘연결하기’ |
| 설정 적용 | ‘연결을 준비하고 있어요’ |
| 외부 승인 필요 | ‘열린 창에서 한 번 확인해 주세요’ + 해당 화면 열기 |
| CLI 미설치 | ‘Codex를 찾지 못했어요’ + ‘설치 안내’ / ‘나중에 연결’ |
| 설정 완료·세션 없음 | ‘준비됐어요. 평소처럼 시작하세요’ |
| 부분 실패 | 성공한 도구와 확인 필요한 도구를 별도 표시 + 실패 항목만 재시도 |
| 실제 연결 확인 | ‘연결됐어요’ |

socket, ACK, Plugin 명령, shell 경로와 상세 error code는 펼칠 수 있는 ‘자세히 보기’와 내보내기 보고서에 둔다. 첫 화면에서 터미널 명령 복사를 정상 설치 절차로 요구하지 않는다.

macOS 자동화 권한에 나오는 `NSAppleEventsUsageDescription`도 실제 Codex/Claude 동작과 지원 터미널에 맞춘다. 현재 빌더의 Codex 관리 세션·Terminal 중심 설명을 그대로 Claude 연결에 사용하지 않는다.

## 변경 예상 파일

- 새 제안: `app/coordination/PetConnectionSetup.swift`, `app/ui/onboarding/PetConnectionSetupView.swift`, app 전용 작은 상태 저장 파일 구현과 관련 테스트.
- 재사용·수정: `PetFirstRun.swift`, `PetFirstRunView.swift`, `PetViewModel.swift`, `PetClaudeConnection.swift`, `PetSettingsView.swift`, `PetConnectionRecoveryView.swift`, `ClaudeAutoConnectSettingsView.swift`.
- 제공자별: `CodexPluginSetup.swift`, `CodexNativeRuntime.swift`, `CodexRuntimeTrust.swift`, `ClaudeAutoConnectSetup.swift`, Claude launcher/공개 연결 설정 부분.
- 배포: `build-macos-app.mjs`, `build-release-dmg.mjs`, `notarize-dmg.mjs`의 필요한 조건·메타데이터 검증, `Package.swift` 명시 sources.
- 기존 Engine·Contracts·DB를 수정해야 할 새 요구가 발견되면 이 계획에 묶어 진행하지 않고 별도 근거와 설계 변경을 제시한다.

## 검증 전략

각 T-001~T-008의 구체적 검증은 구현 계획에 있다. 결과는 **소스 단위 테스트 / 격리 통합 / 패키징·서명·공증 / 설치 / 실제 제공자 왕복 / 사용자 수용**으로 나누어 기록한다. 첫 실행 재시작, Claude-only, 부분 실패, 파일 경쟁, 기존 세션 보존은 필수다. fixture ACK만으로 실제 연결을 완료했다고 보고하지 않는다.

## 위험과 미확정 사항

- 테스터의 Codex 경로 오류는 실제 소유권·링크·ACL 증거가 필요하다. 추정에 따라 보안을 완화하지 않는다.
- Claude 공개 Channels 승인 가능성·시점과 일반 계정 제약은 외부 의존성이다. 확인 전 전체 통합 배포 완료 일정을 약속하지 않는다.
- 지원 셸·터미널·CLI 설치 방식과 최소 버전은 테스트 매트릭스로 명시해야 한다. 모든 환경을 지원한다는 문구를 사용하지 않는다.
- 실제 이용약관 3개 설정 키가 없는 r68은 더미 약관으로 동작한다. 공개 배포는 정식 문서 구성 검증이 필요하다.
- 설정 저장만으로 연결 성공을 표시하면 현재 오류를 더 발견하기 어려워진다. 간결한 UX에서도 상태의 정확성을 유지한다.
