# 통합 최초 연결 검증 기록

2026-09-23, macOS arm64. 코드·격리 테스트 결과이며 설치 앱 또는 실제 사용자 계정/세션의 검증 결과가 아니다.

## 변경 요약과 파일

- `app/coordination/PetConnectionSetup.swift` 추가: 선택 의도 저장, 도구별 상태와 세션 증거, 중단·부분 실패·재시도, 동일 증거의 중복 발행 억제.
- `app/coordination/PetViewModel.swift`, `PetClaudeConnection.swift`: 기존 서비스/프로젝트/Plugin/Claude adapter 조립, 처음 실행과 일반 화면의 관찰 경로 구분, busy gate, 정확한 Claude directory/inbox 증거 확인.
- `app/ui/onboarding/PetConnectionSetupView.swift` 추가, `PetFirstRunView.swift`, `app/ui/settings/PetSettingsView.swift`, `ClaudeAutoConnectSettingsView.swift`: 공통 연결 화면과 동일한 초기 상태 조회. `app/ui/PetApplication.swift`, `Package.swift`: store 주입과 기존 target 소스 등록.
- `bridges/claude/swift/service/ClaudeAutoConnectSetup.swift`: 현재 실행 파일·지원 셸을 포함한 자동 연결 가능 상태와 typed issue.
- `bridges/codex/swift/runtime/CodexRuntimeTrust.swift`, `CodexNativeRuntime.swift`, `bridges/codex/swift/setup/CodexPluginCheckReport.swift`, `CodexPluginSetup.swift`, `app/ui/settings/CodexPluginRecheckReportView.swift`: 안전 검사를 유지한 경로별 진단.
- `scripts/build-macos-app.mjs`, `build-release-dmg.mjs`, `Packaging/macos/Info.plist`: Codex/Claude TCC 목적 문구와 공개 법률 메타데이터 검사. `docs/development/RELEASE_DMG_PACKAGING.md` 갱신.
- 새 `PetConnectionSetupTests.swift`, `PetConnectionSetupIntegrationTests.swift`, `PetConnectionSetupViewTests.swift`, `Tests/AppPackaging/release-legal-metadata.test.mjs` 및 관련 기존 native/setup/Claude/first-run/recovery/OCR/packaging 테스트 갱신.

기존 dirty worktree의 다른 기능 변경은 보존했다. 이번 구현은 공통 Engine, Contracts/v1, SQLite schema, 서비스/Keychain 식별자, 실행 버전 정책을 변경하지 않는다. Codex 버전 목록의 기존 0.156.0/0.156.1 추가와 달랐던 literal 테스트 기대값만 현재 목록에 맞췄다.

## 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 변경 관련 Swift 최초 검사 | 252/252 통과 | `/private/tmp/blabee-one-click-swift.log` |
| Swift 전체 회귀 | 1,566개/98 suites, 4 이슈 발견 | `/private/tmp/blabee-one-click-swift-full.log` |
| 문제 수정 후 관련 Swift 재검사 | **259/259 통과** | `/private/tmp/blabee-one-click-swift-final.log` |
| 상태 화면의 appearance 조회 완료 후 렌더 검사 | 2/2 통과, 연결 화면 8개 | `/private/tmp/blabee-one-click-render.log`, `/private/tmp/blabee-one-click-renders/` |
| 첫 실행 화면 렌더 | 네 단계 × 두 크기 × 두 테마 = 16개 생성 | `/private/tmp/blabee-one-click-first-run/` |
| `npm run test:t012` | 최초 219 pass / 7 환경 실패 / 1 skip, 227개 | `/private/tmp/blabee-one-click-packaging.log` |
| 실패한 DMG/이전 runtime fixture 재검사 | **6/6 통과** | `/private/tmp/blabee-t007-current-packaging-unsandboxed.log` |
| 실제 coordinator runtime assembly 격리 재검사 | **1/1 통과** | `/private/tmp/blabee-one-click-runtime-packaging.log` |
| `node --test Tests/bridges/claude/auto-connect.test.mjs` | **19/19 통과** | `/private/tmp/blabee-one-click-claude-auto.log` |
| `bridges/claude`의 `npm run check` | JS 50개 파일 통과 | `/private/tmp/blabee-one-click-claude-check.log` |
| 변경 대상 `git diff --check` | 통과 | 대상 파일 한정, 다른 작업 변경 보존 |
| 독립 코드 검토 | 지적된 초기 조회 경쟁 수정 후 추가 확정 결함 없음 | `connection_setup_review` 검토; 실행 검증은 위 로그 기준 |

