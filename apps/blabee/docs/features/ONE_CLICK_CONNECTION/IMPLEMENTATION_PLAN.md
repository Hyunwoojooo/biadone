# 통합 연결 설정 구현 계획

상태: **통합 설정 구현·격리 검증 완료, 공개 배포 조건 미완료** · 기준일: 2026-09-23

목표와 설계는 [TECH_SPEC.md](./TECH_SPEC.md), 제공자 공식 조건과 현재 구현 근거는 [RESEARCH.md](./RESEARCH.md)를 따른다. 현재 dirty worktree와 다른 작업자의 변경을 보존한다. 아래 경로는 수정 예상 범위이며 모든 파일을 일괄 수정한다는 뜻은 아니다.

## 목표와 가정

사용자는 기존 온보딩의 마지막 단계에서 도구와 작업 폴더를 확인하고 ‘연결하기’를 누른다. 필요한 native 승인 이후, 지원하는 새 셸에서 평소 명령을 사용한다. 공통 Engine·UI·Contracts는 유지하고 app 설정 조립과 bridge adapter를 보완한다.

- 앱/CLI 자동 설치, 실행 중 세션 강제 종료, 홈 전체 프로젝트 자동 허용은 포함하지 않는다.
- 초기 계획 작성 뒤 사용자가 소스 구현을 승인했다. 실제 구현·검증 결과는 TASK_STATUS.md/QA_REPORT.md를 따르며 설치·공개 배포는 분리한다.
- 최종 공개 통합본은 Claude 일반 배포 경로가 확인된 경우에만 완성으로 판정한다.
- 실제 약관·지원 환경·외부 제공자 승인 조건은 제품 결정이고, controller·진단·원자적 쓰기 방식은 기술 결정이다.

## 기술 접근과 의존 순서

```text
T-001 상태와 범위
  ├─ T-002 Codex 탐색·진단
  ├─ T-003 Claude 연결·배포 가능성 확인
  └─ T-004 공통 설정 실행·재개
        ↓
T-005 온보딩·설정·복구 화면
        ↓
T-006 평소 CLI 진입과 실제 연결
        ↓
T-007 공개 빌드·첫 설치 패키징
        ↓
T-008 깨끗한 Mac 수용 검증
```

T-003 외부 조건 확인은 초기에 시작한다. 결과를 기다리는 동안 공통 설정과 Codex 개선을 진행할 수 있지만, 미확정 Claude 경로를 전제로 공개 빌드를 완료 처리하지 않는다. 단계마다 작은 변경과 그에 맞는 회귀 검증을 끝낸다.

## 작업 분해

### T-001 — 제공자별 설정 상태와 완료 조건

**담당 범위:** app 설정 모델·온보딩 상태 합성, 새 controller의 최소 인터페이스.

- 설치 발견, 사용자 선택, 설정 저장, native 승인 필요, 실제 세션 준비 상태를 분리한다.
- Codex 중심 `isConnectionSetupReady`를 선택한 제공자별 결과로 합성한다. Claude-only도 Codex Plugin이나 Codex 프로젝트 조건 없이 정상 경로로 진행한다.
- `configured`와 `ready`를 구분한다. 세션 미실행은 설정 실패가 아니며, 미승인·지원 경로 미확인은 성공이 아니다.
- 온보딩에서 읽는 fresh 상태와 일반 UI 상태의 입력 경로를 명시한다. Claude 준비가 일반 `snapshot`만 기다리는 결합을 제거할 설계를 확정한다.
- 첫 실행 완료·나중에 연결·업데이트 후 재진입의 기존 저장 호환성을 유지한다.

**예상 파일:** `PetFirstRun.swift`, `PetViewModel.swift`, 새 `PetConnectionSetup.swift`, `PetFirstRunSetupTests.swift`, 새 설정 상태 테스트.

**검증/완료 기준:** Codex-only, Claude-only, 둘 다, 미설치, 일부 실패, 일부 보류, 세션 없는 정상 설정, 오래된 ACK/다른 세션 ACK의 표 기반 테스트. Claude-only가 Codex 준비 상태 때문에 막히지 않는다. 구현이 실제 세션 ready를 추측하지 않는다.

