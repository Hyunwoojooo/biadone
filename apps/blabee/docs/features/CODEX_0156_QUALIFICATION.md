# Codex 0.156.0·0.156.1 지원 검증

2026-09-23, macOS arm64. 이번 변경은 Codex 브릿지 소스와 회귀 정의에 한정한다.
Swift 컴파일·테스트와 앱 빌드·설치·commit·push는 하지 않았다.

## 지원 변경

- `CodexCompatibility`에 두 버전의 Plugin CLI와 managed App Server capability를
  추가했다. 일반 연결 목록은 0.151.0부터 0.156.1까지 발표된 안정 버전 13개다.
- `HookPermissionPolicy`에 각 공식 native CDHash를 추가했다. 버전 문자열,
  다른 버전의 hash 조합, 미검증 실행 파일은 승인 근거가 되지 않는다.
- `CodexRuntimeBundle`에 각 42파일·10디렉터리의 정확한 digest와 전체 fingerprint를
  등록했다. voice JSON의 데이터 예외도 정확한 경로와 hash에만 적용한다.
- `UpdateManagedCodexProfile`에 저장·종료·재개를 검사한 두 버전을 추가했다.
- 패키지 검증기는 두 버전의 정확한 arm64 voice layout을 검사한다.
- Doctor 테스트는 앞서 정리한 공통 managed 정책 순회를 통해 새 버전도 검사한다.
  Plugin setup 테스트의 0.156.0 거부 기대값을 제거하고 미지원 미래 버전 거부는 유지했다.

## 관리형 실행의 인자 정책

0.156 native TUI는 원격 모드에서 클라이언트의 추가 workspace roots 설정을 거부한다.
Blabee가 소유한 App Server로 `sandbox_workspace_write` 및 하위 key의
`-c`/`--config` override를 전달하도록 바꿨다. TOML 값과 순서, 전체 table의
`network_access` 등 다른 key를 보존하며 TOML 파서를 새로 구현하지 않는다.

이 변경은 정확한 0.156.0·0.156.1에만 적용한다. 이전 TUI는 자기 roots 목록을
서버에 보내므로, 이전 버전까지 같은 변환을 적용하면 기존 동작이 달라질 수 있다.
실행 정책의 버전은 같은 private pin에서 가져오며 별도 탐색·버전 실행을 하지 않는다.
기본·보조 App Server에 같은 설정을 전달하고 명시적 native fallback용 원래 인수는 유지한다.

native remote 모드의 제약은 App Server·TUI 시작 전에 명확히 거부한다.

- `--add-dir`: 기존 roots에 추가하는 옵션을 roots 배열 교체로 바꾸지 않는다.
  새 세션에서 필요한 전체 목록은 서버 설정용
  `--config 'sandbox_workspace_write.writable_roots=["/absolute/extra"]'`로 지정할 수 있다.
- `--no-daemon`: managed remote transport와 양립하지 않는다.
- workspace override와 `--profile`의 조합: remote 서버에 해당 profile layer가
  적용되지 않으므로 서로 다른 권한층을 조용히 섞지 않는다.

네이티브 `--` 뒤의 literal prompt/session 입력과 옵션 피연산자는 보존한다.
resume은 upstream 정책대로 저장된 runtime workspace roots를 우선한다.
이번 변경은 사용자 설정 파일을 쓰거나 기존 세션의 권한을 강제로 변경하지 않는다.

공식 근거:
[remote workspace 정책](https://github.com/openai/codex/pull/46494),
[native startup 검사](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/tui/src/startup_orchestration.rs#L16).

## 공식 패키지 근거

| 버전 | arm64 archive SHA-256 | native CDHash |
| --- | --- | --- |
| 0.156.0 | `6f7bdad25693f464a146ad6f24d477ad6fbffe07b62556f829ee5d3b04f48f8b` | `8001723826658db94fdb3d5f9be0785d4bdfb5b6` |
| 0.156.1 | `fea42f9625091f011e38f059da974d52e57ba31831648bb1c7f0b1a385fde547` | `8ac97cbe355e9fee8dd2f993358f0fde83a7a090` |

전체 managed fingerprint:

- 0.156.0: `d0306e399bfd8310d8b8b07006c5ba3ec05c81491ebd510177d3676ddf1d2b52`
- 0.156.1: `f38f13051ab45aa8d4d58b4e05d642dd29522e071d605d14778271004f3354bc`

기존 0.155.1 catalog를 재계산해 직렬화 방식과 전체 entry를 먼저 검증한 뒤 새 값을
계산했다. 독립 정적 검토에서도 새 catalog와 fixture를 증거 JSON에 대조했다.
배포 asset:
[0.156.0](https://github.com/openai/codex/releases/tag/rust-v0.156.0),
[0.156.1](https://github.com/openai/codex/releases/tag/rust-v0.156.1).

## 이번에 실행한 검증

- Node/Python 계약·Plugin·검증기 회귀 **175/175 통과**.
- 두 공식 패키지 각각 **72개 account-free smoke 검사 통과**:
  30개 native 파일의 공식 서명·공증, 전체 package fingerprint 재확인,
  정확한 CLI 버전, 격리된 Plugin 0.1.3 등록·조회·제거, queue 도움말과 Hook fixture.
- 두 버전의 격리 App Server에서 테스트 세션 생성·저장, unsubscribe/closed,
  stdout·stderr EOF와 exit 0, 같은 UUID/cwd 재개를 확인했다.
- 추가 격리 검사에서 원래 기록을 압축 파일만 남긴 상태로 재개했고,
  응답 시점의 plain `.jsonl` 복원·압축 원본 제거·원래 기록 보존을 확인했다.
  Codex가 재개 이벤트를 덧붙이는 것은 허용한다. 최초 검사의 전체 파일 digest
  동등 조건은 이 정상 동작 때문에 실패하여 원래 기록 보존 조건으로 수정했다.
- 서버 프로세스의 cwd와 thread cwd를 다르게 둔 상태에서도 상대 workspace root가
  thread cwd 기준으로 적용되고, network_access=false와 재개 시 roots가 유지됐다.
- lifecycle 검사는 네트워크와 사용자 홈 접근을 OS에서 차단했다.
  계정·모델 턴·실제 사용자 queue를 사용하지 않았다.
- 수정 범위의 `git diff --check`와 독립 정적 QA를 통과했다.

일반 sandbox 안에서는 macOS 서명 검사에서 차단되어 후보 실행 전 종료했다.
동일한 공식 패키지를 승인된 검사 환경에서 다시 확인해 위 결과를 얻었다.

압축 resume은 native가 writable recorder를 만들기 전에 plain 파일을 materialize하고
live path를 응답한다. 따라서 Blabee의 `.jsonl` persistence 조건을 완화하지 않았다.
[공식 recorder](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/rollout/src/recorder.rs#L1994).

## 남은 검증과 근거 위치

Swift 테스트 소스에는 버전 허용·거부, private 데이터 봉인·변조 거부, pinned version
재검증, launcher 인자 분리와 사전 거부, 두 서버 전달을 보완했지만 실행하지 않았다.
새 Swift private runtime과 관리형 TUI, 실제 Hook → Pet 승인/선택 → queue 왕복,
설치된 앱의 업데이트 복원은 별도 검증이 필요하다.

작업 시작 사본과 보고서: `/private/tmp/blabee-codex-0156-fix-hfk1ide7/`.
공식 원본 패키지와 태그 소스: `/private/tmp/blabee-codex-01561-review-6ak63nu5/`.
실행 중인 앱·사용자 Codex 설정·세션·운영 DB와 Engine·Claude 구현은 변경하지 않았다.
