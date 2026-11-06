# Codex 0.157.0·0.157.1 지원 검증

2026-09-28, macOS arm64. Codex 브릿지 소스와 회귀 정의를 갱신했다.
최초 지원 추가 단계에서는 빌드하지 않았다. 후속 r76 빌드·검증 결과는 문서 끝에 기록한다.

## 지원 변경

- `CodexCompatibility`: 두 버전의 Plugin CLI 및 managed App Server capability 등록.
  Doctor는 공통 정책을 참조하므로 별도의 버전 목록을 추가하지 않는다.
- `HookPermissionPolicy`: 공식 primary native 실행 파일의 정확한 CDHash 등록.
  버전 범위나 Team ID만으로 승인하지 않고 기존 호출자 재검증을 유지한다.
- `CodexRuntimeBundle`: 버전별 42파일·10디렉터리의 전체 digest 및 fingerprint 등록.
  실행 비트가 있는 voice JSON도 정확한 경로와 공식 digest를 만족해야 한다.
- `ManagedCodexLauncher`: server-owned workspace 정책을 두 버전으로 확장.
  `sandbox_workspace_write` 전체 table과 하위 key의 CLI 설정을 소유한 App Server에
  원문·순서 그대로 전달한다. 기본·보조 서버에 동일하게 적용한다.
- `UpdateManagedCodexProfile`: 별도 종료·복원 지원 목록에 두 버전 등록.
- 패키지 검증기와 해당 fixture: 정확한 두 버전의 arm64 voice layout 등록.

미등록 버전·prerelease는 계속 거부한다. 기존 버전의 capability, 원래 native
fallback 인수, `--` 뒤 literal 입력과 옵션 피연산자 처리는 유지한다.
`--add-dir`, `--no-daemon`, workspace override와 `--profile` 혼용은 기존 정책대로
실행 전에 거부한다. 추가 roots를 전체 배열 교체로 임의 변환하지 않는다.

## 공식 패키지 근거

| 버전 | arm64 archive SHA-256 | native CDHash |
| --- | --- | --- |
| 0.157.0 | `97809f91cb355e55480cd7a126f9ad24bb7b162222515e30286bcac6fba94acd` | `cc8940cad4795103c7f31977fc2cabb7ebc17418` |
| 0.157.1 | `6cda538d19c2f4d9dce965369aa22011afa9dce8c7a73c234b66eb3611ea4aab` | `344b1e8a3cfa9dc90b5488fa7dfed06fb5bb7e9c` |

공식 release API의 archive 크기·SHA-256과 일치하는 패키지를 검사했다. native
30개 파일의 서명·공증을 통과했다. 원본 패키지의 bytes와 권한은 변경하지 않았다.