### T-002 — Codex 설치 탐색과 경로 오류 진단

**담당 범위:** `bridges/codex` native qualification와 설정 adapter.

- 테스터 Mac의 읽기 전용 증거로 `codex_native_path_unsafe`의 실제 실패 조건을 좁힌다. 증거가 없으면 재현 fixture와 미확정 항목을 구분한다.
- 소유권·권한·ACL·링크·동적 shim·검사 중 변경을 구분하는 bounded 진단을 만든다. 예외 원문이나 환경변수 전체를 보고서에 넣지 않는다.
- 지원 설치 방식의 native 실행 파일 해석을 보완하고, 현재 시간 제한·신뢰 검사·실행 guard·버전 정책을 유지한다.
- Plugin 설치·설정 확인·Hook 신뢰 상태를 통합 controller에 제공한다. 명령을 실행해 경로를 추측하거나 경로 허용목록만 넓혀 통과시키지 않는다.

**예상 파일:** `CodexNativeRuntime.swift`, `CodexRuntimeTrust.swift`, `CodexPluginSetup.swift`, `CodexPluginRecheckReportView.swift` 및 해당 native/setup/report/trust 테스트.

**검증/완료 기준:** Homebrew arm64/지원 Intel 경로, 공식 native, npm·nvm 등 명시적으로 지원할 설치 방식, 안전하지 않은 첫 후보 뒤 안전한 후보, deny-only/allow ACL, dangling/변경되는 symlink, 서명·버전·architecture 불일치, timeout/동시 실행. 신뢰 실패 후보가 실행되지 않으며 사용자는 해결 가능한 원인을 받는다.

### T-003 — Claude 연결 adapter와 공개 경로 확정

**담당 범위:** `bridges/claude`, `PetClaudeConnection`, 공개 연결 조건 문서.

- 현재 개발용 Channels와 공개 사용 가능한 경로의 차이를 공식 문서와 일반 사용자 계정으로 확인한다.
- Plugin 패키징/승인 목록/조직 정책/계정·버전 제약/세션별 권한 화면을 기록한다. 확인되지 않은 승인 경로나 일정을 약속하지 않는다.
- `ClaudeAutoConnectSetup`의 안전한 shell 설정과 현재 controller의 정확한 세션·ACK 검증을 adapter에서 재사용한다.
- setup capability와 공통 service runtime readiness를 분리한다. 앱 소유 서비스가 꺼져 있어도 준비 시작은 가능해야 한다.
- 공개 방식이 제공되지 않으면 Hook/MCP 대안의 기능 차이를 제시하고 제품 결정을 받는다. 개발용 guard 삭제 또는 경고 숨기기로 대체하지 않는다.

**예상 파일:** `ClaudeAutoConnectSetup.swift`, `ClaudeInstalledLauncher.swift`, `PetClaudeConnection.swift`, 필요한 Claude payload/Plugin 설정, `docs/bridges/claude/product-connection/`.

**검증/완료 기준:** adapter 상태 테스트, 지원/미지원 셸, CLI·runtime 없음, 정확한 session/scope/project/service generation의 ACK, 권한 거절·만료·중단, 다른 세션 증거 거부. 공개 채널을 쓸 수 있다는 fixture와 실제 계정 자격 증거를 구분한다.

### T-004 — 통합 설정 실행·중단·재개

**담당 범위:** app 공통 설정 controller와 작은 app 전용 진행 저장소.

