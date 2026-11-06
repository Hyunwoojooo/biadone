# 통합 최초 연결 작업 목록

작성·갱신일: 2026-09-23. 사용자 구현 승인 후 T-001~T-005의 앱·브릿지 변경과 T-007의 공개 메타데이터 검사를 진행했다. 현재 상태와 검증 경계는 [TASK_STATUS.md](TASK_STATUS.md), 상세 검증은 [QA_REPORT.md](QA_REPORT.md)를 따른다. 공개 배포와 깨끗한 Mac 수용 검증은 미완료다.

## 목표와 범위

설치 후 한 번 연결하면 지원되는 새 터미널 세션에서 평소 `codex`·`claude` 명령을 사용하고, Blabee에서 받은 선택을 정확한 원래 세션으로 전달한다. 기존 온보딩의 튜토리얼 → 계정 → 약관 → 셋업 4단계는 유지하고 마지막 셋업을 통합한다.

- 공통 Swift 엔진과 Pet UI를 유지한다. `Contracts/v1`, 저장 스키마, 서비스·Keychain 식별자 변경은 기본 범위가 아니다.
- 공통 서비스는 Codex 없이 시작할 수 있다. 새 서비스 bootstrap을 만들기보다 도구별 준비 조건과 최초 연결 관찰 경로를 보완한다.
- `isConnectionSetupReady`의 Codex Hook 신뢰 결합을 도구별 준비 상태와 구분한다. 온보딩은 `firstRunSetupSnapshot`을 읽지만 Claude 준비는 일반 snapshot의 provider directory를 기다리는 차이를 해결한다.
- 사용자가 선택한 프로젝트 루트 아래에서만 기존 참여 정책을 적용한다. 모든 폴더 자동 참여와 일반 외부 Codex 세션 자동 종료·복원은 범위 밖이다.
- 로그인·OS 권한·도구의 신뢰 승인은 필요한 시점에 사용자에게 요청한다. 최초 연결 선택은 이후 명령 실행의 포괄 승인이 아니다.
- 새 셸에서 설정이 적용되는 것과 이미 실행 중인 세션의 연결은 별도 검증한다. 기존 세션에 설정을 강제로 주입하거나 종료하지 않는다.
- 작업자는 자신의 담당 파일만 수정하고 타 작업자의 변경을 보존한다. 공통 파일은 아래 순서대로 한 작업자가 수정한다.

근거: [RESEARCH.md](RESEARCH.md), [TECH_SPEC.md](TECH_SPEC.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). 아래 T-001~T-008은 작업 범위와 완료 기준이다. 구현 담당은 공통 조립(root), 상태 모델·UI·Codex·Claude 담당 implementer, 독립 qa_reviewer로 분리했다. 실제 진행 상태는 TASK_STATUS.md에서 관리한다.

## T-001 — 제공자별 설정 상태와 완료 조건

- **담당 제안:** planner + app 담당 implementer. `app/ui/onboarding/`, `app/coordination/PetViewModel.swift`, 새 `app/coordination/PetConnectionSetup.swift`의 상태 모델·최소 인터페이스와 해당 테스트.
- **선행 조건:** 현재 연결 경로 지도와 공식 조건 조사 확인.
- **완료 기준:** 도구별로 탐색·설정·새 세션 적용 대기·연결·동일 세션 왕복 확인·사용자 동작 필요·실패 상태를 구분한다. Codex-only·Claude-only·둘 다·미설치 상태 및 지원 셸/설치 방식 표를 합의한다.
- **검증:** 상태 전이 표와 테스트 사례 검토. 설정 저장, MCP 초기화, Channel 쓰기만으로 실제 전달 완료가 되지 않는지 확인한다.
- **위험:** 중간 상태를 성공으로 합치거나 Codex 준비 조건을 Claude에 적용하면 신규 사용자의 실패를 숨긴다.

## T-002 — Codex 설치 탐색과 경로 오류 진단

- **담당 제안:** Codex 담당 implementer. `bridges/codex/swift/runtime/CodexNativeRuntime.swift`, `bridges/codex/swift/setup/CodexPluginSetup.swift`, `CodexPluginCheckReport.swift` 및 대응 테스트.
- **선행 조건:** T-001의 상태·지원 설치 방식 확정.
- **완료 기준:** 지원하는 Homebrew/npm 등의 설치 방식에서 후보와 실제 실행 파일을 구분해 탐색하고, 경로 부재·소유권·권한·링크 대상·버전 실패를 진단 가능한 사유로 반환한다. 유효한 다른 후보 탐색과 모호한 경우의 경로 선택을 정의한다.
- **검증:** 깨끗한 임시 경로의 설치 방식별 fixture, 잘못된 소유권·권한·링크·중복 후보·미지원 버전 회귀. 테스터의 `codex_native_path_unsafe`는 실제 환경 증거와 별도로 재확인한다.
- **위험:** 원인을 밝히기 위해 실행 파일 신뢰 검사를 완화하지 않는다. 현재 테스터 실패의 세부 원인은 미확정이다.

