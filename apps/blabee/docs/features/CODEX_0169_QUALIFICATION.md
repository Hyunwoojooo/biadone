# Codex 0.167.2·0.168.0·0.169.0 호환성 갱신

2026-11-14, macOS arm64. 매일 새 버전 확인(`scripts/codex/check-latest-notify.sh`)을 처음 돌렸을 때 발견한 세 버전을
`npm run codex:register`로 등록했다. 0.167.2는 0.167.0·0.167.1을 등록하던 2026-11-13에 이미 공개돼 있었는데 그때 놓쳤다.
설치된 앱에는 아직 반영되지 않았다.

## 변경

- `bridges/codex/qualification/0.167.2.json`, `0.168.0.json`, `0.169.0.json`을 추가했다. 기능은 0.167.1과 같다
  (`managedAppServer`, `pluginCLI`, `serverOwnedWorkspaceRoots`, `updateLifecycle`). Swift 생성 파일과 voice fixture가 함께 바뀌었다.
- 패키지 구성은 0.167.1과 같다. 파일 42개(경로 목록 일치), `bin/codex-exec-server` 선언, 셸 없음.
- 일회성 Hook 승인은 각 버전의 primary `bin/codex` CDHash만 신뢰한다. `codex-exec-server`는 Hook 호출자가 아니다.

## 공식 근거

증거 원본: [`codex-evidence/0.167.2.json`](codex-evidence/0.167.2.json), [`0.168.0.json`](codex-evidence/0.168.0.json),
[`0.169.0.json`](codex-evidence/0.169.0.json).

| 항목 | 0.167.2 | 0.168.0 | 0.169.0 |
| --- | --- | --- | --- |
| 공개 시각(UTC) | 2026-11-11 22:44 | 2026-11-13 03:54 | 2026-11-13 08:37 |
| archive SHA-256 | `e7912906…4be1bb` | `2795694b…8058ca` | `8a232260…c36461` |
| archive 크기 | 166,599,161 | 169,155,417 | 172,466,618 |
| `bin/codex` CDHash | `9e1388eb5dd51c8e5a9b5ce2159fbe9ba8304543` | `d43461cbf362926747f9e467e479a64619b6028f` | `e76484c19332652b8bbec1579fefb733f8e32a9d` |
| catalog fingerprint | `46e9b82c…` | `aae3c5e3…` | `a1637876…` |
| Team ID | 2DC432GLL2 | 2DC432GLL2 | 2DC432GLL2 |
| 공증 | native 30개 전부 | native 30개 전부 | native 30개 전부 |

archive SHA-256과 크기는 GitHub release asset 메타데이터와 대조했다.

## 공식 소스 비교 (0.167.1 → 0.169.0)

openai/codex 태그 `rust-v0.167.1`, `rust-v0.167.2`, `rust-v0.168.0`, `rust-v0.169.0`을 비교했다.

- `codex-rs/cli/src/queue_cmd.rs`, `codex-rs/hooks/schema`, `scripts/codex_package/layout.py`: 변경 없음.
  `codex-rs/hooks/src`는 schema fixture 생성 바이너리(`bin/write_hooks_schema_fixtures.rs`)만 바뀌었다(0.169.0).
- `codex-rs/core/src/hook_runtime.rs`(0.168.0): 오류 이벤트 필드 추가와 프롬프트 telemetry 한 줄. Hook 실행·판정 경로는 같다.
- `codex-rs/core/src/tools/approvals.rs`: MCP 도구 승인에 내부 필드 하나 추가. 명령 승인의 Hook Allow → 일회성 `Approved` 변환과
  0.167.0의 `NeedsHumanApproval` 규칙은 같다.
- App Server: 명령 승인 schema(`CommandExecutionRequestApproval*`, `ExecCommandApproval*`)는 변경 없음. 파일 변경 승인의 `abort`가
  `CancelPatchApproval`로 바뀌었지만 Blabee는 파일 변경 승인을 다루지 않는다. Blabee가 보내는 `thread/start`·`thread/resume`·`turn/start`·
  `thread/list`의 필수 필드는 같고, 새 필드는 모두 선택이다. queue 처리(`thread_queue_processor.rs`)는 provider 검사 이름과 메타데이터 전달만 바뀌었다.
- 0.167.2: 기능 플래그·step context 정리 3건. Blabee 경계와 무관하다.

## 검증

- `npm run qualify:codex-compatibility`(Hook 계약·Plugin 설치/제거 포함): 세 버전 모두 `smoke_passed`, 검사 72개.
- native lifecycle(`scripts/verify-update-managed-codex-native.py --execute`, 각 태그의 공식 `models-manager/models.json`, 네트워크 차단): 세 버전 모두 통과.
- Swift Codex 묶음 11 + 608 통과(세 버전 각각). 실제 패키지를 `BLABEE_CODEX_RUNTIME_ARTIFACT`로 지정해 catalog fingerprint 일치를 확인했다.
  첫 실행은 `CodexCompatibilityTests`의 정확한 버전 목록 3곳에서 실패했고, 새 버전을 추가한 뒤 통과했다(의도된 검토 지점).
- `test:t005` 110, `test:codex-compatibility` 97 통과.

## 남은 경계

- 0.167.0부터의 "사람 승인 필수" 명령 동작([0.167 기록](CODEX_0167_QUALIFICATION.md))은 그대로다.
- 설치 앱의 실제 Hook → Pet → queue 왕복은 새 빌드 설치 후 확인한다.