- `확인 → 범위 확인·저장 → 서비스 준비 → 제공자별 설정 → 결과 재조회`를 한곳에서 조립한다.
- 읽기 전용 확인에서 사용자의 셸 startup script를 실행하지 않는다. 사용자가 고른 제공자/작업 루트만 mutation 대상으로 삼는다. Codex의 기존 등록 루트·하위 경로 제한을 유지하고 홈 전체 허용을 추가하지 않는다.
- Codex가 없는 상태에서도 동작하는 기존 공통 서비스 enable 경로와 빈 프로젝트 설정 지원을 재사용한다. Claude-only 연결을 위해 별도 bootstrap/Engine을 만들지 않는다.
- 신규 설치는 프로젝트 설정을 먼저 저장한 뒤 서비스를 최초 시작한다. 실행 중 서비스는 임의 재시작하지 않고 안전한 적용 경로나 다음 시작을 사용하며, 저장값과 실행 중 설정의 차이를 표시한다.
- 중복 클릭과 동시 창은 하나의 작업을 공유한다. 앱 재시작 후 실제 설정을 다시 확인하여 필요한 단계만 수행한다.
- Claude controller의 `isWorking`을 포함한 통합 busy/cancel 상태를 사용한다. 진행 중 뒤로가기·완료·서비스 변경·제공자 변경이 겹치지 않도록 guard를 조정한다.
- 기존 provider mutation lock·소유권 확인·원자적 writer를 재사용한다. 파일 변경 경쟁에는 해당 단계만 멈추며 파일을 덮어쓰지 않는다.
- native 승인 대기와 파일 mutation lock을 분리한다. 부분 실패 후 성공한 제공자를 해제하지 않는다.
- 온보딩용 서비스/provider directory 읽기 결과를 Claude 준비·상태 controller에 전달한다. 이를 위해 일반 카드 polling/focus/heartbeat/claim을 활성화하지 않는다.

**예상 파일:** 새 `PetConnectionSetup.swift`와 상태 저장 구현, `PetViewModel.swift`, `PetClaudeConnection.swift`, `PetOnboarding.swift`, 기존 settings writer 호출부, `Package.swift`.

**검증/완료 기준:** 단계별 실패 주입, 저장 직전/직후 종료, unknown write outcome, 두 프로세스 설정 경쟁, 두 번 클릭, 승인 중 창 닫기/뒤로가기/완료, 사용자 파일 동시 변경, 기존 설정 멱등 재시도. 신규 설치는 확정한 프로젝트가 최초 서비스 실행에 반영되고 기존 서비스는 임의 재시작되지 않는다. 서비스가 실제 준비되면 온보딩용 fresh 읽기 경로로 진행하며, 초기 설정만으로 카드 소비 동작이 발생하지 않는다.

### T-005 — 온보딩·설정·복구 화면 통합

**담당 범위:** 공통 Pet UI.

- 4단계 구조를 유지하면서 마지막 설정에 자동 발견 결과·선택할 도구·작업 폴더·주 버튼 ‘연결하기’를 제공한다.
- Claude만 사용하는 사용자도 같은 화면에서 마친다. 별도 설정 탭으로 우회하는 설명을 제거한다.
- 미설치는 설치 안내/다시 확인, native 승인은 해당 화면 열기, 실패는 실패한 도구만 다시 시도하는 동작으로 안내한다.
- 일반 화면에는 짧은 상태와 다음 동작을 표시한다. 경로·error code·Plugin/shell 세부는 고급 설정/진단 보고서에 둔다.
- 설정 화면에서 기존 연결 변경·해제·다시 확인도 같은 controller를 사용한다. 정상 연결을 불필요하게 재설치하지 않는다.
- 앱 안내와 macOS 자동화 권한의 목적 문구를 일치시킨다. Codex 관리 세션·Terminal에 한정된 현재 설명을 실제 Claude 및 지원 터미널 동작에 맞춘다.

**예상 파일:** `PetFirstRunView.swift`, 새 `PetConnectionSetupView.swift`, `PetSettingsView.swift`, `ClaudeAutoConnectSettingsView.swift`, `PetConnectionRecoveryView.swift`, 관련 UI/렌더/접근성 테스트.

**검증/완료 기준:** Claude-only, 일부 실패, 대기, 미설치, 미지원 셸의 화면과 키보드 접근성; 긴 경로·큰 글씨·라이트/다크. 기본 성공 경로에 서비스/Plugin/프로젝트 버튼을 순서대로 누르거나 터미널 명령을 복사하는 요구가 없다. 로그인·약관·통계 선택·단축키 기능은 유지된다.