## T-003 — Claude 연결 adapter와 공개 경로 확정

- **담당 제안:** researcher + Claude 담당 implementer. `bridges/claude/swift/service/ClaudeInstalledLaunchConfiguration.swift`, `ClaudeInstalledLauncher.swift`, `ClaudeAutoConnect*`, Plugin 패키징과 대응 테스트.
- **선행 조건:** T-001. 공식 Channels 조건 및 설치 scope·시작 opt-in 확인.
- **완료 기준:** 개인용 승인 Channels, 조직 정책, 개발 테스트를 명시적으로 구분하고 배포 모드와 실패 사유를 반환한다. 일반 사용자 경로의 자격·설치·새 세션/resume·신뢰 확인을 검증한다. 자격 미확보 시 이를 미완료로 유지한다.
- **검증:** 모드별 실행 인수, 정책 비허용, alias/function 충돌, 명시적 사용자 설정 보존, 잘못된 Plugin 출처 거부. Hook·MCP 대안은 별도 작은 실험으로 전달 가능 범위를 증명한 뒤 채택한다.
- **위험:** 개인 사용자용 Channels 승인 경로·일정은 외부 미해결 조건이다. marketplace 등록을 승인으로 보거나 개발용 인수로 조용히 우회하지 않는다.

## T-004 — 통합 설정 실행·중단·재개

- **담당 제안:** app/service 담당 implementer. 새 `app/coordination/PetConnectionSetup.swift`, `PetViewModel.swift`, `PetClaudeConnection.swift`, `app/ui/onboarding/PetOnboarding.swift`, 기존 서비스·설정 writer 호출부 및 관련 테스트. 새 app 조립 파일의 정확한 target을 `Package.swift`에 등록한다.
- **선행 조건:** T-001 완료, T-002·T-003의 상태/호출 인터페이스 확정. Claude 외부 승인 대기 중에도 공통 조립과 격리 검증은 진행할 수 있다.
- **완료 기준:** 한 번의 연결 선택으로 필요한 준비 단계를 순서대로 실행하고, 중단 후 완료된 단계를 재사용하며 실패한 단계만 재시도한다. Codex 설치·Hook 신뢰에 의존하지 않는 Claude-only 경로를 제공한다.
- **완료 기준:** 온보딩용 provider directory와 준비 ACK 관찰 경로를 제공한다. 버튼만 옮겨 `prepareClaudeConnectionService`가 일반 snapshot을 최대 120초 기다리는 현상을 남기지 않는다. 정상 카드 polling·claim을 온보딩에서 우회 실행하지 않는다.
- **검증:** 서비스 미실행의 Claude-first, 한 도구 실패·다른 도구 성공, 취소·재실행·앱 재시작, 늦은 callback, 설정 충돌, 기존 설정 보존·복구, ACK와 세션 일치 회귀.
- **위험:** 재시도가 설정 중복이나 자동 작업 재실행으로 이어지지 않아야 한다. 비밀정보와 인증 파일을 이 조립 과정의 복구 데이터에 포함하지 않는다.

## T-005 — 온보딩·설정·복구 화면 통합

- **담당 제안:** UI 담당 implementer. `app/ui/onboarding/PetFirstRunView.swift`, 새 `PetConnectionSetupView.swift`, 기존 `PetSettingsView.swift`, `ClaudeAutoConnectSettingsView.swift`, `PetConnectionRecoveryView.swift` 및 UI/상태 테스트.
- **선행 조건:** T-001 상태 계약과 T-004 실행/재개 인터페이스 완료.
- **완료 기준:** 기존 4단계 중 마지막 셋업에서 사용 가능한 도구를 보여주고 연결을 실행한다. 사용자가 지금 해야 할 한 동작과 단계별 진행을 표시하며 설정 화면을 다시 찾아가는 일을 없앤다.
- **완료 기준:** ‘설정 완료, 새 터미널에서 적용’과 ‘현재 세션 전달 확인’을 구분한다. 필요한 로그인·권한·신뢰 승인만 안내하며 미지원 도구 때문에 사용 가능한 도구의 시작을 막지 않는다.
- **검증:** 미설치·부분 성공·취소·재개·오프라인·긴 오류 문구·접근성 상태. 완료 후 온보딩 재등장 방지 및 설정의 복구 진입점 확인.
- **위험:** 더미 약관과 실제 계정/동의 검증은 공개 배포 전 별도 완료 조건이다. 연결 성공 화면으로 이를 대신하지 않는다.

## T-006 — 평소 CLI 명령과 실제 세션 연결

