# Codex 0.171.0 호환성 갱신

2026-11-20, macOS arm64. r93을 설치한 다음 날 Homebrew가 Codex를 0.171.0으로 올려 Codex 연결이 다시 막혔다.
0.171.0은 그날 매일 확인(09:00 KST)이 돈 뒤인 09:44 KST에 공개됐다. `npm run codex:register -- --download --check-notarization`으로 등록했다. r94에 포함한다.

## 변경

- `bridges/codex/qualification/0.171.0.json`을 추가했다. 기능은 0.170.0과 같다
  (`managedAppServer`, `pluginCLI`, `serverOwnedWorkspaceRoots`, `updateLifecycle`). Swift 생성 파일과 voice fixture가 함께 바뀌었다.
- 패키지 구성은 0.170.0과 같다. 파일 42개(경로 목록 일치), `bin/codex-exec-server` 선언.
- 일회성 Hook 승인은 primary `bin/codex` CDHash만 신뢰한다.
- `Tests/swift/BlabeePetTests/CodexCompatibilityTests.swift`의 정확한 버전 목록 세 곳에 추가했다.

## 공식 근거

증거 원본: [`codex-evidence/0.171.0.json`](codex-evidence/0.171.0.json).

| 항목 | 0.171.0 |
| --- | --- |
| 공개 시각(UTC) | 2026-11-20 00:44 |
| archive SHA-256 | `58c88032…ce57f210` |
| archive 크기 | 176,190,739 |
| `bin/codex` SHA-256 | `fc8d77cf…8322ce42` |
| `bin/codex` CDHash | `2c3d0af45d2272e5bb61111fd1270b317f62e354` |
| catalog fingerprint | `fb3e4485…` |
| Team ID | 2DC432GLL2 |
| 공증 | native 30개 전부 |

archive SHA-256과 크기는 GitHub release asset 메타데이터와 대조했다. 사용자 Mac의 Homebrew 설치본
(`/opt/homebrew/Caskroom/codex/0.171.0/bin/codex`)도 SHA-256·CDHash가 공식 패키지와 같다.

## 공식 소스 비교 (0.170.0 → 0.171.0)

openai/codex 태그 `rust-v0.170.0`, `rust-v0.171.0`의 파일 트리(blob SHA)를 비교했다. 바뀐 파일은 2,078개로 직전 두 버전보다 훨씬 많다.
아래에서 "같다"는 blob SHA가 같다는 뜻이고, 나머지는 diff를 읽은 판단이다.

- **선택 전달.** `cli/src/queue_cmd.rs`는 같다. `ext/queue/src/service.rs`는 import 한 줄, `thread_queue_processor.rs`는 상대 경로 이미지·오디오 첨부 처리만 바뀌었다.
  `core/src/session/input_queue.rs`는 입력 타입이 `ResolvedUserInput`으로 바뀌었다. 공식 `cli/tests/queue.rs`는 `turn_trigger == "queue"` 단언을 유지한다.
  `session/turn_input.rs`와 `submission.rs`의 배선은 일부만 읽었다.
- **Hook 실행.** `hooks/src/engine/command_runner.rs`는 시그니처 두 곳만 바뀌었고 셸 실행·timeout·실패 처리는 같다. `core/src/hook_runtime/executor.rs`, `core/src/shell.rs`는 같다.
  command Hook은 여전히 `codex` 본체가 띄운다.
- **Hook 입출력.** SessionStart·UserPromptSubmit·Stop·PermissionRequest의 생성 schema는 같다(바뀐 것은 `model-request` 하나). `events/permission_request.rs`, `engine/output_parser.rs`도 같다.
  UserPromptSubmit의 `prompt` 조립 코드가 바뀌었지만 양쪽 모두 텍스트 조각을 그대로 잇는다.
- **승인 변환.** `core/src/tools/approvals.rs`는 같다. Hook Allow → 일회성 `Approved`, 0.167.0의 `NeedsHumanApproval` 규칙 그대로다.
  `protocol/src/approvals.rs`는 MCP elicitation 요청에 `environment_id`만 추가했다.
- **App Server.** 명령 승인 schema(`CommandExecutionRequestApproval*`, `ExecCommandApproval*`)와 `ThreadStartParams`·`TurnStartParams`는 같다.
  MCP 관련 params의 `environmentId`, 오류 enum `bioPolicy`, realtime·계정 알림이 추가됐다. Blabee가 읽지 않는 필드다.
- **패키지·Plugin.** `scripts/codex_package/` 23개는 같다. `plugin/src/bundled_hooks.rs`와 `hooks/src/engine/discovery.rs`는 OpenAI 번들 Hook 한 건만 신뢰 검토에서 빼며 command Hook 경로는 같다.

## 검증

- `npm run qualify:codex-compatibility`(Hook 계약·Plugin 설치/제거 포함): `smoke_passed`, 검사 72개. 계정 없는 검사라 실제 Codex 세션의 Hook 이벤트는 포함하지 않는다.
- native lifecycle(`scripts/verify-update-managed-codex-native.py --execute`, 태그의 공식 `models-manager/models.json`): 통과.
- Swift Codex 묶음(`Codex|ManagedCodex|UpdateManagedCodex|Hook|DoctorApplication`): 12 + 616 통과. 실제 패키지의 `bin/codex`를 `BLABEE_CODEX_RUNTIME_ARTIFACT`로 지정하고
  `BLABEE_REQUIRE_CODEX_RUNTIME_ARTIFACT=1`로 돌렸다.
- `test:t005` 111, `test:codex-compatibility` 97 통과. `codex:qualification -- check`로 생성 파일이 최신임을 확인했다.

## 남은 경계

- 실제 세션의 Hook → Pet → queue 왕복은 r94 설치 후 확인한다. 큐 배선이 바뀐 버전이므로 대기 중 세션과 작업 중 세션 모두에서 선택이 다음 턴으로 들어가는지 본다.
- 0.167.0부터의 "사람 승인 필수" 명령 동작([0.167 기록](CODEX_0167_QUALIFICATION.md))은 그대로다.