### T-006 — 평소 CLI 명령과 실제 세션 연결

**담당 범위:** provider 진입·launcher 검증, 공통 연결 상태 표시.

- Codex는 기존 Plugin 경로가 새 CLI 실행에 연결되는지 검증한다. 필요하지 않은 shell shim이나 관리형 실행 강제를 추가하지 않는다.
- Claude는 지원 셸의 별도 shim을 재사용한다. `claude`, resume picker, 명시적 resume, continue를 실제 동작으로 확인한다.
- 경로/CLI 업데이트 뒤에는 identity를 다시 검증하고 필요한 경우 명확히 재연결한다. 오래된 성공 플래그로 실행을 허용하지 않는다.
- 원래 인수·cwd·TTY·종료 코드·signals·업데이터를 보존한다. maintenance/noninteractive 명령의 기존 우회 규칙을 유지한다.
- 기존 열린 셸과 활성 대화는 그대로 둔다. 첫 설정 완료 후 새 셸이 필요하면 한 번 안내한다.

**예상 파일:** 기존 Codex Plugin/설정 부분, Claude `auto-connect-*`, native launcher, 필요 시 `PetClaudeLauncher.swift`와 연결 상태 합성.

**검증/완료 기준:** fake child PTY/IPC 회귀와 실제 Codex·Claude 세션을 구분해 실행. 같은/다른 프로젝트, 동시 다중 세션, 두 제공자 동시 카드, 취소된 picker, 종료·재실행, 재개 대화에서 원래 세션으로 정확히 전달된다. uncertain 결과를 자동 재실행하지 않는다. 앱에서 창 여는 기능 지원과 임의 터미널의 일반 CLI 지원은 별도 기록한다.

### T-007 — 공개 빌드와 첫 설치 패키징

**담당 범위:** Packaging/scripts, 공개 빌드 검증.

- T-003에서 확정한 일반 연결 모드만 공개 payload로 패키징한다. 개발용 실행 인수와 내부 테스트 runtime을 공개 빌드에서 계속 차단한다.
- 새 Swift 파일 포함·Plugin/bridge payload·번들 밖 실행·서명 순서·hardened runtime을 검증한다.
- 공개 빌드는 실제 약관 URL 2개와 문서 버전을 필수로 검증하고 더미 약관을 거부한다.
- `NSAppleEventsUsageDescription`이 실제 Codex/Claude 작업과 지원 터미널을 정확히 설명하는지 번들 검사와 실제 권한 화면에서 확인한다.
- 기존 Developer ID 빌드 → DMG 서명 → 공증 Accepted → staple/validate → 최종 checksum 절차를 재사용한다.
- 다운로드와 업데이트가 같은 검증된 공개 artifact를 참조하도록 한다. 공증된 앱이라는 이유만으로 CLI 연결 성공을 선언하지 않는다.

**예상 파일:** `build-macos-app.mjs`, `build-release-dmg.mjs`, `notarize-dmg.mjs`, 관련 `Tests/AppPackaging/`, release 사용 문서.

**검증/완료 기준:** guard negative tests, payload manifest/서명/architecture, 공증·ticket·Gatekeeper, 실제 다운로드 quarantine 상태의 첫 실행. 개발자 캐시·소스 경로·기존 runtime·로컬 승인에 의존하지 않는다. 실제 제출/게시 실행은 구현 검증과 구분한다.

### T-008 — 깨끗한 Mac 수용 검증과 배포 판단

**담당 범위:** 통합 QA, 사용자 안내, 출시 판정 기록.

아래 경우를 별도 macOS 사용자 계정 또는 Blabee 설치 이력이 없는 테스트 Mac에서 수행한다. 개발자 Mac의 정상 상태를 초기 설치 증거로 대체하지 않는다.