- **담당 제안:** debugger + qa_reviewer. `bridges/claude/swift/service/ClaudeAutoConnect*`, Codex Plugin/Hook 설정, `Tests/swift/BlabeePetTests/`, `bridges/claude`의 해당 테스트와 지원 환경 기록.
- **선행 조건:** T-002·T-004·T-005. Claude 공개 모드의 실사용 검증에는 T-003의 자격 확정이 필요하며 개발 모드 결과로 대체하지 않는다.
- **완료 기준:** 지원되는 새 셸의 평소 명령과 resume가 연결된다. 도움말·인증·스크립트 실행·alias/function·기존 명시적 옵션을 보존한다. 여러 세션에서 카드가 도착 순서대로 표시되고 선택이 정확한 원래 세션에 한 번 전달된다.
- **검증:** 새 셸/이미 열린 셸/이미 실행 중인 세션을 나누고, Codex-only·Claude-only·동시 사용·설정 해제·업데이트 후 재시작을 확인한다. 비파괴 왕복 확인과 실제 선택/claim/실행 증거를 분리한다.
- **위험:** 현재 zsh 경로의 성공을 모든 셸·터미널·IDE 지원으로 확대하지 않는다. 미지원 환경에는 검증된 시작 방법만 안내한다.

## T-007 — 공개 빌드와 첫 설치 패키징

- **담당 제안:** 패키징 담당 implementer + qa_reviewer. `scripts/build-macos-app.mjs`, `scripts/build-release-dmg.mjs`, `scripts/notarize-dmg.mjs`, 관련 서명·번들 검증과 배포 문서.
- **선행 조건:** T-003의 공개 배포 조건 확정 및 T-006의 대상 조합 검증. 공개 대상에 포함할 도구·버전을 명시한다.
- **완료 기준:** 기존 Claude 금지 guard를 단순 삭제하지 않고 배포 모드·Plugin 출처·지원 조합 검증으로 교체한다. development-preview는 공개 산출물에 포함되지 않는다. 최종 앱/DMG 서명·공증·stapling·최종 체크섬 검증 결과를 각각 남긴다.
- **검증:** 개발 모드 유입 거부, 번들 무결성, Developer ID/Team ID, Gatekeeper·공증 ticket, 업데이트 대상/이전 버전 검증.
- **위험:** Apple 공증과 Claude 사용 자격은 별개다. 이 과제는 배포 후보를 준비하며 GitHub 업로드·공개 전환은 T-008 통과와 별도 명시적 승인 후 수행한다.

## T-008 — 깨끗한 Mac 수용 검증과 배포 판단

- **담당 제안:** qa_reviewer + 테스터. 격리된 테스트 환경, 해당 회귀 테스트, 이 기능 디렉터리의 검증 기록. 개발자의 실행 중인 앱·세션·DB는 변경하지 않는다.
- **선행 조건:** T-007의 검증 가능한 후보. T-006 지원 범위를 바탕으로 테스트 행렬을 고정한다.
- **완료 기준:** Blabee 미설치 Mac에서 다운로드 → 설치 → 최초 연결 → 평소 명령 실행 → 선택 전달 → 재실행 → 업데이트/복구까지 지원 범위 내에서 완료한다.
- **검증:** Codex-only, Claude-only와 공통 서비스 미실행, 두 도구 동시 사용, 도구 미설치, 기존 설정/alias 충돌, 새 셸과 기존 세션, 부분 실패·재시도, 업데이트 후 상태 보존을 포함한다.
- **위험:** 개발 Mac의 빌드 성공이나 격리 테스트를 신규 사용자 검증으로 대체하지 않는다. 네트워크·계정·정책·권한 차이를 기록하고 미지원 조건을 사용자 안내에 반영한다.

## 병렬 작업과 완료 보고

T-001 이후 T-002와 T-003의 독립 브릿지 작업은 병렬 진행할 수 있다. T-004는 공통 앱 조립 파일을 맡고, T-005의 공통 파일 수정은 T-004가 끝난 뒤 진행한다. 같은 파일을 두 구현자가 동시에 수정하지 않는다.

각 과제는 변경 파일·관련 검사·남은 조건을 보고한다. Swift 검사는 `npm run test:swift`의 직렬 실행과 잠금을 유지한다. 테스트, 빌드, 서명/공증, 설치, 실제 사용 결과는 별도로 보고하고 명시적 요청 없이 commit·push·merge·공개 배포를 수행하지 않는다.

통합 설정 구현과 격리 회귀 검증을 진행했다. 설치 앱 교체·공개 서명/공증·GitHub 업로드·Git 이력 변경은 수행하지 않았다.

**후속 작업:** 내부 설치 후보에서 실제 새 터미널 연결을 확인하고, Claude 공개 경로와 실제 법률 문서가 준비된 뒤 T-007~T-008을 진행한다. 테스트 fixture 성공을 공개 자격이나 실제 선택 실행 증거로 대신하지 않는다.