전체 Swift 1,566개를 수정 후 다시 모두 실행한 것으로 표현하지 않는다. 최초 전체 검사에서 영향을 확인한 부분을 최종 259개 재검사에 포함했다. 패키징도 최초 전체 실행과 실패 항목의 개별 재실행을 합친 증거이며 한 번의 전체 통과 실행은 아니다.

## 발견·수정한 문제

1. 새 controller가 같은 snapshot/단절 상태마다 Published 값을 재설정하여 idle UI 갱신 알림이 5번 생겼다. 실제 상태가 달라질 때만 발행하도록 수정해 기존 두 idle 효율 테스트를 통과했다.
2. 통합 화면과 펼쳐진 Claude 상세가 서로 다른 초기 검사 작업을 시작하면 추천 도구 발견이 누락될 수 있었다. 공통 VM 진입점으로 합쳤고, Codex/Claude 각각 지연된 동시 조회 테스트를 통과했다.
3. 설정 OCR 검사는 이전 고급 설정 제목의 화면 안 표시를 요구했다. 새 최상단 Codex/Claude 동등한 도구 행의 가시성·정렬을 검사하도록 바꾸고, 상태 조회만 허용하며 선택·focus·provider control 부재는 계속 검사한다.
4. 기존 `CodexCompatibility`에는 0.156.0/0.156.1이 있었지만 explicit Plugin allowlist 테스트는 0.155.1까지였다. 이미 존재하는 지원 정책에 테스트 기대값만 맞췄다.

패키징의 7 실패는 hdiutil 장치 접근과 중첩 `sandbox-exec`의 `sandbox_apply: Operation not permitted`였다. 변경 전 복사본에서도 lease fixture 3개가 같은 환경에서 실패하고, 권한 있는 검사에서 baseline/현재 코드가 모두 통과했다. 마지막 실제 coordinator 통합 검사도 별도로 통과했다. Claude Node 최초 `listen EPERM` 역시 임시 소켓 테스트를 허용한 재검사에서 통과했다. 신뢰 정책이나 테스트 의미를 완화해 통과시키지 않았다.

## 통합 테스트가 확인한 경계

- Codex 없는 Claude-only: 공통 서비스 한 번 준비, Claude 설정 재검사, Codex 설정/폴더 선택/터미널 열기 없음.
- 최초 Codex 프로젝트 저장이 서비스 시작보다 먼저 발생; 이미 실행 중인 서비스에 새 폴더가 생기면 자동 재시작하지 않고 적용 필요 상태 표시.
- Codex 실패 뒤 Claude 설정 유지; 사용자의 명시적 보류에 따라 완료 가능 여부 변경.
- 온보딩 get_state는 `{}`만 사용. 일반 카드 consumer heartbeat, 선택, focus, permission response, provider control 없음.
- 실제 launch receipt 없이도 현재 service incarnation·directory와 정확히 같은 세션의 inbox 준비 증거를 관찰. 오래된 service/다른 UI 세대의 행은 거부.
- 읽기 실패 시 완료·준비 상태 철회, 새 응답 뒤 복원. 취소한 adapter가 돌아오기 전 busy 유지, 중복 mutation과 자동 작업 재실행 방지.
- 공개 legal guard는 URL 형식·메타데이터를 검사한다. URL의 게시 여부나 약관 내용의 적합성을 검증했다는 뜻이 아니다. UI 설치 안내용 공식 Codex/Claude 문서 링크는 웹에서 열리는 것을 확인했다.

## 남은 검증

- 설치된 Blabee.app 교체, 실제 사용자 로그인/OS 권한/Hook 신뢰/새 터미널/실제 선택 전달은 실행하지 않았다.
- Claude 일반 배포 자격과 승인된 Channels 경로는 여전히 외부 조건이다. 현재 내부 개발 연결이 성공해도 공개 릴리스 완료로 표시할 수 없다.
- 실제 약관 URL/버전은 현재 plist에 없다. 공개 release가 의도적으로 중단되며, 문서와 계정 흐름 검증이 필요하다.
- 새 Mac의 설치·첫 연결·CLI 동작·업데이트 수용 검증, VoiceOver 실사용 검증은 남아 있다.
- 테스트의 임시 앱은 ad-hoc 서명 fixture다. 최종 배포 앱/DMG의 Developer ID 서명·공증·stapling·체크섬 산출물은 만들지 않았다.
- Git commit/push/merge 및 공개 업로드 없음.