| 조건 | 수용 기준 |
| --- | --- |
| CLI 둘 다 없음 | 설치 성공 후 미설치 안내; 자동 brew/npm 실행이나 거짓 연결 성공 없음 |
| Codex만 설치 | Codex만 선택해 설정 완료; Hook 필수 승인 후 새 CLI의 카드 수신·선택·원래 세션 전달 |
| Claude만 설치 | Codex 요구나 나중에 연결 우회 없이 진행; 일반 배포 경로로 native 승인·실제 세션 ACK·왕복 |
| 둘 다 설치 | 한 번의 설정 흐름; 두 제공자 카드 도착 순서 표시와 원래 세션 전달 |
| 하나만 실패 | 성공한 도구는 사용 가능; 실패한 도구의 이유·재시도·명시적 보류 제공 |
| 설정 중 종료·재실행 | 기존 완료 단계 재검증 후 남은 단계만 수행; 중복 Plugin/블록/세션 없음 |
| 기존 사용자 설정 존재 | 다른 Plugin·프로젝트·shell 바이트 보존; 충돌 시 자동 덮어쓰기 없음 |
| 업데이트/CLI 자체 업데이트 | 상태 재검증; stale trust/ACK 거부; 기존 대화 임의 종료·복원 없음 |
| 앱 재실행·재부팅 | 완료된 튜토리얼 재노출 없음; 로그인 시 실행은 사용자의 기존 선택 준수 |

**완료 기준:** 테스트별 OS/architecture/셸/터미널/CLI 버전/설치 경로/앱 hash/소요 동작과 결과를 기록한다. 수신 → 표시 → 선택 → 정확한 세션 전달 → 실제 실행/완료를 별도로 관찰한다. 필수 native 동작 외 반복되는 개발용 옵션·수동 명령 편집이 남으면 목표 UX 통과로 판정하지 않는다.

## 테스트 실행 전략

- Swift 테스트는 저장소의 `npm run test:swift -- --filter '<이번 변경 관련 suite>'`를 사용한다. 기존 직렬 실행과 lock을 유지한다.
- T-002/T-004 후 native/setup/first-run/connection/설정 writer 회귀를 실행하고, T-005/T-006 후 provider/inbox/권한/단축키 회귀를 포함한다. 실제 suite 이름은 해당 변경 시 source에서 확인한다.
- Claude Node 검증은 `bridges/claude`에서 `npm test`, `npm run check` 및 변경한 lifecycle/installed-session 검증을 실행한다. macOS socket·서명·실행 권한 조건은 로그에 남긴다.
- 패키징 회귀는 root의 `npm run test:t012`, 계약은 `npm run test:contracts`를 사용한다. 마지막 통합 후보에서 Swift 전체 회귀와 필요한 Node 전체 회귀를 한 번 실행한다.
- 빌드 전 실패가 있다면 기존 실패/이번 회귀를 구분한다. fixture 또는 렌더 통과로 설치·실제 모델 연결 통과를 대신하지 않는다.

## 위험과 열린 질문

1. **외부 의존성:** Claude 일반 Channels 경로의 이용 가능성·승인 조건은 T-003에서 확인해야 한다. unresolved이면 공개 통합 출시를 보류하거나 제품 결정을 다시 받는다.
2. **지원 범위:** zsh 외 셸, SSH·원격 환경, 비표준 CLI 배치, 모든 터미널의 창 제어는 첫 범위에 자동 포함하지 않는다.
3. **실제 Codex 사례:** 테스터의 path trust 세부 증거가 아직 없으므로 T-002의 원인 확정 항목은 열려 있다.
4. **프로젝트 자동 발견:** 사용자가 허용한 루트 안에서 후보를 제안할지 첫 폴더를 하나만 선택하게 할지는 UI 설계에서 확정한다. 어느 경우도 후보 발견을 곧 관찰 허용으로 간주하지 않는다.
5. **공개 준비:** 실제 법률 문서와 릴리스 지원 범위는 소유자 입력이 필요하다. 기술적으로 자동 생성한 값으로 대체하지 않는다.

이 문서는 설계와 구현 순서를 보존한다. 2026-09-23 구현 진행 상태는 [TASK_STATUS.md](TASK_STATUS.md), 검증 증거는 [QA_REPORT.md](QA_REPORT.md)를 따른다. 소스 구현, 공개 공증, 설치, 실제 사용의 성공은 각 단계의 증거로 별도 판단한다.
