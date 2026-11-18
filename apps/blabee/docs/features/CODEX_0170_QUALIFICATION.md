# Codex 0.169.1·0.170.0 호환성 갱신

2026-11-18, macOS arm64. r92를 설치한 날 Homebrew가 Codex를 0.170.0으로 올려 `codex_native_version_unqualified`로
Codex 연결이 막혔다. 매일 새 버전 확인(`npm run codex:check-latest`)이 0.169.1(11-17)과 0.170.0(11-18)을 미등록으로 보고했고,
둘 다 `npm run codex:register -- --download --check-notarization`으로 등록했다. r93에 포함한다.

## 변경

- `bridges/codex/qualification/0.169.1.json`, `0.170.0.json`을 추가했다. 기능은 0.169.0과 같다
  (`managedAppServer`, `pluginCLI`, `serverOwnedWorkspaceRoots`, `updateLifecycle`). Swift 생성 파일과 voice fixture가 함께 바뀌었다.
- 패키지 구성은 0.169.0과 같다. 파일 42개(경로 목록 일치), `bin/codex-exec-server` 선언, 셸 없음.
- 일회성 Hook 승인은 각 버전의 primary `bin/codex` CDHash만 신뢰한다. `codex-exec-server`는 Hook 호출자가 아니다.
- `Tests/swift/BlabeePetTests/CodexCompatibilityTests.swift`의 정확한 버전 목록 세 곳에 두 버전을 추가했다.

## 공식 근거

증거 원본: [`codex-evidence/0.169.1.json`](codex-evidence/0.169.1.json), [`0.170.0.json`](codex-evidence/0.170.0.json).

| 항목 | 0.169.1 | 0.170.0 |
| --- | --- | --- |
| 공개 시각(UTC) | 2026-11-17 22:21 | 2026-11-18 03:40 |
| archive SHA-256 | `1f39d0dc…4c342dcd` | `975524bf…f22c7893` |
| archive 크기 | 172,465,794 | 173,593,904 |
| `bin/codex` CDHash | `7a08a805d5821177544ee449d555d305ab1bc1c2` | `54b54ef3e470117d723c27413fc117df3148aa32` |
| catalog fingerprint | `50fdc422…` | `6ad49e3b…` |
| Team ID | 2DC432GLL2 | 2DC432GLL2 |
| 공증 | native 30개 전부 | native 30개 전부 |

archive SHA-256과 크기는 GitHub release asset 메타데이터와 대조했다. 사용자 Mac의 Homebrew 설치본
(`/opt/homebrew/Caskroom/codex/0.170.0/bin/codex`)도 CDHash·SHA-256이 공식 패키지와 같다.

## 공식 소스 비교 (0.169.0 → 0.169.1, 0.170.0)

openai/codex 태그 `rust-v0.169.0`, `rust-v0.169.1`, `rust-v0.170.0`의 파일 트리(blob SHA)를 비교했다.
compare API는 300파일에서 잘리므로 쓰지 않았다.

- 0.169.1: `codex-rs/cli/src/queue_cmd.rs`, `codex-rs/hooks/`, `codex-rs/core/src/hook_runtime*`, `codex-rs/core/src/tools/approvals*`,
  `scripts/codex_package/`, App Server protocol schema 모두 변경 없음.
- 0.170.0: `queue_cmd.rs`, `codex-rs/hooks/`(schema 포함), `scripts/codex_package/layout.py` 변경 없음.
  - `core/src/hook_runtime/executor.rs`: MCP 도구 정보를 찾을 때 서버 이름을 catalog 키로 해석하는 한 줄. Hook 실행·판정 경로는 같다.
  - `core/src/tools/approvals.rs`: MCP 도구 승인 구조체에 직렬화하지 않는 내부 필드 하나 추가. 명령 승인의 Hook Allow → 일회성 `Approved`
    변환과 0.167.0의 `NeedsHumanApproval` 규칙은 같다.
  - App Server: 명령 승인 schema(`CommandExecutionRequestApproval*`, `ExecCommandApproval*`)와 요청 params는 변경 없음.
    `thread/*`·`turn/*` 응답과 item 알림 schema는 답변 표시 지시(`AgentMessageDisplay`)가 `oneOf` 형식으로 바뀌었는데,
    Blabee는 이 필드를 읽지 않는다.

## 검증

- `npm run qualify:codex-compatibility`(Hook 계약·Plugin 설치/제거 포함): 두 버전 모두 `smoke_passed`, 검사 72개.
  `--runtime-dir`에는 심볼릭 링크가 없는 실제 경로(`/private/var/...`)를 줘야 한다.
- native lifecycle(`scripts/verify-update-managed-codex-native.py --execute`, 각 태그의 공식 `models-manager/models.json`): 두 버전 모두 통과.
  `--expected-sha256`은 archive가 아니라 `bin/codex`의 SHA-256이다.
- Swift Codex 묶음(`Codex|ManagedCodex|UpdateManagedCodex|Hook|DoctorApplication`): 두 버전 각각 12 + 616 통과.
  실제 패키지의 `bin/codex`를 `BLABEE_CODEX_RUNTIME_ARTIFACT`로 지정하고 `BLABEE_REQUIRE_CODEX_RUNTIME_ARTIFACT=1`로 돌렸다.
- `test:t005` 111, `test:codex-compatibility` 97 통과. `codex:qualification -- check`로 생성 파일이 최신임을 확인했다.

## 남은 경계

- 0.167.0부터의 "사람 승인 필수" 명령 동작([0.167 기록](CODEX_0167_QUALIFICATION.md))은 그대로다.
- 설치 앱의 실제 Hook → Pet → queue 왕복은 r93 설치 후 확인한다.