출처: [0.157.0](https://github.com/openai/codex/releases/tag/rust-v0.157.0),
[0.157.1](https://github.com/openai/codex/releases/tag/rust-v0.157.1).

전체 managed fingerprint:

- 0.157.0: `888c03595317eb339c789e91f658a55046cbbf3688bb6b78f7c5e7f85c241c90`
- 0.157.1: `3b555cccb72141df5e2cd847dba0f97a2bf28fda54b7c4347a00a6ba1e96ab2a`

Swift와 동일한 길이 구분 직렬화로 manifest 및 52개 entry를 계산했다. 기존
0.156.0·0.156.1 실제 패키지의 entry와 fingerprint가 현재 catalog와 일치하는지
먼저 대조했다. JS smoke 보고서의 snapshot fingerprint와는 다른 값이다.

## 새 버전 동작과 유지한 계약

공식 0.156.1 대비 Hook 59파일, Plugin 10파일, ext/mcp 18파일 및 핵심 승인·queue
wire 계약을 대조했다. PermissionRequest Allow는 계속 일회성 Approved로 매핑된다.
승인 adapter, queue 형식, MCP wrapper를 새 형식으로 변환할 근거는 발견하지 못했다.

0.157은 일반 대화형 실행에서 기본 daemon을 자동 시작한다. 공식 소스의 fresh 설치는
foreground CLI package를 복사하고 `bin/codex` entrypoint와 실행 파일 bytes 일치를
요구한다. 자동 updater도 `codex-package`를 설치한다. 독립 `codex-app-server-package`
variant를 추가 허용할 필요는 없다. 실제 Hook 조상의 서명과 CDHash로 판정하는 기존
경계를 유지한다. [설치 준비 소스](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/app-server-daemon/src/prepare_install.rs),
[installer](https://github.com/openai/codex/blob/rust-v0.157.1/scripts/install/install.sh).

Blabee 관리형 실행은 명시적 `--remote`를 사용하므로 자동 daemon 시작에서 제외된다.
여기에 `--no-daemon`를 붙이면 native가 거부한다. 원격 workspace 설정은 여전히
서버 소유이므로 version matrix와 함께 launcher의 정확한 버전 분기를 확장했다.
[native 시작 검사](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/tui/src/startup_orchestration.rs).

initialize의 선택적 OAuth capability와 rollout의 선택적 creator metadata는 기존
처리와 호환된다. unsubscribe 응답만으로 저장 완료로 판단하지 않고 thread/closed,
stdout/stderr EOF 및 정상 종료를 모두 요구한다. 압축 rollout은 native writable resume이
plain `.jsonl`로 materialize하므로 Blabee의 plain 파일 검사를 완화하지 않는다.

다음은 지원 등록과 구분해서 남기는 통합 회귀 대상이다.

- 일반 fresh/reused daemon에서 Plugin·Hook·MCP·queue 연결 및 실제 Hook 호스트 식별.
  기존 daemon은 새 터미널의 BLABEE_* 환경이나 전경 CLI 버전과 같다고 가정하지 않는다.
- 새 tool Hook cwd는 선택 local environment를 따르고 UserPromptSubmit은 turn.cwd를
  유지한다. 둘이 다르면 현재 공통 세션 경로 검사에서 Pet 승인 대신 Codex 기본 승인으로
  돌아가는 조건이 있다. 동일 cwd, Starting local 환경, 중간 폴더 변경, remote fallback,
  root/child thread를 검증해야 한다. 현재 사용자 세션에서 재현한 결과는 아니다.
  공통 Coordinator의 경로 검사를 제거하거나 느슨하게 만들지 않는다.
- MCP trace `params._meta`는 arguments와 분리되어 현재 parser와 호환된다.
  Unix stdio-only FD 상속도 socket을 새로 여는 Blabee 구조와 맞는다. 실제 MCP
  초기화·요청·종료와 비표준 socket override를 포함한 통합 회귀는 별도로 남는다.

근거: [tool Hook cwd](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/core/src/hook_runtime.rs#L247),
[MCP FD 경계](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/rmcp-client/src/stdio_server_launcher.rs#L286).

## 실행한 검증

- Node/Python 계약·Plugin·검증기 회귀 **183/183 통과**.
  계약·Plugin 144개와 패키지/lifecycle 검증기 39개를 직렬로 실행했다.
- 수정한 제품 패키지 검사기로 공식 두 버전 각각 **71개 account-free smoke 통과**.
  전체 파일/voice manifest, 30개 native 파일 서명·공증, 정확한 버전,
  격리 Plugin 설치·조회·제거와 queue 도움말을 확인했다.
  Hook fixture는 위 Node 회귀에서 따로 실행했으므로 smoke에서 중복 실행하지 않았다.
- 직전 검토에서 같은 공식 패키지 각각의 테스트 세션 생성·저장, unsubscribe/closed,
  두 stream EOF와 exit 0, 같은 UUID/cwd cold resume, 압축 `.jsonl.zst`의 기록 보존과
  plain materialization을 확인했다. runtimeWorkspaceRoots와 networkAccess=false도
  유지됐다. 네트워크·사용자 홈을 OS에서 차단했고 모델 turn을 제출하지 않았다.
  lifecycle 제품 프로토콜이 바뀌지 않아 같은 native 실험을 중복 실행하지 않았다.
- Swift 회귀 정의는 새 버전 허용·미등록 버전 거부, 패키지 변조·private 봉인,
  workspace 설정 전달·사전 거부·기본/보조 서버 일치를 포함하도록 갱신했다.
  **Swift 컴파일·테스트는 실행하지 않았다.**
- 작업 시작 사본 대비 독립 정적 QA와 변경 범위 `git diff --check`를 통과했다.
  기존 5개 catalog Record는 바이트 단위로 보존됐고, 새 두 Record의 각 42개
  digest를 실제 패키지에서 독립 재계산해 대조했다. 확정된 결함은 발견하지 못했다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs
node --test --test-concurrency=1 \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

실제 Swift private runtime과 remote TUI, Hook → Pet 승인/선택 → queue 왕복,
설치된 앱의 업데이트 복원은 아직 실사용 검증하지 않았다. 앞선 카드 선택 검증 시간
초과가 이번 버전 지원으로 해결됐다는 판정도 하지 않는다.

작업 시작 사본·이번 검사 결과: `/private/tmp/blabee-codex-0157-fix-dvd09qat/`.
공식 원본·소스 비교·native lifecycle 증거: `/private/tmp/blabee-codex-0157-review-mdjk7S/`.
실행 중인 앱·사용자 Codex 설정·세션·DB와 Engine·Claude 구현은 변경하지 않았다.

## 후속 r76 빌드·검증 — 2026-09-28

- 공식 두 패키지를 실제 Swift production inspector/catalog에 명시적으로 지정해
  fingerprint를 검증했다. 기본 테스트의 0.151.0 경로 생략으로 대체하지 않았다.
- native opt-in으로 0.157.0·0.157.1의 서명·공증·정확한 `--version` 및 실행 전
  재검증을 확인했다. 0.157.1은 현재 Homebrew launcher, 0.157.0은 빌드 폴더의
  공식 패키지 사본을 사용했다. `/private/tmp` 사본은 상위 폴더의 쓰기 권한 때문에
  기존 경로 신뢰 검사에서 거절돼 안전한 경로로 옮겼으며 검사는 완화하지 않았다.
- Swift 전체 회귀 중 이전 focus 재시도 기대와 Claude v2/Channels fixture의 불일치,
  동일 disconnect poll의 중복 `@Published` 갱신을 발견해 수정했다. 수정 후 1,638개가
  통과했다. 변경하지 않은 1,000회 durable replay 검사는 첫 실행에서 통과하여
  재실행에서만 제외했다. 총 1,639개 테스트 범위를 확인했다.
- Node·SQL·통합·패키징 회귀 712개와 서명된 새 앱의 실행 잠금 통합 5개를 통과했다.
  최초 패키징 검사에서 생략된 opt-in을 새 산출물로 실행했다.
- r76 Release 앱·DMG Developer ID 서명, Apple Accepted, stapling, Gatekeeper와
  최종 SHA-256 검사를 통과했다. Claude payload는 공개용 `mcp-hook-v1`을 유지한다.

근거: `build/release-public-20260928-r76/VALIDATION.md`와 같은 폴더의 검사 로그.
이 PC의 설치본 r71, 사용자 세션·운영 DB는 그대로 유지했고 commit·push·GitHub 게시는
수행하지 않았다. 실제 managed private runtime/remote TUI, fresh/reused daemon의
Hook→Pet→queue 실행·완료, 설치 후 업데이트 복원 및 다른 Mac 최초 설치는 별도
실사용 확인 대상이다. 이번 자동 검증이나 Apple 공증이 그 성공을 증명하지 않는다.
